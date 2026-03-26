---
name: beads-bridge
description: This skill should be used when PMS(Product-Manager-Skills) output needs to be converted to beads issues. Triggers when "epic-hypothesis", "user-story", "roadmap-planning", "prd-development", "discovery-process", or "epic-breakdown" skill output is available and needs to be tracked as beads epics, tasks, or features. Also triggers on "convert to beads", "create issues from PMS", "PMS output to beads".
---

## Purpose

Convert PMS skill outputs into beads issues automatically. Parse structured PMS artifacts (epic hypotheses, user stories, roadmap items, PRD sections) and create corresponding beads epics, tasks, and features with proper fields, priorities, and dependency chains.

## Conversion Rules

### PMS Output → Beads Type Mapping

| PMS Artifact | Beads Type | Title Source | Description Source | Extra Fields |
|---|---|---|---|---|
| epic-hypothesis | epic | Epic title | If/Then hypothesis | design: validation+metrics |
| user-story | task | "US-N: Summary" | As a/I want/so that | acceptance: Gherkin |
| user-story-splitting | task | Split story title | Split rationale + story | parent dep |
| epic-breakdown-advisor | task | Vertical slice title | Slice description | parent dep |
| discovery-process Phase1 | feature | "[Discovery] area" | Problem hypothesis | notes: research Qs |
| discovery-process Phase5 | task | "[Experiment] name" | PoL probe method | acceptance: validation criteria |
| roadmap-planning Phase2 | epic | Epic title | Hypothesis statement | priority: Now/Next/Later mapped |
| prd-development | epic | PRD title | Executive summary | notes: PRD file path |
| problem-statement | (enriches epic) | — | Appended to description | — |
| positioning-statement | (enriches epic) | — | Appended to notes | — |

### Priority Mapping

```
Now  (current quarter, committed)  → P1 (--priority=1)
Next (next quarter, high conf)     → P2 (--priority=2)
Later (future, low conf)           → P3 (--priority=3)
Backlog (unassigned)               → P4 (--priority=4)
Critical (urgent)                  → P0 (--priority=0)
```

## Conversion Procedures

### Epic Hypothesis → Beads Epic

Extract from PMS `epic-hypothesis` output:

```bash
bd create --type=epic \
  --title="<epic title>" \
  --description="If we <action> for <persona>, then we will <outcome>" \
  --design="Experiment: <tiny acts of discovery> | Metric: <validation measures>" \
  --priority=<mapped priority>
```

Parse the If/Then structure:
- **"If we"** section → description (action/solution)
- **"for"** section → description (target persona)
- **"Then we will"** section → description (expected outcome)
- **"Tiny Acts of Discovery"** section → design field
- **"Validation Measures"** section → design field

### User Story → Beads Task

Extract from PMS `user-story` output:

```bash
bd create --type=task \
  --title="US-<N>: <summary>" \
  --description="As a <persona>, I want to <action>, so that <outcome>" \
  --acceptance="Scenario: <desc> | Given <context> When <trigger> Then <result>"
```

Parse Mike Cohn + Gherkin structure:
- **"As a / I want to / so that"** → description
- **"Scenario / Given / When / Then"** → acceptance field
- If parent epic exists → `bd dep add <task-id> <epic-id>`

### User Story Splitting → Beads Sub-Tasks

After PMS `user-story-splitting` produces split stories:

For each split story:
```bash
bd create --type=task \
  --title="<split story title>" \
  --description="<split rationale + story content>"
bd dep add <new-task-id> <parent-epic-id>
```

### Epic Breakdown → Beads Sub-Tasks

After PMS `epic-breakdown-advisor` produces split stories:

For each vertical slice:
```bash
bd create --type=task \
  --title="<slice title>" \
  --description="<slice description with split pattern used>"
bd dep add <new-task-id> <parent-epic-id>
```

### Roadmap → Beads Epic Group

After PMS `roadmap-planning` Phase 2 produces epics:

For each roadmap epic:
```bash
bd create --type=epic \
  --title="<epic title>" \
  --description="<hypothesis statement>" \
  --design="<validation method + success metric>" \
  --priority=<1 for Now, 2 for Next, 3 for Later>
```

Set inter-epic dependencies based on sequencing:
```bash
bd dep add <dependent-epic> <prerequisite-epic>
```

### PRD → Beads Epic + Tasks

After PMS `prd-development` completes:

Create the parent epic from executive summary:
```bash
bd create --type=epic \
  --title="<PRD title>" \
  --description="<executive summary + problem statement>" \
  --design="<success metrics and targets>" \
  --notes="PRD file: .planning/prd-<name>.md"
```

Then create tasks from Phase 7 user stories (see User Story conversion above).

### Enriching Existing Epics

When `problem-statement` or `positioning-statement` outputs are produced for an existing epic:

```bash
# Append problem statement to epic description
bd update <epic-id> --description="<existing description>\n\nProblem: <problem statement>"

# Append positioning to epic notes
bd update <epic-id> --notes="<existing notes>\n\nPositioning: <positioning statement>"
```

### Discovery → Beads Feature + Experiment Tasks

After PMS `discovery-process`:
1. Phase 1 output → `bd create --type=feature` (problem hypothesis)
2. Phase 5 outputs → `bd create --type=task` per experiment
3. Link experiments to feature: `bd dep add <experiment> <feature>`

## Duplicate Prevention

Before creating any issue, search for existing matches:

```bash
bd search "<title keywords>"
```

Skip creation if a matching issue already exists. Warn if a similar but not identical issue is found.

## Post-Conversion Output

After all conversions, produce a summary table:

```
Created Issues:
| ID | Type | Title | Priority | Depends On |
|----|------|-------|----------|------------|
| pm-10 | epic | Guided Onboarding | P1 | — |
| pm-10.1 | task | US-1: Google Login | — | pm-10 |
| pm-10.2 | task | US-2: Checklist UI | — | pm-10 |
```
