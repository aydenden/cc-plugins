---
description: 웹 페이지 또는 대화 지식을 LLM Wiki 볼트에 ingest한다
argument-hint: <URL 또는 노트 제목>
---

"$ARGUMENTS"를 LLM Wiki 볼트에 ingest해줘.

## 볼트 경로

```bash
WIKI="${WIKI_PATH:-$OBSIDIAN_VAULT_PATH}"
CLI="${CLAUDE_PLUGIN_ROOT}/src/cli.ts"   # llm-wiki 검색 CLI (Bun)
```

`WIKI`가 미설정이면 사용자에게 안내하고 중단.

## 0. 오리엔테이션 (wiki-schema 스킬, 필수)

이 세션에서 아직 안 했다면: `SCHEMA.md` Read → `index.md`에서 주제 키워드 Grep → `tail -40 log.md`. 스키마 규칙(타입, frontmatter, 태그 택소노미, Page Thresholds)은 전부 SCHEMA.md를 따른다.

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

index.md와 Grep으로 언급된 엔티티/개념의 기존 페이지를 찾는다. **이 단계가 위키와 중복 더미를 가르는 차이다.**

## 3. 위키 페이지 작성/갱신 (Layer 2)

- **신규 페이지**: SCHEMA.md의 Page Thresholds 충족 시에만 (2+ 소스 등장 또는 단일 소스의 중심 주제). type별 디렉토리(entities/concepts/comparisons/queries)에 저장.
- **기존 페이지**: 새 정보 추가, `updated` 날짜 범프. 충돌 시 SCHEMA.md Update Policy (양쪽 병기 + `contested`/`contradictions` frontmatter).
- **frontmatter**: SCHEMA.md 형식 (`title/created/updated/type/tags/sources` + 선택 quality 필드). `sources:`에는 raw 파일 경로 또는 세션 표기.
- **교차참조**: 페이지당 outbound `[[wikilink]]` 최소 2개. 관련 기존 페이지 최대 5개에 역링크 Edit 삽입.
- **태그**: SCHEMA.md 택소노미만. 새 태그는 택소노미에 먼저 추가.
- **confidence**: 공식 문서/1차 소스 다수=high, 1·2차 혼재=medium, 포럼/미검증=low. 의견성·단일 소스 주장은 medium 이하.

하나의 소스가 5~15개 페이지 갱신을 일으킬 수 있다 — 이것이 정상이고 복리 효과다. 단, 기존 페이지 10개 이상을 건드리게 되면 진행 전에 범위를 사용자에게 확인.

## 4. 네비게이션 갱신

1. `index.md` — 해당 type 섹션 테이블에 `| [[노트]] | 한 줄 요약 |` 행 추가 (기존 포맷 유지), 헤더의 `Last updated`/`Total pages` 갱신
2. `log.md` — 파일 **끝에** append:
   ```markdown
   ## [YYYY-MM-DD] ingest | {소스 제목}
   - Raw: `raw/articles/{파일}.md` (또는 "raw 생략 — 대화 지식")
   - Created/Updated: {파일 목록}
   - 역링크: [[노트1]], [[노트2]]
   ```

## 5. 검색 인덱스 증분 갱신

작성/갱신한 **각 위키 페이지**(entities/concepts/comparisons/queries)에 대해 증분 인덱싱을 실행한다.
`raw/`·`index.md`·`log.md`는 검색 대상이 아니므로 제외.

```bash
# 생성/갱신한 위키 페이지마다 (절대경로로)
bun run "$CLI" index --vault "$WIKI" --file "$WIKI/concepts/새페이지.md"
```

- `--file`은 해당 파일의 청크만 재임베딩/교체하는 near-instant 증분이다(전체 재인덱싱 아님).
- 인덱스가 아직 없으면(첫 사용) 이 명령이 전체 인덱싱으로 폴백한다 — 모델 다운로드 ~1GB로
  시간이 걸리니, 그럴 땐 백그라운드 실행을 안내한다.
- `index.md` 수동 갱신(4단계)은 사람용 네비게이션 유지 목적이며, 검색 진입점은 이 인덱스다.

## 6. 보고

생성/갱신한 모든 파일 목록과 역링크 삽입 위치, 인덱스 증분 갱신 결과를 사용자에게 보고한다.

인자: $ARGUMENTS
