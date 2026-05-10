# @aydenden/opencode-plugins

OpenCode adapter for the `aydenden/cc-plugins` Claude Code plugin marketplace.

## Install

Add the npm package to `~/.config/opencode/opencode.json` or project `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@aydenden/opencode-plugins"]
}
```

For local development from this repository:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:./packages/opencode-plugin"]
}
```

## What This Provides

- Commands from every plugin under `plugins/*/commands`.
- Agents from every plugin under `plugins/*/agents`.
- A skill installer tool and command for every skill under `plugins/*/skills`.
- Selected OpenCode hook equivalents for safe worktree workflows.

## Agents

Agents are registered with the plugin name as a prefix and `mode: "subagent"`.

- `obsidian-knowledge-research-agent`
- `pm-pm-assistant`
- `worktree-task-worktree-task`

## Command Names

Commands are prefixed with the plugin name to avoid collisions.

- `/obsidian-knowledge-recall`
- `/obsidian-knowledge-capture`
- `/korean-trading-scan`
- `/korean-trading-analyze`
- `/pm-prd`
- `/pm-plan`
- `/cc-plugins-install-skills`

## Skills

OpenCode discovers skills from config directories such as `.opencode/skills` and `~/.config/opencode/skills`. npm package contents are not automatically discovered as native skills, so install them explicitly:

```text
/cc-plugins-install-skills project
```

or ask the agent to call the `cc_plugins_install_skills` tool with `target: "global"`.

The installer overwrites existing skills with the same name in the selected target directory.

## Hooks

The package ports the protected branch guard from `worktree-task` to OpenCode's `tool.execute.before` hook. To enable it, create either `.opencode/worktree-task.local.md` or `.claude/worktree-task.local.md` in the worktree:

```yaml
---
protected-branches:
  - main
  - master
---
```

When the current branch is listed, `write`, `edit`, and `apply_patch` tool executions are blocked.

## Development

```bash
bun install
bun run build
npm pack --dry-run
```

The package assets are generated from the repository-level `plugins/` directory. Do not edit `assets/` directly.
