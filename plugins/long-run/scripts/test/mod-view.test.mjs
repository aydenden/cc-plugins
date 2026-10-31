import test from 'node:test';
import assert from 'node:assert/strict';

import { HANDOFF_SKILL } from '../lib/guard-core.mjs';
import { compactNote, judgeUsageArgs, movesMap, parseStatus, statusLine } from '../lib/mod-view.mjs';

// `frontier-guard.mjs status` 가 내는 꼴 그대로다 — 프론티어는 분류된 id 로 실린다.
const claimed = {
  markerPath: '/home/u/.claude/long-run/frontier-guard/repo-1234abcd.json',
  worktree: '/repo',
  marker: { epic: 'map-abcd' },
  epicTitle: '결제 모듈 이전',
  frontier: { pushable: ['map-abcd.9', 'map-abcd.11'], questions: [], blocked: [] },
  epicOpen: true,
};
const unclaimed = { ...claimed, marker: null, frontier: null };
const usageAt = (tokens, window = 1_000_000) => ({ context: { tokens, window, percent: Math.round((tokens / window) * 100) } });

// --- parseStatus ---

test('status 출력은 JSON 으로 읽는다', () => {
  assert.deepEqual(parseStatus(JSON.stringify(claimed, null, 2)), claimed);
});

// CLI 가 죽거나 엉뚱한 것을 내면 «모름» 이다 — 가드는 모를 때 통과시킨다.
test('읽을 수 없는 출력은 null 이다', () => {
  assert.equal(parseStatus(''), null);
  assert.equal(parseStatus('usage: node frontier-guard.mjs'), null);
  assert.equal(parseStatus(undefined), null);
});

// --- statusLine ---

test('선언한 세션은 맵·프론티어·컨텍스트를 한 줄로 본다', () => {
  assert.equal(statusLine(claimed, usageAt(420_000)), '🧭 [결제 모듈 이전] · 밀기 2 · 막힘 0 · 질문 0 · 컨텍스트 42%/50%');
});

// id 는 사람이 모른다 — 제목을 그리고, 터미널 한 줄에 들도록 자른다. 한글은 바이트가 아니라 글자로 센다.
test('웨이브가 돌면 워커에게 나간 티켓 수를 프론티어 뒤에 붙인다', () => {
  const waving = { ...claimed, marker: { epic: 'map-abcd', wave: { runId: 'run_1', tickets: [{ id: 'map-abcd.9', dispatchId: 'ctx_a' }] } } };
  assert.equal(statusLine(waving, usageAt(420_000)), '🧭 [결제 모듈 이전] · 밀기 2 · 막힘 0 · 질문 0 · 웨이브 1건 대기 · 컨텍스트 42%/50%');
});

test('맵 제목은 20자, 잡은 티켓 제목은 40자에서 자른다', () => {
  const status = {
    ...claimed,
    epicTitle: '가'.repeat(21),
    claimed: [{ id: 'map-abcd.9', title: '나'.repeat(41) }],
  };
  assert.equal(statusLine(status, usageAt(420_000)), `🧭 [${'가'.repeat(20)}…][${'나'.repeat(40)}…] · 밀기 2 · 막힘 0 · 질문 0 · 컨텍스트 42%/50%`);
});

test('문턱 길이의 제목은 자르지 않는다', () => {
  const status = { ...claimed, epicTitle: '가'.repeat(20), claimed: [{ id: 'map-abcd.9', title: '나'.repeat(40) }] };
  assert.equal(statusLine(status, null).split(' · ')[0], `🧭 [${'가'.repeat(20)}][${'나'.repeat(40)}]`);
});

// bd 가 제목을 못 줬어도 무엇을 미는지는 보여야 한다.
test('제목이 없으면 id 로 그린다', () => {
  const status = { ...claimed, epicTitle: null, claimed: [{ id: 'map-abcd.9', title: null }] };
  assert.equal(statusLine(status, null).split(' · ')[0], '🧭 [map-abcd][map-abcd.9]');
});

test('잡은 티켓이 여럿이면 첫 제목에 나머지 수를 붙인다', () => {
  const status = { ...claimed, claimed: [{ id: 'map-abcd.9', title: '파서' }, { id: 'map-abcd.11', title: '검증' }] };
  assert.equal(statusLine(status, null).split(' · ')[0], '🧭 [결제 모듈 이전][파서 +1]');
});

