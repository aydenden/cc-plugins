---
name: global-commodities
description: 글로벌 원자재 시세 분석. "원자재", "유가", "원유", "구리", "commodities", "WTI" 등에 자동 활성화
---

# 글로벌 원자재 시세 분석

## Workflow

### Step 1: 원자재 데이터 수집

```bash
# 에너지
node plugins/korean-trading/dist/alphavantage/commodities.js WTI daily
node plugins/korean-trading/dist/alphavantage/commodities.js BRENT daily
node plugins/korean-trading/dist/alphavantage/commodities.js NATURAL_GAS daily

# 금속
node plugins/korean-trading/dist/alphavantage/commodities.js COPPER daily
node plugins/korean-trading/dist/alphavantage/commodities.js ALUMINUM daily

# 농산물
node plugins/korean-trading/dist/alphavantage/commodities.js WHEAT daily
node plugins/korean-trading/dist/alphavantage/commodities.js CORN daily
```

**주의**: Alpha Vantage 무료 계정은 일 25회, 분 5회 제한. 필요한 원자재만 선택적으로 조회.

### Step 2: 추세 분석

각 원자재별:
1. 최근 1개월 변동률
2. 최근 3개월 변동률
3. 전년 동기 대비 (YoY)
4. 추세 방향: 상승/보합/하락

### Step 3: 한국 시장 영향 분석

| 원자재 | 상승 시 영향 | 관련 섹터 |
|--------|------------|----------|
| WTI/BRENT | 정유/화학 실적↑, 운송비↑ | 에너지, 화학, 항공, 해운 |
| 천연가스 | 가스공사 원가↑, LNG 수입가↑ | 가스, 전력 |
| 구리 | 전선/케이블 원가↑, 건설경기 지표 | 비철금속, 건설, 전기전자 |
| 알루미늄 | 포장/건자재 원가↑ | 비철금속, 자동차 |
| 밀/옥수수 | 식품 원가↑, 사료가격↑ | 식품, 축산 |

### Step 4: 환율 연동 확인

```bash
# 환율 데이터
node plugins/korean-trading/dist/koreaexim/exchange-rate.js
```

- 원자재는 달러 표시 → 원/달러 환율에 따라 실질 영향 변동
- 원화 약세 + 원자재 상승 = 이중 부담

### Step 5: 결과 출력

```
## 글로벌 원자재 현황

### 에너지
| 원자재 | 현재가 | 단위 | 1M 변동 | 3M 변동 | 추세 |
|--------|--------|------|---------|---------|------|
| WTI 원유 | $XX.XX | $/bbl | ...% | ...% | ↑/→/↓ |
| 브렌트 원유 | $XX.XX | $/bbl | ...% | ...% | ↑/→/↓ |
| 천연가스 | $X.XX | $/MMBtu | ...% | ...% | ↑/→/↓ |

### 금속
| 원자재 | 현재가 | 단위 | 1M 변동 | 3M 변동 | 추세 |
|--------|--------|------|---------|---------|------|
| 구리 | $X,XXX | $/mt | ...% | ...% | ↑/→/↓ |
| 알루미늄 | $X,XXX | $/mt | ...% | ...% | ↑/→/↓ |

### 농산물
| 원자재 | 현재가 | 단위 | 1M 변동 | 3M 변동 | 추세 |
|--------|--------|------|---------|---------|------|
| 밀 | $XXX | cents/bu | ...% | ...% | ↑/→/↓ |
| 옥수수 | $XXX | cents/bu | ...% | ...% | ↑/→/↓ |

### 한국 시장 시사점
- {영향 분석}
```

## Important Notes

- Alpha Vantage 일 25회 제한 — 모든 원자재를 한번에 조회하면 7회 소모
- 에너지만 조회하면 3회, 주요 3개(WTI, 구리, 밀)만 조회하면 3회
- 주말/휴일에는 최근 영업일 데이터 반환
- 매매 추천이 아님, 투자 판단은 사용자 책임
