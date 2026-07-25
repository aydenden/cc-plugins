/**
 * search.ts — 하이브리드 검색 + 정확검색 레인 + cross-encoder rerank + 재랭킹 신호.
 *
 *   query → BM25(lindera) + vector(bge-m3) hybrid + Exact(리터럴·초성) → frontmatter 필터
 *         → rerank(bge-reranker-v2-m3) → link-boost → time-decay → progressive JSON
 *
 * 설계 4·5·6절. 모델 미준비(degraded) 인덱스면 BM25-only로 자동 강등한다.
 * 결과는 페이지 단위로 dedupe(같은 페이지의 여러 청크 중 최고 점수만).
 * rerank/link-boost/decay는 --rerank/--boost-links/--decay 플래그로 각각 켜며,
 * rerank 점수(또는 hybrid 점수) 위에 link-boost·decay를 곱해 합성한다.
 */

import { search as oramaSearch } from "@orama/orama"
import { loadIndex, getAllDocs } from "./index-build"
import { embedOne, rerank } from "./models"
import { tokenizeText, toChoseong, isChoseongQuery } from "./tokenizer"
import type { SearchHit, ChunkDoc } from "./types"

export type SearchMode = "hybrid" | "semantic" | "lexical"

export interface SearchOptions {
  mode: SearchMode
  filterType?: string
  filterTags?: string[]
  rerank: boolean
  exact: boolean
  /** 제목 완전/부분 일치 가중. 기본 ON(undefined는 ON, false만 해제). */
  titleBoost?: boolean
  boostLinks: boolean
  decay: boolean
  halfLifeDays: number
  limit: number
  level: 1 | 2 | 3 | 4
}

const SNIPPET_CHARS = 240
const CANDIDATE_MULTIPLIER = 4
const MIN_CANDIDATES = 30
// 짧은 쿼리(≤ 이 길이, 공백 제외)는 정확 레인을 자동 가중(한국어 2글자·코드심볼).
const SHORT_QUERY_LEN = 6

interface ChunkHit {
  score: number
  doc: ChunkDoc
}

function buildWhere(opts: SearchOptions): Record<string, unknown> | undefined {
  const where: Record<string, unknown> = {}
  if (opts.filterType) where.type = { eq: opts.filterType }
  if (opts.filterTags && opts.filterTags.length) where.tags = { containsAll: opts.filterTags }
  return Object.keys(where).length ? where : undefined
}

function passesFilter(doc: ChunkDoc, opts: SearchOptions): boolean {
  if (opts.filterType && doc.type !== opts.filterType) return false
  if (opts.filterTags && opts.filterTags.length) {
    const tags = new Set(doc.tags ?? [])
    if (!opts.filterTags.every((t) => tags.has(t))) return false
  }
  return true
}

function slugOf(p: string): string {
  const base = p.split("/").pop() ?? p
  return base.replace(/\.md$/, "")
}

function makeSnippet(content: string, query: string): string {
  const text = content.replace(/\s+/g, " ").trim()
  const tokens = tokenizeText(query)
  const lower = text.toLowerCase()
  let pos = -1
  for (const t of tokens) {
    const p = lower.indexOf(t)
    if (p !== -1 && (pos === -1 || p < pos)) pos = p
  }
  if (pos === -1) return text.slice(0, SNIPPET_CHARS)
  const start = Math.max(0, pos - SNIPPET_CHARS / 3)
  const slice = text.slice(start, start + SNIPPET_CHARS)
  return (start > 0 ? "…" : "") + slice + (start + SNIPPET_CHARS < text.length ? "…" : "")
}

// --- 정확검색 레인 (2차): 리터럴 substring + es-hangul 초성 ---

/**
 * Word-boundary-aligned choseong match.
 *
 * The stored `choseong` field is built as `toChoseong(title + heading + content)`, which strips
 * whitespace. A plain substring test therefore also matches initials that straddle word
 * boundaries — measured: the 4-jamo query "ㅅㅇㅇㅅ" hits 205 of 542 pages. Candidates coming out
 * of that cheap prefilter are re-verified here so only word-aligned matches survive.
 *
 * @returns matched — query aligns with the start of some word (or run of words);
 *          wholeWords — the matched run ends on a word boundary too (stronger signal);
 *          hits — number of aligned occurrences (weak tf signal for ranking).
 */
