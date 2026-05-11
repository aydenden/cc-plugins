# obsidian-knowledge v0.3.0 Phase A — research-agent OC 위임 변환

- **날짜**: 2026-05-11
- **범위**: Phase A만 (research-agent + hooks). Phase B(lint), C(capture URL)는 별도.
- **선행**: cc-opencode-cmux v0.2.0 (research/compose task type)

---

## 1. 목표

`agents/research-agent.md`를 11단계 모놀리식에서 5단계 오케스트레이션 + 2회 위임 패턴으로 재구성. CC 토큰 사용량 70%+ 절감.

도메인 책임은 CC가 유지:
- 볼트 frontmatter 검색
- 매칭 노트 본문 Read
- 엔티티 타입 분류 + 템플릿 선택
- frontmatter 검증
- 백링크 5개 Edit
- `_wiki/index.md` / `log.md` 갱신

OC에 위임:
- 외부 자료 수집 (WebSearch + WebFetch) — `research`
- 노트 본문 작성 (template + raw → 최종 마크다운) — `compose`

---

## 2. 모드 감지 (3-tier 자동)

| 우선순위 | 조건 | 모드 |
|---|---|---|
| 1 | `/tmp/cc-oc-serve.env` 존재 + curl `/global/health` 200 | `oc` (warm) |
| 2 | `which opencode` + `opencode auth list` 비어있지 않음 | `oc-coldstart` |
| 3 | 위 둘 다 아님 | `cc-only` (기존 동작) |

명시적 override: 호출 인자에 `--cc-only` 또는 `--oc-only` 포함 시 강제.

`oc-coldstart` → agent가 `bin/oc-serve-start.sh` 자동 호출 (cc-opencode-cmux의 명령).

---

## 3. 데이터 플로우

```
사용자 → /obsidian-knowledge:research "주제"
       → research-agent 호출

[CC] 1. 모드 감지
[CC] 2. 볼트 frontmatter 검색 (Grep summary/tags + Glob 파일명)
[CC] 3. 매칭 1~3개 Read → 충분히 관련 있으면 즉시 종료 (외부 조사 생략)

[CC] 4. spec 작성 (mode=oc 분기)
       /tmp/cc-oc-<id>/research-spec.md
       포함: 주제, 핵심 질문, 출처 가이드, 출력 schema

       /cc-opencode-cmux:delegate "<spec>" --type research
       OC: WebSearch + WebFetch → /tmp/cc-oc-<id>/oc.ndjson에 raw research

       (mode=cc-only 분기): 4~6단계 monolithic 기존 동작

[CC] 5. raw research 검토 (Read /tmp/cc-oc-<id>/oc.ndjson, 50줄 이내)
       사실 누락 / 거짓 / 부족 체크. 부족 시 추가 spec으로 재위임 가능.

[CC] 6. 엔티티 타입 결정 + 템플릿 Read
       `templates/{type}.md`

[CC] 7. compose spec 작성
       /tmp/cc-oc-<id>/compose-spec.md
       포함:
         - 입력: raw research 파일 경로
         - 출력: $OBSIDIAN_VAULT_PATH/<폴더>/<파일명>.md
         - frontmatter 값 (type/tags/summary/date/source/source_hash/confidence)
         - 템플릿 섹션 구조
         - 한국어 작성 + .obsidian/ 수정 금지

       /cc-opencode-cmux:delegate "<compose-spec>" --type compose --dir $OBSIDIAN_VAULT_PATH
       OC: 노트 Write

[CC] 8. frontmatter 검증
       head -20 <file> + grep '^(type|tags|summary|date):'
       누락 필드 있으면 CC가 직접 Edit으로 보강

[CC] 9. 백링크 삽입 (위임 X, CC 직접)
       Grep 으로 관련 노트 ≤5개 찾기
       각 노트의 `## 관련 노트` 섹션에 `- [[새 노트]]` Edit 추가

[CC] 10. _wiki/index.md 갱신 (위임 X, CC 직접)
        엔티티 타입에 해당하는 섹션에 행 추가

[CC] 11. _wiki/log.md append (위임 X, CC 직접)

[CC] 12. 결과 요약 반환
```

---

## 4. spec 템플릿

### research-spec.md (CC → OC research)

```markdown
TOPIC: <주제>

KEY QUESTIONS:
- <질문 1>
- <질문 2>
- <질문 3>

SOURCE GUIDELINES:
- 공식 문서 (벤더, RFC, 1차 자료) 우선
- 2026 이후 자료 우선, 그 이전은 명시 필요
- 한국어 자료도 포함 가능
- 각 사실에 출처 URL + 발행일 명시

OUTPUT SCHEMA (stdout, markdown):

## TL;DR
(3-5 줄)

## <질문 1>
- 사실: ... [출처: URL, YYYY-MM-DD]
- 사실: ... [출처: URL, YYYY-MM-DD]

## <질문 2>
...

## 핵심 출처
- [Title](URL) — 발행일, confidence(high|medium|low)
- ...
```

### compose-spec.md (CC → OC compose)

```markdown
INPUT FILE: /tmp/cc-oc-<id>/raw_research.md
(Read this file first to extract facts. Cite the [출처: URL] entries.)