test('선언하지 않은 세션에는 상태줄이 없다', () => {
  assert.equal(statusLine(unclaimed, usageAt(420_000)), undefined);
  assert.equal(statusLine(null, usageAt(420_000)), undefined);
});

// 첫 응답 전이나 compact 직후에는 percent 가 비어 온다 — 0% 로 그리면 거짓말이다.
test('컨텍스트를 아직 모르면 모른다고 쓴다', () => {
  assert.equal(statusLine(claimed, { context: { window: 1_000_000 } }), '🧭 [결제 모듈 이전] · 밀기 2 · 막힘 0 · 질문 0 · 컨텍스트 ?/50%');
  assert.equal(statusLine(claimed, null), '🧭 [결제 모듈 이전] · 밀기 2 · 막힘 0 · 질문 0 · 컨텍스트 ?/50%');
});

test('인계 문턱을 넘으면 그 사실을 붙인다', () => {
  assert.equal(statusLine(claimed, usageAt(500_000)), '🧭 [결제 모듈 이전] · 밀기 2 · 막힘 0 · 질문 0 · 컨텍스트 50%/50% · 인계할 때');
});

// --- judge 인자 ---

// 창 크기를 모델 이름에서 추측하지 않는다 — 세션이 실제 창을 알려준다.
test('세션이 잰 컨텍스트를 judge 인자로 넘긴다', () => {
  assert.deepEqual(judgeUsageArgs(usageAt(150_000, 200_000)), ['--tokens', '150000', '--window', '200000']);
});

test('🚨 측정 전이면 싣지 않는다 — 0 을 여유로 읽히게 두지 않는다', () => {
  assert.deepEqual(judgeUsageArgs(null), []);
  assert.deepEqual(judgeUsageArgs({ context: { window: 1_000_000 } }), []);
});

// --- 위임 표시 ---

test('위임 중이면 대신 고른 수를 상태줄에 늘 보인다', () => {
  const on = { ...claimed, marker: { epic: 'map-abcd', delegation: { since: 'x' } }, delegated: 3 };
  assert.match(statusLine(on, usageAt(100_000)), /위임 답변 3/);
  assert.doesNotMatch(statusLine(claimed, usageAt(100_000)), /위임/);
});

test('범위 없는 질문이 맵을 세웠으면 그 사실을 그린다', () => {
  const frozen = { ...claimed, frontier: { pushable: [], questions: ['q'], blocked: ['t'], unscoped: ['q'] } };
  assert.match(statusLine(frozen, usageAt(100_000)), /범위 없는 질문 1 — 맵 정지/);
});

// --- 대기 ---

const parked = { ...claimed, frontier: { pushable: ['map-abcd.9'], questions: ['map-abcd.3'], blocked: ['map-abcd.4'] } };

// 주차한 질문은 되미는 자리에서 한 번 보고될 뿐이라, 그 사이에 사람 눈에 띄는 곳은 상태줄뿐이다.
test('열린 티켓을 밀기·막힘·질문으로 나눠 그린다', () => {
  assert.equal(statusLine(parked, usageAt(420_000)), '🧭 [결제 모듈 이전] · 밀기 1 · 막힘 1 · 질문 1 · 컨텍스트 42%/50%');
});

// --- 잡은 티켓과 닫은 수 ---

test('잡은 티켓과 이 세션이 닫은 수를 함께 그린다', () => {
  const status = { ...claimed, owner: true, claimed: [{ id: 'map-abcd.9', title: '파서 작성' }], closedSinceSession: 1 };
  assert.equal(statusLine(status, usageAt(420_000)), '🧭 [결제 모듈 이전][파서 작성] · 밀기 2 · 막힘 0 · 질문 0 · 닫음 1/2 · 컨텍스트 42%/50%');
});

// 인계의 1차 축은 닫은 수다 — 컨텍스트가 여유로 보여도 문턱을 넘었으면 그 사실을 붙인다.
test('닫은 수가 문턱에 닿으면 컨텍스트가 여유여도 인계할 때다', () => {
  const status = { ...claimed, owner: true, closedSinceSession: 2 };
  assert.equal(statusLine(status, usageAt(100_000)), '🧭 [결제 모듈 이전] · 밀기 2 · 막힘 0 · 질문 0 · 닫음 2/2 · 컨텍스트 10%/50% · 인계할 때');
});

