# cc-deep-tutor 마크다운 위키 전환 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** cc-deep-tutor의 KB를 memsearch(Milvus 벡터검색)에서 마크다운 위키 + 파일검색(grep/glob/frontmatter scan)으로 전환하고, 검색·집필을 OC에 완전 위임 가능한 구조로 만든다.

**Architecture:** 노트는 frontmatter(코어 4대 검색필드 + 종류별 확장)를 강제하는 템플릿으로 작성된다. 검색은 kb-search SKILL.md가 정의하는 6단계 절차(키워드추출 → grep summary/tags ∥ glob → read 후보 → 백링크 → INDEX fallback)다. PostToolUse hook이 INDEX.md를 자동 갱신하고 태그 레지스트리를 검증한다. OC `analyze`/`research` 프로파일이 glob/grep을 직접 수행함이 실측 확인됐으므로(2026-06-02), CC는 토픽 분류만 하고 OC 워커가 검색+웹조사+집필을 전담한다.

**Tech Stack:** Bash(hook, extract), Markdown(템플릿/skill/agent), cc-opencode-cmux delegate-oc(OC 위임), bats 또는 순수 bash assert(테스트).

**선행 설계:** `docs/plans/2026-06-02-deep-tutor-markdown-wiki-design.md`

---

## 진행 원칙
- 각 task 후 커밋. Conventional Commits, 한국어 body 허용.
- 테스트 가능한 산출물(update-index.sh, 템플릿 검증)은 TDD. .md 프롬프트 산출물은 grep 기반 검증 단계로 대체.
- memsearch는 이미 optional(graceful skip)이라 단계별로 안전하게 제거 가능.
- 작업 브랜치 권장: `feat/deep-tutor-md-wiki` (현재 main 직접 커밋 관행이면 협의).

---

## Phase 1 — 인덱스/태그 Hook (테스트 가능 단위 먼저)

### Task 1: 테스트 픽스처 + update-index.sh 테스트 골격

**Files:**
- Create: `plugins/cc-deep-tutor/tests/fixtures/notes/transformer-attention.md`
- Create: `plugins/cc-deep-tutor/tests/fixtures/_wiki/tags.md`
- Create: `plugins/cc-deep-tutor/tests/update-index.test.sh`

**Step 1: 픽스처 노트 작성**

```markdown
---
id: transformer-attention
type: research
title: 트랜스포머 어텐션
summary: 트랜스포머의 self-attention 메커니즘 정의와 변형
tags: [attention, transformer]
source: derived
date: 2026-06-02
---
# 트랜스포머 어텐션
## 요약
...
```

`tags.md` 픽스처:
```markdown
# Tag Registry
- attention — 어텐션 메커니즘
- transformer — 트랜스포머 아키텍처
```
(주의: `transformer-attention.md`는 `transformer` 태그를 쓰지만, 미등록 태그 경고 테스트용으로 별도 픽스처 `bad-tag.md`에 `tags: [unregistered_xyz]` 포함.)

**Step 2: 실패 테스트 작성** (`update-index.test.sh`)

```bash
#!/usr/bin/env bash
set -u
SCRIPT="$(dirname "$0")/../hooks/update-index.sh"
FIX="$(dirname "$0")/fixtures"
FAILS=0
assert() { if eval "$2"; then echo "PASS: $1"; else echo "FAIL: $1"; FAILS=$((FAILS+1)); fi; }

WORK="$(mktemp -d)"; cp -r "$FIX/." "$WORK/"
# INDEX.md 생성 테스트
"$SCRIPT" "$WORK/notes/transformer-attention.md" "$WORK"
assert "INDEX.md 생성됨" "test -f '$WORK/_wiki/INDEX.md'"
assert "INDEX에 id 줄 포함" "grep -q 'transformer-attention' '$WORK/_wiki/INDEX.md'"
assert "INDEX에 summary 포함" "grep -q 'self-attention' '$WORK/_wiki/INDEX.md'"
# 미등록 태그 경고 테스트
OUT="$("$SCRIPT" "$WORK/notes/bad-tag.md" "$WORK" 2>&1)"
assert "미등록 태그 경고" "echo \"\$OUT\" | grep -q '미등록 태그'"
rm -rf "$WORK"
[ "$FAILS" -eq 0 ]
```

