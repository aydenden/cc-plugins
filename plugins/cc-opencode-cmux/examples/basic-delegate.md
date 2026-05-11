# Basic Delegation Example

A walkthrough of a typical `/cc-opencode-cmux:delegate` call.

## Setup (once per workstation)

```bash
brew install opencode-ai/opencode/opencode
export OPENROUTER_API_KEY=sk-or-...
```

## Setup (once per Claude Code session)

```
/cc-opencode-cmux:serve-start
```

Starts the daemon on `127.0.0.1:4096`. Subsequent delegations reuse it instead of paying the 75-second cold start.

## Delegate a CRUD scaffold

User prompt to Opus:

> "Create a `UserRepository` struct in `src/db/user.rs` with the standard CRUD methods (create, get_by_id, list, update, delete) following the same shape as `OrderRepository`."

Opus (using the `delegate-oc` skill) writes a spec to `/tmp/cc-oc-<session>/prompt.md`:

```
TASK: Create UserRepository in src/db/user.rs

FILES TO TOUCH:
- src/db/user.rs (create)
- src/db/mod.rs (add `pub mod user;`)

BEHAVIOR:
- Match the public API of src/db/order.rs (OrderRepository)
- Methods: new(pool), create, get_by_id, list, update, delete
- Use sqlx::PgPool and anyhow::Result<T>

CONVENTIONS:
- See AGENTS.md
- snake_case for SQL column names, camelCase for none (Rust)

ACCEPTANCE TEST:
- $ cargo check --package myapp
```

Opus calls:

```
/cc-opencode-cmux:delegate "Create UserRepository in src/db/user.rs matching OrderRepository's shape"
```

## What happens

1. `route-task.sh` classifies → `implement`
2. `safe-oc.sh` injects `perm-implement.json`, attaches to `http://127.0.0.1:4096`, runs `opencode run --agent oc-implement --format json < prompt.md`
3. `oc-watch.sh` subscribes to `/event`, resets its tick on every `session.next.tool.called` and `message.updated`
4. After ~40 seconds, `session.idle` fires → exit 0
5. `post-oc-run.sh` captures `git diff` and prints the session path

## Review

```
/cc-opencode-cmux:review
```

Opus reads the diff, verifies the imports match `Cargo.toml`, runs `cargo check`, and either accepts or re-delegates.