// 주인인데 bd 가 닫은 수를 못 셌으면 세션이 스스로 세야 한다 — 칸을 지우면 그 사실이 안 보인다.
test('주인인데 닫은 수를 모르면 모른다고 그린다', () => {
  assert.equal(
    statusLine({ ...claimed, owner: true, closedSinceSession: null }, usageAt(100_000)),
    '🧭 [결제 모듈 이전] · 밀기 2 · 막힘 0 · 질문 0 · 닫음 ?/2 · 컨텍스트 10%/50%'
  );
});

// 코디네이터 맵은 티켓 수 축을 껐다 — 문턱이 없는 값에 문턱을 그리면 «인계할 때» 가 거짓으로 뜬다.
const coordinator = { ...claimed, marker: { epic: 'map-abcd', ticketLimit: false }, owner: true };

test('티켓 수 축을 끈 맵은 닫은 수만 그리고 그 수로 인계할 때를 붙이지 않는다', () => {
  assert.equal(
    statusLine({ ...coordinator, closedSinceSession: 5 }, usageAt(100_000)),
    '🧭 [결제 모듈 이전] · 밀기 2 · 막힘 0 · 질문 0 · 닫음 5 · 컨텍스트 10%/50%'
  );
});

// 상태줄의 숫자는 status 가 bd 를 여러 번 불러 낸다. 그래서 맵의 티켓이나 선언을 움직인 명령 뒤에만 다시 그린다.
test('맵의 티켓이나 선언을 움직이는 셸 명령만 상태줄을 다시 그리게 한다', () => {
  for (const command of ['bd close map-abcd.9 --reason "x"', 'bd update map-abcd.9 --claim', 'bd create -t task --parent map-abcd', 'bd reopen map-abcd.9', 'node "/p/scripts/frontier-guard.mjs" claim map-abcd', 'bd dep add a b', 'bd human respond q']) {
    assert.equal(movesMap(command), true, command);
  }
  for (const command of ['bd show map-abcd', 'bd ready --parent map-abcd', 'npm test']) {
    assert.equal(movesMap(command), false, command);
  }
  assert.equal(movesMap(undefined), false);
});

// --- 압축 ---

// 압축된 세션은 맵의 운영 규약을 잃는다. 압축을 막으면 창이 넘칠 때 막다른 길이 되므로, 요약과 압축
// 뒤 대화에 인계 지시만 남긴다.
test('맵을 미는 세션이 압축되면 새 티켓을 잡지 말고 인계하라는 지시가 남는다', () => {
  const note = compactNote(claimed);
  assert.match(note, /map-abcd/);
  assert.match(note, /새 티켓을 잡지 않는다/);
  assert.match(note, new RegExp(`${HANDOFF_SKILL} --bd map-abcd`));
});

test('맵을 선언하지 않았거나 다른 세션이 주인이면 압축에 아무것도 덧붙이지 않는다', () => {
  assert.equal(compactNote(unclaimed), undefined);
  assert.equal(compactNote(null), undefined);
  assert.equal(compactNote({ ...claimed, owner: false }), undefined);
});

// claim 한 턴 직후에 압축되면 아직 주인이 적히기 전이다 — 그 세션의 맵을 잃게 두지 않는다.
test('주인이 아직 정해지지 않은 맵도 지시를 남긴다', () => {
  assert.match(compactNote({ ...claimed, owner: null }), /map-abcd/);
});

// --- 주인 ---

test('다른 세션이 주인이면 상태줄이 그렇게 말한다 — 이 세션은 판정되지 않는다', () => {
  assert.equal(statusLine({ ...claimed, owner: false }, usageAt(420_000)), '🧭 [결제 모듈 이전] · 다른 세션이 주인');
});

// claim 한 턴 끝, 첫 Stop 전에는 주인이 적히기 전이다 — 여기서 «다른 세션» 이라 그리면 거짓말이다.
test('주인이 아직 정해지지 않았으면 평소대로 그린다', () => {
  assert.equal(statusLine({ ...claimed, owner: null }, usageAt(420_000)), '🧭 [결제 모듈 이전] · 밀기 2 · 막힘 0 · 질문 0 · 컨텍스트 42%/50%');
});

test('bd 를 못 읽었으면 프론티어를 0 이 아니라 모름으로 그린다', () => {
  assert.equal(statusLine({ ...claimed, frontier: null }, usageAt(420_000)), '🧭 [결제 모듈 이전] · 밀기 ? · 막힘 ? · 질문 ? · 컨텍스트 42%/50%');
});
