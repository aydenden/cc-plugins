# KIS API 엔드포인트 레퍼런스

## 공통 헤더

```
authorization: Bearer {token}
appkey: {KIS_APP_KEY}
appsecret: {KIS_APP_SECRET}
tr_id: {거래ID}
Content-Type: application/json; charset=utf-8
```

## 엔드포인트 목록

| 기능 | 엔드포인트 | TR ID |
|------|-----------|-------|
| 일봉 차트 | `/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice` | `FHKST03010100` |
| 지수 현재가 | `/uapi/domestic-stock/v1/quotations/inquire-index-price` | `FHPUP02100000` |
| 투자자별 매매 | `/uapi/domestic-stock/v1/quotations/invest-opbysec` | `FHKST663400C0` |
| 투자의견 | `/uapi/domestic-stock/v1/quotations/invest-opinion` | `FHKST663300C0` |
| 재무비율 | `/uapi/domestic-stock/v1/finance/financial-ratio` | `FHKST66430300` |

## 시장구분 코드

| 코드 | 의미 |
|------|------|
| J | 주식 (종목) |
| U | 지수 |

## 응답 구조

```json
{
  "rt_cd": "0",        // 0=성공
  "msg_cd": "...",
  "msg1": "...",
  "output": {...},     // 단일 결과
  "output2": [...]     // 목록 결과 (일봉 등)
}
```

## 에러 코드

| 코드 | 의미 | 대응 |
|------|------|------|
| `EGW00201` | Rate limit 초과 | 200ms 대기 후 재시도 |
| `OPSP0007` | 데이터 없음 | 정상 — 빈 결과 반환 |
| `OPSP0002` | 데이터 없음 | 정상 — 빈 결과 반환 |

## 주요 종목코드

| 코드 | 종목 | | 코드 | 종목 |
|------|------|-|------|------|
| 005930 | 삼성전자 | | 000660 | SK하이닉스 |
| 035420 | NAVER | | 035720 | 카카오 |
| 051910 | LG화학 | | 006400 | 삼성SDI |
| 068270 | 셀트리온 | | 055550 | 신한지주 |
| 000270 | 기아 | | 012330 | 현대모비스 |

## 지수 코드

| 코드 | 지수 |
|------|------|
| 0001 | KOSPI |
| 1001 | KOSDAQ |
| 2001 | KOSPI200 |

## Phase 6 신규 엔드포인트

### 종목 현재가

- **URL**: `/uapi/domestic-stock/v1/quotations/inquire-price`
- **TR ID**: `FHKST01010100`
- **파라미터**: `FID_COND_MRKT_DIV_CODE=J`, `FID_INPUT_ISCD={종목코드}`
- **주요 응답**: `stck_prpr`(현재가), `hts_avls`(시가총액), `per`, `pbr`, `stck_sdpr`(52주최저), `stck_mxpr`(52주최고), `frgn_ntby_qty`(외국인순매수)
- **비고**: 장중 실시간, 장 종료 후 종가 기준

### 거래량 순위

- **URL**: `/uapi/domestic-stock/v1/quotations/volume-rank`
- **TR ID**: `FHPST01710000`
- **파라미터**: `FID_COND_MRKT_DIV_CODE=J|Q`(J=코스피, Q=코스닥), `FID_INPUT_ISCD=0000`(전체), `FID_VOL_CNT=0`
- **주요 응답**: `output[]` — `mksc_shrn_iscd`(종목코드), `hts_kor_isnm`(종목명), `stck_prpr`(현재가), `prdy_ctrt`(등락률), `acml_vol`(누적거래량)
- **비고**: 상위 30종목 반환

### 등락률 순위

- **URL**: `/uapi/domestic-stock/v1/ranking/fluctuation`
- **TR ID**: `FHPST01700000`
- **파라미터**: `FID_COND_MRKT_DIV_CODE=J|Q`, `FID_COND_SCR_DIV_CODE=20170` (상승) / `20171` (하락), `FID_INPUT_ISCD=0000`
- **주요 응답**: `output[]` — `mksc_shrn_iscd`, `hts_kor_isnm`, `stck_prpr`, `prdy_ctrt`(등락률%), `acml_vol`
- **비고**: 상한가/하한가 종목 포함

### 시가총액 순위

- **URL**: `/uapi/domestic-stock/v1/ranking/market-cap`
- **TR ID**: `FHPST01740000`
- **파라미터**: `FID_COND_MRKT_DIV_CODE=J|Q`, `FID_INPUT_ISCD=0000`
- **주요 응답**: `output[]` — `mksc_shrn_iscd`, `hts_kor_isnm`, `stck_prpr`, `hts_avls`(시가총액), `per`, `pbr`
- **비고**: 시총 내림차순 정렬

### 외국인/기관 순매수 상위

- **URL**: `/uapi/domestic-stock/v1/quotations/foreign-institution-total`
- **TR ID**: `FHPTJ04400000`
- **파라미터**: `FID_COND_MRKT_DIV_CODE=V`(전체), `FID_INPUT_ISCD=0000`, `FID_BLNG_CLS_CODE=0`(외국인) / `1`(기관), `FID_TRGT_CLS_CODE=1`(순매수) / `2`(순매도)
- **주요 응답**: `output[]` — `mksc_shrn_iscd`, `hts_kor_isnm`, `stck_prpr`, `frgn_ntby_qty`(순매수수량), `total_askp_rsqn`(매도잔량)
- **비고**: 당일 기준, 장중 실시간 업데이트

### 당일 분봉

- **URL**: `/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice`
- **TR ID**: `FHKST03010200`
- **파라미터**: `FID_COND_MRKT_DIV_CODE=J`, `FID_INPUT_ISCD={종목코드}`, `FID_INPUT_HOUR1={HHMMSS}`, `FID_PW_DATA_INCU_YN=Y`
- **주요 응답**: `output2[]` — `stck_cntg_hour`(체결시각), `stck_oprc`(시가), `stck_hgpr`(고가), `stck_lwpr`(저가), `stck_prpr`(현재가), `cntg_vol`(체결거래량)
- **비고**: 장중에만 유효, 장 마감 후 조회 시 당일 마지막 데이터

### 해외주식 현재가

- **URL**: `/uapi/overseas-price/v1/quotations/price`
- **TR ID**: `HHDFS00000300`
- **파라미터**: `AUTH=`, `EXCD={거래소코드}`, `SYMB={종목코드}`
- **거래소 코드**: `NAS`(나스닥), `NYS`(뉴욕), `AMS`(아멕스), `HKS`(홍콩), `TSE`(도쿄)
- **주요 응답**: `output` — `last`(현재가), `rate`(등락률), `tvol`(거래량), `t_xprc`(52주최고), `t_xdif`(52주최저), `e_icod`(업종)
- **비고**: 해당 거래소 영업시간 외 조회 시 전일 종가

### 해외주식 일봉/주봉/월봉

- **URL**: `/uapi/overseas-price/v1/quotations/dailyprice`
- **TR ID**: `HHDFS76240000`
- **파라미터**: `AUTH=`, `EXCD={거래소코드}`, `SYMB={종목코드}`, `GUBN=0`(일봉)/`1`(주봉)/`2`(월봉), `BYMD={YYYYMMDD}`(기준일)
- **주요 응답**: `output2[]` — `xymd`(날짜), `open`(시가), `high`(고가), `low`(저가), `clos`(종가), `tvol`(거래량)
- **비고**: 최근 100건, BYMD 생략 시 최근 데이터
