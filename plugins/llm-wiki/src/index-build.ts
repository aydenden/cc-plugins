/**
 * index-build.ts — 인덱싱 파이프라인.
 *
 *   볼트 discovery → frontmatter 파싱 → section chunk → (embed) → Orama 적재 → persist
 *
 * 설계 5절. 인덱스는 볼트 종속 자산이라 볼트 내 `.llm-wiki/`에 저장한다(ADR-3).
 * 임베딩 모델이 준비 안 됐으면 벡터 단계를 건너뛰고 BM25-only(lexical) 인덱스로
 * 동작한다(degraded). 증분(--file) 및 2차 sha256 skip을 위해 페이지별
 * sha256·chunkId를 manifest.json에 함께 기록한다.
 */

import path from "path"
import fs from "fs"
import { createHash } from "crypto"
import { create, insertMultiple, remove } from "@orama/orama"
import { persistToFile, restoreFromFile } from "@orama/plugin-data-persistence/server"
import { createOramaTokenizer, toChoseong } from "./tokenizer"
import { embed } from "./models"
import { EMBED_DIM, type WikiPage, type ChunkDoc } from "./types"

const INDEX_DIRNAME = ".llm-wiki"
const INDEX_FILE = "index.msp"
const MANIFEST_FILE = "manifest.json"
// section을 greedy 병합할 문자 상한(≈512~1024 토큰 — 부록E: 청크 수 관리).
const MAX_CHUNK_CHARS = 1200

// 검색 대상에서 제외할 디렉토리/파일 (설계 5.1: 위키 페이지만 색인).
const EXCLUDE_DIRS = new Set(["raw", ".obsidian", ".llm-wiki", "assets", "_archive"])
const EXCLUDE_FILES = new Set(["index.md", "log.md", "schema.md", "claude.md", "readme.md"])

// --- Section: 경로 헬퍼 ---

export function indexDir(vault: string): string {
  return path.join(vault, INDEX_DIRNAME)
}
function indexPath(vault: string): string {
  return path.join(indexDir(vault), INDEX_FILE)
}
function manifestPath(vault: string): string {
  return path.join(indexDir(vault), MANIFEST_FILE)
}

// --- Section: Frontmatter 파서 (배열/따옴표/누락 견딤) ---

interface ParsedFront {
  data: Record<string, string | string[]>
  body: string
}

/**
 * 첫 `---...---` 블록만 파싱. inline 배열([a, b])·블록 배열(- a)·따옴표 스칼라 지원.
 * 실제 볼트는 SCHEMA 이상형과 drift(date/summary/source 등)가 있어 방어적으로 파싱한다.
 */
export function parseFrontmatter(content: string): ParsedFront {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { data: {}, body: content.trim() }
  const [, yaml, body] = match
  const data: Record<string, string | string[]> = {}

  const lines = yaml.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const idx = line.indexOf(":")
    if (idx === -1 || /^\s*#/.test(line) || /^\s*-\s/.test(line)) continue
    const key = line.slice(0, idx).trim()
    if (!key) continue
    let raw = line.slice(idx + 1).trim()

    if (raw === "") {
      // 블록 배열 가능성: 뒤따르는 "- item" 라인 수집
      const items: string[] = []
      let j = i + 1
      while (j < lines.length && /^\s*-\s+/.test(lines[j])) {
        items.push(stripQuotes(lines[j].replace(/^\s*-\s+/, "").trim()))
        j++
      }
      if (items.length) {
        data[key] = items
        i = j - 1
      } else {
        data[key] = ""
      }
      continue
    }

    if (raw.startsWith("[")) {
      data[key] = parseInlineArray(raw)
    } else {
      data[key] = stripQuotes(raw)
    }
  }
  return { data, body: body.trim() }
}

