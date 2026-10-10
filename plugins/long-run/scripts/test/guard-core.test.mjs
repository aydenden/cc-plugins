import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HANDOFF_RATIO,
  MOD_FLAG,
  classifyFrontier,
  contextLimitOf,
  contextTokensOf,
  decide,
  isDelegatedToMod,
  readTranscriptTail,
} from '../lib/guard-core.mjs';

const marker = { epic: 'map-abcd' };
const frontierOf = (pushable = [], questions = [], blocked = []) => ({ pushable, questions, blocked });
const pushing = frontierOf(['map-abcd.9', 'map-abcd.11']);
const base = { marker, contextTokens: 100_000, contextLimit: 1_000_000, frontier: pushing, epicOpen: true, stopHookActive: false };

test('창 크기는 모델 이름이 말한다 — [1m] 이면 백만', () => {
  assert.equal(contextLimitOf('claude-opus-5[1m]'), 1_000_000);
  assert.equal(contextLimitOf('claude-opus-5'), 200_000);
  assert.equal(contextLimitOf(undefined), 200_000);
});

test('점유는 캐시에서 읽은 토큰까지 센다 — 빼면 긴 세션이 영영 비어 보인다', () => {
  assert.equal(contextTokensOf({ input_tokens: 2, cache_creation_input_tokens: 267, cache_read_input_tokens: 385_437 }), 385_706);
  assert.equal(contextTokensOf(null), 0);
});

test('트랜스크립트는 마지막 usage 와 모델을 준다', () => {
  const text = [
    JSON.stringify({ message: { model: 'claude-opus-5', usage: { input_tokens: 10 } } }),
    '{ 깨진 줄',
    JSON.stringify({ message: { usage: { input_tokens: 20, cache_read_input_tokens: 5 } } }),
    '',
  ].join('\n');
  const { usage, model } = readTranscriptTail(text);
  assert.equal(contextTokensOf(usage), 25);
  assert.equal(model, 'claude-opus-5');
});

test('🚨 창을 말하는 것은 message.model 이 아니라 attachment.identity.modelId 다', () => {
  const text = [
    JSON.stringify({ message: { model: 'claude-opus-5', usage: { input_tokens: 1 } } }),
    JSON.stringify({ attachment: { type: 'model', identity: { modelId: 'claude-opus-5[1m]' } } }),
  ].join('\n');
  assert.equal(contextLimitOf(readTranscriptTail(text).model), 1_000_000);
  // 앞만 봤다면 20만으로 재서 한참 이른 인계를 시킨다.
  assert.equal(contextLimitOf('claude-opus-5'), 200_000);
});

test('깨진 트랜스크립트는 가드를 죽이지 않는다', () => {
  assert.deepEqual(readTranscriptTail('쓰레기'), { usage: null, model: null });
  assert.deepEqual(readTranscriptTail(undefined), { usage: null, model: null });
});

// --- 판정 ---

test('선언하지 않은 세션은 건드리지 않는다', () => {
  assert.equal(decide({ ...base, marker: null }).block, false);
});

test('🚨 stop_hook_active 면 무조건 통과 — 두 번째 막음은 세션을 영영 안 끝나게 만든다', () => {
  assert.equal(decide({ ...base, stopHookActive: true }).block, false);
});

test('프론티어가 남았으면 막고, 묻지 말고 claim 하라고 돌려준다', () => {
  const verdict = decide(base);
  assert.equal(verdict.block, true);
  assert.match(verdict.reason, /claim/);
  assert.match(verdict.reason, /묻지 않는다/);
  assert.match(verdict.reason, /map-abcd\.9/);
});

// 되밀면서 「묻지 않는다」만 말하면, 되돌리기 비싼 갈림길에서도 혼자 확정하게 된다.
// 되미는 문구가 그 예외를 함께 실어야 하고, 국소 선택은 여전히 묻지 않는다고 말해야 한다.
test('되미는 문구는 갈림길 예외와 국소 선택을 함께 말한다', () => {
  const reason = decide(base).reason;
  assert.match(reason, /갈림길/);
  assert.match(reason, /A\.1\/A\.2/);
  assert.match(reason, /close reason/);
  assert.match(reason, /넷뿐이다/);
});

test('프론티어가 비고 맵이 닫혔으면 통과시키고 선언을 지운다', () => {
  const verdict = decide({ ...base, frontier: frontierOf(), epicOpen: false });
  assert.equal(verdict.block, false);
  assert.equal(verdict.clear, true);
});

// bd 가 잠깐 죽은 것을 빈 프론티어로 읽으면 선언이 사라지고, 새 세션이 가드 없이 출발한다.
test('🚨 프론티어를 모르면 통과시키되 선언은 지우지 않는다', () => {
  const verdict = decide({ ...base, frontier: null });
  assert.equal(verdict.block, false);
  assert.notEqual(verdict.clear, true);
});