**Step 3: 테스트 실행 → 실패 확인**

Run: `bash plugins/cc-deep-tutor/tests/update-index.test.sh`
Expected: FAIL (update-index.sh 없음 → "No such file")

**Step 4: 커밋**

```bash
git add plugins/cc-deep-tutor/tests/
git commit -m "test(cc-deep-tutor): update-index hook 테스트 픽스처/골격 추가"
```

---

### Task 2: update-index.sh 구현

**Files:**
- Create: `plugins/cc-deep-tutor/hooks/update-index.sh`

**Step 1: 최소 구현**

```bash
#!/usr/bin/env bash
# update-index.sh <note-path> <materials-root>
# 노트 frontmatter를 파싱해 _wiki/INDEX.md를 갱신하고, tags.md 미등록 태그를 경고.
set -euo pipefail
NOTE="${1:?note path}"; ROOT="${2:?materials root}"
WIKI="$ROOT/_wiki"; INDEX="$WIKI/INDEX.md"; TAGREG="$WIKI/tags.md"
mkdir -p "$WIKI"

# --- frontmatter 추출 (--- 사이) ---
fm() { sed -n '/^---$/,/^---$/p' "$NOTE"; }
field() { fm | grep -m1 "^$1:" | sed "s/^$1:[[:space:]]*//"; }
ID="$(field id)"; TYPE="$(field type)"; TAGS="$(field tags)"; SUMMARY="$(field summary)"
[ -n "$ID" ] || { echo "⚠ id 없음: $NOTE" >&2; exit 0; }

# --- INDEX.md 갱신 (id 줄 교체 또는 추가) ---
[ -f "$INDEX" ] || printf '# KB Index (auto-generated — 직접 편집 금지)\n' > "$INDEX"
LINE="- $ID | $TYPE | $TAGS | $SUMMARY"
if grep -q "^- $ID |" "$INDEX"; then
  tmp="$(mktemp)"; grep -v "^- $ID |" "$INDEX" > "$tmp"; mv "$tmp" "$INDEX"
fi
printf '%s\n' "$LINE" >> "$INDEX"

# --- 태그 레지스트리 검증 ---
if [ -f "$TAGREG" ]; then
  echo "$TAGS" | tr -d '[]' | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | while read -r t; do
    [ -z "$t" ] && continue
    grep -q "^- $t " "$TAGREG" || echo "⚠ 미등록 태그: $t — tags.md에 추가 필요" >&2
  done
fi
```

**Step 2: 테스트 실행 → 통과 확인**

Run: `bash plugins/cc-deep-tutor/tests/update-index.test.sh`
Expected: 모든 PASS, 종료코드 0

**Step 3: 커밋**

```bash
git add plugins/cc-deep-tutor/hooks/update-index.sh
git commit -m "feat(cc-deep-tutor): INDEX 자동갱신 + 태그검증 hook"
```

---

### Task 3: hooks.json 교체 (auto-index → update-index)

**Files:**
- Modify: `plugins/cc-deep-tutor/hooks/hooks.json`
- Delete: `plugins/cc-deep-tutor/hooks/auto-index.sh`

**Step 1: 기존 hooks.json 확인**

Run: `cat plugins/cc-deep-tutor/hooks/hooks.json`
(기존 PostToolUse가 auto-index.sh → memsearch index 호출하는 구조 확인)

**Step 2: PostToolUse 매처를 update-index.sh로 교체**

