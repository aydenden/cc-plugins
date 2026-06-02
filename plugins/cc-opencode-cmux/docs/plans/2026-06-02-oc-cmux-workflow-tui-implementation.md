# OC cmux Workflow TUI 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** CC(A)가 cmux 우측 패널에 ink TUI(B)를 띄워 phase 배리어 + 동시성 큐(cap 3)로 OpenCode 워커를 오케스트레이션하고, 완료 시 `cmux wait-for` 신호로 A에 결과 폴더를 넘기는 워크플로 모드를 구현한다.

**Architecture:** B(ink TUI)는 SSE를 직접 다루지 않고 `oc-delegate.sh`를 child_process로 spawn하는 풀 매니저다(`oc-prompt.sh` POST가 동기적이라 child exit가 곧 완료 신호). 로직(manifest 검증·리포트 파싱·큐 스케줄러·결과 집계)은 순수 모듈로 분리해 `node:test`로 단위 테스트하고, ink 렌더는 수동 검증한다. 진입점은 `oc-delegate.sh --workflow`.

**Tech Stack:** Node v26(내장 `node:test`/`node:assert`, ESM), ink 6.4.11(글로벌), bash, cmux CLI, 기존 `oc-delegate.sh`/`oc-cmux-panel.sh`.

**참고:** 설계 문서 `2026-06-02-oc-cmux-workflow-tui-design.md` (특히 §13 해소 결과).

---

## 디렉토리 레이아웃 (구현 후)

```
plugins/cc-opencode-cmux/
├── bin/
│   ├── oc-cmux-panel.sh           # 신규: cmux 패널 생명주기
│   ├── oc-workflow-tui.js         # 신규: ink 엔트리
│   └── workflow/                  # 신규: 순수 로직 모듈
│       ├── report-parse.js
│       ├── manifest.js
│       ├── scheduler.js
│       ├── aggregate.js
│       ├── worker.js              # oc-delegate spawn (얇은 어댑터)
│       ├── render.js              # ink 컴포넌트
│       └── __tests__/
│           ├── report-parse.test.js
│           ├── manifest.test.js
│           ├── scheduler.test.js
│           └── aggregate.test.js
├── package.json                   # 신규: type:module, test 스크립트
└── ...
```

---

## Task 0: 스캐폴드

**Files:**
- Create: `plugins/cc-opencode-cmux/package.json`
- Create: `plugins/cc-opencode-cmux/bin/workflow/` (디렉토리)

**Step 1: package.json 작성**

```json
{
  "name": "cc-opencode-cmux-workflow",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test bin/workflow/__tests__/"
  }
}
```

**Step 2: 디렉토리 생성**

Run: `mkdir -p plugins/cc-opencode-cmux/bin/workflow/__tests__`
Expected: 성공(출력 없음)

**Step 3: node:test 동작 확인용 더미**

`bin/workflow/__tests__/smoke.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('smoke', () => assert.equal(1 + 1, 2));
```

**Step 4: 테스트 실행**

Run: `cd plugins/cc-opencode-cmux && npm test`
Expected: PASS (1 test). 이후 smoke.test.js 삭제.

**Step 5: Commit**

```bash
git add plugins/cc-opencode-cmux/package.json
git commit -m "chore(cc-opencode-cmux): workflow 모듈 스캐폴드 + node:test 셋업"
```

---

## Task 1: report-parse.js — oc-delegate 7줄 리포트 파서

**Files:**
- Create: `bin/workflow/report-parse.js`
- Test: `bin/workflow/__tests__/report-parse.test.js`

**Step 1: 실패 테스트 작성**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReport } from '../report-parse.js';

const SAMPLE = `status:   done
session:  /tmp/oc/s1
oc_sid:   ses_abc123
files:    +12 -3 (4 files)
diff:     /tmp/oc/s1/diff.patch
done:     0 session idle
notes:    `;

test('parseReport extracts fields', () => {
  const r = parseReport(SAMPLE);
  assert.equal(r.status, 'done');
  assert.equal(r.session, '/tmp/oc/s1');
  assert.equal(r.oc_sid, 'ses_abc123');
  assert.equal(r.add, 12);
  assert.equal(r.del, 3);
  assert.equal(r.files, 4);
  assert.equal(r.diff, '/tmp/oc/s1/diff.patch');
});

test('parseReport handles missing fields gracefully', () => {
  const r = parseReport('status:   error\nnotes:    boom');
  assert.equal(r.status, 'error');
  assert.equal(r.add, 0);
  assert.equal(r.files, 0);
  assert.equal(r.notes, 'boom');
});
```

**Step 2: 실패 확인**

Run: `npm test` → FAIL ("Cannot find module '../report-parse.js'")

**Step 3: 최소 구현**

`bin/workflow/report-parse.js`:
```js
/**
 * oc-delegate.sh 의 7줄 stdout 리포트를 구조화 객체로 파싱한다.
 * @param {string} stdout - status/session/oc_sid/files/diff/done/notes 7줄
 * @returns {{status,session,oc_sid,add,del,files,diff,done,notes:string|number}}
 */
