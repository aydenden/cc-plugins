import { parseMarkdown, stringValue } from "./frontmatter";
import { listAssetFiles, prefixedName } from "./assets";

interface AgentConfig {
  description: string;
  mode: "subagent";
  prompt: string;
  model?: string;
  color?: string;
}

export async function loadAgents(): Promise<Record<string, AgentConfig>> {
  const agents: Record<string, AgentConfig> = {};

  for (const file of await listAssetFiles("agents")) {
    const content = await Bun.file(file.path).text();
    const parsed = parseMarkdown(content);
    const name = prefixedName(file.plugin, stringValue(parsed.frontmatter.name) ?? file.name);
    const description = stringValue(parsed.frontmatter.description) ?? `${file.plugin} ${file.name} agent`;

    agents[name] = {
      description,
      mode: "subagent",
      prompt: parsed.body,
      model: normalizeModel(stringValue(parsed.frontmatter.model)),
      color: normalizeColor(stringValue(parsed.frontmatter.color)),
    };
  }

  return agents;
}

function normalizeModel(model: string | undefined): string | undefined {
  if (!model || !model.includes("/")) {
    return undefined;
  }
  return model;
}

function normalizeColor(color: string | undefined): string | undefined {
  const allowed = new Set(["primary", "secondary", "accent", "success", "warning", "error", "info"]);
  return color && allowed.has(color) ? color : undefined;
}