`materials/**/*.md`(단 `_wiki/` 제외) Write/Edit 시 `${CLAUDE_PLUGIN_ROOT}/hooks/update-index.sh "<file>" "<materials-root>"` 백그라운드 실행. resolve-config.sh로 materials_dir 해석. `auto_index_on_write: false`면 skip.

**Step 3: auto-index.sh 삭제**

```bash
git rm plugins/cc-deep-tutor/hooks/auto-index.sh
```

**Step 4: 검증**

Run: `grep -q update-index plugins/cc-deep-tutor/hooks/hooks.json && echo OK`
Run: `test ! -f plugins/cc-deep-tutor/hooks/auto-index.sh && echo "removed"`
Expected: OK / removed

**Step 5: 커밋**

```bash
git add plugins/cc-deep-tutor/hooks/
git commit -m "refactor(cc-deep-tutor): auto-index(memsearch) → update-index(위키) hook 교체"
```

---

## Phase 2 — 노트 템플릿 (작성 강제 SSoT)

### Task 4: note-core.md + 종류별 템플릿 작성

**Files:**
- Create: `plugins/cc-deep-tutor/skills/kb-search/templates/note-core.md`
- Create: `plugins/cc-deep-tutor/skills/kb-search/templates/note-extract.md`
- Create: `plugins/cc-deep-tutor/skills/kb-search/templates/note-research.md`
- Create: `plugins/cc-deep-tutor/skills/kb-search/templates/note-solve.md`

**Step 1: note-core.md 작성** — 설계 문서의 "코어 템플릿" 블록 그대로. 상단에 작성규약 3개(주석) 포함.

**Step 2: 종류별 3개 작성** — 코어 frontmatter + 설계 표의 종류별 추가 필드/섹션.

**Step 3: 검증** (필수 4대 검색필드가 코어에 모두 있는지)

Run:
```bash
for f in id title summary tags; do
  grep -q "^$f:" plugins/cc-deep-tutor/skills/kb-search/templates/note-core.md || echo "MISSING $f"
done; echo "checked"
```
Expected: MISSING 출력 없음, "checked"

**Step 4: 커밋**

```bash
git add plugins/cc-deep-tutor/skills/kb-search/templates/
git commit -m "feat(cc-deep-tutor): 노트 템플릿(코어+종류별) 추가"
```

---

## Phase 3 — 검색 규칙 (kb-search SKILL 재작성)

### Task 5: kb-search SKILL.md 재작성

**Files:**
- Modify: `plugins/cc-deep-tutor/skills/kb-search/SKILL.md`

**Step 1:** 설계 §검색규칙의 6단계 절차 + 명령 매핑 표로 본문 교체. `index`/`watch` 삭제. `_wiki/` 제외 규칙 명시. 템플릿 참조 추가("새 노트는 templates/note-*.md 따름").

**Step 2: 검증**

Run: `grep -c memsearch plugins/cc-deep-tutor/skills/kb-search/SKILL.md`
Expected: 0
Run: `grep -q 'INDEX.md' plugins/cc-deep-tutor/skills/kb-search/SKILL.md && echo OK`

**Step 3: 커밋**

```bash
git add plugins/cc-deep-tutor/skills/kb-search/SKILL.md
git commit -m "refactor(cc-deep-tutor): kb-search를 마크다운 위키 검색으로 재작성"
```

---

### Task 6: extract.sh 수정 (memsearch 제거 + frontmatter 자동생성)

**Files:**
- Modify: `plugins/cc-deep-tutor/scripts/extract.sh`

**Step 1:** memsearch index 호출 블록 제거. 추출 직후, 산출 .md에 frontmatter가 없으면 cc-opencode-cmux delegate-oc(`oc-summarize`)에 위임해 `summary`/`tags`(레지스트리 참조)/`type: extract`/`source_pdf`/`pages`를 생성·삽입. delegate-oc 미설치 시 frontmatter 골격만 삽입(사용자 보강 안내).

**Step 2: 검증**

