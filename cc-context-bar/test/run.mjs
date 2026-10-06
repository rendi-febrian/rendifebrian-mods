/**
 * Harness for cc-context-bar — runs the mod without a Claude Code session.
 *
 *   node test/run.mjs            # feed a scripted session, print the band
 *   node test/run.mjs --json     # same, but machine-readable
 *
 * It builds a mock mods API (`$`), records every hook `register` adds,
 * dispatches the events a real session fires, and validates each drawn tree
 * against the props the engine allows on Box/Text (a tree with any other prop
 * is refused as a whole — see the Mods reference).
 */

import { register } from '../hooks/register.js'

// ---- the prop allowlist the engine validates a tree against ---------------

const BOX_PROPS = new Set([
  'key', 'hover', 'group', 'position', 'top', 'left', 'right', 'bottom',
  'flexDirection', 'flexGrow', 'flexShrink', 'flexWrap', 'alignItems', 'alignSelf',
  'justifyContent', 'gap', 'columnGap', 'rowGap', 'width', 'height', 'minWidth',
  'minHeight', 'margin', 'marginX', 'marginY', 'marginTop', 'marginBottom',
  'marginLeft', 'marginRight', 'padding', 'paddingX', 'paddingY', 'paddingTop',
  'paddingBottom', 'paddingLeft', 'paddingRight', 'borderStyle', 'borderColor',
  'borderDimColor', 'backgroundColor', 'overflow', 'display', 'children'
])
const TEXT_PROPS = new Set([
  'key', 'hover', 'group', 'color', 'backgroundColor', 'dimColor', 'bold',
  'italic', 'underline', 'strikethrough', 'inverse', 'wrap', 'children'
])

const problems = []

function checkTree(node, path = 'tree') {
  if (node === null || node === undefined || typeof node === 'string') return
  if (typeof node !== 'object') return problems.push(`${path}: not an element (${typeof node})`)
  if (node.type !== 'Box' && node.type !== 'Text') {
    problems.push(`${path}: unexpected element type ${JSON.stringify(node.type)}`)
    return
  }
  const allowed = node.type === 'Box' ? BOX_PROPS : TEXT_PROPS
  for (const k of Object.keys(node.props ?? {})) {
    if (!allowed.has(k)) problems.push(`${path}.${k}: prop not allowed on ${node.type} → tree refused`)
  }
  for (const child of node.children ?? []) checkTree(child, `${path}/${node.type}`)
}

/** Flatten a tree to the text a surface would draw (rows joined by newlines). */
function flatten(tree) {
  if (tree === null || tree === undefined) return ''
  if (typeof tree === 'string') return tree
  if (Array.isArray(tree)) return tree.map(flatten).join('')
  const kids = tree.children ?? []
  if (tree.type === 'Box' && tree.props?.flexDirection === 'column') {
    return kids
      .map((k) => flatten(k))
      .filter((s) => s !== '')
      .join('\n')
  }
  return kids.map(flatten).join('')
}

/** Count how many rows the terminal would lay out. */
function rows(tree) {
  if (!tree || typeof tree !== 'object') return 0
  if (tree.type === 'Text') {
    // Inline Text children share the parent's line; the parent is one row.
    const runs = (tree.children ?? []).filter((k) => k && typeof k === 'object').length
    return runs && !(tree.children ?? []).some((c) => typeof c === 'string')
      ? 0
      : 1
  }
  const kids = tree.children ?? []
  const nested = kids.some((k) => k && typeof k === 'object' && k.type === 'Box')
  if (nested) return kids.reduce((n, k) => n + rows(k), 0)
  const texts = kids.filter((k) => k && typeof k === 'object' && k.type === 'Text')
  if (!texts.length) return kids.length ? 1 : 0
  // Texts laid out as siblings of a column Box: each its own row.
  return texts.reduce((n, t) => n + (rows(t) || 1), 0)
}

// ---- mock mods API --------------------------------------------------------

const STORE = {}
const LOG = []
const TIMERS = []

function makeElems(surface = 'terminal') {
  const el = (type) => (props) => ({
    type,
    props: { ...props, children: undefined },
    children: (props?.children ?? []).filter((c) => c !== null && c !== undefined)
  })
  // The real resolve() returns constructors; ours return the same plain tree
  // shape the engine validates.
  return { Box: el('Box'), Text: el('Text'), Button: el('Button') }
}

