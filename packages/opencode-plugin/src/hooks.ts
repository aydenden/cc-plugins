import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

interface ToolInput {
  tool?: string;
}

interface ToolOutput {
  args?: Record<string, unknown>;
}

type HookContext = Pick<PluginInput, "$" | "worktree" | "directory">;

export function createHooks(ctx: HookContext) {
  return {
    "tool.execute.before": async (input: ToolInput, _output: ToolOutput) => {
      if (!isEditTool(input.tool)) {
        return;
      }

      const worktree = ctx.worktree ?? ctx.directory ?? process.cwd();
      const protectedBranches = await readProtectedBranches(worktree);
      if (protectedBranches.length === 0) {
        return;
      }

      const branch = await currentBranch(ctx, worktree);
      if (branch && protectedBranches.includes(branch)) {
        throw new Error(
          `Code modification is not allowed on branch '${branch}'. Create a worktree before editing.`,
        );
      }
    },
  };
}

function isEditTool(tool: string | undefined): boolean {
  return tool === "write" || tool === "edit" || tool === "apply_patch";
}

async function readProtectedBranches(worktree: string): Promise<string[]> {
  const candidates = [
    path.join(worktree, ".opencode", "worktree-task.local.md"),
    path.join(worktree, ".claude", "worktree-task.local.md"),
  ];

  for (const candidate of candidates) {
    try {
      const content = await readFile(candidate, "utf8");
      return parseProtectedBranches(content);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  return [];
}

function parseProtectedBranches(content: string): string[] {
  const branches: string[] = [];
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "protected-branches:");
  if (start === -1) {
    return branches;
  }

  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^\s*-\s+(.+)$/);
    if (!match) {
      break;
    }
    branches.push(match[1].trim());
  }

  return branches;
}

async function currentBranch(ctx: HookContext, worktree: string): Promise<string | undefined> {
  if (!ctx.$) {
    return undefined;
  }

  try {
    return (await ctx.$`git -C ${worktree} rev-parse --abbrev-ref HEAD`.quiet().text()).trim();
  } catch {
    return undefined;
  }
}
