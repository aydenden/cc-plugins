#!/usr/bin/env bash
# session-start.sh — provision the llm-wiki search CLI and verify the vault.
# Never blocks session start; emits one-line stderr notices only.
#
# Claude Code has no post-install/post-clone hook, so first-run dependency
# setup ('bun install') is bootstrapped here, marker-guarded and backgrounded.
set -uo pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

# --- Legacy model cache migration (per-version plugin dir → shared cache dir) ---
# The ONNX model cache (~1.1GB) used to live in <plugin>/<version>/.cache/models. Plugins install
# into a fresh directory per version, so that location was orphaned on every bump. Models now live
# in a version-independent directory; src/paths.ts is the SSoT for where, and 'llm-wiki cache-dir'
# reports it (never duplicate that rule here). Any leftover per-version cache is adopted once —
# the glob below makes this a no-op afterwards. Only models/ moves: .cache also holds the
# per-version deps-installed marker, which must NOT be carried over or 'bun install' gets skipped
# while node_modules is still missing.
LEGACY=""
for candidate in "$(dirname "$PLUGIN_ROOT")"/*/.cache/models; do
  [ -d "$candidate" ] || continue
  # Guard against non-version siblings (e.g. a dev checkout whose parent holds other plugins).
  case "$(basename "${candidate%/.cache/models}")" in
    [0-9]*.[0-9]*.[0-9]*) ;;
    *) continue ;;
  esac
  if [ -z "$LEGACY" ] || [ "$candidate" -nt "$LEGACY" ]; then LEGACY="$candidate"; fi
done
if [ -n "$LEGACY" ] && command -v bun >/dev/null 2>&1; then
  TARGET="$(cd "$PLUGIN_ROOT" && bun run src/cli.ts cache-dir 2>/dev/null | tail -1)"
  case "$TARGET" in /*) ;; *) TARGET="" ;; esac # 해석 실패 시 아무것도 건드리지 않는다
  if [ -n "$TARGET" ] && [ "$TARGET" != "$LEGACY" ]; then
    if [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then
      echo "[llm-wiki] Shared model cache already populated; leftover copy at $LEGACY can be deleted." >&2
    else
      mkdir -p "$(dirname "$TARGET")"
      rmdir "$TARGET" 2>/dev/null # cache-dir가 빈 디렉토리를 만들어 두므로 mv 전에 비운다
      if mv "$LEGACY" "$TARGET" 2>/dev/null; then
        echo "[llm-wiki] Moved the model cache to $TARGET — shared across versions from now on." >&2
      else
        # 다른 파일시스템이면 rename이 안 된다 → 1.1GB 복사는 세션을 막지 않게 백그라운드로.
        mkdir -p "$TARGET"
        echo "[llm-wiki] Copying the model cache to $TARGET in background (different filesystem)." >&2
        (cp -R "$LEGACY/." "$TARGET/" >/dev/null 2>&1 && rm -rf "$LEGACY") &
      fi
    fi
  fi
fi

# --- Dependency auto-provision (marker-guarded, once, background) ---
MARKER="$PLUGIN_ROOT/.cache/deps-installed"
if [ ! -d "$PLUGIN_ROOT/node_modules/@orama" ] && [ ! -f "$MARKER" ]; then
  if command -v bun >/dev/null 2>&1; then
    echo "[llm-wiki] Search CLI deps missing — running 'bun install' in background (first run only). Search is unavailable until it finishes." >&2
    mkdir -p "$PLUGIN_ROOT/.cache"
    (
      cd "$PLUGIN_ROOT" || exit 0
      if bun install >/dev/null 2>&1; then
        touch "$MARKER"
        echo "[llm-wiki] Dependencies installed. First 'llm-wiki index' downloads models (~1GB); until then search runs BM25-only." >&2
      else
        echo "[llm-wiki] 'bun install' failed — run it manually in $PLUGIN_ROOT." >&2
      fi
    ) &
  else
    echo "[llm-wiki] Bun runtime not found — search CLI disabled. Install: curl -fsSL https://bun.sh/install | bash (or: npm i -g bun)." >&2
  fi
fi

# --- Vault verification ---
WIKI="${WIKI_PATH:-${OBSIDIAN_VAULT_PATH:-}}"

if [ -z "$WIKI" ]; then
  echo "[llm-wiki] Neither WIKI_PATH nor OBSIDIAN_VAULT_PATH is set — capture/recall/research/lint will fail. Set WIKI_PATH in your shell." >&2
  exit 0
fi

if [ ! -d "$WIKI" ]; then
  echo "[llm-wiki] Wiki path $WIKI does not exist." >&2
  exit 0
fi

if [ ! -f "$WIKI/SCHEMA.md" ]; then
  echo "[llm-wiki] $WIKI has no SCHEMA.md — vault is not initialized as an LLM Wiki. Schema rules (SSoT) cannot be applied." >&2
  exit 0
fi

exit 0
