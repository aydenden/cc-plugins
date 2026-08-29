# Issue tracker

Issues for this repository live in **beads** (`bd`), a local Dolt-backed tracker with first-class dependencies. This is fixed — do not fall back to `gh issue`, `glab`, or markdown files under `.scratch/`, even if a remote exists.

## Command mapping

Skills that create, read, or move issues use these calls:

| Operation | Command |
|---|---|
| Create | `bd create --title= --description= --type=task\|bug\|feature --priority=0..4` |
| Acceptance criteria | `bd create --acceptance="..."` or `bd update <id> --acceptance="..."` |
| Design decisions | `bd create --design="..."` |
| Hierarchy | `bd create --parent=<epic-id>` |
| Dependency | `bd dep add <issue> <blocker>` |
| List open | `bd list --status=open` |
| Available work | `bd ready` |
| Detail | `bd show <id>` |
| Update | `bd update <id> --status= --priority= --assignee= --notes=` |
| Close | `bd close <id> --reason="..." --suggest-next` |
| Search | `bd search "<query>"` |
| Needs a human | `bd human <id>` |
| Approval point | gate issue via `bd gate`; resolve with `bd gate resolve <id>` |

Issue IDs look like `<prefix>-<slug>` (for example `ccp-k3d`). Reference them verbatim in commits and documents.

## Pull requests

Pull requests are not a request surface for this repository. Triage handles issues only.

## Notes

- `bd edit` opens `$EDITOR` and blocks agents. Use `bd update` with field flags.
- Nothing reaches a remote until `bd dolt push` runs explicitly.
- Issues produced by `to-issues` are already agent-ready. Do not run them through triage.
