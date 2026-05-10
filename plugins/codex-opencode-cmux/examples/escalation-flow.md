# Escalation Flow — 대량 작업 + 모델 승격

## 시나리오
사용자가 "30개 API 엔드포인트 CRUD 자동 생성" 요청. 대량 작업이므로 V4 Flash로 1차 시도, stuck 시 K2.6 승격.

## 라우팅 결정

```bash
$ ./bin/route-task.sh "30개 API 엔드포인트 CRUD 자동 생성"
opencode-go/deepseek-v4-flash
```
- "30개" → bulk 키워드 매칭
- bulk → V4 Flash (최저 크레딧 소비)

## 1차 시도 (V4 Flash)

```bash
$ ${CLAUDE_PLUGIN_ROOT}/bin/co-dispatch.sh \
    --task "30개 API 엔드포인트 CRUD 자동 생성" \
    --mode cmux
```

V4 Flash가 5분 동안 실행 후 일부 엔드포인트에서 stuck (`"type":"error"` 이벤트).

```
[dispatch] mode=cmux
[dispatch] model=opencode-go/deepseek-v4-flash
[dispatch] budget=58%
[dispatch] codex planning...
[dispatch] opencode (cmux mode) running...
[dispatch] cmux wait-for timeout (600s)
[dispatch] V4 Flash failed, escalating to K2.6
```

cmux 사이드바:
```
[escalation] K2.6 fallback   🟧 #ff9500
log [warn]: escalating to kimi-k2.6
```

## 2차 시도 (K2.6 자동 승격)

```bash
# co-dispatch.sh가 내부적으로 self-recursion:
${CLAUDE_PLUGIN_ROOT}/bin/co-dispatch.sh \
  --task "30개 API 엔드포인트 CRUD 자동 생성" \
  --model opencode-go/kimi-k2.6 \
  --mode cmux \
  --escalated
```

K2.6은 13h 4000+ tool calls 검증 모델 → stuck 없이 완료.

```
✅ Dispatch complete
- Task: 30개 API 엔드포인트 CRUD 자동 생성
- Model: opencode-go/kimi-k2.6 (escalated from V4 Flash)
- Pattern: cmux
- Iterations: 1/3
...
```

## 주의

- 한 번 escalation 한 작업에 대해 2차 escalation은 발생하지 않음 (`--escalated` 플래그가 재호출 차단).
- Escalation은 cmux `log --level warn` 으로 기록되어 추후 분석 가능.
- 크레딧 소비: V4 Flash 1회 + K2.6 1회 = 2회. weekly $30 한도에서 ~$0.10 + ~$0.40 = ~$0.50 추정.

## 권장 사용 패턴

| 작업 규모 | 1차 모델 | 2차 (escalation) |
|---|---|---|
| 1-10 파일 단순 | V4 Flash | (필요 시 V4 Pro 수동 override) |
| 대량 반복 작업 | V4 Flash → **자동 K2.6** | - |
| 복잡 multi-step | K2.6 또는 V4 Pro 직접 지정 | (escalation 불필요) |
| 짧은 추론 | V4 Pro | - |
