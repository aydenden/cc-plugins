/**
 * Regression tests for vault-git.mjs — the git sync/commit layer behind the
 * SessionStart and PostToolUse hooks. Run with: node --test scripts/vault-git.test.mjs
 *
 * Every test builds a real two-repository setup (a bare "remote" plus one or two
 * clones) in a temp dir: the behaviours that matter here — fast-forward, dirty
 * tree, divergence, rejected push — only exist against a real remote.
 *
 * Dependency-free: node:test / node:assert only.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { sync, commit, subjectFromLog, resolveAppendOnly } from './vault-git.mjs';

const roots = [];
test.after(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function writeLog(vault, entry) {
  fs.appendFileSync(path.join(vault, 'log.md'), `\n${entry}\n`, 'utf8');
}

/**
 * A bare remote with one clone (`a`), and optionally a second clone (`b`) that
 * stands in for the other machine.
 */
function makeWorld({ second = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-git-'));
  roots.push(root);
  const remote = path.join(root, 'remote.git');
  execFileSync('git', ['init', '--bare', '-b', 'main', remote], { stdio: 'ignore' });

  const a = path.join(root, 'a');
  execFileSync('git', ['clone', remote, a], { stdio: 'ignore' });
  git(a, 'config', 'user.email', 'test@example.com');
  git(a, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(a, 'log.md'), '# Log\n', 'utf8');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'init');
  git(a, 'push', '-u', 'origin', 'main');

  let b = null;
  if (second) {
    b = path.join(root, 'b');
    execFileSync('git', ['clone', remote, b], { stdio: 'ignore' });
    git(b, 'config', 'user.email', 'test@example.com');
    git(b, 'config', 'user.name', 'test');
  }
  return { root, remote, a, b };
}

/** Land one commit on the remote from the other machine. */
function remoteAdvance(b, name) {
  fs.writeFileSync(path.join(b, name), 'from the other machine\n', 'utf8');
  git(b, 'add', '-A');
  git(b, 'commit', '-m', `add ${name}`);
  git(b, 'push');
}

/** Stand-in for lint --write-index: deterministic, so a regenerated index is observable. */
function stubIndex(vault) {
  fs.writeFileSync(path.join(vault, 'index.md'), '# Index\n- regenerated\n', 'utf8');
}

// --- resolveAppendOnly ---

test('appends from both sides are kept, base side first', () => {
  const base = '# Log\n\n## a\n';
  const ours = `${base}\n## remote\n`;
  const theirs = `${base}\n## local\n`;
  assert.equal(resolveAppendOnly(base, ours, theirs), `${base}\n## remote\n\n## local\n`);
});

test('a rotation on one side keeps the rotated file plus the other side\'s new tail', () => {
  const base = '# Log\n\n## old\n';
  const rotated = '# Log\n\n이전 이력\n';
  const appended = `${base}\n## new\n`;
  assert.equal(resolveAppendOnly(base, rotated, appended), `${rotated}\n## new\n`);
  assert.equal(resolveAppendOnly(base, appended, rotated), `${rotated}\n## new\n`);
});

test('a tail already present is not duplicated', () => {
  const base = '# Log\n';
  const both = `${base}\n## same\n`;
  assert.equal(resolveAppendOnly(base, both, both), both);
});

test('edits that are not appends on either side are not resolved', () => {
  assert.equal(resolveAppendOnly('# Log\n## a\n', '# Log\n## b\n', '# Log\n## c\n'), null);
});

// --- subjectFromLog ---

test('commit subject comes from the last log.md entry header', () => {
  const { a } = makeWorld();
  writeLog(a, '## [2026-09-03] ingest | React 서버 컴포넌트 렌더링 모델\n- Raw: `raw/articles/x.md`');
  assert.equal(subjectFromLog(a), 'ingest(vault): React 서버 컴포넌트 렌더링 모델');
});

test('the last entry wins when the log holds several', () => {
  const { a } = makeWorld();
  writeLog(a, '## [2026-09-01] ingest | 이전 작업');
  writeLog(a, '## [2026-09-03] update | 최신 작업');
  assert.equal(subjectFromLog(a), 'update(vault): 최신 작업');
});

