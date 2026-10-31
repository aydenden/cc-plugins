/**
 * 질문 게이트의 순수 로직 — 사람의 답을 기다리는 동안 이 도구 호출을 거부할 것인가.
 *
 * 가드(`guard-core.mjs`)는 멈춤만 본다. 멈추지 않고 그대로 진행하면 아무도 막지 못한다 — `bd update --claim`
 * 은 막힌 티켓도 잡아 주고, `bd human respond` 는 누가 불러도 닫힌다(둘 다 실측). 그래서 PreToolUse 에서 막는다.
 * 공식 문서상 이 거부는 `bypassPermissions` 에서도 선다.
 *
 * 🚨 이것은 실수를 막는 장치이지 샌드박스가 아니다. 셸 스크립트나 `sed -i` 로 고치는 것은 잡지 못한다.
 */

import { isWaiting, QUESTION_LABEL } from './guard-core.mjs';

/** 셸 명령을 단어 묶음으로 가른다. 따옴표 안의 구분자는 단어의 일부다. */
export function shellSegments(command) {
  const segments = [[]];
  let word = null;
  let quote = null;
  const endWord = () => {
    if (word !== null) segments.at(-1).push(word);
    word = null;
  };
  const text = String(command ?? '');
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < text.length) word += text[(i += 1)];
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      word ??= '';
    } else if (c === '\\' && i + 1 < text.length) {
      word = (word ?? '') + text[(i += 1)];
    } else if (';|&()\n'.includes(c)) {
      endWord();
      if (segments.at(-1).length) segments.push([]);
    } else if (/\s/.test(c)) {
      endWord();
    } else {
      word = (word ?? '') + c;
    }
  }
  endWord();
  return segments.filter((s) => s.length);
}

const VALUE_FLAGS = new Set(['-C', '--directory', '--db', '--database', '--actor']);

/** 묶음이 그 프로그램의 호출이면 전역 옵션을 뺀 인자를 돌려준다. */
function argsOf(segment, program) {
  let i = 0;
  while (i < segment.length && (/^\w+=/.test(segment[i]) || ['command', 'env', 'sudo', 'exec'].includes(segment[i]))) i += 1;
  const name = String(segment[i] ?? '').split(/[\\/]/).pop();
  if (name !== program && name !== `${program}.exe`) return null;
  const rest = segment.slice(i + 1);
  while (rest[0]?.startsWith('-')) rest.splice(0, VALUE_FLAGS.has(rest[0]) ? 2 : 1);
  return rest;
}

/** 이 명령의 `bd` 호출들. */
export const bdCalls = (command) => shellSegments(command).map((s) => argsOf(s, 'bd')).filter(Boolean);

const isGitWrite = (segment) => ['commit', 'push'].includes(argsOf(segment, 'git')?.[0]);

/** 게이트가 판정할 명령인가. 아니면 bd 를 부르지 않고 통과시킨다 — 도구 호출마다 13초를 쓸 수 없다. */
export function needsGate(command) {
  if (shellSegments(command).some(isGitWrite)) return true;
  return bdCalls(command).some(([sub, ...rest]) => ['close', 'update', 'human', 'delete', 'dep', 'label'].includes(sub) || (sub === 'ready' && rest.includes('--claim')));
}

/** 이 명령이 그 맵을 닫는가. */
export const closesEpic = (command, epic) => bdCalls(command).some(([sub, ...rest]) => sub === 'close' && rest.includes(epic));

const hasFlag = (words, flag) => words.some((w) => w === flag || w.startsWith(`${flag}=`));
const flagValue = (words, flag) => {
  const at = words.findIndex((w) => w === flag || w.startsWith(`${flag}=`));
  if (at < 0) return null;
  return words[at].includes('=') ? words[at].split('=')[1] : words[at + 1];
};

const ANSWER_ROUTE =
  '사람이 답했으면 `frontier-guard.mjs answer <질문> --quote "<사람이 친 원문>" --answer "<뜻>"`, 위임 중이면 `frontier-guard.mjs delegate-answer <질문> --choice … --cite … --why …` 로 닫는다';

