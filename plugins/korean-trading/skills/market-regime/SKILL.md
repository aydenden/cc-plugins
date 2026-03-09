---
name: market-regime
description: 시장 레짐 판단 워크플로우. VKOSPI, VIX, 금리, 환율 기반으로 4단계 레짐 진단. "시장 상태", "레짐", "지금 매매해도 되나" 등에 자동 활성화.
---

# 시장 레짐 판단

## Workflow

### Step 1: 데이터 수집 (병렬)

```bash
# VKOSPI
node plugins/korean-trading/dist/krx/vkospi.js

# 글로벌 (VIX, 달러, 환율, 금리)
node plugins/korean-trading/dist/market/overnight.js

# KOSPI/KOSDAQ 지수
node plugins/korean-trading/dist/kis/index-price.js

# 한국 매크로 (기준금리, 국고채)
node plugins/korean-trading/dist/ecos/indicators.js all

# 미국 장단기 스프레드
node plugins/korean-trading/dist/fred/indicators.js T10Y2Y

# 연방기금금리
node plugins/korean-trading/dist/fred/indicators.js FEDFUNDS
```

### Step 2: 레짐 판단

#### 1차 판단: 변동성 기준

| 레짐 | VKOSPI | VIX | 기본 투자비중 |
|------|--------|-----|-------------|
| 강세 | <15 | <15 | 80% |
| 보통 | 15~25 | 15~25 | 60% |
| 약세 | 25~35 | 25~35 | 30% |
| 위기 | >35 | >35 | 10% |

VKOSPI와 VIX가 다른 레짐을 가리키면 더 보수적인 쪽을 채택.

#### 2차 조정: 보조 지표

- 원/달러 환율 5일 변동률 > 2% → 한 단계 약세 가중
- T10Y2Y < 0 (장단기 역전) → 한 단계 약세 가중
- FEDFUNDS 인하 추세 → 한 단계 강세 가중
- 하이일드 스프레드 > 400bp → 한 단계 약세 가중

### Step 3: 출력

```
## 현재 시장 레짐: {강세/보통/약세/위기}

| 지표 | 값 | 시그널 |
|------|---|--------|
| VKOSPI | {값} | {해석} |
| VIX | {값} | {해석} |
| 원/달러 | {값} | {해석} |
| 미 장단기 스프레드 | {값} | {해석} |
| 연방기금금리 | {값} | {해석} |
| KOSPI | {값} ({등락률}) | {해석} |
| KOSDAQ | {값} ({등락률}) | {해석} |

## 권장 사항
- 최대 투자비중: {비중}%
- 종목당 최대 비중: {비중}%
- 전략: {1~2줄}
```

## Important Notes

- 레짐 판단은 당일 기준, 급변 시 장중에도 재확인 필요
- "보통" 레짐이 가장 빈도 높음 — 이때 과신하지 않도록 주의
