/**
 * long-run mod — 맵을 미는 세션의 상태줄과 Stop 판정, 그리고 압축될 때 남기는 인계 지시.
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
 * 선다. 어느 쪽도 막는 쪽으로 고장나지 않는다. 판정을 못 물었으면 표지 없이 넘겨 node 훅이 판정한다.
 *
 * @param {(event: string, ...rest: unknown[]) => unknown} on
 */

import { MOD_FLAG } from '../scripts/lib/guard-core.mjs';
import { compactNote, judgeUsageArgs, movesMap, parseStatus, statusLine } from '../scripts/lib/mod-view.mjs';

/** 이 세션 자리에서 본 status. 세션 id 를 실어야 주인이 아닌 세션이 판정에서 빠진다. */
async function readStatus($, cwd) {
  const cli = `${$.plugin.root}/scripts/frontier-guard.mjs`;
  try {
    const sessionId = await $.session.id();
    const { exitCode, stdout } = await $.process.run(['node', cli, 'status', '--session', sessionId], cwd ? { cwd } : undefined);
    if (exitCode !== 0) return null;
    return parseStatus(stdout);
  } catch {
    return null;
  }
}

/**
 * Stop 판정을 CLI 에 묻는다. 못 물으면 null — 호출자가 표지 없이 넘겨 node 훅이 판정하게 한다.
 * 표지를 먼저 달고 물으면 여기서 실패한 Stop 은 아무도 판정하지 않는다.
 */
async function judge($, e) {
  try {
    const args = ['judge', '--session', e.session_id, '--transcript', e.transcript_path, ...(e.cwd ? ['--cwd', e.cwd] : [])];
    if (e.stop_hook_active === true) args.push('--active');
    args.push(...judgeUsageArgs(await $.session.usage()));
    const { exitCode, stdout } = await $.process.run(['node', `${$.plugin.root}/scripts/frontier-guard.mjs`, ...args], e.cwd ? { cwd: e.cwd } : undefined);
    return exitCode === 0 ? parseStatus(stdout) : null;
  } catch {
    return null;
  }
}

async function refreshStatusLine($, usage) {
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

  // 티켓을 닫거나 잡은 직후 숫자가 바뀐다 — 턴 끝을 기다리지 않고 다시 그린다. 명령이 돈 뒤 훅 밖으로
  // 미뤄 툴 결과를 붙잡지 않는다. `.catch` 를 달지 않는다 — `next` 뒤에 터지면 명령이 두 번 돈다.
  for (const tool of ['Bash', 'PowerShell']) {
    on('tool.call', { tool }, async ($, e, next) => {
      const result = await next(e);
      if (movesMap(e.command)) {
        // 못 그리면 지난 줄이 남는다 — 다음 턴 끝에 다시 그린다.
        $.clock.after(0, () =>
          $.session
            .usage()
            .then((usage) => refreshStatusLine($, usage))
            .catch(() => {})
        );
      }
      return result;
    });
  }

  // 압축은 막지 않는다 — 창이 넘칠 때 건너뛰면 막다른 길이 된다. 요약과 압축 뒤 대화에 인계 지시만 남긴다.
  // `.catch` 를 달지 않는다 — `next` 뒤에 터지면 `.catch` 가 `next` 를 다시 불러 압축이 두 번 돈다.
  // `next` 앞의 조회(`readStatus`)는 실패를 스스로 삼킨다.
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined || e.trigger === 'precompute') return next(e);
    const note = compactNote(await readStatus($));
    if (note === undefined) return next(e);

    const compacted = await next({ ...e, instructions: e.instructions ? `${e.instructions}\n\n${note}` : note });
    if (compacted?.skip !== undefined || !Array.isArray(compacted?.messages)) return compacted;
    return { ...compacted, messages: [...compacted.messages, { role: 'user', text: note, toolUses: [] }] };
  });

  // 판정을 먼저 묻는다. 주인 기록·되민 기록·선언 해제는 CLI 가 한다.
  on('classic.Stop', async ($, e, next) => {
    const verdict = await judge($, e);
    if (verdict === null) return next(e);
    const result = await next({ ...e, [MOD_FLAG]: true });
    if (result?.block) return result;
    if (verdict.clear) $.ui.status(undefined);
    return verdict.block ? { ...result, block: verdict.reason } : result;
  });
}