OUTPUT FILE: $OBSIDIAN_VAULT_PATH/<폴더>/<kebab-case-제목>.md

FRONTMATTER (정확히 이 형식):
---
type: <엔티티 타입>
tags: [<태그 1>, <태그 2>, <태그 3>]
summary: "<한 줄 요약>"
date: <YYYY-MM-DD>
source: "<주 출처 URL>"
source_hash: <8자 hash>
confidence: <high|medium|low>
---

BODY (템플릿 풀텍스트 인라인):
<해당 entity type의 templates/{type}.md 내용을 여기에 붙여넣음>

WRITING CONVENTIONS:
- 한국어 작성. 기술 용어는 영문 허용.
- 각 핵심 사실에 출처 표기.
- 추측 금지. raw research에 없는 내용은 작성 금지.
- frontmatter 외의 ---는 사용 금지.

FORBIDDEN ACTIONS:
- .obsidian/ 폴더 수정
- 출력 파일 외의 파일 생성
- raw research에 없는 사실 추가 (hallucination 금지)
```

---

## 5. source_hash 생성 위치

기존: research-agent가 직접 생성
변경 후:
- raw research 단계에서 OC가 주 출처 본문 첫 500자를 raw_research.md에 명시
- CC가 compose spec 작성 시 그 본문 받아서 직접 `shasum -a 256` 계산
- compose spec의 frontmatter에 hash 값을 미리 채워서 전달

이유: OC가 hash 계산을 일관되게 못 할 수 있음. CC가 통제.

---

## 6. confidence 결정 (CC 책임)

raw research의 "핵심 출처" 섹션을 CC가 보고 결정:
- 모든 출처 high → high
- 1차 + 2차 혼재 → medium
- 2차/3차/포럼만 → low

compose spec에 결정된 값 inject.

---

## 7. 신규 파일

### `plugins/obsidian-knowledge/hooks/hooks.json` (선택, 자동 안내용)

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh" }
        ]
      }
    ]
  }
}
```

### `plugins/obsidian-knowledge/hooks/session-start.sh`

cc-opencode-cmux 가용성 한 줄 안내:
```bash
#!/usr/bin/env bash
set -uo pipefail

if [ -f /tmp/cc-oc-serve.env ]; then
  echo "[obsidian-knowledge] cc-opencode-cmux daemon detected — research/capture will delegate to OpenCode (low token mode)" >&2
elif command -v opencode >/dev/null 2>&1; then
  echo "[obsidian-knowledge] opencode CLI found but daemon not started. Run /cc-opencode-cmux:serve-start for OC delegation, or use --cc-only" >&2
fi
exit 0
```

---

## 8. 변경 파일 목록 (Phase A)

| 파일 | 변경 종류 |
|---|---|
| `plugins/obsidian-knowledge/agents/research-agent.md` | 재작성 (211 → ~300줄, 모드 분기 + 위임 절차) |
| `plugins/obsidian-knowledge/hooks/hooks.json` | 신규 |
| `plugins/obsidian-knowledge/hooks/session-start.sh` | 신규 |
| `plugins/obsidian-knowledge/.claude-plugin/plugin.json` | version 0.2.0 → 0.3.0 |
| `plugins/obsidian-knowledge/README.md` | OC 위임 모드 섹션 추가 |
| `.claude-plugin/marketplace.json` | obsidian-knowledge version 0.2.0 → 0.3.0 |

(`commands/research.md`는 변경 없음 — agent가 분기 처리)

---

## 9. 위험 + 대응 (Phase A)

| 위험 | 대응 |
|---|---|
| OC가 raw research에 거짓 사실 포함 | research-spec에 "추측 금지, 모든 사실에 출처" 명시. CC 검토 단계(5)에서 spot check. |
| compose가 wiki schema 깨뜨림 | 검증 단계(8) — frontmatter 필수 필드 grep. 누락 시 CC 직접 Edit. |
| 한국어 품질 저하 | 기본 `compose: qwen3.6-plus` (KMMLU ~74), `--quality high` 옵션으로 `opencode/gemini-3-flash` (Zen 옵트인) |
| 모드 감지 오작동 | 명시적 `--cc-only` / `--oc-only` override 항상 가능 |
| OC daemon 미기동 | `oc-coldstart` 모드가 자동으로 `/cc-opencode-cmux:serve-start` 호출 |
| 기존 사용자 워크플로 깨짐 | `cc-only` fallback이 기존 동작과 동일. 회귀 없음. |

---

## 10. 검증 (Phase A 종료 기준)

- [ ] 신규 주제 1개로 `research` 실행 → 노트 생성 → frontmatter 8개 필드 모두 채워짐
- [ ] 동일 주제로 `--cc-only` 실행 → 결과 노트 품질 동등 이상
- [ ] OC daemon 미기동 상태에서 실행 → `cc-only` 자동 fallback, 오류 없이 완료
- [ ] 백링크 5개 정확히 삽입됨
- [ ] `_wiki/index.md`에 새 entry 추가됨
- [ ] `_wiki/log.md`에 새 entry 추가됨
- [ ] (선택) 토큰 사용량 측정 — 기존 대비 절감률
