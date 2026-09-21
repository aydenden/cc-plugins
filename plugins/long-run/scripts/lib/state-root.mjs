/**
 * 플러그인이 세션 밖에 남기는 상태의 위치 — 가드 마커와 인계 문서.
 *
 * 저장소 안이 아니라 홈 아래에 둔다. 이 플러그인은 아무 repo 에서나 열린 세션에 붙으므로, 작업
 * 저장소에 파일을 만들면 남의 repo 를 오염시키고 `.gitignore` 를 강요한다.
 *
 * 🚨 **키를 나누는 것이 이 파일의 핵심이다.** 상태를 머신에 하나로 두면 서로 무관한 repo 의 세션까지
 * 같은 맵으로 판정한다. 그래서 전부 **worktree 단위**로 갈라 놓는다 — 인계는 같은 worktree 의 새 탭으로
 * 가므로 받는 세션은 같은 키를 읽고(선언을 물려받고), 병렬 worktree 는 서로를 건드리지 않는다.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

/** 가드 마커·로그가 사는 곳. */
export function stateRoot(env = process.env) {
  return env.LONG_RUN_STATE_ROOT || path.join(os.homedir(), '.claude', 'long-run');
}

/** 인계 문서가 사는 곳. */
export function handoffRoot(env = process.env) {
  return env.HANDOFF_ROOT || path.join(os.homedir(), '.claude', 'handoff');
}

/**
 * 경로 하나를 상태 키로 바꾼다. `<basename>-<해시8>`.
 *
 * basename 만으로는 안 된다 — 이슈 키를 폴더명으로 쓰는 규약에서는 서로 다른 루트 아래 같은 이름의
 * worktree 가 흔하다. 해시만 쓰면 사람이 폴더를 보고 어느 작업인지 못 알아본다. 둘 다 붙인다.
 */
export function repoKeyOf(repoPath) {
  const norm = String(repoPath).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const hash = createHash('sha1').update(norm).digest('hex').slice(0, 8);
  const base = path.basename(norm).replace(/[^a-z0-9._-]/gi, '-') || 'repo';
  return `${base}-${hash}`;
}

/**
 * 이 위치가 속한 worktree 의 루트. git 저장소가 아니면 cwd 그 자체다.
 *
 * git 이 죽었다고 가드나 인계가 멈추면 안 된다 — 실패는 '키가 cwd 다'로 떨어뜨린다. 그 경우 cwd 가
 * 달라지면 키도 달라지므로, 가드는 선언을 못 찾아 **아무것도 안 하는 쪽**으로 고장난다(막는 쪽이 아니다).
 */
export function repoRootOf(cwd = process.cwd()) {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const top = out.trim();
    if (top) return path.resolve(top);
  } catch {
    // git 저장소가 아니거나 git 이 없다 — cwd 로 떨어진다.
  }
  return path.resolve(cwd);
}

/** 지금 위치의 상태 키. */
export function currentRepoKey(cwd = process.cwd()) {
  return repoKeyOf(repoRootOf(cwd));
}
