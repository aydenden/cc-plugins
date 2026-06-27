/**
 * memory-guard — OpenCode Plugin
 *
 * opencode-claude-memory의 memory_save 도구가 MEMORY.md 인덱스를
 * 한도 초과로 키우는 것을 차단하고, 하루 1회 stale·깨진 링크 점검을 수행한다.
 * CC의 index-guard.sh / memory-check.sh와 동일한 한도·로직을 TypeScript로 포팅.
 *
 * CC 플러그인 파일(hooks/scripts/*.sh)은 CC 호환성을 위해 그대로 유지된다.
 * 이 파일은 OpenCode 전용 엔트리 포인트다.
 *
 * 설치: opencode.json에 "plugin": ["@aydenden/plugin-memory-guard"] 추가
 */

import type { Plugin } from "@opencode-ai/plugin"
import path from "path"
import { homedir } from "os"
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
} from "fs"

// --- Section: Limits (CC index-guard.sh와 동일) ---

const MAX_BYTES = 24000
const MAX_LINES = 190
const ITEM_MAX_CHARS = 250
const STALE_DAYS = 90

// --- Section: Memory Path (CC 호환) ---
// CC는 worktree → canonical git root → sanitize(/ → -) → ~/.claude/projects/<sanitized>/memory/
// opencode-claude-memory의 src/paths.ts 로직과 동일하게 동작해야 같은 경로를 가리킨다.

