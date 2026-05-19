---
name: deep-solve
description: 수학·과학 문제를 계획→풀이→집필 3단계로 풀이. "문제 풀어줘", "solve", "증명해줘"에 활성화. cc-opencode-cmux 설치 시 집필을 OpenCode에 위임.
---

# Deep Solve

문제를 받아 sub-agent 협업으로 풀이 + 학습자 친화 재서술.

## 환경 준비

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:?}"
eval "$("$PLUGIN_ROOT/scripts/resolve-config.sh")"
```

집필(`solution-writer`) sub-agent는 내부에서 `Skill(cc-opencode-cmux:delegate-oc, ...)`로 위임한다. delegate-oc가 가용성 판단·daemon ensure를 담당하므로 본 skill은 모드 감지 없이 진행한다.

## 워크플로우

### 1. 계획 — `solution-planner` agent
- 입력: `$ARGUMENTS` (문제 텍스트 또는 PDF 경로)
- PDF면 먼저 `${CLAUDE_PLUGIN_ROOT}/scripts/extract.sh <pdf>` 실행
- 출력: 단계 리스트 JSON (각 단계: 목표·정리·검증)
- planner 결과는 `/tmp/cc-dt-solve/<session>/plan.json`에 저장

### 2. 풀이 실행 (본 세션, CC 직접)
- 단계별 진행, 중간 결과는 메시지 히스토리에 누적
- 코드/계산은 `Bash`, `ctx_execute` 사용
- 각 단계 검증 후 다음 진행
- 각 단계 결과를 `/tmp/cc-dt-solve/<session>/steps.md`에 append

### 3. 집필 — `solution-writer` agent
- 입력: 문제 + plan.json + steps.md + 최종 답
- writer가 내부에서 delegate-oc Skill 호출 (compose) — 긴 본문 + LaTeX → 토큰 절감
- delegate-oc 실패 시 writer가 cc-only fallback으로 직접 Write
- 출력: `$CC_DEEP_TUTOR_MATERIALS_DIR/notes/solve-<slug>-<date>.md` (사용자 동의 시)

### 4. 저장
- 사용자에게 "이 풀이를 노트로 저장할까?" 묻기
- 동의 시 위 경로에 final.md 복사 → `auto_index_on_write` hook이 인덱싱

## 인자

`$ARGUMENTS`: 문제 텍스트 또는 PDF 경로. 비어 있으면 사용자에게 묻기.

## 사용 예

```
/cc-deep-tutor:deep-solve 다음 미분방정식 풀어줘: y'' + 4y = sin(2x)
/cc-deep-tutor:deep-solve materials/papers/problem-set-3.pdf
```

## 주의
- LaTeX 수식 검증 (mismatched delimiters 없음)
- 검증 단계 누락 금지
- delegate-oc 위임 실패는 writer agent 내부에서 cc-only fallback 처리
