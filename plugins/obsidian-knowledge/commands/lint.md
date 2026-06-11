---
description: LLM Wiki 볼트 건강 점검 -- 고아 페이지, 깨진 링크, 인덱스 누락, frontmatter 결함, 모순/저신뢰 페이지, raw 소스 drift, 태그 위반, 로그 회전
argument-hint: "[--fix]"
---

LLM Wiki 볼트의 건강 상태를 점검해줘.

## 볼트 경로

```bash
WIKI="${WIKI_PATH:-$OBSIDIAN_VAULT_PATH}"
```

둘 다 미설정이면 사용자에게 안내하고 중단.

## 사전 준비

1. `SCHEMA.md` Read — frontmatter 필수 필드와 태그 택소노미가 점검 기준 (SSoT)
2. 점검 대상: `entities/` `concepts/` `comparisons/` `queries/` 의 `.md` 전체. `raw/`는 ⑧에서만, `.obsidian/`·`index.md`·`log.md`·`SCHEMA.md`·`CLAUDE.md`는 페이지 점검에서 제외.
3. 링크 맵 구축: Glob으로 전체 파일 목록 + Grep으로 `\[\[[^\]]+\]\]` 전체 추출 → "존재 파일 집합"과 "참조 링크 집합" 구성. 항목 수가 많으면 Bash 스크립트(python3 한 파일)로 일괄 계산해도 된다.

## --fix 플래그

`$ARGUMENTS`에 `--fix`가 있으면 자동 수정 가능 항목을 수정하고, 없으면 보고만 한다. 자동 수정 범위는 각 항목에 명시.

## 점검 체크리스트

① **고아 페이지** — 인바운드 `[[wikilink]]` 0인 페이지. (--fix: 수정 없음, 목록 보고 + 연결 후보 제안)

② **깨진 링크** — `[[대상]]`의 대상 파일이 볼트에 없는 경우. (--fix: 참조 3회 이상이면 스텁 페이지 생성 제안, 1~2회면 목록만)

③ **인덱스 완전성** — 파일시스템의 모든 위키 페이지가 `index.md`에 있는지, 반대로 인덱스에 있는데 파일이 없는 항목은 없는지. (--fix: 누락 행 추가 / 죽은 행 제거, 기존 테이블 포맷 유지)

④ **frontmatter 검증** — SCHEMA.md 필수 필드(`title/created/updated/type/tags/sources`) 누락, `type` 값이 SCHEMA.md 정의 외인 경우. (--fix: 누락 필드를 추정 값으로 채우는 Edit 제안)

⑤ **오래된 페이지** — `updated`가 180일 이상 경과한 페이지 중 같은 주제의 더 최신 페이지/raw 소스가 존재하는 것. (--fix: 수정 없음, 재ingest 후보 보고)

⑥ **모순 페이지** — `contested: true` 또는 `contradictions:` frontmatter 보유 페이지 전체 + 같은 태그를 공유하면서 상충 주장을 하는 페이지 쌍. (--fix: 수정 없음, 사용자 검토 목록)

⑦ **신뢰도 신호** — `confidence: low` 페이지와, 단일 소스 인용인데 confidence 미설정 페이지 (보강 또는 medium 강등 후보). (--fix: 후자에 `confidence: medium` 설정 제안)

⑧ **raw 소스 drift** — `raw/` 파일 중 `sha256:` frontmatter 보유 파일의 해시 재계산 → 불일치 플래그 (raw는 불변이어야 함 / 원본 URL 변경 가능성). 하드 에러 아님, 보고만.

⑨ **페이지 분량** — 200줄 초과 페이지 (분리 후보). (--fix: 수정 없음, 분리안 제안)

⑩ **태그 감사** — 사용 중인 모든 태그 수집 → SCHEMA.md 택소노미에 없는 태그 플래그. (--fix: 빈도 높은 기존 태그로 통일하거나, 정착된 태그면 택소노미에 추가 제안)

⑪ **로그 회전** — `log.md` 항목(`^## \[`) 500개 초과 시 `log-YYYY.md` 회전 필요. (--fix: 회전 수행)

## 출력 형식

심각도순 그룹핑: 깨진 링크 > 인덱스 불일치 > frontmatter 결함 > 고아 > raw drift > 모순/저신뢰 > 오래된 페이지 > 분량/태그/로그.

```
## Wiki Lint Report -- YYYY-MM-DD

### 요약
| 항목 | 건수 |
|------|------|
| 깨진 링크 | N |
| 인덱스 불일치 | N |
| frontmatter 결함 | N |
| 고아 페이지 | N |
| raw drift | N |
| 모순/저신뢰 | N |
| 오래된 페이지 | N |
| 분량 초과 / 태그 위반 | N / N |

### [각 항목별 상세 — 파일 경로와 권고 조치 포함]

### 권고 조치 (우선순위순)
1. ...
```

## 마무리

`log.md` **끝에** append:

```markdown
## [YYYY-MM-DD] lint | N issues found
- 깨진 링크 N, 인덱스 불일치 N, frontmatter N, 고아 N, drift N, 모순 N
- --fix 적용: {적용 항목 또는 "없음"}
```
