# 다중 플랫폼 리서치 채널 조사 (ccp-0at)

- 조사일: 2026-08-16
- 조사 방법: 로컬 실측(curl 호출, agent-reach 스킬 파일 정독)
- 제약: **유료 서비스 배제**(사용자 지시, 2026-08-16), 무설치 원칙, Windows 11 포함 3플랫폼

---

## 1. 결론 요약

논문 채널은 **MCP 서버·CLI 설치가 전혀 필요 없다.** 무료·무키(no API key) REST API를
`curl`(또는 CC 내장 WebFetch)로 직접 호출하면 된다. 이로써 "리서치 = 설치형 도구"라는
전제가 깨지고, 리서치 경로를 **필수 계층(의존성 0, 전 기기) / 선택 계층(주력 기기)** 으로
나눌 수 있다.

X/트위터는 결론이 갈린다(§5). **단건 트윗 열람은 무설치·무키로 견고하게 되지만
(`tweet-result`), 계정 타임라인 수집은 IP 레이트리밋 때문에 무설치로 사실상 불가**하다.
따라서 X는 "검색"이 아니라 **큐레이션된 계정 폴링**으로 설계하되, 수집은 주력 기기의
`twitter-cli`가 맡고 무설치 기기는 기존 인용의 원문 확인만 한다.

---

## 2. 논문 소스 — 무료·무키 API 실측

전부 2026-08-16에 인증 없이 호출해 200 응답을 확인했다.

| 소스 | 엔드포인트 | 키 | 실측 결과 | 커버리지 |
|---|---|---|---|---|
| arXiv | `https://export.arxiv.org/api/query?search_query=...` | 불필요 | http=200, 5,964B Atom XML, 제목 정상 파싱 | CS/물리/수학 프리프린트 |
| OpenAlex | `https://api.openalex.org/works?search=...&mailto=<email>` | 불필요 | http=200, hit 174,901건, `db_response_time_ms: 211` | 범용 학술 메타데이터(최광범) |
| Crossref | `https://api.crossref.org/works?query=...&mailto=<email>` | 불필요 | http=200, total 991,834건, DOI·발행일 반환 | DOI 등록 전체 |
| Europe PMC | `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=...&format=json` | 불필요 | http=200, hitCount 570,783 | 생의학 + 초록 |
| PubMed E-utilities | `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&...&retmode=json` | 불필요 | http=200, count 24,641, MeSH 확장 질의 반환 | 생의학 |

### 탈락한 후보

- **Semantic Scholar Graph API** — 무키 호출 2회 연속 `429 Too Many Requests`. 공용 풀이
  상시 포화 상태로 보이며 실사용 불가. 키는 무료지만 **신청·승인 절차**가 필요해
  "설치 없이 어느 기기서나"에 어긋난다. → 선택 계층으로도 넣지 않음(대체재 충분).
- **arxiv-mcp-server / paper-search-mcp / semantic-scholar-fastmcp** — 전부 위 API의 얇은
  래퍼인데 Python 설치와 MCP 등록을 요구한다. 무키 REST가 되는 이상 **순손해**.
- **Exa 전문검색** — 유료(크레딧 소진 후 과금). 사용자 지시로 배제. 무료 대체는 CC 내장
  WebSearch.

### 주의점

- arXiv는 `http://` 호출 시 빈 응답을 반환했다. **반드시 `https://export.arxiv.org`** 를 쓸 것.
- OpenAlex·Crossref는 `mailto=` 파라미터를 붙이면 polite pool로 들어가 처리량이 안정된다.
- PubMed 무키는 3 req/s 제한. 순차 호출이면 문제없다.

---

## 3. 무설치 원칙과의 충돌 해소 — 2계층 + 우아한 축퇴

`agent-reach`는 실측 결과 **전부 설치형**이다(`~/.claude/skills/agent-reach/references/*.md`):
`pipx install rdt-cli`, `pipx install twitter-cli`, `pipx install xiaohongshu-cli`,
`yt-dlp`, 그리고 MCP 브리지인 `mcporter`(Node). 무설치 원칙과 정면으로 부딪히므로
**필수로 두지 않는다.**

### 필수 계층 — 의존성 0, 전 기기

| 채널 | 수단 | 근거 |
|---|---|---|
| 웹 검색 | CC 내장 **WebSearch** | 구독에 포함, 별도 과금·설치 없음 |
| 웹 페이지 읽기 | CC 내장 **WebFetch** | 동일 |
| 논문 | 위 §2의 무키 REST API (`curl`) | 실측 완료 |

### 선택 계층 — 주력 기기 한정

