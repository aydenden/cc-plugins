# Korean Trading Plugin

한국 주식 단타 트레이딩 분석 도구. KIS, KRX, DART, ECOS, FRED, Naver API 기반으로 시장 데이터를 조회하고, Claude가 매매 판단을 지원합니다.

## 설치

```bash
# 마켓플레이스로 설치
/plugin marketplace add aydenden/cc-plugins

# 또는 단독 플러그인으로 실행
claude --plugin-dir ./plugins/korean-trading
```

## API 키 설정

`~/.claude/settings.local.json`의 `env` 필드에 API 키를 등록합니다. Claude Code가 자동으로 환경변수를 주입합니다.

```json
{
  "env": {
    "KIS_APP_KEY": "your-kis-app-key",
    "KIS_APP_SECRET": "your-kis-app-secret",
    "KRX_API_KEY": "your-krx-api-key",
    "ECOS_API_KEY": "your-ecos-api-key",
    "FRED_API_KEY": "your-fred-api-key",
    "DART_API_KEY": "your-dart-api-key",
    "NAVER_CLIENT_ID": "your-naver-client-id",
    "NAVER_CLIENT_SECRET": "your-naver-client-secret",
    "KOREAEXIM_API_KEY": "your-koreaexim-api-key",
    "DATA_GO_KR_API_KEY": "your-data-go-kr-api-key",
    "ALPHA_VANTAGE_API_KEY": "your-alpha-vantage-api-key"
  }
}
```

### API 키 발급처

| API | 발급 URL | 용도 |
|-----|---------|------|
| **KIS** | https://apiportal.koreainvestment.com | 주가, 수급, 재무, 컨센서스 |
| **KRX** | https://data.krx.co.kr | VKOSPI, 섹터별 지수 |
| **ECOS** | https://ecos.bok.or.kr/api | 기준금리, 국고채, CPI, 실업률 |
| **FRED** | https://fred.stlouisfed.org/docs/api/api_key.html | VIX, 달러지수, 미 국채, 환율 |
| **DART** | https://opendart.fss.or.kr | 기업 공시, 재무제표 |
| **Naver** | https://developers.naver.com/apps | 뉴스 검색 |
| **한국수출입은행** | https://www.koreaexim.go.kr/ir/HPHKIR020M01?apino=2 | 환율 |
| **공공데이터포털** | https://www.data.go.kr/ | FSC 채권시세, 시장지수 |
| **Alpha Vantage** | https://www.alphavantage.co/support/#api-key | 원자재 시세 (WTI, 구리 등) |

> 모든 키가 필요하지는 않습니다. 필요한 데이터 소스의 키만 등록하면 해당 기능만 사용할 수 있습니다.

### Cowork 환경 (Claude Desktop)

Cowork VM에서는 `settings.json`의 환경변수가 전달되지 않습니다. 대신 **바인딩 폴더**에 `trading-env.json` 파일을 생성하세요.

1. Cowork 세션 생성 시 폴더를 바인딩합니다 (예: `~/stock`)
2. 해당 폴더에 `trading-env.json` 파일을 생성합니다:

```json
{
  "KIS_APP_KEY": "your-kis-app-key",
  "KIS_APP_SECRET": "your-kis-app-secret",
  "KRX_API_KEY": "",
  "ECOS_API_KEY": "",
  "FRED_API_KEY": "",
  "DART_API_KEY": "",
  "NAVER_CLIENT_ID": "",
  "NAVER_CLIENT_SECRET": "",
  "KOREAEXIM_API_KEY": "",
  "DATA_GO_KR_API_KEY": "",
  "ALPHA_VANTAGE_API_KEY": ""
}
```

> 파일명은 반드시 `trading-env.json`이어야 합니다. 사용할 API의 키만 입력하고 나머지는 빈 문자열로 두면 됩니다.

스크립트가 OS 환경변수에서 키를 찾지 못하면 자동으로 `/mnt/*/trading-env.json`을 탐색하여 로드합니다.

### KIS 토큰 관리

KIS는 OAuth2 토큰이 필요합니다. 플러그인이 자동으로 처리합니다:

1. 첫 호출 시 `KIS_APP_KEY` + `KIS_APP_SECRET`으로 토큰 발급
2. `~/.cache/claude-plugins/korean-trading/kis/token.json`에 캐시 (23시간)
3. 만료 10분 전 자동 갱신
4. 동시 실행 시 mkdir 기반 lock으로 중복 발급 방지

## 사전 요구사항

