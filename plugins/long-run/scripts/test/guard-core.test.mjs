import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HANDOFF_CLOSED_TICKETS,
  HANDOFF_RATIO,
  MOD_FLAG,
  beginWave,
  classifyFrontier,
  contextLimitOf,
  contextTokensOf,
  countClosedSince,
  countingSince,
  decide,
  handoffClosedOf,
  isDelegatedToMod,
  ownership,
  parseWaveArgs,
  pendingWave,
  readTranscriptTail,
  settleWave,
  STOP_PLACE_LIST,
  ticketLimitOf,
  waveCarriedBy,
} from '../lib/guard-core.mjs';

const marker = { epic: 'map-abcd' };
const frontierOf = (pushable = [], questions = [], blocked = []) => ({ pushable, questions, blocked });
const pushing = frontierOf(['map-abcd.9', 'map-abcd.11']);
const base = { marker, contextTokens: 100_000, contextLimit: 1_000_000, measured: true, frontier: pushing, epicOpen: true, stopHookActive: false };

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

const human = { labels: ['human'] };

test('막힌 데 없는 열린 티켓은 밀 수 있다', () => {
  const frontier = classifyFrontier({ children: [row('map-abcd.1'), row('map-abcd.2')], ready: [row('map-abcd.1'), row('map-abcd.2')] });
  assert.deepEqual(frontier, { pushable: ['map-abcd.1', 'map-abcd.2'], questions: [], blocked: [] });
});

// 사람이 답해야 하는 질문은 bd 의 `human` 라벨로 주차한다. `bd ready` 는 그 티켓도 내놓는다(실측) —
// 여기서 빼지 않으면 가드가 에이전트에게 질문 티켓을 claim 하라고 시킨다.
test('human 라벨 티켓은 질문이다 — ready 에 있어도 밀 수 있는 쪽에 넣지 않는다', () => {
  const frontier = classifyFrontier({
    children: [row('map-abcd.1'), row('map-abcd.3', human)],
    ready: [row('map-abcd.1'), row('map-abcd.3', human)],
  });
  assert.deepEqual(frontier, { pushable: ['map-abcd.1'], questions: ['map-abcd.3'], blocked: [] });
});

test('ready 에 없는 열린 티켓은 막힌 것이다', () => {
  const frontier = classifyFrontier({
    children: [row('map-abcd.1'), row('map-abcd.2'), row('map-abcd.3', human)],
    ready: [row('map-abcd.1'), row('map-abcd.3', human)],
  });
  assert.deepEqual(frontier, { pushable: ['map-abcd.1'], questions: ['map-abcd.3'], blocked: ['map-abcd.2'] });
});

// `bd ready` 는 in_progress 를 뺀다. 그것을 막힌 것으로 세면, 티켓을 claim 한 세션이 자기가 미는
// 티켓 때문에 «밀 수 있는 것이 없다» 는 판정을 받는다.
test('claim 한 티켓은 ready 에 없어도 밀 수 있는 것이다', () => {
  const frontier = classifyFrontier({ children: [row('map-abcd.1', { status: 'in_progress' })], ready: [] });
  assert.deepEqual(frontier, { pushable: ['map-abcd.1'], questions: [], blocked: [] });
});

// 자식이 하위 epic 하나뿐인 맵에서 직계만 보면, 그 epic 이 열려 있는 동안 맵 전체가 «막힘» 으로
// 읽혀 일이 남았는데도 질문 보고로 멈춘다. `bd ready --parent` 가 주는 후손은 그대로 밀 수 있다.
test('ready 로 나온 손자 티켓도 밀 수 있는 것이다 — 하위 epic 에 맵이 막히지 않는다', () => {
  const frontier = classifyFrontier({
    children: [row('map-abcd.1')],
    ready: [row('map-abcd.1.1'), row('map-abcd.1.2', human)],
  });
  assert.deepEqual(frontier, { pushable: ['map-abcd.1.1'], questions: [], blocked: ['map-abcd.1'] });
});