function stripQuotes(s: string): string {
  return s.replace(/^["']/, "").replace(/["']$/, "").trim()
}

function parseInlineArray(raw: string): string[] {
  const inner = raw.replace(/^\[/, "").replace(/\]$/, "")
  if (!inner.trim()) return []
  return inner
    .split(",")
    .map((x) => stripQuotes(x.trim()))
    .filter(Boolean)
}

function asString(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? ""
  return v ?? ""
}
function asArray(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v
  if (typeof v === "string" && v) return [v]
  return []
}

// --- Section: 페이지 파싱 ---

const TYPE_BY_DIR: Record<string, string> = {
  concepts: "concept",
  comparisons: "comparison",
  entities: "entity",
  queries: "query",
}

function extractWikilinks(body: string): string[] {
  const out = new Set<string>()
  const re = /\[\[([^\]]+)\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    // [[target|alias]] → target
    const target = m[1].split("|")[0].trim()
    if (target) out.add(target)
  }
  return [...out]
}

function firstHeading(body: string): string {
  const m = body.match(/^#{1,6}\s+(.+)$/m)
  return m ? m[1].trim() : ""
}

export function pageFromContent(relPath: string, content: string): WikiPage {
  const { data, body } = parseFrontmatter(content)
  const dir = relPath.split("/")[0]
  const slug = path.basename(relPath, ".md")
  const title = asString(data.title) || firstHeading(body) || slug
  const type = asString(data.type) || TYPE_BY_DIR[dir] || "concept"
  const updated = asString(data.updated) || asString(data.date) || asString(data.created) || ""
  return {
    path: relPath,
    title,
    type,
    tags: asArray(data.tags),
    confidence: asString(data.confidence),
    updated,
    summary: asString(data.summary),
    links: extractWikilinks(body),
    body,
    sha256: createHash("sha256").update(body).digest("hex"),
  }
}

// --- Section: 청킹 (heading 단위 + greedy 병합) ---

interface Section {
  heading: string
  text: string
}

function splitSections(body: string): Section[] {
  const lines = body.split(/\r?\n/)
  const sections: Section[] = []
  const stack: string[] = []
  let cur: Section | null = null

  const flush = () => {
    if (cur && cur.text.trim()) sections.push({ heading: cur.heading, text: cur.text.trim() })
    cur = null
  }

  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.+)$/)
    if (h) {
      flush()
      const level = h[1].length
      stack.length = level - 1
      stack[level - 1] = h[2].trim()
      cur = { heading: stack.filter(Boolean).join(" > "), text: "" }
    } else {
      if (!cur) cur = { heading: "", text: "" }
      cur.text += line + "\n"
    }
  }
  flush()
  return sections.length ? sections : [{ heading: "", text: body.trim() }]
}

/** section을 MAX_CHUNK_CHARS까지 greedy 병합해 청크 수를 줄인다. */
function chunkPage(page: WikiPage): ChunkDoc[] {
  const sections = splitSections(page.body)
  const groups: Section[] = []
  let buf: Section | null = null

  for (const s of sections) {
    if (buf && buf.text.length + s.text.length <= MAX_CHUNK_CHARS) {
      buf.text += "\n\n" + (s.heading ? `# ${s.heading}\n` : "") + s.text
    } else {
      if (buf) groups.push(buf)
      buf = { heading: s.heading, text: (s.heading ? `# ${s.heading}\n` : "") + s.text }
    }
  }
  if (buf) groups.push(buf)

  return groups.map((g, i) => {
    const content = g.text.trim()
    return {
      id: `${page.path}#${i}`,
      path: page.path,
      title: page.title,
      type: page.type,
      tags: page.tags,
      confidence: page.confidence,
      updated: page.updated,
      heading: g.heading,
      summary: page.summary,
      links: page.links,
      sha256: page.sha256,
      choseong: toChoseong(`${page.title} ${g.heading} ${content}`),
      content,
      embedding: [],
    }
  })
}

// --- Section: Discovery ---

export async function discoverPages(vault: string): Promise<string[]> {
  const glob = new Bun.Glob("**/*.md")
  const out: string[] = []
  for await (const rel of glob.scan({ cwd: vault, absolute: false })) {
    const top = rel.split("/")[0]
    if (EXCLUDE_DIRS.has(top)) continue
    if (EXCLUDE_FILES.has(path.basename(rel).toLowerCase())) continue
    out.push(rel)
  }
  return out
}

// --- Section: Orama 인덱스 ---

interface Manifest {
  degraded: boolean
  createdAt: string
  pages: Record<string, { sha256: string; chunkIds: string[] }>
}

