# pm

PMS(Product-Manager-Skills) 워크플로우와 Beads 이슈 트래커를 통합하는 PM 플러그인 — PMS 스킬 산출물을 beads epic/task/feature로 자동 변환

## 커맨드

| 커맨드 | 설명 |
|--------|------|
| `/pm:plan <기간 및 목표>` | 로드맵을 계획하고 beads epic으로 자동 변환 |
| `/pm:prd <기능 또는 이니셔티브>` | PRD를 작성하고 beads epic + task로 자동 변환 |
| `/pm:discover <문제 영역>` | 디스커버리 프로세스를 실행하고 beads feature + 실험 task로 변환 |
| `/pm:breakdown <beads epic ID>` | 에픽을 유저 스토리로 분해하고 beads sub-task로 변환 (INVEST 체크 + 9개 분할 패턴) |
| `/pm:sync [디렉토리]` | 기존 PMS 산출물 파일을 beads 이슈로 일괄 변환 |

## 스킬

| 스킬 | 설명 |
|------|------|
| beads-bridge | PMS 스킬 산출물을 beads 이슈로 자동 변환 |
| pm-workflow | PM 워크플로우 감지 후 적절한 `/pm:*` 커맨드로 라우팅 |

## 에이전트

| 에이전트 | 설명 |
|----------|------|
| pm-assistant | PMS 워크플로우를 오케스트레이션하고 산출물을 beads 이슈로 자동 변환하는 자율 PM 에이전트 |

## 훅

| 이벤트 | 설명 |
|--------|------|
| SessionStart | PMS CLI, Beads CLI, `.beads/` 초기화 상태 자동 검증 |

## 사전 요구사항

- [PMS (Product-Manager-Skills)](https://github.com/user/pms) 설치
- [Beads](https://github.com/user/beads) CLI 설치 및 `bd init` 완료
