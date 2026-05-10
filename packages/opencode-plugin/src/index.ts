import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { loadAgents } from "./agents";
import { loadCommands } from "./commands";
import { createHooks } from "./hooks";
import { installSkills, type SkillInstallTarget } from "./skills";

type MutableConfig = {
  command?: Record<string, unknown>;
  agent?: Record<string, unknown>;
};

export const AydendenPlugins: Plugin = async (ctx) => {
  const commands = await loadCommands();
  const agents = await loadAgents();

  const installSkillsTool = tool({
    description: "Install bundled aydenden cc-plugins skills into .opencode/skills or ~/.config/opencode/skills",
    args: {
      target: tool.schema.enum(["project", "global"]).describe("Install into the current project or global OpenCode config"),
    },
    async execute(args) {
      const result = await installSkills(args.target as SkillInstallTarget, ctx.worktree ?? ctx.directory);
      return `Installed ${result.installed.length} skill(s) to ${result.directory}: ${result.installed.join(", ")}`;
    },
  });

  return {
    tool: {
      cc_plugins_install_skills: installSkillsTool,
    },
    async config(config: MutableConfig) {
      config.command = { ...(config.command ?? {}), ...commands };
      config.agent = { ...(config.agent ?? {}), ...agents };
    },
    ...createHooks(ctx),
  };
};

export const server = AydendenPlugins;

export default AydendenPlugins;