export function parseReport(stdout) {
  const lines = String(stdout).split('\n');
  const get = (key) => {
    const line = lines.find((l) => l.startsWith(key + ':'));
    return line ? line.slice(key.length + 1).trim() : '';
  };
  const files = get('files'); // "+12 -3 (4 files)"
  const m = files.match(/\+(\d+)\s+-(\d+)\s+\((\d+)\s+files?\)/);
  return {
    status: get('status'),
    session: get('session'),
    oc_sid: get('oc_sid'),
    add: m ? Number(m[1]) : 0,
    del: m ? Number(m[2]) : 0,
    files: m ? Number(m[3]) : 0,
    diff: get('diff'),
    done: get('done'),
    notes: get('notes'),
  };
}
```

**Step 4: 통과 확인**

Run: `npm test` → PASS (2 tests)

**Step 5: Commit**

```bash
git add bin/workflow/report-parse.js bin/workflow/__tests__/report-parse.test.js
git commit -m "feat(cc-opencode-cmux): oc-delegate 리포트 파서 추가"
```

---

## Task 2: manifest.js — 입력 계약 검증

**Files:**
- Create: `bin/workflow/manifest.js`
- Test: `bin/workflow/__tests__/manifest.test.js`

**Step 1: 실패 테스트**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManifest } from '../manifest.js';

const ok = {
  workdir: '/tmp/wf',
  phases: [
    { id: 'research', specs: [
      { id: 's1', prompt_file: '/tmp/s1.md', dir: '/tmp', task_type: 'research' },
    ] },
  ],
};

test('valid manifest normalizes defaults', () => {
  const m = validateManifest(ok);
  assert.equal(m.concurrency, 3);
  assert.equal(m.notify, 'on-complete');
  assert.equal(m.phases[0].concurrency, 3);
  assert.equal(m.phases[0].specs[0].task_type, 'research');
});

test('rejects empty phases', () => {
  assert.throws(() => validateManifest({ workdir: '/x', phases: [] }), /phases/);
});

test('rejects spec without prompt_file', () => {
  assert.throws(() => validateManifest({
    workdir: '/x', phases: [{ id: 'p', specs: [{ id: 's', dir: '/x' }] }],
  }), /prompt_file/);
});

test('per-phase concurrency override', () => {
  const m = validateManifest({ ...ok, concurrency: 5,
    phases: [{ id: 'p', concurrency: 2, specs: ok.phases[0].specs }] });
  assert.equal(m.concurrency, 5);
  assert.equal(m.phases[0].concurrency, 2);
});
```

**Step 2: 실패 확인** → Run: `npm test` → FAIL

**Step 3: 구현**

`bin/workflow/manifest.js`:
```js
import { readFileSync } from 'node:fs';

/** manifest.json 파일을 읽어 검증·정규화한다. */
export function loadManifest(path) {
  return validateManifest(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * A→B 계약(manifest)을 검증하고 기본값을 채운 정규화 객체를 반환한다.
 * 실패 시 throw (fail-fast).
 */
export function validateManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('manifest must be an object');
  if (typeof m.workdir !== 'string' || !m.workdir) throw new Error('workdir required');
  if (!Array.isArray(m.phases) || m.phases.length === 0) {
    throw new Error('phases must be a non-empty array');
  }
  const concurrency = m.concurrency ?? 3;
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be an integer >= 1');
  }
  const notify = m.notify ?? 'on-complete';
  if (!['on-complete', 'per-phase'].includes(notify)) {
    throw new Error(`invalid notify: ${notify}`);
  }
  const phases = m.phases.map((p, i) => {
    if (!p || !p.id) throw new Error(`phase[${i}].id required`);
    if (!Array.isArray(p.specs) || p.specs.length === 0) {
      throw new Error(`phase ${p.id}: specs must be non-empty`);
    }
    const pc = p.concurrency ?? concurrency;
    if (!Number.isInteger(pc) || pc < 1) throw new Error(`phase ${p.id}: bad concurrency`);
    const specs = p.specs.map((s, j) => {
      if (!s || !s.id) throw new Error(`phase ${p.id} spec[${j}].id required`);
      if (!s.prompt_file) throw new Error(`spec ${s.id}: prompt_file required`);
      if (!s.dir) throw new Error(`spec ${s.id}: dir required`);
      return { id: s.id, task_type: s.task_type ?? 'implement',
               prompt_file: s.prompt_file, dir: s.dir };
    });
    return { id: p.id, concurrency: pc, specs };
  });
  return { workdir: m.workdir, concurrency, notify, phases };
}
```

