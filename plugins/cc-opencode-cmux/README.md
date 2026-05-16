# cc-opencode-cmux

Claude Code (Opus, orchestrator) + OpenCode (cheap-model implementer) + cmux (parallel session visualization) — a 3-tool hybrid delegation plugin.

## What it does

Lets Claude Code in Opus mode hand off mechanical coding work (CRUD scaffolding, refactors, summarization, CJK documentation) to OpenCode running cheaper models like Gemini 3 Flash, DeepSeek V4 Pro, or Qwen 3.6 Plus, while keeping a tight feedback loop:

- **Daemon reuse**: `opencode serve` runs once, every delegation attaches in 1–3s instead of paying 75s cold start
- **SSE-based hang detection**: subscribes to `/event` and aborts on inactivity or step-loop signatures, no blind `timeout`
- **Per-task permission profiles**: 4 separate JSON policies (implement / refactor / summarize / cjk-doc) injected via `OPENCODE_PERMISSION` env
- **Auto diff capture**: PostToolUse hook captures `git diff` and surfaces it for Opus review
- **Worktree isolation**: optional `--worktree` flag runs the delegation in a separate branch for clean review
- **cmux/tmux split** (best-effort): shows each delegation as a separate pane for visual progress

## Why a new plugin

Existing options either delegate from OpenCode (not the other way around — `oh-my-openagent`, `0xCaso/opencode-cmux`), put codex in the orchestrator seat (`stellarlinkco/myclaude`), or run plain tmux without CC plugin packaging (`barkain/claude-code-workflow-orchestration`). None expose a CC-plugin-shaped surface where Opus is the captain, OpenCode is the crew, and SSE drives hang detection.

See `docs/plans/2026-05-11-cc-opencode-cmux-design.md` in the repo root for the full design rationale.

## Install

Add the plugin to your Claude Code marketplace, then enable it in a project. From the project root:

```bash
# 1. Install opencode CLI
brew install opencode-ai/opencode/opencode

# 2. Authenticate. OC Zen and OC Go are SEPARATE subscriptions — pick one or both.
opencode auth login          # menu: select "OpenCode Go" ($10/mo subscription required)
opencode auth login          # menu: select "OpenCode Zen" (pay-as-you-go, premium models)
# Both store the API key under env OPENCODE_API_KEY. BYOK fallback (optional):
#   export OPENROUTER_API_KEY=sk-or-...
#   export DEEPSEEK_API_KEY=sk-...

# 3. (Optional) Copy AGENTS.md snippet to your project
cat ${CLAUDE_PLUGIN_ROOT}/templates/AGENTS.md.snippet >> AGENTS.md

# 4. (Optional) Copy CLAUDE.md policy snippet
cat ${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md.snippet >> CLAUDE.md

# 5. Install jq (required for agent registration into user OC config)
brew install jq    # or apt install jq

# 6. (Optional) Start the daemon — safe-oc.sh auto-starts it on first use
/cc-opencode-cmux:serve-start
```