function oramaSchema(withVectors: boolean) {
  const base: Record<string, string> = {
    path: "string",
    title: "string",
    type: "enum",
    tags: "enum[]",
    confidence: "enum",
    updated: "string",
    heading: "string",
    summary: "string",
    links: "string[]",
    sha256: "string",
    choseong: "string",
    content: "string",
  }
  if (withVectors) base.embedding = `vector[${EMBED_DIM}]`
  return base
}

async function newDb(withVectors: boolean) {
  return create({
    schema: oramaSchema(withVectors) as any,
    components: { tokenizer: createOramaTokenizer() as any },
  })
}

async function embedChunks(chunks: ChunkDoc[]): Promise<boolean> {
  // 모델 미준비/실패 시 false(degraded) — 벡터 없이 진행.
  try {
    const vectors = await embed(chunks.map((c) => (c.heading ? `${c.heading}\n${c.content}` : c.content)))
    chunks.forEach((c, i) => (c.embedding = vectors[i]))
    return true
  } catch (err) {
    process.stderr.write(`[llm-wiki] 임베딩 모델 미준비 → BM25-only(degraded): ${(err as Error).message}\n`)
    return false
  }
}

function persistDocs(chunks: ChunkDoc[], withVectors: boolean) {
  // Orama vector 필드는 embedding 키 필요. degraded면 embedding 제거.
  return chunks.map((c) => {
    if (withVectors) return c
    const { embedding, ...rest } = c
    return rest
  })
}

export interface BuildResult {
  pages: number
  chunks: number
  degraded: boolean
  /** 증분: 변경/신규 페이지 수 */
  changed?: number
  /** 증분: 삭제된 페이지 수 */
  removed?: number
  /** 변경 없음(증분에서 diff 0) */
  unchanged?: boolean
}

/**
 * 볼트 인덱싱. 기존 인덱스가 있고 --force가 아니며 degraded가 아니면
 * sha256 diff로 **변경/신규 페이지만 재임베딩**한다(2차 증분). 그 외엔 전체 재빌드.
 */
export async function buildIndex(vault: string, opts: { force?: boolean } = {}): Promise<BuildResult> {
  const rels = await discoverPages(vault)
  const existing = opts.force ? null : await loadIndex(vault)
  if (existing && !existing.manifest.degraded) {
    return incrementalBuild(vault, existing.db, existing.manifest, rels)
  }
  return fullBuild(vault, rels)
}

function countChunks(manifest: Manifest): number {
  return Object.values(manifest.pages).reduce((n, p) => n + p.chunkIds.length, 0)
}

/** 전체 재빌드(첫 인덱싱·--force·degraded 업그레이드). */
async function fullBuild(vault: string, rels: string[]): Promise<BuildResult> {
  const chunks: ChunkDoc[] = []
  const manifest: Manifest = { degraded: false, createdAt: new Date().toISOString().slice(0, 10), pages: {} }

  for (const rel of rels) {
    const content = await Bun.file(path.join(vault, rel)).text()
    const page = pageFromContent(rel, content)
    const pageChunks = chunkPage(page)
    manifest.pages[rel] = { sha256: page.sha256, chunkIds: pageChunks.map((c) => c.id) }
    chunks.push(...pageChunks)
  }

  const withVectors = await embedChunks(chunks)
  manifest.degraded = !withVectors

  const db = await newDb(withVectors)
  await insertMultiple(db, persistDocs(chunks, withVectors) as any)

  await writeIndex(vault, db, manifest)
  return { pages: rels.length, chunks: chunks.length, degraded: !withVectors }
}