function makeApi(session) {
  const $ = {
    plugin: { name: 'cc-context-bar', root: process.cwd() },
    ui: {
      resolve: () => makeElems(),
      invalidate: (what) => LOG.push(['invalidate', what]),
      status: (t) => LOG.push(['status', t]),
      toast: (t) => LOG.push(['toast', t]),
      log: (t) => LOG.push(['log', t]),
      panes: async () => session.panes,
      open: async (args) => {
        session.panes.push({ id: args.id, title: args.title, isShown: true })
        LOG.push(['open', args.id])
      },
      close: async (args) => {
        session.panes = session.panes.filter((p) => p.id !== args.id)
        LOG.push(['close', args.id])
      }
    },
    command: {
      register: async (spec) => {
        if (session.takenCommands.includes(spec.name)) throw new Error(`"/${spec.name}" refused: it is the built-in /${spec.name}`)
        session.commands.push(spec)
      },
      list: async () => session.commands
    },
    session: {
      usage: async () => JSON.parse(JSON.stringify(session.usage)),
      id: async () => session.id,
      model: async () => session.usage.model,
      cwd: async () => process.cwd(),
      turns: async () => session.turns,
      messages: async () => [],
      surfaces: async () => ['terminal'],
      version: async () => ({ version: '2.1.287' })
    },
    store: {
      get: async (k) => (k in STORE ? JSON.parse(STORE[k]) : null),
      set: async (k, v) => {
        STORE[k] = JSON.stringify(v)
      },
      delete: async (k) => {
        delete STORE[k]
      },
      keys: async () => Object.keys(STORE)
    },
    clock: { now: async () => Date.now(), after: (ms, fn) => (TIMERS.push(fn), { cancel() {} }), every: (ms, fn) => (TIMERS.push(fn), { cancel() {} }) },
    fs: { read: async () => '', write: async () => {}, exists: async () => false, list: async () => [], stat: async () => ({}) },
    process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
    env: { get: () => undefined, set: () => {} },
    settings: { read: async () => ({}) },
    http: { fetch: async () => ({ status: 200, ok: true, text: '' }) },
    prompt: { submit: async () => {} }
  }
  return $
}

// ---- the mod's session ----------------------------------------------------

const session = {
  id: 'sess-test',
  turns: 0,
  panes: [],
  commands: [],
  takenCommands: [],
  usage: {
    context: { tokens: undefined, window: 200000, percent: undefined },
    rateLimits: [],
    cost: { usd: 0 }
  }
}

const hooks = []
const on = (pattern, a, b) => {
  const matcher = typeof a === 'function' ? null : a
  const hook = typeof a === 'function' ? a : b
  hooks.push({ pattern, matcher, hook, caught: null })
  const reg = {
    catch(fn) {
      hooks[hooks.length - 1].caught = fn
    }
  }
  return reg
}

const $ = makeApi(session)
register(on, {})

async function dispatch(pattern, event, { nextResult } = {}) {
  const matching = hooks.filter((h) => h.pattern === pattern)
  let i = 0
  const run = async (e) => {
    if (i >= matching.length) return nextResult ?? {}
    const h = matching[i++]
    if (h.matcher) {
      for (const [k, v] of Object.entries(h.matcher)) {
        if (e[k] !== v) return run(e)
      }
    }
    try {
      return await h.hook($, e, (e2) => run(e2 ?? e))
    } catch (err) {
      if (h.caught) return h.caught({ error: { kind: 'throw', message: String(err) } }, e, run)
      throw err
    }
  }
  return run(event)
}

/** One simulated assistant turn: usage figures + the engine's usage() reading. */
async function turn({ input, output, cacheWrite = 0, cacheRead = 0, model = 'claude-sonnet-4-6' }) {
  session.turns += 1
  const contextTokens = input + cacheWrite + cacheRead
  session.usage = {
    context: {
      tokens: contextTokens,
      window: 200000,
      percent: Number(((contextTokens / 200000) * 100).toFixed(1))
    },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 45, resetsAt: '2026-10-06T09:30:00Z' },
      { kind: 'seven_day', percentUsed: 78, resetsAt: '2026-10-13T04:00:00Z' }
    ],
    cost: { usd: Number((session.usage.cost.usd + 0.0123).toFixed(4)) }
  }
  await dispatch('turn.complete', {
    reason: 'answer',
    turnId: 't' + session.turns,
    usage: {
      input_tokens: input,
      output_tokens: output,
      cache_creation_input_tokens: cacheWrite,
      cache_read_input_tokens: cacheRead,
      model
    }
  })
  await dispatch('session.measure', {})
}

const json = process.argv.includes('--json')
const out = (label, value) => {
  if (json) return
  console.log(`\n${label}\n${'-'.repeat(label.length)}\n${value}`)
}

await dispatch('session.start', { cwd: process.cwd(), surface: null, isInteractive: true })

