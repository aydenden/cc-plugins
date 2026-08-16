---
description: 웹 페이지 또는 대화 지식을 LLM Wiki 볼트에 ingest한다
argument-hint: <URL 또는 노트 제목>
---

"$ARGUMENTS"를 LLM Wiki 볼트에 ingest해줘.

## 볼트 경로

```bash
WIKI="${WIKI_PATH:-$OBSIDIAN_VAULT_PATH}"
```

`WIKI`가 미설정이면 사용자에게 안내하고 중단.

## 0. 오리엔테이션 (wiki-schema 스킬, 필수)

이 세션에서 아직 안 했다면: `SCHEMA.md` Read → 루트 `index.md`(주제군 지도) Read → `tail -40 log.md`. 스키마 규칙(타입, frontmatter, 태그 택소노미, Page Thresholds)은 전부 SCHEMA.md를 따른다.

## 1. 소스 캡처 (Layer 1)

인자를 분석해서 소스 유형별로 처리:

### URL (`http://`, `https://`)

1. WebFetch로 본문 추출 (제목 + 전체 내용)
2. `raw/articles/` 에 서술적 파일명으로 저장 (예: `raw/articles/karpathy-llm-wiki-2026.md`). 논문 PDF는 `raw/papers/`.
3. raw frontmatter 필수:
   ```yaml
   ---
   source_url: <원본 URL>
   ingested: YYYY-MM-DD
   sha256: <frontmatter 제외 본문의 sha256>
   ---
   ```
   ```bash
   # 본문(frontmatter 닫는 --- 이후)만 해시
   shasum -a 256 <본문 파일> 방식으로 계산
   ```
4. **재ingest 감지**: 같은 `source_url`이 raw/에 이미 있으면 새 sha256과 비교 — 동일하면 처리 생략 보고, 다르면 drift 플래그 후 갱신.

### 대화 지식 (URL이 아닌 경우)

현재 대화에서 핵심 지식을 추출한다. 일회성 대화는 raw/ 캡처를 생략하고 Layer 2에 직접 합성하되, frontmatter `sources:`에 `claude-code-session (YYYY-MM-DD)`를 기재한다. 원문 보존 가치가 있는 긴 내용(트러블슈팅 전문, 외부에서 붙여넣은 텍스트)은 `raw/transcripts/`에 저장 후 진행.

## 2. 기존 페이지 확인

**Grep 전수검색이 1차다.** 소스에 등장한 엔티티/개념 이름으로 `$WIKI`의 `entities/` `concepts/` `comparisons/` `queries/`를 직접 Grep한다(볼트 전체 마크다운 8.5MB, 전수검색 0.02초 — 인덱스 불필요). 표기 흔들림이 예상되면 `/recall`의 쿼리 확장 규칙(띄어쓰기 변형·조사 절단·한영 동의어)을 그대로 적용한다.

미적중이거나 볼트에서 쓰는 어휘 자체가 불확실하면 루트 `index.md`(주제군 지도) → 해당 디렉토리 `index.md`(전수 카탈로그) 순으로 하강해 후보를 찾는다. index는 폴백이자 쿼리 어휘 공급원이지 1차 경로가 아니다.

**이 단계가 위키와 중복 더미를 가르는 차이다.**

## 3. 위키 페이지 작성/갱신 (Layer 2)

- **신규 페이지**: SCHEMA.md의 Page Thresholds 충족 시에만 (2+ 소스 등장 또는 단일 소스의 중심 주제). type별 디렉토리(entities/concepts/comparisons/queries)에 저장.
- **기존 페이지**: 새 정보 추가, `date` 범프(= 최종 갱신일). 충돌 시 SCHEMA.md Update Policy (양쪽 병기 + `contested`/`contradictions` frontmatter).
- **frontmatter**: SCHEMA.md 형식 — 필수 `type/tags/summary/date/sources` + 선택 `confidence/contested/contradictions/subjects`. 이 8개가 전부이며 다른 키는 쓰지 않는다. `sources:`는 항상 배열이고 원소는 `raw/…` | URL | `github:org/repo` | `session:YYYY-MM-DD`. `summary:`는 디렉토리 index.md 자동 생성의 입력이므로 한 줄로 반드시 채운다.
- **교차참조**: 페이지당 outbound `[[wikilink]]` 최소 2개. 관련 기존 페이지 최대 5개에 역링크 Edit 삽입.
- **태그**: SCHEMA.md 택소노미만. 새 태그는 택소노미에 먼저 추가.
- **confidence**: 공식 문서/1차 소스 다수=high, 1·2차 혼재=medium, 포럼/미검증=low. 의견성·단일 소스 주장은 medium 이하.

하나의 소스가 5~15개 페이지 갱신을 일으킬 수 있다 — 이것이 정상이고 복리 효과다. 단, 기존 페이지 10개 이상을 건드리게 되면 진행 전에 범위를 사용자에게 확인.

## 4. log.md 기록

`log.md` 파일 **끝에** append:

```markdown
## [YYYY-MM-DD] ingest | {소스 제목}
- Raw: `raw/articles/{파일}.md` (또는 "raw 생략 — 대화 지식")
- Created/Updated: {파일 목록}
- 역링크: [[노트1]], [[노트2]]
```

`index.md`는 **손대지 않는다** — 디렉토리별 카탈로그와 루트의 자동 구간은 다음 단계의 정비 스크립트가 frontmatter에서 전량 재생성한다.

## 5. 정비 실행 (lint)

log.md 기록 직후 무조건 실행한다. index 재생성과 오류 점검이 여기서 일어난다.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/lint.mjs" --vault "$WIKI"
```

- 출력은 그룹별 건수 요약이다. **error 그룹에 건수가 있으면 그 자리에서 조치**하고, backlog 그룹은 건수만 보고하고 넘어간다.
- 드릴다운이 필요하면 `--group=<id> --json`으로 해당 그룹만 확인한다. 전체 목록을 대화에 쏟지 않는다.
- 스크립트가 아직 없는 환경이면 이 단계를 생략하고 "정비 미실행"을 보고에 한 줄로 남긴다.

## 6. 보고

생성/갱신한 모든 파일 목록, 역링크 삽입 위치, lint 요약(error 조치 내역 + backlog 건수)을 사용자에게 보고한다.

인자: $ARGUMENTS
