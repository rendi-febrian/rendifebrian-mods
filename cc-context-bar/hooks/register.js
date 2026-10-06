/**
 * cc-context-bar — a Claude Code mod.
 *
 * Draws a live readout of the context window in the band above the prompt:
 * weather for how full it is, tokens used out of the window, a sparkline of
 * the last 12 turns, what the last turn added, tokens in/out, and cost.
 *
 * Also registers `/context-bar` for a detailed pane (per-turn ledger, cost
 * breakdown, plan limits).
 *
 * Reference: https://code.claude.com/docs/en/plugins/mods/reference
 * Every drawing call goes through `$.ui.resolve(e)` so the tree matches the
 * surface and the Claude Code version the mod loads on. No Node APIs here —
 * the hooks module has none. Persistent state goes in `$.store`.
 */

const PANE = 'context-bar'
const STORE_KEY = 'cc-context-bar:ledger'

// ---------- tunables -------------------------------------------------------

// Weather bands, highest first: [minPercent, icon, word, color]
const WEATHER = [
  [90, '↯', 'Compact soon', 'red'],
  [75, '☇', 'Storm', 'magenta'],
  [50, '☂', 'Showers', 'blue'],
  [25, '☁', 'Cloudy', 'cyan'],
  [0, '☀', 'Clear', 'yellow']
]

const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
const SPARK_TURNS = 12

// USD per million tokens, matched by a substring of the model id the API
// reports: [input, output, cacheWrite, cacheRead]. Override per model at
// runtime by writing {"prices": {"my-model": [1,2,3,4]}} into the mod's store
// entry. The exact session figure still comes from `usage.cost.usd`.
const PRICES = {
  opus: [15, 75, 18.75, 1.5],
  sonnet: [3, 15, 3.75, 0.3],
  haiku: [1, 5, 1.25, 0.1],
  default: [3, 15, 3.75, 0.3]
}

// ---------- state (module-level: lives for this activation) ----------------

let ledger = {
  turns: [], // { input, output, cacheWrite, cacheRead, model, contextTokens, at }
  totals: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  prices: {}
}

let snapshot = null // last `$.session.usage()` reading

// ---------- helpers --------------------------------------------------------

function weatherFor(percent) {
  const row = WEATHER.find((r) => percent >= r[0]) ?? WEATHER[WEATHER.length - 1]
  return { icon: row[1], word: row[2], color: row[3] }
}

function compact(n) {
  if (n === null || n === undefined) return '—'
  if (n < 1000) return String(Math.round(n))
  if (n < 1000000) {
    const k = n / 1000
    return (k < 10 ? k.toFixed(1) : String(Math.round(k))).replace(/\.0$/, '') + 'k'
  }
  return (n / 1000000).toFixed(2) + 'M'
}

function money(usd) {
  if (usd === null || usd === undefined) return '—'
  if (usd >= 100) return '$' + usd.toFixed(0)
  if (usd >= 1) return '$' + usd.toFixed(2)
  return '$' + usd.toFixed(4)
}

function priceFor(model) {
  for (const key of Object.keys(ledger.prices)) {
    if (model && model.includes(key)) return ledger.prices[key]
  }
  for (const [key, value] of Object.entries(PRICES)) {
    if (key !== 'default' && model && model.includes(key)) return value
  }
  return PRICES.default
}

/** What one turn or one totals object cost, in USD, from the price table. */
function estimate(entry, model) {
  const p = priceFor(model || entry.model)
  return (
    (entry.input / 1e6) * p[0] +
    (entry.output / 1e6) * p[1] +
    (entry.cacheWrite / 1e6) * p[2] +
    (entry.cacheRead / 1e6) * p[3]
  )
}

function totalEstimate() {
  return estimate(ledger.totals, ledger.turns.at(-1)?.model)
}

/** The sparkline: the last SPARK_TURNS turns, each bar its context size. */
function sparkline() {
  const last = ledger.turns.slice(-SPARK_TURNS).map((t) => t.contextTokens ?? 0)
  if (!last.length) return ''
  const max = Math.max.apply(null, last.concat([1]))
  return last
    .map((v) => SPARK[Math.min(SPARK.length - 1, Math.floor((v / max) * (SPARK.length - 1)))])
    .join('')
}

/** What a turn added to the window: the whole input side of its response. */
function addedBy(turn) {
  if (!turn) return null
  return (turn.input ?? 0) + (turn.cacheWrite ?? 0) + (turn.cacheRead ?? 0)
}

function recordTurn(usage) {
  if (!usage) return null
  const input = usage.input_tokens ?? 0
  const cacheWrite = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const entry = {
    input,
    output: usage.output_tokens ?? 0,
    cacheWrite,
    cacheRead,
    model: usage.model,
    contextTokens: input + cacheWrite + cacheRead,
    at: Date.now()
  }
  ledger.turns.push(entry)
  if (ledger.turns.length > 500) ledger.turns = ledger.turns.slice(-500)
  ledger.totals.input += entry.input
  ledger.totals.output += entry.output
  ledger.totals.cacheWrite += entry.cacheWrite
  ledger.totals.cacheRead += entry.cacheRead
  return entry
}

