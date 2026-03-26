#!/bin/bash
# PM Plugin dependency checker
# Checks: PMS marketplace + Beads CLI + .beads/ init

MISSING=""

# 1. Check PMS (Product-Manager-Skills) installation
# Look for PMS skills directory in installed marketplaces/plugins
PMS_FOUND=false
for dir in ~/.claude/plugins/marketplaces/*/plugins/*/skills/epic-hypothesis; do
  if [ -d "$dir" ] 2>/dev/null; then
    PMS_FOUND=true
    break
  fi
done

if [ "$PMS_FOUND" = false ]; then
  MISSING="${MISSING}[PM] PMS(Product-Manager-Skills) not installed. Run: /plugin marketplace add deanpeters/Product-Manager-Skills\n"
fi

# 2. Check Beads CLI
if ! command -v bd &>/dev/null; then
  MISSING="${MISSING}[PM] Beads CLI not installed. Run: npm i -g @beads-cli/beads\n"
fi

# 3. Check .beads/ initialization in current project
if [ ! -d ".beads" ] || [ ! -f ".beads/config.yaml" ]; then
  MISSING="${MISSING}[PM] Beads not initialized in this project. Run: bd init\n"
fi

# Output warnings if any
if [ -n "$MISSING" ]; then
  printf "$MISSING" >&2
fi
