import { cp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listAssetFiles } from "./assets";

export type SkillInstallTarget = "project" | "global";

export interface SkillInstallResult {
  target: SkillInstallTarget;
  directory: string;
  installed: string[];
}

export async function installSkills(target: SkillInstallTarget, worktree: string): Promise<SkillInstallResult> {
  const directory = target === "global"
    ? path.join(os.homedir(), ".config", "opencode", "skills")
    : path.join(worktree, ".opencode", "skills");

  await mkdir(directory, { recursive: true });

  const installed: string[] = [];
  for (const skill of await listAssetFiles("skills")) {
    const sourceDirectory = path.dirname(skill.path);
    const targetDirectory = path.join(directory, skill.name);
    await cp(sourceDirectory, targetDirectory, { recursive: true, force: true });
    installed.push(skill.name);
  }

  return { target, directory, installed };
}
