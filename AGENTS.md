# AGENTS.md

## Source Of Truth

- `plugins/` is the source of truth for Claude Code plugin definitions, commands, skills, agents, hooks, and scripts.
- `.claude-plugin/marketplace.json` is the source of truth for the Claude Code marketplace listing.
- `packages/opencode-plugin/assets/` is generated from `plugins/` for npm packaging and must not be edited directly.
- `packages/opencode-plugin/src/` is the source of truth for the OpenCode npm plugin runtime.

## OpenCode Package

- Run the OpenCode package sync/build from `packages/opencode-plugin` before publishing.
- Do not add secrets, `.env` files, caches, or generated tokens to npm package assets.
- Keep new reusable plugin content in `plugins/` first, then sync it into the OpenCode package.
