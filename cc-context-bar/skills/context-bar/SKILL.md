---
name: context-bar
description: Report this session's context window, token in/out per turn, and estimated cost as a one-line bar plus a short ledger. Use when the user asks how full the context is, how many tokens were used, what the session costs, or where the usage went — and whenever they type /context-bar.
---

# Context bar

Print a readout of the current session's context window, token usage and
estimated cost. Everything here is computed from the session transcript on
disk, so it needs no scripts and no network.

## Where the numbers come from

The session transcript is a JSONL file: one JSON object per line, one line per
assistant response. Each assistant line carries the API's own usage figures:

```
message.usage.input_tokens
message.usage.output_tokens
message.usage.cache_creation_input_tokens
message.usage.cache_read_input_tokens
message.model
```

The transcript lives under the config directory, one folder per project:

- `~/.claude/projects/<slug>/*.jsonl` — Claude Code CLI and IDE sessions
- The desktop app's Code tab keeps its own copy under its data directory
  (`~/Library/Application Support/Claude/…`); search there when the first path
  is empty.

## Procedure

1. Find the transcript for this session — the newest file, unless you were
   given a session id:

   ```bash
   ls -t ~/.claude/projects/*/*.jsonl 2>/dev/null | head -1
   ```

2. Sum the four token counts over every assistant line. A line's **input side**
   is `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`;
   that sum is what that response's context window held.
3. The window size is the model's: 200,000 tokens unless the session says
   otherwise. Percent used = last line's input side ÷ window × 100.
4. Cost, per million tokens: multiply each count by the model's rate. Use these
   defaults and state which you used:

   | model family | input | output | cache write | cache read |
   |---|---|---|---|---|
   | opus | $15 | $75 | $18.75 | $1.50 |
   | sonnet | $3 | $15 | $3.75 | $0.30 |
   | haiku | $1 | $5 | $1.25 | $0.10 |

   Say plainly that this is an estimate, and give the engine's own figure too
   (see below) so the two are checkable against each other.
5. Prefer the engine's own numbers when they are available: `/cost` shows what
   Claude Code totalled, and `/context` breaks down the window by category.
   Quote those rather than your own arithmetic when they print.

## Output

Band line, one line:

```
☂ Showers 67%  133k/200k  ▁▂▂▄▄▅▅▆▆▇▇█  ▲+133k  in 15k/out 6.1k  Σ 150k/35k  est $1.22
```

- Weather for how full the window is: `<25% ☀ Clear`, `25–49% ☁ Cloudy`,
  `50–74% ☂ Showers`, `75–89% ☇ Storm`, `≥90% ↯ Compact soon`.
- Sparkline: the last 12 turns, one bar each, scaled to the tallest
  (`▁▂▃▄▅▆▇█`).
- `▲+…` what the last turn added; `in/out` that turn's tokens; `Σ` the session
  totals; `est` the estimated session cost.

Then, only if the user wants the detail, a short ledger: turn number, what it
added, in, out, cache read/write, and cost for that turn.

Write numbers compactly (`133k`, `$1.22`) and keep the band to one line.

## Plan limits

Subscription accounts also have a rolling 5-hour session window and a weekly
cap, drawn from one shared pool across the app and the CLI. If the user asks
about limits, say what `/usage` reports for their account; if it reports none
(API-key billing), say there is no window to show rather than inventing one.