**Step 4: 통과 확인** → Run: `npm test` → PASS

**Step 5: Commit**

```bash
git add bin/workflow/manifest.js bin/workflow/__tests__/manifest.test.js
git commit -m "feat(cc-opencode-cmux): manifest 스키마 검증 추가"
```

---

## Task 3: scheduler.js — phase 배리어 + 동시성 큐 (핵심)

**Files:**
- Create: `bin/workflow/scheduler.js`
- Test: `bin/workflow/__tests__/scheduler.test.js`

핵심 불변식: (a) 동시 실행 ≤ cap, (b) phase 배리어(다음 phase는 이전 phase 전부 완료 후), (c) 실패해도 계속. `runWorker`를 주입해 child spawn 없이 테스트한다.

**Step 1: 실패 테스트**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWorkflow } from '../scheduler.js';

// 동시성 추적 mock worker
function makeTracker() {
  let active = 0, peak = 0;
  const order = [];
  const runWorker = async (spec) => {
    active++; peak = Math.max(peak, active);
    order.push(`start:${spec.id}`);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    order.push(`end:${spec.id}`);
    // s-fail 로 끝나는 spec 은 실패로 보고
    return { status: spec.id.endsWith('fail') ? 'error' : 'done',
             session: `/wf/${spec.id}`, exit_code: spec.id.endsWith('fail') ? 13 : 0 };
  };
  return { runWorker, peak: () => peak, order };
}

const manifest = {
  workdir: '/wf', concurrency: 3, notify: 'on-complete',
  phases: [
    { id: 'p1', concurrency: 3, specs: Array.from({ length: 7 },
        (_, i) => ({ id: `a${i}`, task_type: 'x', prompt_file: '/x', dir: '/x' })) },
    { id: 'p2', concurrency: 2, specs: [
        { id: 'b0', prompt_file: '/x', dir: '/x' },
        { id: 'b1fail', prompt_file: '/x', dir: '/x' }] },
  ],
};

test('respects concurrency cap per phase', async () => {
  const t = makeTracker();
  await runWorkflow(manifest, t.runWorker, () => {});
  assert.ok(t.peak() <= 3, `peak ${t.peak()} exceeded cap 3`);
});

test('phase barrier: all p1 end before any p2 start', async () => {
  const t = makeTracker();
  await runWorkflow(manifest, t.runWorker, () => {});
  const firstP2 = t.order.findIndex((e) => e.startsWith('start:b'));
  const lastP1End = t.order.map((e, i) => [e, i])
    .filter(([e]) => e.startsWith('end:a')).pop()[1];
  assert.ok(lastP1End < firstP2, 'p2 started before p1 finished');
});

test('continues past failures and records them', async () => {
  const t = makeTracker();
  const res = await runWorkflow(manifest, t.runWorker, () => {});
  const p2 = res.find((p) => p.id === 'p2');
  assert.equal(p2.results.length, 2);
  assert.equal(p2.results.filter((r) => r.status !== 'done').length, 1);
});
```

**Step 2: 실패 확인** → Run: `npm test` → FAIL

**Step 3: 구현**

`bin/workflow/scheduler.js`:
```js
/**
 * 한 phase 의 spec 들을 동시성 cap 으로 큐 실행한다. 실패해도 멈추지 않는다.
 * @param {object} phase            정규화된 phase {id, concurrency, specs}
 * @param {string} workdir
 * @param {(spec, sessionDir)=>Promise<object>} runWorker  주입식 워커 실행기
 * @param {(state)=>void} onUpdate  렌더 콜백 (running/queued/done/failed)
 * @returns {Promise<Array<object>>} 각 spec 의 결과 리포트 배열
 */
export function runPhase(phase, workdir, runWorker, onUpdate) {
  const queue = [...phase.specs];
  const cap = phase.concurrency;
  const results = [];
  let running = 0;
  const state = { phaseId: phase.id, total: phase.specs.length,
                  done: 0, failed: 0, running: 0, queued: queue.length };
  const emit = () => onUpdate({ ...state });

  return new Promise((resolve) => {
    const pump = () => {
      if (running === 0 && queue.length === 0) { resolve(results); return; }
      while (running < cap && queue.length) {
        const spec = queue.shift();
        running++;
        state.running = running; state.queued = queue.length;
        emit();
        const sessionDir = `${workdir}/phase-${phase.id}/${spec.id}`;
        Promise.resolve()
          .then(() => runWorker(spec, sessionDir))
          .then((report) => {
            results.push({ spec: spec.id, ...report });
            if (report.status === 'done') state.done++; else state.failed++;
          })
          .catch((err) => {
            results.push({ spec: spec.id, status: 'error',
                           session: sessionDir, notes: String(err) });
            state.failed++;
          })
          .finally(() => {
            running--;
            state.running = running; state.queued = queue.length;
            emit();
            pump();
          });
      }
    };
    pump();
  });
}

