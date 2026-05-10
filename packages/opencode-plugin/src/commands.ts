import { parseMarkdown, stringValue, booleanValue } from "./frontmatter";
import { listAssetFiles, prefixedName } from "./assets";

interface CommandConfig {
  template: string;
  description?: string;
  agent?: string;
  model?: string;
  subtask?: boolean;
}

export async function loadCommands(): Promise<Record<string, CommandConfig>> {
  const commands: Record<string, CommandConfig> = {};

  for (const file of await listAssetFiles("commands")) {
    const content = await Bun.file(file.path).text();
    const parsed = parseMarkdown(content);
    const name = prefixedName(file.plugin, file.name);

    commands[name] = {
      template: parsed.body,
      description: stringValue(parsed.frontmatter.description),
      agent: stringValue(parsed.frontmatter.agent),
      model: stringValue(parsed.frontmatter.model),
      subtask: booleanValue(parsed.frontmatter.subtask),
    };
  }

  commands["cc-plugins-install-skills"] = {
    description: "Install bundled cc-plugins skills into an OpenCode skill directory",
    template: `Install bundled cc-plugins skills for OpenCode.\n\nUse the cc_plugins_install_skills tool. If the first argument is \"global\", install globally. Otherwise install into this project.\n\nArguments: $ARGUMENTS`,
  };

  return commands;
}