function choseongBoundaryMatch(text: string, qCho: string): { matched: boolean; wholeWords: boolean; hits: number } {
  if (!text) return { matched: false, wholeWords: false, hits: 0 }
  // 공백뿐 아니라 구두점도 단어 경계다. 볼트 본문은 "실거래가·건축물대장·토지" 처럼 가운뎃점으로
  // 나열하거나 **강조** 마크업을 쓰므로, 공백만으로 쪼개면 안쪽 단어가 시작 위치를 잃는다.
  const words: string[] = []
  for (const w of text.split(/[^가-힣ㄱ-ㅎA-Za-z0-9]+/)) if (w) words.push(toChoseong(w))
  let hits = 0
  let wholeWords = false
  for (let i = 0; i < words.length; i++) {
    if (!words[i].startsWith(qCho[0])) continue // 첫 자모 불일치는 즉시 스킵
    let acc = ""
    for (let j = i; j < words.length && acc.length < qCho.length; j++) acc += words[j]
    if (acc.startsWith(qCho)) {
      hits++
      if (acc.length === qCho.length) wholeWords = true
    }
  }
  return { matched: hits > 0, wholeWords, hits }
}

/**
 * Score a choseong match. The old implementation returned a constant (0.65), so every candidate
 * tied and ordering fell back to scan order — measured r@10 0.56 on queries whose target term is
 * unique in the vault. Longer queries, title matches, and word-aligned ends now rank higher.
 */
function choseongScore(inTitle: boolean, qLen: number, wholeWords: boolean, hits: number, isChoQuery: boolean): number {
  const lenFactor = Math.min(qLen, 12) / 12
  const base = (inTitle ? 0.75 : 0.6) * (isChoQuery ? 1 : 0.8)
  const s = base + (wholeWords ? 0.1 : 0) + 0.1 * lenFactor + (0.03 * Math.min(hits, 3)) / 3
  return Math.min(0.95, s) // 리터럴 제목 완전일치(1.0)를 넘지 않도록 상한
}

/** 전 문서를 스캔해 리터럴/초성 정확 매칭을 페이지 단위로 반환. */
function exactLane(docs: ChunkDoc[], query: string, opts: SearchOptions): Map<string, ChunkHit> {
  const choseongQuery = isChoseongQuery(query)
  const q = query.toLowerCase().replace(/\s+/g, "")
  const qCho = choseongQuery ? query.replace(/\s+/g, "") : toChoseong(query)
  const byPath = new Map<string, ChunkHit>()
  if (q.length < 2 && !choseongQuery) return byPath

  for (const d of docs) {
    if (!passesFilter(d, opts)) continue
    let score = 0
    if (!choseongQuery) {
      const title = (d.title ?? "").toLowerCase().replace(/\s+/g, "")
      const body = `${d.title ?? ""} ${d.content ?? ""}`.toLowerCase().replace(/\s+/g, "")
      if (title.includes(q)) score = Math.max(score, 1.0)
      else if (body.includes(q)) score = Math.max(score, 0.7)
    }
    // 초성 매칭(초성 쿼리이거나, 짧은 쿼리의 보조 신호).
    // 저장 필드 substring은 값싼 프리필터로만 쓰고, 통과분만 단어 경계로 재검증한다.
    if ((choseongQuery || q.length <= SHORT_QUERY_LEN) && qCho.length >= 2 && d.choseong?.includes(qCho)) {
      const inTitle = choseongBoundaryMatch(`${d.title ?? ""} ${d.heading ?? ""}`, qCho)
      const inBody = inTitle.matched ? null : choseongBoundaryMatch(d.content ?? "", qCho)
      const m = inTitle.matched ? inTitle : inBody
      if (m?.matched) {
        score = Math.max(score, choseongScore(inTitle.matched, qCho.length, m.wholeWords, m.hits, choseongQuery))
      }
    }
    if (score > 0) {
      const cur = byPath.get(d.path)
      if (!cur || score > cur.score) byPath.set(d.path, { score, doc: d })
    }
  }
  return byPath
}

// --- 재랭킹 신호 (3차) ---

