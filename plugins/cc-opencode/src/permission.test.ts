/**
 * permission.test.ts — unit spec for the scoped permission policy.
 * Run with: bun test
 */
import { test, expect } from "bun:test";
import {
  readPolicy,
  allowedRoots,
  toolCallPaths,
  isUnder,
  decidePermission,
} from "./permission.js";

// ── readPolicy ────────────────────────────────────────────────────────────────
test("readPolicy defaults to scoped", () => {
  expect(readPolicy({})).toBe("scoped");
  expect(readPolicy({ CC_OC_PERMISSION: "nonsense" })).toBe("scoped");
});
test("readPolicy honours allow-all / deny-all", () => {
  expect(readPolicy({ CC_OC_PERMISSION: "allow-all" })).toBe("allow-all");
  expect(readPolicy({ CC_OC_PERMISSION: "deny-all" })).toBe("deny-all");
});

// ── allowedRoots ──────────────────────────────────────────────────────────────
test("allowedRoots includes dir + sessionDir, resolved", () => {
  const roots = allowedRoots("/work/proj", "/work/proj/.claude/oc/s1", {});
  expect(roots).toContain("/work/proj");
  expect(roots).toContain("/work/proj/.claude/oc/s1");
});
test("allowedRoots splits CC_OC_ALLOW_WRITE on colon and trims", () => {
  const roots = allowedRoots("/d", "/s", { CC_OC_ALLOW_WRITE: "/tmp/out : /var/x" });
  expect(roots).toContain("/tmp/out");
  expect(roots).toContain("/var/x");
});

// ── isUnder ───────────────────────────────────────────────────────────────────
test("isUnder: same dir, child, and prefix-sibling boundary", () => {
  expect(isUnder("/a/b", "/a/b")).toBe(true);
  expect(isUnder("/a/b/c.md", "/a/b")).toBe(true);
  expect(isUnder("/a/bcd", "/a/b")).toBe(false); // not a real subpath
  expect(isUnder("/a", "/a/b")).toBe(false);
  expect(isUnder("/a/b/../../etc/passwd", "/a/b")).toBe(false); // traversal normalised
});

// ── toolCallPaths ─────────────────────────────────────────────────────────────
test("toolCallPaths reads locations and rawInput", () => {
  expect(toolCallPaths({ locations: [{ path: "/x/1" }, { path: "/x/2" }] }))
    .toEqual(["/x/1", "/x/2"]);
  expect(toolCallPaths({ rawInput: { filePath: "/y/a" } })).toEqual(["/y/a"]);
  expect(toolCallPaths({})).toEqual([]);
});

// ── decidePermission ──────────────────────────────────────────────────────────
const ROOTS = ["/work/proj", "/tmp/out"];

test("deny-all denies everything", () => {
  expect(decidePermission("deny-all", ROOTS, { locations: [{ path: "/work/proj/a" }] }).grant)
    .toBe(false);
});
test("allow-all grants everything (even bash/no-path)", () => {
  expect(decidePermission("allow-all", ROOTS, {}).grant).toBe(true);
});
test("scoped: grant when all paths under allowed roots", () => {
  const d = decidePermission("scoped", ROOTS, {
    locations: [{ path: "/work/proj/src/a.ts" }, { path: "/tmp/out/result.md" }],
  });
  expect(d.grant).toBe(true);
});
test("scoped: deny when any path is outside", () => {
  const d = decidePermission("scoped", ROOTS, {
    locations: [{ path: "/work/proj/a" }, { path: "/etc/passwd" }],
  });
  expect(d.grant).toBe(false);
  expect(d.why).toContain("/etc/passwd");
});
test("scoped: deny path-less requests (bash/network)", () => {
  expect(decidePermission("scoped", ROOTS, { title: "run tests" }).grant).toBe(false);
});
test("scoped: OUTPUT_FILE dir injected via allowedRoots is honoured", () => {
  const roots = allowedRoots("/work/proj", "/work/proj/.claude/s1", {
    CC_OC_ALLOW_WRITE: "/tmp/scratch",
  });
  const d = decidePermission("scoped", roots, {
    rawInput: { filePath: "/tmp/scratch/report.md" },
  });
  expect(d.grant).toBe(true);
});
