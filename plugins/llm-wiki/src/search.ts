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
    // 초성 매칭(초성 쿼리이거나, 짧은 쿼리의 보조 신호)
    if ((choseongQuery || q.length <= SHORT_QUERY_LEN) && qCho.length >= 2 && d.choseong?.includes(qCho)) {
      score = Math.max(score, choseongQuery ? 0.65 : 0.5)
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
  if (opts.boostLinks) {
    applyLinkBoost(pageHits)
    modeTags.push("link-boost")
  }
  if (opts.decay) {
    applyDecay(pageHits, opts.halfLifeDays, Date.now())
    modeTags.push("decay")
  }
  if (opts.boostLinks || opts.decay) pageHits.sort((a, b) => b.score - a.score)

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
