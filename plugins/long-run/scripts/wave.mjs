#!/usr/bin/env node
/**
 * 병렬 웨이브 — 진입점. 실제 bd·git·orca·가드를 꽂기만 하고 순서는 `lib/wave-start.mjs` 가 정한다.
 *
 *   node wave.mjs start <티켓>... [--run <runId>] [--base-branch <ref>] [--agent <id>] [--model <id>] [--dry-run]
 *   node wave.mjs settle <티켓> [--apply] [--park] [--message <병합 메시지>]
 *
 * start: 티켓마다 base 안에 하위 worktree(`wave-<티켓>`)를 orca 로 만들어 워커를 띄우고, 이 worktree 의
 * 가드 마커에 웨이브를 적는다. 웨이브 폭·티켓 목록은 부르기 전에 사용자 승인을 받는다 — `--dry-run` 이
 * 그 승인에 보일 계획(JSON)을 orca 를 부르지 않고 낸다.
 *
 * settle: 워커 하나의 판정(merge·park·wait·refuse)을 낸다. 코디네이터는 판정이 merge 면 그 `worktreePath`
 * 에서 검증을 돌리고 `--apply` 로 다시 부른다(검증에서 떨어뜨리면 `--apply --park`). merge 는 base 병합 →
 * release → worktree rm → 남은 브랜치 삭제 → wave-settle, park 는 release → wave-settle(worktree·브랜치는
 * 남긴다). 우편함 ack 와 bd close·주차 질문은 코디네이터가 한다.
 *
 * 종료코드: 0 정상 / 1 실패·거부(start 에서 워커 일부만 떴으면 결과 JSON 의 `started`·`failed` 를 본다) / 2 사용법
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArgs } from './lib/cli.mjs';
import { createOrcaAdapter } from './lib/orca-adapter.mjs';
import { excludeAddition } from './lib/wave-plan.mjs';
import { settleTicket } from './lib/wave-settle.mjs';
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

/** 시험 병합. 깨끗하면 참이고, 어느 쪽이든 병합 상태를 되돌려 base 를 그대로 둔다. */
function trialMerge(branch) {
  try {
    run('git', ['merge', '--no-ff', '--no-commit', branch]);
    return true;
  } catch {
    return false;
  } finally {
    try {
      run('git', ['merge', '--abort']);
    } catch {
      // 병합 상태가 안 생겼으면 되돌릴 것이 없다.
    }
  }
}

function settle(ticketId) {
  const orca = createOrcaAdapter().orca;
  return settleTicket({
    ticketId,
    apply: !!flags.apply,
    park: !!flags.park,
    message: typeof flags.message === 'string' ? flags.message : undefined,
    deps: {
      waveEntry: (id) => JSON.parse(guard('wave', '--json') || 'null')?.tickets?.find((t) => t.id === id) ?? null,
      basePath: () => run('git', ['rev-parse', '--show-toplevel']).trim(),
      orca,
      porcelain: () => run('git', ['status', '--porcelain', '--untracked-files=no']),
      ahead: (branch) => Number(run('git', ['rev-list', '--count', `HEAD..${branch}`]).trim()),
      trialMerge,
      merge: (branch, message) => run('git', ['merge', '--no-ff', '-m', message, branch]),
      branchExists: (branch) => run('git', ['branch', '--list', branch]).trim() !== '',
      // 병합된 브랜치만 지운다(-d) — 병합 안 된 것을 지우면 워커의 일이 사라진다.
      deleteBranch: (branch) => run('git', ['branch', '-d', branch]),
      guardSettle: (id) => guard('wave-settle', id),
    },
  });
}

const { flags, positional } = parseArgs(process.argv.slice(2));
const [sub, ...ticketIds] = positional;

if (sub === 'settle') {
  if (ticketIds.length !== 1) {
    console.error('usage: node wave.mjs settle <티켓> [--apply] [--park] [--message <병합 메시지>]');
    process.exit(2);
  }
  try {
    const out = settle(ticketIds[0]);
    console.log(JSON.stringify(out, null, 2));
    process.exit(out.action === 'refuse' ? 1 : 0);
  } catch (error) {
    console.error(`[wave] ${error.message}`);
    process.exit(1);
  }
}

if (sub !== 'start') {
  console.error('usage: node wave.mjs <start <티켓>... [--run <runId>] [--base-branch <ref>] [--agent <id>] [--model <id>] [--dry-run] | settle <티켓> [--apply] [--park] [--message <m>]>');
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
