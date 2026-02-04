---
name: workflow-skills
description: Beads field conventions (Title, Design, Acceptance, Notes) for "/new-work" command and issue creation
version: 0.1.0
---

# Beads Workflow - 필드 작성 규약

## Overview

This skill provides conventions for writing beads issue fields (Title, Description, Design, Acceptance, Notes) and guidelines for when to create separate documentation. Use these conventions when creating or updating beads issues to maintain consistency.

## Field Guidelines

### Title

**Format:** 동사 + 구체적 명사

✅ Good examples:
- "Implement JWT authentication"
- "Add Redis caching layer"
- "Fix API timeout on large datasets"

❌ Bad examples:
- "Auth" (너무 모호)
- "Caching stuff" (불명확)
- "Bug fix" (구체적이지 않음)

### Description

**Purpose:** Problem statement, context, why it matters

Structure the description in three parts:
1. **문제 정의**: What problem exists
2. **배경/컨텍스트**: Why this matters
3. **영향**: Expected impact when resolved

Example:
```
현재 API 응답이 10초 이상 걸림

사용자 100명 이상일 때 DB 쿼리가 N+1 발생
사용자 이탈률 증가 중

캐싱 추가하면 응답 시간 <1초 가능
```

### Design ⭐ CRITICAL

**Purpose:** Approach, architecture, trade-offs
**Key rule:** Keep it SHORT (1-3 lines)
**Nature:** Can change during implementation

✅ Recommended (one line):
```
"JWT auth + bcrypt hashing"
"Redis cache, 1hr TTL"
"3-stage pipeline: parse → transform → save"
```

⚠️ Maximum 3 lines:
```
"Architecture: 3-layer
- Parser: API → DTO
- Cache: Redis (1hr TTL)
- Persist: PostgreSQL"
```

❌ DO NOT do this:
```
# 20-line detailed design doc in Design field
```

**When Design exceeds 3 lines:** Create a document and reference it:
```
"3-layer pipeline: parse → transform → save
Details: docs/design/2025-02-04-api-pipeline.md"
```

### Acceptance Criteria

**Purpose:** Outcomes, success criteria
**Nature:** Should be stable (not change frequently)
**Format:** Checklist

Example:
```
- [ ] All unit tests pass
- [ ] Integration test coverage >80%
- [ ] API response time <100ms
- [ ] Security audit complete
```

Structure as testable conditions that define when work is complete.

### Notes

**Purpose:** Implementation details, session handoffs
**Nature:** Evolves over time (continuously updated)

**Format:**
```
YYYY-MM-DD HH:MM
COMPLETED: [what was done]
FOUND: [discoveries/issues]
DECISION: [decisions made]
BLOCKED: [blockers encountered]
NEXT: [next steps]

---
(previous notes)
```

**Example:**
```
2025-02-04 15:30
COMPLETED: JWT 인증 로직 구현
FOUND: bcrypt 기본 rounds 너무 느림 (300ms)
DECISION: rounds=10으로 조정 (50ms)
NEXT: 통합 테스트 작성

---
2025-02-04 10:00
COMPLETED: 라이브러리 조사
DECISION: jsonwebtoken + bcrypt 선택
NEXT: 인증 로직 구현
```

Use Notes for continuous progress tracking and handoffs between sessions.

### Priority

- **0**: Critical (system down, security issues)
- **1**: High (urgent, blockers)
- **2**: Normal (regular work, default)
- **3**: Low (improvements, optimizations)
- **4**: Someday (nice-to-have)

## Documentation Guidelines

### When Design Field is Sufficient

Most cases - use Design field when:
- Implementation approach is clear
- Can explain in 3 lines or less
- Following established patterns

### When to Create Documentation

Create separate docs when:
- Design field would exceed 3 lines
- Diagrams or sequence charts needed
- Multiple issues reference same design
- Decision rationale is important

### Documentation Structure

```
docs/
├── design/           # Design documents
│   └── 2025-02-04-feature-name.md
├── decisions/        # Decision records (ADR)
│   └── 2025-02-04-decision.md
└── plans/           # Implementation plans
    └── 2025-02-04-plan.md
```

### Linking Documentation in Design Field

```
"3-layer pipeline: parse → transform → save
Spec: docs/design/2025-02-04-pipeline.md"
```

Use relative paths from project root.

## Field Role Summary

| Field | Purpose | Length | Stability |
|-------|---------|--------|-----------|
| **Title** | What | One line | Rarely changes |
| **Description** | Why | ~5 lines | Rarely changes |
| **Design** | How | **1-3 lines** | Changes often |
| **Acceptance** | Done criteria | Checklist | Stable |
| **Notes** | Progress | Continuous | Always evolving |

## Checklists

### When Creating Issue

- [ ] Title: 동사 + 구체적 명사?
- [ ] Description: 왜 필요한지 설명?
- [ ] Design: **3줄 이하?** (길면 문서화)
- [ ] Acceptance: 완료 조건 명확?

### Before Starting Work

- [ ] Read Description - understand purpose?
- [ ] Check Design (read linked docs if present)
- [ ] Review Acceptance criteria
- [ ] Verify no dependencies blocking work (blocked-by)

### During Work

- [ ] Update Notes with progress?
- [ ] Update Design if approach changes?
- [ ] Note new blockers if discovered?

### Before Completing

- [ ] All Acceptance criteria checked?
- [ ] Final state recorded in Notes?
- [ ] Related documentation updated?

## Key Principles

1. **Design field brevity**: 1-3 lines max, document separately if longer
2. **Progressive documentation**: Start with Design field, create docs only when needed
3. **Continuous Notes updates**: Track progress for session handoffs
4. **Stable Acceptance**: Define clear completion criteria upfront
5. **Clear Titles**: Action-oriented, specific

Use these conventions with the `/new-work` command for consistent issue creation across all beads workflows.