function persist($) {
  // Kept across reloads and sessions; `$.store` is shared by every session.
  return $.store.set(STORE_KEY, {
    turns: ledger.turns.slice(-200),
    totals: ledger.totals,
    prices: ledger.prices
  })
}

async function hydrate($) {
  const saved = await $.store.get(STORE_KEY).catch(() => null)
  if (saved && typeof saved === 'object') {
    if (Array.isArray(saved.turns)) ledger.turns = saved.turns
    if (saved.totals && typeof saved.totals === 'object') ledger.totals = saved.totals
    if (saved.prices && typeof saved.prices === 'object') ledger.prices = saved.prices
  }
}

/** A reset moment, said short: "17m", "2h10m", "3d4h". */
function until(iso) {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const ms = then - Date.now()
  if (ms <= 0) return 'now'
  const minutes = Math.round(ms / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rem = minutes % 60
  if (hours < 24) return rem ? `${hours}h${rem}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const rh = hours % 24
  return rh ? `${days}d${rh}h` : `${days}d`
}

/** The plan-limit windows: what the account reports, or none at all. */
function planLimits() {
  return (snapshot?.rateLimits ?? []).map((l) => ({
    kind: l.kind,
    word: l.kind === 'five_hour' ? '5h' : l.kind === 'seven_day' ? '7d' : l.kind,
    percent: Math.round(l.percentUsed),
    reset: until(l.resetsAt),
    color: l.percentUsed >= 90 ? 'red' : l.percentUsed >= 70 ? 'yellow' : 'green'
  }))
}

async function refresh($) {
  snapshot = await $.session.usage().catch(() => snapshot)
}

/** Runs for the band, in reading order: [text, props] pairs. */
function bandRuns() {
  const ctx = snapshot?.context
  const tokens = ctx?.tokens
  const window_ = ctx?.window
  const percent = ctx?.percent ?? (tokens && window_ ? (tokens / window_) * 100 : 0)
  const w = weatherFor(percent)
  const last = ledger.turns.at(-1)
  const added = addedBy(last)
  const sessionUsd = snapshot?.cost?.usd
  const spark = sparkline()
  const limits = planLimits()

  const runs = [
    [`${w.icon} ${w.word} ${percent.toFixed(0)}%`, { color: w.color }],
    [`  ${compact(tokens)}/${compact(window_)}`, { dimColor: true }],
    [spark ? `  ${spark}` : '', { color: w.color }],
    [added !== null ? `  ▲+${compact(added)}` : '', { dimColor: true }],
    [last ? `  in ${compact(last.input)}/out ${compact(last.output)}` : '', { dimColor: true }],
    [`  Σ ${compact(ledger.totals.input)}/${compact(ledger.totals.output)}`, { dimColor: true }],
    [`  est ${money(totalEstimate())}`, {}],
    [sessionUsd !== undefined ? ` (${money(sessionUsd)})` : '', { dimColor: true }]
  ]

  // Plan limits: only what the account reports. An API-key session reports
  // none, so the band stays as it is without them.
  for (const l of limits) {
    runs.push([`  · ${l.word} ${l.percent}%`, { color: l.color }])
  }
  return runs.filter((r) => r[0])
}

function bar(percent, width) {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

// ---------- drawing --------------------------------------------------------

/** A tree the engine would accept as a drawing (mine, or another mod's). */
function isTree(node) {
  if (Array.isArray(node)) return node.every(isTree)
  if (!node || typeof node !== 'object') return false
  return node.type === 'Box' || node.type === 'Text' || node.type === 'Button'
}

function drawBand($, e, below) {
  const { Box, Text } = $.ui.resolve(e)
  const width = e.props?.bodyColumns ?? e.viewport?.columns

  // The band wants ONE line: one Text whose children are inline Text runs.
  // A Box of one Text per run would lay out one row per run instead.
  const line = Text({
    key: 'line',
    wrap: 'truncate-end',
    children: bandRuns().map(([text, props], i) =>
      Text({
        key: 'seg' + i,
        color: props.color,
        dimColor: props.dimColor,
        children: [text]
      })
    )
  })

  // Keep whatever the mods after this one drew there, if anything.
  const kids = isTree(below) ? [line, below] : [line]

  return Box({
    flexDirection: 'column',
    children: kids,
    width
  })
}

function drawPane($, e) {
  const { Box, Text } = $.ui.resolve(e)
  const ctx = snapshot?.context
  const percent = ctx?.percent ?? 0
  const w = weatherFor(percent)
  const sessionUsd = snapshot?.cost?.usd
  const turns = ledger.turns.slice(-SPARK_TURNS)
  const priceRows = Object.assign({}, PRICES, ledger.prices)

  const children = [
    Text({ key: 'head', bold: true, color: w.color, children: [`${w.icon} ${w.word} · ${percent.toFixed(1)}%`] }),
    Text({
      key: 'meter',
      color: w.color,
      children: [`${bar(percent, 24)}  ${compact(ctx?.tokens)} / ${compact(ctx?.window)}`]
    }),
    Text({ key: 'gap1', children: [' '] }),
    Text({ key: 'sum', bold: true, children: ['This session'] }),
    Text({
      key: 'sum2',
      dimColor: true,
      children: [
        `in ${compact(ledger.totals.input)}   out ${compact(ledger.totals.output)}   ` +
          `cache write ${compact(ledger.totals.cacheWrite)}   cache read ${compact(ledger.totals.cacheRead)}`
      ]
    }),
    Text({
      key: 'sum3',
      children: [
        `estimated cost ${money(totalEstimate())}` +
          (sessionUsd !== undefined ? `   ·   engine session total ${money(sessionUsd)}` : '')
      ]
    }),
    Text({ key: 'gap2', children: [' '] }),
    Text({ key: 'turns-head', bold: true, children: [`Last ${turns.length} turns`] })
  ]

  if (!turns.length) {
    children.push(Text({ key: 'none', dimColor: true, children: ['no turns recorded yet — send a prompt'] }))
  }
  turns.forEach((t, i) => {
    children.push(
      Text({
        key: 'turn' + i,
        wrap: 'truncate-end',
        children: [
          `${String(i + 1).padStart(2)}  +${compact(addedBy(t)).padStart(7)}  ` +
            `in ${compact(t.input).padStart(6)}  out ${compact(t.output).padStart(6)}  ` +
            `cache ↺${compact(t.cacheRead)}/${compact(t.cacheWrite)}  ` +
            `${money(estimate(t))}`
        ]
      })
    )
  })

  children.push(Text({ key: 'gap3', children: [' '] }))
  const limits = planLimits()
  children.push(Text({ key: 'limits-head', bold: true, children: ['Limits'] }))
  if (!limits.length) {
    children.push(
      Text({
        key: 'limits-none',
        dimColor: true,
        children: ['none reported for this account (no 5h or weekly window)']
      })
    )
  }
  for (const l of limits) {
    const label = l.kind === 'five_hour' ? '5h rolling' : l.kind === 'seven_day' ? 'weekly' : l.kind
    children.push(
      Text({
        key: 'lim-' + l.kind,
        color: l.color,
        children: [
          `${label.padEnd(10)} ${bar(l.percent, 16)} ${String(l.percent).padStart(3)}%  reset ${l.reset || '—'}`
        ]
      })
    )
  }
  if (limits.length > 1) {
    children.push(
      Text({
        key: 'limits-note',
        dimColor: true,
        children: ['one shared pool across app and CLI; rolling 5h, weekly cap']
      })
    )
  }
  children.push(
    Text({
      key: 'foot',
      dimColor: true,
      wrap: 'truncate-end',
      children: [
        'prices (in/out per Mtok): ' +
          Object.entries(priceRows)
            .map(([k, v]) => `${k} ${v[0]}/${v[1]}`)
            .join('   ')
      ]
    })
  )

  return Box({
    flexDirection: 'column',
    paddingX: 1,
    width: e.props?.bodyColumns,
    children
  })
}

// ---------- register -------------------------------------------------------

export function register(on, options) {
  on('session.start', async ($, e, next) => {
    await hydrate($)
    await refresh($)
    // Register the command last: a throw here (a taken name) skips the rest of
    // this hook, and the hook stays usable either way.
    await $.command
      .register({
        name: 'context-bar',
        description: 'Open the context bar pane: tokens in/out, cost, plan limits'
      })
      .catch(() => undefined)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // One reading per turn, taken from the event's own usage figures.
  on('turn.complete', async ($, e, next) => {
    recordTurn(e.usage)
    await refresh($)
    await persist($).catch(() => undefined)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // The engine measures after each turn too, and when a plan limit moves.
  on('session.measure', async ($, e, next) => {
    await refresh($)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('command.run', { command: 'context-bar' }, async ($, e) => {
    const panes = await $.ui.panes().catch(() => [])
    if (panes.some((p) => p.id === PANE)) await $.ui.close({ id: PANE })
    else await $.ui.open({ id: PANE, title: 'context bar' })
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    return drawPane($, e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props?.hasSurvey) return next(e) // yield the band while a survey shows
    // `next(e)` resolves to what the rest of the chain draws in the band; keep
    // it under this mod's line rather than replacing it.
    const below = e.props?.isWorking ? undefined : await next(e).catch(() => undefined)
    return drawBand($, e, below)
  })
}
