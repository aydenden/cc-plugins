/**
 * permission.ts — scoped permission policy for OpenCode delegation.
 *
 * The REST era (and v0.11.x) auto-denied every `session/request_permission` →
 * any tool that asked (e.g. writing an OUTPUT_FILE under /tmp, outside --dir)
 * aborted the turn with exit 20. Policy is now injectable by the calling session:
 *
 *   CC_OC_PERMISSION   scoped (default) | allow-all | deny-all
 *     scoped    → grant only when EVERY path the tool touches is under an allowed
 *                 root (--dir, SESSION_DIR, or a CC_OC_ALLOW_WRITE entry). Requests
 *                 with no path (bash/network) stay denied — open them with allow-all.
 *     allow-all → grant every request. Opt-in; the agent can touch anything in its
 *                 cwd. Use for trusted scratch dirs.
 *     deny-all  → legacy behaviour: deny every request (→ exit 20).
 *   CC_OC_ALLOW_WRITE  colon-separated extra roots to allow under `scoped`
 *                      (oc-delegate.sh injects the spec's OUTPUT_FILE dir here).
 *
 * The pure decision function `decidePermission` is unit-tested; the ACP client
 * wraps it with the SDK-specific option selection.
 */
import { resolve, sep } from "node:path";

export type PermPolicy = "scoped" | "allow-all" | "deny-all";

export function readPolicy(env: NodeJS.ProcessEnv = process.env): PermPolicy {
  const p = env.CC_OC_PERMISSION;
  return p === "allow-all" || p === "deny-all" ? p : "scoped";
}

/** Allowed roots (absolute), from --dir, SESSION_DIR and CC_OC_ALLOW_WRITE. */
export function allowedRoots(
  dir: string,
  sessionDir: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const extra = (env.CC_OC_ALLOW_WRITE ?? "")
    .split(":")
    .map((s) => s.trim())
    .filter(Boolean);
  return [dir, sessionDir, ...extra].map((p) => resolve(p));
}

/** Absolute paths a tool call would touch, from ACP locations + rawInput heuristics. */
export function toolCallPaths(toolCall: any): string[] {
  const out: string[] = [];
  for (const loc of toolCall?.locations ?? []) {
    if (typeof loc?.path === "string" && loc.path) out.push(loc.path);
  }
  const ri = toolCall?.rawInput;
  if (ri && typeof ri === "object") {
    for (const k of ["filePath", "path", "file", "filename", "target"]) {
      const v = (ri as Record<string, unknown>)[k];
      if (typeof v === "string" && v) out.push(v);
    }
  }
  return out;
}

/** True when `child` resolves to `root` or a path beneath it. */
export function isUnder(child: string, root: string): boolean {
  const c = resolve(child);
  const r = resolve(root);
  return c === r || c.startsWith(r.endsWith(sep) ? r : r + sep);
}

export interface PermDecision {
  grant: boolean;
  why: string;
}

/**
 * Decide whether to grant a permission request. Pure — no SDK/option coupling.
 * `roots` must already be absolute (via allowedRoots).
 */
export function decidePermission(
  policy: PermPolicy,
  roots: string[],
  toolCall: any,
): PermDecision {
  if (policy === "deny-all") return { grant: false, why: "deny-all policy" };
  if (policy === "allow-all") return { grant: true, why: "allow-all policy" };

  // scoped: allow only when every touched path is under an allowed root.
  const paths = toolCallPaths(toolCall);
  if (paths.length === 0) {
    return { grant: false, why: "scoped: no path (bash/network) — use allow-all" };
  }
  const outside = paths.filter((p) => !roots.some((r) => isUnder(p, r)));
  return outside.length === 0
    ? { grant: true, why: "scoped: all paths under allowed roots" }
    : { grant: false, why: `scoped: path outside allowed roots: ${outside.join(", ")}` };
}
