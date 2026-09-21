/**
 * 인계 문서 머리에서 읽어내는 메타와 그 대조. 진입점(`handoff.mjs`)이 import 시점에 CLI 를 돌리므로
 * 순수 로직은 여기 따로 둔다 — 그래야 테스트가 붙는다.
 */

/** `- **worktree**: {절대경로} (브랜치 ...)` — 규약은 `skills/session-handoff/references/handoff-doc.md`. */
const WORKTREE_LINE_RE = /^[ \t]*-[ \t]*\*\*worktree\*\*[ \t]*:[ \t]*`?([A-Za-z]:[\\/][^`\s(]*|\/[^`\s(]*)/im;

/**
 * 인계 문서가 선언한 worktree 절대경로. 줄이 없으면 `null` —
 * **불일치가 아니라 대조할 근거가 없다는 뜻**이라 호출부가 갈라서 다뤄야 한다.
 *
 * @param {string} docText 인계 문서 전문
 * @returns {string|null}
 */
export function declaredWorktreePath(docText) {
  const m = WORKTREE_LINE_RE.exec(String(docText ?? ''));
  return m ? m[1] : null;
}

function norm(p) {
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * 인계 문서가 가리키는 worktree 와 실제 대상이 어긋나는지 본다.
 *
 * 이 대조가 필요한 이유는 `resolveWorktreeByCwd` 가 **실패하지 않기 때문이다** — 보내는 셸의 cwd 가
 * 작업 worktree 가 아닌 다른 등록된 worktree 에 서 있으면 조회가 조용히 성공해 엉뚱한 탭이 뜬다.
 * 새 세션이 작업 저장소 밖에서 깨어나 프로젝트 지침조차 못 읽는 실패로 실제로 드러났다.
 *
 * @param {{declared: string|null, resolved: string}} args
 * @returns {string|null} 어긋나면 사유, 같거나 선언이 없으면 null
 */
export function worktreeMismatch({ declared, resolved }) {
  if (!declared) return null;
  if (norm(declared) === norm(resolved)) return null;
  return [
    `인계 문서가 가리키는 worktree 와 대상이 다르다.`,
    `  문서: ${declared}`,
    `  대상: ${resolved}`,
    `문서의 worktree 에서 다시 보내거나, --worktree <selector> 로 직접 지정한다`,
    `(셀렉터는 \`orca worktree list --json\` 의 <repoId>::<경로> 전체 형태여야 한다).`,
    `의도한 것이면 --force-worktree 를 준다.`,
  ].join('\n');
}
