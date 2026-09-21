/**
 * 인계 문서가 놓이는 경로와 그 다음 번호.
 *
 * 경로를 손으로 조립하지 않는 이유는 정돈이 아니라 **인계 사슬**이다 — 3차 인계 세션이 1차에서 무엇을
 * 확정했는지 되짚을 수 있어야 하므로, 같은 폴더에 번호를 올려 쌓고 덮어쓰지 않는다.
 */

import fs from 'node:fs';
import path from 'node:path';
import { currentRepoKey, handoffRoot } from './state-root.mjs';

const DOC_RE = /^handoff-(\d{2})\.md$/;

/** 폴더 이름으로 쓸 수 있는 꼴로 깎는다. */
export function slugify(raw) {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'session';
}

/** 그 폴더에서 다음 인계 문서의 파일명. 번호를 앞에 두므로 최신 인계가 정렬만으로 정해진다. */
export function nextDocName(existing) {
  const used = (existing ?? [])
    .map((f) => DOC_RE.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `handoff-${String(next).padStart(2, '0')}.md`;
}

/** `<handoffRoot>/<repoKey>/<slug>` — 순수 조립. */
export function handoffDir({ root, repoKey, slug }) {
  return path.join(root, repoKey, slugify(slug));
}

/** 지금 위치·슬러그에 해당하는 인계 폴더를 만들고 절대경로를 돌려준다. */
export function ensureHandoffDir({ slug, cwd = process.cwd(), env = process.env } = {}) {
  const dir = handoffDir({ root: handoffRoot(env), repoKey: currentRepoKey(cwd), slug });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 그 폴더의 다음 인계 문서 절대경로. */
export function allocateDoc(dir) {
  return path.join(dir, nextDocName(fs.readdirSync(dir)));
}
