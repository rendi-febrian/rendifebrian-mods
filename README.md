# rendifebrian-mods

A Claude Code plugin marketplace.

| Plugin | What it does |
|---|---|
| [`cc-context-bar`](./cc-context-bar) | Context bar above the prompt: context length, tokens in/out, sparkline of the last 12 turns, last turn's tokens, estimated cost, and the account's plan limits (only when the account reports them). Adds `/context-bar` for a detailed pane. |

## Install

In a Claude Code session (v2.1.287 or later — mods are on by default):

```
/plugin marketplace add rendi-febrian/rendifebrian-mods
/plugin install cc-context-bar@rendifebrian-mods
/reload-plugins
```

Or from your shell:

```bash
claude plugin marketplace add rendi-febrian/rendifebrian-mods
claude plugin install cc-context-bar@rendifebrian-mods
```

The install id is the entry's `name`, an `@`, and the marketplace `name` —
so `cc-context-bar@rendifebrian-mods`. Install scope (`user` / `project` /
`local`) is chosen during install. Third-party marketplaces have auto-update off
by default: `/plugin` → **Marketplaces** → select this one → **Enable auto-update**.

## What a mod is

A plugin whose behaviour lives in a JavaScript hooks module. Claude Code calls
the module's functions on session events — including `ui.render`, which is how a
mod draws: the band above the prompt, panes, and rows it replaces. A mod runs
inside Claude Code with your permissions, so review one before installing it:
`claude plugin validate <plugin-dir>` lists every event it hooks and every call
it makes, without running it.

## Layout

```
.claude-plugin/marketplace.json   the catalog
cc-context-bar/                   the plugin (its own .claude-plugin/plugin.json)
LICENSE
```

To publish a second plugin, add a folder beside `cc-context-bar/` and an entry to
the `plugins` array with `"source": "./<folder>"` whose `name` matches that
folder's `plugin.json`.