/** link-boost: 결과 집합 내부에서 서로 wikilink로 연결된 페이지에 가중. */
function applyLinkBoost(hits: ChunkHit[]): void {
  const slugToHit = new Map<string, ChunkHit>()
  for (const h of hits) slugToHit.set(slugOf(h.doc.path), h)

  const inbound = new Map<string, number>() // slug → 결과 내부에서 받은 링크 수
  for (const h of hits) {
    for (const target of h.doc.links ?? []) {
      const tSlug = slugOf(target)
      if (slugToHit.has(tSlug)) inbound.set(tSlug, (inbound.get(tSlug) ?? 0) + 1)
    }
  }
  for (const h of hits) {
    const deg = inbound.get(slugOf(h.doc.path)) ?? 0
    if (deg > 0) h.score *= 1 + 0.1 * Math.min(deg, 3) // 최대 +30%
  }
}

/** 제목 비교용 정규화: 소문자 + 한글/영숫자만 남김(공백·구두점 무시). */
function normalizeForTitle(s: string): string {
  return s.toLowerCase().replace(/[^가-힣a-z0-9]/g, "")
}

/**
 * title-boost: 쿼리가 페이지 제목과 (거의) 같을 때 그 페이지를 끌어올린다.
 *
 * cross-encoder rerank는 청크 본문을 보고 점수를 매기므로, 쿼리가 제목과 사실상 동일한
 * 경우에도 본문이 더 장황한 다른 페이지에 밀린다. 측정: log.md 제목을 쿼리로 쓴 130건에서
 * 구 index.md Grep이 MRR 0.915 vs 하이브리드 0.857로 앞섰고, 그 격차가 이 패턴에서 나왔다.
 *
 * 완전일치는 강하게(×1.5), 부분일치는 제목 토큰이 쿼리에 얼마나 덮이는지에 비례해 걸며,
 * 1토큰 제목("HTTP")이 우연한 등장으로 올라오지 않도록 부분일치는 2토큰 이상만 본다.
 */
export function applyTitleBoost(hits: ChunkHit[], query: string): void {
  const qToks = new Set(tokenizeText(query))
  if (!qToks.size) return
  const qNorm = normalizeForTitle(query)
  for (const h of hits) {
    const title = h.doc.title ?? ""
    if (!title) continue
    if (normalizeForTitle(title) === qNorm) {
      h.score *= 1.5
      continue
    }
    const tToks = tokenizeText(title)
    if (tToks.length < 2) continue
    const covered = tToks.filter((t) => qToks.has(t)).length / tToks.length
    if (covered >= 0.6) h.score *= 1 + 0.4 * covered
  }
}

/** time-decay: updated/date 기반 최신 가중(반감기 지수감쇠). 날짜 없으면 중립. */
function applyDecay(hits: ChunkHit[], halfLifeDays: number, nowMs: number): void {
  const DAY = 86_400_000
  for (const h of hits) {
    const t = Date.parse(h.doc.updated ?? "")
    if (Number.isNaN(t)) continue
    const ageDays = Math.max(0, (nowMs - t) / DAY)
    h.score *= Math.pow(0.5, ageDays / halfLifeDays)
  }
}

/** 레벨별로 SearchHit 필드를 투영(토큰 예산). */
function projectByLevel(hit: SearchHit, level: number): Partial<SearchHit> {
  if (level <= 1) return { path: hit.path, title: hit.title, score: hit.score }
  if (level === 2)
    return {
      path: hit.path,
      title: hit.title,
      type: hit.type,
      tags: hit.tags,
      confidence: hit.confidence,
      score: hit.score,
      snippet: hit.snippet ? hit.snippet.slice(0, 80) : "",
      updated: hit.updated,
    }
  return hit
}