test('falls back to a generic subject when no entry parses', () => {
  const { a } = makeWorld();
  assert.match(subjectFromLog(a), /^chore\(vault\):/);
  assert.equal(subjectFromLog(path.join(a, 'nope')), 'chore(vault): vault update');
});

// --- sync ---

test('sync on a non-repository is a silent no-op', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-plain-'));
  roots.push(plain);
  const res = sync(plain);
  assert.equal(res.status, 'not-a-repo');
  assert.equal(res.exit, 0);
});

test('sync reports up-to-date when the remote has nothing new', () => {
  const { a } = makeWorld();
  const res = sync(a);
  assert.equal(res.status, 'up-to-date');
  assert.equal(res.exit, 0);
});

test('sync fast-forwards a clean branch that is behind', () => {
  const { a, b } = makeWorld({ second: true });
  remoteAdvance(b, 'other.md');
  const res = sync(a);
  assert.equal(res.status, 'pulled');
  assert.equal(res.exit, 0);
  assert.ok(fs.existsSync(path.join(a, 'other.md')), 'the remote commit landed in the working tree');
});

test('sync fast-forwards past uncommitted work it does not touch', () => {
  // The research loop leaves raw/ files uncommitted until the write cycle ends;
  // pulling right before that cycle must still work.
  const { a, b } = makeWorld({ second: true });
  remoteAdvance(b, 'other.md');
  fs.writeFileSync(path.join(a, 'draft.md'), 'work in progress\n', 'utf8');
  const res = sync(a);
  assert.equal(res.status, 'pulled');
  assert.ok(fs.existsSync(path.join(a, 'other.md')));
  assert.equal(fs.readFileSync(path.join(a, 'draft.md'), 'utf8'), 'work in progress\n', 'the draft is untouched');
});

test('sync refuses to pull over uncommitted edits the remote also changed', () => {
  const { a, b } = makeWorld({ second: true });
  writeLog(b, '## [2026-09-03] ingest | 원격');
  git(b, 'commit', '-am', 'remote log');
  git(b, 'push');
  writeLog(a, '## [2026-09-03] ingest | 로컬 미커밋');
  const res = sync(a);
  assert.equal(res.status, 'dirty');
  assert.equal(res.exit, 1);
  assert.doesNotMatch(fs.readFileSync(path.join(a, 'log.md'), 'utf8'), /원격/, 'nothing was merged');
  assert.match(fs.readFileSync(path.join(a, 'log.md'), 'utf8'), /로컬 미커밋/, 'the local edit survives');
});

test('sync does not rebase while the tree is dirty', () => {
  const { a, b } = makeWorld({ second: true });
  remoteAdvance(b, 'other.md');
  fs.writeFileSync(path.join(a, 'local.md'), 'local work\n', 'utf8');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'local work');
  fs.writeFileSync(path.join(a, 'draft.md'), 'wip\n', 'utf8');
  const res = sync(a, { regenerateIndex: stubIndex });
  assert.equal(res.status, 'dirty');
  assert.equal(res.exit, 1);
  assert.equal(git(a, 'log', '-1', '--format=%s'), 'local work');
});

test('sync rebases local commits onto a diverged remote', () => {
  const { a, b } = makeWorld({ second: true });
  remoteAdvance(b, 'other.md');
  fs.writeFileSync(path.join(a, 'local.md'), 'local work\n', 'utf8');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'local work');
  const res = sync(a, { regenerateIndex: stubIndex });
  assert.equal(res.status, 'rebased');
  assert.equal(res.exit, 0);
  assert.ok(fs.existsSync(path.join(a, 'other.md')), 'the remote commit is underneath');
  assert.equal(git(a, 'log', '-1', '--format=%s'), 'local work', 'the local commit is replayed on top');
});

