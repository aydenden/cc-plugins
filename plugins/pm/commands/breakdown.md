---
name: breakdown
description: 에픽을 유저 스토리(태스크)로 분해하고 beads sub-task로 변환한다. PMS epic-breakdown-advisor 스킬로 INVEST 체크 + 9개 분할 패턴을 적용한 후, 각 vertical slice를 beads task로 생성한다.
argument-hint: "<beads epic ID, e.g. pm-10>"
allowed-tools:
  - Bash
  - Read
  - Write
  - Skill
---

# /pm:breakdown — Epic Breakdown → Beads Sub-Tasks

Break down an existing beads epic into smaller tasks using PMS splitting patterns.

## Workflow

### Step 1: Load Target Epic

Fetch the epic details from beads:
```bash
bd show <epic-id>
```

Extract title, description, design, and acceptance criteria to provide as context.

### Step 2: Run PMS Epic Breakdown Advisor

Use the Skill tool to invoke PMS skills (installed via `deanpeters/Product-Manager-Skills` marketplace):

```
Skill("epic-breakdown-advisor")
```

Provide the epic context from Step 1. This is an interactive flow:

1. **Step 0**: Provide epic context (title, description, acceptance criteria)
2. **Step 1**: Pre-Split Validation (INVEST check — Independent, Negotiable, Valuable, Estimable, Testable)
3. **Step 2**: Apply 9 splitting patterns sequentially:
   - Workflow Steps, Operations (CRUD), Business Rule Variations
   - Data Variations, Data Entry Methods, Major Effort
   - Simple/Complex, Defer Performance, Break Out a Spike
4. **Step 3**: Evaluate splits (choose the split revealing most low-value work)

The PMS `workshop-facilitation` protocol handles all user interaction.

### Step 3: Create Beads Sub-Tasks

For each vertical slice produced by the breakdown:
```bash
bd create --type=task \
  --title="<slice title>" \
  --description="<slice description including which split pattern was applied>"
bd dep add <new-task-id> <parent-epic-id>
```

If the breakdown also identifies user stories (via `user-story` or `user-story-splitting`), apply the user story conversion from `beads-bridge`:
```bash
bd create --type=task \
  --title="US-<N>: <summary>" \
  --description="As a <persona>, I want to <action>, so that <outcome>" \
  --acceptance="Given <context> When <trigger> Then <result>"
bd dep add <task-id> <parent-epic-id>
```

### Step 4: Summary

Output the task tree under the parent epic:
```
Epic: <epic-id> <title>
  ├─ <task-id>: <task title>
  ├─ <task-id>: <task title>
  └─ <task-id>: <task title>
```

Suggest: `bd ready` to see which tasks are unblocked and ready to work.
