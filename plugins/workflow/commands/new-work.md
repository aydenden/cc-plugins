---
description: Create beads issues from natural language prompts - analyzes work description and automatically generates appropriate epic/task/subtask structure with dependencies
argument-hint: '"work description"'
allowed-tools:
  - AskUserQuestion
  - Bash
  - Read
  - Skill
---

# /new-work Command

This command transforms natural language work descriptions into structured beads issues (epic/task/subtask) with automatic dependency detection.

## Usage

```bash
/new-work "FRED API 통합하고, 캐싱 레이어 추가해야 함. 테스트도 필요함."
```

The argument should be a natural description of the work to be done. Explain what needs to be accomplished without worrying about structure - the command will analyze and organize it.

## Processing Steps

### Step 1: Analyze the Prompt

Analyze the user's work description to identify:

1. **Number of tasks**: How many distinct pieces of work?
2. **Dependencies**: Are tasks sequential or independent?
3. **Scope**: Small (single task), medium (multiple tasks), large (epic-level)?
4. **Specifics**: Technical details, requirements, constraints mentioned

**Example analysis:**
```
Input: "FRED API 통합하고, 캐싱 레이어 추가해야 함. JWT 인증 사용. 테스트 필요."

Analysis:
- 3 tasks identified: API integration, caching, testing
- Sequential dependency: API → caching → testing
- Scope: Medium (multiple related tasks)
- Technical details: JWT authentication, caching layer
- Recommendation: 1 Epic + 3 Tasks
```

### Step 2: Propose Structure

Based on analysis, propose an appropriate structure:

**Task only** (1 simple task):
```
Task: "Implement feature X"
```

**Task + Subtasks** (1 complex task with steps):
```
Task: "Implement feature X"
├─ Subtask: "Step 1"
├─ Subtask: "Step 2"
└─ Subtask: "Step 3"
```

**Epic + Tasks** (2-4 related tasks):
```
Epic: "Feature X implementation"
├─ Task: "Component A"
├─ Task: "Component B"
└─ Task: "Component C"
```

**Epic + Tasks + Subtasks** (5+ tasks or complex hierarchy):
```
Epic: "Major feature X"
├─ Task: "Phase 1"
│   ├─ Subtask: "Step 1.1"
│   └─ Subtask: "Step 1.2"
└─ Task: "Phase 2"
    └─ Subtask: "Step 2.1"
```

### Step 3: Ask Clarifying Questions

Use AskUserQuestion to clarify ambiguities. Ask 1-3 questions about:

**Q1: Structure confirmation** (always ask)
```
header: "구조"
question: "이 작업을 어떻게 나눌까요?"
options:
  - Epic 1개 + Task 3개 (추천)
  - Task 1개 + Subtask 3개
  - Task 3개 (독립적으로)
```

**Q2: Technical choices** (when technology/approach is ambiguous)
```
header: "기술 선택"
question: "캐싱 방식은?"
options:
  - Redis (추천)
  - In-memory
  - 나중에 결정
```

**Q3: Priority** (always ask)
```
header: "우선순위"
question: "작업 우선순위는?"
options:
  - 1 (높음)
  - 2 (보통) - 기본값
  - 3 (낮음)
```

**Important:** Keep questions minimal (1-3 max). Don't over-ask. Use recommendations to guide user toward good defaults.

### Step 4: Generate bd Commands

Based on user answers, construct appropriate `bd` commands:

**For Epic + Tasks:**
```bash
# Create epic
bd create "Epic title" -t epic \
  --design "Brief design approach" \
  -p 2 --json

# Create tasks under epic
bd create "Task 1 title" \
  --parent <epic-id> \
  --design "Task 1 approach" \
  -p 2 --json

bd create "Task 2 title" \
  --parent <epic-id> \
  --design "Task 2 approach" \
  -p 2 --json

# Add dependencies (separate commands)
bd dep add <task2-id> <task1-id>  # Task 2 depends on Task 1
```

**For Task + Subtasks:**
```bash
# Create parent task
bd create "Parent task title" \
  --design "Overall approach" \
  -p 2 --json

# Create subtasks
bd create "Subtask 1" \
  --parent <parent-id> \
  --design "Subtask 1 approach" \
  -p 2 --json

bd create "Subtask 2" \
  --parent <parent-id> \
  --design "Subtask 2 approach" \
  -p 2 --json

# Add dependencies (separate commands)
bd dep add <subtask2-id> <subtask1-id>  # Subtask 2 depends on Subtask 1
```

**Design field guidelines:**
- Keep Design field SHORT (1-3 lines per workflow-skills convention)
- Extract key approach from user's description
- If approach is complex, note "TBD" or create doc reference
- Follow workflow-skills conventions for all fields

### Step 5: Execute Commands

Execute the generated `bd` commands using the Bash tool:

1. Run each `bd create` command sequentially with `--json` flag
2. Parse JSON output to capture issue IDs
3. Use captured IDs for parent linking (--parent) and dependency creation
4. After all issues created, add dependencies with `bd dep add` commands
5. Handle errors gracefully (see Error Handling section)

