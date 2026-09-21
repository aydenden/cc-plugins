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
 *   --dry-run               탭을 띄우지 않고 보낼 내용만 출력
 *
 * 종료코드: 0 정상 / 2 전제 실패 / 5 CLI 호출 실패 / 6 TUI 미준비 또는 제출 미증명
 * 결과를 JSON 한 줄로 stdout 에 출력한다.
 */

import fs from 'node:fs';
import path from 'node:path';
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
import { declaredWorktreePath, worktreeMismatch } from './lib/doc-meta.mjs';
import { allocateDoc, ensureHandoffDir } from './lib/handoff-path.mjs';

/**
 * 인계 프롬프트. **한 줄이어야 한다** — `terminal send` 는 raw 바이트를 쓰므로 개행이 들어가면
 * TUI 가 그 지점에서 제출해 버린다.
 *
 * 내용의 핵심은 "문서를 읽어라"가 아니라 **"문서로 절차를 대신하지 마라"** 다. 인계 문서는 어디까지
 * 왔는지를 적은 상태 보고서지 절차서가 아니어서, 그것만 따라가면 스킬이 소유한 규약이 통째로 빠진다.
 */
function buildPrompt({ doc, bdId }) {
  const parts = [
    `[세션 인계] 이전 세션이 컨텍스트 한계에 닿아 이 작업을 너에게 통째로 넘긴다.`,
    `1) Read 로 ${doc} 을 읽는다.`,
    `2) '다음 작업'이 지정한 스킬을 실제로 호출한다 — 인계 문서의 요약으로 대체하지 않는다. 문서는 상태 보고서지 절차서가 아니다.`,
  ];
  if (bdId) {
    parts.push(
      `3) 진행 정본은 문서가 아니라 bd 다 — \`bd show ${bdId}\` 와 \`bd children ${bdId}\` 로 열린 항목을 먼저 확인하고, 문서와 어긋나면 bd 를 따르고 사용자에게 알린다.`
    );
  }
  parts.push(`마지막으로 문서의 '완료 통보' 절에 적힌 것이 있으면 그대로 이행한다.`);
  return parts.join(' ');
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

  const wt = flags.worktree ? resolveWorktreeSelector(String(flags.worktree)) : resolveWorktreeByCwd();

  // 대상이 문서와 같은 worktree 인지 본다. cwd 조회는 실패하지 않으므로 — 다른 등록된 worktree 에
  // 서 있어도 조용히 성공한다 — 여기서 막지 않으면 엉뚱한 탭이 뜬 것을 새 세션만 알게 된다.
  const declared = declaredWorktreePath(fs.readFileSync(doc, 'utf8'));
  if (!flags['force-worktree']) {
    const why = worktreeMismatch({ declared, resolved: wt.path });
    if (why) throw new Bail(2, why);
  }

  const prompt = buildPrompt({ doc, bdId: flags.bd && String(flags.bd) });
  const title = flags.title ? String(flags.title) : `인계 ${path.basename(doc, '.md')}`;

  // 닫기 계획은 탭을 띄우기 **전에** 세운다 — 지연 값이 틀렸다는 이유로 인계가 끝난 뒤에 죽으면,
  // 인계는 이미 일어났는데 종료코드는 실패인 어중간한 상태가 된다.
  const closePlan = flags['close-self'] ? planSelfClose({ delaySeconds: flags['close-delay'] }) : null;

  if (flags['dry-run']) {
    console.log(JSON.stringify({ ok: true, dryRun: true, doc, declaredWorktree: declared, worktree: wt.selector, worktreePath: wt.path, title, prompt, selfClose: closePlan }, null, 2));
    return;
  }

  const { handle, submission } = bootClaudeTab({
    worktree: wt.selector,
    title,
    prompt,
    permissionMode: flags['permission-mode'],
    submitWaitSeconds: flags['submit-wait'],
  });

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