test('같은 티켓이 자식과 ready 양쪽에 있어도 한 번만 센다', () => {
  const frontier = classifyFrontier({ children: [row('map-abcd.1')], ready: [row('map-abcd.1')] });
  assert.deepEqual(frontier.pushable, ['map-abcd.1']);
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

// --- 주인 세션 ---
//
// 같은 worktree 에서 다른 일로 연 세션까지 «프론티어를 밀라» 로 되밀리면 안 된다. 주인은 claim 을
// 부른 세션 하나다 — 그 세션의 트랜스크립트에만 claim 토큰 줄이 있다.

const NOW = '2026-10-21T09:00:00.000Z';
const never = () => false;
const always = () => true;

test('주인이 적힌 마커는 그 세션만 주인이다 — 기준 시각은 주인이 된 시각이다', () => {
  const owned = { epic: 'map-abcd', session: { id: 's1', since: '2026-10-21T08:00:00.000Z' }, claimHash: 'h' };
  assert.deepEqual(ownership(owned, 's1', NOW, never), { owner: true, since: '2026-10-21T08:00:00.000Z', changed: false });
  assert.deepEqual(ownership(owned, 's2', NOW, always), { owner: false, since: null, changed: false });
});

test('주인이 비었으면 claim 을 증명한 세션이 주인이 된다', () => {
  const claimed = { epic: 'map-abcd', claimHash: 'h' };
  assert.equal(ownership(claimed, 's1', NOW, always).owner, true);
  assert.deepEqual(ownership(claimed, 's2', NOW, never), { owner: false, since: null, changed: false });
});

const CLAIMED_AT = '2026-10-21T08:30:00.000Z';
const freshClaim = { epic: 'map-abcd', claimedAt: CLAIMED_AT, claimHash: 'h' };

test('🚨 claim 을 증명한 세션은 claim 한 시각부터 센다 — 첫 멈춤 전에 닫은 티켓이 빠지지 않는다', () => {
  assert.deepEqual(ownership(freshClaim, 's1', NOW, always), { owner: true, since: CLAIMED_AT, changed: true });
});

test('claim 시각이 없거나 깨졌으면 주인이 된 시각부터 센다', () => {
  assert.equal(ownership({ epic: 'map-abcd', claimHash: 'h' }, 's1', NOW, always).since, NOW);
  assert.equal(ownership({ ...freshClaim, claimedAt: '모름' }, 's1', NOW, always).since, NOW);
});

// --- 세는 기준: 주인이 적히기 전에도 status 가 센다 ---

test('주인이 적혔으면 그 기준 시각이다', () => {
  assert.equal(countingSince({ ...freshClaim, session: { id: 's1', since: NOW } }), NOW);
});

test('🚨 claim 직후 주인이 아직 안 적혔어도 claim 시각으로 센다 — 인계받은 세션 첫 턴 내내 «닫음 모름» 이던 자리다', () => {
  assert.equal(countingSince(freshClaim), CLAIMED_AT);
});

test('인계로 옮겨진 마커의 claim 시각은 앞 세션의 것이라 기준이 못 된다', () => {
  assert.equal(countingSince({ ...freshClaim, claimHash: null }), null);
});

test('마커가 없거나 토큰 이전의 마커면 기준이 없다', () => {
  assert.equal(countingSince(null), null);
  assert.equal(countingSince({ epic: 'map-abcd', claimedAt: CLAIMED_AT }), null);
});

// 트랜스크립트를 통째로 읽는 일이라 주인이 정해진 뒤에는 턴마다 하지 않는다.
test('주인이 정해진 뒤에는 증명을 다시 묻지 않는다', () => {
  let asked = 0;
  const proves = () => ++asked > 0;
  ownership({ epic: 'map-abcd', session: { id: 's1', since: NOW }, claimHash: 'h' }, 's1', NOW, proves);
  assert.equal(asked, 0);
});

// 인계로 다른 worktree 에 옮겨진 선언은 새 claim 을 기다린다 — 아무 세션도 주인으로 세우지 않는다.
test('claimHash 가 null 이면 아무도 주인이 아니다', () => {
  assert.equal(ownership({ epic: 'map-abcd', claimHash: null }, 's1', NOW, always).owner, false);
});

// 토큰이 생기기 전의 마커다. 진행 중인 맵을 끊지 않으려고 처음 멈추는 세션을 주인으로 세운다.
test('claimHash 칸 자체가 없는 마커는 처음 멈추는 세션이 주인이 된다', () => {
  assert.deepEqual(ownership({ epic: 'map-abcd' }, 's1', NOW, never), { owner: true, since: NOW, changed: true });
});

test('마커나 세션 id 가 없으면 주인이 아니다', () => {
  assert.equal(ownership(null, 's1', NOW, always).owner, false);
  assert.equal(ownership({ epic: 'map-abcd', claimHash: 'h' }, undefined, NOW, always).owner, false);
});

test('🚨 주인이 아닌 세션은 막지 않는다 — 같은 worktree 의 다른 일이다', () => {
  assert.equal(decide({ ...base, owner: false }).block, false);
  // 주인 아닌 세션의 판정이 선언을 지우면 주인이 가드를 잃는다.
  assert.notEqual(decide({ ...base, owner: false, frontier: frontierOf(), epicOpen: false }).clear, true);
});

test('owner 를 주지 않으면 주인 자리에서 본 판정이다', () => {
  assert.equal(decide(base).block, true);
});

// --- 닫은 티켓 수 — 인계의 1차 축 ---
//
// 컨텍스트 비율은 계측기가 죽으면 0% 로 떨어지는데, 그것을 «여유» 로 말하면 세션이 «계속해도 된다» 로
// 읽는다 — 창의 76% 를 쓰고도 열 티켓을 닫은 선례가 있다. bd 는 계측기가 죽어도 답하므로 닫은 수가 1차다.

const HANDING_OFF = /session-handoff 로 넘긴다/;

// `bd list --parent <epic> --all --json` 의 행 그대로다.
test('기준 시각 이후 닫힌 자식만 센다 — 앞 세션이 닫은 것은 이 세션 몫이 아니다', () => {
  const rows = [
    { id: 'a', status: 'closed', closed_at: '2026-10-21T07:59:59Z' },
    { id: 'b', status: 'closed', closed_at: '2026-10-21T08:00:00Z' },
    { id: 'c', status: 'closed', closed_at: '2026-10-21T09:30:00Z' },
  ];
  assert.equal(countClosedSince(rows, '2026-10-21T08:00:00Z'), 2);
});

// bd 의 closed_at 은 초 단위다(실측 `2026-10-21T04:40:49Z`). 밀리초 기준과 그대로 비교하면 주인이 된
// 같은 초 안에 닫은 티켓이 빠진다.
test('🚨 기준 시각과 같은 초에 닫힌 티켓도 센다 — closed_at 은 초 단위다', () => {
  assert.equal(countClosedSince([{ status: 'closed', closed_at: '2026-10-21T04:40:49Z' }], '2026-10-21T04:40:49.617Z'), 1);
});

// 0 으로 떨어뜨리면 「안 닫았다」가 돼 되미는 축이 조용히 사라진다.
test('셀 수 없으면 0 이 아니라 null(모름)이다', () => {
  assert.equal(countClosedSince(null, '2026-10-21T08:00:00Z'), null);
  assert.equal(countClosedSince([], null), null);
  assert.equal(countClosedSince([], '아무말'), null);
});

test('인계 문턱은 닫은 티켓 2건이다 — 티켓 하나가 세션의 40~50% 다', () => {
  assert.equal(HANDOFF_CLOSED_TICKETS, 2);
});

test('🚨 이 세션이 두 건을 닫았으면 컨텍스트가 여유로 보여도 넘긴다', () => {
  const verdict = decide({ ...base, closedSinceSession: 2 });
  assert.equal(verdict.block, true);
  assert.match(verdict.reason, HANDING_OFF);
  assert.match(verdict.reason, /2건을 닫았다/);
  assert.doesNotMatch(verdict.reason, /--claim/);
});

test('한 건만 닫았으면 다음 티켓으로 되밀고 지금 몇 건인지 말한다', () => {
  const verdict = decide({ ...base, closedSinceSession: 1 });
  assert.doesNotMatch(verdict.reason, HANDING_OFF);
  assert.match(verdict.reason, /1\/2건/);
});

// 0 으로 떨어뜨리면 「안 닫았다」가 돼 되미는 축이 조용히 사라진다.
test('닫은 수를 모르면 문턱을 넘은 것으로 읽지 않고, 스스로 세라고 한다', () => {
  const verdict = decide({ ...base, closedSinceSession: null });
  assert.doesNotMatch(verdict.reason, HANDING_OFF);
  assert.match(verdict.reason, /닫은 티켓 수도 모른다/);
});

test('프론티어가 비었어도 두 건을 닫았으면 닫는 일은 다음 세션에 넘긴다', () => {
  const verdict = decide({ ...base, frontier: frontierOf(), closedSinceSession: 2 });
  assert.match(verdict.reason, HANDING_OFF);
  assert.match(verdict.reason, /완료 조건/);
});

// --- 못 잰 컨텍스트 ---

test('🚨 컨텍스트를 못 쟀으면 «여유» 라고 말하지 않는다 — 계측 불가다', () => {
  const verdict = decide({ ...base, contextTokens: 0, measured: false });
  assert.equal(verdict.block, true);
  assert.match(verdict.reason, /계측 불가/);
  assert.doesNotMatch(verdict.reason, /아직 넘길 자리가 아니다/);
});

test('못 잰 값으로는 인계를 지시하지도 않는다 — 판정은 닫은 수가 한다', () => {
  assert.doesNotMatch(decide({ ...base, contextTokens: 600_000, measured: false }).reason, HANDING_OFF);
  assert.match(decide({ ...base, measured: false, closedSinceSession: 2 }).reason, HANDING_OFF);
});

test('measured 를 주지 않으면 못 잰 것이다', () => {
  const { measured: _measured, ...unmeasured } = base;
  assert.match(decide(unmeasured).reason, /계측 불가/);
});

test('대기뿐이면 두 건을 닫았어도 인계가 아니라 질문 보고다 — 새 세션도 같은 자리에서 멈춘다', () => {
  const verdict = decide({ ...base, frontier: frontierOf([], ['map-abcd.3']), closedSinceSession: 2 });
  assert.match(verdict.reason, /모아 보고/);
  assert.doesNotMatch(verdict.reason, HANDING_OFF);
});

// --- 맵 단위로 끈 티켓 수 축: 코디네이터가 웨이브마다 여러 건을 닫는 맵 ---

test('문턱은 마커가 정한다 — 옵션 없는 claim 은 2건, 끈 맵은 축이 없다', () => {
  assert.equal(handoffClosedOf({ epic: 'map-abcd' }), HANDOFF_CLOSED_TICKETS);
  assert.equal(handoffClosedOf({ epic: 'map-abcd', ticketLimit: false }), null);
  assert.equal(handoffClosedOf(null), HANDOFF_CLOSED_TICKETS);
});

test('🚨 티켓 수 축을 끈 맵은 몇 건을 닫아도 그 축으로 넘기지 않는다', () => {
  const verdict = decide({ ...base, closedSinceSession: 7, handoffClosed: null });
  assert.doesNotMatch(verdict.reason, HANDING_OFF);
  assert.match(verdict.reason, /하고 이어간다/);
  assert.doesNotMatch(verdict.reason, /티켓 2건을 닫았다/);
  assert.match(verdict.reason, /컨텍스트 50% 초과/);
});

test('끈 맵도 컨텍스트 50% 에서는 넘긴다 — 남는 축은 그것 하나다', () => {
  const verdict = decide({ ...base, contextTokens: 600_000, closedSinceSession: 7, handoffClosed: null });
  assert.match(verdict.reason, HANDING_OFF);
});

test('🚨 같은 맵을 다시 claim 하면 끈 축을 물려받는다 — 인계받은 세션이 옵션을 빠뜨려도 2건 되밂이 살아나지 않는다', () => {
  const off = { epic: 'map-abcd', ticketLimit: false };
  assert.equal(ticketLimitOf(off, 'map-abcd', []), false);
  assert.equal(ticketLimitOf(off, 'map-abcd', ['--ticket-limit']), true);
  assert.equal(ticketLimitOf(off, 'map-other', []), true);
  assert.equal(ticketLimitOf(null, 'map-abcd', ['--no-ticket-limit']), false);
  assert.equal(ticketLimitOf({ epic: 'map-abcd' }, 'map-abcd', []), true);
});

test('🚨 끈 맵에서 계측까지 죽으면 남은 축이 없다고 말한다 — 헌장의 대체 규칙으로 스스로 판정한다', () => {
  const verdict = decide({ ...base, measured: false, closedSinceSession: 7, handoffClosed: null });
  assert.match(verdict.reason, /계측 불가/);
  assert.match(verdict.reason, /티켓 수 축을 껐다/);
  assert.match(verdict.reason, /헌장/);
});

test('끈 맵의 멈춰도 되는 자리는 컨텍스트 축만 말한다 — 기본 문구는 헌장과 같은 그대로다', () => {
  assert.match(STOP_PLACE_LIST('50%')[1], /티켓 2건을 닫았다 또는 컨텍스트 50% 초과/);
  assert.doesNotMatch(STOP_PLACE_LIST('50%', null)[1], /티켓/);
  assert.match(STOP_PLACE_LIST('50%', null)[1], /컨텍스트 50% 초과/);
});

// --- 웨이브 ---

const waving = beginWave(marker, {
  runId: 'run_1',
  startedAt: '2026-10-29T06:00:00.000Z',
  tickets: [
    { id: 'map-abcd.9', dispatchId: 'ctx_a', worktree: 'id:repo::C:/w/a' },
    { id: 'map-abcd.11', dispatchId: 'ctx_b' },
  ],
});

test('웨이브를 시작하면 마커에 run 과 티켓별 dispatch 가 실리고, 원래 마커 칸은 그대로다', () => {
  const withOwner = { ...marker, session: { id: 's1', since: 'x' }, ticketLimit: false };
  const next = beginWave(withOwner, { runId: 'run_1', startedAt: 't', tickets: [{ id: 'a', dispatchId: 'd', branch: 'b' }] });
  assert.deepEqual(next.session, withOwner.session);
  assert.equal(next.ticketLimit, false);
  assert.deepEqual(next.wave, { runId: 'run_1', startedAt: 't', tickets: [{ id: 'a', dispatchId: 'd', branch: 'b' }] });
  assert.equal(withOwner.wave, undefined);
});

test('정산한 티켓은 웨이브에서 빠지고, 마지막 티켓이 빠지면 웨이브 칸이 사라진다', () => {
  const one = settleWave(waving, 'map-abcd.9');
  assert.deepEqual(pendingWave(one).map((t) => t.id), ['map-abcd.11']);
  assert.equal(one.wave.runId, 'run_1');
  const none = settleWave(one, 'map-abcd.11');
  assert.equal('wave' in none, false);
  assert.deepEqual(pendingWave(none), []);
  assert.equal(settleWave(marker, 'x'), marker);
});

test('웨이브 인자는 <runId> <티켓>=<dispatch>... 꼴이다 — 틀린 꼴은 이유와 함께 거른다', () => {
  assert.deepEqual(parseWaveArgs(['run_1', 'map.9=ctx_a', 'map.11=ctx_b']), {
    runId: 'run_1',
    tickets: [
      { id: 'map.9', dispatchId: 'ctx_a' },
      { id: 'map.11', dispatchId: 'ctx_b' },
    ],
  });
  assert.match(parseWaveArgs([]).error, /runId/);
  assert.match(parseWaveArgs(['run_1']).error, /티켓/);
  assert.match(parseWaveArgs(['run_1', 'map.9']).error, /map\.9/);
  assert.match(parseWaveArgs(['run_1', 'map.9=a', 'map.9=b']).error, /중복/);
});

test('웨이브 인자의 셋째 칸은 정산이 지울 worktree id 다 — orca id 의 :: 와 드라이브 콜론을 그대로 싣는다', () => {
  assert.deepEqual(parseWaveArgs(['run_1', 'map.9=ctx_a=repo::C:/base/wave-map-9']).tickets, [
    { id: 'map.9', dispatchId: 'ctx_a', worktreeId: 'repo::C:/base/wave-map-9' },
  ]);
  assert.match(parseWaveArgs(['run_1', 'map.9=ctx_a=w=x']).error, /map\.9/);
});

test('🚨 웨이브가 돌고 있으면 그 티켓을 claim 하라고 하지 않고, 워커의 보고를 기다리라고 되민다', () => {
  const verdict = decide({ ...base, marker: waving });
  assert.equal(verdict.block, true);
  assert.match(verdict.reason, /check --wait/);
  assert.match(verdict.reason, /run_1/);
  assert.match(verdict.reason, /map-abcd\.9/);
  assert.match(verdict.reason, /wave-settle/);
  assert.doesNotMatch(verdict.reason, /bd update <id> --claim/);
});

test('웨이브는 bd 를 못 읽어도 마커만으로 기다리라고 말한다 — 워커가 도는 동안 가드가 사라지면 안 된다', () => {
  assert.equal(decide({ ...base, marker: waving, frontier: null }).block, true);
});

test('웨이브가 돌아도 두 번째 멈춤과 주인 아닌 세션은 통과시킨다', () => {
  assert.equal(decide({ ...base, marker: waving, stopHookActive: true }).block, false);
  assert.equal(decide({ ...base, marker: waving, owner: false }).block, false);
});

test('🚨 같은 맵을 다시 claim 해도 웨이브를 물려받는다 — 인계받은 코디네이터가 나간 워커를 잃으면 안 된다', () => {
  assert.deepEqual(waveCarriedBy(waving, 'map-abcd'), { wave: waving.wave });
  assert.deepEqual(waveCarriedBy(waving, 'map-other'), {});
  assert.deepEqual(waveCarriedBy(marker, 'map-abcd'), {});
  assert.deepEqual(waveCarriedBy(null, 'map-abcd'), {});
});

test('웨이브가 끝나면 평소 판정으로 돌아간다', () => {
  const settled = settleWave(settleWave(waving, 'map-abcd.9'), 'map-abcd.11');
  assert.match(decide({ ...base, marker: settled }).reason, /bd update <id> --claim/);
});
