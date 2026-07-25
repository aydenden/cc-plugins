/**
 * cc-plugins-llm-wiki — OpenCode Plugin
 *
 * Claude Code 플러그인의 마크다운 파일(commands/agents/skills)을 읽어
 * OpenCode config 훅으로 주입한다. CC 파일은 전혀 수정하지 않는다.
 *
 * 설치: opencode.json에 "plugin": ["cc-plugins-llm-wiki"] 추가
 */

import type { Plugin } from "@opencode-ai/plugin"
import path from "path"

// --- Section: Frontmatter Parser ---

interface ParsedMarkdown {
  data: Record<string, string>
  body: string
}

function parseFrontmatter(content: string): ParsedMarkdown {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return { data: {}, body: content.trim() }

  const [, yaml, body] = match
  const data: Record<string, string> = {}

  for (const line of yaml.split("\n")) {
    const idx = line.indexOf(":")
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (key) data[key] = value
  }

  return { data, body: body.trim() }
}

// --- Section: CC → OC Converter ---

const CC_TO_OC_TOOL_MAP: Record<string, string> = {
  Glob: "glob",
  Grep: "grep",
  Read: "read",
  Write: "edit",
  Edit: "edit",
  Bash: "bash",
  WebSearch: "websearch",
  WebFetch: "webfetch",
  Skill: "skill",
  Task: "task",
}

function ccToolsToPermissions(tools: string): Record<string, string> {
  const perms: Record<string, string> = {}
  for (const raw of tools.split(",")) {
    const tool = raw.trim()
    const ocKey = CC_TO_OC_TOOL_MAP[tool]
    if (ocKey) perms[ocKey] = "allow"
  }
  if (Object.keys(perms).length === 0) return { edit: "allow", bash: "allow", read: "allow" }
  return perms
}

const DEFAULT_AGENT_MODEL = "opencode-go/deepseek-v4-pro"

const COMMAND_AGENT_MAP: Record<string, string> = {
  research: "research-agent",
}

// --- Section: Markdown File Loader ---

interface LoadedMarkdown {
  name: string
  data: Record<string, string>
  body: string
}

async function loadMarkdownDir(dir: string): Promise<LoadedMarkdown[]> {
  const results: LoadedMarkdown[] = []
  const glob = new Bun.Glob("**/*.md")

  try {
    for await (const file of glob.scan({ cwd: dir, absolute: true })) {
      const content = await Bun.file(file).text()
      const { data, body } = parseFrontmatter(content)
      const relative = path.relative(dir, file)
      const name = relative.replace(/\.md$/, "").replace(/\//g, "-")
      results.push({ name, data, body })
    }
  } catch {
    // 디렉토리가 없거나 읽을 수 없음 — 스킵
  }

  return results
}

// --- Section: Plugin Entry Point ---

export const ObsidianKnowledgePlugin: Plugin = async () => {
  const pluginRoot = path.join(import.meta.dir, "..")

  return {
    async config(config) {
      // --- Commands ---
      const commands = await loadMarkdownDir(path.join(pluginRoot, "commands"))
      config.command = config.command ?? {}
      for (const cmd of commands) {
        config.command[cmd.name] = {
          template: cmd.body,
          description: cmd.data.description,
          agent: COMMAND_AGENT_MAP[cmd.name],
        }
      }

      // --- Agents ---
      const agents = await loadMarkdownDir(path.join(pluginRoot, "agents"))
      config.agent = config.agent ?? {}
      for (const ag of agents) {
        config.agent[ag.name] = {
          description: ag.data.description,
          mode: "subagent",
          model: DEFAULT_AGENT_MODEL,
          prompt: ag.body,
          permission: ag.data.tools
            ? ccToolsToPermissions(ag.data.tools)
            : { edit: "allow", bash: "allow", read: "allow" },
        }
      }

      // --- Skills ---
      config.skills = config.skills ?? {}
      config.skills.paths = [...(config.skills.paths ?? []), path.join(pluginRoot, "skills")]
    },
  }
}

export default ObsidianKnowledgePlugin
