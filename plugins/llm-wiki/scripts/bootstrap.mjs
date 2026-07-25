#!/usr/bin/env node
/**
 * bootstrap.mjs — llm-wiki 준비 흐름 (설계 8절).
 *
 * 우리가 컴파일·크로스컴파일·서명하는 바이너리는 없다. 준비는 두 단계:
 *   1) 의존성: `bun install` → @orama/orama · lindera-wasm(WASM) ·
 *      @huggingface/transformers (+ onnxruntime-node가 플랫폼별 프리빌트 .node 자동)
 *   2) 모델: 첫 `llm-wiki index` 시 Transformers.js가 bge-m3/reranker ONNX(~1GB)
 *      를 HF에서 자동 다운로드/캐시.
 *
 * 이 스크립트는 1)을 보장하고, 2)의 상태를 점검/안내한다. node 또는 bun으로 실행.
 *
 * Usage:
 *   node scripts/bootstrap.mjs            # Bun·의존성 점검 + 준비
 *   node scripts/bootstrap.mjs --status   # 준비 상태만 출력(설치 안 함)
 */

import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const STATUS_ONLY = process.argv.includes("--status")

function log(msg) {
  process.stdout.write(`[bootstrap] ${msg}\n`)
}

function hasBun() {
  const r = spawnSync("bun", ["--version"], { encoding: "utf-8" })
  return r.status === 0 ? r.stdout.trim() : null
}

function main() {
  // 1) Bun 런타임
  const bunVersion = hasBun()
  if (!bunVersion) {
    log("Bun 런타임 없음. 단일 바이너리(MSVC 불필요)로 설치하세요:")
    log("  macOS/Linux:  curl -fsSL https://bun.sh/install | bash")
    log("  Windows:      powershell -c \"irm bun.sh/install.ps1 | iex\"")
    log("  또는:         npm i -g bun")
    process.exit(STATUS_ONLY ? 0 : 1)
  }
  log(`Bun ${bunVersion} ✓`)

  // 2) 의존성(node_modules)
  const hasDeps =
    existsSync(path.join(PLUGIN_ROOT, "node_modules", "@orama", "orama")) &&
    existsSync(path.join(PLUGIN_ROOT, "node_modules", "lindera-wasm-nodejs-ko-dic")) &&
    existsSync(path.join(PLUGIN_ROOT, "node_modules", "@huggingface", "transformers"))

  if (!hasDeps) {
    if (STATUS_ONLY) {
      log("의존성 미설치 — `bun install` 필요")
    } else {
      log("의존성 설치: bun install (onnxruntime-node 플랫폼별 프리빌트 자동)")
      const r = spawnSync("bun", ["install"], { cwd: PLUGIN_ROOT, stdio: "inherit" })
      if (r.status !== 0) {
        log("bun install 실패")
        process.exit(1)
      }
    }
  } else {
    log("의존성(node_modules) ✓")
  }

  // 3) 모델 상태 점검 (다운로드는 첫 index 시 자동)
  const r = spawnSync("bun", ["run", path.join(PLUGIN_ROOT, "src", "cli.ts"), "status", "--json"], {
    cwd: PLUGIN_ROOT,
    encoding: "utf-8",
    env: { ...process.env },
  })
  let modelCached = false
  try {
    modelCached = JSON.parse(r.stdout || "{}").embeddingModelCached === true
  } catch {
    // status는 볼트 경로가 있어야 하므로 실패할 수 있음 — 무시
  }
  log(
    modelCached
      ? "임베딩 모델 캐시됨 ✓ (hybrid 검색 가능)"
      : "임베딩 모델 미다운로드 — 첫 `llm-wiki index` 시 ~1GB 자동 다운로드(그 전까지 BM25-only)",
  )

  log("준비 완료. 다음: WIKI_PATH 설정 후 `bun run src/cli.ts index`")
}

main()
