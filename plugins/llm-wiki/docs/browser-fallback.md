# 브라우저 우회 레퍼런스

`WebFetch`가 403·빈 본문·JS 렌더링 벽에 막혔을 때 **한 계단씩 올라가는 사다리**다.
채널 정의의 SSoT는 `docs/research-channels.md`이고, 이 파일은 그 3계층의 실행 절차만 담는다.

## 언제 올라가나 — 승급 신호

| 증상 | 진단 | 다음 계단 |
|---|---|---|
| HTTP 403 / 429, 본문 대신 차단 문구 | UA·헤더 기반 봇 필터 | 2계단 `agent-browser` |
| HTTP 200인데 본문이 껍데기(내비게이션만) | 클라이언트 렌더링(SPA) | 2계단 `agent-browser` |
| "Just a moment…" / "보안 확인 수행 중" | Cloudflare 인터스티셜 | 2계단 → 실패 시 3계단 |
| 로그인 벽 | 인증 필요 | 2계단 `--profile` |
| 3계단도 403 | 상류가 이 기기를 아예 거부 | **올라가지 않는다** — 축퇴로 기록 |

승급은 **한 번에 한 계단**이다. 같은 계단에서 플래그를 바꿔가며 재시도하지 않는다 —
조사 시간을 태우고, 실패 원인이 "차단"인지 "옵션 오용"인지 뒤엉킨다.

## 1계단 — WebFetch (기본)

CC 내장. 여기서 되면 끝이다. 브라우저를 띄우는 것은 수 초~수십 초를 쓰는 일이므로,
막히지 않은 페이지에 2계단을 쓰지 않는다.

## 2계단 — agent-browser (실브라우저)

```bash
agent-browser read <url>            # 에이전트용 텍스트. 이것이 기본이자 대부분의 답
agent-browser read <url> | head -200
```

- 출력이 이미 마크다운에 가까운 본문 텍스트다. `raw/`에 그대로 리다이렉트할 수 있다.
- 본문이 안 나오고 구조만 필요하면 `agent-browser snapshot -c`(접근성 트리, 압축).
- **세션은 반드시 닫는다**: 조사가 끝나면 `agent-browser close --all`.
  열린 세션을 남기면 다음 조사가 남의 페이지 상태를 물려받는다.

로그인 벽:

```bash
agent-browser --profile Default read <url>   # 기존 Chrome 프로필의 로그인 상태 재사용
```

프로필 사용은 **사용자의 실제 계정으로 접근하는 행위**다. 조사 대상이 사적 계정 데이터일 때는
쓰지 말고, 공개 문서가 로그인 벽 뒤에 있을 때만 쓴다.

실측(2026-08-23, macOS):

| 대상 | curl | `agent-browser read` |
|---|---|---|
| example.com | 200 | 200 (0.4초) |
| medium.com/tag/llm | 403 | **본문 획득** |
| nopecha.com/demo/cloudflare (CF 인터스티셜) | "Just a moment…" | **통과, 본문 획득** |
| g2.com | 403 | 403 |

## 3계단 — Scrapling stealthy-fetch

2계단이 Cloudflare에 막혔을 때만. 파일로 바로 떨어뜨리므로 `raw/` 적재와 바로 맞물린다.

```bash
scrapling extract stealthy-fetch --solve-cloudflare --timeout 90000 \
  "<url>" "$WIKI/raw/articles/<slug>.md"
```

- 확장자가 형식을 정한다: `.md` / `.html` / `.txt`. `.md`에는 `markdownify`가 필요하며
  이는 `scrapling[shell]` extra에 들어 있다 — `[fetchers]`만 깔면 `.md` 출력이
  `ModuleNotFoundError`로 죽는다(2026-08-23 실측).
- 실패해도 **exit 0으로 차단 페이지를 파일에 쓴다.** 종료 코드를 믿지 말고
  산출물 크기와 첫 줄을 확인한다: 수백 바이트 + "잠시만 기다리십시오" = 실패다.
- 유용한 플래그: `-s <css>`(본문만), `--network-idle`(지연 렌더링), `--no-headless`,
  `--real-chrome`(설치된 Chrome 사용).

실측: 이 기기에서 `--solve-cloudflare`는 headless·`--no-headless` 어느 쪽으로도 nopecha CF
데모를 통과하지 못했다(683바이트 챌린지 페이지). g2.com은 `No Cloudflare challenge found` +
HTTP 403 — CF 챌린지가 아니라 순수 차단이라 이 계단으로 풀리지 않는다. **즉 3계단이 2계단의 상위 집합이 아니다** — CF 앞에서는 먼저 2계단을 시도한다.
3계단의 고유 가치는 브라우저 세션 없이 파일로 직행하는 배치 수집, 프록시·헤더 제어다.

## 실패는 축퇴로 기록한다

세 계단이 모두 막히면 그 소스는 포기하고 **조사 산출물의 "조사 제외 채널"에 한 줄로 남긴다**:

```
- <url> — 3계단(scrapling stealthy)까지 HTTP 403. 이 기기에서 접근 불가
```

조용히 빠뜨리는 것이 유일한 금지다. 나중에 이 페이지의 커버리지를 판단할 수 없게 된다.

## 경계

- **robots.txt·ToS를 존중한다.** 이 사다리는 개인 조사에서 사람이 브라우저로 읽을 수 있는
  공개 페이지에 도달하기 위한 것이지, 대량 수집이나 유료·비공개 콘텐츠 우회가 아니다.
- **한 페이지씩** 읽는다. 같은 호스트를 반복 크롤링하지 않는다.
- 캡차를 사람 대신 푸는 서비스는 쓰지 않는다.
