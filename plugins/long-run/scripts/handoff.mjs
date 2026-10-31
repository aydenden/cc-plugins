#!/usr/bin/env node
/**
 * 지금 세션의 작업을 새 claude 세션(orca 탭)에 통째로 넘긴다.
 *
 * 분업이 아니라 **바통 터치**다. 소유권을 넘기고 보낸 세션이 빠진다. 그래서 orchestration task 나
 * dispatch 를 만들지 않는다 — 답신을 기다릴 주체가 남지 않는데 inbox 만 만들면, 아무도 안 보는 곳에
 * 완료 통보가 쌓인다.
 *
 * 사용법:
 *   node handoff.mjs allocate --slug <슬러그>     # 인계 폴더를 만들고 다음 handoff-NN.md 절대경로 출력
 *   node handoff.mjs allocate <디렉터리>           # 폴더를 직접 지정할 때
 *   node handoff.mjs send --doc <문서경로> [옵션]  # 새 탭을 띄우고 인계 프롬프트를 제출한다
 *
 * send 옵션:
 *   --worktree <selector>   대상 worktree. 생략하면 지금 cwd 를 담는 worktree
 *   --force-worktree        문서가 선언한 worktree 와 달라도 진행한다
 *   --title <문자열>         탭 제목. 생략하면 문서 파일명
 *   --bd <이슈id>            진행 정본으로 가리킬 bd 부모 이슈
 *   --permission-mode <m>   기본 auto
 *   --close-self            제출 확인 뒤, 이 세션이 서 있는 탭을 지연 후 스스로 닫는다
 *   --close-delay <초>       그 지연. 기본 30, 최소 10
 *   --submit-wait <초>       orca 가 제출을 관측하는 시간. 기본 60
 *   --hold                  새 세션이 작업을 시작하지 않고 상태만 확인한 뒤 사용자 지시를 기다리게 한다
 *   --dry-run               탭을 띄우지 않고 보낼 내용만 출력
 *
 * 종료코드: 0 정상 / 2 전제 실패 / 5 CLI 호출 실패 / 6 TUI 미준비 또는 제출 미증명
 * 결과를 JSON 한 줄로 stdout 에 출력한다.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Bail,
  bootClaudeTab,
  main,
  parseArgs,
  planSelfClose,
  resolveWorktreeByCwd,
  resolveWorktreeSelector,
  scheduleSelfClose,
} from './lib/cli.mjs';
import { declaredWorktreePath, principleSectionViolation, worktreeMismatch } from './lib/doc-meta.mjs';
import { allocateDoc, ensureHandoffDir } from './lib/handoff-path.mjs';
import { buildPrompt, inheritedMap } from './lib/handoff-prompt.mjs';

const GUARD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'frontier-guard.mjs');

/** 가드의 한 줄 조회. 없거나 못 읽으면 `null` — 그때 새 세션에게 그 단계를 시키지 않는다. */
function guardLine(command) {
  try {
    return execFileSync(process.execPath, [GUARD, command], { encoding: 'utf8', timeout: 10_000 }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * 맵 선언을 대상 worktree 로 옮긴다. 마커가 worktree 마다 하나라, 인계가 worktree 를 옮기면 선언이
 * 따라가지 않아 **새 세션이 가드 없이 출발한다.** 같은 worktree 면 그대로 둔다.
 *
 * 실패해도 인계를 죽이지 않는다 — 탭은 이미 떴고, 가드가 없는 것보다 인계가 실패한 척하는 쪽이 나쁘다.
 */
function moveGuardClaim(worktreePath) {
  try {
    return execFileSync(process.execPath, [GUARD, 'move', worktreePath], { encoding: 'utf8', timeout: 10_000 }).trim();
  } catch (error) {
    return `선언 이사 실패 — 새 세션에서 frontier-guard claim 을 다시 한다: ${error.message}`;
  }
}

main(() => {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const [sub, arg] = positional;

  if (sub === 'allocate') {
    const dir = arg ? path.resolve(arg) : ensureHandoffDir({ slug: flags.slug });
    if (!fs.existsSync(dir)) throw new Bail(2, `인계 폴더가 없다: ${dir}`);
    console.log(allocateDoc(dir));
    return;
  }

  if (sub !== 'send') {
    throw new Bail(2, '사용법: node handoff.mjs allocate [--slug <슬러그>|<디렉터리>] | node handoff.mjs send --doc <문서경로> [옵션]');
  }

  const doc = flags.doc && path.resolve(String(flags.doc));
  if (!doc) throw new Bail(2, 'send 에는 --doc <인계문서 경로> 가 필요하다.');
  // 문서 없이 탭부터 띄우면 새 세션이 읽을 것이 없는 채로 뜬다 — 조용히 헤매는 실패라 먼저 막는다.
  if (!fs.existsSync(doc)) throw new Bail(2, `인계 문서가 없다: ${doc}\n문서를 먼저 쓰고 나서 보낸다.`);
  const docText = fs.readFileSync(doc, 'utf8');

  // §0 은 다음 인계가 통째로 복사해 가므로, 섞인 교훈은 보내는 이 자리에서 걸러야 사슬로 번지지 않는다.
  const misplaced = principleSectionViolation(docText);
  if (misplaced) throw new Bail(2, misplaced);

  const wt = flags.worktree ? resolveWorktreeSelector(String(flags.worktree)) : resolveWorktreeByCwd();

  // 대상이 문서와 같은 worktree 인지 본다. cwd 조회는 실패하지 않으므로 — 다른 등록된 worktree 에
  // 서 있어도 조용히 성공한다 — 여기서 막지 않으면 엉뚱한 탭이 뜬 것을 새 세션만 알게 된다.
  const declared = declaredWorktreePath(docText);
  if (!flags['force-worktree']) {
    const why = worktreeMismatch({ declared, resolved: wt.path });
    if (why) throw new Bail(2, why);
  }

  const bdId = flags.bd && String(flags.bd);
  const mapEpic = guardLine('epic');
  const waveRun = guardLine('wave');
  const prompt = buildPrompt({ doc, bdId, mapEpic, guard: GUARD.replace(/\\/g, '/'), waveRun, hold: !!flags.hold });
  const title = flags.title ? String(flags.title) : `인계 ${path.basename(doc, '.md')}`;

  // 닫기 계획은 탭을 띄우기 **전에** 세운다 — 지연 값이 틀렸다는 이유로 인계가 끝난 뒤에 죽으면,
  // 인계는 이미 일어났는데 종료코드는 실패인 어중간한 상태가 된다.
  const closePlan = flags['close-self'] ? planSelfClose({ delaySeconds: flags['close-delay'] }) : null;

  if (flags['dry-run']) {
    console.log(
      JSON.stringify(
        { ok: true, dryRun: true, doc, declaredWorktree: declared, worktree: wt.selector, worktreePath: wt.path, mapEpic, waveRun, title, prompt, selfClose: closePlan },
        null,
        2
      )
    );
    return;
  }

  const { handle, submission } = bootClaudeTab({
    worktree: wt.selector,
    title,
    prompt,
    permissionMode: flags['permission-mode'],
    submitWaitSeconds: flags['submit-wait'],
  });

  // 탭이 뜬 뒤에 옮긴다 — 먼저 옮기면 인계가 exit 6 으로 죽었을 때 선언만 빈 worktree 로 간다.
  // 넘기는 bd 가 마커의 맵 밖이면 그 선언은 이 인계의 것이 아니다 — 옮기면 남의 맵 주인이 풀린다.
  const guardClaim = inheritedMap({ bdId, mapEpic })
    ? moveGuardClaim(wt.path)
    : mapEpic
      ? '건너뜀 — 넘기는 bd 가 이 worktree 에 선언된 맵 밖이다'
      : '해당 없음 — 이 worktree 에 선언된 맵이 없다';

  // 보낸 세션을 더 밀지 않는다 — 선언이 옮겨 갔으면 이 worktree 에 적을 마커가 없어 아무 일도 안 한다.
  if (inheritedMap({ bdId, mapEpic })) guardLine('hand-over');

  // 제출이 확인된 뒤에만 예약한다. 미제출은 위에서 exit 6 으로 죽으므로, 인계가 실패한 채 보낸
  // 세션만 사라지는 경우가 생기지 않는다.
  if (closePlan) scheduleSelfClose(closePlan);

  console.log(
    JSON.stringify(
      {
        ok: true,
        doc,
        worktree: wt.selector,
        worktreePath: wt.path,
        mapEpic,
        waveRun,
        guardClaim,
        handle,
        submission,
        selfClose: closePlan,
        // 이 세션이 할 일은 여기서 끝이다. 새 탭을 감시하지 않는다 — 감시하면 코디네이터가 되고,
        // 컨텍스트를 비우려고 넘긴 의미가 없어진다.
        next: closePlan?.scheduled
          ? `이 세션은 인계 완료를 사용자에게 보고하고 즉시 끝낸다 — ${closePlan.delayMs / 1000}초 뒤 이 탭이 닫힌다. 새 도구를 부르지 않는다.`
          : '이 세션은 인계 완료를 사용자에게 보고하고 끝낸다.',
      },
      null,
      2
    )
  );
});
