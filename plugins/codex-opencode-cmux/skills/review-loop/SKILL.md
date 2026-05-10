---
name: review-loop
description: opencode crew 결과를 codex captain이 검토하고 미완료 시 refinement 지시를 보내 최대 3회 재실행하는 루프 스킬. dispatch가 Step 6에서 자동 호출. 사용자가 "리뷰 / refinement / 다시 시켜줘 / 미완료" 등으로도 트리거.
allowed-tools: Bash, Read
---

# review-loop — codex 리뷰 + refinement 루프

## 역할

opencode가 생성한 결과를 codex가 검증하고, 부족하면 같은 세션을 이어 refinement 지시를 보내 최대 3회까지 재실행한다.

## 트리거

- `dispatch` 스킬 Step 6에서 자동 호출
- 사용자: "리뷰해줘", "다시 시켜줘", "refinement", "미완료니까 다시"

## 입력 계약

```bash
review-loop \
  --impl-file /tmp/oc-impl-<id>.json \
  --plan-file /tmp/codex-plan-<id>.md \
  --max-iterations 3 \
  [--escalate-on-fail]
```

## 절차

### Step 1: 요약 추출

```bash
SUMMARY=$(bash ${CLAUDE_PLUGIN_ROOT}/bin/oc-summary.sh "$IMPL_FILE")
```

요약은 4KB 이하로 제한.

### Step 2: codex 리뷰

```bash
codex exec --json "review the following implementation against the plan, output JSON {status: 'complete'|'incomplete'|'failed', issues: [...], next_action: '...'}" \
  < <(printf "PLAN:\n%s\n\nIMPL:\n%s\n" "$(cat $PLAN_FILE)" "$SUMMARY") \
  > /tmp/review-$ITER.jsonl
```

`--output-schema` 사용하면 구조화 강제 가능:
```bash
codex exec \
  --output-schema ${CLAUDE_PLUGIN_ROOT}/bin/review-schema.json \
  -o /tmp/review-$ITER.json \
  "review impl against plan"
```

### Step 3: 판정

JSON에서 `status` 추출:
- `complete` → 루프 종료, 사용자에게 보고
- `incomplete` → Step 4 (refinement) 진행
- `failed` → 즉시 종료, 사용자에게 실패 보고

### Step 4: Refinement (incomplete 일 때)

```bash
ISSUES=$(jq -r '.issues | join("\n- ")' /tmp/review-$ITER.json)
NEXT=$(jq -r '.next_action' /tmp/review-$ITER.json)

REFINE_PROMPT="이전 작업이 미완료. 다음 이슈를 해결:\n- $ISSUES\n다음 행동: $NEXT"

opencode run --continue --format json "$REFINE_PROMPT" > "/tmp/oc-impl-$ITER.json"
```

`--continue` 는 opencode 마지막 세션 이어받기. 컨텍스트 재구축 비용 절감.

### Step 5: 루프 또는 종료

```bash
ITER=$((ITER + 1))
if [ "$ITER" -gt "$MAX_ITERATIONS" ]; then
  if [ "$ESCALATE_ON_FAIL" = "true" ]; then
    # opencode-runner의 escalation 트리거
    echo "[review-loop] max iterations reached, escalating model"
    bash ${CLAUDE_PLUGIN_ROOT}/bin/co-dispatch.sh \
      --task "$REFINE_PROMPT" \
      --model opencode-go/kimi-k2.6 \
      --escalated
  else
    echo "[review-loop] 미완료 상태로 종료 (max iterations)"
    exit 2
  fi
fi
```

## 출력 형식

```
✅ Review 완료
- Iterations: 2/3
- Status: complete
- Issues fixed: 3
- Final summary: <2-3줄>
```

또는

```
⚠️ Review 미완료
- Iterations: 3/3 (max 도달)
- 마지막 status: incomplete
- 잔여 이슈: <목록>
- 다음 행동: 사용자 수동 개입 또는 escalation
```

## 한도 정책

- 기본 `max_iterations`: **3** (settings에서 override 가능)
- 1회 review 비용 = codex 1 message + opencode 1 task
- 3회 = codex 3 messages + opencode 3 tasks → 한도 모니터링 권장

## 참고 스킬

- `opencode-runner` — 실제 opencode 호출 + escalation 위임
- `dispatch` — 진입점, 이 스킬 자동 호출
- `cmux-bridge` — refinement 시에도 사이드바 진행률 갱신
