/**
 * 사람의 답과 위임 답변을 가르는 순수 로직 — 영수증, 헌장 근거, 보고서.
 *
 * ## 사람의 답
 * bd 는 누가 답했는지 모른다(작성자는 git user). 그래서 UserPromptSubmit 이 사람이 친 말을 영수증으로 남기고,
 * 질문을 닫으려면 그 질문 이후 영수증의 **원문을 인용**해야 한다. 「계속해」 를 답으로 인용하는 것까지 기계가
 * 막지는 못하지만, 인용이 bd 코멘트에 남아 감사할 수 있다.
 *
 * ## 위임
 * 사람이 「묻지 말고 진행해」 라고 하면 원문을 인용해 위임을 켠다. 위임은 **헌장의 목표대로** 푼다 — 답마다
 * Destination·완료 조건의 원문을 근거로 인용해야 하고, 인용할 줄이 없으면 그 질문은 사람 몫으로 남는다.
 * 목표를 바꾸는 길이 되지 않게, 위임을 켠 뒤 목표 절이 바뀌면 위임 답변을 거부한다.
 */

/** 영수증을 몇 개까지 두는가. */
export const MAX_RECEIPTS = 20;

/** 영수증 한 건의 최대 글자 수 — 붙여 넣은 긴 글이 파일을 불리지 않게. */
const MAX_RECEIPT_CHARS = 4000;

/** 부분 인용의 최소 글자 수. 이보다 짧으면 프롬프트 전체와 같아야 한다 — `a` 는 어느 긴 글에든 들어 있다. */
const MIN_PARTIAL_QUOTE = 8;

const squeeze = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

/**
 * 사람이 친 프롬프트인가. 인계 프롬프트와 태그로 시작하는 시스템 입력은 프로그램이 넣은 것이다.
 * 공식 hook 입력에는 출처 칸이 없어 내용으로 가른다.
 */
export function isHumanPrompt(text) {
  const t = squeeze(text);
  return t.length > 0 && !t.startsWith('[세션 인계]') && !t.startsWith('<');
}

/** 영수증을 덧붙인다. */
export function addReceipt(receipts, at, text) {
  const list = Array.isArray(receipts) ? receipts : [];
  return [...list, { at, text: String(text).slice(0, MAX_RECEIPT_CHARS) }].slice(-MAX_RECEIPTS);
}

/** 그 시각 이후의 영수증. bd 시각은 초 단위라 기준을 초로 내린다. */
export function spokeSince(receipts, since) {
  const from = since ? Math.floor(Date.parse(since) / 1000) * 1000 : -Infinity;
  return (Array.isArray(receipts) ? receipts : []).filter((r) => Date.parse(r.at) >= from);
}

/**
 * 그 인용이 그 시각 이후 사람의 말인가.
 *
 * @param {{at: string, text: string}[] | null} receipts
 * @param {string} quote
 * @param {string | null} since 질문을 만든 시각. `null` 이면 남은 영수증 전부
 * @returns {boolean}
 */
export function quoteProves(receipts, quote, since) {
  const q = squeeze(quote);
  if (!q) return false;
  return spokeSince(receipts, since).some((r) => {
    const text = squeeze(r.text);
    return text === q || ([...q].length >= MIN_PARTIAL_QUOTE && text.includes(q));
  });
}

/**
 * 헌장의 목표 — Destination 과 완료 조건 절의 본문.
 *
 * @param {string | null | undefined} description 맵(epic) 본문
 * @returns {string} 절이 없으면 빈 문자열
 */
export function charterGoalOf(description) {
  const out = [];
  let keep = false;
  for (const line of String(description ?? '').split('\n')) {
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) keep = /^(Destination|완료 조건)\s*$/.test(heading[1]);
    else if (keep) out.push(line);
  }
  return out.join('\n').trim();
}

/** 그 근거가 헌장 목표의 원문인가. 짧은 조각은 무엇이든 맞으므로 부분 인용 최소 길이를 지킨다. */
export function citesGoal(goal, cite) {
  const c = squeeze(cite);
  return [...c].length >= MIN_PARTIAL_QUOTE && squeeze(goal).includes(c);
}

const MARK = '[위임 답변]';

/** 위임 답변을 bd 코멘트 본문으로. */
export const delegatedAnswerText = ({ choice, cite, why }) => `${MARK}\n선택: ${squeeze(choice)}\n헌장 근거: ${squeeze(cite)}\n이유: ${squeeze(why)}`;