test('sync stops at a real conflict and leaves no rebase in progress', () => {
  const { a, b } = makeWorld({ second: true });
  fs.writeFileSync(path.join(b, 'page.md'), 'their version\n', 'utf8');
  git(b, 'add', '-A');
  git(b, 'commit', '-m', 'theirs');
  git(b, 'push');
  fs.writeFileSync(path.join(a, 'page.md'), 'my version\n', 'utf8');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'mine');
  const res = sync(a, { regenerateIndex: stubIndex });
  assert.equal(res.status, 'rebase-conflict');
  assert.equal(res.exit, 1);
  assert.match(res.detail, /page\.md/);
  assert.equal(git(a, 'log', '-1', '--format=%s'), 'mine', 'the local commit is untouched');
  assert.equal(git(a, 'status', '--porcelain'), '', 'the rebase was aborted cleanly');
});

test('sync survives an unreachable remote', () => {
  const { a, remote } = makeWorld();
  fs.rmSync(remote, { recursive: true, force: true });
  const res = sync(a);
  assert.equal(res.status, 'offline');
  assert.equal(res.exit, 0);
});

// --- commit ---

test('commit stages the vault, names the commit after the log, and pushes', () => {
  const { a, remote } = makeWorld();
  fs.mkdirSync(path.join(a, 'concepts'), { recursive: true });
  fs.writeFileSync(path.join(a, 'concepts/x.md'), '# X\n', 'utf8');
  writeLog(a, '## [2026-09-03] ingest | 새 개념 적재');

  const res = commit(a);
  assert.equal(res.status, 'pushed');
  assert.equal(res.exit, 0);
  assert.equal(git(a, 'log', '-1', '--format=%s'), 'ingest(vault): 새 개념 적재');
  assert.equal(git(a, 'status', '--porcelain'), '', 'nothing left uncommitted');
  assert.match(execFileSync('git', ['-C', remote, 'log', '-1', '--format=%s'], { encoding: 'utf8' }), /새 개념 적재/);
});

test('commit is a no-op on a clean vault', () => {
  const { a } = makeWorld();
  const before = git(a, 'rev-parse', 'HEAD');
  const res = commit(a);
  assert.equal(res.status, 'nothing-to-commit');
  assert.equal(res.exit, 0);
  assert.equal(git(a, 'rev-parse', 'HEAD'), before);
});

test('a rejected push rebases onto the remote and pushes again', () => {
  const { a, b, remote } = makeWorld({ second: true });
  remoteAdvance(b, 'other.md');
  fs.writeFileSync(path.join(a, 'mine.md'), 'mine\n', 'utf8');
  writeLog(a, '## [2026-09-03] update | 로컬 작업');

  const res = commit(a, { regenerateIndex: stubIndex });
  assert.equal(res.status, 'pushed');
  assert.equal(res.exit, 0);
  assert.match(res.detail, /rebased/);
  assert.match(execFileSync('git', ['-C', remote, 'log', '-1', '--format=%s'], { encoding: 'utf8' }), /로컬 작업/);
});

