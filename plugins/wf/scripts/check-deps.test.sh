#!/usr/bin/env bash
# Tests for check-deps.sh. Run: scripts/check-deps.test.sh
# Each case points HOME at a throwaway directory, so what is "installed" is whatever the case put there.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-deps.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0 fail=0

# A home that satisfies every required plugin except the ones named in installed_plugins.json.
home_with() { # <name> <installed-plugin-key...>
  local home="$TMP/$1"; shift
  mkdir -p "$home/.claude/plugins/marketplaces/claude-plugins-official" \
           "$home/.claude/plugins/marketplaces/beads-marketplace"
  { printf '{"version":2,"plugins":{'; local sep=""
    for key in "$@"; do printf '%s"%s":[{"scope":"user"}]' "$sep" "$key"; sep=","; done
    printf '}}\n'; } > "$home/.claude/plugins/installed_plugins.json"
  printf '%s' "$home"
}

# run <name> <home> <expected-exit> <expected-substring>
run() {
  local name="$1" home="$2" want_code="$3" want_out="$4" out code
  out="$(HOME="$home" "$SCRIPT" 2>&1)"; code=$?
  if [ "$code" != "$want_code" ]; then
    echo "FAIL $name — exit $code, want $want_code"; echo "$out" | sed 's/^/      /'; fail=$((fail+1)); return
  fi
  if ! printf '%s' "$out" | grep -qF -- "$want_out"; then
    echo "FAIL $name — output lacks '$want_out'"; echo "$out" | sed 's/^/      /'; fail=$((fail+1)); return
  fi
  pass=$((pass+1))
}

run "long-run installed passes"        "$(home_with has long-run@aydenden-plugins)"  0 "✓ long-run"
run "long-run missing is required"     "$(home_with lacks wf@aydenden-plugins)"      1 "✗ long-run"
# The marketplace name is the installer's choice; only the plugin name is ours.
run "any marketplace name counts"      "$(home_with other long-run@somewhere-else)"  0 "✓ long-run"
# A plugin whose name merely ends in long-run is a different plugin.
run "a longer name does not count"     "$(home_with near not-long-run@aydenden-plugins)" 1 "✗ long-run"

echo "check-deps.test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