| 채널 | 도구 | 설치 요구 |
|---|---|---|
| Reddit | `rdt-cli` | pipx (로그인 완료 상태) |
| Twitter/X | `twitter-cli` | pipx + 쿠키 |
| YouTube 자막 | `yt-dlp` | 미설치(현재 부재) |
| GitHub | **`gh` CLI** | 설치형이나 이미 구비 — v2.97.0, `aydenden` 인증됨(scopes: gist/read:org/repo/workflow), `gh api /repos/...` 실측 성공. agent-reach 채널 대신 `gh`를 쓴다 |
| RSS / V2EX | agent-reach 채널 | Python 패키지 |
| 임의 URL 마크다운화 | `curl https://r.jina.ai/<URL>` | **설치 불필요**(http=200 실측) — 다만 캐시 스냅샷 경고가 붙어 WebFetch로 충분 |

### 선택 계층 실호출 검증 (2026-08-16)

`agent-reach doctor`는 6/16 가용을 보고했으나, **doctor는 바이너리 존재와 쿠키 유무만 보고
실제 호출은 하지 않는다.** 직접 호출해 보니 표시와 실제가 갈렸다.

| 채널 | doctor | 실호출 |
|---|---|---|
| Reddit `rdt search` | ✅ 로그인됨 | ✅ `ok: true`, r/LargeLanguageModels 결과 반환 |
| Twitter/X `twitter search -n 2` | ✅ "完整可用" | ❌ `ClientTransaction` 초기화 실패 → **HTTP 404** |
| YouTube `yt-dlp` | ❌ 미설치 | ❌ `command not found` |
| GitHub · V2EX · RSS | ✅ | 미검증 |
| Jina Reader | ✅ | ✅ http=200 |

Twitter 404는 agent-reach 문서가 예고한 알려진 실패 모드다(Twitter GraphQL API 변경 시
`search`가 상시 404 가능, `references/social.md:121`). **다만 깨진 건 `search` 하나뿐이고
계정 타임라인 계열은 정상이다** — §5 참조.

**함의**: 선택 채널은 *설치 여부*뿐 아니라 *호출 시점의 상류 API 상태*로도 깨진다. 따라서
축퇴는 예외 처리가 아니라 **상시 경로**여야 하고, 채널 탐지는 `command -v` 만으로 불충분하며
실패한 호출을 조용히 삼키지 말고 산출물에 기록해야 한다.

### 축퇴 규칙

리서치 스킬은 **선택 계층 부재를 오류로 취급하지 않는다.** 채널이 없으면 필수 계층만으로
조사를 완주하고, 산출물에 `조사 제외 채널: Reddit, X (이 기기 미설치)` 를 명시한다.
"조용히 빠뜨림"이 아니라 "명시적으로 축퇴"가 계약이다.

---

## 4. Windows 11 가동 여부

- **필수 계층: 100% 가동.** WebSearch/WebFetch는 CC 내장이라 OS 무관하고, `curl.exe`는
  Windows 10 1803 이후 OS에 기본 탑재되어 Windows 11에서 추가 설치가 없다.
- **선택 계층: 사실상 주력 기기 전용.** pipx(Python) + Node(mcporter) 설치가 선행되어야
  하고, rdt-cli·twitter-cli는 브라우저 쿠키 추출/로그인이라는 기기별 수동 절차를 요구한다.
  기술적으로 불가능하진 않으나 "설치 없이 켜면 된다"는 목표와 무관한 비용이다.

---

## 5. X/트위터 — 고품질 계정 수집 경로 (2026-08-16 실측)

전제: X에는 잡음이 많지만 **공식 계정과 개발/AI 셀럽의 트윗은 고급 정보원**이다. 따라서
필요한 건 "전체 검색"이 아니라 **큐레이션된 계정 목록의 타임라인 수집**이다. 이 방향으로
보면 `search` 404는 치명상이 아니다.

### 경로 A — 무설치·무키 (전 기기 가능) ✅

X 자체의 **임베드 위젯용 공개 엔드포인트**를 쓴다. 인증·설치가 전혀 없다.

```bash
# 계정 타임라인 (HTML 안 __NEXT_DATA__ JSON에 트윗 배열)
curl -s -A "Mozilla/5.0 Chrome/120" \
  "https://syndication.twitter.com/srv/timeline-profile/screen-name/OpenAI"

# 단일 트윗 (token = ((id/1e15)*Math.PI).toString(36).replace(/(0+|\.)/g,''))
curl -s "https://cdn.syndication.twimg.com/tweet-result?id=<ID>&token=<TOKEN>&lang=en"
```

실측 결과:

