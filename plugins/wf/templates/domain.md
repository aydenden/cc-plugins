# Domain docs

This repository uses a **single-context** layout.

| Artifact | Location | Contents |
|---|---|---|
| Ubiquitous language | `CONTEXT.md` (repo root) | Domain terms, their canonical meaning, and known ambiguities |
| Architecture decisions | `docs/adr/` | One file per decision, with the alternatives considered and why they lost |

`CONTEXT.md` and `docs/adr/` are the single source of truth for domain language and past decisions. `bd decision` is not used — a decision recorded in two places drifts.

Skills that read these: `/grill-with-docs` (maintains them), `/improve-codebase-architecture`, `/diagnosing-bugs`, `/tdd`, `wf:sources` (harvests them as grounding).

When a term is fuzzy or a word is doing several jobs, reach for `/domain-modeling` rather than inventing a definition inline.