- [Bun](https://bun.sh) 런타임 (v1.0 이상)

```bash
# macOS
brew install oven-sh/bun/bun

# 또는
curl -fsSL https://bun.sh/install | bash
```

## 커맨드

| 커맨드 | 설명 | 예시 |
|--------|------|------|
| `/korean-trading:morning-brief` | 장 전 모닝 브리핑 | 글로벌 오버나이트 + 한국 매크로 + VKOSPI + 레짐 |
| `/korean-trading:analyze` | 종목 종합 분석 | `/korean-trading:analyze 005930` |
| `/korean-trading:entry-check` | 매수 진입 5단 체크 | `/korean-trading:entry-check 005930 72000 69000` |
| `/korean-trading:regime` | 시장 레짐 판단 | VIX, VKOSPI, 금리, 환율 기반 4단계 진단 |
| `/korean-trading:scan` | 종목 스크리닝 | `/korean-trading:scan 005930 000660 035420` |
| `/korean-trading:review` | 매매 복기 | `/korean-trading:review 005930 20240301 72000 20240315 75000 100` |

## 스킬 (자동 활성화)

커맨드 없이도 대화 맥락에 따라 자동으로 활성화되는 스킬입니다.

### 워크플로우 스킬

| 스킬 | 트리거 예시 |
|------|-----------|
| `morning-brief` | "오늘 장 전 브리핑 해줘" |
| `stock-analysis` | "삼성전자 분석해줘" |
| `entry-check` | "이 종목 매수해도 될까?" |
| `market-regime` | "지금 시장 상태 어때?" |
| `stock-screening` | "삼성전자랑 SK하이닉스 비교해줘" |
| `trade-review` | "지난 매매 복기 해줘" |

### 데이터소스 스킬

| 스킬 | 트리거 예시 |
|------|-----------|
| `kis-market-data` | "삼성전자 외국인 수급 확인해줘" |
| `fred-macro` | "미국 금리 어떻게 되고 있어?" |
| `ecos-macro` | "한국 기준금리 추이 보여줘" |
| `krx-index` | "VKOSPI 얼마야?" |
| `dart-disclosure` | "삼성전자 최근 공시 뭐 있어?" |
| `risk-sizing` | "10만원 투자하면 몇 주 사야 돼?" |
| `global-commodities` | "원유 가격 어때?", "구리 시세 확인해줘" |
| `dcf-valuation` | "삼성전자 DCF 분석해줘" |
| `peer-comps` | "반도체 섹터 밸류에이션 비교해줘" |
| `earnings-analysis` | "삼성전자 실적 분석해줘" |
| `3-statements` | "삼성전자 재무제표 보여줘" |

## 스크립트 직접 실행

스킬/커맨드를 거치지 않고 스크립트를 직접 실행할 수도 있습니다.

```bash
# FRED 지표
bun run plugins/korean-trading/scripts/fred/indicators.ts FEDFUNDS
bun run plugins/korean-trading/scripts/fred/indicators.ts all

# ECOS 지표
bun run plugins/korean-trading/scripts/ecos/indicators.ts base_rate
bun run plugins/korean-trading/scripts/ecos/indicators.ts all

# KRX
bun run plugins/korean-trading/scripts/krx/vkospi.ts
bun run plugins/korean-trading/scripts/krx/sector-index.ts

# KIS
bun run plugins/korean-trading/scripts/kis/ohlcv.ts 005930
bun run plugins/korean-trading/scripts/kis/investor-trend.ts 005930
bun run plugins/korean-trading/scripts/kis/financial-ratio.ts 005930
bun run plugins/korean-trading/scripts/kis/index-price.ts
bun run plugins/korean-trading/scripts/kis/consensus.ts 005930
bun run plugins/korean-trading/scripts/kis/short-sale.ts 005930
bun run plugins/korean-trading/scripts/kis/credit.ts 005930
bun run plugins/korean-trading/scripts/kis/program-trade.ts 005930
bun run plugins/korean-trading/scripts/kis/futures.ts

# KIS Phase 6 — 현재가/랭킹/분봉/해외주식
bun run plugins/korean-trading/scripts/kis/current-price.ts 005930
bun run plugins/korean-trading/scripts/kis/volume-rank.ts
bun run plugins/korean-trading/scripts/kis/fluctuation-rank.ts
bun run plugins/korean-trading/scripts/kis/market-cap-rank.ts
bun run plugins/korean-trading/scripts/kis/foreign-institution-total.ts
bun run plugins/korean-trading/scripts/kis/minute-chart.ts 005930
bun run plugins/korean-trading/scripts/kis/overseas-price.ts NAS AAPL
bun run plugins/korean-trading/scripts/kis/overseas-daily.ts NAS AAPL

# DART
bun run plugins/korean-trading/scripts/dart/corp-codes.ts 005930
bun run plugins/korean-trading/scripts/dart/disclosure.ts 005930 disclosures
bun run plugins/korean-trading/scripts/dart/disclosure.ts 005930 financial 2024 annual

# 뉴스
bun run plugins/korean-trading/scripts/news/search.ts "삼성전자" 10

# 글로벌 오버나이트
bun run plugins/korean-trading/scripts/market/overnight.ts

# WICS 섹터
bun run plugins/korean-trading/scripts/market/sector.ts 005930

# 환율 (한국수출입은행)
bun run plugins/korean-trading/scripts/koreaexim/exchange-rate.ts

# FSC 채권/지수 (공공데이터포털)
bun run plugins/korean-trading/scripts/fsc/bond-price.ts
bun run plugins/korean-trading/scripts/fsc/market-index.ts bond

# 원자재 시세 (Alpha Vantage)
bun run plugins/korean-trading/scripts/alphavantage/commodities.ts WTI daily
bun run plugins/korean-trading/scripts/alphavantage/commodities.ts COPPER daily

# 통합 검증 (모든 API 연결 테스트)
bun run plugins/korean-trading/scripts/test-all.ts
```

모든 스크립트는 JSON envelope 형식으로 출력합니다:

```json
// 성공
{ "ok": true, "data": { ... }, "meta": { "source": "fred", "fetched_at": "..." } }

// 실패
{ "ok": false, "error": { "code": "ENV_MISSING", "message": "..." } }
```

## 활용 시나리오

### 1. 장 전 루틴

```
나: /korean-trading:morning-brief
Claude: (VIX, VKOSPI, 환율, 금리 종합) → 오늘 레짐: 보통, 투자비중 60% 권장
```

### 2. 종목 발굴 → 분석 → 진입

```
나: /korean-trading:scan 005930 000660 035420 035720
Claude: (4종목 비교 테이블) → SK하이닉스가 수급+밸류 1위

나: /korean-trading:analyze 000660
Claude: (종합 분석) → 외국인 5일 연속 순매수, PER 업종 하위, 매수 유망

나: /korean-trading:entry-check 000660 210000 200000 10000000
Claude: (5단 체크) → 4/5 통과, 47주 매수, 투입 9,870,000원 (98.7%)
```

### 3. 매매 복기

```
나: /korean-trading:review 005930 20240301 72000 20240315 75000 100
Claude: (데이터 기반 분석) → 수익 +4.2%, 진입 적절, 청산 조기 (이후 78000까지 상승)
       교훈: 트레일링 스탑 활용하여 수익 극대화 필요
```

## 파일 구조

```
plugins/korean-trading/
├── .claude-plugin/plugin.json
├── hooks/hooks.json
├── commands/                      # 슬래시 커맨드 (경량 — 스킬 로드만)
│   ├── morning-brief.md
│   ├── analyze.md
│   ├── entry-check.md
│   ├── regime.md
│   ├── scan.md
│   └── review.md
├── skills/                        # 워크플로우 + 데이터소스 스킬
│   ├── morning-brief/SKILL.md
│   ├── stock-analysis/SKILL.md
│   ├── entry-check/SKILL.md
│   ├── market-regime/SKILL.md
│   ├── stock-screening/SKILL.md
│   ├── trade-review/SKILL.md
│   ├── kis-market-data/
│   │   ├── SKILL.md
│   │   └── references/endpoints.md
│   ├── krx-index/SKILL.md
│   ├── dart-disclosure/SKILL.md
│   ├── ecos-macro/SKILL.md
│   ├── fred-macro/SKILL.md
│   ├── global-commodities/SKILL.md
│   ├── dcf-valuation/SKILL.md
│   ├── peer-comps/SKILL.md
│   ├── earnings-analysis/SKILL.md
│   ├── 3-statements/SKILL.md
│   └── risk-sizing/
│       ├── SKILL.md
│       └── references/position-sizing.md
└── scripts/                       # Bun TypeScript 스크립트
    ├── common/                    # 공유 인프라
    │   ├── http.ts                # fetch 래퍼 (rate limit, retry)
    │   ├── cache.ts               # ~/.cache 경로 관리
    │   └── kis-auth.ts            # KIS OAuth2 토큰 관리
    ├── fred/indicators.ts
    ├── ecos/indicators.ts
    ├── krx/vkospi.ts, sector-index.ts
    ├── kis/ohlcv.ts, investor-trend.ts, ...  (17개)
    ├── dart/corp-codes.ts, disclosure.ts
    ├── news/search.ts
    ├── market/overnight.ts, sector.ts
    ├── koreaexim/exchange-rate.ts
    ├── fsc/bond-price.ts, market-index.ts
    ├── alphavantage/commodities.ts
    └── test-all.ts
```