/**
 * 전체 워크플로를 phase 배리어로 순차 실행한다 (각 phase await → 다음 phase).
 * @returns {Promise<Array<{id, results}>>}
 */
export async function runWorkflow(manifest, runWorker, onUpdate) {
  const out = [];
  for (const phase of manifest.phases) {
    const results = await runPhase(phase, manifest.workdir, runWorker, onUpdate);
    out.push({ id: phase.id, results });
  }
  return out;
}
```

**Step 4: 통과 확인** → Run: `npm test` → PASS (cap·배리어·실패지속 3 tests)

**Step 5: Commit**

```bash
git add bin/workflow/scheduler.js bin/workflow/__tests__/scheduler.test.js
git commit -m "feat(cc-opencode-cmux): phase 배리어 + 동시성 큐 스케줄러 추가"
```

---

## Task 4: aggregate.js — result.json / failures.json 생성

**Files:**
- Create: `bin/workflow/aggregate.js`
- Test: `bin/workflow/__tests__/aggregate.test.js`

**Step 1: 실패 테스트**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildResult } from '../aggregate.js';

const phaseResults = [
  { id: 'p1', results: [
    { spec: 'a0', status: 'done', session: '/wf/a0' },
    { spec: 'a1', status: 'done', session: '/wf/a1' } ] },
  { id: 'p2', results: [
    { spec: 'b0', status: 'done', session: '/wf/b0' },
    { spec: 'b1', status: 'error', exit_code: 13, session: '/wf/b1', notes: 'boom' } ] },
];

test('summary counts per phase', () => {
  const r = buildResult(phaseResults);
  assert.equal(r.status, 'completed_with_failures');
  assert.deepEqual(r.phases[0], { id: 'p1', total: 2, done: 2, failed: 0 });
  assert.deepEqual(r.phases[1], { id: 'p2', total: 2, done: 1, failed: 1 });
});

test('failures list isolates failed specs', () => {
  const r = buildResult(phaseResults);
  assert.equal(r.failures.length, 1);
  assert.equal(r.failures[0].spec, 'b1');
  assert.equal(r.failures[0].exit_code, 13);
  assert.equal(r.failures[0].phase, 'p2');
});

test('all-done → completed', () => {
  const r = buildResult([{ id: 'p', results: [{ spec: 's', status: 'done' }] }]);
  assert.equal(r.status, 'completed');
  assert.equal(r.failures.length, 0);
});
```

**Step 2: 실패 확인** → Run: `npm test` → FAIL

**Step 3: 구현**

`bin/workflow/aggregate.js`:
```js
/**
 * phase 결과 배열에서 분석 친화 요약(result.json 내용)을 만든다.
 * 성공/실패를 phase 카운트 + failures[] 로 분리한다.
 */
export function buildResult(phaseResults) {
  const phases = phaseResults.map((p) => ({
    id: p.id,
    total: p.results.length,
    done: p.results.filter((r) => r.status === 'done').length,
    failed: p.results.filter((r) => r.status !== 'done').length,
  }));
  const failures = phaseResults.flatMap((p) =>
    p.results.filter((r) => r.status !== 'done').map((r) => ({
      phase: p.id,
      spec: r.spec,
      exit_code: r.exit_code ?? null,
      status: r.status,
      session_dir: r.session ?? null,
      notes: r.notes ?? '',
    })),
  );
  const status = failures.length === 0 ? 'completed' : 'completed_with_failures';
  return { status, phases, failures };
}
```

**Step 4: 통과 확인** → Run: `npm test` → PASS

**Step 5: Commit**

```bash
git add bin/workflow/aggregate.js bin/workflow/__tests__/aggregate.test.js
git commit -m "feat(cc-opencode-cmux): 결과 집계(result/failures) 추가"
```

---

## Task 5: worker.js — oc-delegate.sh child 어댑터

얇은 어댑터(통합 경계). 단위 테스트는 `echo` 가짜 delegate로 스폰 계약만 검증한다.

**Files:**
- Create: `bin/workflow/worker.js`
- Test: `bin/workflow/__tests__/worker.test.js`

**Step 1: 실패 테스트 (가짜 delegate 스크립트로 spawn 검증)**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeRunWorker } from '../worker.js';