/** `bd` 호출 하나의 거부 사유. */
function denyBdCall([sub, ...rest], { frontier, hasReceiptSince }) {
  const asked = rest.find((w) => frontier.questions.includes(w));
  const blocked = rest.filter((w) => frontier.blocked.includes(w));
  if (sub === 'human' && ['respond', 'dismiss'].includes(rest[0]) && asked) return `질문 ${asked} 은 사람의 답 없이 닫지 않는다. ${ANSWER_ROUTE}.`;
  if (sub === 'close' && asked) return `질문 ${asked} 은 사람의 답 없이 닫지 않는다. ${ANSWER_ROUTE}.`;
  if (sub === 'delete' && asked) return `질문 ${asked} 을 지워서 게이트를 풀지 않는다. ${ANSWER_ROUTE}.`;
  if (sub === 'label' && rest[0] === 'remove' && asked && rest.includes(QUESTION_LABEL)) {
    return `질문 ${asked} 의 ${QUESTION_LABEL} 라벨을 떼어 게이트를 풀지 않는다. ${ANSWER_ROUTE}.`;
  }
  if (sub === 'close' && blocked.length && hasFlag(rest, '--force')) return `${blocked.join(', ')} 는 답을 기다린다 — --force 로 닫지 않는다.`;
  if (sub === 'dep' && ['remove', 'rm'].includes(rest[0]) && asked && !hasReceiptSince(asked)) {
    return `질문 ${asked} 이후 사람의 말이 없다 — 의존을 풀어 그 답을 건너뛰지 않는다. 잘못 건 의존이면 사람에게 알린다.`;
  }
  if (sub === 'update') {
    const status = flagValue(rest, '--status') ?? flagValue(rest, '-s');
    if (asked && (hasFlag(rest, '--remove-label') || ['closed', 'done'].includes(status))) return `질문 ${asked} 을 update 로 닫지 않는다. ${ANSWER_ROUTE}.`;
    if (hasFlag(rest, '--claim') || status === 'in_progress') {
      if (asked) return `${asked} 은 사람에게 묻는 질문이라 claim 할 일이 아니다.`;
      if (blocked.length) {
        const next = frontier.unscoped?.length
          ? `범위가 없는 질문(${frontier.unscoped.join(', ')})이 맵 전체를 세웠다. 뒤로 밀어도 되면 \`bd dep add <티켓> <질문>\` 으로 범위를 적는다.`
          : '밀 수 있는 다른 티켓을 잡는다.';
        return `${blocked.join(', ')} 는 답을 기다린다 — claim 하지 않는다. ${next}`;
      }
    }
  }
  if (sub === 'ready' && hasFlag(rest, '--claim')) {
    if (frontier.pushable.length === 0) return '지금 밀 수 있는 티켓이 없다 — 질문을 모아 보고한다.';
    if (flagValue(rest, '--exclude-label') !== QUESTION_LABEL) return `\`bd ready --claim\` 은 질문 티켓을 집는다 — \`--exclude-label ${QUESTION_LABEL}\` 을 붙인다.`;
  }
  return null;
}

function waitingDenial(frontier) {
  const scope = frontier.unscoped?.length ? ` ${frontier.unscoped.join(', ')} 는 기다리는 티켓이 안 적혀 맵 전체를 세웠다 — 뒤로 밀어도 되면 \`bd dep add <티켓> <질문>\`.` : '';
  return `밀 수 있는 티켓이 없다 — 질문 ${frontier.questions.join(', ') || '(없음)'} 의 답을 기다린다. 작업을 진행하지 않고 질문을 모아 보고한다.${scope} ${ANSWER_ROUTE}.`;
}

/**
 * 이 셸 명령의 거부 사유.
 *
 * @param {{
 *   command: string,
 *   frontier: {pushable: string[], questions: string[], blocked: string[], unscoped?: string[]},
 *   inWave?: boolean,
 *   hasReceiptSince?: (questionId: string) => boolean,
 *   closeProblem?: string | null,
 * }} input `closeProblem` 은 맵을 닫기 전에 남은 일(위임 보고서). 맵을 닫는 명령일 때 호출자가 잰다
 * @returns {string | null} 통과면 `null`
 */
export function denyCommand({ command, frontier, inWave = false, hasReceiptSince = () => false, closeProblem = null }) {
  for (const call of bdCalls(command)) {
    const why = denyBdCall(call, { frontier, hasReceiptSince });
    if (why) return why;
  }
  if (closeProblem) return closeProblem;
  if (!inWave && isWaiting(frontier) && shellSegments(command).some(isGitWrite)) return waitingDenial(frontier);
  return null;
}

/**
 * 파일 쓰기의 거부 사유. worktree 밖(인계 문서·scratchpad)은 맵의 작업이 아니라 막지 않는다.
 *
 * @param {{filePath: string | undefined, worktree: string | undefined, frontier: object, inWave?: boolean}} input
 * @returns {string | null}
 */
export function denyWrite({ filePath, worktree, frontier, inWave = false }) {
  if (inWave || !filePath || !worktree || !isWaiting(frontier)) return null;
  const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  return norm(filePath).startsWith(`${norm(worktree)}/`) ? waitingDenial(frontier) : null;
}