Run: `grep -c 'memsearch' plugins/cc-deep-tutor/scripts/extract.sh`
Expected: 0

**Step 3: 커밋**

```bash
git add plugins/cc-deep-tutor/scripts/extract.sh
git commit -m "refactor(cc-deep-tutor): extract.sh memsearch 제거 + frontmatter 자동생성"
```

---

## Phase 4 — Agent/Skill 위임 경로 교체

### Task 7: topic-researcher.md — OC 검색+집필 전담

**Files:**
- Modify: `plugins/cc-deep-tutor/agents/topic-researcher.md`

**Step 1:** "도구 사용 우선순위" 1항(memsearch)을 삭제하고, 검색을 OC research 워커에 위임하도록 변경:
- spec에 `INPUTS: <materials_dir>/**/*.md` (glob) 전달 → OC가 glob/grep으로 KB 검색 (실측 확인됨)
- spec에 "매칭 노트의 **절대경로**를 결과에 명시" 요구 (실측 시 OC가 경로 누락한 점 보완)
- 웹 보충도 같은 oc-research 워커가 websearch/webfetch로 수행
- 출처표기 `kb:<hash>` → `kb:<상대경로>#<h2섹션>`
- Bash 제약 절에서 memsearch 관련 문구 제거

**Step 2: 검증**

Run: `grep -c memsearch plugins/cc-deep-tutor/agents/topic-researcher.md`
Expected: 0
Run: `grep -q 'kb:<상대경로>' plugins/cc-deep-tutor/agents/topic-researcher.md && echo OK`

**Step 3: 커밋**

```bash
git add plugins/cc-deep-tutor/agents/topic-researcher.md
git commit -m "refactor(cc-deep-tutor): topic-researcher KB검색을 OC glob/grep 위임으로"
```

---

### Task 8: solution-planner / question-generator 수정

**Files:**
- Modify: `plugins/cc-deep-tutor/agents/solution-planner.md`
- Modify: `plugins/cc-deep-tutor/agents/question-generator.md`

**Step 1:** solution-planner의 memsearch 유사패턴 검색 1줄을 "kb-search 규칙(grep/glob) 또는 OC 위임"으로 교체. question-generator의 입력 스펙 "memsearch expand 결과 청크파일" → "노트 경로 목록(또는 glob)"으로 변경.

**Step 2: 검증**

Run: `grep -rc memsearch plugins/cc-deep-tutor/agents/solution-planner.md plugins/cc-deep-tutor/agents/question-generator.md`
Expected: 둘 다 0

**Step 3: 커밋**

```bash
git add plugins/cc-deep-tutor/agents/solution-planner.md plugins/cc-deep-tutor/agents/question-generator.md
git commit -m "refactor(cc-deep-tutor): planner/generator memsearch 의존 제거"
```

---

### Task 9: learn-chat / deep-research / deep-question SKILL 정리

**Files:**
- Modify: `plugins/cc-deep-tutor/skills/learn-chat/SKILL.md`
- Modify: `plugins/cc-deep-tutor/skills/deep-research/SKILL.md`
- Modify: `plugins/cc-deep-tutor/skills/deep-question/SKILL.md`

**Step 1:** 각 skill의 memsearch 호출을 kb-search 검색규칙 참조로 교체. learn-chat의 `recent` → `_wiki/log.md` 또는 INDEX 최신줄 참조. deep-research 워크플로우의 "1단계 자료수집(CC memsearch)"을 "OC research 워커가 glob/grep+web 자체 수집"으로 갱신(설계 §OC 위임 연결 반영).

**Step 2: 검증**

Run: `grep -rc memsearch plugins/cc-deep-tutor/skills/`
Expected: 모든 파일 0

**Step 3: 커밋**

```bash
git add plugins/cc-deep-tutor/skills/
git commit -m "refactor(cc-deep-tutor): 잔여 skill memsearch 제거, OC 자체수집 반영"
```

---

## Phase 5 — 통합 스모크 테스트

