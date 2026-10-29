/**
 * 웨이브가 orca 와 맞닿는 곳 전부. orca CLI 는 버전마다 바뀔 수 있어서 여기 한 곳에 모으고, 사람용
 * 텍스트가 아니라 `--json` 출력만 읽는다.
 *
 * 순수 함수(스키마 대조·영수증 파싱)와 실제 호출(`createOrcaAdapter`)을 가른다 — 파싱은 실측 JSON
 * 픽스처로 orca 없이 시험한다.
 */
import { execFileSync } from 'node:child_process';

/**
 * 웨이브의 시작·정산이 쓰는 orca 명령과 그 명령에 넘기는 플래그. 시작 전에 설치된 orca 의 명령 스키마와
 * 대조한다 — 없는 것을 부르면 웨이브가 반쯤 열린 채(Run·worktree 만 남고) 죽는다.
 */
export const REQUIRED_CAPABILITIES = {
  'orchestration run-create': ['objective'],
  'orchestration worker-start': ['spec', 'task-title', 'worktree', 'name', 'base-branch', 'agent', 'model', 'run'],
  'orchestration check': ['wait', 'types', 'timeout-ms', 'ack'],
  'orchestration worker-release': ['dispatch'],
  'orchestration worker-list': ['run', 'terminal-state'],
  'worktree show': ['worktree'],
  'worktree rm': ['worktree'],
};

/**
 * 설치된 orca 에 없는 명령·플래그. `orca agent-context --json` 의 스키마(`commands[].command`·`flags`)를 읽는다.
 *
 * @param {unknown} schema
 * @returns {string[]} 없는 명령은 `"<명령>"`, 명령은 있는데 플래그가 없으면 `"<명령> --<플래그>"`. 다 있으면 빈 배열
 */
export function capabilityGaps(schema, required = REQUIRED_CAPABILITIES) {
  const commands = Array.isArray(schema?.commands) ? schema.commands : [];
  const byName = new Map(commands.map((c) => [c?.command, Array.isArray(c?.flags) ? c.flags : []]));
  return Object.entries(required).flatMap(([command, flags]) =>
    byName.has(command) ? flags.filter((f) => !byName.get(command).includes(f)).map((f) => `${command} --${f}`) : [command]
  );
}

/** orca `--json` 봉투(`{ok, result}`)를 벗긴다. ok:false 는 예외다 — 조용히 진행하면 뒤 단계가 엉뚱한 id 를 잡는다. */
export function envelopeResult(envelope) {
  if (!envelope || typeof envelope !== 'object') throw new Error('orca 응답이 JSON 봉투가 아니다');
  if (envelope.ok !== true) throw new Error(`orca → ok:false\n${JSON.stringify(envelope, null, 2)}`);
  return envelope.result;
}

/** run-create 영수증의 Run id. */
export function runIdOf(result) {
  const id = result?.run?.id;
  if (!id) throw new Error(`run-create 영수증에 Run id 가 없다: ${JSON.stringify(result)}`);
  return id;
}

/**
 * worker-start 영수증. `state` 가 `ready` 일 때만 워커가 떴다 — orca 는 실패에도 dispatch 를 줄 수 있다.
 * worktree 와 에이전트 터미널은 `effects` 에서 읽는다(정산이 지울 대상).
 */
export function workerReceiptOf(result) {
  const effects = Array.isArray(result?.effects) ? result.effects : [];
  const worktree = effects.find((e) => e?.kind === 'worktree');
  const terminal = effects.find((e) => e?.kind === 'terminal' && e?.role === 'agent');
  return {
    ready: result?.state === 'ready',
    dispatchId: result?.dispatchId ?? null,
    taskId: result?.taskId ?? null,
    worktreeId: worktree?.id ?? null,
    terminal: terminal?.id ?? null,
    stage: result?.failedStage ?? result?.stage ?? null,
    residualResources: Array.isArray(result?.residualResources) ? result.residualResources : [],
  };
}

const runOrca = (args) => {
  try {
    return execFileSync('orca', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    // worker-start 는 실패에도 영수증 JSON 을 stdout 에 낸다 — 복구에 필요하니 메시지에 싣는다.
    const detail = [e.stdout, e.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`orca ${args.slice(0, 2).join(' ')} 실패\n${detail || e.message}`);
  }
};

/**
 * 실제 orca 를 부르는 어댑터. `orca` 는 봉투를 벗긴 result 를 돌려준다.
 *
 * @returns {{orca: (args: string[]) => object, orcaSchema: () => object, orcaVersion: () => string}}
 */
export function createOrcaAdapter() {
  return {
    orca: (args) => envelopeResult(JSON.parse(runOrca([...args, '--json']))),
    // agent-context 는 봉투 없이 스키마를 그대로 낸다(1.4.218 실측). 봉투가 오면 벗긴다.
    orcaSchema: () => {
      const out = JSON.parse(runOrca(['agent-context', '--json']));
      return out?.ok === true ? out.result : out;
    },
    // 판정에 쓰지 않고 실패 메시지에 싣기만 한다 — 사람용 텍스트라 파싱하지 않는다.
    orcaVersion: () => runOrca(['--version']).trim(),
  };
}