test('spawns delegate with correct args and captures report.txt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wf-'));
  // 가짜 oc-delegate.sh: 인자를 기록하고 7줄 리포트를 stdout 으로
  const fake = join(dir, 'oc-delegate.sh');
  writeFileSync(fake, `#!/usr/bin/env bash
echo "$@" > "${dir}/got-args.txt"
printf 'status:   done\\nsession:  X\\noc_sid:   ses_1\\nfiles:    +1 -0 (1 files)\\ndiff:     X/diff.patch\\ndone:     0 idle\\nnotes:    \\n'
exit 0
`);
  chmodSync(fake, 0o755);

  const runWorker = makeRunWorker(fake);
  const spec = { id: 's1', task_type: 'research', prompt_file: '/tmp/p.md', dir: '/tmp/work' };
  const sessionDir = join(dir, 'phase-p/s1');
  const report = await runWorker(spec, sessionDir);

  assert.equal(report.status, 'done');
  assert.equal(report.exit_code, 0);
  assert.ok(existsSync(join(sessionDir, 'report.txt')));
  const args = readFileSync(join(dir, 'got-args.txt'), 'utf8');
  assert.match(args, /--session-dir .*phase-p\/s1/);
  assert.match(args, /--prompt-file \/tmp\/p\.md/);
  assert.match(args, /--dir \/tmp\/work/);
});
```

**Step 2: 실패 확인** → Run: `npm test` → FAIL

**Step 3: 구현**

`bin/workflow/worker.js`:
```js
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseReport } from './report-parse.js';

/**
 * oc-delegate.sh 경로를 받아 runWorker(spec, sessionDir) 를 만든다.
 * child exit = 완료 신호, stdout = 7줄 리포트 (report.txt 로 저장).
 */
export function makeRunWorker(delegatePath, timeout) {
  return (spec, sessionDir) =>
    new Promise((resolve) => {
      mkdirSync(sessionDir, { recursive: true });
      const args = ['--dir', spec.dir, '--prompt-file', spec.prompt_file,
                    '--session-dir', sessionDir, '--title', spec.id];
      if (timeout) args.push('--timeout', String(timeout));
      const child = spawn(delegatePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', (code) => {
        writeFileSync(`${sessionDir}/report.txt`, out);
        resolve({ ...parseReport(out), exit_code: code });
      });
      child.on('error', (err) => {
        resolve({ status: 'error', session: sessionDir,
                  notes: `spawn failed: ${err.message}`, exit_code: -1 });
      });
    });
}
```

**Step 4: 통과 확인** → Run: `npm test` → PASS

**Step 5: Commit**

```bash
git add bin/workflow/worker.js bin/workflow/__tests__/worker.test.js
git commit -m "feat(cc-opencode-cmux): oc-delegate child 워커 어댑터 추가"
```

---

## Task 6: render.js — ink TUI 컴포넌트 (수동 검증)

**Files:**
- Create: `bin/workflow/render.js`

ink는 입력을 받지 않고 상태를 렌더만 한다. phase 박스(진행 바 + running/queued/done/failed) + narrator 로그.

**Step 1: 구현 (ink 컴포넌트 + 렌더 핸들 반환)**

`bin/workflow/render.js`:
```js
import React from 'react';
import { render, Box, Text } from 'ink';

