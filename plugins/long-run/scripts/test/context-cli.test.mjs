/**
 * 모델이 직접 부르는 `status` 가 세션의 컨텍스트를 재는지 — CLI 배선 시험.
 *
 * 순수 판단은 `context-reading.test.mjs` 가 본다. 여기는 파일과 환경변수를 잇는 자리다: 2026-11-19·22
 * 세션은 SKILL 대로 인자 없이 `status` 를 쳐 늘 «계측 불가» 를 받고 컨텍스트를 짐작해 인계했다.
 * bd 는 PATH 의 가짜로 갈아 끼운다 — 실제 bd 는 저장소 밖에서 수십 초가 걸린다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = fileURLToPath(new URL('../frontier-guard.mjs', import.meta.url));
const SESSION = '11111111-2222-3333-4444-555555555555';

/** 상태 루트·cwd·설정 폴더·가짜 bd 를 임시로 둔다. 세션 id 는 Claude Code 가 Bash 에 싣는 환경변수로 준다. */
function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'lr-context-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const [state, cwd, config, bin] = ['state', 'cwd', 'config', 'bin'].map((name) => {
    mkdirSync(join(root, name));
    return join(root, name);
  });
  // schema 는 못 읽는 출력이다 — claim 이 대조를 건너뛴다(빈 schema 면 빠진 칸으로 거부한다).
  writeFileSync(join(bin, 'bd'), '#!/bin/sh\ncase "$1" in version) echo "bd version 1.3.4";; schema) echo "?";; *) echo "[]";; esac\n');
  chmodSync(join(bin, 'bd'), 0o755);

  const env = {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env.PATH}`,
    LONG_RUN_STATE_ROOT: state,
    CLAUDE_CONFIG_DIR: config,
    CLAUDE_CODE_SESSION_ID: SESSION,
  };
  const run = (...args) => {
    const res = spawnSync(process.execPath, [GUARD, ...args], { cwd, encoding: 'utf8', env });
    return { code: res.status, out: res.stdout, err: res.stderr };
  };
  run.status = (...args) => {
    const res = run('status', ...args);
    assert.equal(res.code, 0, res.err);
    return JSON.parse(res.out);
  };
  run.transcript = (tokens, model) => {
    const dir = join(config, 'projects', '-some-project');
    mkdirSync(dir, { recursive: true });
    const usage = { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: tokens - 2 };
    writeFileSync(join(dir, `${SESSION}.jsonl`), `${JSON.stringify({ type: 'assistant', message: { model, usage } })}\n`);
  };
  run.readings = () => {
    const dir = join(state, 'frontier-guard', 'context');
    return existsSync(dir) ? readdirSync(dir) : [];
  };
  return run;
}

test('🚨 인자 없는 status 도 자기 세션의 트랜스크립트를 찾아 잰다 — 창을 모르면 담은 양으로 고친다', (t) => {
  const guard = sandbox(t);
  assert.equal(guard('claim', 'map-x').code, 0);
  guard.transcript(266_483, 'claude-opus-5-5');

  const status = guard.status();
  assert.equal(status.measured, true);
  assert.equal(status.contextTokens, 266_483);
  assert.equal(status.contextLimit, 1_000_000, '200k 로 재면 133% 로 이른 인계를 시킨다');
  assert.equal(status.source, 'transcript');
});

test('mod 가 실어 보낸 값을 남기고, 다음 status 는 인자 없이도 그 값을 읽는다', (t) => {
  const guard = sandbox(t);
  guard('claim', 'map-x');
  guard.transcript(100_000, 'claude-opus-5-5');

  guard.status('--session', SESSION, '--tokens', '420000', '--window', '1000000');
  const status = guard.status();
  assert.equal(status.source, 'session');
  assert.equal(status.contextTokens, 420_000);
  assert.equal(status.contextLimit, 1_000_000);
});

test('압축 직후처럼 채움 없이 창만 오면 지난 큰 값을 지우고 트랜스크립트로 잰다', (t) => {
  const guard = sandbox(t);
  guard('claim', 'map-x');
  guard.transcript(30_000, 'claude-opus-5-5');

  guard.status('--session', SESSION, '--tokens', '900000', '--window', '1000000');
  guard.status('--session', SESSION, '--window', '1000000');
  const status = guard.status();
  assert.equal(status.source, 'transcript');
  assert.equal(status.contextTokens, 30_000);
  assert.equal(status.contextLimit, 1_000_000, '창은 세션이 알려 준 것');
});

test('맵을 선언하지 않은 worktree 의 세션 값은 남기지 않는다', (t) => {
  const guard = sandbox(t);
  guard.status('--session', SESSION, '--tokens', '420000', '--window', '1000000');
  assert.deepEqual(guard.readings(), []);
});

test('세션도 트랜스크립트도 없으면 여전히 «못 쟀다» 다', (t) => {
  const guard = sandbox(t);
  guard('claim', 'map-x');
  const status = guard.status();
  assert.equal(status.measured, false);
  assert.equal(status.source, 'none');
});
