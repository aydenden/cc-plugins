---
name: stock-analysis
description: 종목 종합 분석 워크플로우. 가격, 수급, 재무, 공시, 뉴스를 통합 분석하여 매매 판단 제공. "종목 분석", "분석해줘", "[종목명] 어때" 등에 자동 활성화.
---

# 종목 종합 분석

## Workflow

### Step 1: 데이터 수집 (병렬)

대상 종목코드를 확인한 뒤, 아래 스크립트를 **동시에** 실행:

```bash
# 가격 데이터 (3개월 일봉)
bun run plugins/korean-trading/scripts/kis/ohlcv.ts {ticker}

# 투자자별 매매동향
bun run plugins/korean-trading/scripts/kis/investor-trend.ts {ticker}

# 공매도
bun run plugins/korean-trading/scripts/kis/short-sale.ts {ticker}

# 신용잔고
bun run plugins/korean-trading/scripts/kis/credit.ts {ticker}

# 재무비율 (PER/PBR/ROE)
bun run plugins/korean-trading/scripts/kis/financial-ratio.ts {ticker}

# 증권사 컨센서스
bun run plugins/korean-trading/scripts/kis/consensus.ts {ticker}

# DART 공시
bun run plugins/korean-trading/scripts/dart/disclosure.ts {ticker} disclosures

# 뉴스
bun run plugins/korean-trading/scripts/news/search.ts "{ticker} 주식" 5

# WICS 섹터
bun run plugins/korean-trading/scripts/market/sector.ts {ticker}
```

### Step 2: 기술적 분석

수집된 OHLCV 데이터에서:
- **추세**: 20일/60일 이동평균 대비 현재가 위치 → 상승/하락/횡보
- **거래량**: 최근 5일 평균 vs 20일 평균 → 거래량 증가/감소
- **지지/저항**: 최근 고점·저점에서 주요 가격대 식별

### Step 3: 수급 분석

투자자별 매매동향에서:
- 외국인 최근 5일 순매수/매도 추세
- 기관 최근 5일 순매수/매도 추세
- 공매도 비율 (>5% 이면 주의)
- 신용잔고 비율 (>3% 이면 반대매매 리스크)

### Step 4: 펀더멘탈 분석

- PER/PBR/ROE 현재값 및 추세
- 컨센서스 목표가 vs 현재가 괴리율
- 최근 공시 중 주가 영향 항목 요약

### Step 5: 종합 출력

```
## 기본 정보
종목: {종목명} ({ticker}) | 섹터: {섹터} | 현재가: {가격}원

## 기술적 분석
- 추세: {상승/하락/횡보} (이동평균 기준)
- 거래량: {증가/감소/보통}
- 지지/저항: {가격대}

## 수급 분석
| 주체 | 5일 순매수 | 해석 |
|------|----------|------|
| 외국인 | {수량} | {해석} |
| 기관 | {수량} | {해석} |
| 개인 | {수량} | {해석} |
- 공매도 비율: {값}% | 신용잔고: {값}%

## 펀더멘탈
- PER: {값} | PBR: {값} | ROE: {값}%
- 컨센서스: {목표가}원 (현재가 대비 {괴리율}%)

## 주요 이벤트
- {최근 공시/뉴스 3개}

## 종합 의견
- 매매 판단: {매수 유망 / 관망 / 매도 검토}
- 근거: {3줄 이내}
- 리스크: {1~2개}
```

## Important Notes

- 데이터 일부 실패 시 가용한 데이터로 판단, 누락 항목 명시
- 매매 판단은 참고용이며 투자 권유가 아님을 표기