test('컨텍스트가 절반을 넘으면 이어가지 말고 넘기라고 한다', () => {
  const verdict = decide({ ...base, contextTokens: 600_000 });
  assert.equal(verdict.block, true);
  assert.match(verdict.reason, /session-handoff 로 넘긴다/);
  assert.match(verdict.reason, /60%/);
  // 이어가라는 말과 섞이면 안 된다 — 두 지시가 한 메시지에 있으면 어느 쪽을 따를지 모른다.
  assert.doesNotMatch(verdict.reason, /claim/);
});

test('인계 지시는 이 플러그인의 스킬 이름을 가리킨다 — 다른 네임스페이스를 부르면 없는 스킬이다', () => {
  assert.match(decide({ ...base, contextTokens: 600_000 }).reason, /\/long-run:session-handoff/);
});

test('경계는 비율이 아니라 창 크기로 정해진다 — 표준 창이면 같은 토큰이 이미 초과다', () => {
  assert.match(decide({ ...base, contextLimit: 200_000 }).reason, /session-handoff 로 넘긴다/);
  assert.equal(decide({ ...base, contextLimit: 200_000, handoffRatio: 0.9 }).reason.includes('claim'), true);
});

test('기본 문턱은 운영 규약의 50% 다', () => {
  assert.equal(HANDOFF_RATIO, 0.5);
});

test('🚨 Stop 이 아닌 이벤트에서는 입을 다문다 — PostToolUse 로 배선되면 파일마다 터진다', () => {
  assert.equal(decide({ ...base, isStopEvent: false }).block, false);
  // 기본값은 Stop 이다 — 훅 입력에 이름이 없어도 판정은 돌아야 한다.
  assert.equal(decide(base).block, true);
});

// --- mod 위임 ---

// mod 가 판정한 Stop 에서 node 훅까지 판정하면 같은 멈춤을 두 번 되민다.
test('mod 가 표지를 붙인 Stop 은 mod 가 판정했다', () => {
  assert.equal(isDelegatedToMod({ hook_event_name: 'Stop', [MOD_FLAG]: true }), true);
});

// 표지가 없으면 mod 가 안 뜬 환경이다 — 그때 node 훅이 판정을 놓으면 가드가 사라진다.
test('표지가 없거나 참이 아니면 node 훅이 판정한다', () => {
  assert.equal(isDelegatedToMod({ hook_event_name: 'Stop' }), false);
  assert.equal(isDelegatedToMod({ [MOD_FLAG]: 'true' }), false);
  assert.equal(isDelegatedToMod(null), false);
});

// --- 프론티어 분류 ---

// `bd list --parent <epic> --json` 의 행 그대로다 — 의존에 막힌 티켓도 status 는 open 으로 온다.
const row = (id, extra = {}) => ({ id, status: 'open', ...extra });

test('막힌 데 없는 열린 티켓은 밀 수 있다', () => {
  const frontier = classifyFrontier({ children: [row('map-abcd.1'), row('map-abcd.2')], readyIds: ['map-abcd.1', 'map-abcd.2'] });
  assert.deepEqual(frontier, { pushable: ['map-abcd.1', 'map-abcd.2'], questions: [], blocked: [] });
});

// 사람이 답해야 하는 질문은 bd 의 `human` 라벨로 주차한다. `bd ready` 는 그 티켓도 내놓는다(실측) —
// 여기서 빼지 않으면 가드가 에이전트에게 질문 티켓을 claim 하라고 시킨다.
test('human 라벨 티켓은 질문이다 — ready 에 있어도 밀 수 있는 쪽에 넣지 않는다', () => {
  const frontier = classifyFrontier({
    children: [row('map-abcd.1'), row('map-abcd.3', { labels: ['human'] })],
    readyIds: ['map-abcd.1', 'map-abcd.3'],
  });
  assert.deepEqual(frontier, { pushable: ['map-abcd.1'], questions: ['map-abcd.3'], blocked: [] });
});

test('ready 에 없는 열린 티켓은 막힌 것이다', () => {
  const frontier = classifyFrontier({
    children: [row('map-abcd.1'), row('map-abcd.2'), row('map-abcd.3', { labels: ['human'] })],
    readyIds: ['map-abcd.1', 'map-abcd.3'],
  });
  assert.deepEqual(frontier, { pushable: ['map-abcd.1'], questions: ['map-abcd.3'], blocked: ['map-abcd.2'] });
});

