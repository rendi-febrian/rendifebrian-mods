# cc-context-bar

A **Claude Code mod** that draws a live readout of the context window in the
band directly above the prompt — plus a `/context-bar` pane with the detail.

Install:

```
/plugin marketplace add rendi-febrian/rendifebrian-mods
/plugin install cc-context-bar@rendifebrian-mods
```

```
☂ Showers 67%  133k/200k  ▁▂▂▄▄▅▅▆▆▇▇█  ▲+133k  in 15k/out 6.1k  Σ 150k/35k  est $1.22 ($0.1722)  · 5h 45%  · 7d 78%
```

| Part | What it shows |
|---|---|
| `☂ Showers 67%` | Weather for how full the window is: ☀ Clear <25%, ☁ Cloudy 25–49%, ☂ Showers 50–74%, ☇ Storm 75–89%, ↯ Compact soon ≥90% |
| `133k/200k` | Context tokens used out of the model's window |
| `▁▂▂▄▄▅▅▆▆▇▇█` | Sparkline of the last 12 turns, each bar that turn's context size |
| `▲+133k` | What the last turn added to the window |
| `in 15k/out 6.1k` | Last turn's input / output tokens |
| `Σ 150k/35k` | Session totals: input / output tokens |
| `est $1.22 ($0.1722)` | Estimated session cost from the price table, and the engine's own `/cost` figure |
| `· 5h 45% · 7d 78%` | Plan-limit windows — **only when the account reports them** |

The limits shown are whatever the account reports through `$.session.usage()`:
a Pro/Max subscription reports the rolling 5-hour session window and the weekly
cap (one shared pool across app and CLI). An API-key session reports none, so
neither the band nor the pane invents one.

`/context-bar` opens a pane with the same readout plus: a meter, session
in/out/cache totals, a per-turn ledger (what each turn added, its tokens,
cache read/write, and its own cost), the limit meters with reset countdowns,
and the price table in use.

## Files

```
cc-context-bar/
├── .claude-plugin/plugin.json   manifest
├── hooks/hooks.json             points at the module
├── hooks/register.js            the mod
└── test/run.mjs                 harness: runs the mod with no session
```

## Run it without a session

```bash
node test/run.mjs          # prints the band and the pane, and validates both
node test/run.mjs --json   # machine-readable
```

The harness mocks the mods API, feeds 13 turns of usage, dispatches the events
a real session fires, then checks every drawn tree against the props the engine
allows on `Box`/`Text` (one bad prop fails the whole tree). It also asserts the
band is exactly one row, that it yields to a survey, that it omits limits the
account doesn't report, and that the mod draws nothing into another pane.

## What it touches

Disclosure, so you can check it against `claude plugin validate`:

- **Events hooked**: `session.start`, `turn.complete`, `session.measure`,
  `command.run`, `ui.render` (once for the band, once for the pane).
- **Mods API calls**: `$.session.usage`, `$.session.*` reads, `$.store.get/set`,
  `$.command.register`, `$.ui.resolve`, `$.ui.invalidate`, `$.ui.panes`,
  `$.ui.open`, `$.ui.close`.
- **No** `$.process.run` or `$.process.spawn` — it starts nothing.
- **No** `$.http.fetch` — it sends nothing anywhere.
- **No** `$.fs.*` — it writes nothing; the only persisted state is its own
  ledger in the mods API store (`cc-context-bar:ledger`), which holds token
  counts and the price table, no prompts and no file contents.
- The only data it reads from your session is what `$.session.usage()` returns:
  context-window fill, rate-limit windows, and the session cost.

## Cost figures

`est` is computed from `PRICES` in `hooks/register.js` (USD per million tokens,
matched by a substring of the model id: `opus`, `sonnet`, `haiku`, `default`).
The figure in parentheses is the engine's own `/cost` total, so the two are
checkable against each other. To add a model or change a rate without editing
the file, write into the mod's store entry `cc-context-bar:ledger`:

```json
{ "prices": { "my-gateway-model": [1, 2, 0.5, 0.1] } }
```

Values are `[input, output, cacheWrite, cacheRead]` per million tokens.
