# Refinement Loop — codex 리뷰 + 재실행

## 시나리오
opencode가 1차 구현했지만 codex 리뷰에서 "엣지 케이스 미처리" 판정. 같은 세션 이어 재실행.

## 흐름

```
iter 1: opencode run (--continue=false)        → /tmp/oc-impl-1.json
        codex review                            → status: incomplete
                                                  issues: ["null check 누락", "에러 핸들링 없음"]
iter 2: opencode run --continue                 → /tmp/oc-impl-2.json (이전 컨텍스트 활용)
        codex review                            → status: incomplete
                                                  issues: ["테스트 커버리지 부족"]
iter 3: opencode run --continue                 → /tmp/oc-impl-3.json
        codex review                            → status: complete ✅
        루프 종료
```

## 호출

```bash
${CLAUDE_PLUGIN_ROOT}/bin/co-dispatch.sh \
  --task "user 입력 검증 함수 작성" \
  --max-iterations 3
```

`co-dispatch.sh`가 review-loop를 내부 호출하고, 각 iter마다 `opencode run --continue` 로 세션을 이어간다.

## review-loop 내부 호출 (참고)

```bash
ITER=1
while [ "$ITER" -le "$MAX_ITER" ]; do
  SUMMARY=$(bash ${CLAUDE_PLUGIN_ROOT}/bin/oc-summary.sh "$IMPL_FILE")
  
  REVIEW=$(codex exec --json \
    "review impl against plan, output JSON {status, issues, next_action}" \
    < <(printf "PLAN:\n%s\n\nIMPL:\n%s\n" "$(cat $PLAN_FILE)" "$SUMMARY"))
  
  STATUS=$(echo "$REVIEW" | jq -r '.status')
  
  if [ "$STATUS" = "complete" ]; then
    break
  elif [ "$STATUS" = "failed" ]; then
    exit 6  # 즉시 종료
  fi
  
  # incomplete → refinement
  ISSUES=$(echo "$REVIEW" | jq -r '.issues | join("\n- ")')
  NEXT=$(echo "$REVIEW" | jq -r '.next_action')
  REFINE="이전 작업 미완료. 이슈:\n- $ISSUES\n다음 행동: $NEXT"
  
  opencode run --continue --model "$MODEL" --format json "$REFINE" \
    > "/tmp/oc-impl-${ID}-iter${ITER}.json"
  IMPL_FILE="/tmp/oc-impl-${ID}-iter${ITER}.json"
  ITER=$((ITER + 1))
done
```

## 보고

```
✅ Refinement loop 완료
- Iterations: 3/3
- Status: complete (iter 3)
- Issues fixed:
  - iter 1→2: null check 누락, 에러 핸들링 없음
  - iter 2→3: 테스트 커버리지 부족
- Final result: /tmp/oc-impl-12345-iter3.json
```

또는 max 도달 시:

```
⚠️ Refinement 미완료
- Iterations: 3/3 (max 도달)
- 마지막 status: incomplete
- 잔여 이슈: <목록>
- 권장: 사용자 수동 개입 또는 --escalate-on-fail 옵션 추가
```

## 비용 예시

V4 Pro 기준 1 iter ≈ $0.05~0.10:
- 3 iter = $0.15~0.30
- weekly $30 한도에서 100회 refinement loop 가능

K2.6 기준 1 iter ≈ $0.20~0.40 (크레딧 높음):
- 3 iter = $0.60~1.20
- weekly $30 한도에서 25~50회

## 권장

- **단순 작업**: max-iterations 1-2
- **복잡 multi-step**: max-iterations 3 (default)
- **예산 빠듯**: --escalate-on-fail 비활성, 1 iter 후 사용자에게 보고
