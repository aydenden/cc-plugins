/**
 * orca CLI 를 부르고 새 claude 탭을 띄우는 공용 헬퍼.
 *
 * 전부 execFileSync(셸 없음)로 부른다 — PowerShell 이 네이티브 인자 안의 큰따옴표를 망가뜨리는
 * 함정을 구조적으로 피하기 위해서다. 인자에 JSON·따옴표가 들어가는 호출(`terminal send --text`)이
 * 이 경로를 반드시 타야 한다.
 */

import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 스크립트가 의도적으로 종료할 때 쓰는 에러 — 스택 대신 메시지+종료코드만 남긴다. */
export class Bail extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function run(bin, args) {
  try {
    return execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) {
    const detail = [e.stdout, e.stderr].filter(Boolean).join('\n').trim();
    throw new Bail(5, `${bin} ${args.join(' ')} 실패\n${detail || e.message}`);
  }
}

/**
 * orca CLI 호출. `{id, ok, result}` 봉투를 벗겨 result 만 돌려준다.
 * ok:false 는 예외다 — 조용히 진행하면 뒤 단계가 엉뚱한 핸들을 잡는다.
 */
export function orca(args) {
  const out = run('orca', [...args, '--json']);
  let env;
  try {
    env = JSON.parse(out);
  } catch {
    throw new Bail(5, `orca ${args.join(' ')} 응답이 JSON 이 아니다:\n${out.slice(0, 500)}`);
  }
  if (!env.ok) {
    throw new Bail(5, `orca ${args.join(' ')} → ok:false\n${JSON.stringify(env, null, 2)}`);
  }
  return env.result;
}

/** `--flag value` 와 `--flag=value` 를 모두 받는 최소 파서. 나머지는 위치 인자다. */
export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq !== -1) {
      flags[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      flags[a.slice(2)] = argv[++i];
    } else {
      flags[a.slice(2)] = true;
    }
  }
  return { flags, positional };
}

/** 셀렉터로 지정된 worktree. 셀렉터는 `orca worktree list --json` 의 `<repoId>::<경로>` 전체 형태다. */
export function resolveWorktreeSelector(selector) {
  const { worktree } = orca(['worktree', 'show', '--worktree', selector]);
  return { selector, path: worktree?.path ?? null, worktree };
}

/** 경로 비교용 정규화 — Windows 는 구분자·대소문자가 호출자마다 다르게 온다. */
function normPath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * 지금 프로세스가 서 있는 디렉터리를 담고 있는 Orca worktree.
 *
 * cwd 가 worktree 하위 폴더일 수 있어 접두사로 맞추고, 겹치면 더 깊은 쪽이 답이다.
 * 이슈 키 같은 이름 규약에 기대지 않는다 — 트래커 키가 없는 작업도 인계 대상이다.
 */
export function resolveWorktreeByCwd(cwd = process.cwd()) {
  const here = normPath(cwd);
  const { worktrees } = orca(['worktree', 'list']);
  const hits = worktrees
    .filter((w) => w.path && (here === normPath(w.path) || here.startsWith(`${normPath(w.path)}/`)))
    .sort((a, b) => normPath(b.path).length - normPath(a.path).length);
  if (hits.length === 0) {
    throw new Bail(2, `현재 위치(${cwd})를 담는 Orca worktree 가 없다. --worktree <selector> 로 직접 지정한다.`);
  }
  return { selector: `id:${hits[0].id}`, path: hits[0].path, worktree: hits[0] };
}

/**
 * TUI 가 입력을 받을 수 있는 상태인지 기다린다.
 *
 * 🚨 **무언가 출력됐다는 사실이 아니라 `wait.satisfied` 를 읽는다** — 타임아웃도 정상 결과를 찍고
 * 돌아오므로, 출력이 있었다는 것만 보면 준비되지 않은 TUI 에 프롬프트를 던진다. 준비 전에 던진
 * 프롬프트는 유실된다.
 *
 * 불만족이면 **한 번만** 더 기다린다(orca 규약). 그래도 아니면 보내지 않고 죽는다 — 시작되지 않은
 * 인계를 성공으로 보고하는 것이 최악이다.
 */
