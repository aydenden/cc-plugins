# statusline

mod 로 그리는 상태줄. 외부 도구 없이 프롬프트 아래에 모델·git·컨텍스트·사용량을 띄운다.

`statusLine` 설정은 다시 그릴 때마다 명령 하나를 통째로 실행한다. 이 플러그인은 그 자리를 mod 로
바꾼다 — 값은 엔진이 이미 갖고 있는 것을 이벤트로 받고, 프로세스는 git 처럼 엔진 밖의 값이 필요할
때만 띄운다.

| 층 | 무엇 | 어디 |
|---|---|---|
| 설정 | 줄 → 항목, 각각 `enabled` | `~/.claude/statusline/settings.json` |
| 판단 | 설정 다듬기·배치·위젯·명령 출력 해석 (순수 함수) | `scripts/lib/` |
| 어댑터 | 값 모으기와 이벤트 배선 | `hooks/register.mjs` |

## 그리는 자리

프롬프트 아래 힌트 줄(`PromptHint`) 밑이다. 엔진의 힌트 줄은 그대로 두고 그 아래에 줄을 더한다.

`$.ui.status` 는 쓰지 않는다. 실측해 보면 플러그인당 글자 한 줄이고, ANSI 색과 줄바꿈이 깨진 글자로
찍히며, 앞에 `⚠ <플러그인>:` 이 붙는다 — 알림용이다.

## 설정

파일이 없으면 기본 배치(한 줄)로 그린다. `/sl init` 이 파일을 만들고, `/sl import` 가 ccstatusline 의
설정(`~/.config/ccstatusline/settings.json`)을 옮겨 온다. 손으로 고친 파일은 다음 프롬프트에서 반영된다.

```json
{
  "version": 1,
  "powerline": { "enabled": true, "separator": "" },
  "theme": "nord",
  "minimal": true,
  "lines": [
    {
      "enabled": true,
      "items": [
        { "type": "model", "merge": true },
        { "type": "thinking-effort" },
        { "type": "flex-separator" },
        { "type": "claude-session-id", "enabled": false }
      ]
    }
  ]
}
```

| 키 | 뜻 |
|---|---|
| `lines[].enabled`, `items[].enabled` | 줄·항목을 끈다. 꺼도 순서와 옵션은 남는다 |
| `powerline` | 구간마다 배경을 칠하고 화살표로 잇는다. 끄면 `separator` 로 잇는다 |
| `theme` | `nord`, `nord-aurora`, `null`. 구간마다 색을 돌려 쓰고 줄을 넘어 이어진다 |
| `minimal` | 라벨 없이 값만 (`Model: Opus 5.5` → `Opus 5.5`) |
| `refresh` | 소스별 다시 모으는 주기(초): `gitSeconds` 5, `apiSeconds` 180, `ghSeconds` 120, `statusSeconds` 300, `clockSeconds` 30, `customSeconds` 30 |

항목 옵션:

| 옵션 | 뜻 |
|---|---|
| `color`, `bg` | 전경·배경 (`#RRGGBB`). 테마를 이긴다 |
| `bold`, `dim` | 굵게·흐리게 |
| `merge` | 다음 항목과 한 구간으로 묶는다 (화살표·구분자 없이, 같은 테마 색) |
| `raw`, `label` | 라벨을 떼거나 바꾼다. `label` 은 `minimal` 에서도 보인다 |
| `maxWidth` | 넘으면 `…` 로 자른다 |
| `showZero` | 0 이어서 숨는 값을 보이게 한다 |
| `text`, `symbol`, `url` | `custom-text`, `custom-symbol`, `link` 의 내용 |
| `id`, `command` | `custom-command` 의 이름과 argv 배열 (셸 없이 실행, 첫 줄만 쓴다) |
| `width`, `format` | `context-bar` 의 칸 수(기본 16)와 `percent`(토큰 수 없이 막대와 퍼센트만) |
| `ttlMinutes` | `cache-timer` 의 TTL |
| `format` | `git-review` 의 `number`(제목 없이 번호만) |

틀린 곳이 있어도 상태줄은 뜬다. 모르는 위젯과 틀린 옵션만 버리고, 이유는 `/sl` 목록에 보인다.

## `/sl`

주소는 1부터 센다. `2` 는 2번 줄, `2.3` 은 2번 줄의 3번 항목이다.

| 명령 | 하는 일 |
|---|---|
| `/sl` | 현재 배치, 설정의 문제, 값을 못 읽은 소스 |
| `/sl on\|off <줄>[.<항목>]` | 켜고 끈다 |
| `/sl add <줄> <위젯> [위치]`, `/sl rm <줄>.<항목>` | 넣고 뺀다 |
| `/sl move <줄>.<항목> <줄>[.<위치>]` | 옮긴다 |
| `/sl set <줄>.<항목> 키=값 …` | 항목 옵션. `키=` 는 지운다. `label`·`text` 의 `_` 는 공백으로 읽는다 |
| `/sl line add`, `/sl line rm <줄>` | 줄을 더하고 뺀다 |
| `/sl theme <이름>\|off`, `/sl powerline on\|off`, `/sl minimal on\|off` | 전체 모양 |
| `/sl widgets` | 쓸 수 있는 위젯 |
| `/sl init`, `/sl import [--force]`, `/sl reload` | 파일 만들기, ccstatusline 설정 가져오기, 다시 읽기 |