function bar(done, failed, total, width = 20) {
  const filled = total ? Math.round(((done + failed) / total) * width) : 0;
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function PhaseRow({ p }) {
  const color = p.failed ? 'yellow' : p.done === p.total ? 'green' : 'cyan';
  return React.createElement(Box, null,
    React.createElement(Text, { color },
      `${p.phaseId.padEnd(12)} ${bar(p.done, p.failed, p.total)} ` +
      `${p.running} run · ${p.queued} queue · ${p.done} done · ${p.failed} fail`));
}

function App({ getState }) {
  const [, force] = React.useReducer((x) => x + 1, 0);
  React.useEffect(() => {
    const id = setInterval(force, 120);
    return () => clearInterval(id);
  }, []);
  const s = getState();
  return React.createElement(Box, { flexDirection: 'column' },
    React.createElement(Text, { bold: true }, 'OC cmux Workflow'),
    ...s.phases.map((p) => React.createElement(PhaseRow, { key: p.phaseId, p })),
    React.createElement(Text, { dimColor: true }, s.narrator || ''));
}

/** 가변 상태를 읽는 getState 를 받아 ink 렌더를 시작하고 unmount 핸들을 반환. */
export function startRender(getState) {
  const { unmount } = render(React.createElement(App, { getState }));
  return unmount;
}
```

**Step 2: 수동 스모크 (가짜 상태 애니메이션)**

`/tmp/render-smoke.mjs`:
```js
import { startRender } from '<abs>/bin/workflow/render.js';
let phases = [{ phaseId: 'research', total: 5, done: 0, failed: 0, running: 3, queued: 2 }];
const unmount = startRender(() => ({ phases, narrator: 'running...' }));
let n = 0;
const id = setInterval(() => {
  phases[0].done = Math.min(5, ++n); phases[0].queued = Math.max(0, 5 - n - 3);
  if (n >= 5) { clearInterval(id); setTimeout(() => { unmount(); process.exit(0); }, 300); }
}, 300);
```

Run: `node /tmp/render-smoke.mjs`
Expected: phase 바가 채워지며 카운트가 갱신되는 TUI. (ink import 실패 시 Task 6 비고의 의존성 경로 조정)

**비고 — ink 의존성 경로:** ink가 글로벌이라 `node`가 못 찾으면 `NODE_PATH=$(npm root -g) node ...` 로 실행하거나, 패키징 단계에서 `bin/`에 로컬 설치(`npm i ink react`)한다. 이 결정은 Task 7 통합 시 확정한다.

**Step 3: Commit**

```bash
git add bin/workflow/render.js
git commit -m "feat(cc-opencode-cmux): ink TUI 렌더 컴포넌트 추가"
```

---

## Task 7: oc-workflow-tui.js — 엔트리 (조합 + 완료 신호)

**Files:**
- Create: `bin/oc-workflow-tui.js`

manifest 로드 → ink 렌더 시작 → `runWorkflow` → result.json/failures.json 기록 → `cmux wait-for -S <signal>` 발신.

**Step 1: 구현**

`bin/oc-workflow-tui.js`:
```js
#!/usr/bin/env node
import { writeFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from './workflow/manifest.js';
import { runWorkflow } from './workflow/scheduler.js';
import { buildResult } from './workflow/aggregate.js';
import { makeRunWorker } from './workflow/worker.js';
import { startRender } from './workflow/render.js';

const __dir = dirname(fileURLToPath(import.meta.url));

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

const manifestPath = arg('--manifest');
const signal = arg('--signal');           // cmux wait-for 신호 이름 (done-<surf>)
const cmuxBin = arg('--cmux', process.env.CMUX_BIN || 'cmux');
const timeout = arg('--timeout');
if (!manifestPath) { console.error('--manifest required'); process.exit(2); }

const manifest = loadManifest(manifestPath);
const runWorker = makeRunWorker(join(__dir, 'oc-delegate.sh'), timeout);

// 가변 렌더 상태
const phaseState = new Map();
let narrator = 'starting…';
const getState = () => ({
  phases: manifest.phases.map((p) => phaseState.get(p.id) ??
    { phaseId: p.id, total: p.specs.length, done: 0, failed: 0, running: 0, queued: p.specs.length }),
  narrator,
});
const logFile = join(manifest.workdir, 'tui.log');
const onUpdate = (st) => {
  phaseState.set(st.phaseId, st);
  narrator = `phase ${st.phaseId}: ${st.done}/${st.total} done, ${st.failed} fail`;
  appendFileSync(logFile, `${new Date().toISOString()} ${narrator}\n`);
  // notify=per-phase 시 phase 완료 라인을 stdout 으로 (Monitor 이벤트)
  if (manifest.notify === 'per-phase' && st.running === 0 && st.queued === 0) {
    process.stdout.write(`PHASE_DONE ${st.phaseId} ${st.done}/${st.total} ${st.failed}fail\n`);
  }
};

const unmount = startRender(getState);

const phaseResults = await runWorkflow(manifest, runWorker, onUpdate);
const result = buildResult(phaseResults);
writeFileSync(join(manifest.workdir, 'result.json'), JSON.stringify(result, null, 2));
writeFileSync(join(manifest.workdir, 'failures.json'), JSON.stringify(result.failures, null, 2));
narrator = `done: ${result.status}`;

setTimeout(() => {
  unmount();
  if (signal) spawnSync(cmuxBin, ['wait-for', '-S', signal], { stdio: 'ignore' });
  process.exit(0);
}, 400);
```

**Step 2: 수동 통합 스모크 (가짜 delegate)**

Task 5의 가짜 delegate 패턴으로 2-phase manifest를 만들어 `node bin/oc-workflow-tui.js --manifest /tmp/m.json`(signal 생략) 실행 → `result.json`/`failures.json`/`tui.log` 생성 확인.

Run: `node bin/oc-workflow-tui.js --manifest /tmp/m.json`
Expected: TUI 표시 후 종료, `/tmp/wf/result.json`에 phase 카운트 존재.

**Step 3: Commit**

```bash
git add bin/oc-workflow-tui.js
git commit -m "feat(cc-opencode-cmux): workflow TUI 엔트리(조합+완료신호) 추가"
```

---

## Task 8: oc-cmux-panel.sh — 패널 생명주기 + cmux 부재 실패

`cmux-panel.sh`를 본 용도로 슬림화. open(우측 split)/run(TUI 실행)/wait(wait-for)/close. **cmux 미발견 시 즉시 exit 3.**

**Files:**
- Create: `bin/oc-cmux-panel.sh`
- Test: `bin/workflow/__tests__/panel.test.sh` (bash, CMUX_BIN을 가짜로 주입)

**Step 1: 실패 테스트 (bash)**

`bin/workflow/__tests__/panel.test.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")/../.." && pwd)"
PANEL="$HERE/oc-cmux-panel.sh"

# 1) cmux 부재 → exit 3
if CMUX_BIN=/nonexistent/cmux "$PANEL" open /tmp 2>/dev/null; then
  echo "FAIL: expected non-zero on missing cmux"; exit 1
fi
echo "ok: missing cmux fails"

# 2) 가짜 cmux 로 open 이 surface 출력
FAKE=$(mktemp); cat > "$FAKE" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  new-split) echo "surface:1 11111111-1111-1111-1111-111111111111" ;;
  send|send-key) : ;;
  *) : ;;
