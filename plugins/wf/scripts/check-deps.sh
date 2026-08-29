#!/usr/bin/env bash
# Report which wf dependencies are present and how to install the ones that are not.
# Run before designing a workflow: a missing tool changes what the workflow can contain,
# and finding out at generation time is cheaper than finding out at run time.
# Usage: check-deps.sh
# Exit:  0 all required present · 1 a required dependency is missing
set -uo pipefail

SKILL_DIRS=("$HOME/.agents/skills" "$HOME/.claude/skills")
MARKET_DIR="$HOME/.claude/plugins/marketplaces"
missing_required=0

have_cmd()   { command -v "$1" >/dev/null 2>&1; }
have_skill() { for d in "${SKILL_DIRS[@]}"; do [ -e "$d/$1" ] && return 0; done; return 1; }
have_market(){ [ -d "$MARKET_DIR/$1" ]; }

row() { # status label install-hint
  case "$1" in
    ok)   printf '  ✓ %s\n' "$2" ;;
    req)  printf '  ✗ %s — 필수\n      설치: %s\n' "$2" "$3"; missing_required=$((missing_required+1)) ;;
    opt)  printf '  · %s — 없음 (해당 단계를 넣을 수 없다)\n      설치: %s\n' "$2" "$3" ;;
  esac
}

echo "필수 도구"
have_cmd bd  && row ok "bd (beads)"  || row req "bd (beads)"  "brew install beads"
have_cmd git && row ok "git"         || row req "git"         "brew install git"

echo
echo "필수 플러그인"
have_market claude-plugins-official && row ok "plugin-dev (create-plugin 인계 대상)" \
  || row req "plugin-dev" "/plugin marketplace add anthropics/claude-plugins-official → plugin-dev 설치"
have_market beads-marketplace && row ok "beads 플러그인 (SessionStart bd prime 훅)" \
  || row req "beads 플러그인" "/plugin marketplace add steveyegge/beads → beads 설치"

echo
echo "조건부 도구 — 없으면 해당 단계를 설계에서 뺀다"
have_cmd orca          && row ok "orca (세션 스폰·워크트리)"   || row opt "orca"          "brew install --cask orca"
have_cmd agent-browser && row ok "agent-browser (웹 검증)"     || row opt "agent-browser" "brew install agent-browser"
have_cmd npx           && row ok "npx (스킬 레지스트리 조사)"  || row opt "npx"           "brew install node"

echo
echo "위임 대상 스킬 — 없으면 그 판단을 대신할 스킬을 조사해야 한다"
for s in grill-with-docs to-prd to-issues implement tdd code-review \
         diagnosing-bugs triage handoff prototype wayfinder domain-modeling research; do
  if have_skill "$s"; then printf '  ✓ %s\n' "$s"
  else printf '  · %s — 없음 → npx skills add mattpocock/skills@%s\n' "$s" "$s"; fi
done

echo
if [ "$missing_required" -gt 0 ]; then
  echo "필수 항목 $missing_required개가 없다. 설계를 진행하면 생성된 워크플로우가 실행되지 않는다."
  exit 1
fi
echo "필수 항목 충족. 조건부 항목의 유무는 어떤 단계를 넣을 수 있는지를 바꾼다."