- `timeline-profile/screen-name/OpenAI` → http=200, 135,632B, `__NEXT_DATA__` 파싱 시
  **트윗 21건** — `full_text`(전문), `created_at`, `favorite_count`, `retweet_count`, `id_str`
- `tweet-result` → http=200, `text` 전문 + `entities`/`photos`/`video`/`mediaDetails`,
  스레드 부모(`parent`)와 인용(`quoted_tweet`) 키까지 지원

제약 (중요):

- **검색 불가.** 계정을 지정해야만 한다 → 큐레이션 목록이 선행 조건.
- **최근 ~21건**만. 과거 소급 불가.
- **`timeline-profile`의 IP 레이트리밋은 사실상 사용 불가 수준.** 첫 호출(OpenAI)만
  성공했고, 이후 4개 계정 연속 호출에서 즉시 429 → 25초 간격 4회 재시도도 전부 429 →
  **10분 이상 지난 뒤 재시도해도 여전히 429**였다. 계정 1개당 1회꼴의 아주 드문 호출만
  가능하다고 봐야 한다.
- **반면 `tweet-result`(cdn.syndication.twimg.com)는 별개 버킷이다.** timeline이 10분 넘게
  429로 막힌 상태에서도 http=200을 유지했다. 즉 *ID를 이미 아는 트윗의 전문 확보*는 견고하고,
  *계정 타임라인 발견*이 병목이다.
- 문서화되지 않은 임베드 내부 엔드포인트라 **예고 없이 바뀔 수 있다**.

### 경로 B — 설치형 (주력 기기) ✅

`twitter-cli`는 `search`만 404이고 **계정 계열 명령은 전부 정상**이다:

| 명령 | 실측 |
|---|---|
| `twitter user-posts <handle> -n N` | ✅ 전문 반환(karpathy 트윗 full text 완전 수신) |
| `twitter user <handle>` | ✅ 프로필·팔로워 수 |
| `twitter following <handle>` | ✅ — **큐레이션 목록 시드 발굴**에 유용 |
| `twitter list <LIST_ID>` | 존재 — Twitter List 단위 수집, 큐레이션에 최적 |
| `twitter search` | ❌ HTTP 404 |
| `-c` 플래그 | 압축 출력(텍스트 ~120자 절단, LLM 친화). 전문 필요 시 생략 |

### 막다른 길 (전부 실측)

| 시도 | 결과 |
|---|---|
| `nitter.net` | http=200이나 **0바이트** |
| `nitter.poast.org` | http=503 |
| `xcancel.com` | http=200이나 **캡차 인터스티셜**("Verifying your browser…") |
| `r.jina.ai/https://x.com/OpenAI` | http=403 |
| `publish.twitter.com/oembed` | http=301 (리다이렉트, 사용 불가) |

Nitter 생태계는 사실상 붕괴했다고 봐야 한다.

### 설계 함의

X 수집은 **"검색"이 아니라 "큐레이션 계정 폴링"** 모델로 설계한다. 볼트에 추적 대상
핸들 목록(공식 계정 + 개발/AI 셀럽)을 둔다.

역할 분담은 레이트리밋 실측에 따라 이렇게 갈린다:

- **수집(타임라인 발견) = 경로 B, 주력 기기.** `timeline-profile`이 IP 차단으로 사실상
  못 쓰므로, 정기 폴링은 `twitter user-posts` / `twitter list`가 담당한다. X는 **선택 계층**에
  남는다 — 앞서 "전 기기 열화 가능"으로 본 건 레이트리밋을 과소평가한 것이다.
- **열람(단건 확보) = 경로 A, 전 기기.** 볼트 페이지가 트윗 URL/ID를 들고 있으면
  `tweet-result`로 어느 기기서나 전문을 되살릴 수 있다. 인용 시 원문 보존에 쓴다.
- 축퇴 시나리오: 주력 기기가 아니면 **신규 수집은 포기**하고, 이미 볼트에 적재된 트윗
  인용만 경로 A로 확인한다. 이를 산출물에 명시한다.

## 6. 호출 형태 (계약만 확정, 구현은 ccp-73z)

- `agent-reach doctor`를 매 리서치마다 호출하는 건 낭비다. **채널 레지스트리**에
  `필수 | 선택` 구분과 탐지 명령(`command -v rdt`, `command -v yt-dlp` 등)을 두고,
  선택 채널은 **실제로 그 채널이 필요한 질의일 때만** 1회 탐지한다.
- 논문 질의는 탐지 자체가 불필요하다(항상 가용).
- 구체적 스킬 구조·프롬프트 분기는 **ccp-73z(리서치 경로 재설계)** 의 몫으로 넘긴다.
