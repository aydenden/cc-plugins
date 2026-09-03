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

import { sync, commit, subjectFromLog } from './vault-git.mjs';

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

test('sync refuses to pull over a dirty working tree', () => {
  const { a, b } = makeWorld({ second: true });
  remoteAdvance(b, 'other.md');
  fs.writeFileSync(path.join(a, 'draft.md'), 'work in progress\n', 'utf8');
  const res = sync(a);
  assert.equal(res.status, 'dirty');
  assert.equal(res.exit, 1);
  assert.ok(!fs.existsSync(path.join(a, 'other.md')), 'nothing was merged');
});

test('sync reports divergence instead of merging', () => {
  const { a, b } = makeWorld({ second: true });
  remoteAdvance(b, 'other.md');
  fs.writeFileSync(path.join(a, 'local.md'), 'local work\n', 'utf8');
  git(a, 'add', '-A');
  git(a, 'commit', '-m', 'local work');
  const res = sync(a);
  assert.equal(res.status, 'diverged');
  assert.equal(res.exit, 1);
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

test('a rejected push keeps the commit and asks for a merge decision', () => {
  const { a, b } = makeWorld({ second: true });
  remoteAdvance(b, 'other.md');
  fs.writeFileSync(path.join(a, 'mine.md'), 'mine\n', 'utf8');
  writeLog(a, '## [2026-09-03] update | 로컬 작업');

  const res = commit(a);
  assert.equal(res.status, 'push-rejected');
  assert.equal(res.exit, 1);
  assert.match(res.detail, /Pull/);
  assert.equal(git(a, 'log', '-1', '--format=%s'), 'update(vault): 로컬 작업', 'the work is committed locally');
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