### Task 10: E2E 스모크 (픽스처 KB → deep-research 위임)

**Files:**
- Create: `plugins/cc-deep-tutor/tests/e2e-smoke.md` (수동 절차 문서)

**Step 1:** 픽스처 KB(Task 1 확장)에서 다음을 수동 검증하는 절차 문서화:
1. 새 노트 Write → hook이 INDEX.md 갱신하는지 (`grep` 확인)
2. topic-researcher spec(glob INPUTS)을 실제 delegate-oc로 1회 → OC가 KB에서 후보 찾아 노트 작성 + 절대경로 명시하는지 (Task 0 probe와 동일 방식)
3. 미등록 태그 노트 작성 시 경고 나오는지

**Step 2: 전체 memsearch 잔존 확인**

Run: `grep -rn memsearch plugins/cc-deep-tutor/ --include='*.md' --include='*.sh' --include='*.json' | grep -v tests/`
Expected: 출력 없음 (또는 README의 "더 이상 사용 안 함" 설명 줄만)

**Step 3: 커밋**

```bash
git add plugins/cc-deep-tutor/tests/e2e-smoke.md
git commit -m "test(cc-deep-tutor): 마크다운 위키 E2E 스모크 절차"
```

---

## Phase 6 — 문서/버전 정리

### Task 11: README + plugin.json + marketplace.json

**Files:**
- Modify: `plugins/cc-deep-tutor/README.md`
- Modify: `plugins/cc-deep-tutor/.claude-plugin/plugin.json`
- Modify: `.claude-plugin/marketplace.json`

**Step 1:** README의 사전설치에서 memsearch/MinerU-인덱싱 의존 제거, 마크다운 위키 + 템플릿 + tags.md + INDEX 설명 추가. 디렉토리 구조에 `_wiki/` 반영. "기능" 표의 OC 위임 열 갱신(검색도 OC). 권한 스니펫에서 `memsearch *` 제거(MinerU/bd는 유지).

**Step 2:** plugin.json version `0.2.0` → `0.3.0`, description에서 memsearch 제거. marketplace.json의 cc-deep-tutor version 동기화. (피드백 메모리: 버전 동기화 규약)

**Step 3: 검증**

Run: `grep -c memsearch plugins/cc-deep-tutor/README.md`
Expected: 0 (또는 마이그레이션 안내 줄만)
Run: `python3 -c "import json;a=json.load(open('plugins/cc-deep-tutor/.claude-plugin/plugin.json'))['version'];import json as j;m=[p['version'] for p in j.load(open('.claude-plugin/marketplace.json'))['plugins'] if p['name']=='cc-deep-tutor'][0];print('SYNC' if a==m else 'MISMATCH',a,m)"`
Expected: SYNC 0.3.0 0.3.0

**Step 4: 커밋**

```bash
git add plugins/cc-deep-tutor/README.md plugins/cc-deep-tutor/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "docs(cc-deep-tutor): README 위키 전환 반영 + v0.3.0 버전 동기화"
```

---

## 완료 기준 (Definition of Done)
- [ ] `grep -rn memsearch plugins/cc-deep-tutor/` 결과 0 (마이그레이션 안내 제외)
- [ ] update-index.test.sh 전체 PASS
- [ ] 템플릿 4종 존재, 코어에 검색 4대 필드 포함
- [ ] kb-search SKILL이 6단계 검색 + INDEX fallback 기술
- [ ] E2E 스모크: 새 노트 Write → INDEX 갱신, OC glob 검색+집필 위임 done
- [ ] plugin.json/marketplace.json version 0.3.0 동기화
- [ ] 모든 task 커밋 완료

## 미적용 (YAGNI / 후속)
- 하이브리드 bge-m3 임베딩 fallback — 코퍼스가 수백 문서를 크게 넘을 때만.
- 기존 memsearch 사용자용 frontmatter 일괄 보강 스크립트 — 수요 확인 후.
