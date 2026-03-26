---
name: prd
description: PRD를 작성하고 beads epic + task로 자동 변환한다. PMS prd-development 스킬을 실행한 후, Problem Statement는 epic으로, User Stories는 task로 beads에 생성한다.
argument-hint: "<feature or initiative, e.g. 팀 인박스 리디자인>"
allowed-tools:
  - Bash
  - Read
  - Write
  - Skill
---

# /pm:prd — PRD → Beads Epic + Tasks

Execute PRD development workflow and convert outputs to beads issues.

## Workflow

### Step 1: Run PMS PRD Development

Use the Skill tool to invoke PMS skills (installed via `deanpeters/Product-Manager-Skills` marketplace):

```
Skill("prd-development")
```

This is an interactive workflow with 8 phases:

1. **Phase 1**: Executive Summary
2. **Phase 2**: Problem Statement — internally uses `Skill("problem-statement")`
3. **Phase 3**: Target Users & Personas — internally uses `Skill("proto-persona")`
4. **Phase 4**: Strategic Context
5. **Phase 5**: Solution Overview
6. **Phase 6**: Success Metrics
7. **Phase 7**: User Stories & Requirements — internally uses `Skill("user-story")`
8. **Phase 8**: Out of Scope, Dependencies, Risks

The PMS `workshop-facilitation` protocol handles all user interaction.

### Step 2: Save PRD Document

Write the completed PRD to a file:
```
.planning/prd-<feature-name>.md
```

### Step 3: Create Beads Epic

From Phase 1-2 outputs:
```bash
bd create --type=epic \
  --title="<PRD title>" \
  --description="<executive summary + problem statement>" \
  --design="<success metrics and targets>" \
  --notes="PRD: .planning/prd-<name>.md"
```

### Step 4: Create Beads Tasks from User Stories

From Phase 7 outputs, for each user story:
```bash
bd create --type=task \
  --title="US-<N>: <summary>" \
  --description="As a <persona>, I want to <action>, so that <outcome>" \
  --acceptance="Scenario: <desc> | Given <context> When <trigger> Then <result>"
bd dep add <task-id> <epic-id>
```

### Step 5: Summary

Output created epic and tasks with IDs and dependency tree.
