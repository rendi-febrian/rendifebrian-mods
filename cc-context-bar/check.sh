#!/usr/bin/env bash
# Check the mod's plugin wiring without a Claude Code session:
# manifests parse, hooks.json points at a file that exists, and the module
# exports register(on, options).
set -euo pipefail
cd "$(dirname "$0")"

fail=0
say() { printf '%-46s %s\n' "$1" "$2"; }

if command -v jq >/dev/null; then J() { jq -r "$1" "$2"; }
else J() { python3 -c "import json,sys;d=json.load(open(sys.argv[2]));print(eval(sys.argv[1]))" "$1" "$2"; }
fi

node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8'))" \
  && say "plugin.json parses" "ok" || { say "plugin.json parses" "FAIL"; fail=1; }
node -e "JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8'))" \
  && say "hooks.json parses" "ok" || { say "hooks.json parses" "FAIL"; fail=1; }

name=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json','utf8')).name)")
[ "$name" = "$(basename "$PWD")" ] && say "folder name == plugin name ($name)" "ok" \
  || { say "folder name == plugin name" "FAIL ($name)"; fail=1; }

mod=$(node -e "console.log(JSON.parse(require('fs').readFileSync('hooks/hooks.json','utf8')).modules[0])")
mod="${mod#./}"
[ -f "hooks/$mod" ] && say "hooks module exists (hooks/$mod)" "ok" \
  || { say "hooks module exists" "FAIL (hooks/$mod)"; fail=1; }

node --input-type=module -e "
import('./hooks/$mod').then(m => {
  if (typeof m.register !== 'function') { console.error('no register export'); process.exit(1) }
})" && say "module exports register()" "ok" || { say "module exports register()" "FAIL"; fail=1; }

node --check hooks/$mod 2>/dev/null && say "syntax" "ok" || { say "syntax" "FAIL"; fail=1; }

node test/run.mjs --json > /tmp/cc-context-bar-test.json 2>/tmp/cc-context-bar-test.err \
  && say "harness: trees validate" "ok" \
  || { say "harness: trees validate" "FAIL"; sed -n '1,20p' /tmp/cc-context-bar-test.err; fail=1; }

echo
if [ "$fail" = 0 ]; then echo "all checks passed"; else echo "checks failed"; fi
exit $fail
