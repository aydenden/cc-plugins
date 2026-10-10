#!/usr/bin/env node
/**
 * 프론티어 가드 — 진입점. 실측(파일·프로세스·stdin)만 여기 있고 판정은 `lib/guard-core.mjs` 가 한다.
 *
 *   node frontier-guard.mjs claim <epic>   이 세션이 그 맵을 민다고 선언
 *   node frontier-guard.mjs clear          선언 해제(맵을 놓을 때. 인계할 때는 지우지 않는다)
 *   node frontier-guard.mjs status         지금 판정을 사람이 읽는 꼴로
 *   node frontier-guard.mjs --hook         Stop hook 모드(stdin JSON)
 *
 * 마커는 **지금 위치의 worktree 별로** 갈라 둔다(`lib/state-root.mjs`). 플러그인은 아무 repo 에서나
 * 열린 세션에 붙으므로 머신에 파일 하나로 두면 무관한 저장소의 세션까지 이 맵으로 판정한다.
 *
 * 🚨 훅 모드는 **절대 실패로 죽지 않는다.** 가드가 터지면 막는 것이 아니라 조용히 통과시킨다 —
 * 세션을 못 끝내게 만드는 쪽이 훨씬 나쁜 고장이다.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { classifyFrontier, contextLimitOf, contextTokensOf, decide, isDelegatedToMod, readTranscriptTail } from './lib/guard-core.mjs';
import { currentRepoKey, repoRootOf, stateRoot } from './lib/state-root.mjs';

const REPO_ROOT = repoRootOf();
const MARKER = join(stateRoot(), 'frontier-guard', `${currentRepoKey()}.json`);

const readMarker = () => {
  try {
    return JSON.parse(readFileSync(MARKER, 'utf8'));
  } catch {
    return null;
  }
};

const bdJson = (args) => JSON.parse(execFileSync('bd', [...args, '--json'], { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] }));

/**
 * 맵의 프론티어와 맵이 아직 열려 있는지.
 *
 * 🚨 bd 가 없거나 느리거나 맵을 못 찾으면 **빈 프론티어가 아니라 «모름»**(`frontier: null`)이다. 둘을
 * 같게 읽으면 bd 가 잠깐 죽은 것만으로 가드가 선언을 지운다. `bd list --parent` 는 없는 맵에도 빈
 * 배열을 exit 0 으로 내므로(실측), 맵이 있는지는 `bd show` 가 먼저 가른다.
 *
 * @returns {{frontier: ReturnType<typeof classifyFrontier> | null, epicOpen: boolean}}
 */
function readFrontier(epic) {
  try {
    const [map] = [bdJson(['show', epic])].flat();
    if (!map?.status) return { frontier: null, epicOpen: true };
    // 기본 목록은 닫힌 티켓을 빼고 50건에서 자른다 — 잘린 프론티어는 틀린 프론티어다.
    const children = bdJson(['list', '--parent', epic, '--limit', '0']);
    const ready = bdJson(['ready', '--parent', epic, '--limit', '0']);
    return {
      frontier: classifyFrontier({ children, readyIds: ready.map((row) => row.id) }),
      epicOpen: map.status !== 'closed',
    };
  } catch {
    return { frontier: null, epicOpen: true };
  }
}

/**
 * Stop 이벤트인가.
 *
 * 🚨 이벤트 이름 필드를 믿지 않는다 — 없을 수도 있다. **도구 이벤트에만 `tool_name` 이 실린다**는
 * 것이 더 단단한 표지라, 그것이 있으면 Stop 이 아니다. 배선이 `PostToolUse` 로 잘못 들어갔을 때
 * 파일마다 판정이 터지는 것을 이 한 줄이 막는다(실측).
 */
const isStopEvent = (input) => {
  const name = input?.hook_event_name;
  if (typeof name === 'string') return name === 'Stop';
  return input?.tool_name === undefined;
};

function measure(transcriptPath) {
  try {
    const { usage, model } = readTranscriptTail(readFileSync(transcriptPath, 'utf8'));
    return { contextTokens: contextTokensOf(usage), contextLimit: contextLimitOf(model) };
  } catch {
    return { contextTokens: 0, contextLimit: contextLimitOf(null) };
  }
}

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const [command, argument] = process.argv.slice(2);

if (command === 'claim') {
  if (!argument) {
    console.error('usage: frontier-guard.mjs claim <epic>');
    process.exit(1);
  }
  mkdirSync(dirname(MARKER), { recursive: true });
  writeFileSync(
    MARKER,
    `${JSON.stringify({ epic: argument, worktree: REPO_ROOT, claimedAt: new Date().toISOString() }, null, 2)}\n`
  );
  console.log(`[frontier-guard] ${argument} 를 미는 세션으로 선언했다. 맵이 닫힐 때까지 멈춤을 막는다.`);
  console.log(`[frontier-guard] 마커: ${MARKER}`);
} else if (command === 'clear') {
  if (existsSync(MARKER)) rmSync(MARKER);
  console.log('[frontier-guard] 선언을 지웠다.');
} else if (command === 'status') {
  // 트랜스크립트를 주면 훅과 **같은 판정**을 돌려준다 — 훅 모드는 stdin 을 먹어 손으로 못 돌린다.
  const marker = readMarker();
  const read = marker?.epic ? readFrontier(marker.epic) : { frontier: null, epicOpen: true };
  const measured = argument ? measure(argument) : { contextTokens: 0, contextLimit: contextLimitOf(null) };
  const verdict = decide({ marker, ...measured, ...read, stopHookActive: false });
  console.log(JSON.stringify({ markerPath: MARKER, worktree: REPO_ROOT, marker, ...read, ...measured, verdict }, null, 2));
} else if (command === '--hook') {
  try {
    const input = JSON.parse((await readStdin()) || '{}');
    // mod 가 이 Stop 을 이미 판정했다 — 여기서 또 판정하면 같은 멈춤을 두 번 되민다.
    if (isDelegatedToMod(input)) process.exit(0);
    const marker = readMarker();
    const { contextTokens, contextLimit } = measure(input.transcript_path);
    const verdict = decide({
      marker,
      contextTokens,
      contextLimit,
      ...(marker?.epic ? readFrontier(marker.epic) : { frontier: null }),
      stopHookActive: input.stop_hook_active === true,
      isStopEvent: isStopEvent(input),
    });
    if (verdict.clear && existsSync(MARKER)) rmSync(MARKER);
    if (verdict.block) console.log(JSON.stringify({ decision: 'block', reason: verdict.reason }));
  } catch {
    // 가드가 터지면 통과시킨다 — 머리말.
  }
  process.exit(0);
} else {
  console.error('usage: node frontier-guard.mjs <claim <epic>|clear|status|--hook>');
  process.exit(1);
}
