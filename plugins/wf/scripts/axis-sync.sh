#!/usr/bin/env bash
# Sync the domain axis library kept under a custom ref on the plugin repository.
#
# The data lives at refs/wf/axes on the remote, outside refs/heads and refs/tags. Verified
# against GitHub: the push is accepted, the ref is absent from `ls-remote --heads` and from the
# web branch list, and a default clone or fetch does not bring it down. Only a caller that names
# the refspec sees it, so plugin releases on main and axis data never meet.
#
# The local store is an ordinary repository with a working tree, so the files can be read and
# edited by hand; only the remote side is hidden.
#
# The store lives outside the plugin directory on purpose: the install cache is
# ~/.claude/plugins/cache/<owner>/<plugin>/<version>/, so anything kept inside the plugin is
# orphaned on every version bump. Axes must survive updates.
#
# Exit: 0 ok · 1 failure · 2 bad usage
set -uo pipefail

STORE="${WF_AXIS_STORE:-$HOME/.cache/wf/axis-store}"
REMOTE="${WF_AXIS_REMOTE:-https://github.com/aydenden/cc-plugins.git}"
REF="${WF_AXIS_REF:-refs/wf/axes}"
BRANCH=axes   # local branch name inside the store; the remote side is $REF
TEMPLATES="$(cd "$(dirname "${BASH_SOURCE[0]}")/../templates/axis-store" && pwd)"

usage() {
  cat <<'USAGE'
usage: axis-sync.sh <command> [args]
  path                  print the local store path
  pull                  create or fast-forward the store from the remote ref
  list                  list the domains the store holds
  show <domain>         print one domain file as stored
  resolve <domain>      print the domain with `extends` merged in (child wins on id)
  ids <domain>          print resolved axis ids, one per line (feeds check-coverage.sh)
  retired <domain>      print retired axis ids and why they were dropped
  push "<message>"      commit local store changes and publish them to the ref
  init                  seed the store and create the ref (first time only)
USAGE
}

die() { echo "axis-sync: $*" >&2; exit 1; }
in_store() { git -C "$STORE" "$@"; }
have_store() { [ -d "$STORE/.git" ]; }
require_store() { have_store || die "store not found at $STORE — run: axis-sync.sh pull"; }
require_jq() { command -v jq >/dev/null 2>&1 || die "$1 requires jq — brew install jq"; }

domain_file() {
  require_store
  local f="$STORE/axes/$1.json"
  [ -f "$f" ] || die "no such domain: $1 (see: axis-sync.sh list)"
  echo "$f"
}

remote_has_ref() { git ls-remote --exit-code "$REMOTE" "$REF" >/dev/null 2>&1; }

cmd_pull() {
  remote_has_ref || die "$REF does not exist on $REMOTE — run: axis-sync.sh init"
  if ! have_store; then
    mkdir -p "$STORE" || die "cannot create $STORE"
    in_store init --quiet || die "init failed"
    in_store remote add origin "$REMOTE" || die "remote add failed"
  fi
  in_store fetch --quiet origin "+$REF:refs/remotes/origin/$BRANCH" || die "fetch failed"
  if in_store rev-parse --verify --quiet "$BRANCH" >/dev/null; then
    if [ -n "$(in_store status --porcelain)" ]; then
      echo "axis-sync: local changes present, not fast-forwarding. Publish them with: axis-sync.sh push \"<message>\""
      in_store status --short
      return 1
    fi
    in_store merge --ff-only "refs/remotes/origin/$BRANCH" >/dev/null 2>&1 \
      || die "local store and the remote ref diverged — resolve by hand in $STORE"
  else
    in_store checkout --quiet -b "$BRANCH" "refs/remotes/origin/$BRANCH" || die "checkout failed"
  fi
  echo "axis-sync: store up to date at $STORE ($(ls "$STORE"/axes/[!_]*.json 2>/dev/null | wc -l | tr -d ' ') domains)"
}

