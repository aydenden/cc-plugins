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