// `bd ready` 는 in_progress 를 뺀다. 그것을 막힌 것으로 세면, 티켓을 claim 한 세션이 자기가 미는
// 티켓 때문에 «밀 수 있는 것이 없다» 는 판정을 받는다.
test('claim 한 티켓은 ready 에 없어도 밀 수 있는 것이다', () => {
  const frontier = classifyFrontier({ children: [row('map-abcd.1', { status: 'in_progress' })], readyIds: [] });
  assert.deepEqual(frontier, { pushable: ['map-abcd.1'], questions: [], blocked: [] });
});

// --- 대기뿐인 프론티어 ---

const waiting = frontierOf([], ['map-abcd.3'], ['map-abcd.4']);

// 조용히 통과시키면 주차한 질문이 묻힌다. 되미는 자리가 질문을 사용자에게 올릴 유일한 자리다.
test('밀 수 있는 것이 없고 질문이 남았으면 한 번 되밀어 질문을 모아 보고하게 한다', () => {
  const verdict = decide({ ...base, frontier: waiting });
  assert.equal(verdict.block, true);
  assert.match(verdict.reason, /map-abcd\.3/);
  assert.match(verdict.reason, /모아 보고/);
  assert.match(verdict.reason, /bd human respond/);
  // 밀 것이 없는데 claim 하라고 하면 질문 티켓을 집는다.
  assert.doesNotMatch(verdict.reason, /--claim/);
  // 답이 오면 같은 worktree 에서 이어 밀어야 한다.
  assert.notEqual(verdict.clear, true);
});

// 인계해도 새 세션이 같은 자리에서 곧바로 멈춘다 — 탭만 하나 더 뜬다.
test('대기뿐이면 컨텍스트가 절반을 넘어도 인계가 아니라 질문 보고다', () => {
  const verdict = decide({ ...base, frontier: waiting, contextTokens: 600_000 });
  assert.match(verdict.reason, /모아 보고/);
  assert.doesNotMatch(verdict.reason, /session-handoff/);
});

// --- 밀 수 있는 것과 대기가 섞인 프론티어 ---

test('되밀 때 claim 할 후보로 대기 티켓을 내밀지 않는다', () => {
  const reason = decide({ ...base, frontier: frontierOf(['map-abcd.9'], ['map-abcd.3'], ['map-abcd.4']) }).reason;
  assert.match(reason, /1건 남았다\(map-abcd\.9\)/);
  assert.match(reason, /질문 1건/);
});

// 갈림길에서 서 버리면 그 질문과 무관한 티켓까지 함께 선다. 질문을 티켓으로 주차하고, 의존은
// 문장이 아니라 `bd dep` 으로 적어야 가드가 «무관한 티켓» 을 읽을 수 있다.
test('갈림길은 멈추는 자리가 아니라 주차하는 자리다', () => {
  const reason = decide(base).reason;
  assert.match(reason, /--labels human/);
  assert.match(reason, /bd dep add/);
  assert.match(reason, /밀 수 있는 티켓이 없을 때/);
});

// --- 프론티어가 빈 자리 ---

// 열린 자식이 0 이라는 것은 «다 했다» 일 수도, «티켓을 안 만들었다» 일 수도 있다. 가드는 그 둘을
// 못 가르므로 조용히 놓아주지 않고, 완료 조건을 읽게 한 뒤 맵이 닫힌 것을 보고서야 선언을 지운다.
test('프론티어가 비었는데 맵이 열려 있으면 완료 조건을 검증하게 한다', () => {
  const verdict = decide({ ...base, frontier: frontierOf(), epicOpen: true });
  assert.equal(verdict.block, true);
  assert.notEqual(verdict.clear, true);
  assert.match(verdict.reason, /완료 조건/);
  assert.match(verdict.reason, /아직 규정 못 한 것/);
  assert.match(verdict.reason, /bd close map-abcd/);
});

// 일한 세션이 자기 일을 참이라고 읽는 것은 자기 보고다. 판정하는 쪽을 갈아 끼운다 — 다만 리뷰어는
// 의도를 모른 채 방향을 바꿀 수 있으므로 확정된 결정을 함께 주고, 그것을 뒤집는 지적은 반영하지 않는다.
test('맵을 닫기 전 검증은 새 컨텍스트의 서브에이전트 하나가 한다', () => {
  const reason = decide({ ...base, frontier: frontierOf(), epicOpen: true }).reason;
  assert.match(reason, /서브에이전트 하나/);
  assert.match(reason, /확정된 결정/);
  assert.match(reason, /--labels human/);
});

test('프론티어가 비었어도 컨텍스트가 절반을 넘었으면 닫는 일은 다음 세션에 넘긴다', () => {
  const verdict = decide({ ...base, frontier: frontierOf(), epicOpen: true, contextTokens: 600_000 });
  assert.match(verdict.reason, /session-handoff/);
  assert.match(verdict.reason, /완료 조건/);
});
