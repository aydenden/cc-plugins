/**
 * acp-client.ts — ACP (Agent Client Protocol) client for OpenCode delegation.
 *
 * Replaces the REST pipeline (daemon + session + sync-POST + SSE-watch) with a
 * single `opencode acp` subprocess over stdio JSON-RPC. Provides what REST could
 * not: streaming progress, a stall watchdog (hang detection), and non-blocking
 * permission round-trips — all as protocol built-ins.
 *
 * Called by oc-delegate.sh as one subprocess; oc-delegate keeps ownership of
 * session-dir bootstrap, TASK_TYPE→model mapping, git-diff capture, and the
 * 7-line report. This client owns: connect → set model → prompt → stream, and
 * classifies the turn outcome into the delegation exit-code contract.
 *
 * CLI:
 *   node acp-client.mjs --dir D --model P/M [--variant V] --prompt-file P
 *                       --session-dir S [--timeout SEC] [--stall SEC]
 *
 * Side effects (in --session-dir, consumed by oc-result-review — never by CC):
 *   oc_sid          ACP session id
 *   sse.ndjson      one JSON line per session/update + synthetic permission/error
 *   response.json   final PromptResponse (stop reason)
 *   controller.log  this client's own diagnostics
 *
 * Exit codes (contract — keep in sync with oc-delegate.sh / delegate-oc SKILL.md):
 *   0   done          normal completion (end_turn / max_tokens)
 *   11  err-session    spawn / initialize / session/new failed
 *   12  err-prompt     prompt request rejected (transport / protocol error)
 *   13  err-session-evt agent stopped with an error reason (refusal)
 *   20  aborted-perm   we auto-denied a permission → turn cancelled
 *   30  timeout        exceeded --timeout (turn aborted)
 *   31  stalled        stall watchdog fired — no update for --stall seconds (turn aborted)
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import { appendFileSync, writeFileSync } from "node:fs";
import { client, ndJsonStream } from "@agentclientprotocol/sdk";

// ── exit-code constants (mirror the contract above) ──────────────────────────
const EC_DONE = 0;
const EC_ERR_SESSION = 11;
const EC_ERR_PROMPT = 12;
const EC_ERR_SESSION_EVT = 13;
const EC_ABORTED_PERM = 20;
const EC_TIMEOUT = 30;
const EC_STALLED = 31;

// ── arg parsing ──────────────────────────────────────────────────────────────
interface Args {
  dir: string;
  model: string;
  variant?: string;
  promptFile: string;
  sessionDir: string;
  timeoutMs: number;
  stallMs: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i > -1 ? argv[i + 1] : undefined;
  };
  const dir = get("--dir");
  const model = get("--model");
  const promptFile = get("--prompt-file");
  const sessionDir = get("--session-dir");
  if (!dir || !model || !promptFile || !sessionDir) {
    process.stderr.write(
      "ERROR: --dir, --model, --prompt-file, --session-dir are required\n",
    );
    process.exit(EC_ERR_SESSION);
  }
  return {
    dir,
    model,
    variant: get("--variant"),
    promptFile,
    sessionDir,
    // Overall wall-clock ceiling for the turn. Default matches oc-delegate 300s.
    timeoutMs: Number(get("--timeout") ?? process.env.CC_OC_WAIT_TIMEOUT ?? 300) * 1000,
    // Stall = no session/update for this long while a turn is active → hang.
    stallMs: Number(get("--stall") ?? process.env.CC_OC_STALL_SECONDS ?? 60) * 1000,
  };
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  const LOG = `${args.sessionDir}/controller.log`;
  const NDJSON = `${args.sessionDir}/sse.ndjson`;
  const RESPONSE = `${args.sessionDir}/response.json`;
  const OC_SID_FILE = `${args.sessionDir}/oc_sid`;
  writeFileSync(LOG, "");
  writeFileSync(NDJSON, "");

  const log = (tag: string, obj?: unknown) => {
    const line = `${new Date().toISOString()} ${tag}${obj === undefined ? "" : " " + JSON.stringify(obj)}\n`;
    appendFileSync(LOG, line);
  };
  // sse.ndjson keeps REST-era grep tokens ("permission.asked" / "session.error")
  // so oc-result-review and any transitional grep classifier keep working.
  const record = (event: unknown) => appendFileSync(NDJSON, JSON.stringify(event) + "\n");

  const promptText = await Bun_or_node_readFile(args.promptFile);
  if (!promptText.trim()) {
    log("empty prompt");
    return EC_ERR_SESSION;
  }

  // 1) spawn opencode acp (JSON-RPC on stdio, logs on stderr).
  // --pure by default: delegation needs no external opencode plugins (beads,
  // obsidian, memory-guard, …). Skipping them cuts boot from ~3.9s to ~1.3s and
  // removes stray non-JSON stdout noise. Opt out with CC_OC_ACP_PURE=0.
  const logLevel = process.env.CC_OC_ACP_LOG_LEVEL ?? "ERROR";
  const acpArgs = ["acp", "--log-level", logLevel, "--cwd", args.dir];
  if (process.env.CC_OC_ACP_PURE !== "0") acpArgs.push("--pure");
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn("opencode", acpArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e: any) {
    log("spawn failed", { message: e?.message });
    return EC_ERR_SESSION;
  }
  child.stderr.on("data", (b: Buffer) => appendFileSync(LOG, `[oc] ${b}`));
  child.on("exit", (code: number | null, sig: NodeJS.Signals | null) =>
    log("opencode exited", { code, sig }),
  );

  // 2) wrap child stdio into a byte Stream (write→stdin, read→stdout).
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
  );

  // ── turn state (shared with the watchdog + handlers) ───────────────────────
  let lastUpdateAt = Date.now();
  let updates = 0;
  let permissionDenied = false;
  // Reason the turn ended abnormally; set by watchdog before aborting.
  let abortReason: "stalled" | "timeout" | null = null;
  const ac = new AbortController();

  // 3) client with the three pluggable extension points.
  const app = client({ name: "cc-opencode" })
    // ① progress sink + stall watchdog fuel
    .onNotification("session/update", (ctx: any) => {
      updates++;
      lastUpdateAt = Date.now();
      record(ctx.params); // SessionNotification: { sessionId, update: { sessionUpdate, ... } }
    })
    // ② permission policy — auto-deny (current policy); surface as aborted-perm.
    .onRequest("session/request_permission", (ctx: any) => {
      permissionDenied = true;
      record({ type: "permission.asked", params: ctx.params });
      log("permission auto-denied");
      return { outcome: { outcome: "cancelled" } };
    });
  // ③ interactive question (unstable_createElicitation) is deferred (plan §4.7):
  //    a later version registers it to surface questions to CC → ask user →
  //    resume. Until then, an elicitation request errors out (rare; only when a
  //    tool explicitly asks) rather than silently hanging.

  const startAt = Date.now();

  // 4) stall/timeout watchdog: reset on every update; abort the turn on breach.
  const watchdog = setInterval(() => {
    const now = Date.now();
    if (now - startAt > args.timeoutMs) {
      abortReason = "timeout";
      log("timeout — aborting turn", { ms: now - startAt });
      ac.abort();
    } else if (now - lastUpdateAt > args.stallMs) {
      abortReason = "stalled";
      log("stall — aborting turn", { sinceLastUpdateMs: now - lastUpdateAt });
      ac.abort();
    }
  }, 500);

  let exitCode = EC_DONE;
  try {
    exitCode = await app.connectWith(stream, async (ctx: any): Promise<number> => {
      // connect → session/new (cwd)
      let session: any;
      try {
        session = await ctx.buildSession(args.dir).start();
      } catch (e: any) {
        log("session/new failed", { message: e?.message });
        return EC_ERR_SESSION;
      }
      writeFileSync(OC_SID_FILE, String(session.sessionId));
      log("session started", { sessionId: session.sessionId, model: args.model });

      // set model (opencode extension: session/set_model { sessionId, modelId, variant })
      try {
        const r = await ctx.request("session/set_model", {
          sessionId: session.sessionId,
          modelId: args.model,
          ...(args.variant ? { variant: args.variant } : {}),
        });
        log("model set", r?._meta ?? r);
      } catch (e: any) {
        // Non-fatal: fall back to the session default model, but flag it loudly.
        log("model set FAILED — using session default", { code: e?.code, message: e?.message });
      }

      // prompt (streaming turn), cancellable via the watchdog's AbortSignal.
      log("prompt →", { chars: promptText.length });
      let res: any;
      try {
        res = await session.prompt(promptText, { signal: ac.signal });
      } catch (e: any) {
        // AbortError → the watchdog cancelled the turn (stall/timeout).
        if (abortReason === "stalled") return EC_STALLED;
        if (abortReason === "timeout") return EC_TIMEOUT;
        log("prompt rejected", { message: e?.message });
        return EC_ERR_PROMPT;
      }
      writeFileSync(RESPONSE, JSON.stringify(res, null, 2));
      log("prompt done", { stopReason: res?.stopReason, updates });

      if (abortReason === "stalled") return EC_STALLED;
      if (abortReason === "timeout") return EC_TIMEOUT;
      if (permissionDenied || res?.stopReason === "cancelled") {
        record({ type: "session.error", reason: "aborted-perm" });
        return EC_ABORTED_PERM;
      }
      if (res?.stopReason === "refusal") {
        record({ type: "session.error", reason: "refusal" });
        return EC_ERR_SESSION_EVT;
      }
      return EC_DONE; // end_turn, max_tokens, max_turn_requests
    });
  } catch (e: any) {
    log("connection error", { message: e?.message });
    exitCode = abortReason === "stalled" ? EC_STALLED
      : abortReason === "timeout" ? EC_TIMEOUT
      : EC_ERR_PROMPT;
  } finally {
    clearInterval(watchdog);
    child.kill("SIGTERM");
  }

  // one-line machine-readable summary for oc-delegate (exit code is the contract)
  process.stdout.write(
    JSON.stringify({
      status:
        exitCode === EC_DONE ? "done"
        : exitCode === EC_ABORTED_PERM ? "aborted-perm"
        : exitCode === EC_STALLED ? "stalled"
        : exitCode === EC_TIMEOUT ? "timeout"
        : "error",
      exit: exitCode,
      updates,
    }) + "\n",
  );
  return exitCode;
}

// Read the prompt file without pulling in extra deps; works under node and bun.
async function Bun_or_node_readFile(path: string): Promise<string> {
  const { readFile } = await import("node:fs/promises");
  return readFile(path, "utf8");
}

main().then((code) => process.exit(code)).catch((e) => {
  process.stderr.write(`FATAL ${e?.stack ?? e}\n`);
  process.exit(EC_ERR_PROMPT);
});
