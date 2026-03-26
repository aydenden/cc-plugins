---
name: discover
description: 디스커버리 프로세스를 실행하고 beads feature + 실험 task로 변환한다. PMS discovery-process 스킬을 실행한 후, Problem hypothesis는 feature로, 검증 실험은 task로 생성한다.
argument-hint: "<problem area, e.g. 온보딩 이탈률 감소>"
allowed-tools:
  - Bash
  - Read
  - Write
  - Skill
---

# /pm:discover — Discovery → Beads Feature + Tasks

Execute a discovery cycle and convert outputs to beads issues.

## Workflow

### Step 1: Run PMS Discovery Process

Use the Skill tool to invoke PMS skills (installed via `deanpeters/Product-Manager-Skills` marketplace):

```
Skill("discovery-process")
```

This is an interactive workflow with 6 phases:

1. **Phase 1**: Frame the Problem — uses `Skill("problem-framing-canvas")`, `Skill("problem-statement")`, `Skill("proto-persona")`
2. **Phase 2**: Research Planning — uses `Skill("discovery-interview-prep")`
3. **Phase 3**: Conduct Research
4. **Phase 4**: Synthesize Insights — uses `Skill("opportunity-solution-tree")`
5. **Phase 5**: Validate Solutions — uses `Skill("pol-probe-advisor")`
6. **Phase 6**: Decide & Document

The PMS `workshop-facilitation` protocol handles all user interaction.

### Step 2: Create Beads Feature

From Phase 1 output (problem hypothesis):
```bash
bd create --type=feature \
  --title="[Discovery] <problem area>" \
  --description="Problem hypothesis: We believe <persona> struggles with <problem> because <root cause>" \
  --notes="Research questions: <3-5 questions from Phase 1>"
```

### Step 3: Create Experiment Tasks

From Phase 5 output (validation experiments), for each experiment:
```bash
bd create --type=task \
  --title="[Experiment] <experiment name>" \
  --description="PoL probe: <method description>" \
  --acceptance="<validation criteria: what success looks like>"
bd dep add <experiment-task> <feature-id>
```

### Step 4: Summary

Output created feature and experiment tasks with dependency tree.

Suggest next step: after experiments complete, use `/pm:plan` or `/pm:prd` to build on validated insights.
