import { cp, rm } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.resolve(import.meta.dir, "..");
const workspaceRoot = path.resolve(packageRoot, "..", "..");
const sourceRoot = path.join(workspaceRoot, "plugins");
const assetRoot = path.join(packageRoot, "assets", "plugins");

const excluded = [
  ".cache",
  ".memsearch",
  ".env",
  ".DS_Store",
  "node_modules",
  "dist",
  "coverage",
];

await rm(path.join(packageRoot, "assets"), { recursive: true, force: true });

await cp(sourceRoot, assetRoot, {
  recursive: true,
  filter(source) {
    const base = path.basename(source);
    return !excluded.includes(base);
  },
});

console.log(`Synced plugin assets from ${sourceRoot} to ${assetRoot}`);
