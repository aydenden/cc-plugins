#!/usr/bin/env bash
# session-start.sh — verify Obsidian vault path.
# Never blocks session start; emits one-line stderr notice if vault missing.
set -uo pipefail

if [ -z "${OBSIDIAN_VAULT_PATH:-}" ]; then
  echo "[obsidian-knowledge] OBSIDIAN_VAULT_PATH not set — research/capture/lint will fail. Set it in your shell." >&2
  exit 0
fi

if [ ! -d "$OBSIDIAN_VAULT_PATH" ]; then
  echo "[obsidian-knowledge] OBSIDIAN_VAULT_PATH=$OBSIDIAN_VAULT_PATH does not exist." >&2
  exit 0
fi

# cc-opencode-cmux 위임은 research-agent가 호출 시점에 Skill(cc-opencode-cmux:delegate-oc)
# 로 자동 처리한다. 별도 daemon 사전 감지/안내는 하지 않는다.

exit 0
