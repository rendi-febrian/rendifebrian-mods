# Add cc-context-bar to Claude Code

Prerequisite: **Claude Code 2.1.287 or later** — mods are on by default, nothing
to enable. Check with `claude --version`. Mods draw in the terminal and in the
**Code** tab of the Claude desktop app (hooks run, but nothing draws, in
`claude -p`, the VS Code extension, and cloud sessions).

`claude` CLI on this machine: **not installed** (no `~/.claude` yet, nothing on
`PATH`). Options: `npm install -g @anthropic-ai/claude-code`, then `claude` and
log in. The desktop app works too — its Code tab runs the same engine, so the
`/plugin` commands below work there.

---

## Option A — load it for one session, no install (fastest loop)

From your shell, in any project:

```bash
claude --plugin-dir /Users/rendifebrian/Projects/rendifebrian-mods/cc-context-bar
```

The mod loads for that session only, and saving `hooks/register.js` reloads it
in place (set `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` for non-interactive sessions).

## Option B — add the local marketplace, then install it

Inside a Claude Code session:

```
/plugin marketplace add /Users/rendifebrian/Projects/rendifebrian-mods
/plugin install cc-context-bar@rendifebrian-mods
/reload-plugins
```

`/plugin install` opens the plugin's details first; pick a scope — **user** (every
project on this machine), **project** (everyone in this repo), or **local** (you,
this repo). Local development marketplaces have auto-update off, so after an edit
run `/plugin marketplace update rendifebrian-mods` and `/reload-plugins`.

From your shell, the same install:

```bash
claude plugin marketplace add /Users/rendifebrian/Projects/rendifebrian-mods
claude plugin install cc-context-bar@rendifebrian-mods
```

## Option C — publish it, then install anywhere

```bash
cd /Users/rendifebrian/Projects/rendifebrian-mods
git init && git add -A && git commit -m "cc-context-bar mod"
git remote add origin git@github.com:<you>/rendifebrian-mods.git
git push -u origin main
```

Then, on any machine:

```
/plugin marketplace add <you>/rendifebrian-mods
/plugin install cc-context-bar@rendifebrian-mods
/reload-plugins
```

If the marketplace file lives in a subdirectory of a bigger repo, give the entry
an object source instead of the relative path,
e.g. `"source": { "source": "git-subdir", "url": "https://github.com/<you>/<repo>", "path": "rendifebrian-mods/cc-context-bar" }`.

---

## Check it loaded

- `/plugin` → a dim line under the tabs: `1 mod active · cc-context-bar`. It is
  also listed on the **Installed** tab, where you can turn it off.
- The band above the prompt shows the readout after the first turn ends.
- `/context-bar` (or typing `/context` and picking it) opens the detail pane.

## Review before trusting it

A mod runs with your permissions; it can read and write files, start processes,
and make network requests. This one starts no processes, writes nothing, and
makes no network calls — the only calls it makes are the mods API reads listed
below. Verify with Claude Code's own scanner:

```bash
claude plugin validate /Users/rendifebrian/Projects/rendifebrian-mods/cc-context-bar
```

It should print the two events hooked and calls of the shape
`session.usage`, `store.get`, `store.set`, `command.register`, `ui.*`,
`session.*` — no `fs.*`, no `process.run`, no `http.fetch`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Nothing in the band | Run `claude --debug` and look for `a hook returned a tree that does not validate`; also check `/plugin` names the mod. A band drawing taller than its `maxRows` is clamped, not refused. |
| `/context-bar` refused | The name was taken — the mod's `session.start` catches that and the band still works. Rename in `hooks/register.js` and reload. |
| Limits never show | The account reports no rate-limit windows (API-key billing). The pane says `none reported`. |
| Cost seems off | `est` uses the `PRICES` table in `hooks/register.js`; the parenthesised figure is the engine's own `/cost`. Fix rates via the mod's store entry. |
| Mod not listed at all | Mods need Claude Code ≥ 2.1.287, and `disableAllHooks: true` in `~/.claude/settings.json` stops installed mods. |
