/**
 * memory-guard — OpenCode Plugin
 *
 * opencode-claude-memory 의 `memory_save` 도구가 MEMORY.md 인덱스를 한도 밖으로 키우는
 * 것을 막고, 하루 1회 stale·깨진 링크·고아 토픽 점검을 수행한다.
 *
 * 판정과 한도는 `core.mjs` 하나가 정본이다. CC 훅(`hooks/*.mjs`)과 같은 코어를 쓰므로
 * 두 런타임의 한도가 갈라질 수 없다. 여기가 하는 일은 OpenCode 쪽 입력(도구 인자,
 * worktree)을 코어가 아는 모양으로 옮기는 것뿐이다.
 *
 * 설치: opencode.json 의 "plugin" 에 이 저장소를 추가한다.
 */

import type { Plugin } from "@opencode-ai/plugin"
import path from "path"
import { homedir } from "os"
import { existsSync, readFileSync } from "fs"

import { INDEX_BASENAME, auditIndex, auditTopic, guardWrite, isExcluded, renderBlock, renderCheck } from "./core.mjs"
import { acquireDailyLock, collectSlugs, listTopicFiles, loadConfig, makeExists } from "./fs-adapter.mjs"

// --- Section: Memory Path (CC 호환) ---
// CC는 worktree → canonical git root → sanitize(/ → -) → ~/.claude/projects/<sanitized>/memory/
// opencode-claude-memory의 src/paths.ts 로직과 동일하게 동작해야 같은 경로를 가리킨다.

function sanitizePath(p: string): string {
  return p.replace(/\//g, "-")
}

async function findCanonicalGitRoot(worktree: string, $: unknown): Promise<string> {
  try {
    // BunShell template literal — git common dir은 worktree의 원본 repo .git을 가리킨다
    const shell = $ as {
      [key: string]: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<{ text(): string }>
    }
    const result = await shell`git -C ${worktree} rev-parse --git-common-dir`
    const gitCommonDir = result.text().trim()
    if (gitCommonDir) {
      // .git 디렉토리의 부모가 canonical git root
      return path.dirname(path.resolve(worktree, gitCommonDir))
    }
  } catch {
    // git이 아니면 worktree 그대로 사용
  }
  return worktree
}

function getMemoryDir(gitRoot: string): string {
  const claudeConfigDir = process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude")
  return path.join(claudeConfigDir, "projects", sanitizePath(gitRoot), "memory")
}

// --- Section: Index Guard (tool.execute.before) ---
// opencode-claude-memory의 updateIndex()가 추가/교체하는 항목:
//   - [${name}](${fileName}) — ${description}
// memory_save의 args: { file_name, name, description, type, content }

interface MemorySaveArgs {
  file_name: string
  name: string
  description: string
  type: string
  content: string
}

/** `memory_save` 가 만들어 낼 인덱스 본문을 재현한다. updateIndex() 와 같은 규칙이다. */
function projectIndex(oldContent: string, args: MemorySaveArgs): string {
  const rawFileName = args.file_name ?? ""
  const fileName = rawFileName.endsWith(".md") ? rawFileName : `${rawFileName}.md`
  const newEntry = `- [${args.name ?? ""}](${fileName}) — ${args.description ?? ""}`

  const oldLines = oldContent.split("\n").filter((l) => l.trim())
  const existingIdx = oldLines.findIndex((l) => l.includes(`(${fileName})`))

  const newLines = [...oldLines]
  if (existingIdx >= 0) newLines[existingIdx] = newEntry
  else newLines.push(newEntry)

  return `${newLines.join("\n")}\n`
}

function guardMemorySave(memoryDir: string, args: MemorySaveArgs): void {
  const indexFile = path.join(memoryDir, INDEX_BASENAME)
  if (!existsSync(indexFile)) return

  const oldContent = readFileSync(indexFile, "utf-8")
  const config = loadConfig(memoryDir)
  const files = listTopicFiles(memoryDir)

  const result = guardWrite(
    { tool: "Write", oldText: oldContent, content: projectIndex(oldContent, args) },
    {
      config,
      files,
      slugs: config.requireTopicFirst ? new Set<string>(collectSlugs(memoryDir, files).values()) : new Set<string>(),
      exists: makeExists(memoryDir),
    },
  )

  if (result.blocked) throw new Error(renderBlock(INDEX_BASENAME, result, oldContent))
}

// --- Section: Daily Check ---
// CC의 memory-check.mjs와 같은 판정. 아무것도 지우지 않고 보고만 한다.

function runCheck(memoryDir: string): string | null {
  const indexFile = path.join(memoryDir, INDEX_BASENAME)
  if (!existsSync(indexFile)) return null

  const config = loadConfig(memoryDir)
  const files = listTopicFiles(memoryDir)
  const slugByFile: Map<string, string> = collectSlugs(memoryDir, files)
  const slugs = new Set(slugByFile.values())
  const exists = makeExists(memoryDir)
  const now = Math.floor(Date.now() / 1000)

  const findings = auditIndex(readFileSync(indexFile, "utf-8"), {
    files,
    slugs,
    config,
    exists,
    slugOf: (name: string) => slugByFile.get(name),
  }).findings

  for (const name of files) {
    if (name === INDEX_BASENAME || isExcluded(name, config)) continue
    findings.push(...auditTopic(name, readFileSync(path.join(memoryDir, name), "utf-8"), { files, slugs, config, now, exists }))
  }

  if (findings.length === 0) return null

  // 긴 항목 지적을 통째로 쏟으면 그게 곧 컨텍스트 오염이다 — 한 줄로 접는다.
  const tooLong = findings.filter((f: { kind: string }) => f.kind === "entry-too-long")
  const rest = findings.filter((f: { kind: string }) => f.kind !== "entry-too-long")
  if (tooLong.length > 0) {
    rest.push({
      kind: "entry-too-long",
      message: `${tooLong.length}개 항목이 상한 초과 — 상세를 토픽 본문으로 내린다`,
    })
  }

  return renderCheck(memoryDir, rest)
}

// --- Section: Plugin Entry Point ---

export const MemoryGuardPlugin: Plugin = async ({ worktree, $ }) => {
  const gitRoot = await findCanonicalGitRoot(worktree, $)
  const memoryDir = getMemoryDir(gitRoot)

  return {
    "tool.execute.before": async (input: any, _output: any) => {
      if (input.tool !== "memory_save") return
      if (!existsSync(memoryDir)) return

      guardMemorySave(memoryDir, input.args as MemorySaveArgs)
    },

    "experimental.chat.system.transform": async (_input: any, output: any) => {
      if (!existsSync(memoryDir)) return
      if (!acquireDailyLock(memoryDir)) return

      const report = runCheck(memoryDir)
      if (report && Array.isArray(output.system)) {
        output.system.push(report)
      }
    },
  }
}

export default MemoryGuardPlugin