/** 코멘트 본문에서 위임 답변을 읽는다. `bd human respond` 가 앞에 `Response: ` 를 붙인다(실측). */
export function parseDelegatedAnswer(text) {
  const at = String(text ?? '').indexOf(MARK);
  if (at < 0) return null;
  const field = (name) => new RegExp(`^${name}: (.*)$`, 'm').exec(String(text).slice(at))?.[1] ?? '';
  return { choice: field('선택'), cite: field('헌장 근거'), why: field('이유') };
}

/** 위임 시작·종료를 맵에 남기는 코멘트. 마커는 맵이 닫히면 지워지므로 보고서의 근거는 bd 에 둔다. */
export const delegationStartText = (quote) => `[위임 시작] 사용자 원문: ${squeeze(quote)}`;
export const delegationEndText = () => '[위임 종료]';

/** 맵의 코멘트에서 위임 구간을 읽는다. */
export function delegationSpansOf(comments) {
  const spans = [];
  for (const c of comments ?? []) {
    const text = String(c.text ?? '');
    if (text.startsWith('[위임 시작]')) spans.push({ startedAt: c.created_at, quote: text.replace(/^\[위임 시작\] 사용자 원문: /, ''), endedAt: null });
    else if (text.startsWith('[위임 종료]') && spans.length) spans.at(-1).endedAt = c.created_at;
  }
  return spans;
}

const cell = (text) => String(text ?? '').replace(/\s+/g, ' ').replace(/\|/g, '\\|');

/**
 * 위임 보고서. 사람이 돌아와 무엇을 대신 골랐고 어디에 영향이 갔는지 한 번에 읽는 문서다.
 *
 * @param {{
 *   epic: string, title: string, goal: string, generatedAt: string,
 *   spans: {startedAt: string, endedAt: string | null, quote: string}[],
 *   decisions: {id: string, title: string, at: string, choice: string, cite: string, why: string,
 *     dependents: {id: string, title: string, status: string, closeReason?: string}[]}[],
 * }} input
 * @returns {string}
 */
export function renderDelegationReport({ epic, title, goal, generatedAt, spans, decisions }) {
  const lines = [`# 위임 보고서 — ${title} (${epic})`, '', `생성: ${generatedAt} · 위임 답변 ${decisions.length}건`, ''];
  lines.push('## 위임의 근거', '');
  if (spans.length === 0) lines.push('- 맵 코멘트에서 위임 구간을 찾지 못했다.');
  for (const s of spans) lines.push(`- ${s.startedAt} ~ ${s.endedAt ?? '맵 종료까지'} — 사용자 원문: «${s.quote}»`);
  lines.push('', '## 헌장 목표', '', goal || '(목표 절을 못 읽었다)', '', '## 대신 고른 것', '');
  lines.push('| 질문 | 선택 | 헌장 근거 | 답한 시각 |', '|---|---|---|---|');
  for (const d of decisions) lines.push(`| ${d.id} ${cell(d.title)} | ${cell(d.choice)} | ${cell(d.cite)} | ${d.at} |`);
  lines.push('', '## 결정별 상세와 영향', '');
  for (const d of decisions) {
    lines.push(`### ${d.id} — ${d.title}`, '', `- 선택: ${d.choice}`, `- 헌장 근거: ${d.cite}`, `- 이유: ${d.why}`);
    if (d.dependents.length === 0) lines.push('- 이 답을 기다린 티켓: 없음');
    else {
      lines.push('- 이 답을 기다린 티켓(되돌리면 다시 봐야 하는 곳):');
      for (const t of d.dependents) lines.push(`  - ${t.id} ${t.title} [${t.status}]${t.closeReason ? ` — ${squeeze(t.closeReason)}` : ''}`);
    }
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * 맵을 닫아도 되는가 — 위임 답변이 있으면 그 전부를 담은 보고서와, close 명령에 실린 경로가 있어야 한다.
 *
 * @param {{ids: string[], reportText: string | null, reportPath: string, command: string}} input
 * @returns {string | null} 남은 일. 없으면 `null`
 */
export function closeProblemOf({ ids, reportText, reportPath, command }) {
  if (ids.length === 0) return null;
  const missing = ids.filter((id) => !String(reportText ?? '').includes(id));
  if (missing.length) {
    return `위임 답변 ${missing.join(', ')} 이 보고서에 없다 — \`frontier-guard.mjs delegation-report\` 로 ${reportPath} 를 만든 뒤 맵을 닫는다.`;
  }
  if (!String(command).includes(reportPath)) {
    return `맵의 close reason 에 위임 보고서 경로(${reportPath})를 싣는다 — 사람이 맵에서 바로 찾아 읽어야 한다.`;
  }
  return null;
}
