import test from 'node:test';
import assert from 'node:assert/strict';

import { HANDOFF_RATIO, contextLimitOf, contextTokensOf, decide, readTranscriptTail } from '../lib/guard-core.mjs';

const marker = { epic: 'map-abcd' };
const open = [{ id: 'map-abcd.9' }, { id: 'map-abcd.11' }];
const base = { marker, contextTokens: 100_000, contextLimit: 1_000_000, openChildren: open, stopHookActive: false };

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

test('프론티어가 비면 통과시키고 선언을 지운다', () => {
  const verdict = decide({ ...base, openChildren: [] });
  assert.equal(verdict.block, false);
  assert.equal(verdict.clear, true);
});

test('컨텍스트가 절반을 넘으면 이어가지 말고 넘기라고 한다', () => {
  const verdict = decide({ ...base, contextTokens: 600_000 });
  assert.equal(verdict.block, true);
  assert.match(verdict.reason, /session-handoff/);
  assert.match(verdict.reason, /60%/);
  // 이어가라는 말과 섞이면 안 된다 — 두 지시가 한 메시지에 있으면 어느 쪽을 따를지 모른다.
  assert.doesNotMatch(verdict.reason, /claim/);
});

test('인계 지시는 이 플러그인의 스킬 이름을 가리킨다 — 다른 네임스페이스를 부르면 없는 스킬이다', () => {
  assert.match(decide({ ...base, contextTokens: 600_000 }).reason, /\/long-run:session-handoff/);
});

test('경계는 비율이 아니라 창 크기로 정해진다 — 표준 창이면 같은 토큰이 이미 초과다', () => {
  assert.match(decide({ ...base, contextLimit: 200_000 }).reason, /session-handoff/);
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
