#!/usr/bin/env bun
// --- Build Script ---
// Usage: bun run scripts/build.ts
// 모든 엔트리포인트를 Node.js 호환 JS로 번들링

import { join, relative, dirname } from "path";
import { readdirSync, statSync, mkdirSync, existsSync, rmSync } from "fs";

const SCRIPTS_DIR = dirname(new URL(import.meta.url).pathname);
const PLUGIN_ROOT = join(SCRIPTS_DIR, "..");
const OUT_DIR = join(PLUGIN_ROOT, "dist");

// dist/ 초기화
if (existsSync(OUT_DIR)) {
  rmSync(OUT_DIR, { recursive: true });
}

// 엔트리포인트 수집 (common/ 제외, build.ts 자신 제외)
function collectEntrypoints(dir: string): string[] {
  const entries: string[] = [];
  for (const item of readdirSync(dir)) {
    const full = join(dir, item);
    if (statSync(full).isDirectory()) {
      if (item === "common") continue;
      entries.push(...collectEntrypoints(full));
    } else if (item.endsWith(".ts") && item !== "build.ts") {
      entries.push(full);
    }
  }
  return entries;
}

const entrypoints = collectEntrypoints(SCRIPTS_DIR);
console.error(`[build] Found ${entrypoints.length} entrypoints`);

// 각 엔트리포인트 빌드
for (const entry of entrypoints) {
  const rel = relative(SCRIPTS_DIR, entry).replace(/\.ts$/, ".js");
  const outPath = join(OUT_DIR, rel);
  const outDir = dirname(outPath);

  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  const result = await Bun.build({
    entrypoints: [entry],
    outdir: outDir,
    target: "node",
    format: "esm",
  });

  if (!result.success) {
    console.error(`[build] FAIL: ${rel}`);
    for (const log of result.logs) {
      console.error(`  ${log}`);
    }
    process.exit(1);
  }

  // 파일명 맞추기 (Bun.build는 소스 파일명 기준으로 출력)
  console.error(`[build] OK: ${rel}`);
}

console.error(`[build] Done — ${entrypoints.length} files → ${OUT_DIR}`);
