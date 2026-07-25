#!/usr/bin/env bun
/**
 * cli.ts — llm-wiki 엔트리포인트 (Bun, clap 없이 인자 파싱).
 *
 * 서브커맨드:
 *   index  [--vault <p>] [--file <f>] [--force]
 *   search <query> [--mode hybrid|semantic|lexical] [--filter type=..,tags=..]
 *          [--rerank] [-n N] [--level 1|2|3|4] [--json]
 *   status [--vault <p>]
 *
 * 스킬은 `--json`으로만 소비한다(설계 4절). 인간용 출력은 부차적.
 */

import path from "path"
import fs from "fs"
import { buildIndex, indexFile, loadIndex, indexDir, getAllDocs, pageFromContent } from "./index-build"
import { searchVault, type SearchMode, type SearchOptions } from "./search"
import { lintOrphans, lintDoctor, lintTitleDuplicates } from "./lint"
import { embeddingModelCached } from "./models"

// --- Section: 인자 파싱 ---

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

const BOOL_FLAGS = new Set(["force", "rerank", "json", "exact", "boost-links", "decay", "help"])

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "-n") {
      flags.n = argv[++i]
    } else if (a.startsWith("--")) {
      const key = a.slice(2)
      if (BOOL_FLAGS.has(key)) flags[key] = true
      else flags[key] = argv[++i]
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

function resolveVault(flags: Flags): string {
  const v = (flags.vault as string) || process.env.WIKI_PATH || process.env.OBSIDIAN_VAULT_PATH
  if (!v) {
    fail("볼트 경로 없음: --vault 또는 WIKI_PATH/OBSIDIAN_VAULT_PATH 환경변수를 설정하세요.")
  }
  if (!fs.existsSync(v!)) fail(`볼트 경로가 존재하지 않음: ${v}`)
  return v!
}

function fail(msg: string): never {
  process.stderr.write(`[llm-wiki] ${msg}\n`)
  process.exit(1)
}

function parseFilter(raw: string | undefined): { type?: string; tags: string[] } {
  const out: { type?: string; tags: string[] } = { tags: [] }
  if (!raw) return out
  let lastKey: "type" | "tags" | null = null
  for (const tok of raw.split(",")) {
    const t = tok.trim()
    if (!t) continue
    const eq = t.indexOf("=")
    if (eq === -1) {
      // 이전 키의 연속 값 (예: tags=a,b → 'b')
      if (lastKey === "tags") out.tags.push(t)
      continue
    }
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (k === "type") {
      out.type = v
      lastKey = "type"
    } else if (k === "tags") {
      if (v) out.tags.push(v)
      lastKey = "tags"
    }
  }
  return out
}

/** "90d" | "90" → 90 (일). 기본 90. */
function parseHalfLife(raw: string | undefined): number {
  if (!raw) return 90
  const n = parseInt(String(raw).replace(/d$/i, ""), 10)
  return Number.isFinite(n) && n > 0 ? n : 90
}

// --- Section: 커맨드 ---

async function cmdIndex(flags: Flags): Promise<void> {
  const vault = resolveVault(flags)
  if (flags.file) {
    const abs = path.resolve(flags.file as string)
    if (!fs.existsSync(abs)) fail(`파일 없음: ${abs}`)
    const r = await indexFile(vault, abs)
    process.stdout.write(
      `[llm-wiki] 증분 인덱싱 완료: ${path.relative(vault, abs)} (${r.chunks} chunks)${r.degraded ? " [degraded: BM25-only]" : ""}\n`,
    )
    return
  }
  const force = flags.force === true
  process.stdout.write(`[llm-wiki] ${force ? "전체 재" : ""}인덱싱 시작: ${vault}\n`)
  const t0 = Date.now()
  const r = await buildIndex(vault, { force })
  const sec = ((Date.now() - t0) / 1000).toFixed(1)
  if (r.unchanged) {
    process.stdout.write(`[llm-wiki] 변경 없음: ${r.pages} pages (${sec}s)\n`)
    return
  }
  const delta =
    r.changed !== undefined ? ` (증분: 변경 ${r.changed}, 삭제 ${r.removed ?? 0})` : ""
  process.stdout.write(
    `[llm-wiki] 완료: ${r.pages} pages, ${r.chunks} chunks${delta}, ${sec}s${r.degraded ? " [degraded: 모델 미준비 → BM25-only]" : " [hybrid]"}\n`,
  )
}

async function cmdSearch(flags: Flags): Promise<void> {
  const vault = resolveVault(flags)
  const query = (flags._ as string[]).slice(1).join(" ").trim()
  if (!query) fail("검색어가 비었습니다.")

  const filter = parseFilter(flags.filter as string)
  const mode = ((flags.mode as string) || "hybrid") as SearchMode
  const level = Math.min(4, Math.max(1, parseInt((flags.level as string) || "3", 10))) as 1 | 2 | 3 | 4
  const halfLife = parseHalfLife(flags["half-life"] as string)
  const opts: SearchOptions = {
    mode,
    filterType: filter.type,
    filterTags: filter.tags,
    rerank: flags.rerank === true,
    exact: flags.exact === true,
    boostLinks: flags["boost-links"] === true,
    decay: flags.decay === true,
    halfLifeDays: halfLife,
    limit: flags.n ? parseInt(flags.n as string, 10) : 10,
    level,
  }

  const out = await searchVault(vault, query, opts)

  if (flags.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n")
    return
  }
  // 인간용 요약
  process.stdout.write(`\n검색: "${out.query}"  [${out.mode}${out.degraded ? ", degraded" : ""}]\n`)
  if (!out.results.length) {
    process.stdout.write("결과 없음.\n")
    return
  }
  out.results.forEach((r: any, i) => {
    process.stdout.write(`\n${i + 1}. ${r.title}  (${r.path})\n`)
    if (r.type) process.stdout.write(`   type=${r.type} tags=[${(r.tags ?? []).join(", ")}] score=${r.score}\n`)
    if (r.snippet) process.stdout.write(`   ${r.snippet}\n`)
  })
  process.stdout.write("\n")
}

async function cmdStatus(flags: Flags): Promise<void> {
  const vault = resolveVault(flags)
  const loaded = await loadIndex(vault)
  const modelCached = embeddingModelCached()
  const info = {
    vault,
    indexDir: indexDir(vault),
    indexed: !!loaded,
    pages: loaded ? Object.keys(loaded.manifest.pages).length : 0,
    degraded: loaded ? loaded.manifest.degraded : null,
    createdAt: loaded ? loaded.manifest.createdAt : null,
    embeddingModelCached: modelCached,
  }
  if (flags.json) {
    process.stdout.write(JSON.stringify(info, null, 2) + "\n")
    return
  }
  process.stdout.write(
    `[llm-wiki] status\n` +
      `  vault:        ${info.vault}\n` +
      `  index:        ${info.indexed ? `${info.pages} pages (${info.createdAt})` : "없음 — 'llm-wiki index' 필요"}\n` +
      `  mode:         ${info.degraded === null ? "-" : info.degraded ? "BM25-only (degraded)" : "hybrid"}\n` +
      `  embed model:  ${info.embeddingModelCached ? "캐시됨" : "미다운로드 (첫 index 시 ~1GB 다운로드)"}\n`,
  )
}

async function cmdLinks(flags: Flags): Promise<void> {
  const vault = resolveVault(flags)
  const target = (flags._ as string[])[1]
  if (!target) fail("대상 파일 필요: llm-wiki links <file>")
  const loaded = await loadIndex(vault)
  if (!loaded) fail("인덱스 없음 — 먼저 index 실행")
  const slug = path.basename(target!, ".md")
  const docs = getAllDocs(loaded!.db)
  const self = docs.find((d) => path.basename(d.path, ".md") === slug)
  const outbound = self ? [...new Set(self.links ?? [])] : []
  const inbound = [
    ...new Set(
      docs.filter((d) => (d.links ?? []).some((l) => l.split("|")[0].trim().replace(/\.md$/, "") === slug)).map((d) => d.path),
    ),
  ]
  const out = { file: self?.path ?? target, slug, outbound, inbound }
  process.stdout.write(JSON.stringify(out, null, 2) + "\n")
}

async function cmdOrphans(flags: Flags): Promise<void> {
  const vault = resolveVault(flags)
  const loaded = await loadIndex(vault)
  if (!loaded) fail("인덱스 없음 — 먼저 index 실행")
  const orphans = lintOrphans(loaded!.db)
  if (flags.json) {
    process.stdout.write(JSON.stringify({ count: orphans.length, orphans }, null, 2) + "\n")
    return
  }
  process.stdout.write(`[llm-wiki] orphans (인바운드 링크 0): ${orphans.length}건\n`)
  orphans.forEach((p) => process.stdout.write(`  ${p}\n`))
}

async function cmdDoctor(flags: Flags): Promise<void> {
  const vault = resolveVault(flags)
  const loaded = await loadIndex(vault)
  if (!loaded) fail("인덱스 없음 — 먼저 index 실행")
  const report = lintDoctor(vault, loaded!.db, loaded!.manifest)
  const dups = lintTitleDuplicates(loaded!.db)
  const out = { ...report, titleDuplicates: dups }
  if (flags.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n")
    return
  }
  process.stdout.write(
    `[llm-wiki] doctor\n` +
      `  깨진 wikilink: ${report.brokenLinks.length}건\n` +
      `  stale(수정/삭제): ${report.stale.length}건\n` +
      `  제목 near-dup: ${dups.length}쌍\n`,
  )
  report.brokenLinks.slice(0, 20).forEach((b) => process.stdout.write(`  [broken] ${b.path} → [[${b.target}]]\n`))
  report.stale.slice(0, 20).forEach((s) => process.stdout.write(`  [stale:${s.reason}] ${s.path}\n`))
  dups.slice(0, 20).forEach((d) => process.stdout.write(`  [dup ${d.similarity}] ${d.a} ≈ ${d.b}\n`))
}

async function cmdWatch(flags: Flags): Promise<void> {
  const vault = resolveVault(flags)
  process.stdout.write(`[llm-wiki] watch 시작: ${vault} (Ctrl-C 종료)\n`)
  // 최초 1회 증분 동기화
  await buildIndex(vault).catch((e) => process.stderr.write(`[llm-wiki] 초기 동기화 실패: ${e}\n`))

  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(async () => {
      if (running) return schedule()
      running = true
      try {
        const r = await buildIndex(vault)
        if (!r.unchanged) {
          process.stdout.write(
            `[llm-wiki] 재동기화: ${r.pages} pages${r.changed !== undefined ? ` (변경 ${r.changed}, 삭제 ${r.removed ?? 0})` : ""}\n`,
          )
        }
      } catch (e) {
        process.stderr.write(`[llm-wiki] 재동기화 실패: ${e}\n`)
      } finally {
        running = false
      }
    }, 800) // debounce
  }

  fs.watch(vault, { recursive: true }, (_event, filename) => {
    if (!filename) return
    const rel = filename.toString()
    if (!rel.endsWith(".md")) return
    const top = rel.split(path.sep)[0]
    if (["raw", ".obsidian", ".llm-wiki", "assets", "_archive"].includes(top)) return
    schedule()
  })

  // 프로세스 유지
  await new Promise(() => {})
}

