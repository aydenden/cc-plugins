import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addReceipt,
  charterGoalOf,
  citesGoal,
  closeProblemOf,
  delegatedAnswerText,
  delegationSpansOf,
  delegationStartText,
  isHumanPrompt,
  MAX_RECEIPTS,
  parseDelegatedAnswer,
  quoteProves,
  receiptTextsOf,
  renderDelegationReport,
  spokeSince,
} from '../lib/delegation.mjs';

const T0 = '2026-10-31T10:00:00.000Z';
const T1 = '2026-10-31T11:00:00.000Z';
const receipts = [{ at: T1, text: 'a' }, { at: T1, text: '잘거라서 크게 이슈 없으면 맵 진행해' }];

const CHARTER = `## Destination

결제 모듈이 새 API 로 동작한다.

## 완료 조건

- 전 스위트가 초록이다

## 확정된 결정

- 옛 API 를 지운다
`;

test('인계 프롬프트와 시스템 입력은 사람의 말이 아니다', () => {
  assert.equal(isHumanPrompt('a'), true);
  assert.equal(isHumanPrompt('[세션 인계] 이전 세션이…'), false);
  assert.equal(isHumanPrompt('<task-notification>'), false);
  assert.equal(isHumanPrompt('   '), false);
});

// --- 영수증의 출처 ---

const ASKED = 'ait-1.30 배너 칸 코드를 어떻게 할까요?';

test('사람이 친 프롬프트는 그대로 영수증이 되고, 프로그램이 넣은 입력은 안 된다', () => {
  assert.deepEqual(receiptTextsOf({ hook_event_name: 'UserPromptSubmit', prompt: '140 a' }), ['140 a']);
  assert.deepEqual(receiptTextsOf({ hook_event_name: 'UserPromptSubmit', prompt: '[세션 인계] 이어받아라' }), []);
});

test('🚨 AskUserQuestion 의 답도 사람의 말이다 — 고른 답 하나가 영수증 하나다(세션 기록 5건이 이것으로 거부됐다)', () => {
  const input = {
    hook_event_name: 'PostToolUse',
    tool_name: 'AskUserQuestion',
    tool_input: { questions: [{ question: ASKED }] },
    tool_response: { questions: [{ question: ASKED }], answers: { [ASKED]: '빼고 낸다 (추천)', '두 번째 질문?': 'A' } },
  };
  assert.deepEqual(receiptTextsOf(input), ['빼고 낸다 (추천)', 'A']);
});

test('고른 답에 사람이 단 메모도 영수증이다', () => {
  const input = {
    tool_name: 'AskUserQuestion',
    tool_response: { answers: { [ASKED]: '빼고 낸다 (추천)' }, annotations: { [ASKED]: { notes: '광고는 v2 에서 다시 붙인다' } } },
  };
  assert.deepEqual(receiptTextsOf(input), ['빼고 낸다 (추천)', '광고는 v2 에서 다시 붙인다']);
});

test('답이 tool_input 에 실려 오거나 여러 개 골랐어도 읽는다', () => {
  assert.deepEqual(receiptTextsOf({ tool_name: 'AskUserQuestion', tool_input: { answers: { [ASKED]: ['가', '나'] } } }), ['가, 나']);
});

test('답 객체가 없고 결과가 문장이면 "질문"="답" 꼴을 읽는다', () => {
  const tool_response = `Your questions have been answered: "${ASKED}"="빼고 낸다 (추천)", "다음?"="일단 pc써야해서 조금 있다가 돌리자 ". You can now continue.`;
  assert.deepEqual(receiptTextsOf({ tool_name: 'AskUserQuestion', tool_response }), ['빼고 낸다 (추천)', '일단 pc써야해서 조금 있다가 돌리자 ']);
});

test('답이 없는 AskUserQuestion(거절·취소)은 영수증이 없다', () => {
  assert.deepEqual(receiptTextsOf({ tool_name: 'AskUserQuestion', tool_response: { answers: {} } }), []);
  assert.deepEqual(receiptTextsOf({ tool_name: 'AskUserQuestion', tool_response: 'The user declined' }), []);
});

test('AskUserQuestion 의 답은 질문 이후 영수증으로 인용이 증명된다 — 짧은 라벨도 답 전체와 같으면 된다', () => {
  const texts = receiptTextsOf({ tool_name: 'AskUserQuestion', tool_response: { answers: { [ASKED]: 'A' } } });
  const list = texts.reduce((acc, text) => addReceipt(acc, T1, text), null);
  assert.equal(quoteProves(list, 'A', T0), true);
});

test('영수증은 개수를 넘으면 오래된 것부터 버린다', () => {
  let list = null;
  for (let i = 0; i < MAX_RECEIPTS + 3; i += 1) list = addReceipt(list, T0, String(i));
  assert.equal(list.length, MAX_RECEIPTS);
  assert.equal(list[0].text, '3');
});

