# rendifebrian-mods

A Claude Code plugin marketplace. Adding this directory (or a git repo holding
it) registers the marketplace; the plugins inside install from it.

```
.claude-plugin/marketplace.json   the catalog
cc-context-bar/                   a mod: context bar above the prompt
```

## What's here

| Plugin | What it does |
|---|---|
| `cc-context-bar` | Context bar above the prompt: context length, tokens in/out, sparkline, estimated cost, plan limits. Also `/context-bar` for a detailed pane. |

## Layout note

This marketplace root holds the plugin directory itself. To publish it, put the
repository that contains this folder on GitHub and add it with
`/plugin marketplace add <owner>/<repo>`; if the marketplace lives in a
subdirectory of a repo, use `{"source": "git-subdir", "url": "...", "path": "..."}`
as the plugin's source instead of the relative path.
