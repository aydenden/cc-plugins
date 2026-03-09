---
name: stock-screening
description: 종목 스크리닝 워크플로우. 여러 종목의 핵심 지표를 비교하여 매력도 순위 제공. "비교", "스크리닝", "어떤 종목이 나은지" 등에 자동 활성화.
---

# 종목 스크리닝

## Workflow

### Step 1: 시장 전체 랭킹 조회 (선택적)

사용자가 특정 종목을 지정하지 않았거나 "오늘 뭐가 좋아?" 류의 질문인 경우, 랭킹 API로 후보를 선정:

```bash
# 거래량 상위 — 시장 관심 종목 파악
node plugins/korean-trading/dist/kis/volume-rank.js

# 등락률 상위 — 모멘텀 종목 파악
node plugins/korean-trading/dist/kis/fluctuation-rank.js

# 시가총액 상위 — 대형주 중심 안정 후보
node plugins/korean-trading/dist/kis/market-cap-rank.js

# 외국인/기관 순매수 상위 — 스마트머니 흐름
node plugins/korean-trading/dist/kis/foreign-institution-total.js
```

위 결과에서 2개 이상 랭킹에 중복 등장하는 종목을 우선 후보로 선정.

### Step 2: 대상 종목 확인

사용자가 제공한 종목코드 목록을 파싱하거나, Step 1에서 선정된 후보 목록을 사용.

### Step 3: 데이터 수집 (종목별 병렬)

각 종목에 대해 아래 스크립트를 **동시에** 실행:

```bash
# 각 종목마다:
node plugins/korean-trading/dist/kis/current-price.js {ticker}   # 현재가, 시총, PER/PBR, 52주 고저
node plugins/korean-trading/dist/kis/ohlcv.js {ticker}
node plugins/korean-trading/dist/kis/investor-trend.js {ticker}
node plugins/korean-trading/dist/kis/financial-ratio.js {ticker}
node plugins/korean-trading/dist/market/sector.js {ticker}
```

### Step 4: 비교 테이블 작성

수집된 데이터에서 핵심 지표를 추출하여 비교:

```
| 항목 | {종목1} | {종목2} | ... |
|------|---------|---------|-----|
| 현재가 | | | |
| 시가총액 | | | |
| 52주 고점 대비 | | | |
| 등락률 (1일) | | | |
| 등락률 (1주) | | | |
| 등락률 (1개월) | | | |
| 거래량 (20일 대비) | | | |
| 외국인 5일 순매수 | | | |
| 기관 5일 순매수 | | | |
| PER | | | |
| PBR | | | |
| ROE | | | |
| 섹터 | | | |
```

### Step 5: 매력도 평가

3개 축으로 점수화:
- **수급 (40%)**: 외국인+기관 순매수 강도
- **모멘텀 (30%)**: 1주/1개월 수익률 + 거래량 추세
- **밸류에이션 (30%)**: PER/PBR 대비 ROE 효율

### Step 6: 순위 출력

```
## 종합 순위
1. {종목} — {한줄 근거}
2. {종목} — {한줄 근거}
...

## 주의 종목
- {리스크 있는 종목}: {리스크 사유}
```

## Important Notes

- 동일 섹터 종목 비교 시 섹터 평균 PER/PBR도 언급
- 최대 10종목까지 비교 (초과 시 분할 요청)
