---
name: sync
description: 기존 PMS 산출물 파일을 beads 이슈로 일괄 변환한다. .planning/ 디렉토리의 PRD, epic hypothesis, user story 등의 파일을 스캔하여 beads에 생성한다.
argument-hint: "[directory path, defaults to .planning/]"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Write
  - Skill
---

# /pm:sync — Existing PMS Artifacts → Beads Issues

Scan existing PMS output files and batch-convert them to beads issues.

## Workflow

### Step 1: Scan for PMS Artifacts

Search the target directory (default: `.planning/`) for PMS output files:

```bash
# Look for known PMS artifact patterns
```

Identify file types by content structure:
- **Epic hypothesis**: Contains "If we ... for ... Then we will" pattern
- **User story**: Contains "As a ... I want to ... so that" + Gherkin criteria
- **PRD**: Contains structured sections (Executive Summary, Problem Statement, User Stories)
- **Discovery**: Contains "Problem hypothesis" + research questions
- **Roadmap**: Contains Now/Next/Later categorization with multiple epics

### Step 2: Duplicate Check

For each detected artifact, check if it already exists in beads:
```bash
bd search "<artifact title keywords>"
```

Skip artifacts that already have matching beads issues. Report skipped items.

### Step 3: Batch Convert

Apply `beads-bridge` conversion rules for each artifact type. Process in order:
1. Epics first (from roadmaps, PRDs, epic hypotheses)
2. Features (from discovery outputs)
3. Tasks (from user stories, epic breakdowns)
4. Dependencies last (link tasks to parent epics/features)

### Step 4: Summary

Output conversion report:
```
Sync Results:
  Scanned: <N> files
  Created: <N> issues (X epics, Y features, Z tasks)
  Skipped: <N> (already exist)
  Dependencies: <N> links created
```
