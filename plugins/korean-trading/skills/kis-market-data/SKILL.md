---
name: kis-market-data
description: KIS(한국투자증권) API를 통한 국내/해외 주식 시장 데이터 조회. 일봉, 투자자동향, 공매도, 신용잔고, 재무비율, 지수, 프로그램매매, 컨센서스, 선물, 현재가, 거래량순위, 등락률순위, 시총순위, 외국인/기관순매수, 분봉, 해외주식 데이터 조회 시 자동 활성화.
---

# KIS 시장 데이터

## 필요 환경변수

- `KIS_APP_KEY`: 한국투자증권 앱 키
- `KIS_APP_SECRET`: 한국투자증권 앱 시크릿

토큰은 자동으로 `~/.cache/claude-plugins/korean-trading/kis/token.json`에 캐시됩니다.

## 스크립트 호출법

```bash
# 일봉/주봉/월봉 OHLCV
node plugins/korean-trading/dist/kis/ohlcv.js 005930          # 삼성전자 3개월 일봉
node plugins/korean-trading/dist/kis/ohlcv.js 005930 W        # 주봉
node plugins/korean-trading/dist/kis/ohlcv.js 005930 D 20240101 20241231  # 기간지정

# 투자자별 매매동향 (외국인/기관/개인)
node plugins/korean-trading/dist/kis/investor-trend.js 005930

# 공매도 현황
node plugins/korean-trading/dist/kis/short-sale.js 005930

# 신용잔고
node plugins/korean-trading/dist/kis/credit.js 005930

# 재무비율 (PER/PBR/ROE/EPS)
node plugins/korean-trading/dist/kis/financial-ratio.js 005930

# KOSPI/KOSDAQ 지수
node plugins/korean-trading/dist/kis/index-price.js          # 전체
node plugins/korean-trading/dist/kis/index-price.js 0001     # KOSPI만

# 프로그램매매 동향
node plugins/korean-trading/dist/kis/program-trade.js 005930

# 증권사 컨센서스 (투자의견/목표가)
node plugins/korean-trading/dist/kis/consensus.js 005930

# 선물/옵션 (KOSPI200)
node plugins/korean-trading/dist/kis/futures.js

# --- Phase 6: 현재가/랭킹/분봉/해외주식 ---

# 종목 현재가 (가격, 시총, PER/PBR, 52주 고저, 외국인순매수)
node plugins/korean-trading/dist/kis/current-price.js 005930

# 거래량 순위 (코스피/코스닥)
node plugins/korean-trading/dist/kis/volume-rank.js              # 코스피 기본
node plugins/korean-trading/dist/kis/volume-rank.js kosdaq       # 코스닥

# 등락률 순위 (상승/하락)
node plugins/korean-trading/dist/kis/fluctuation-rank.js         # 상승 상위
node plugins/korean-trading/dist/kis/fluctuation-rank.js down    # 하락 상위

# 시가총액 순위
node plugins/korean-trading/dist/kis/market-cap-rank.js          # 코스피 기본
node plugins/korean-trading/dist/kis/market-cap-rank.js kosdaq   # 코스닥

# 외국인/기관 순매수 상위
node plugins/korean-trading/dist/kis/foreign-institution-total.js          # 외국인 순매수 상위
node plugins/korean-trading/dist/kis/foreign-institution-total.js sell     # 외국인 순매도 상위
node plugins/korean-trading/dist/kis/foreign-institution-total.js buy inst # 기관 순매수 상위

# 당일 분봉 (장중만 유효)
node plugins/korean-trading/dist/kis/minute-chart.js 005930      # 1분봉 기본
node plugins/korean-trading/dist/kis/minute-chart.js 005930 5    # 5분봉
node plugins/korean-trading/dist/kis/minute-chart.js 005930 30   # 30분봉

# 해외주식 현재가 (NAS/NYS/AMS/HKS/TSE)
node plugins/korean-trading/dist/kis/overseas-price.js NAS AAPL   # 나스닥 애플
node plugins/korean-trading/dist/kis/overseas-price.js NYS SPY    # NYSE SPY
node plugins/korean-trading/dist/kis/overseas-price.js HKS 00700  # 홍콩 텐센트
node plugins/korean-trading/dist/kis/overseas-price.js TSE 7203   # 도쿄 도요타

# 해외주식 일봉/주봉/월봉
node plugins/korean-trading/dist/kis/overseas-daily.js NAS AAPL          # 일봉 기본
node plugins/korean-trading/dist/kis/overseas-daily.js NAS AAPL W        # 주봉
node plugins/korean-trading/dist/kis/overseas-daily.js NYS SPY M         # 월봉
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

### 현재가 데이터
- 52주 고점 대비 -20% 이상 → 과매도 구간 가능
- 외국인 순매수 양수 + 기관 순매수 양수 → 수급 우호적
- PER/PBR이 현재가 기준 실시간 → 재무비율 스크립트보다 최신

### 랭킹 데이터
- 거래량 상위 = 시장 관심 종목, 변동성 큼
- 등락률 상위 = 테마/이슈 관련 가능성, 추격매수 주의
- 시총 상위 = 대형주 중심, 안정적 수급
- 외국인/기관 순매수 상위 = 스마트머니 흐름, 중기 추세 참고

### 분봉 (장중 전용)
- 장 시작 직후(09:00~09:30) 분봉은 변동성 과대 → 해석 주의
- 거래량 동반 가격 이탈 시 의미 있는 돌파

### 해외주식
- 거래소 코드: NAS(나스닥), NYS(뉴욕), AMS(아멕스), HKS(홍콩), TSE(도쿄)
- 해외 시간대 주의: 미국장 09:30~16:00 ET, 한국시간 23:30~06:00
- 해외 현재가는 해당 거래소 영업시간 외 조회 시 전일 종가 반환

## 주요 종목코드

| 코드 | 종목명 | | 코드 | 종목명 |
|------|--------|--|------|--------|
| 005930 | 삼성전자 | | 000660 | SK하이닉스 |
| 035420 | NAVER | | 035720 | 카카오 |
| 051910 | LG화학 | | 006400 | 삼성SDI |
| 068270 | 셀트리온 | | 055550 | 신한지주 |
| 000270 | 기아 | | 012330 | 현대모비스 |