/** sha256 증분 재빌드: 변경/신규만 재임베딩, 삭제분 제거. */
async function incrementalBuild(
  vault: string,
  db: any,
  manifest: Manifest,
  rels: string[],
): Promise<BuildResult> {
  const onDisk = new Set(rels)

  // 1) 삭제된 페이지 제거
  let removed = 0
  for (const rel of Object.keys(manifest.pages)) {
    if (!onDisk.has(rel)) {
      for (const id of manifest.pages[rel].chunkIds) {
        try {
          await remove(db, id)
        } catch {
          /* 이미 없음 */
        }
      }
      delete manifest.pages[rel]
      removed++
    }
  }

  // 2) 변경/신규 페이지 수집(기존 청크는 제거 예약)
  const freshChunks: ChunkDoc[] = []
  const updates: { rel: string; chunkIds: string[]; sha256: string }[] = []
  let changed = 0
  for (const rel of rels) {
    const content = await Bun.file(path.join(vault, rel)).text()
    const page = pageFromContent(rel, content)
    const prev = manifest.pages[rel]
    if (prev && prev.sha256 === page.sha256) continue // 변경 없음 → skip
    if (prev) {
      for (const id of prev.chunkIds) {
        try {
          await remove(db, id)
        } catch {
          /* 이미 없음 */
        }
      }
    }
    const pageChunks = chunkPage(page)
    freshChunks.push(...pageChunks)
    updates.push({ rel, chunkIds: pageChunks.map((c) => c.id), sha256: page.sha256 })
    changed++
  }

  if (changed === 0 && removed === 0) {
    return { pages: rels.length, chunks: countChunks(manifest), degraded: false, unchanged: true }
  }

  // 3) 변경분만 임베딩. 모델이 사라졌으면(임베딩 실패) 전체 재빌드(degraded)로 폴백
  //    — 기존 벡터 인덱스에 무벡터 청크를 섞으면 하이브리드가 깨지기 때문.
  if (freshChunks.length) {
    const withVectors = await embedChunks(freshChunks)
    if (!withVectors) return fullBuild(vault, rels)
    await insertMultiple(db, persistDocs(freshChunks, true) as any)
  }

  for (const u of updates) manifest.pages[u.rel] = { sha256: u.sha256, chunkIds: u.chunkIds }
  await writeIndex(vault, db, manifest)
  return { pages: rels.length, chunks: countChunks(manifest), degraded: false, changed, removed }
}

/** 단일 파일 증분 인덱싱(capture 직후). 인덱스 없으면 전체 빌드로 폴백. */
export async function indexFile(vault: string, absFile: string): Promise<{ chunks: number; degraded: boolean }> {
  const rel = path.relative(vault, absFile)
  const existing = await loadIndex(vault)
  if (!existing) {
    const r = await buildIndex(vault)
    return { chunks: r.chunks, degraded: r.degraded }
  }
  const { db, manifest } = existing

  // 기존 이 파일의 청크 제거
  const prev = manifest.pages[rel]
  if (prev) {
    for (const id of prev.chunkIds) {
      try {
        await remove(db, id)
      } catch {
        // 이미 없음 — 무시
      }
    }
  }

  const content = await Bun.file(absFile).text()
  const page = pageFromContent(rel, content)
  const pageChunks = chunkPage(page)

  const withVectors = !manifest.degraded && (await embedChunks(pageChunks))
  await insertMultiple(db, persistDocs(pageChunks, withVectors) as any)

  manifest.pages[rel] = { sha256: page.sha256, chunkIds: pageChunks.map((c) => c.id) }
  await writeIndex(vault, db, manifest)
  return { chunks: pageChunks.length, degraded: manifest.degraded }
}

async function writeIndex(vault: string, db: any, manifest: Manifest): Promise<void> {
  fs.mkdirSync(indexDir(vault), { recursive: true })
  await persistToFile(db, "binary", indexPath(vault))
  fs.writeFileSync(manifestPath(vault), JSON.stringify(manifest, null, 2))
}

/**
 * 인덱스의 모든 문서를 반환(정확검색 스캔·lint용). Orama 내부 문서 저장소 접근.
 * 543~수천 규모라 전수 스캔이 수 ms.
 */
export function getAllDocs(db: any): ChunkDoc[] {
  const store = db?.data?.docs?.docs
  if (!store) return []
  return Object.values(store) as ChunkDoc[]
}

export async function loadIndex(vault: string): Promise<{ db: any; manifest: Manifest } | null> {
  if (!fs.existsSync(indexPath(vault)) || !fs.existsSync(manifestPath(vault))) return null
  const db: any = await restoreFromFile("binary", indexPath(vault))
  // persist는 tokenizer 함수를 직렬화하지 않는다. 복원 후 lindera tokenizer를
  // 재주입하지 않으면 쿼리가 기본 tokenizer로 쪼개져 한국어 색인과 어긋난다.
  db.tokenizer = createOramaTokenizer() as any
  const manifest = JSON.parse(fs.readFileSync(manifestPath(vault), "utf-8")) as Manifest
  return { db, manifest }
}
