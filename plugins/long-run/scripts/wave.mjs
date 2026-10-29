#!/usr/bin/env node
/**
 * 병렬 웨이브 — 진입점. 실제 bd·git·orca·가드를 꽂기만 하고 순서는 `lib/wave-start.mjs` 가 정한다.
 *
 *   node wave.mjs start <티켓>... [--run <runId>] [--base-branch <ref>] [--agent <id>] [--model <id>] [--dry-run]
 *
 * 티켓마다 base 안에 하위 worktree(`wave-<티켓>`)를 orca 로 만들어 워커를 띄우고, 이 worktree 의 가드
 * 마커에 웨이브를 적는다. 웨이브 폭·티켓 목록은 부르기 전에 사용자 승인을 받는다 — `--dry-run` 이 그
 * 승인에 보일 계획(JSON)을 orca 를 부르지 않고 낸다.
 *
 * 종료코드: 0 정상 / 1 실패(워커 일부만 떴으면 결과 JSON 의 `started`·`failed` 를 본다) / 2 사용법
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/cli.mjs';
import { createOrcaAdapter } from './lib/orca-adapter.mjs';
import { excludeAddition } from './lib/wave-plan.mjs';
import { startWave } from './lib/wave-start.mjs';

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'frontier-guard.mjs');

const run = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const guard = (...args) => run(process.execPath, [GUARD, ...args]).trim();

/** bd 는 이 worktree 의 DB(BEADS_DIR 포함)로 읽는다 — 워커가 아니라 코디네이터만 bd 를 쓴다. */
function readTicket(id) {
  const ticket = [JSON.parse(run('bd', ['show', id, '--json']))].flat()[0];
  if (!ticket?.id) throw new Error(`bd 에 ${id} 가 없다`);
  return ticket;
}

/** worktree 가 base 디렉터리 안에 생기므로 base 의 git 이 그 폴더를 보지 않게 가린다(`excludeAddition`). */
function excludeWorktree(name) {
  const commonDir = path.resolve(run('git', ['rev-parse', '--git-common-dir']).trim());
  const file = path.join(commonDir, 'info', 'exclude');
  const addition = excludeAddition(existsSync(file) ? readFileSync(file, 'utf8') : '', name);
  if (!addition) return;
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, addition);
}

const { flags, positional } = parseArgs(process.argv.slice(2));
const [sub, ...ticketIds] = positional;

if (sub !== 'start') {
  console.error('usage: node wave.mjs start <티켓>... [--run <runId>] [--base-branch <ref>] [--agent <id>] [--model <id>] [--dry-run]');
  process.exit(2);
}

try {
  const out = startWave({
    ticketIds,
    flags,
    deps: {
      readTicket,
      gitHead: () => run('git', ['rev-parse', '--abbrev-ref', 'HEAD']),
      epic: () => guard('epic') || null,
      pendingWaveRun: () => guard('wave') || null,
      ...createOrcaAdapter(),
      excludeWorktree,
      beginWave: (runId, tickets) =>
        guard('wave-begin', runId, ...tickets.map((t) => [t.id, t.dispatchId, t.worktreeId].filter(Boolean).join('='))),
    },
  });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.dryRun || out.ok ? 0 : 1);
} catch (error) {
  console.error(`[wave] ${error.message}`);
  process.exit(1);
}