cmd_list() {
  require_store
  local found=0 name
  for f in "$STORE"/axes/*.json; do
    [ -e "$f" ] || break
    name="$(basename "$f" .json)"
    case "$name" in _*) continue ;; esac   # _schema.json is not a domain
    found=1
    if command -v jq >/dev/null 2>&1; then
      printf '  %-18s %s\n' "$name" "$(jq -r '.description // ""' "$f")"
    else
      printf '  %s\n' "$name"
    fi
  done
  [ "$found" -eq 1 ] || echo "axis-sync: no domains yet"
}

cmd_show() {
  [ $# -eq 1 ] || die "usage: axis-sync.sh show <domain>"
  local f; f="$(domain_file "$1")" || exit 1
  cat "$f"
}

# Merges `extends` one level. jq preserves key insertion order, so parent axes keep their
# position and a child redefinition of the same id replaces the parent's entry in place.
cmd_resolve() {
  [ $# -eq 1 ] || die "usage: axis-sync.sh resolve <domain>"
  require_jq resolve
  local f files=() parent pf
  f="$(domain_file "$1")" || exit 1
  for parent in $(jq -r '.extends[]? // empty' "$f"); do
    pf="$STORE/axes/$parent.json"
    [ -f "$pf" ] || die "$1 extends '$parent' which does not exist"
    files+=("$pf")
  done
  files+=("$f")
  jq -s '
    (.[-1]) as $child
    | { schema: ($child.schema // 1),
        domain: $child.domain,
        description: $child.description,
        axes: ([.[] | .axes[]] | reduce .[] as $a ({}; .[$a.id] = $a) | [.[]]),
        retired: ([.[] | .retired[]? ] | reduce .[] as $r ({}; .[$r.id] = $r) | [.[]]) }
  ' "${files[@]}"
}

cmd_ids() {
  [ $# -eq 1 ] || die "usage: axis-sync.sh ids <domain>"
  require_jq ids
  cmd_resolve "$1" | jq -r '.axes[].id'
}

# Read before adding an axis: an axis dropped once for a reason should not quietly return.
cmd_retired() {
  [ $# -eq 1 ] || die "usage: axis-sync.sh retired <domain>"
  require_jq retired
  cmd_resolve "$1" | jq -r '.retired[]? | "  \(.id) — \(.retired_by)"'
}

cmd_push() {
  [ $# -eq 1 ] || die "usage: axis-sync.sh push \"<message>\""
  require_store
  if [ -n "$(in_store status --porcelain)" ]; then
    in_store add -A || die "add failed"
    in_store commit --quiet -m "$1" || die "commit failed"
  elif [ "$(in_store rev-parse HEAD)" = "$(in_store rev-parse "refs/remotes/origin/$BRANCH" 2>/dev/null)" ]; then
    echo "axis-sync: nothing to push"; return 0
  fi
  if ! in_store push --quiet origin "HEAD:$REF"; then
    echo "axis-sync: push rejected — the ref moved. Run: git -C \"$STORE\" pull --rebase origin \"$REF\"" >&2
    return 1
  fi
  in_store fetch --quiet origin "+$REF:refs/remotes/origin/$BRANCH"
  echo "axis-sync: published to $REF"
}

# One-time bootstrap. Builds the store from the templates shipped with the plugin and leaves
# publishing to the caller — this writes to the remote, so it is never implicit.
cmd_init() {
  have_store && die "store already exists at $STORE — run: axis-sync.sh pull"
  remote_has_ref && die "$REF already exists on $REMOTE — run: axis-sync.sh pull"
  [ -d "$TEMPLATES" ] || die "templates not found at $TEMPLATES"
  mkdir -p "$STORE/axes" || die "cannot create $STORE"
  in_store init --quiet --initial-branch="$BRANCH" || die "init failed"
  in_store remote add origin "$REMOTE" || die "remote add failed"
  cp "$TEMPLATES/README.md" "$STORE/README.md"
  cp "$TEMPLATES/_schema.json" "$STORE/axes/_schema.json"
  local f
  for f in "$TEMPLATES"/*.axes.json; do
    [ -e "$f" ] || break
    cp "$f" "$STORE/axes/$(basename "$f" .axes.json).json"
  done
  in_store add -A || die "add failed"
  in_store commit --quiet -m "chore(axis): seed the domain axis store" || die "commit failed"
  echo "axis-sync: store seeded at $STORE ($(ls "$STORE"/axes/[!_]*.json 2>/dev/null | wc -l | tr -d ' ') domains)"
  echo "  publish it:  axis-sync.sh push  # or: git -C \"$STORE\" push origin \"HEAD:$REF\""
}

[ $# -ge 1 ] || { usage; exit 2; }
cmd="$1"; shift
case "$cmd" in
  path)    echo "$STORE" ;;
  pull)    cmd_pull    "$@" ;;
  list)    cmd_list    "$@" ;;
  show)    cmd_show    "$@" ;;
  resolve) cmd_resolve "$@" ;;
  ids)     cmd_ids     "$@" ;;
  retired) cmd_retired "$@" ;;
  push)    cmd_push    "$@" ;;
  init)    cmd_init    "$@" ;;
  -h|--help|help) usage ;;
  *) die "unknown command: $cmd" ;;
esac