esac
EOF
chmod +x "$FAKE"
out=$(CMUX_BIN="$FAKE" "$PANEL" open /tmp)
echo "$out" | grep -qE '[0-9a-f]{8}-' && echo "ok: open prints uuid" || { echo "FAIL"; exit 1; }
echo "ALL PASS"
```

**Step 2: 실패 확인** → Run: `bash bin/workflow/__tests__/panel.test.sh` → FAIL (PANEL 없음)

**Step 3: 구현**

`bin/oc-cmux-panel.sh` (cmux-panel.sh의 open/wait/close 차용 + run):
```bash
#!/usr/bin/env bash
# oc-cmux-panel.sh — workflow TUI 용 cmux 우측 패널 생명주기.
# cmux 미존재 시 즉시 실패(fallback 없음).
set -euo pipefail
CMUX="${CMUX_BIN:-$(command -v cmux 2>/dev/null || echo /Applications/cmux.app/Contents/Resources/bin/cmux)}"
[ -x "$CMUX" ] || { echo "cmux not found: $CMUX (set CMUX_BIN)" >&2; exit 3; }
UUID_RE='[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'

cmd="${1:-}"; shift || true
case "$cmd" in
  open)
    cwd="${1:?usage: open <cwd>}"
    out=$("$CMUX" new-split right --focus false --id-format both 2>&1)
    surf=$(printf '%s' "$out" | grep -oE "$UUID_RE" | head -1)
    [ -n "$surf" ] || { echo "surface uuid 추출 실패: $out" >&2; exit 1; }
    "$CMUX" send --surface "$surf" "cd '$cwd'" >/dev/null
    "$CMUX" send-key --surface "$surf" Enter >/dev/null
    echo "$surf"
    ;;
  run)
    # run <surf> <tui-cmd...> : 패널에서 TUI 실행 (완료신호는 TUI 가 직접 발신)
    surf="${1:?usage: run <surf> <cmd...>}"; shift
    "$CMUX" send --surface "$surf" "$*" >/dev/null
    "$CMUX" send-key --surface "$surf" Enter >/dev/null
    echo "running on $surf"
    ;;
  wait)
    sig="${1:?usage: wait <signal> [timeout]}"; to="${2:-1800}"
    "$CMUX" wait-for "$sig" --timeout "$to"
    ;;
  close)
    surf="${1:?usage: close <surf>}"
    "$CMUX" close-surface --surface "$surf" 2>&1 | head -1
    ;;
  *) echo "usage: oc-cmux-panel.sh <open|run|wait|close> ..." >&2; exit 2 ;;