export function waitTuiIdle(handle, timeoutMs) {
  for (const ms of [timeoutMs, timeoutMs * 2]) {
    const { wait } = orca(['terminal', 'wait', '--terminal', handle, '--for', 'tui-idle', '--timeout-ms', String(ms)]);
    if (wait?.satisfied) return wait;
  }
  throw new Bail(6, `새 탭(${handle})의 TUI 가 입력을 받을 상태가 되지 않았다. 프롬프트를 보내지 않았다 — 인계는 시작되지 않았다.`);
}

/**
 * `terminal send` 수령증을 판정으로 바꾼다.
 *
 * orca 가 제출을 **직접 관측해서** 알려준다. 단계는 누적이다 — `input_accepted` 는 입력이 받아들여진
 * 것까지고, 에이전트의 턴이 실제로 시작된 증거는 `turn_started` 하나다. `accepted: true` 는 전자일
 * 뿐이라 그것만 보면 유실을 착지로 읽는다.
 *
 * `observation` 이 `supported` 가 아니면(구 호스트) orca 가 관측 자체를 못 한다. 그때는 증명이
 * 불가능하다는 사실을 그대로 실어 보낸다 — 없는 증거를 있는 것처럼 만들지 않는다.
 *
 * @param {object} send `result.send`
 * @returns {{proven: boolean, observable: boolean, stages: string[], requestId: string|null, provider: string|null, accepted: boolean}}
 */
export function submissionOf(send) {
  const prompt = send?.prompt ?? {};
  const stages = Array.isArray(prompt.stages) ? prompt.stages : [];
  return {
    accepted: send?.accepted === true,
    observable: prompt.observation === 'supported',
    proven: stages.includes('turn_started'),
    stages,
    requestId: prompt.requestId ?? null,
    provider: prompt.provider ?? null,
  };
}

/**
 * 새 orca 탭에 claude 를 띄우고 프롬프트를 보낸다.
 *
 * 기동은 `terminal create --command` 로 한다 — orca 가 이 경로를 «현재 체크아웃에 새 에이전트» 로
 * 문서화하고, 인자를 그대로 넘겨 권한 모드를 우리가 정할 수 있다. `worktree create --agent` 는 새
 * 체크아웃을 만드는 명령이라 여기서는 쓰지 않는다.
 *
 * 🚨 **재전송하지 않는다.** 침묵은 유실의 증거가 아니고, 같은 지시를 두 번 받은 세션은 같은 일을 두 번
 * 한다. 애매한 전송 실패는 수령증의 `requestId` 로 **같은 명령을 그대로 재발행**해서 처리한다
 * (`orca terminal send --retry-request <id>` — 그 ID 는 프롬프트 payload 와 프로세스 incarnation 에
 * 묶여 있어 중복 실행이 되지 않는다).
 *
 * @param {{worktree: string, title: string, prompt: string|((handle: string) => string), permissionMode?: string, bootTimeoutMs?: number, submitWaitSeconds?: number}} opts
 *   prompt 는 **반드시 한 줄이어야 한다** — `terminal send` 는 raw 바이트를 쓰므로 개행이 들어가면
 *   TUI 가 그 지점에서 프롬프트를 제출해 버린다. 핸들이 정해진 뒤에야 만들 수 있는 프롬프트는
 *   함수로 넘긴다.
 * @returns {{handle: string, submission: ReturnType<typeof submissionOf>}}
 */