// --- Section: main ---

const HELP = `llm-wiki — LLM Wiki 볼트 검색 CLI

Usage:
  llm-wiki index   [--vault <p>] [--file <f>] [--force]
                   기본은 sha256 증분(변경분만 재임베딩). --force는 전체 재빌드.
  llm-wiki search  <query> [--mode hybrid|semantic|lexical] [--filter type=..,tags=..]
                   [--exact] [--rerank] [--boost-links] [--decay [--half-life 90d]]
                   [-n N] [--level 1-4] [--json]
                   초성 쿼리("ㅅㄹㅍㅈ")는 자동으로 초성 레인 사용.
  llm-wiki status  [--vault <p>] [--json]
  llm-wiki links   <file> [--vault <p>]      1-hop 이웃(outbound/inbound)
  llm-wiki orphans [--vault <p>] [--json]    인바운드 링크 0 페이지
  llm-wiki doctor  [--vault <p>] [--json]    깨진 링크·stale·제목중복
  llm-wiki watch   [--vault <p>]             볼트 변경 감지 자동 증분

볼트 경로: --vault 또는 WIKI_PATH / OBSIDIAN_VAULT_PATH 환경변수.`

async function main(): Promise<void> {
  const flags = parseArgs(Bun.argv.slice(2))
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help) {
    process.stdout.write(HELP + "\n")
    return
  }
  switch (cmd) {
    case "index":
      return cmdIndex(flags)
    case "search":
      return cmdSearch(flags)
    case "status":
      return cmdStatus(flags)
    case "links":
      return cmdLinks(flags)
    case "orphans":
      return cmdOrphans(flags)
    case "doctor":
      return cmdDoctor(flags)
    case "watch":
      return cmdWatch(flags)
    default:
      fail(`알 수 없는 커맨드: ${cmd}\n\n${HELP}`)
  }
}

main().catch((err) => {
  process.stderr.write(`[llm-wiki] 오류: ${err?.stack || err?.message || err}\n`)
  process.exit(1)
})