esac
```

`chmod +x bin/oc-cmux-panel.sh`

**Step 4: 통과 확인** → Run: `bash bin/workflow/__tests__/panel.test.sh` → ALL PASS

**Step 5: Commit**

```bash
git add bin/oc-cmux-panel.sh bin/workflow/__tests__/panel.test.sh
git commit -m "feat(cc-opencode-cmux): cmux 패널 생명주기 스크립트 추가"
```

---

## Task 9: oc-delegate.sh — `--workflow` 분기 추가

`--workflow --manifest M` 이면 패널+TUI 경로로 분기. 기존 단일 위임 경로는 그대로.

**Files:**
- Modify: `bin/oc-delegate.sh` (인자 파싱부 + 분기)

**Step 1: 분기 로직 추가 (인자 파싱 직후)**

`oc-delegate.sh`의 `while [ $# -gt 0 ]` 파서에 `--workflow`/`--manifest` 케이스를 추가하고, 파싱 직후 분기:
```bash
# (parse args 에 추가)
    --workflow)     WORKFLOW=1; shift ;;
    --manifest)     MANIFEST="$2"; shift 2 ;;

# (parse 종료 후, OC_DIR 검증 전에)
if [ "${WORKFLOW:-0}" = "1" ]; then
  [ -n "${MANIFEST:-}" ] || { echo "ERROR: --workflow requires --manifest" >&2; exit 1; }
  PANEL="$PLUGIN_DIR/bin/oc-cmux-panel.sh"
  WORKDIR="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["workdir"])' "$MANIFEST")"
  SURF="$("$PANEL" open "$WORKDIR")" || exit $?
  SIG="done-$SURF"
  "$PANEL" run "$SURF" "NODE_PATH=\$(npm root -g) node '$PLUGIN_DIR/bin/oc-workflow-tui.js' --manifest '$MANIFEST' --signal '$SIG'"
  # A 는 비블로킹: 호출자가 background 로 wait. 여기선 동기 wait 후 결과 경로 출력.
  "$PANEL" wait "$SIG" "${TIMEOUT}" || true
  echo "workflow_result: $WORKDIR/result.json"
  echo "workflow_failures: $WORKDIR/failures.json"
  exit 0
fi
```

**Step 2: 수동 확인 (cmux 환경에서)**

`--workflow --manifest /tmp/m.json` 실행 → 우측 패널에 TUI, 완료 후 `workflow_result:` 출력.

**Step 3: Commit**

```bash
git add bin/oc-delegate.sh
git commit -m "feat(cc-opencode-cmux): oc-delegate --workflow 진입점 분기"
```

---

## Task 10: delegate-oc SKILL.md — workflow 모드 문서화

**Files:**
- Modify: `skills/delegate-oc/SKILL.md`

**Step 1: "Parallel fan-out" 섹션 뒤에 workflow 모드 추가**

추가 내용(요지):
- **선택 기준**: phase ≥ 2 또는 총 워커 ≥ 6 → `--workflow`. 그 외 단일/평면은 기존 `oc-delegate`/`oc-fanout`.
- **호출**: A가 phase별 spec 파일 + `manifest.json` 작성 → `oc-delegate.sh --workflow --manifest <M> --dir "$PWD"`.
- **비블로킹 권장**: `Bash(run_in_background: true)`로 호출하고 완료 통지 후 `result.json`/`failures.json` 분석.
- **결과**: `result.json`(phase별 done/failed), `failures.json`(실패만). 성공물은 `<workdir>/phase-*/＊/output*`.
- **제약**: cmux 필수(없으면 exit 3). 실패 워커는 phase를 막지 않고 failures 에 누적.

**Step 2: 정합성 확인**

Run: `grep -n 'workflow' skills/delegate-oc/SKILL.md`
Expected: 선택 기준·호출·결과 항목이 보임.

**Step 3: Commit**

```bash
git add skills/delegate-oc/SKILL.md
git commit -m "docs(cc-opencode-cmux): delegate-oc workflow 모드 사용법 추가"
```

---

## Task 11: 통합 스모크 — 실제 OC 2-phase 워크플로

**Files:**
- Create(임시): `/tmp/oc-wf-smoke/` manifest + 2 spec

**Step 1: 최소 manifest 작성**

phase1: research 1개(짧은 1줄 조사), phase2: compose 1개(phase1 출력 참조). 각 spec은 ≤ 수십 LOC 출력.

**Step 2: 실행 (cmux 환경, 실제 OC daemon)**

Run: `bin/oc-delegate.sh --workflow --manifest /tmp/oc-wf-smoke/manifest.json --dir /tmp/oc-wf-smoke`
Expected:
- 우측 패널에 ink TUI, phase1 → (배리어) → phase2 진행
- `result.json` status=completed, 각 phase done=1
- `phase-*/＊/{report.txt,diff.patch,...}` 존재

**Step 3: 실패 경로 확인**

일부러 깨지는 spec(존재하지 않는 파일 참조 등)으로 phase에 1개 실패 추가 → `result.json` status=completed_with_failures, `failures.json`에 해당 spec만.

**Step 4: 정리 커밋 (스모크 산출물은 커밋 안 함)**

```bash
git add -A && git commit -m "test(cc-opencode-cmux): workflow 통합 스모크 검증 완료" --allow-empty
```

---

## 완료 기준

- [ ] `npm test` 전부 통과 (report-parse / manifest / scheduler / aggregate / worker)
- [ ] `panel.test.sh` 통과 (cmux 부재 실패 + open uuid)
- [ ] 통합 스모크: 2-phase 워크플로 정상 + 실패 격리 확인
- [ ] `result.json`/`failures.json`이 분석 친화 구조
- [ ] cmux 부재 환경에서 `--workflow` 즉시 실패(exit 3)
- [ ] 기존 단일 `oc-delegate`/`oc-fanout` 경로 회귀 없음

## 패키징 미결 (구현 중 확정)

- ink 의존성: `NODE_PATH=$(npm root -g)` 글로벌 의존 vs `bin/`에 로컬 `npm i ink react` 번들. Task 7에서 실제 cmux 패널 실행으로 확정.
- `package.json`에 `ink`/`react`를 `optionalDependencies` 또는 `dependencies`로 명시할지 패키징 시 결정.