export function bootClaudeTab({
  worktree,
  title,
  prompt,
  permissionMode = 'auto',
  bootTimeoutMs = 180000,
  submitWaitSeconds = 60,
}) {
  // 인자 검증은 탭을 띄우기 **전에** 한다 — 뒤에서 죽으면 빈 탭만 남는다.
  const submitWait = Number(submitWaitSeconds);
  if (!Number.isFinite(submitWait) || submitWait <= 0) {
    throw new Bail(2, `제출 관측 시간은 양수여야 한다(받은 값: ${submitWaitSeconds}). 0 이면 제출을 증명할 수 없다.`);
  }

  const { terminal } = orca([
    'terminal', 'create',
    '--worktree', worktree,
    '--title', title,
    '--command', `claude --permission-mode ${permissionMode}`,
  ]);
  const handle = terminal.handle;

  waitTuiIdle(handle, bootTimeoutMs);

  const text = typeof prompt === 'function' ? prompt(handle) : prompt;
  // `--enter` 없이 `--text` 만 보내면 입력창에 얹히기만 하고 제출되지 않는다.
  // `--wait-submit` 은 **같은** 프롬프트를 관측할 뿐이다 — 다시 보내지 않는다.
  const { send } = orca([
    'terminal', 'send',
    '--terminal', handle,
    '--text', text,
    '--enter',
    '--wait-submit', String(submitWait),
  ]);
  const submission = submissionOf(send);

  if (submission.observable && !submission.proven) {
    throw new Bail(
      6,
      `프롬프트가 제출됐다는 증거가 없다(단계: ${submission.stages.join(' → ') || '없음'}).\n` +
        `새 탭: ${handle}\n` +
        `재전송하지 않는다 — 애매한 전송 실패면 같은 명령을 \`--retry-request ${submission.requestId}\` 로 그대로 재발행한다.\n` +
        `\`orca terminal read --terminal ${handle}\` 로 확인하고 손으로 처리한다.`
    );
  }

  return { handle, submission };
}

/**
 * 보고와 Stop hook 이 끝나기 전에 pty 가 죽으면 인계 기록이 통째로 사라진다 —
 * 스크롤백도, Stop hook 이 하던 일도 함께 날아간다. 그래서 하한을 둔다.
 */
const SELF_CLOSE_MIN_SECONDS = 10;
const SELF_CLOSE_DEFAULT_SECONDS = 30;

/**
 * 자기 탭을 닫는 계획을 세운다. 실행은 하지 않는다.
 *
 * 핸들을 탐색하지 않고 **환경변수 하나만 본다** — orca 가 자기 pty 에 심어 주는
 * `ORCA_TERMINAL_HANDLE` 이다. 목록에서 "나인 것 같은 탭"을 골라내는 방식은 같은 worktree 에 같은
 * 제목의 탭이 여럿일 때 **남의 세션을 닫는다**. 되돌릴 수 없는 종류의 오작동이라 추측하지 않는다.
 *
 * 핸들이 없으면(orca 밖에서 돌린 경우) 실패가 아니라 '예약 안 함'이다. 부르는 쪽에서 이미 인계가
 * 성공한 뒤라, 닫기를 못 걸었다고 인계를 실패로 되돌릴 수는 없다.
 */
export function planSelfClose({ env = process.env, delaySeconds } = {}) {
  const handle = env.ORCA_TERMINAL_HANDLE;
  const seconds = delaySeconds === undefined ? SELF_CLOSE_DEFAULT_SECONDS : Number(delaySeconds);
  if (!Number.isFinite(seconds) || seconds < SELF_CLOSE_MIN_SECONDS) {
    throw new Bail(2, `닫기 지연은 ${SELF_CLOSE_MIN_SECONDS}초 이상이어야 한다(받은 값: ${delaySeconds}). 보고 출력과 Stop hook 이 끝날 시간이다.`);
  }
  if (!handle) {
    return { scheduled: false, reason: 'ORCA_TERMINAL_HANDLE 이 없다 — orca 가 띄운 터미널이 아니라 닫을 대상을 특정할 수 없다.' };
  }
  return { scheduled: true, handle, delayMs: seconds * 1000 };
}

/**
 * 계획대로 자기 탭 닫기를 **분리된 프로세스**에 맡긴다. 즉시 돌아온다.
 *
 * 분리하는 이유는 대기 시간이 아니라 **죽는 순서**다. 닫는 주체가 이 프로세스 안에 있으면 자기를
 * 죽이는 명령을 자기가 기다리는 꼴이 되어, 보고 한 줄이 화면에 닿기 전에 pty 가 먼저 죽는다.
 */
export function scheduleSelfClose(plan) {
  if (!plan.scheduled) return plan;
  const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), 'close-tab.mjs');
  const child = spawn(process.execPath, [runner, '--terminal', plan.handle, '--delay-ms', String(plan.delayMs)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return plan;
}

/** 최상위 실행 래퍼 — Bail 은 메시지+코드로, 나머지는 스택으로 끝낸다. */
export function main(fn) {
  try {
    fn();
  } catch (e) {
    if (e instanceof Bail) {
      console.error(e.message);
      process.exit(e.code);
    }
    throw e;
  }
}
