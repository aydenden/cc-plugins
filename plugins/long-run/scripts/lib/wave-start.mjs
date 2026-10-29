/**
 * 웨이브 시작의 순서 — 계획 → orca 점검 → Run → 워커 기동 → 마커에 웨이브 기록. I/O 는 전부 주입받는다
 * (`wave.mjs` 가 실제 bd·git·orca·가드를 꽂는다).
 */
import { capabilityGaps, runIdOf, workerReceiptOf } from './orca-adapter.mjs';
import { baseBranchOf, planWave } from './wave-plan.mjs';

/**
 * @param {{ticketIds: string[], flags: object, deps: {
 *   readTicket: (id: string) => object, gitHead: () => string, epic: () => string|null, pendingWaveRun: () => string|null,
 *   orca: (args: string[]) => object, orcaSchema: () => object, orcaVersion: () => string,
 *   excludeWorktree: (name: string) => void, beginWave: (runId: string, tickets: object[]) => void,
 * }}} input
 * @returns {object} `--dry-run` 이면 `{dryRun, plan}`, 아니면 `{ok, runId, started, failed?, notStarted}`
 */
export function startWave({ ticketIds, flags, deps }) {
  const epic = deps.epic();
  if (!epic) throw new Error('이 worktree 에 선언된 맵이 없다 — frontier-guard claim <맵> 뒤에 웨이브를 연다.');
  const waveRun = deps.pendingWaveRun();
  if (waveRun) throw new Error(`웨이브 ${waveRun} 가 아직 정산되지 않았다 — 정산한 뒤에 새 웨이브를 연다.`);

  const input = {
    epic,
    tickets: ticketIds.map((id) => deps.readTicket(id)),
    baseBranch: baseBranchOf({ flag: flags['base-branch'], head: deps.gitHead() }),
    agent: flags.agent ? String(flags.agent) : 'claude',
    model: flags.model,
  };
  // 계획은 orca 를 부르기 전에 세운다 — 티켓·base 문제로 죽을 웨이브가 Run 부터 만들지 않게.
  const draft = planWave(input);
  if (flags['dry-run']) {
    // 승인용 출력이라 spec 을 인자 안에 한 번 더 싣지 않는다.
    const workers = draft.workers.map((w) => ({ ...w, args: w.args.map((a) => (a === w.spec ? '<spec>' : a)) }));
    return { dryRun: true, plan: { ...draft, workers } };
  }

  const gaps = capabilityGaps(deps.orcaSchema());
  if (gaps.length) {
    throw new Error(`설치된 orca(${deps.orcaVersion()})에 웨이브가 쓰는 명령이 없다: ${gaps.join(', ')}. orca 를 갱신하거나 어댑터(lib/orca-adapter.mjs)를 그 버전에 맞춘다.`);
  }

  const runId = flags.run ? String(flags.run) : runIdOf(deps.orca(['orchestration', 'run-create', '--objective', draft.objective]));
  const plan = planWave({ ...input, runId });

  const started = [];
  let failed = null;
  for (const worker of plan.workers) {
    deps.excludeWorktree(worker.name);
    try {
      const receipt = workerReceiptOf(deps.orca(worker.args));
      if (!receipt.ready) throw new Error(`worker-start 가 ready 가 아니다(단계 ${receipt.stage}): ${JSON.stringify(receipt)}`);
      started.push({ ticket: worker.ticket, name: worker.name, ...receipt });
    } catch (error) {
      // 🚨 재시도하지 않는다 — 반쯤 뜬 워커가 있을 수 있고, 같은 티켓에 둘을 띄우면 안 된다.
      failed = { ticket: worker.ticket, name: worker.name, error: error.message };
      break;
    }
  }

  if (started.length) {
    deps.beginWave(runId, started.map((s) => ({ id: s.ticket, dispatchId: s.dispatchId, ...(s.worktreeId ? { worktreeId: s.worktreeId } : {}) })));
  }
  const done = new Set([...started.map((s) => s.ticket), failed?.ticket]);
  return {
    ok: !failed,
    runId,
    baseBranch: plan.baseBranch,
    started,
    ...(failed ? { failed } : {}),
    notStarted: plan.workers.map((w) => w.ticket).filter((id) => !done.has(id)),
  };
}
