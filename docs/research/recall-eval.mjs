#!/usr/bin/env node
/**
 * /recall Grep 경로 recall 평가 하네스 (의존성 0)
 *
 * 평가셋: 볼트 log.md의 `## [date] action | subject` + `- 파일: path` 쌍.
 *   쿼리 = subject(페이지 제목형 자연어), 정답 = 해당 페이지 경로.
 * 측정 대상: search-expansion.md 1단계(Grep 전수검색)의 기계적 부분.
 *   에이전트가 수행하는 의미적 확장(한↔영 병기, 동의어)은 자동화 불가 → 미측정.
 *
 * 아암:
 *   literal   원문 질의 그대로 (확장 없음, 하한)
 *   inflected 각 토큰에 한국어 조사를 부착 (실사용 활용형 시뮬레이션)
 *   expanded  inflected 질의에 search-expansion.md 기계 규칙 적용
 *             (조사·어미 절단 + 띄어쓰기 \s* 흡수 + -i)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const WIKI = process.env.WIKI_PATH || process.env.OBSIDIAN_VAULT_PATH;
if (!WIKI) { console.error('WIKI_PATH 미설정'); process.exit(1); }

const SEARCH_DIRS = ['entities', 'concepts', 'comparisons', 'queries', 'summaries']
  .concat(process.argv.includes('--include-raw') ? ['raw'] : []);
const PARTICLES = ['은', '는', '이', '가', '을', '를', '의', '에서', '으로', '와', '과', '에'];

// --- 볼트 적재 ---

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.md')) out.push(p);
  }
  return out;
}

const files = SEARCH_DIRS.flatMap((d) => {
  try { return walk(join(WIKI, d)); } catch { return []; }
});

const corpus = files.map((p) => {
  const text = readFileSync(p, 'utf8');
  const rel = relative(WIKI, p);
  const h1 = (text.match(/^#\s+(.+)$/m) || [])[1] || '';
  const base = rel.split('/').pop().replace(/\.md$/, '');
  return { rel, lower: text.toLowerCase(), title: (h1 + ' ' + base).toLowerCase() };
});

// --- 평가셋 ---

const byBase = new Map();
for (const c of corpus) {
  const b = c.rel.split('/').pop();
  if (!byBase.has(b)) byBase.set(b, c.rel);
}
const dropped = [];

function buildEvalSet() {
  const log = readFileSync(join(WIKI, 'log.md'), 'utf8');
  const blocks = log.split(/^## /m).slice(1);
  const set = [];
  for (const b of blocks) {
    const head = b.split('\n')[0];
    const m = head.match(/^\[[\d-]+\]\s*[\w-]+(?:\s*\([^)]*\))?\s*\|\s*(.+)$/);
    if (!m) continue;
    const query = m[1].trim();
    const fm = b.match(/^-\s*파일:\s*`([^`]+)`/m);
    if (!fm) continue;
    const logged = fm[1].trim().replace(/^\.\//, '');
    // ccp-5f7 마이그레이션으로 디렉토리가 바뀐 페이지가 많아 파일명으로 재매핑한다
    const gold = corpus.some((c) => c.rel === logged)
      ? logged
      : (byBase.get(logged.split('/').pop()) || null);
    if (!gold) { dropped.push(logged); continue; } // 삭제·미해결 페이지 제외
    set.push({ query, gold });
  }
  return set;
}

// --- 질의 변형 ---

const STOP = new Set(['및', '그리고', 'vs', '대']);

function tokenize(q) {
  return q
    .split(/[\s·,()[\]{}"'`/|—–\-:;?!]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t.toLowerCase()));
}

/** 실사용 활용형 시뮬레이션: 한글 토큰에 조사를 결정적으로 부착 */
function inflect(tokens) {
  return tokens.map((t, i) =>
    /[가-힣]$/.test(t) ? t + PARTICLES[(t.length + i) % PARTICLES.length] : t
  );
}

/** search-expansion.md 기계 규칙: 조사·어미 절단 + 띄어쓰기 흡수 */
function stripParticle(t) {
  if (!/[가-힣]$/.test(t)) return t;
  for (const p of [...PARTICLES].sort((a, b) => b.length - a.length)) {
    if (t.length - p.length >= 2 && t.endsWith(p)) return t.slice(0, -p.length);
  }
  return t;
}

function toPattern(t) {
  return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- 검색 · 채점 ---

function scorePage(page, tokens) {
  let hitBody = 0, hitTitle = 0, lines = 0;
  for (const t of tokens) {
    const re = new RegExp(toPattern(t), 'gi');
    const m = page.lower.match(re);
    if (m) { hitBody++; lines += m.length; }
    if (page.title.match(new RegExp(toPattern(t), 'i'))) hitTitle++;
  }
  if (!hitBody) return 0;
  // 1차: 질의 토큰 커버리지, 2차: 제목 커버리지, 3차: 적중 라인 수(포화)
  return (hitBody / tokens.length) * 1000
    + (hitTitle / tokens.length) * 100
    + Math.min(lines, 50) / 100;
}

function search(tokens) {
  const scored = [];
  for (const page of corpus) {
    const s = scorePage(page, tokens);
    if (s > 0) scored.push({ rel: page.rel, s });
  }
  scored.sort((a, b) => b.s - a.s || a.rel.localeCompare(b.rel));
  return scored;
}

function evaluate(set, transform) {
  let rr = 0; const at = { 1: 0, 5: 0, 10: 0 }; const misses = [];
  for (const { query, gold } of set) {
    const tokens = transform(tokenize(query));
    const ranked = search(tokens);
    const idx = ranked.findIndex((r) => r.rel === gold);
    if (idx >= 0) {
      rr += 1 / (idx + 1);
      for (const k of [1, 5, 10]) if (idx < k) at[k]++;
    }
    if (idx < 0 || idx >= 5) misses.push({ query, gold, rank: idx < 0 ? null : idx + 1, tokens, top: ranked.slice(0, 3).map((r) => r.rel) });
  }
  const n = set.length;
  return {
    n, mrr: rr / n,
    r1: at[1] / n, r5: at[5] / n, r10: at[10] / n,
    misses,
  };
}

// --- 실행 ---

const set = buildEvalSet();
const arms = {
  literal: (ts) => ts,
  inflected: (ts) => inflect(ts),
  expanded: (ts) => inflect(ts).map(stripParticle),
  // 실사용 질의는 제목 전체가 아니라 핵심어 2~3개다. 최장 토큰 3개만 남겨 짧은 질의를 모사
  partial: (ts) => [...ts].sort((a, b) => b.length - a.length).slice(0, 3),
};

const out = { corpus: corpus.length, evalset: set.length, arms: {} };
for (const [name, fn] of Object.entries(arms)) {
  const r = evaluate(set, fn);
  out.arms[name] = r;
  console.log(`${name.padEnd(10)} n=${r.n}  MRR=${r.mrr.toFixed(3)}  r@1=${r.r1.toFixed(3)}  r@5=${r.r5.toFixed(3)}  r@10=${r.r10.toFixed(3)}  miss(>5)=${r.misses.length}`);
}
console.log(`\ncorpus=${out.corpus} pages, evalset=${out.evalset} queries`);

if (process.argv.includes('--json')) {
  const fs = await import('node:fs');
  fs.writeFileSync(process.argv[process.argv.indexOf('--json') + 1] || 'eval.json', JSON.stringify(out, null, 2));
}
