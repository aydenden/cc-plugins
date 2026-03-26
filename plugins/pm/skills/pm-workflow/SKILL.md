---
name: pm-workflow
description: This skill should be used when the user asks about PM work such as "plan a roadmap", "write a PRD", "break down epic", "run discovery", "prioritize features", "sync to beads", "로드맵 짜줘", "PRD 써줘", "에픽 쪼개줘", "디스커버리 해줘", "우선순위 정해줘", or "이슈로 변환해줘". Routes to the appropriate /pm:* command that combines PMS skills with automatic beads issue tracking.
---

## Purpose

Detect PM workflow context and route to the correct `/pm:*` command. Act as the entry point that connects PMS (Product-Manager-Skills) interactive workflows with beads issue tracking.

## Routing Table

| User Intent | Trigger Phrases | Route To |
|---|---|---|
| Roadmap planning | "plan roadmap", "로드맵 짜줘", "quarterly plan", "분기 계획" | `/pm:plan` |
| PRD writing | "write PRD", "PRD 써줘", "product requirements", "요구사항 정의" | `/pm:prd` |
| Epic breakdown | "break down epic", "에픽 쪼개줘", "split stories", "스토리 분할" | `/pm:breakdown` |
| Discovery | "run discovery", "디스커버리", "problem exploration", "문제 탐색" | `/pm:discover` |
| Prioritization | "prioritize features", "우선순위 정해줘", "what to build next", "어떤 기능부터" | `/pm:plan` |
| Convert to issues | "sync to beads", "이슈로 변환", "beads로 옮겨", "create issues" | `/pm:sync` |

## Workflow

1. Identify user intent from conversation context
2. Suggest the matching `/pm:*` command with a brief explanation
3. If intent is ambiguous, present options:

Example output when intent is ambiguous:
```
PM 워크플로우를 감지했습니다. 어떤 작업을 진행할까요?

1. /pm:plan      — 로드맵 계획 → beads epic 생성
2. /pm:prd       — PRD 작성 → epic + task 생성
3. /pm:discover  — 디스커버리 → feature + 실험 task
4. /pm:breakdown — 에픽 분해 → sub-task 생성
5. /pm:sync      — 기존 산출물 → beads 일괄 변환
```

## Prerequisites Check

Before routing, verify dependencies are available:
- PMS skills installed (epic-hypothesis, user-story, roadmap-planning etc.)
- Beads CLI (`bd`) available
- `.beads/` initialized in project

If any dependency is missing, provide installation guidance:
```
PMS: /plugin marketplace add deanpeters/Product-Manager-Skills
Beads CLI: npm i -g @beads-cli/beads
Beads init: bd init
```