**Example execution:**
```bash
# Create epic
bd create "FRED API Pipeline" -t epic --design "JWT auth → caching → tests" -p 2 --json
# Parse JSON, capture: bd-42

# Create tasks
bd create "Implement JWT auth" --parent bd-42 --design "JWT + bcrypt" -p 2 --json
# Parse JSON, capture: bd-43

bd create "Add Redis cache" --parent bd-42 --design "Redis, 1hr TTL" -p 2 --json
# Parse JSON, capture: bd-44

bd create "Write tests" --parent bd-42 -p 2 --json
# Parse JSON, capture: bd-45

# Add dependencies
bd dep add bd-44 bd-43  # Cache depends on auth
bd dep add bd-45 bd-44  # Tests depend on cache
```

### Step 6: Display Results

Present results in a tree structure showing:
- Created issues with IDs
- Parent-child relationships
- Dependency chains (blocked-by)
- Status of each issue (ready/blocked)
- Next action suggestion

**Output format:**
```
✅ 생성 완료:

Epic #42: FRED API Pipeline
├─ Task #43: Implement JWT auth (ready)
├─ Task #44: Add Redis cache (blocked by #43)
└─ Task #45: Write tests (blocked by #44)

다음 작업: bd show 43
```

**Tree symbols:**
- `├─` for items with siblings below
- `└─` for last item
- `│` for vertical continuation
- Indent 3 spaces per level

## Error Handling

When `bd` commands fail:

1. **Display error message clearly:**
   ```
   ❌ 에러 발생: Task 생성 실패

   Error: bd: command not found
   ```

2. **Provide manual commands:**
   ```
   수동으로 실행하세요:

   bd create "Epic title" -t epic --design "..." -p 2 --json
   bd create "Task title" --parent bd-XX --design "..." -p 2 --json
   bd dep add bd-YY bd-XX  # Add dependencies
   ```

3. **Do not retry automatically** - let user investigate and fix

4. **Common errors:**
   - `bd: command not found` → beads not installed
   - `Invalid issue ID` → Issue doesn't exist, check ID
   - `Permission denied` → Check repository permissions

## Field Conventions

Follow workflow-skills conventions when generating issues:

- **Title**: 동사 + 구체적 명사 (e.g., "Implement JWT auth")
- **Design**: 1-3 lines max (e.g., "JWT + bcrypt hashing")
- **Priority**: Use user's choice from Q3 (default: 2)
- **Dependencies**: Add with `bd dep add` after creating issues
- **Acceptance**: Can be added later (not critical for creation)

Refer to workflow-skills for detailed field guidelines.

## Examples

### Example 1: Simple Task

**Input:**
```
/new-work "Fix login bug - special characters break validation"
```

**Analysis:**
- 1 simple task
- No dependencies
- Small scope

**Questions:**
1. Structure: Task only
2. Priority: 1 (bug fix, urgent)

**Output:**
```
✅ 생성 완료:

Task #50: Fix login with special chars (ready)

다음 작업: bd show 50
```

### Example 2: Epic with Tasks

**Input:**
```
/new-work "사용자 인증 시스템 구축. JWT 사용하고, refresh token도 필요함. 테스트 필수."
```

**Analysis:**
- 3 tasks: auth system, refresh tokens, tests
- Sequential dependencies
- Medium scope

**Questions:**
1. Structure: Epic + 3 Tasks (recommended)
2. Tech: JWT confirmed, refresh tokens confirmed
3. Priority: 2 (normal)

**Output:**
```
✅ 생성 완료:

Epic #60: User Authentication System
├─ Task #61: Implement JWT auth (ready)
├─ Task #62: Add refresh token (blocked by #61)
└─ Task #63: Write auth tests (blocked by #62)

다음 작업: bd show 61
```

### Example 3: Complex Hierarchy

**Input:**
```
/new-work "E-commerce 결제 시스템. PG 연동, 주문 관리, 배송 추적, 환불 처리 모두 필요."
```

**Analysis:**
- 4+ major tasks
- Each task has substeps
- Large scope

**Questions:**
1. Structure: Epic + Tasks + Subtasks
2. PG choice: 나중에 결정
3. Priority: 2

**Output:**
```
✅ 생성 완료:

Epic #70: E-commerce Payment System
├─ Task #71: PG Integration (ready)
│   ├─ Subtask #72: API research
│   └─ Subtask #73: Payment flow
├─ Task #74: Order Management (blocked by #71)
├─ Task #75: Delivery Tracking (blocked by #74)
└─ Task #76: Refund Processing (blocked by #71)

다음 작업: bd show 71
```

## Tips

- **Be liberal with input**: Accept any natural description
- **Analyze carefully**: Identify all tasks and dependencies
- **Ask minimal questions**: 1-3 max, use good defaults
- **Generate short Design fields**: Follow 1-3 line rule
- **Execute reliably**: Handle errors gracefully
- **Display clearly**: Use tree structure for visibility

This command should make beads issue creation effortless - users describe work naturally, and the command handles all structuring and creation.
