/**
 * lint.ts — 위키 건강 점검 (2차, 설계 6절 lint 통합).
 *
 *   orphans   인바운드 wikilink가 0인 페이지
 *   doctor    깨진 wikilink(대상 페이지 없음) + 인덱스 stale(sha/존재 불일치)
 *   dup       제목 near-duplicate(토큰 자카드) — 정리 후보 (부록A: v2/v3·어순차이)
 *
 * 인덱스에 색인된 links·path·title·sha 필드를 재활용한다(별도 파싱 없음).
 */

import path from "path"
import fs from "fs"
import { createHash } from "crypto"
import { getAllDocs } from "./index-build"
import { pageFromContent } from "./index-build"
import { tokenizeText } from "./tokenizer"
import type { ChunkDoc } from "./types"

interface PageInfo {
  path: string
  slug: string
  title: string
  links: string[]
  sha256: string
}

function slugOf(p: string): string {
  const base = p.split("/").pop() ?? p
  return base.replace(/\.md$/, "")
}

/** 청크들을 페이지 단위로 접는다. */
function pagesFromDocs(db: any): PageInfo[] {
  const byPath = new Map<string, PageInfo>()
  for (const d of getAllDocs(db) as ChunkDoc[]) {
    if (byPath.has(d.path)) continue
    byPath.set(d.path, {
      path: d.path,
      slug: slugOf(d.path),
      title: d.title ?? slugOf(d.path),
      links: d.links ?? [],
      sha256: d.sha256 ?? "",
    })
  }
  return [...byPath.values()]
}

// --- orphans ---

export function lintOrphans(db: any): string[] {
  const pages = pagesFromDocs(db)
  const inbound = new Map<string, number>()
  for (const p of pages) {
    for (const target of p.links) {
      const slug = slugOf(target)
      inbound.set(slug, (inbound.get(slug) ?? 0) + 1)
    }
  }
  return pages
    .filter((p) => (inbound.get(p.slug) ?? 0) === 0)
    .map((p) => p.path)
    .sort()
}

// --- doctor ---

export interface DoctorReport {
  brokenLinks: { path: string; target: string }[]
  stale: { path: string; reason: "modified" | "deleted" | "unindexed" }[]
}

export function lintDoctor(vault: string, db: any, manifest: { pages: Record<string, { sha256: string }> }): DoctorReport {
  const pages = pagesFromDocs(db)
  const existSlugs = new Set(pages.map((p) => p.slug))

  // 깨진 wikilink: 대상 슬러그가 인덱스에 없음
  const brokenLinks: DoctorReport["brokenLinks"] = []
  for (const p of pages) {
    for (const target of p.links) {
      const slug = slugOf(target)
      if (!existSlugs.has(slug)) brokenLinks.push({ path: p.path, target })
    }
  }

  // stale: manifest sha vs 디스크 실제 sha 비교
  const stale: DoctorReport["stale"] = []
  for (const [rel, meta] of Object.entries(manifest.pages)) {
    const abs = path.join(vault, rel)
    if (!fs.existsSync(abs)) {
      stale.push({ path: rel, reason: "deleted" })
      continue
    }
    const content = fs.readFileSync(abs, "utf-8")
    const page = pageFromContent(rel, content)
    if (page.sha256 !== meta.sha256) stale.push({ path: rel, reason: "modified" })
  }

  return { brokenLinks, stale }
}

// --- 제목 near-duplicate ---

export interface TitleDup {
  a: string
  b: string
  similarity: number
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

/** 제목 토큰 자카드 >= threshold 쌍을 반환(정리 후보). */
export function lintTitleDuplicates(db: any, threshold = 0.5): TitleDup[] {
  const pages = pagesFromDocs(db)
  const tokens = pages.map((p) => new Set(tokenizeText(p.title)))
  const dups: TitleDup[] = []
  for (let i = 0; i < pages.length; i++) {
    for (let j = i + 1; j < pages.length; j++) {
      const sim = jaccard(tokens[i], tokens[j])
      if (sim >= threshold) dups.push({ a: pages[i].path, b: pages[j].path, similarity: Number(sim.toFixed(3)) })
    }
  }
  return dups.sort((x, y) => y.similarity - x.similarity)
}
