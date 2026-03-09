// --- Cache Path Management ---
// All cache files stored under ~/.cache/claude-plugins/korean-trading/

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CACHE_ROOT = join(homedir(), ".cache", "claude-plugins", "korean-trading");

export function getCacheDir(...segments: string[]): string {
  const dir = join(CACHE_ROOT, ...segments);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getCachePath(...segments: string[]): string {
  const parts = [...segments];
  const file = parts.pop()!;
  const dir = getCacheDir(...parts);
  return join(dir, file);
}

export interface CacheEntry<T> {
  data: T;
  cached_at: string;
  expires_at?: string;
}

export function readCache<T>(path: string): CacheEntry<T> | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (entry.expires_at && new Date(entry.expires_at) < new Date()) {
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export function writeCache<T>(
  path: string,
  data: T,
  ttlMs?: number,
): void {
  const entry: CacheEntry<T> = {
    data,
    cached_at: new Date().toISOString(),
  };
  if (ttlMs) {
    entry.expires_at = new Date(Date.now() + ttlMs).toISOString();
  }
  writeFileSync(path, JSON.stringify(entry, null, 2), "utf-8");
}

// --- mkdir-based Lock ---

export async function withLock<T>(
  lockName: string,
  fn: () => Promise<T>,
  staleSec = 60,
): Promise<T> {
  const lockDir = join(CACHE_ROOT, `${lockName}.lock`);
  const maxWait = staleSec * 1000;
  const start = Date.now();

  while (true) {
    try {
      mkdirSync(lockDir);
      break;
    } catch {
      if (Date.now() - start > maxWait) {
        // Stale lock — force remove
        try {
          const { rmdirSync } = await import("fs");
          rmdirSync(lockDir);
        } catch { /* ignore */ }
        mkdirSync(lockDir);
        break;
      }
      await Bun.sleep(200);
    }
  }

  try {
    return await fn();
  } finally {
    try {
      const { rmdirSync } = await import("fs");
      rmdirSync(lockDir);
    } catch { /* ignore */ }
  }
}
