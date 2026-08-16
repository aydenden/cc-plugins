---
name: ingest-book
description: 구매한 책 PDF를 marker로 마크다운 변환하고 챕터로 잘라 LLM Wiki 볼트의 raw/books/에 적재한다. 환경 가드가 있어 macOS + marker-pdf가 갖춰진 주력 기기에서만 실행되고 그 외에는 거부한다. "책 넣어줘", "PDF 변환해서 볼트에 넣어줘", ingest-book 요청 시 트리거.
---

책 PDF 한 권을 볼트의 `raw/books/<책>/`까지 옮기는 절차. 스크립트는
`${CLAUDE_PLUGIN_ROOT}/scripts/ingest-book.mjs` 하나이며 5개 하위 명령으로 나뉜다.

**변환은 무겁다 — 462p 기준 1.3~2시간.** 대화형으로 기다리지 말고 백그라운드로 돌린다.

# 규칙 0: 환경 가드가 먼저다

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/ingest-book.mjs" doctor
```

`MISS`가 하나라도 있으면 **여기서 멈추고** 출력의 설치 명령을 사용자에게 그대로 전한다.
다른 기기에서 반쯤 돌다 실패하는 것보다 시작 전에 거부하는 게 낫다.

- `platform` / `marker-pdf` — 필수. 없으면 실행 불가
- `docling` — 웹 문서 변환용이라 책 경로에는 쓰이지 않는다. `warn`이어도 진행한다
- `surya-models` — 미캐시면 최초 변환이 약 3.6GB를 내려받는다. 사용자에게 미리 알린다

# 규칙 1: 원본 PDF 경로는 사용자가 준 파일 하나뿐이다

도서 폴더는 클라우드 동기화 마운트다. **디렉토리를 훑으면 미다운로드 파일 전체의 다운로드가
시작된다.** Glob·`ls`로 책을 찾지 말고 사용자에게 전체 경로를 물어본다. 스크립트도 디렉토리
인자를 거부한다.

# 규칙 2: 변환 (백그라운드)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/ingest-book.mjs" convert \
  --pdf "<책.pdf>" --out "<작업디렉토리>"
```

- `Bash(run_in_background: true)`로 한 번만 띄우고, 출력은 파일로 받는다. 재실행 금지 —
  진행 여부는 `ps aux | grep marker`로 확인한다
- 플래그는 스크립트가 고정한다(`--force_ocr --paginate_output --output_format markdown`).
  **`--use_llm` 계열을 손으로 붙이지 않는다** — 책 지면이 외부 API로 나가 에어갭이 깨진다
- 먼저 `--pages 0-9`로 10쪽만 돌려 품질을 확인한 뒤 전권을 돌리면 사고를 줄인다

# 규칙 3: 챕터 분할

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/ingest-book.mjs" split \
  --md "<작업디렉토리>/<책>/<책>.md" --out "<챕터디렉토리>" --title "<책 제목>"
```

- 분할 기준은 `^## ` 정규식이 아니라 **코드펜스 밖 + 문장 모양 배제** 필터다. marker가 본문
  문장을 헤딩으로 오승격하고 코드블록 안에 `#page` 같은 줄이 실재하기 때문
- 탈락한 헤딩 후보는 **본문에 그대로 남고** 개수와 사유가 출력된다. 출력을 읽고 진짜 절
  제목이 탈락했으면 `--level 3`이나 `--require-numbering`으로 다시 돌린다
- 페이지 번호는 marker의 0-indexed 마커를 **1-indexed로 환산해** 챕터 머리 주석
  `<!-- 원본: PDF p.X-Y -->`와 본문 중간 `<!-- PDF p.N -->`으로 박힌다
- `00-toc.md`가 함께 생성된다 — 목차 표 + **OCR 경고 블록**. 나중 세션이 이 파일을 먼저 읽는다

# 규칙 4: 오독 검사

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/ingest-book.mjs" check --dir "<챕터디렉토리>"
```

`CHECK ok`이면 넘어가고, 아니면 규칙별 건수를 보고한다.

- `glossary`(알려진 오독 `Iru`→`lru` 등)와 `url-case`(소문자 확정 호스트)만 `--fix`로 고친다
- `brace-balance`는 **자동 수정하지 않는다** — 글자 오독이 아니라 코드블록 분할 오류이므로
  사람이 원본과 대조할 몫이다
- **이 검사는 알려진 오독만 잡는다.** 인덱스·상수·변수명 오독(`dp[i][j]`→`dp[i][i]`)은
  검출 불가다. 나중에 이 책 내용을 인용할 때는 원본 PDF 해당 페이지를 확인한다

# 규칙 5: 볼트 적재

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/ingest-book.mjs" ingest \
  --dir "<챕터디렉토리>" --book "<책 제목>"
```

- `$WIKI/raw/books/<slug>/`에 복사하며 각 파일에 raw frontmatter(`ingested`/`sha256`)를 붙인다.
  sha256 기준선은 lint의 drift 검사와 같다(닫는 `---` 다음 줄부터)
- 구매 저작물이므로 `raw/books/.gitignore`를 만들어 **볼트 원격에 올라가지 않게** 막는다.
  이 파일을 지우지 않는다
- 원본 PDF는 **버리지 않는다.** 마크다운은 검색·탐색용이고 최종 심급은 원본이다

# 규칙 6: log.md와 lint는 wiki-schema가 소유한다

스크립트는 log 줄을 **출력만** 한다. 그 줄을 **직접 Write/Edit으로** `$WIKI/log.md` 끝에
append한다 — 스크립트가 파일을 직접 쓰면 `PostToolUse` 훅이 뜨지 않아 index 재생성과 lint가
통째로 빠진다.

책 한 권은 파일이 수십 개여도 **log는 책 단위 한 줄**이다. append 이후는 `wiki-schema`
규칙 7(훅 lint 결과 처리)·규칙 9(보고)를 그대로 따른다.

# 규칙 7: 위키 페이지는 이 절차가 만들지 않는다

`ingest-book`은 raw 계층까지다. 책 내용을 `concepts/`·`summaries/` 페이지로 승격하는 것은
읽으면서 하는 별도 작업(`/capture`, `wiki-schema` 규칙 3~5)이다. 적재 직후 lint의
`raw-unabsorbed` backlog에 책 한 권이 **번들 1건**으로 잡히는 것이 정상이며, 그 책을
인용하는 위키 페이지가 하나라도 생기면 사라진다.
