#!/usr/bin/env bash
# Tests for check-deps.sh. Run: scripts/check-deps.test.sh
# Each case points HOME at a throwaway directory, so what is "installed" is whatever the case put there.
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-deps.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0 fail=0

# A home whose installed_plugins.json lists exactly the given keys. The marketplace directories are
# always there: adding a marketplace is not installing a plugin, so they must not count.
home_with() { # <name> <installed-plugin-key...>
  local home="$TMP/$1"; shift
  mkdir -p "$home/.claude/plugins/marketplaces/claude-plugins-official" \
           "$home/.claude/plugins/marketplaces/beads-marketplace"
  { printf '{"version":2,"plugins":{'; local sep=""
    for key in "$@"; do printf '%s"%s":[{"scope":"user"}]' "$sep" "$key"; sep=","; done
    printf '}}\n'; } > "$home/.claude/plugins/installed_plugins.json"
  printf '%s' "$home"
}
PD=plugin-dev@claude-plugins-official BD=beads@beads-marketplace LR=long-run@aydenden-plugins

# A PATH holding only what the script itself needs plus the given commands, so a case can take one
# tool away without depending on what the machine has installed.
path_with() { # <name> <command...>
  local bin="$TMP/bin-$1" cmd; shift
  mkdir -p "$bin"
  for cmd in bash grep "$@"; do ln -s "$(command -v "$cmd")" "$bin/$cmd"; done
  printf '%s' "$bin"
}

# run <name> <home> <expected-exit> <expected-substring> [PATH]
run() {
  local name="$1" home="$2" want_code="$3" want_out="$4" out code
  out="$(HOME="$home" PATH="${5:-$PATH}" "$SCRIPT" 2>&1)"; code=$?
  if [ "$code" != "$want_code" ]; then
    echo "FAIL $name — exit $code, want $want_code"; echo "$out" | sed 's/^/      /'; fail=$((fail+1)); return
  fi
  if ! printf '%s' "$out" | grep -qF -- "$want_out"; then
    echo "FAIL $name — output lacks '$want_out'"; echo "$out" | sed 's/^/      /'; fail=$((fail+1)); return
  fi
  pass=$((pass+1))
}

run "all three installed passes"      "$(home_with has "$PD" "$BD" "$LR")"                 0 "✓ long-run"
run "long-run missing is required"    "$(home_with lacks "$PD" "$BD" wf@aydenden-plugins)" 1 "✗ long-run"
# The marketplace name is the installer's choice; only the plugin name is ours.
run "any marketplace name counts"     "$(home_with other plugin-dev@a beads@b long-run@c)" 0 "✓ long-run"
# A plugin whose name merely ends in long-run is a different plugin.
run "a longer name does not count"    "$(home_with near "$PD" "$BD" not-long-run@aydenden-plugins)" 1 "✗ long-run"

run "plugin-dev installed is ok"      "$(home_with pd-has "$PD" "$BD" "$LR")"              0 "✓ plugin-dev"
run "plugin-dev missing is required"  "$(home_with pd-lacks "$BD" "$LR")"                  1 "✗ plugin-dev"
run "beads plugin installed is ok"    "$(home_with bd-has "$PD" "$BD" "$LR")"              0 "✓ beads"
run "beads plugin missing is required" "$(home_with bd-lacks "$PD" "$LR")"                 1 "✗ beads"
# The marketplace directories exist in every case above; with no install record nothing is installed.
run "marketplace alone is not installed" "$(home_with market-only)"                         1 "필수 항목 3개가 없다"

# The hooks of every generated plugin run on node; without it the workflow's checks cannot run.
run "node present is ok"              "$(home_with node-has "$PD" "$BD" "$LR")"            0 "✓ node" "$(path_with node-has bd git node)"
run "node missing is required"        "$(home_with node-lacks "$PD" "$BD" "$LR")"          1 "✗ node" "$(path_with node-lacks bd git)"

echo "check-deps.test: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