function sanitizePath(p: string): string {
  return p.replace(/\//g, "-")
}

async function findCanonicalGitRoot(
  worktree: string,
  $: unknown,
): Promise<string> {
  try {
    // BunShell template literal — git common dir은 worktree의 원본 repo .git을 가리킨다
    const shell = $ as { [key: string]: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<{ text(): string }> }
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
  const claudeConfigDir =
    process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude")
  const sanitized = sanitizePath(gitRoot)
  return path.join(claudeConfigDir, "projects", sanitized, "memory")
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

function guardMemorySave(memoryDir: string, args: MemorySaveArgs): void {
  const indexFile = path.join(memoryDir, "MEMORY.md")
  if (!existsSync(indexFile)) return

  const rawFileName = args.file_name ?? ""
  const fileName = rawFileName.endsWith(".md") ? rawFileName : `${rawFileName}.md`
  const name = args.name ?? ""
  const description = args.description ?? ""

  const newEntry = `- [${name}](${fileName}) — ${description}`

  const oldContent = readFileSync(indexFile, "utf-8")
  const oldLines = oldContent.split("\n").filter((l) => l.trim())

  const existingIdx = oldLines.findIndex((l) => l.includes(`(${fileName})`))

  let newLines: string[]
  if (existingIdx >= 0) {
    newLines = [...oldLines]
    newLines[existingIdx] = newEntry
  } else {
    newLines = [...oldLines, newEntry]
  }

  const newContent = newLines.join("\n") + "\n"
  const newBytes = Buffer.byteLength(newContent, "utf-8")
  const newLineCount = newLines.length
  const oldBytes = Buffer.byteLength(oldContent, "utf-8")

  if (newBytes <= oldBytes) return

  const reasons: string[] = []
  if (newBytes > MAX_BYTES) {
    reasons.push(`size ${newBytes}B > ${MAX_BYTES}B`)
  }
  if (newLineCount > MAX_LINES) {
    reasons.push(`lines ${newLineCount} > ${MAX_LINES}`)
  }

  const entryChars = [...newEntry].length
  if (entryChars > ITEM_MAX_CHARS) {
    reasons.push(
      `an added entry is ${entryChars} chars > ${ITEM_MAX_CHARS} (detail belongs in a topic file)`,
    )
  }

  if (reasons.length === 0) return

  const entries = oldLines
    .filter((l) => /^-\s/.test(l))
    .map((l) => ({ chars: [...l].length, line: l }))
    .sort((a, b) => b.chars - a.chars)
    .slice(0, 5)

  let msg = `BLOCKED: memory_save would bloat the auto-memory index (${reasons.join(", ")}).\n`
  msg += `  current: ${oldBytes}B / ${oldLines.length} lines  ->  after: ${newBytes}B / ${newLineCount} lines\n`
  msg += `  limits : ${MAX_BYTES}B / ${MAX_LINES} lines / ${ITEM_MAX_CHARS} chars per entry\n`
  msg += `Fix: move detail (commit hashes, metrics, "next=...") into a topic .md file body,\n`
  msg += `     keep only a one-line summary + link in the index. Shrinking/cleanup edits are never blocked.`
  if (entries.length > 0) {
    msg += `\nLongest current index entries (move these to topic files first):`
    for (const e of entries) {
      msg += `\n    ${e.chars} chars: ${e.line}`
    }
  }

  throw new Error(msg)
}

// --- Section: Stale Check (하루 1회) ---
// CC의 memory-check.sh 로직을 TypeScript로 포팅.
// 검출: 깨진 내부 링크, 인덱스 초과, 노후(본문 최신 날짜 90일 경과).

function toEpoch(dateStr: string): number {
  const d = new Date(dateStr)
  const epoch = Math.floor(d.getTime() / 1000)
  return isNaN(epoch) ? 0 : epoch
}

function runStaleCheck(memoryDir: string): string | null {
  const indexFile = path.join(memoryDir, "MEMORY.md")
  if (!existsSync(indexFile)) return null

  const candidates: string[] = []
  const now = Math.floor(Date.now() / 1000)

  const allFiles = readdirSync(memoryDir).filter((f) => f.endsWith(".md"))

  const nameSlugs = new Set<string>()
  for (const f of allFiles) {
    const content = readFileSync(path.join(memoryDir, f), "utf-8")
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (fmMatch) {
      const nameMatch = fmMatch[1].match(/^name:\s*(\S+)/m)
      if (nameMatch) nameSlugs.add(nameMatch[1])
    }
  }

  const idxContent = readFileSync(indexFile, "utf-8")
  const idxBytes = Buffer.byteLength(idxContent, "utf-8")
  const idxLines = idxContent.split("\n").filter((l) => l.trim()).length
  if (idxBytes > MAX_BYTES || idxLines > MAX_LINES) {
    candidates.push(
      `index-oversized: MEMORY.md ${idxBytes}B / ${idxLines} lines (limit ${MAX_BYTES}B / ${MAX_LINES})`,
    )
  }

  for (const f of allFiles) {
    const content = readFileSync(path.join(memoryDir, f), "utf-8")

    const linkMatches = content.matchAll(/\]\(([^)]*\.md)\)/g)
    for (const m of linkMatches) {
      const target = m[1]
      if (target.startsWith("http") || target.startsWith("/")) continue
      if (!existsSync(path.join(memoryDir, target))) {
        candidates.push(`broken-link: ${f} -> ${target}`)
      }
    }

    const wikiMatches = content.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)
    for (const m of wikiMatches) {
      const name = m[1]
      if (
        !existsSync(path.join(memoryDir, `${name}.md`)) &&
        !existsSync(path.join(memoryDir, name)) &&
        !nameSlugs.has(name)
      ) {
        candidates.push(`broken-wikilink: ${f} -> [[${name}]]`)
      }
    }

    const dateMatches = [...content.matchAll(/(\d{4}-\d{2}-\d{2})/g)]
    const dates = dateMatches.map((m) => m[1]).sort()
    if (dates.length > 0) {
      const latest = dates[dates.length - 1]
      const le = toEpoch(latest)
      if (le > 0) {
        const days = Math.floor((now - le) / 86400)
        if (days > STALE_DAYS) {
          candidates.push(`stale-date: ${f} (latest ${latest}, ${days}d ago)`)
        }
      }
    }
  }

  if (candidates.length === 0) return null

  let msg = `[memory-guard] Daily memory check found items needing attention in ${memoryDir}:\n`
  for (const c of candidates) {
    msg += `  ${c}\n`
  }
  msg += `Action (do NOT auto-delete):\n`
  msg += `  - index-oversized      : move detail into topic files, keep index lines lean\n`
  msg += `  - broken-link/wikilink : fix the link, or remove the dead reference\n`
  msg += `  - stale-date           : verify the underlying source; keep / update / archive\n`
  msg += `  Archive to ${memoryDir}/archive/ (or mark) and confirm with the user.\n`
  msg += `  Verify any code-link/source claims yourself before acting.`

  return msg
}

// --- Section: Daily Lock ---
// CC의 memory-check.sh와 동일한 mkdir 기반 원자적 락.
// 같은 날 여러 세션이 동시에 떠도 정확히 하나만 점검을 실행한다.

function acquireDailyLock(memoryDir: string): boolean {
  const dataDir =
    process.env.CLAUDE_PLUGIN_DATA ??
    path.join(homedir(), ".claude", "memory-guard")
  mkdirSync(dataDir, { recursive: true })

  const today = new Date().toISOString().slice(0, 10)
  const projEnc = path.basename(path.dirname(memoryDir))
  const lockDir = path.join(dataDir, `done-${projEnc}-${today}`)

  try {
    mkdirSync(lockDir)
    return true
  } catch {
    return false
  }
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

      const report = runStaleCheck(memoryDir)
      if (report && Array.isArray(output.system)) {
        output.system.push(report)
      }
    },
  }
}

export default MemoryGuardPlugin