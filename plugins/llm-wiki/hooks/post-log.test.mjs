/**
 * Regression tests for post-log.mjs — the PostToolUse hook that runs maintenance
 * right after log.md is appended. Run with: node --test scripts/lint.test.mjs hooks/post-log.test.mjs
 *
 * Dependency-free: node:test / node:assert only.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HOOK = new URL('./post-log.mjs', import.meta.url).pathname;

const SCHEMA = `# Wiki Schema

## Frontmatter

\`\`\`yaml
---
type: concept                                           # required, 1:1 with the directory
tags: [from taxonomy below]                             # required
summary: one-line description of this page              # required
date: YYYY-MM-DD                                        # required
sources:                                                # required, always a YAML list
  - raw/articles/foo.md
---
\`\`\`

**Removed fields** — do not write these:
\`title\`, \`created\`, \`updated\`.

## Page Types & Directories

| type | directory | holds |
|---|---|---|
| \`concept\` | \`concepts/\` | a concept |

## Tag Taxonomy

### Group
- \`approved\` — an approved tag
`;

const vaults = [];
test.after(() => vaults.forEach((v) => fs.rmSync(v, { recursive: true, force: true })));

/** Throwaway vault: healthy by default, one planted broken link when asked. */
function makeVault({ broken = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-wiki-hook-'));
  vaults.push(root);
  const write = (rel, body) => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body, 'utf8');
  };
  write('SCHEMA.md', SCHEMA);
  write('log.md', '# Log\n');
  write('index.md', '# Index\n\n<!-- llm-wiki:auto:start -->\n<!-- llm-wiki:auto:end -->\n');
  if (broken) {
    write('concepts/spoke.md',
      '---\ntype: concept\ntags: [approved]\nsummary: the spoke\ndate: 2026-08-16\n'
      + 'sources:\n  - https://example.com/a\n---\n\n# Spoke\n\nSee [[nowhere]].\n');
  }
  return root;
}

/** Invoke the hook exactly as Claude Code does: payload on stdin, vault via env. */
function runHook(vault, filePath) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: filePath } }),
    encoding: 'utf8',
    env: { ...process.env, WIKI_PATH: vault, OBSIDIAN_VAULT_PATH: vault },
  });
}

test('ignores writes outside the vault log', () => {
  const vault = makeVault();
  const res = runHook(vault, path.join(vault, 'concepts/whatever.md'));
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
});

test('ignores a payload with no file_path', () => {
  const vault = makeVault();
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }),
    encoding: 'utf8',
    env: { ...process.env, WIKI_PATH: vault },
  });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
});

test('survives malformed stdin without blocking the write', () => {
  const res = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
});

test('stays silent when no vault is configured', () => {
  const env = { ...process.env };
  delete env.WIKI_PATH;
  delete env.OBSIDIAN_VAULT_PATH;
  const res = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_input: { file_path: '/anywhere/log.md' } }),
    encoding: 'utf8',
    env,
  });
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
});

test('on a clean vault: regenerates the index and reports via systemMessage', () => {
  const vault = makeVault();
  const res = runHook(vault, path.join(vault, 'log.md'));
  assert.equal(res.status, 0);
  const payload = JSON.parse(res.stdout);
  assert.match(payload.systemMessage, /^\[llm-wiki\]/);
  assert.match(payload.systemMessage, /LINT ok backlog=\d+/);
});

test('on error groups: exits 2 so the summary is fed back to Claude', () => {
  const vault = makeVault({ broken: true });
  const res = runHook(vault, path.join(vault, 'log.md'));
  assert.equal(res.status, 2);
  assert.equal(res.stdout, '');
  assert.match(res.stderr, /LINT error=\d+/);
  assert.match(res.stderr, /broken-links/);
});
