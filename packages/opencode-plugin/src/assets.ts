import path from "node:path";

export interface AssetFile {
  plugin: string;
  name: string;
  path: string;
}

export function assetsRoot(): string {
  return path.resolve(import.meta.dir, "..", "assets", "plugins");
}

export async function listAssetFiles(kind: "commands" | "agents" | "skills"): Promise<AssetFile[]> {
  const root = assetsRoot();
  const pattern = kind === "skills" ? "*/skills/*/SKILL.md" : `*/${kind}/*.md`;
  const glob = new Bun.Glob(pattern);
  const files: AssetFile[] = [];

  for await (const file of glob.scan({ cwd: root, absolute: true })) {
    const relative = path.relative(root, file);
    const parts = relative.split(path.sep);
    const plugin = parts[0];
    const name = kind === "skills" ? parts[2] : path.basename(file, ".md");
    files.push({ plugin, name, path: file });
  }

  return files.sort((left, right) => `${left.plugin}/${left.name}`.localeCompare(`${right.plugin}/${right.name}`));
}

export function prefixedName(plugin: string, name: string): string {
  return `${plugin}-${name}`.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
}