> **v0.2.1+**: `safe-oc.sh` auto-starts the daemon if it's not running. Set `CC_OC_NO_AUTOSTART=1` to opt out.
>
> **v0.2.2+**: Plugin's `oc-*` agent definitions are automatically merged into the user's `~/.config/opencode/opencode.json` on session start (idempotent, marker-gated, preserves user's existing agents/providers/MCP via `jq` deep merge). Without this OC silently falls back to the default `build` agent on `--agent oc-research` etc., which breaks ndjson streaming and forces REST polling.
>
> **v0.2.5+**: Parallel `/cc-opencode-cmux:delegate` calls are now safe. `oc-watch.sh` filters server-global `/event` SSE by `sessionID` so concurrent sessions don't poison each other's idle/error/step-loop detection. `worktree-dispatch.sh` appends a short uuid to worktree paths/branches to avoid same-second collisions.
>
> **v0.3.0+**: cmux IPC transport (Pattern B'). When `cmux` is on PATH, delegations now run inside a visible cmux split — `cmux new-split right` for the first delegate, `cmux new-split down --surface $ROOT` for parallel ones so the main pane is never further sliced. Completion is signaled via `cmux wait-for --signal`, and surfaces auto-close (`cmux close-surface`) when each delegate finishes; the last one also closes the root surface. SSE is kept as automatic fallback (`safe-oc.sh`) — override the transport with `CC_OC_FORCE_MODE=cmux|sse|auto`. Resolves SSE blindness ("is it actually running?") and known SSE regressions in opencode v1.14.43–48 (#27391).
>
> **v0.3.1+**: Live progress inside the split. The cmux-dispatch worker now passes `--print-logs` and tees stderr to the split (plus a file), while stdout (ndjson) goes through `jq` to surface response text in the split as it streams. You'll see "==> opencode starting", live INFO logs, and the model's reply landing in the right pane instead of a blank screen. `oc-implementer` agent now dispatches through `bin/oc-route.sh` (was `bin/safe-oc.sh`) so sub-agent delegations also get the split visualization.
>
> **v0.3.2+**: `perm-compose.json` now allows generator scripts scoped to the session dir (`python3 /tmp/cc-oc-*/*`, `node /tmp/cc-oc-*/*`, `bash /tmp/cc-oc-*/*`, `chmod +x /tmp/cc-oc-*/*`) so OC can run one-shot helpers without breaking sandbox boundaries. Also quantifies the OC Write-token budget so callers can decide split-vs-delegate before paying the cost:
>
> | Output type | Tokens/line | Safe per delegate | Hard wall |
> |---|---|---|---|
> | Source code | 50–80 | ≤ 1000 LOC | ~1100 LOC |
> | Markdown / 한국어 문서 | 60–100 | ≤ 800 LOC | ~900 LOC |
> | JSONL / CSV fixture | 150–300 | ≤ 250 LOC | ~300 LOC |
> | Parquet / DB seed / binary | — | **never delegate** | — |
>
> Estimated > 70K tokens or any binary output → CC main session generates the file first, then delegates only the code that reads it. The `delegate-oc` skill carries the decision rule; the `oc-implementer` agent rejects oversized tasks up front instead of letting them run to `step-loop` abort. Background: real-world v0.3.1 delegate hit `aborted (step-loop)` at ~88K tokens trying to `Write` a 400-frame JSONL cassette — see knowledge note `2026-05-16-cc-opencode-cmux-fixture-generation-blocked`.

## opencode version pinning (recommended)

opencode v1.15.1 introduced an `InstanceRef not provided` regression that breaks every `opencode run` invocation. This plugin has been tested against **v1.14.48**. Pin and prevent silent auto-upgrades:

```bash
# Pin to the known-good version
opencode upgrade 1.14.48

# Disable in-app auto-update by adding to ~/.config/opencode/opencode.json:
#   { "autoupdate": false, ... }
```

`safe-oc.sh` and `cmux-dispatch.sh` already set `OPENCODE_DISABLE_AUTOUPDATE=1` for the non-interactive worker process, but the config-level pin protects TUI/interactive invocations too. Re-enable only after confirming a newer opencode release fixes the regression.

Default agents use OC's own gateway:

- `opencode-go/...` for the $10/mo Go plan (Kimi K2.6, DeepSeek V4 Pro, Qwen 3.6 Plus, GLM-5.1, MiniMax M2.7, MiMo-V2.5-Pro, etc.)
- `opencode/...` for OC Zen premium pay-as-you-go (Gemini 3 Flash, Claude Sonnet 4.5, GPT-5.1, Claude Haiku 4.5, etc.)

OC Go and OC Zen are **independent subscriptions** — subscribing to one does not enable the other. BYOK keys are accepted but are not used as automatic fallback; OpenCode's `fallback_models` config field is not supported, so fallback is manual via `safe-oc.sh <task> ... <model_id>`.

## Commands

| Command | Purpose |
|---|---|
| `/cc-opencode-cmux:delegate "<spec>" [--type T] [--worktree]` | Dispatch a task to OpenCode |
| `/cc-opencode-cmux:review [session_id]` | Inspect the diff produced by a delegation |
| `/cc-opencode-cmux:status [session_id]` | Show active sessions and SSE progress |
| `/cc-opencode-cmux:serve-start` | Start the OpenCode daemon |
| `/cc-opencode-cmux:serve-stop` | Stop the OpenCode daemon |

## Skills

- `delegate-oc` — decides whether the current task should be delegated; auto-triggered by Claude when work matches the policy
- `oc-result-review` — structured review of a delegation diff (hallucination scan, scope adherence, security)

## Agent

- `oc-implementer` — thin Haiku wrapper for the orchestrator to invoke without polluting the main Opus context

## Task types and model routing

Default config targets **OC Go-only** subscribers. Every default model is in the
`opencode-go/*` namespace, so no Zen balance is required.

### Code tasks (v0.1.0)

| Type | Default model | Wall-clock | SSE hard-hang |
|---|---|---|---|
| `summarize` | `opencode-go/deepseek-v4-flash` (31,650 req/5h) | 300s | 60s |
| `single-file` | `opencode-go/deepseek-v4-pro` | 480s | 90s |
| `refactor` | `opencode-go/qwen3.6-plus` | 600s | 90s |
| `implement` | `opencode-go/deepseek-v4-pro` | 1800s | 120s |
| `cjk-doc` | `opencode-go/qwen3.6-plus` (best Korean in Go) | 600s | 90s |
| `batch` | `opencode-go/deepseek-v4-pro` | 3600s | 180s |

### Knowledge tasks (v0.2.0) — domain-agnostic

| Type | Default model | Wall-clock | SSE hard-hang | Permissions |
|---|---|---|---|---|
| `research` | `opencode-go/deepseek-v4-pro` (ctx 1M) | 1200s | 150s | webfetch+websearch allow, edit deny |
| `compose` | `opencode-go/qwen3.6-plus` | 900s | 120s | web deny, edit allow in `--dir` |
| `analyze` | `opencode-go/kimi-k2.6` (long reasoning) | 900s | 120s | read-only |

Knowledge tasks are designed as **building blocks** for other plugins (`obsidian-knowledge`, `pm`, `korean-trading`). Callers provide the spec + output schema + target directory; this plugin handles the OpenCode invocation. See `examples/knowledge-pipeline.md` for a research → compose two-stage workflow.

### Hybrid (Zen + Go)

If you also have an OC Zen balance and have enabled **Use balance** in the OpenCode
console, you can upgrade `cjk-doc` and `summarize` to premium Zen models:

```bash
/cc-opencode-cmux:delegate "한국어 README 작성" --model opencode/gemini-3-flash
/cc-opencode-cmux:delegate "한국어 README 작성" --model opencode/claude-sonnet-4-5
```

Manual fallback IDs are listed in each agent's `description` field in
`config/opencode.json.template`. Pass an alternative model ID as the 4th argument to
`bin/safe-oc.sh`, or use `--model` on `/cc-opencode-cmux:delegate`.

## Security defaults

- `--dangerously-skip-permissions` is **never** passed through
- All permission profiles use `allow`/`deny` binary (no `ask` — `ask` hangs in headless mode)
- `*.env*`, `**/secrets/**`, `**/.git/**` are deny-listed for edit by default
- `bash` is deny-by-default with a small allow list per task type
- `webfetch` and `websearch` are denied except for `summarize` (limited domains) and `cjk-doc` (denied)
- Daemon binds to `127.0.0.1` only, password-authenticated

## Known limitations

- `opencode run` has hang patterns (#16367, #17516, #26220) that the watcher catches but does not prevent
- `opencode-cli` 1.14.x has no native `--timeout` flag — wall-clock fallback uses GNU `timeout`
- `cmux` integration is best-effort; falls back to `tmux` then to background process
- Worktree mode does not auto-merge — Opus reviews and decides

## Related notes

- [OpenCode Server docs](https://opencode.ai/docs/server/) — SSE `/event` endpoint
- [OpenCode permissions](https://opencode.ai/docs/permissions/) — `OPENCODE_PERMISSION` env
- [OpenCode Go plan](https://opencode.ai/go) — model list
- [OpenCode Zen pricing](https://opencode.ai/docs/zen/) — Gemini 3 Flash and other premium models
