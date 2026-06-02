#!/usr/bin/env node
/**
 * @module oc-workflow-tui
 * Workflow TUI 엔트리포인트. manifest를 읽어 스케줄러를 실행하고
 * ANSI 렌더러로 진행 상황을 표시한다. 완료 시 result.json/failures.json 저장.
 */
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

/**
 * CLI 인수에서 named 옵션 값을 읽는다.
 * @param {string} name - 옵션 이름 (e.g. '--manifest')
 * @param {string} [def] - 기본값
 * @returns {string|undefined}
 */
function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

const manifestPath = arg('--manifest');
const signal = arg('--signal');
const cmuxBin = arg('--cmux', process.env.CMUX_BIN || 'cmux');
const timeout = arg('--timeout');
if (!manifestPath) { console.error('--manifest required'); process.exit(2); }

const manifest = loadManifest(manifestPath);
const runWorker = makeRunWorker(join(__dir, 'oc-delegate.sh'), timeout);

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
