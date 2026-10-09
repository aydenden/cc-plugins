/**
 * Git·JJ 위젯. 값은 `parse-git.mjs` 가 읽은 것을 그대로 쓴다 — 여기서는 git 을 부르지 않는다.
 *
 * 저장소 밖이면 `snap.git` 이 null 이고 모든 git 위젯은 숨는다. 개수 위젯은 0 이면 숨고, 항목의
 * `showZero` 가 켜져 있으면 0 도 보인다.
 */

import { basename } from '../format.mjs';

const count = (label, pick) => (snap, item) => {
  const value = snap.git ? pick(snap.git) : undefined;
  if (typeof value !== 'number') return null;
  if (value === 0 && !item.showZero) return null;
  return { label, value: String(value) };
};

const flag = (glyph, pick) => (snap) => (snap.git && pick(snap.git) > 0 ? { label: '', value: glyph } : null);

const remotePart = (name, pick) => (snap) => {
  const remote = snap.gitRemotes?.[name];
  return remote ? { label: '', value: pick(remote) } : null;
};

const diffPart = (source, format) => (snap, item) => {
  const diff = snap[source];
  if (!diff) return null;
  if (diff.insertions === 0 && diff.deletions === 0 && !item.showZero) return null;
  return { label: '', value: format(diff) };
};

