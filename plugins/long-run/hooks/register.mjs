/**
 * long-run mod — 맵을 미는 세션의 상태줄과 Stop 판정.
 *
 * 판정 규칙은 `scripts/lib/guard-core.mjs`, 입력 조립과 문구는 `scripts/lib/mod-view.mjs` 가 소유한다.
 * 여기는 배선뿐이다: 마커·프론티어는 `frontier-guard.mjs status` 로 묻고(키 계산을 두 벌로 만들지 않는다),
 * 컨텍스트는 세션이 잰 값을 쓴다.
 *
 * mod 가 안 뜨는 환경(구버전, 조직 정책, `--safe-mode`)에서는 `hooks.json` 의 node Stop 훅이 혼자
 * 판정한다. mod 가 뜨면 Stop 에 `MOD_FLAG` 를 실어 넘기고 node 훅은 그것을 보고 빠진다.
 *
 * 🚨 `classic.Stop` 훅에 `.catch` 를 달지 않는다. 엔진의 기본 처리가 원하는 동작이다 — `next` 전에
 * 터지면 이 훅만 건너뛰어 표지 없는 Stop 이 node 훅까지 가서 판정되고, `next` 뒤에 터지면 그 결과(통과)가
 * 선다. 어느 쪽도 막는 쪽으로 고장나지 않는다.
 *
 * @param {(event: string, ...rest: unknown[]) => unknown} on
 */

import { MOD_FLAG } from '../scripts/lib/guard-core.mjs';
import { parseStatus, statusLine, stopVerdict } from '../scripts/lib/mod-view.mjs';

/** 이 worktree 의 마커 경로. 첫 status 에서 배운다 — 마커가 없는 동안은 bd 를 부르지 않고 파일만 본다. */
let markerPath = null;

async function readStatus($, cwd) {
  const cli = `${$.plugin.root}/scripts/frontier-guard.mjs`;
  try {
    const { exitCode, stdout } = await $.process.run(['node', cli, 'status'], cwd ? { cwd } : undefined);
    if (exitCode !== 0) return null;
    const status = parseStatus(stdout);
    if (status?.markerPath) markerPath = status.markerPath;
    return status;
  } catch {
    return null;
  }
}

/** 선언이 없다고 확실할 때만 false. 경로를 아직 모르면 status 로 확인해야 한다. */
async function mayBeClaimed($) {
  if (!markerPath) return true;
  try {
    return await $.fs.exists(markerPath);
  } catch {
    return true;
  }
}

async function refreshStatusLine($, usage) {
  if (!(await mayBeClaimed($))) {
    $.ui.status(undefined);
    return;
  }
  $.ui.status(statusLine(await readStatus($), usage));
}

export function register(on) {
  // 인계받은 세션은 시작부터 선언을 물려받으므로 첫 프롬프트 전에 그린다.
  on('session.start', async ($, e, next) => {
    await refreshStatusLine($, await $.session.usage());
    return next(e);
  });

  // map-run 이 claim 한 다음 턴부터 나타나고, 가드가 마커를 지우면 사라진다.
  on('session.measure', async ($, e, next) => {
    await refreshStatusLine($, e);
    return next(e);
  });

  on('classic.Stop', async ($, e, next) => {
    const result = await next({ ...e, [MOD_FLAG]: true });
    if (result?.block || !(await mayBeClaimed($))) return result;

    const status = await readStatus($, e.cwd);
    const verdict = stopVerdict({
      status,
      usage: await $.session.usage(),
      stopHookActive: e.stop_hook_active === true,
    });
    if (verdict.clear) {
      await $.process.run(['node', `${$.plugin.root}/scripts/frontier-guard.mjs`, 'clear'], e.cwd ? { cwd: e.cwd } : undefined);
      $.ui.status(undefined);
    }
    return verdict.block ? { ...result, block: verdict.reason } : result;
  });
}