export async function searchVault(
  vault: string,
  query: string,
  opts: SearchOptions,
): Promise<{ query: string; mode: string; degraded: boolean; results: Partial<SearchHit>[] }> {
  const loaded = await loadIndex(vault)
  if (!loaded) {
    throw new Error(`인덱스 없음: ${vault}/.llm-wiki. 먼저 'llm-wiki index'를 실행하세요.`)
  }
  const { db, manifest } = loaded
  const degraded = manifest.degraded
  const choseongQuery = isChoseongQuery(query)
  const candidateLimit = Math.max(opts.limit * CANDIDATE_MULTIPLIER, MIN_CANDIDATES)
  const modeTags: string[] = []

  const byPath = new Map<string, ChunkHit>()

  // --- 초성 쿼리는 하이브리드가 무의미 → 정확(초성) 레인만 사용 ---
  if (choseongQuery) {
    for (const [p, h] of exactLane(getAllDocs(db), query, opts)) byPath.set(p, h)
    modeTags.push("choseong")
  } else {
    // --- 하이브리드/lexical 레인 ---
    const effectiveMode: SearchMode = degraded ? "lexical" : opts.mode
    let queryVec: number[] | null = null
    let modeUsed: SearchMode = effectiveMode
    let vecDegraded = false
    if (effectiveMode === "hybrid" || effectiveMode === "semantic") {
      try {
        queryVec = await embedOne(query)
      } catch {
        queryVec = null
        modeUsed = "lexical"
        vecDegraded = true
      }
    }
    const params: Record<string, unknown> = {
      term: query,
      limit: candidateLimit,
      where: buildWhere(opts),
      properties: ["title", "content", "summary", "heading"],
      similarity: 0.3,
    }
    if (modeUsed === "hybrid" && queryVec) {
      params.mode = "hybrid"
      params.vector = { value: queryVec, property: "embedding" }
    } else if (modeUsed === "semantic" && queryVec) {
      params.mode = "vector"
      params.vector = { value: queryVec, property: "embedding" }
    }
    const res: any = await oramaSearch(db, params as any)
    for (const h of res.hits ?? []) {
      const p = h.document.path
      const cur = byPath.get(p)
      if (!cur || h.score > cur.score) byPath.set(p, { score: h.score, doc: h.document })
    }
    modeTags.push(vecDegraded ? "lexical" : modeUsed)

    // --- 정확 레인 병합(--exact 또는 짧은 쿼리) ---
    const q = query.replace(/\s+/g, "")
    if (opts.exact || q.length <= SHORT_QUERY_LEN) {
      for (const [p, ex] of exactLane(getAllDocs(db), query, opts)) {
        const cur = byPath.get(p)
        if (cur) cur.score += ex.score * 0.5 // 기존 후보 가중
        else byPath.set(p, ex) // 하이브리드가 놓친 정확 매칭 편입
      }
      modeTags.push("exact")
    }
  }

  let pageHits = [...byPath.values()].sort((a, b) => b.score - a.score)

  // --- rerank (cross-encoder) ---
  if (opts.rerank && !degraded && !choseongQuery && pageHits.length > 1) {
    try {
      const topForRerank = pageHits.slice(0, candidateLimit)
      const scores = await rerank(
        query,
        topForRerank.map((h) => (h.doc.heading ? `${h.doc.heading}\n${h.doc.content}` : h.doc.content)),
      )
      topForRerank.forEach((h, i) => (h.score = scores[i]))
      pageHits = topForRerank.sort((a, b) => b.score - a.score)
      modeTags.push("rerank")
    } catch {
      /* rerank 모델 미준비 — 기존 순위 유지 */
    }
  }

  // --- 재랭킹 신호(3차): rerank/hybrid 점수 위에 곱 ---
  // title-boost는 기본 ON(--no-title-boost로 해제) — 제목이 곧 쿼리인 흔한 경우를 rerank가
  // 놓치는 문제가 실측으로 확인됐고, 그 경로가 recall 스킬의 기본 호출이다.
  if (opts.titleBoost !== false && !choseongQuery) {
    applyTitleBoost(pageHits, query)
    modeTags.push("title-boost")
  }
  if (opts.boostLinks) {
    applyLinkBoost(pageHits)
    modeTags.push("link-boost")
  }
  if (opts.decay) {
    applyDecay(pageHits, opts.halfLifeDays, Date.now())
    modeTags.push("decay")
  }
  if (opts.titleBoost !== false || opts.boostLinks || opts.decay) pageHits.sort((a, b) => b.score - a.score)

  const top = pageHits.slice(0, opts.limit)
  const results: Partial<SearchHit>[] = top.map((h) => {
    const d = h.doc
    const full: SearchHit = {
      path: d.path,
      title: d.title,
      type: d.type,
      tags: d.tags ?? [],
      confidence: d.confidence ?? "",
      score: Number(h.score?.toFixed?.(4) ?? h.score),
      snippet: makeSnippet(d.content ?? "", query),
      updated: d.updated ?? "",
    }
    return projectByLevel(full, opts.level)
  })

  return {
    query,
    mode: modeTags.join("+") || "lexical",
    degraded,
    results,
  }
}