/** @type {Record<string, import('./index.mjs').Widget>} */
export const GIT_WIDGETS = {
  'git-branch': {
    category: 'git',
    needs: ['git'],
    render: (snap) => (snap.git?.branch ? { label: '⎇ ', value: snap.git.branch } : null),
  },
  'git-root-dir': {
    category: 'git',
    needs: ['session'],
    render: (snap) => (snap.repo?.root ? { label: '', value: basename(snap.repo.root) } : null),
  },
  'git-sha': {
    category: 'git',
    needs: ['git'],
    render: (snap) => (snap.git?.sha ? { label: '', value: snap.git.sha.slice(0, 7) } : null),
  },
  'git-changes': { category: 'git', needs: ['gitDiff'], render: diffPart('gitDiff', (d) => `(+${d.insertions},-${d.deletions})`) },
  'git-insertions': { category: 'git', needs: ['gitDiff'], render: diffPart('gitDiff', (d) => `+${d.insertions}`) },
  'git-deletions': { category: 'git', needs: ['gitDiff'], render: diffPart('gitDiff', (d) => `-${d.deletions}`) },
  'git-staged-files': { category: 'git', needs: ['git'], render: count('S:', (g) => g.staged) },
  'git-unstaged-files': { category: 'git', needs: ['git'], render: count('M:', (g) => g.unstaged) },
  'git-untracked-files': { category: 'git', needs: ['git'], render: count('?:', (g) => g.untracked) },
  'git-conflicts': { category: 'git', needs: ['git'], render: count('⚠ ', (g) => g.conflicts) },
  'git-staged': { category: 'git', needs: ['git'], render: flag('+', (g) => g.staged) },
  'git-unstaged': { category: 'git', needs: ['git'], render: flag('!', (g) => g.unstaged) },
  'git-untracked': { category: 'git', needs: ['git'], render: flag('?', (g) => g.untracked) },
  'git-status': {
    category: 'git',
    needs: ['git'],
    render: (snap) => {
      if (!snap.git) return null;
      const marks = [
        snap.git.conflicts > 0 ? '⚠' : '',
        snap.git.staged > 0 ? '+' : '',
        snap.git.unstaged > 0 ? '!' : '',
        snap.git.untracked > 0 ? '?' : '',
      ].join('');
      return marks ? { label: '', value: marks } : null;
    },
  },
  'git-clean-status': {
    category: 'git',
    needs: ['git'],
    render: (snap) => {
      if (!snap.git) return null;
      const dirty = snap.git.staged + snap.git.unstaged + snap.git.untracked + snap.git.conflicts > 0;
      return { label: '', value: dirty ? '✗' : '✓' };
    },
  },
  'git-ahead-behind': {
    category: 'git',
    needs: ['git'],
    render: (snap, item) => {
      if (!snap.git?.upstream) return null;
      const { ahead, behind } = snap.git;
      if (ahead === 0 && behind === 0 && !item.showZero) return null;
      return { label: '', value: `↑${ahead}↓${behind}` };
    },
  },
  'git-origin-owner': { category: 'git', needs: ['gitRemotes'], render: remotePart('origin', (r) => r.owner) },
  'git-origin-repo': { category: 'git', needs: ['gitRemotes'], render: remotePart('origin', (r) => r.repo) },
  'git-origin-owner-repo': { category: 'git', needs: ['gitRemotes'], render: remotePart('origin', (r) => `${r.owner}/${r.repo}`) },
  'git-upstream-owner': { category: 'git', needs: ['gitRemotes'], render: remotePart('upstream', (r) => r.owner) },
  'git-upstream-repo': { category: 'git', needs: ['gitRemotes'], render: remotePart('upstream', (r) => r.repo) },
  'git-upstream-owner-repo': {
    category: 'git',
    needs: ['gitRemotes'],
    render: remotePart('upstream', (r) => `${r.owner}/${r.repo}`),
  },
  'git-is-fork': {
    category: 'git',
    needs: ['gitRemotes'],
    render: (snap) => (snap.gitRemotes?.upstream ? { label: '', value: 'fork' } : null),
  },
  'git-worktree': {
    category: 'git',
    needs: ['gitWorktree'],
    render: (snap) => (snap.gitWorktree?.isWorktree ? { label: 'wt: ', value: snap.gitWorktree.name } : null),
  },
  // 세션이 `--worktree` 로 열렸는지는 mod 가 알 수 없다. 현재 디렉터리가 linked worktree 인지로 대신한다.
  'worktree-mode': {
    category: 'git',
    needs: ['gitWorktree'],
    render: (snap) => (snap.gitWorktree?.isWorktree ? { label: '', value: 'worktree' } : null),
  },
  'worktree-name': {
    category: 'git',
    needs: ['gitWorktree'],
    render: (snap) => (snap.gitWorktree?.isWorktree ? { label: '', value: snap.gitWorktree.name } : null),
  },
  'worktree-branch': {
    category: 'git',
    needs: ['gitWorktree', 'git'],
    render: (snap) => (snap.gitWorktree?.isWorktree && snap.git?.branch ? { label: '', value: snap.git.branch } : null),
  },
  'git-review': {
    category: 'git',
    needs: ['gh'],
    render: (snap, item) => {
      const pr = snap.gh?.pr;
      if (!pr) return null;
      const parts = [`#${pr.number}`];
      if (item.format !== 'number' && pr.state && pr.state !== 'OPEN') parts.push(pr.state.toLowerCase());
      if (item.format !== 'number' && pr.title) parts.push(pr.title);
      return { label: 'PR ', value: parts.join(' '), url: pr.url };
    },
  },
  'git-ci-status': {
    category: 'git',
    needs: ['gh'],
    render: (snap) => {
      const checks = snap.gh?.checks;
      if (!checks || checks.failing + checks.pending + checks.passing === 0) return null;
      const parts = [];
      if (checks.failing > 0) parts.push(`✗${checks.failing}`);
      if (checks.pending > 0) parts.push(`●${checks.pending}`);
      if (checks.passing > 0) parts.push(`✓${checks.passing}`);
      return { label: '', value: parts.join(' ') };
    },
  },
  'jj-revision': {
    category: 'jj',
    needs: ['jj'],
    render: (snap) => (snap.jj?.revision ? { label: '', value: snap.jj.revision } : null),
  },
  'jj-bookmarks': {
    category: 'jj',
    needs: ['jj'],
    render: (snap) => (snap.jj?.bookmarks?.length ? { label: '', value: snap.jj.bookmarks.join(',') } : null),
  },
  'jj-description': {
    category: 'jj',
    needs: ['jj'],
    render: (snap) => (snap.jj?.description ? { label: '', value: snap.jj.description } : null),
  },
  'jj-root-dir': {
    category: 'jj',
    needs: ['jj'],
    render: (snap) => (snap.jj?.root ? { label: '', value: basename(snap.jj.root) } : null),
  },
  'jj-changes': { category: 'jj', needs: ['jj'], render: diffPart('jj', (d) => `(+${d.insertions},-${d.deletions})`) },
  'jj-insertions': { category: 'jj', needs: ['jj'], render: diffPart('jj', (d) => `+${d.insertions}`) },
  'jj-deletions': { category: 'jj', needs: ['jj'], render: diffPart('jj', (d) => `-${d.deletions}`) },
};
