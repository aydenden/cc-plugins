import test from 'node:test';
import assert from 'node:assert/strict';

import { parseGitStatus, parseJjLog, parsePullRequest, parseRemoteUrl, parseRemotes, parseShortstat, parseVmStat, parseWorktree } from '../lib/parse-git.mjs';

test('porcelain v2 에서 브랜치·앞뒤·파일 상태를 센다', () => {
  const status = parseGitStatus(
    [
      '# branch.oid 1234567890abcdef',
      '# branch.head feature/x',
      '# branch.upstream origin/feature/x',
      '# branch.ab +2 -1',
      '1 M. N... 100644 100644 100644 a b staged.txt',
      '1 .M N... 100644 100644 100644 a b unstaged.txt',
      '1 MM N... 100644 100644 100644 a b both.txt',
      '2 R. N... 100644 100644 100644 a b R100 new.txt\told.txt',
      'u UU N... 100644 100644 100644 100644 a b c conflict.txt',
      '? untracked.txt',
      '',
    ].join('\n'),
  );
  assert.deepEqual(status, {
    branch: 'feature/x',
    sha: '1234567890abcdef',
    upstream: 'origin/feature/x',
    ahead: 2,
    behind: 1,
    staged: 3,
    unstaged: 2,
    untracked: 1,
    conflicts: 1,
  });
});

test('분리된 HEAD 와 첫 커밋 전은 브랜치·sha 가 없다', () => {
  assert.equal(parseGitStatus('# branch.oid abc\n# branch.head (detached)\n').branch, null);
  assert.equal(parseGitStatus('# branch.oid (initial)\n# branch.head main\n').sha, null);
});

test('shortstat 은 한쪽만 있어도, 비어 있어도 읽는다', () => {
  assert.deepEqual(parseShortstat(' 3 files changed, 12 insertions(+), 3 deletions(-)\n'), { insertions: 12, deletions: 3 });
  assert.deepEqual(parseShortstat(' 1 file changed, 1 insertion(+)\n'), { insertions: 1, deletions: 0 });
  assert.deepEqual(parseShortstat(''), { insertions: 0, deletions: 0 });
});

test('원격 URL 은 https·ssh·하위 그룹을 읽는다', () => {
  assert.deepEqual(parseRemoteUrl('https://github.com/aydenden/cc-plugins.git'), { host: 'github.com', owner: 'aydenden', repo: 'cc-plugins' });
  assert.deepEqual(parseRemoteUrl('git@github.com:aydenden/cc-plugins.git'), { host: 'github.com', owner: 'aydenden', repo: 'cc-plugins' });
  assert.deepEqual(parseRemoteUrl('ssh://git@gitlab.com/group/sub/repo'), { host: 'gitlab.com', owner: 'group/sub', repo: 'repo' });
  assert.equal(parseRemoteUrl('not a url'), null);
});

test('remote -v 에서 origin 과 upstream 을 고른다', () => {
  const remotes = parseRemotes(
    'origin\tgit@github.com:me/fork.git (fetch)\norigin\tgit@github.com:me/fork.git (push)\nupstream\thttps://github.com/them/repo (fetch)\n',
  );
  assert.equal(remotes.origin.owner, 'me');
  assert.equal(remotes.upstream.owner, 'them');
  assert.deepEqual(parseRemotes(''), { origin: null, upstream: null });
});

test('git-dir 이 common-dir 과 다르면 worktree 다', () => {
  assert.deepEqual(parseWorktree('/r/.git/worktrees/wt1\n/r/.git\n/tmp/wt1\n'), { isWorktree: true, name: 'wt1' });
  assert.deepEqual(parseWorktree('/r/.git\n/r/.git\n/r\n'), { isWorktree: false, name: 'r' });
  assert.equal(parseWorktree(''), null);
});

test('PR 의 체크를 실패·대기·통과로 센다', () => {
  const parsed = parsePullRequest(
    JSON.stringify({
      number: 12,
      title: 'Fix',
      url: 'https://github.com/o/r/pull/12',
      state: 'OPEN',
      statusCheckRollup: [
        { status: 'COMPLETED', conclusion: 'SUCCESS' },
        { status: 'COMPLETED', conclusion: 'FAILURE' },
        { status: 'IN_PROGRESS', conclusion: '' },
        { state: 'PENDING' },
        { state: 'SUCCESS' },
        { status: 'COMPLETED', conclusion: 'SKIPPED' },
      ],
    }),
  );
  assert.equal(parsed.pr.number, 12);
  assert.deepEqual(parsed.checks, { failing: 1, pending: 2, passing: 3 });
});

test('PR 이 없거나 JSON 이 아니면 null', () => {
  assert.equal(parsePullRequest('no pull requests found'), null);
  assert.equal(parsePullRequest('{}'), null);
});

test('jj log 의 세 줄을 읽고, 빈 출력은 null', () => {
  assert.deepEqual(parseJjLog('kxyzabcd\nmain,dev\nFix the thing\n'), { revision: 'kxyzabcd', bookmarks: ['main', 'dev'], description: 'Fix the thing' });
  assert.deepEqual(parseJjLog('kxyzabcd\n\n\n').bookmarks, []);
  assert.equal(parseJjLog(''), null);
});

test('vm_stat 에서 쓰는 메모리를 계산한다', () => {
  const vmStat = 'Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free:        1000.\nPages inactive:    2000.\nPages speculative:  500.\n';
  assert.deepEqual(parseVmStat(vmStat, 16384 * 10_000), { usedBytes: 16384 * 6500, totalBytes: 16384 * 10_000 });
  assert.equal(parseVmStat('garbage', 1), null);
  assert.equal(parseVmStat(vmStat, Number.NaN), null);
});
