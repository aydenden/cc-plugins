# Multi-Document Analysis with `--type analyze`

Read-only delegation that reads multiple existing documents and produces a comparison, evaluation, or extracted insight. No edits, no external fetching.

## When to use

- Compare two or more existing notes / reports / RFCs / PRDs
- Extract a structured summary from a long codebase doc set
- Evaluate a draft against project conventions
- Detect contradictions across multiple sources

## Example 1 — Compare two design docs

```bash
SESSION=$(uuidgen)
mkdir -p /tmp/cc-oc-$SESSION

cat > /tmp/cc-oc-$SESSION/analyze-spec.md <<EOF
TASK: Compare two design proposals for the new auth system.

DOCUMENTS:
- docs/proposals/auth-jwt.md
- docs/proposals/auth-session.md

OUTPUT (markdown, return on stdout):

## Summary
- 2-3 sentences per proposal

## Side-by-side
| Dimension | JWT | Session |
| Security model | ... | ... |
| Operational cost | ... | ... |
| Migration risk | ... | ... |
| Failure modes | ... | ... |

## Recommendation
- Pick one with rationale (3-5 bullets).
- List unresolved questions.
EOF

/cc-opencode-cmux:delegate "<$(cat /tmp/cc-oc-$SESSION/analyze-spec.md)" --type analyze --dir $PWD
```

OC reads both files (read/grep/glob allowed, edit denied), writes the comparison to stdout. CC captures the result via `safe-oc.sh` and surfaces it to the user.

## Example 2 — Cross-document contradiction detection

```bash
cat > /tmp/cc-oc-$SESSION/analyze-spec.md <<EOF
TASK: Find contradictions or inconsistencies across the listed wiki notes.

DOCUMENTS:
$(ls -1 "$OBSIDIAN_VAULT_PATH"/AI/도구/*-opencode-*.md)

OUTPUT:
For each pair of contradicting statements, output:
- Statement A: "..." (note path, line)
- Statement B: "..." (note path, line)
- Conflict type: factual | naming | timeline | scope
- Suggested resolution
EOF

/cc-opencode-cmux:delegate "<$(cat ...)" --type analyze --dir "$OBSIDIAN_VAULT_PATH"
```

## Example 3 — Evaluate a draft against conventions

```bash
cat > /tmp/cc-oc-$SESSION/analyze-spec.md <<EOF
TASK: Evaluate the draft PRD against the team's PRD template.

DRAFT: .planning/prds/2026-05-11-feature-x-draft.md
TEMPLATE: .planning/templates/prd-template.md

OUTPUT:
## Compliance check
- [ ] Has Problem Statement
- [ ] Has Success Metrics
- [ ] Has User Stories with INVEST checklist
- [ ] Has acceptance criteria for each story
- ... (one item per template section)

## Missing or weak sections
- Section: <name>
  - Issue: ...
  - Suggested fix: ...

## Style issues
- ...
EOF

/cc-opencode-cmux:delegate "<$(cat ...)" --type analyze --dir $PWD
```

## Why analyze is separate from research

- **research** = fetch external sources (web) and write raw bullets
- **analyze** = read existing local documents (read-only) and produce a structured judgment

Different permission profiles, different best models (kimi-k2.6 for long-context reasoning vs deepseek-v4-pro for retrieval-style research), different timeout characteristics.
