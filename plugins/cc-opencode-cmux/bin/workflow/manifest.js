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
