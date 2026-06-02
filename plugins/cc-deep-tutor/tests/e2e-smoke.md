# cc-deep-tutor 마크다운 위키 E2E 스모크 절차

플러그인을 설치한 실제 세션(`claude --plugin-dir ./plugins/cc-deep-tutor`)에서 수동 검증한다.
자동 단위 테스트는 `tests/update-index.test.sh`(hook 로직)가 커버하며, 아래는 통합 동작 확인.

## 사전 준비

학습 프로젝트 디렉토리에서:
```
materials/
├── notes/
└── _wiki/
    └── tags.md      # 최소 태그 몇 개 등록 (예: - attention — ...)
```

## 1. INDEX 자동 갱신 (PostToolUse hook)

1. `materials/notes/test-note.md`를 템플릿(`note-research.md`)대로 작성 — frontmatter에
   `id/type/summary/tags`(레지스트리 태그) 포함.
2. 기대: 저장 직후 `materials/_wiki/INDEX.md`에 `- test-note | research | [...] | <summary>`
   줄이 생긴다.
   - 확인: `grep test-note materials/_wiki/INDEX.md`
3. 미등록 태그(`tags: [unregistered]`)로 저장하면 hook이 stderr에 `⚠ 미등록 태그` 경고.

## 2. OC 검색+집필 위임 (topic-researcher / deep-research)

1. `materials/`에 frontmatter 포함 노트 2~3개를 둔다(검색 대상).
2. `/cc-deep-tutor:deep-research <주제>` 실행.
3. 기대:
   - topic-researcher가 `Skill(cc-opencode-cmux:delegate-oc, TASK_TYPE: research)`로 위임.
   - OC가 `materials/**/*.md` 글롭을 grep/glob 검색해 관련 노트를 찾고, 웹 보충 후 조사
     노트를 OUTPUT_FILE에 작성. **매칭 노트의 절대경로가 Citations에 명시**된다.
   - CC 컨텍스트에 raw 본문이 올라오지 않는다(경로만).
   - cc-opencode-cmux 미설치 시: topic-researcher가 cc-only fallback(Grep/Glob/Read + 웹)로
     직접 작성.
   - 참고 검증: `oc-grep-probe`(설계 실측)와 동일하게 OC가 정확한 경로 없이 글롭만으로
     검색 가능함을 이미 확인함.

## 3. 출제 (deep-question)

1. `/cc-deep-tutor:deep-question <토픽>` 실행.
2. 기대: CC가 kb-search 규칙(Grep/Glob/INDEX)으로 후보 노트 경로를 모아 question-generator에
   넘기고, 출제 JSON의 `source_notes`가 `kb:<상대경로>#<섹션>` 형식이다.

## 4. memsearch 완전 제거 확인

```bash
grep -rn memsearch plugins/cc-deep-tutor/ \
  --include='*.md' --include='*.sh' --include='*.json' | grep -v tests/
```
기대: 출력은 "더 이상 사용하지 않음/미사용" 안내 문구만 (실제 호출 0).
