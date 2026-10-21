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

// --- §0 사용자 원칙에 섞인 교훈 ---

const SECTION_HEAD_RE = /^##\s/;
/** 제목에 「원칙」이 있어야 §0 이다 — 0번 절을 「먼저 읽을 것」 같은 다른 뜻으로 쓴 문서도 있다. */
const PRINCIPLES_HEAD_RE = /^##\s*0[.\s].*원칙/;
/**
 * 작업 중 얻은 지식의 표지 — 실측을 근거로 **인용**하거나(괄호 속·`✅ 실측`·`실측:`·`인계 NN 실측`),
 * 인계가 교훈을 덧댄 꼴이거나, 원칙 밑에 매단 해설. 「실측」이라는 낱말만으로는 잡지 않는다 —
 * 「실측이 아니라는 점은…」 같은 원칙 문장에도 들어간다.
 */
const LESSON_RE = /[(（][^)）]*실측[^)）]*[)）]|✅\s*\**\s*실측|실측\s*[(:：]|인계\s*\d+[^.。]*실측|인계\s*\d+\s*(이|가)\s*한\s*줄\s*더한다|원칙\s*[\d·,\s]+의\s*단서/;
/** 사용자에게서 온 줄의 표지. 인계 번호를 들어도 이 표지가 있으면 원칙이다. */
const USER_SOURCE_RE = /사용자\s*(지시|결정|지적|합의)/;
const HANDOFF_LOG_HEAD_RE = /^#{3,}\s*인계\s*\d/;
const NO_NEW_DIRECTIVE_RE = /새\s*(사용자\s*)?지시\s*(가\s*)?없(음|다)/;
const LIST_LIMIT = 8;

/** §0 안의 줄 중 `matches` 가 참인 것. 1-based 줄 번호를 붙인다. */
function linesInPrinciples(docText, matches) {
  const found = [];
  let inPrinciples = false;
  String(docText ?? '')
    .split(/\r?\n/)
    .forEach((text, i) => {
      if (SECTION_HEAD_RE.test(text)) {
        inPrinciples = PRINCIPLES_HEAD_RE.test(text);
        return;
      }
      if (inPrinciples && matches(text)) found.push({ line: i + 1, text: text.trim() });
    });
  return found;
}

/**
 * 인계 문서 §0(사용자 원칙) 안에서 원칙이 아니라 교훈으로 보이는 줄.
 *
 * §0 은 인계마다 통째로 복사되므로 거기 들어간 교훈은 다시 나가지 않고 사슬을 따라 누적된다.
 * 교훈의 제자리는 소유 스킬의 references 라 스킬을 부르면 읽히고, 인계는 반영했다는 한 줄만 들면 된다.
 *
 * @param {string} docText 인계 문서 전문
 * @returns {{line: number, text: string}[]}
 */
export function lessonsInPrinciples(docText) {
  return linesInPrinciples(docText, (text) => LESSON_RE.test(text) && !USER_SOURCE_RE.test(text));
}

/**
 * 인계 문서 §0 을 인계 번호별 이력으로 쓴 줄 — `### 인계 NN …` 소절과 「새 지시 없음」.
 *
 * 사용자 발언이라 교훈 검사는 통과하지만, 이 꼴은 인계마다 소절이 하나씩 붙어 끝난 한 번짜리 지시까지
 * 사슬을 따라 불어난다. §0 은 이력이 아니라 **지금 유효한 원칙의 목록**이어야 매 인계에서 다시 묶이며 줄어든다.
 *
 * @param {string} docText 인계 문서 전문
 * @returns {{line: number, text: string}[]}
 */
export function handoffLogInPrinciples(docText) {
  return linesInPrinciples(docText, (text) => HANDOFF_LOG_HEAD_RE.test(text) || NO_NEW_DIRECTIVE_RE.test(text));
}

function listLines(found) {
  const shown = found.slice(0, LIST_LIMIT).map((f) => `  ${f.line}: ${f.text.slice(0, 100)}`);
  if (found.length > LIST_LIMIT) shown.push(`  … 외 ${found.length - LIST_LIMIT}줄`);
  return shown;
}

/**
 * §0 에 교훈이 섞였거나 §0 을 인계 이력으로 썼으면 보내기를 막을 사유. 크기로는 막지 않는다 —
 * 크기로 막으면 쓰는 세션이 무엇을 버릴지 고르게 되어 필요한 인계가 빠진다. 여기서 막는 것은
 * **자리나 모양이 틀린 줄**뿐이고, 옮기거나 다시 묶으면 유효한 정보는 그대로 남는다.
 *
 * @param {string} docText 인계 문서 전문
 * @returns {string|null} 위반이 있으면 사유, 아니면 null
 */
export function principleSectionViolation(docText) {
  const reasons = [];
  const lessons = lessonsInPrinciples(docText);
  if (lessons.length) {
    reasons.push(
      `인계 문서 §0(사용자 원칙)에 교훈으로 보이는 줄이 ${lessons.length}개 있다.`,
      ...listLines(lessons),
      `§0 은 인계마다 통째로 복사되므로 교훈이 들어가면 사슬을 따라 계속 불어난다.`,
      `교훈은 소유 스킬의 references(또는 CLAUDE.md)로 옮기고, §3 에 「어디에 반영했다」 한 줄만 남긴다.`,
      `사용자가 준 원칙인데 걸렸다면 그 줄에 출처를 붙인다 — (사용자 지시 YYYY-MM-DD) 또는 (사용자 결정 …).`
    );
  }
  const log = handoffLogInPrinciples(docText);
  if (log.length) {
    reasons.push(
      `인계 문서 §0 을 인계 번호별 이력으로 쓴 줄이 ${log.length}개 있다.`,
      ...listLines(log),
      `§0 은 이력이 아니라 지금 유효한 원칙의 목록이다 — 인계 번호가 아니라 주제로 다시 묶는다.`,
      `끝난 한 번짜리 지시·「새 지시 없음」·헌장이나 CLAUDE.md 에 이미 있는 규약은 빼고, 인계 번호는 원칙 줄의 출처 괄호에만 남긴다.`
    );
  }
  return reasons.length ? reasons.join('\n') : null;
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