test('two machines appending to log.md and regenerating index.md no longer conflict', () => {
  const { a, b, remote } = makeWorld({ second: true });
  // The other machine finishes a cycle first: log entry + regenerated index.
  writeLog(b, '## [2026-09-03] ingest | 다른 기기 적재');
  fs.writeFileSync(path.join(b, 'index.md'), '# Index\n- other\n', 'utf8');
  git(b, 'add', '-A');
  git(b, 'commit', '-m', 'other cycle');
  git(b, 'push');

  writeLog(a, '## [2026-09-03] research | 이 기기 조사');
  fs.writeFileSync(path.join(a, 'index.md'), '# Index\n- mine\n', 'utf8');

  let regenerated = 0;
  const res = commit(a, { regenerateIndex: (vault) => { regenerated++; stubIndex(vault); } });
  assert.equal(res.status, 'pushed', res.detail);
  assert.equal(regenerated, 1, 'index.md is rebuilt once after the rebase, not merged by hand');

  const log = fs.readFileSync(path.join(a, 'log.md'), 'utf8');
  assert.ok(log.indexOf('다른 기기 적재') < log.indexOf('이 기기 조사'), 'both entries survive, remote first');
  assert.match(log, /\n\n## \[2026-09-03\] research/, 'entries stay separated by a blank line');
  assert.equal(git(a, 'status', '--porcelain'), '');
  assert.equal(git(a, 'rev-parse', 'HEAD'), execFileSync('git', ['-C', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim());
});

test('a remote log rotation does not resurrect archived entries', () => {
  const { a, b } = makeWorld({ second: true });
  writeLog(a, '## [2026-01-01] ingest | 옛 엔트리');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'old');
  git(a, 'push');
  git(b, 'pull', '--quiet');

  // The other machine rotates: old entries move to the archive.
  fs.writeFileSync(path.join(b, 'log-2026.md'), fs.readFileSync(path.join(b, 'log.md'), 'utf8'), 'utf8');
  fs.writeFileSync(path.join(b, 'log.md'), '# Log\n\n이전 이력: [[log-2026]]\n', 'utf8');
  git(b, 'add', '-A');
  git(b, 'commit', '-m', 'rotate');
  git(b, 'push');

  writeLog(a, '## [2026-09-03] research | 회전 뒤 새 엔트리');
  const res = commit(a, { regenerateIndex: stubIndex });
  assert.equal(res.status, 'pushed', res.detail);
  const log = fs.readFileSync(path.join(a, 'log.md'), 'utf8');
  assert.doesNotMatch(log, /옛 엔트리/, 'the archived entry stays archived');
  assert.match(log, /회전 뒤 새 엔트리/);
});

test('a conflict outside log.md and index.md is handed back with the commit intact', () => {
  const { a, b } = makeWorld({ second: true });
  fs.writeFileSync(path.join(b, 'page.md'), 'their version\n', 'utf8');
  git(b, 'add', '-A');
  git(b, 'commit', '-m', 'theirs');
  git(b, 'push');

  fs.writeFileSync(path.join(a, 'page.md'), 'my version\n', 'utf8');
  writeLog(a, '## [2026-09-03] update | 같은 페이지 수정');
  const res = commit(a, { regenerateIndex: stubIndex });
  assert.equal(res.status, 'rebase-conflict');
  assert.equal(res.exit, 1);
  assert.match(res.detail, /page\.md/);
  assert.equal(git(a, 'log', '-1', '--format=%s'), 'update(vault): 같은 페이지 수정', 'the work is committed locally');
  assert.equal(git(a, 'status', '--porcelain'), '', 'no half-finished rebase is left behind');
});

test('commit without a remote still commits locally', () => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-local-'));
  roots.push(local);
  execFileSync('git', ['init', '-b', 'main', local], { stdio: 'ignore' });
  git(local, 'config', 'user.email', 'test@example.com');
  git(local, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(local, 'log.md'), '# Log\n\n## [2026-09-03] create | 첫 페이지\n', 'utf8');

  const res = commit(local);
  assert.equal(res.status, 'committed');
  assert.equal(res.exit, 0);
  assert.equal(git(local, 'log', '-1', '--format=%s'), 'create(vault): 첫 페이지');
});

// --- untracked branch (the live vault's shape: a remote branch, no tracking config) ---

test('sync and commit work on a branch with no tracking config', () => {
  const { a, b, remote } = makeWorld({ second: true });
  git(a, 'config', '--unset', 'branch.main.merge');
  git(a, 'config', '--unset', 'branch.main.remote');
  assert.equal(git(a, 'status', '-sb').split('\n')[0], '## main', 'branch really is untracked');

  remoteAdvance(b, 'other.md');
  assert.equal(sync(a).status, 'pulled', 'falls back to origin/<branch>');

  fs.writeFileSync(path.join(a, 'mine.md'), 'mine\n', 'utf8');
  writeLog(a, '## [2026-09-03] update | 추적 미설정 브랜치');
  assert.equal(commit(a).status, 'pushed');
  assert.match(execFileSync('git', ['-C', remote, 'log', '-1', '--format=%s'], { encoding: 'utf8' }), /추적 미설정 브랜치/);
});

test('a repository with no remote at all is left alone', () => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-noremote-'));
  roots.push(local);
  execFileSync('git', ['init', '-b', 'main', local], { stdio: 'ignore' });
  assert.equal(sync(local).status, 'no-upstream');
  assert.equal(sync(local).exit, 0);
});
