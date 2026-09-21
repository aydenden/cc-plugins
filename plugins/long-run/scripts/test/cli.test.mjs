import test from 'node:test';
import assert from 'node:assert/strict';
import { Bail, planSelfClose, submissionOf } from '../lib/cli.mjs';

// --- submissionOf ---
//
// 아래 수령증은 실측 `orca terminal send --json` 의 `result.send` 다. 화면 문자열을 읽어 착지를
// 추측하던 이전 판정을 이것으로 대체했다 — 제출 여부는 orca 가 직접 관측해 알려준다.

const proven = {
  handle: 'term_x',
  accepted: true,
  bytesWritten: 80,
  prompt: {
    requestId: '7fa9bdeb-bb31-46d0-aed7-392ff359616b',
    stages: ['input_accepted', 'turn_started'],
    provider: 'claude',
    observation: 'supported',
    processIncarnation: '0506bf39-657e-43e8-a8c9-913eaf85d0b0',
    generation: 120,
  },
};

test('turn_started 가 있으면 제출이 증명됐다', () => {
  const s = submissionOf(proven);
  assert.equal(s.proven, true);
  assert.equal(s.observable, true);
  assert.equal(s.requestId, '7fa9bdeb-bb31-46d0-aed7-392ff359616b');
  assert.equal(s.provider, 'claude');
});

// 🚨 이것이 이전 판정이 틀렸던 자리다. 입력이 받아들여진 것과 턴이 시작된 것은 다른 사건이고,
// accepted 만 보면 유실을 착지로 읽는다.
test('accepted 는 제출의 증거가 아니다 — input_accepted 까지면 미증명이다', () => {
  const s = submissionOf({ ...proven, prompt: { ...proven.prompt, stages: ['input_accepted'] } });
  assert.equal(s.accepted, true);
  assert.equal(s.proven, false);
  assert.equal(s.observable, true);
});

// 구 호스트는 관측 자체를 못 한다. 없는 증거를 만들지 않고 «증명 불가» 를 그대로 싣는다.
test('관측을 지원하지 않는 호스트는 observable 이 거짓이다', () => {
  const s = submissionOf({ accepted: true, prompt: { stages: [], observation: 'old-host', requestId: null } });
  assert.equal(s.observable, false);
  assert.equal(s.proven, false);
});

test('수령증에 prompt 절이 없어도(원시 입력) 죽지 않는다', () => {
  const s = submissionOf({ accepted: true });
  assert.deepEqual(s.stages, []);
  assert.equal(s.proven, false);
  assert.equal(s.requestId, null);
});

test('수령증이 아예 없으면 전부 거짓이다', () => {
  const s = submissionOf(undefined);
  assert.equal(s.accepted, false);
  assert.equal(s.proven, false);
});

// --- planSelfClose ---

const withHandle = { ORCA_TERMINAL_HANDLE: 'term_abc' };

test('핸들이 있으면 기본 지연으로 예약된다', () => {
  const plan = planSelfClose({ env: withHandle });
  assert.equal(plan.scheduled, true);
  assert.equal(plan.handle, 'term_abc');
  assert.equal(plan.delayMs, 30000);
});

// 자기 탭을 닫는 일이라, 핸들이 없으면 '아무 탭도 닫지 않는다'가 유일하게 안전한 결과다.
test('핸들이 없으면 예약하지 않고 이유를 남긴다', () => {
  const plan = planSelfClose({ env: {} });
  assert.equal(plan.scheduled, false);
  assert.match(plan.reason, /ORCA_TERMINAL_HANDLE/);
});

// 인계 자체는 이미 성공한 뒤다 — 닫기를 못 걸었다고 send 를 실패로 만들지 않는다.
test('orca 가 아닌 터미널에서도 send 를 깨지 않는다', () => {
  assert.doesNotThrow(() => planSelfClose({ env: {} }));
});

test('지연은 초로 받는다', () => {
  assert.equal(planSelfClose({ env: withHandle, delaySeconds: 90 }).delayMs, 90000);
  assert.equal(planSelfClose({ env: withHandle, delaySeconds: '45' }).delayMs, 45000);
});

// 보고 출력과 Stop hook 이 끝나기 전에 pty 가 죽으면 인계 기록이 통째로 사라진다.
test('보고가 끝나기 전에 닫을 만큼 짧은 지연은 거부한다', () => {
  assert.throws(() => planSelfClose({ env: withHandle, delaySeconds: 3 }), Bail);
  assert.throws(() => planSelfClose({ env: withHandle, delaySeconds: 'soon' }), Bail);
});