## 위젯

타입 id 는 ccstatusline 의 것을 그대로 쓴다. 전체 목록은 `/sl widgets`.

| 분류 | 값이 오는 곳 |
|---|---|
| 모델·버전·세션 id·작업 디렉터리 | `$.session.*` |
| 컨텍스트, 5시간·주간 사용량과 리셋, 비용 | `$.session.usage()` 와 `session.measure` 이벤트 — 네트워크 호출 없음 |
| 모델별 주간 사용량, 추가 사용량 | `api.anthropic.com/api/oauth/usage`. 자격 증명은 호스트가 헤더에 넣고 mod 에는 오지 않는다. 이 위젯이 켜져 있을 때만 부른다 |
| 노력 수준, 세션 이름 | 훅 입력 → 트랜스크립트 → 설정 순 |
| 출력 스타일, 음성, 샌드박스, 원격 제어 | `/config` 행과 설정 |
| 토큰 합계, 캐시, 속도, 압축 횟수 | 트랜스크립트로 재개 전까지를 되찾고 턴마다 더한다 |
| git | `git status --porcelain=v2 --branch` 하나에서 대부분. 변경 줄 수·원격·worktree 는 그 위젯이 켜졌을 때만 더 부른다 |
| PR·CI | `gh pr view` |
| 계정 이메일 | `~/.claude.json` |

### ccstatusline 과 다른 곳

| 위젯 | 차이 |
|---|---|
| `vim-mode` | 실시간 INSERT/NORMAL 을 mod 가 읽을 곳이 없다. 편집기 모드 설정(vim 인지)만 보인다 |
| `worktree-mode`, `worktree-name`, `worktree-branch` | 세션이 `--worktree` 로 열렸는지가 아니라 현재 디렉터리가 linked worktree 인지로 판단한다 |
| `worktree-original-branch`, `jj-workspace` | 없다. 앞은 값을 얻을 곳이 없고, 뒤는 만든 기기에 jj 가 없어 검증하지 못했다 |
| `input-speed`, `output-speed`, `total-speed` | 턴 길이로 나눈다. 도구 실행 시간이 섞인 턴 평균이다 |
| `cache-timer` | 캐시 TTL 이 노출되지 않아 `ttlMinutes`(기본 5)로 정한다 |
| `session-clock` | 세션이 꺼져 있던 시간도 포함한다 |
| `link` | 글자만 그린다. 눌리지 않는다 |
| 조건부 숨김 | 값이 없으면 자리 표시 없이 숨는다. 0 인 개수는 `showZero` 로만 보인다 |
| 테마 | `nord`, `nord-aurora` 둘. 그라디언트와 줄 간 자동 정렬은 없다 |

jj 위젯은 파서만 테스트했고 실제 jj 로 돌려 보지 못했다.

## 전제

- Claude Code v2.1.287 이상 (mod). mod 가 안 뜨는 세션(구버전, 조직 정책, `--safe-mode`)에서는 아무것도
  그리지 않는다
- 터미널과 데스크톱에서만 그려진다 (`PromptHint` 가 있는 곳)
- powerline 화살표는 Nerd Font 나 powerline 글리프가 있는 글꼴이 필요하다
- 쓰던 `statusLine` 설정은 직접 지운다. 이 플러그인은 `settings.json` 을 건드리지 않는다

## 테스트

```bash
node --test "scripts/test/*.test.mjs"
claude plugin validate .
```

순수 로직만 테스트한다 — 형식, 설정 다듬기와 가져오기, 배치, 위젯, 명령 출력 해석, `/sl`. 값을 모으는
쪽은 실측 대상이라 테스트하지 않는다. `hooks/register.mjs` 는 `claude plugin validate` 가 읽어 내는
hooks·calls 목록으로 확인한다.

## 파일

```
hooks/
  hooks.json          mod 모듈 등록
  register.mjs        어댑터: 값 모으기, 이벤트 배선, PromptHint 그리기, /sl
scripts/lib/
  config.mjs          설정의 꼴·기본값·다듬기, ccstatusline 설정 옮기기
  layout.mjs          설정 + 스냅숏 → 그릴 칸의 줄 (merge·구분자·테마·화살표)
  widgets/            위젯 레지스트리 (session · git · usage · env)
  command.mjs         /sl 인자 해석과 설정 편집
  parse-git.mjs       git · gh · jj · vm_stat 출력 해석
  parse-transcript.mjs  트랜스크립트와 usage API 응답 해석
  format.mjs          토큰 수·기간·막대·경로·모델 이름
  themes.mjs          테마 색
```
