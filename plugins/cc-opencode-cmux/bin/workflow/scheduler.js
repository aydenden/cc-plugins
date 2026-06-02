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
