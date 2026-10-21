/**
 * 인계 프롬프트 — 새 세션의 첫 입력. 순수 함수라 `handoff.mjs`(import 하면 곧장 실행된다) 밖에 둔다.
 */

/**
 * 새 세션이 이어받을 맵. worktree 마커의 맵은 그 worktree 에서 **다른 세션이** 미는 맵일 수 있다 —
 * 넘기는 bd 가 그 맵 자신이거나 자손일 때만 잇고, 아니면 `null` 이다. 잇지 않는 맵을 claim 시키면
 * 새 세션이 엉뚱한 맵의 주인이 되어 그 맵을 미는 세션의 가드를 빼앗는다.
 *
 * @param {{bdId?: string, mapEpic?: string | null}} input
 * @returns {string | null}
 */
export function inheritedMap({ bdId, mapEpic }) {
  if (!mapEpic) return null;
  if (!bdId || bdId === mapEpic || bdId.startsWith(`${mapEpic}.`)) return mapEpic;
  return null;
}

/**
 * 인계 프롬프트. **한 줄이어야 한다** — `terminal send` 는 raw 바이트를 쓰므로 개행이 들어가면
 * TUI 가 그 지점에서 제출해 버린다.
 *
 * 내용의 핵심은 "문서를 읽어라"가 아니라 **"문서로 절차를 대신하지 마라"** 다. 인계 문서는 어디까지
 * 왔는지를 적은 상태 보고서지 절차서가 아니어서, 그것만 따라가면 스킬이 소유한 규약이 통째로 빠진다.
 *
 * 맵을 미는 worktree 라면 claim 이 첫 단계다. 가드는 claim 한 주인 세션만 판정하므로, 이 단계가 빠지면
 * 새 세션은 가드 없이 출발한다 — 문서가 아니라 프롬프트에 박는 이유다.
 *
 * @param {{doc: string, bdId?: string, mapEpic?: string | null, guard?: string, hold?: boolean}} input
 *   `mapEpic` 은 보내는 worktree 에 선언된 맵 id(`frontier-guard.mjs epic`), `guard` 는 그 스크립트 경로
 * @returns {string}
 */
export function buildPrompt({ doc, bdId, mapEpic, guard, hold = false }) {
  const map = inheritedMap({ bdId, mapEpic });
  const claim = map && guard ? `\`node "${guard}" claim ${map}\`` : null;
  const parts = [`[세션 인계] 이전 세션이 컨텍스트 한계에 닿아 이 작업을 너에게 통째로 넘긴다.`];
  if (claim && !hold) {
    parts.push(`0) 맵 ${map} 의 주인이 된다 — 다른 무엇보다 먼저 ${claim} 를 실행한다. 이것이 없으면 프론티어 가드가 이 세션을 판정하지 않는다.`);
  }
  parts.push(`1) Read 로 ${doc} 을 읽는다.`);
  parts.push(
    hold
      ? `2) 🚨 사용자 지시: 작업을 시작하지 않는다 — 스킬 호출·claim·수정을 하지 말고, 상태만 확인한 뒤 멈춰서 사용자 지시를 기다린다. 이어가라는 지시가 오면 그때 ${claim ? `먼저 ${claim} 를 실행하고 ` : ''}'다음 작업'의 스킬을 실제로 호출한다(문서의 요약으로 대체하지 않는다).`
      : `2) '다음 작업'이 지정한 스킬을 실제로 호출한다 — 인계 문서의 요약으로 대체하지 않는다. 문서는 상태 보고서지 절차서가 아니다.`
  );
  if (bdId) {
    parts.push(
      `3) 진행 정본은 문서가 아니라 bd 다 — \`bd show ${bdId}\` 와 \`bd children ${bdId}\` 로 열린 항목을 먼저 확인하고, 문서와 어긋나면 bd 를 따르고 사용자에게 알린다.`
    );
  }
  parts.push(`마지막으로 문서의 '완료 통보' 절에 적힌 것이 있으면 그대로 이행한다.`);
  return parts.join(' ');
}
