---
name: plan
description: 로드맵을 계획하고 beads epic으로 자동 변환한다. PMS roadmap-planning + epic-hypothesis 스킬을 실행한 후, 산출물을 beads epic 이슈로 일괄 생성한다.
argument-hint: "<time horizon and goals, e.g. Q3 로드맵 - 온보딩 개선 + 엔터프라이즈 확장>"
allowed-tools:
  - Bash
  - Read
  - Write
  - Skill
---

# /pm:plan — Roadmap → Beads Epics

Execute a full roadmap planning workflow that produces beads epics.

## Workflow

### Step 1: Context Gathering

Collect current project state:

```bash
bd stats
bd list --status=open
```

Review existing epics and open issues to avoid duplication.

### Step 2: Run PMS Roadmap Planning

Use the Skill tool to invoke PMS skills (installed via `deanpeters/Product-Manager-Skills` marketplace):

```
Skill("roadmap-planning")
```

This is an interactive workflow with 5 phases:

1. **Phase 1**: Gather inputs (business goals, customer problems, tech constraints)
2. **Phase 2**: Define initiatives as epic hypotheses
3. **Phase 3**: Prioritize (Now / Next / Later)
4. **Phase 4**: Sequence with dependencies
5. **Phase 5**: Communicate roadmap narrative

The PMS `workshop-facilitation` protocol handles all user interaction — one question at a time, progress tracking, numbered options.

For each epic defined in Phase 2, also invoke:
```
Skill("epic-hypothesis")
```
to produce the If/Then hypothesis structure.

### Step 3: Convert to Beads

After the roadmap is finalized (user has confirmed through PMS interactive flow), apply the `beads-bridge` skill conversion rules:

For each epic:
```bash
bd create --type=epic \
  --title="<epic title>" \
  --description="If we <action> for <persona>, then we will <outcome>" \
  --design="Experiment: <validation method> | Metric: <success measure>" \
  --priority=<1 for Now, 2 for Next, 3 for Later>
```

For epic dependencies identified in Phase 4:
```bash
bd dep add <dependent-epic> <dependency-epic>
```

### Step 4: Summary

Output a summary table of all created epics with IDs, priorities, and dependencies.

Suggest next step: `/pm:breakdown <epic-id>` to decompose the highest-priority epic into tasks.