const script = [
  { input: 4100, output: 900 },
  { input: 2500, output: 1200, cacheRead: 4000 },
  { input: 3100, output: 800, cacheRead: 6500 },
  { input: 12400, output: 1400, cacheRead: 9600, cacheWrite: 1200 },
  { input: 6700, output: 2100, cacheRead: 22000 },
  { input: 42000, output: 5200, cacheRead: 28700 },
  { input: 9800, output: 1900, cacheRead: 61000 },
  { input: 12300, output: 2400, cacheRead: 70000 },
  { input: 5100, output: 1100, cacheRead: 83000 },
  { input: 8800, output: 3200, cacheRead: 89000 },
  { input: 9900, output: 2600, cacheRead: 96000 },
  { input: 10600, output: 4100, cacheRead: 104000 },
  { input: 7200, output: 1800, cacheRead: 113000 },
  { input: 15400, output: 6100, cacheRead: 118000 }
]
for (const t of script) await turn(t)

// ---- draw the two sites ---------------------------------------------------

const band = await dispatch(
  'ui.render',
  { component: 'AbovePrompt', surface: 'terminal', requestId: 'band', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 140 }, viewport: { columns: 140, rows: 40 } },
  { nextResult: null }
)
const pane = await dispatch(
  'ui.render',
  { component: 'Pane', surface: 'terminal', requestId: 'context-bar', props: { title: 'context bar', bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} }, viewport: { columns: 140, rows: 40 } },
  { nextResult: null }
)

checkTree(band, 'band')
checkTree(pane, 'pane')

// The band must be one row; the pane may be taller.
const bandRows = rows(band)
if (bandRows !== 1) problems.push(`band drew ${bandRows} rows; the band wants 1`)

// ---- second pass: an account that reports no plan limits (API key) --------
session.panes = []
session.commands = []
session.usage.rateLimits = []
session.usage.cost = undefined // absent where the host keeps no ledger
session.usage.context = { tokens: 1800, window: 200000, percent: 0.9 }
session.turns += 1
await dispatch('turn.complete', {
  reason: 'answer',
  turnId: 'tx',
  usage: { input_tokens: 1400, output_tokens: 260, cache_creation_input_tokens: 0, cache_read_input_tokens: 400, model: 'claude-haiku-4-5' }
})
await dispatch('session.measure', {})
const dryBand = await dispatch(
  'ui.render',
  { component: 'AbovePrompt', surface: 'terminal', requestId: 'band', props: { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 140 }, viewport: { columns: 140, rows: 40 } },
  { nextResult: null }
)
const dryPane = await dispatch(
  'ui.render',
  { component: 'Pane', surface: 'terminal', requestId: 'context-bar', props: { title: 'context bar', bodyColumns: 100, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} }, viewport: { columns: 140, rows: 40 } }
)
checkTree(dryBand, 'dry-band')
checkTree(dryPane, 'dry-pane')
if (/\d+h \d+%|\d+d \d+%/.test(flatten(dryBand).replace(/[^\x00-\x7F]/g, '')) && flatten(dryBand).includes('5h')) {
  problems.push('band still shows a plan limit when the account reports none')
}
if (!flatten(dryPane).includes('none reported')) {
  problems.push('pane does not say the account reports no limits')
}
if (rows(dryBand) !== 1) problems.push(`dry band drew ${rows(dryBand)} rows`)

// ---- also: the band must yield to a survey -------------------------------
// `next(e)` passing the event on IS the yield: the mod draws nothing itself.
let surveyYielded = false
await dispatch(
  'ui.render',
  { component: 'AbovePrompt', surface: 'terminal', requestId: 'band', props: { hasSurvey: true, isWorking: false, maxRows: 12, bodyColumns: 140 } },
  { nextResult: { yielded: true } }
).then((r) => {
  surveyYielded = r?.yielded === true
})
if (!surveyYielded) problems.push('band did not yield while a survey holds it')

// ---- and the pane must leave another pane's drawing alone ----------------
const foreign = await dispatch(
  'ui.render',
  { component: 'Pane', surface: 'terminal', requestId: 'diff', props: { title: 'diff', bodyColumns: 80 } },
  { nextResult: { yielded: true } }
)
if (foreign?.yielded !== true) problems.push('mod drew into another pane')

if (json) {
  console.log(
    JSON.stringify(
      {
        problems,
        bandText: flatten(band),
        bandRows,
        noLimitsBandText: flatten(dryBand),
        noLimitsPaneMentionsNone: flatten(dryPane).includes('none reported'),
        paneText: flatten(pane).split('\n'),
        commands: session.commands,
        storeKeys: Object.keys(STORE),
        log: LOG
      },
      null,
      2
    )
  )
} else {
  out('BAND (above the prompt)', flatten(band))
  out('BAND (account reports no limits)', flatten(dryBand))
  out('PANE (/context-bar)', flatten(pane))
  out('REGISTERED COMMANDS', JSON.stringify(session.commands))
  out('STORE KEYS', Object.keys(STORE).join(', '))
  out('PROBLEMS', problems.length ? problems.join('\n') : 'none — every tree validates')
}

process.exit(problems.length ? 1 : 0)
