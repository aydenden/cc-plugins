/**
 * git·gh·jj 명령의 출력을 값으로 읽는 순수 함수들. 명령을 부르는 쪽은 hooks module 이다.
 */

/**
 * `git status --porcelain=v2 --branch` 의 출력.
 *
 * @param {string} output
 * @returns {{branch: string | null, sha: string | null, upstream: string | null, ahead: number, behind: number,
 *   staged: number, unstaged: number, untracked: number, conflicts: number}}
 */
export function parseGitStatus(output) {
  const status = { branch: null, sha: null, upstream: null, ahead: 0, behind: 0, staged: 0, unstaged: 0, untracked: 0, conflicts: 0 };
  for (const line of output.split('\n')) {
    if (line.startsWith('# branch.oid ')) {
      const oid = line.slice('# branch.oid '.length);
      status.sha = oid === '(initial)' ? null : oid;
    } else if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length);
      status.branch = head === '(detached)' ? null : head;
    } else if (line.startsWith('# branch.upstream ')) {
      status.upstream = line.slice('# branch.upstream '.length);
    } else if (line.startsWith('# branch.ab ')) {
      const match = /\+(\d+) -(\d+)/.exec(line);
      if (match) {
        status.ahead = Number(match[1]);
        status.behind = Number(match[2]);
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // XY: X 는 인덱스, Y 는 작업 트리. `.` 은 변화 없음.
      if (line[2] !== '.') status.staged += 1;
      if (line[3] !== '.') status.unstaged += 1;
    } else if (line.startsWith('u ')) {
      status.conflicts += 1;
    } else if (line.startsWith('? ')) {
      status.untracked += 1;
    }
  }
  return status;
}

/**
 * `git diff --shortstat` (또는 `jj diff --stat` 의 마지막 줄)의 삽입·삭제 줄 수. 변화가 없으면 둘 다 0.
 *
 * @param {string} output
 * @returns {{insertions: number, deletions: number}}
 */
export function parseShortstat(output) {
  const insertions = /(\d+) insertions?\(\+\)/.exec(output);
  const deletions = /(\d+) deletions?\(-\)/.exec(output);
  return { insertions: insertions ? Number(insertions[1]) : 0, deletions: deletions ? Number(deletions[1]) : 0 };
}

/**
 * 원격 URL 에서 호스트·소유자·저장소. ssh(`git@host:owner/repo.git`)와 URL 꼴을 읽는다. 못 읽으면 null.
 *
 * @param {string} url
 * @returns {{host: string, owner: string, repo: string} | null}
 */
export function parseRemoteUrl(url) {
  const match = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^:/]+)[:/](.+?)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? { host: match[1], owner: match[2], repo: match[3] } : null;
}

/**
 * `git remote -v` 의 출력에서 origin 과 upstream.
 *
 * @param {string} output
 * @returns {{origin: ReturnType<typeof parseRemoteUrl>, upstream: ReturnType<typeof parseRemoteUrl>}}
 */
export function parseRemotes(output) {
  const remotes = { origin: null, upstream: null };
  for (const line of output.split('\n')) {
    const [name, url] = line.split(/\s+/);
    if ((name === 'origin' || name === 'upstream') && url && !remotes[name]) remotes[name] = parseRemoteUrl(url);
  }
  return remotes;
}

/**
 * `git rev-parse --path-format=absolute --git-dir --git-common-dir --show-toplevel` 의 세 줄.
 * git-dir 이 common-dir 과 다르면 linked worktree 다.
 *
 * @param {string} output
 * @returns {{isWorktree: boolean, name: string} | null}
 */
export function parseWorktree(output) {
  const [gitDir, commonDir, toplevel] = output.split('\n').map((line) => line.trim());
  if (!gitDir || !commonDir || !toplevel) return null;
  const parts = toplevel.split('/').filter(Boolean);
  return { isWorktree: gitDir !== commonDir, name: parts[parts.length - 1] ?? toplevel };
}

/**
 * `gh pr view --json number,title,url,state,statusCheckRollup` 의 출력. PR 이 없거나 JSON 이 아니면 null.
 *
 * @param {string} output
 * @returns {{pr: {number: number, title: string, url: string, state: string},
 *   checks: {failing: number, pending: number, passing: number}} | null}
 */
export function parsePullRequest(output) {
  let json;
  try {
    json = JSON.parse(output);
  } catch {
    return null;
  }
  if (!json || typeof json.number !== 'number') return null;
  const checks = { failing: 0, pending: 0, passing: 0 };
  for (const check of Array.isArray(json.statusCheckRollup) ? json.statusCheckRollup : []) {
    // CheckRun 은 status/conclusion, StatusContext 는 state 로 온다.
    const outcome = String(check.conclusion || check.state || '').toUpperCase();
    const running = check.status && String(check.status).toUpperCase() !== 'COMPLETED';
    if (running || outcome === 'PENDING' || outcome === 'EXPECTED' || outcome === '') checks.pending += 1;
    else if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(outcome)) checks.passing += 1;
    else checks.failing += 1;
  }
  return { pr: { number: json.number, title: json.title ?? '', url: json.url ?? '', state: json.state ?? '' }, checks };
}

/**
 * `jj log -r @ --no-graph -T 'change_id.shortest(8) ++ "\n" ++ bookmarks.join(",") ++ "\n" ++ description.first_line()'`
 * 의 세 줄.
 *
 * @param {string} output
 * @returns {{revision: string, bookmarks: string[], description: string} | null}
 */
export function parseJjLog(output) {
  const [revision = '', bookmarks = '', description = ''] = output.split('\n');
  if (!revision.trim()) return null;
  return {
    revision: revision.trim(),
    bookmarks: bookmarks.split(',').map((name) => name.trim()).filter(Boolean),
    description: description.trim(),
  };
}

/**
 * macOS `vm_stat` 의 출력과 전체 메모리(바이트)에서 쓰는 메모리. 페이지 크기를 못 읽으면 null.
 *
 * @param {string} vmStat
 * @param {number} totalBytes `sysctl -n hw.memsize`
 * @returns {{usedBytes: number, totalBytes: number} | null}
 */
export function parseVmStat(vmStat, totalBytes) {
  const pageSize = /page size of (\d+) bytes/.exec(vmStat);
  const pages = (name) => {
    const match = new RegExp(`${name}:\\s+(\\d+)`).exec(vmStat);
    return match ? Number(match[1]) : 0;
  };
  if (!pageSize || !(totalBytes > 0)) return null;
  // 비어 있거나 바로 내줄 수 있는 페이지를 뺀 나머지를 «쓰는 중» 으로 본다.
  const available = (pages('Pages free') + pages('Pages inactive') + pages('Pages speculative')) * Number(pageSize[1]);
  return { usedBytes: Math.max(0, totalBytes - available), totalBytes };
}
