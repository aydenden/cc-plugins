---
name: kis-market-data
description: KIS(한국투자증권) API를 통한 국내 주식 시장 데이터 조회. 일봉, 투자자동향, 공매도, 신용잔고, 재무비율, 지수, 프로그램매매, 컨센서스, 선물 데이터 조회 시 자동 활성화.
---

# KIS 시장 데이터

## 필요 환경변수

- `KIS_APP_KEY`: 한국투자증권 앱 키
- `KIS_APP_SECRET`: 한국투자증권 앱 시크릿

토큰은 자동으로 `~/.cache/claude-plugins/korean-trading/kis/token.json`에 캐시됩니다.

## 스크립트 호출법

```bash
# 일봉/주봉/월봉 OHLCV
bun run plugins/korean-trading/scripts/kis/ohlcv.ts 005930          # 삼성전자 3개월 일봉
bun run plugins/korean-trading/scripts/kis/ohlcv.ts 005930 W        # 주봉
bun run plugins/korean-trading/scripts/kis/ohlcv.ts 005930 D 20240101 20241231  # 기간지정

# 투자자별 매매동향 (외국인/기관/개인)
bun run plugins/korean-trading/scripts/kis/investor-trend.ts 005930

# 공매도 현황
bun run plugins/korean-trading/scripts/kis/short-sale.ts 005930

# 신용잔고
bun run plugins/korean-trading/scripts/kis/credit.ts 005930

# 재무비율 (PER/PBR/ROE/EPS)
bun run plugins/korean-trading/scripts/kis/financial-ratio.ts 005930

# KOSPI/KOSDAQ 지수
bun run plugins/korean-trading/scripts/kis/index-price.ts          # 전체
bun run plugins/korean-trading/scripts/kis/index-price.ts 0001     # KOSPI만

# 프로그램매매 동향
bun run plugins/korean-trading/scripts/kis/program-trade.ts 005930

# 증권사 컨센서스 (투자의견/목표가)
bun run plugins/korean-trading/scripts/kis/consensus.ts 005930

# 선물/옵션 (KOSPI200)
bun run plugins/korean-trading/scripts/kis/futures.ts
```

## 해석 가이드

### 투자자별 매매동향
- 외국인 연속 순매수 + 기관 순매수 → 강한 매수 시그널
- 외국인 순매도 + 개인 순매수 → 주의 (개미 물타기 가능성)
- 외국인 매매 금액 > 기관 매매 금액 → 외국인 주도 장세

### 공매도
- short_ratio > 5% → 과도한 공매도, 숏커버링 반등 가능
- 공매도 감소 + 주가 상승 → 건전한 상승 추세

### 신용잔고
- credit_rate > 3% → 높은 신용 비율, 반대매매 리스크
- 신용잔고 급증 + 주가 하락 → 투매 위험

### 재무비율
- PER < 업종 평균의 70% → 저평가 가능성
- PBR < 1 → 자산가치 대비 저평가
- ROE > 15% → 자본효율성 우수

### 컨센서스
- 목표가 상향 조정 추세 → 긍정적
- "매수" → "중립" 하향 → 경고 시그널

## 주요 종목코드

| 코드 | 종목명 | | 코드 | 종목명 |
|------|--------|--|------|--------|
| 005930 | 삼성전자 | | 000660 | SK하이닉스 |
| 035420 | NAVER | | 035720 | 카카오 |
| 051910 | LG화학 | | 006400 | 삼성SDI |
| 068270 | 셀트리온 | | 055550 | 신한지주 |
| 000270 | 기아 | | 012330 | 현대모비스 |
