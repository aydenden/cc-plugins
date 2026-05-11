# Knowledge Pipeline: research → compose

How a domain plugin (e.g. `obsidian-knowledge`, `korean-trading`, `pm`) orchestrates a two-stage knowledge workflow through `cc-opencode-cmux`. The plugin keeps the domain logic in its own session; OpenCode handles the heavy-token external research and document writing.

## Scenario

Domain plugin needs to produce a structured note about a new topic. The plugin already knows:
- The output schema (frontmatter fields, sections, conventions)
- The target directory (vault, reports, planning, etc.)
- Existing local context (no duplicates to research again)

It does NOT want to spend its own (Sonnet/Opus) tokens on:
- WebSearch + WebFetch raw bodies (often 50K+ tokens per session)
- Drafting boilerplate prose

## Pipeline

```
[Caller plugin in CC]
  1. Resolve target directory + check for duplicates in local cache
  2. Write research spec → /tmp/cc-oc-<id>/research-spec.md
       Contents: topic, key questions, source-quality hints, output schema
        ↓
  3. /cc-opencode-cmux:delegate "<spec>" --type research
       OC fetches sources, writes raw_research.md to stdout (captured by safe-oc.sh)
        ↓
  4. CC reviews raw_research briefly (sanity check, gap detection — ~50 lines)
  5. Write compose spec → /tmp/cc-oc-<id>/compose-spec.md
       Contents: schema, frontmatter values, raw_research path, target file path
        ↓
  6. /cc-opencode-cmux:delegate "<compose-spec>" --type compose --dir <target_dir>
       OC reads raw_research, writes the final document to target_dir
        ↓
  7. CC handles post-processing inside its own domain
       (e.g. obsidian-knowledge: insert backlinks, update index.md/log.md)
```

## Token economy

| Step | Tokens consumed by CC | Tokens consumed by OC |
|---|---:|---:|
| Research spec drafting | ~2K | — |
| External research | — | ~30–100K |
| Raw research review | ~3K (read summary only) | — |
| Compose spec drafting | ~2K | — |
| Document writing | — | ~10–30K |
| Domain post-processing | ~3K | — |
| **Total** | **~10K** | **~40–130K** |

CC token usage drops by ~85–90% vs. the monolithic approach where CC handles every stage itself.

## Example: obsidian-knowledge research-agent (planned v0.3.0)

```bash
# Caller plugin code (simplified):
SESSION=$(uuidgen)
TMPDIR=/tmp/cc-oc-$SESSION
mkdir -p "$TMPDIR"

cat > "$TMPDIR/research-spec.md" <<EOF
TOPIC: $TOPIC

KEY QUESTIONS:
- $Q1
- $Q2

SOURCE GUIDELINES:
- Prefer official docs (confidence=high)
- Prefer 1차 sources (papers, RFCs) over blogs
- Note publication date for each source

OUTPUT SCHEMA:
- Plain markdown with H2 sections per question
- Each fact must cite its source URL
- Generate source_hash for the primary source: shasum -a 256 first 500 chars
EOF

# Stage 1: research
/cc-opencode-cmux:delegate "<$TMPDIR/research-spec.md" --type research
# raw research lands in $TMPDIR/oc.ndjson (and stdout content captured)

# CC reviews raw_research, then writes compose-spec
cat > "$TMPDIR/compose-spec.md" <<EOF
INPUT: $TMPDIR/raw_research.md (read with the Read tool)

OUTPUT FILE: $OBSIDIAN_VAULT_PATH/AI/<topic>.md

FRONTMATTER:
---
type: <entity_type>
tags: [<tag1>, <tag2>]
summary: "<one-line summary>"
date: $(date +%Y-%m-%d)
source: "<primary URL>"
source_hash: <hash from research>
confidence: <high|medium|low>
---

BODY SECTIONS:
- 정의
- 핵심 아이디어
- 장단점 비교
- 실전 적용
- 출처

CONVENTIONS:
- Korean prose, technical terms in English allowed
- Do NOT touch .obsidian/
- Do NOT create files outside OUTPUT FILE path
EOF

/cc-opencode-cmux:delegate "<$TMPDIR/compose-spec.md" --type compose --dir $OBSIDIAN_VAULT_PATH

# CC handles backlinks + index.md/log.md updates directly
```

## Why two stages instead of one

- **Different optimal models**: research needs long context + retrieval (deepseek-v4-pro 1M ctx); compose needs language quality (qwen3.6-plus for Korean).
- **Different permission profiles**: research allows web + denies edit; compose denies web + allows edit. Easier to reason about safety.
- **Intermediate validation**: CC can sanity-check raw_research before paying tokens on a polished document built from bad facts.
- **Partial retry**: if compose fails, raw_research is reused. No need to refetch.

## Caller responsibilities

The caller plugin is responsible for:
- Domain-specific schema (wiki frontmatter, report layout, PRD structure)
- Choosing the output directory (`--dir`)
- Post-processing that requires domain knowledge (backlink insertion, index updates, beads issue linking, etc.)
- Aggregating the final result for the user

`cc-opencode-cmux` is responsible for:
- Running OpenCode with the right permission profile
- Hang detection via SSE
- Capturing output to `/tmp/cc-oc-<id>/`
- Reporting status (done / aborted / error)

Nothing else. No domain knowledge leaks across this boundary.