test('🚨 인용은 질문 이후 사람의 말이어야 한다', () => {
  assert.equal(quoteProves(receipts, 'a', T0), true);
  assert.equal(quoteProves(receipts, 'a', '2026-10-31T12:00:00Z'), false);
  assert.equal(quoteProves(null, 'a', T0), false);
  assert.equal(quoteProves(receipts, '', T0), false);
});

// 사람은 `a`, `1 b로 2 ok` 로 답한다(기록). 짧은 인용을 부분 일치로 받으면 어느 말이든 증거가 된다.
test('🚨 짧은 인용은 프롬프트 전체와 같아야 하고, 긴 인용만 부분 일치를 받는다', () => {
  assert.equal(quoteProves(receipts, '진행해', T0), false);
  assert.equal(quoteProves(receipts, '크게 이슈 없으면 맵 진행해', T0), true);
  assert.equal(quoteProves(receipts, '없던 말을 지어낸 문장이다', T0), false);
});

test('bd 시각은 초 단위라 같은 초의 말을 놓치지 않는다', () => {
  assert.equal(spokeSince([{ at: '2026-10-31T10:00:00.500Z', text: 'x' }], '2026-10-31T10:00:00.900Z').length, 1);
});

test('헌장 목표는 Destination 과 완료 조건뿐이다', () => {
  const goal = charterGoalOf(CHARTER);
  assert.match(goal, /새 API/);
  assert.match(goal, /스위트/);
  assert.doesNotMatch(goal, /옛 API/);
  assert.equal(charterGoalOf(null), '');
});

test('🚨 위임 근거는 헌장 목표의 원문이어야 한다', () => {
  const goal = charterGoalOf(CHARTER);
  assert.equal(citesGoal(goal, '결제 모듈이 새 API 로 동작한다'), true);
  assert.equal(citesGoal(goal, '옛 API 를 지운다는 결정'), false);
  assert.equal(citesGoal(goal, '새 API'), false);
});

test('위임 답변은 코멘트로 적고 다시 읽는다 — bd 의 Response 접두어를 넘는다', () => {
  const text = `Response: ${delegatedAnswerText({ choice: 'A', cite: '전 스위트가 초록이다', why: '시험이 깨진다' })}`;
  assert.deepEqual(parseDelegatedAnswer(text), { choice: 'A', cite: '전 스위트가 초록이다', why: '시험이 깨진다' });
  assert.equal(parseDelegatedAnswer('사용자 원문: a'), null);
});

test('위임 구간은 맵 코멘트에서 읽는다', () => {
  const spans = delegationSpansOf([
    { text: delegationStartText('맵 진행해'), created_at: T0 },
    { text: '다른 말', created_at: T0 },
    { text: '[위임 종료]', created_at: T1 },
    { text: delegationStartText('다시 맡긴다'), created_at: T1 },
  ]);
  assert.deepEqual(spans, [
    { startedAt: T0, quote: '맵 진행해', endedAt: T1 },
    { startedAt: T1, quote: '다시 맡긴다', endedAt: null },
  ]);
});

test('보고서는 근거·목표·고른 것·영향을 담는다', () => {
  const report = renderDelegationReport({
    epic: 'map',
    title: '결제',
    goal: charterGoalOf(CHARTER),
    generatedAt: T1,
    spans: [{ startedAt: T0, endedAt: null, quote: '맵 진행해' }],
    decisions: [{ id: 'map.1', title: 'A|B', at: T1, choice: 'A', cite: '전 스위트가 초록이다', why: '이유', dependents: [{ id: 'map.2', title: '구현', status: 'closed', closeReason: '통과' }] }],
  });
  assert.match(report, /사용자 원문: «맵 진행해»/);
  assert.match(report, /A\\\|B/);
  assert.match(report, /map\.2 구현 \[closed\] — 통과/);
  assert.match(report, /위임 답변 1건/);
});

test('🚨 위임 답변이 있으면 전부 담은 보고서와 close 명령의 경로가 있어야 맵을 닫는다', () => {
  const base = { ids: ['map.1'], reportPath: '/r/map.md', reportText: '# map.1', command: 'bd close map --reason "/r/map.md"' };
  assert.equal(closeProblemOf(base), null);
  assert.equal(closeProblemOf({ ...base, ids: [] }), null);
  assert.match(closeProblemOf({ ...base, reportText: null }), /delegation-report/);
  assert.match(closeProblemOf({ ...base, ids: ['map.1', 'map.9'] }), /map\.9/);
  assert.match(closeProblemOf({ ...base, command: 'bd close map' }), /close reason/);
});
