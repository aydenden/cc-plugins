---
name: morning-brief
description: 장 전 모닝 브리핑 워크플로우. 글로벌 오버나이트, 한국 매크로, VKOSPI, 시장 레짐을 종합 분석. "모닝브리핑", "장 전", "오늘 시장", "오버나이트" 등에 자동 활성화.
---

# 모닝 브리핑

## Workflow

### Step 1: 데이터 수집 (병렬)

아래 스크립트를 **동시에** 실행하여 수집:

```bash
# 글로벌 오버나이트 (VIX, 달러, 환율, 금리)
bun run plugins/korean-trading/scripts/market/overnight.ts

# VKOSPI 변동성지수
bun run plugins/korean-trading/scripts/krx/vkospi.ts

# KOSPI/KOSDAQ 지수
bun run plugins/korean-trading/scripts/kis/index-price.ts

# 한국 매크로 (기준금리, 국고채, CPI, 실업률)
bun run plugins/korean-trading/scripts/ecos/indicators.ts all

# 해외 주요 ETF 현재가 (글로벌 시장 흐름)
bun run plugins/korean-trading/scripts/kis/overseas-price.ts NAS SPY    # S&P500
bun run plugins/korean-trading/scripts/kis/overseas-price.ts NAS QQQ    # NASDAQ
bun run plugins/korean-trading/scripts/kis/overseas-price.ts NYS EWY    # Korea ETF

# 해외 ETF 추세 확인 (일봉)
bun run plugins/korean-trading/scripts/kis/overseas-daily.ts NAS SPY
bun run plugins/korean-trading/scripts/kis/overseas-daily.ts NAS QQQ
```

### Step 2: 레짐 판단

수집된 데이터로 시장 레짐을 판단:

| 레짐 | VKOSPI | VIX | 권장 투자비중 |
|------|--------|-----|-------------|
| 강세 | <15 | <15 | 80% |
| 보통 | 15~25 | 15~25 | 60% |
| 약세 | 25~35 | 25~35 | 30% |
| 위기 | >35 | >35 | 10% |

보조 판단:
- 원/달러 5일 변동 >2% → 약세 가중
- 하이일드 스프레드 >400bp → 약세 가중

### Step 3: 브리핑 출력

아래 형식으로 작성 — 2분 내 읽을 수 있는 분량:

```
## 글로벌 오버나이트
- VIX: {값} ({해석})
- 달러지수: {값}
- 원/달러: {값} ({전일 대비})
- 미 10년물: {값}

## 글로벌 시장
| 지수 | 종가 | 등락률 | 5일 추세 |
|------|------|--------|---------|
| S&P500 (SPY) | ${값} | {등락률}% | {추세} |
| NASDAQ (QQQ) | ${값} | {등락률}% | {추세} |
| Korea ETF (EWY) | ${값} | {등락률}% | {추세} |
- EWY 등락률 vs KOSPI 등락률 괴리 → 외국인 자금 유출입 시그널

## 한국 시장
- KOSPI: {값} ({등락률})
- KOSDAQ: {값} ({등락률})
- VKOSPI: {값} ({레짐 레벨})

## 매크로 환경
- 한국 기준금리: {값}
- 장단기 스프레드(10Y-2Y): {값} ({해석})

## 오늘의 시장 레짐: {강세/보통/약세/위기}
- 근거: {1~2줄}
- 최대 권장 투자비중: {비중}%

## 주의사항
- {오늘 특별히 주의할 점 1~2개}
```

## Important Notes

- 데이터 수집 실패 시 해당 항목을 "N/A"로 표시하고 나머지로 판단
- 장 시작 전(08:00~09:00) 호출 기준으로 설계됨
- VIX/환율은 전일 종가 기준
