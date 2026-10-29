/**
 * 웨이브 정산 — 워커 하나의 결과를 판정하고(병합·주차·대기·거부), 판정대로 base 병합과 정리를 한다.
 * I/O 는 전부 주입받는다(`wave.mjs` 가 실제 git·orca·가드를 꽂는다).
 *
 * 결과는 우편함(`check`)이 아니라 dispatch 의 영수증(`worker-show`)에서 읽는다 — 우편함 배치는 코디네이터가
 * 읽고 ack 하는 것이라, 스크립트가 소비하면 코디네이터가 질문·에스컬레이션을 놓친다.
 */

const normPath = (p) => String(p ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/**
 * worker-show 영수증에서 정산에 쓰는 칸. `projection.outcome` 이 있으면 워커가 worker_done 으로 끝났다.
 *
 * @returns {{dispatchId: string|null, settled: boolean, outcome: string|null, branch: string|null, worktreePath: string|null, worktreeId: string|null, released: boolean}}
 */
export function workerStateOf(result) {
  const outcome = result?.projection?.outcome ?? null;
  const ref = result?.terminal?.branch ?? null;
  return {
    dispatchId: result?.dispatch?.id ?? result?.projection?.dispatchId ?? null,
    settled: outcome === 'succeeded' || outcome === 'failed',
    outcome,
    branch: ref ? String(ref).replace(/^refs\/heads\//, '') : null,
    worktreePath: result?.terminal?.worktreePath ?? null,
    worktreeId: result?.worker?.worktreeId ?? result?.terminal?.worktreeId ?? null,
    released: result?.projection?.resource?.releaseState === 'released',
  };
}

/** base 의 추적 파일 변경(`git status --porcelain --untracked-files=no`). 있으면 시험 병합이 그 변경과 섞인다. */
export function baseDirtyReason(porcelain) {
  const lines = String(porcelain ?? '').split(/\r?\n/).filter((l) => l.trim());
  return lines.length ? `base 에 커밋 안 된 변경이 있다(${lines.map((l) => l.trim()).join(', ')}) — 커밋하거나 치운 뒤 정산한다.` : null;
}

/**
 * 워커 하나의 정산 판정. 병합은 코디네이터 검증 뒤 순차로 하고, 충돌은 질문으로 주차한다.
 *
 * @param {{entry: {id: string, dispatchId: string}, worker: ReturnType<typeof workerStateOf>, basePath: string, ahead?: number, trialClean?: boolean, park?: boolean}} input
 *   `ahead`·`trialClean` 은 병합 후보일 때만 잰 값이다
 * @returns {{action: 'merge'|'park'|'wait'|'refuse', reason: string}}
 */
export function settleVerdict({ entry, worker, basePath, ahead, trialClean, park }) {
  if (worker.dispatchId !== entry.dispatchId) {
    return { action: 'refuse', reason: `${entry.id} 의 기대 dispatch 는 ${entry.dispatchId} 인데 영수증은 ${worker.dispatchId} 다 — 다른 시도의 결과를 합치지 않는다.` };
  }
  if (!worker.settled) return { action: 'wait', reason: `${entry.id} 의 워커가 아직 worker_done 을 보내지 않았다 — check --wait 로 기다린다.` };
  if (!worker.branch || !worker.worktreePath) {
    return { action: 'refuse', reason: `${entry.id} 워커의 브랜치·worktree 를 영수증에서 못 읽었다 — 손으로 확인한다.` };
  }
  if (normPath(worker.worktreePath) === normPath(basePath)) {
    return { action: 'refuse', reason: `${entry.id} 워커가 base 자체에서 일했다 — 합칠 워커 브랜치가 없다.` };
  }
  if (worker.outcome === 'failed') return { action: 'park', reason: `${entry.id} 워커가 --outcome failed 로 끝났다 — 병합하지 않는다.` };
  if (park) return { action: 'park', reason: `코디네이터가 ${entry.id} 를 검증에서 떨어뜨렸다 — 병합하지 않는다.` };
  if (ahead === 0) return { action: 'park', reason: `${worker.branch} 에 base 보다 앞선 커밋이 없다 — 워커가 커밋하지 않았다.` };
  if (trialClean === false) return { action: 'park', reason: `${worker.branch} 를 base 에 시험 병합하니 충돌한다 — 질문으로 주차한다.` };
  return { action: 'merge', reason: `${worker.branch} 가 커밋 ${ahead}개를 갖고 base 에 깨끗이 합쳐진다.` };
}

/**
 * 티켓 하나를 정산한다. `apply` 가 없으면 판정만 낸다 — 코디네이터는 그 `worktreePath` 에서 검증을 돌린
 * 뒤 `apply` 로 다시 부르거나, 떨어뜨렸으면 `park` 와 함께 부른다.
 *
 * @param {{ticketId: string, apply?: boolean, park?: boolean, message?: string, deps: {
 *   waveEntry: (id: string) => object|null, basePath: () => string, orca: (args: string[]) => object,
 *   porcelain: () => string, ahead: (branch: string) => number, trialMerge: (branch: string) => boolean,
 *   merge: (branch: string, message: string) => void, branchExists: (branch: string) => boolean,
 *   deleteBranch: (branch: string) => void, guardSettle: (id: string) => void,
 * }}} input
 */
export function settleTicket({ ticketId, apply = false, park = false, message, deps }) {
  const entry = deps.waveEntry(ticketId);
  if (!entry) throw new Error(`${ticketId} 는 진행 중 웨이브에 없다.`);
  const basePath = deps.basePath();
  const worker = workerStateOf(deps.orca(['orchestration', 'worker-show', '--dispatch', entry.dispatchId]));

  let verdict = settleVerdict({ entry, worker, basePath, park });
  let ahead;
  if (verdict.action === 'merge') {
    const dirty = baseDirtyReason(deps.porcelain());
    if (dirty) throw new Error(dirty);
    ahead = deps.ahead(worker.branch);
    const trialClean = ahead > 0 ? deps.trialMerge(worker.branch) : undefined;
    verdict = settleVerdict({ entry, worker, basePath, ahead, trialClean });
  }

  const report = { ticket: ticketId, ...verdict, branch: worker.branch, worktreePath: worker.worktreePath, ahead: ahead ?? null };
  if (!apply || verdict.action === 'wait' || verdict.action === 'refuse') return { ...report, applied: false };

  if (verdict.action === 'merge') deps.merge(worker.branch, message || `chore(wave): ${ticketId} 워커 브랜치 ${worker.branch} 병합`);
  if (!worker.released) deps.orca(['orchestration', 'worker-release', '--dispatch', entry.dispatchId]);
  // 주차는 worktree·브랜치를 남긴다 — 코디네이터가 실패·충돌을 들여다볼 자리다.
  if (verdict.action === 'merge') {
    deps.orca(['worktree', 'rm', '--worktree', `id:${worker.worktreeId}`]);
    if (deps.branchExists(worker.branch)) deps.deleteBranch(worker.branch);
  }
  deps.guardSettle(ticketId);
  return { ...report, applied: true };
}
