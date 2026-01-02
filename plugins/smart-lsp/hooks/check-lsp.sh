#!/bin/bash
# Block dangerous LSP operations that cause context overflow

read -r INPUT
OPERATION=$(echo "$INPUT" | jq -r '.tool_input.operation // empty')

case "$OPERATION" in
  workspaceSymbol|findReferences|incomingCalls)
    echo "Blocked: $OPERATION causes context overflow" >&2
    echo "" >&2
    echo "Use instead:" >&2
    echo "- Grep with head_limit for finding references" >&2
    echo "- Glob + documentSymbol for workspace search" >&2
    exit 2
    ;;
  *)
    exit 0
    ;;
esac
