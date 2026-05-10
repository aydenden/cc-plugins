# CC Plugins

개인용 Claude Code 플러그인 마켓플레이스 및 OpenCode npm 플러그인 패키지

## 설치

### 마켓플레이스로 등록

```bash
# Public repo
/plugin marketplace add aydenden/cc-plugins

# Private repo (full URL 사용)
/plugin marketplace add https://github.com/aydenden/cc-plugins.git
```

등록 후 `/plugin` 명령어로 개별 플러그인을 선택하여 설치할 수 있습니다.

### OpenCode npm 플러그인으로 사용

OpenCode 설정 파일(`~/.config/opencode/opencode.json` 또는 프로젝트 `opencode.json`)에 npm 패키지를 추가합니다.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@aydenden/opencode-plugins"]
}
```

로컬 개발 중에는 다음처럼 파일 경로를 사용할 수 있습니다.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:./packages/opencode-plugin"]
}
```

OpenCode용 패키지는 `plugins/`를 원본으로 삼아 commands, agents, skills 자산을 동기화합니다. Skills는 OpenCode의 위치 기반 discovery 특성 때문에 `/cc-plugins-install-skills` 명령으로 `.opencode/skills` 또는 `~/.config/opencode/skills`에 설치해야 native skill tool에 노출됩니다.

### 개별 플러그인 직접 사용

```bash
git clone https://github.com/aydenden/cc-plugins.git
claude --plugin-dir ./cc-plugins/plugins/<plugin-name>
```

## 포함된 플러그인

| 플러그인 | 버전 | 설명 | 커맨드 | 스킬 | 에이전트 |
|---------|------|------|--------|------|----------|
| [obsidian-knowledge](./plugins/obsidian-knowledge) | v0.2.0 | Obsidian 볼트 기반 LLM Wiki — 엔티티 타입 분류, 출처 추적, 교차참조, 위키 건강점검 | 4 | 1 | 1 |
| [korean-trading](./plugins/korean-trading) | v0.4.0 | 한국 주식 단타 트레이딩 분석 — KIS, KRX, DART, ECOS, FRED API | 6 | 17 | - |
| [worktree-task](./plugins/worktree-task) | v0.11.0 | Git worktree 기반 태스크 격리 개발 — 생성/제거, main 보호 | - | 3 | 1 |
| [pm](./plugins/pm) | v0.1.0 | PMS + Beads 통합 PM 워크플로우 — 로드맵, PRD, 에픽 분해 | 5 | 2 | 1 |
| [cmux-tools](./plugins/cmux-tools) | v0.1.0 | cmux 워크플로우 도구 | - | 1 | - |

## 디렉토리 구조

```
cc-plugins/
├── .claude-plugin/marketplace.json   # 마켓플레이스 정의
├── packages/opencode-plugin/         # OpenCode npm 플러그인
└── plugins/
    └── {plugin-name}/
        ├── .claude-plugin/plugin.json
        ├── commands/    # 슬래시 명령어 (.md)
        ├── skills/      # Agent Skills (SKILL.md)
        ├── agents/      # 서브에이전트 (.md)
        └── hooks/       # 이벤트 훅 (hooks.json)
```

## OpenCode 패키지 개발

```bash
cd packages/opencode-plugin
bun install
bun run build
npm pack --dry-run
```

`packages/opencode-plugin/assets/`는 빌드 시 `plugins/`에서 생성되는 배포용 복사본입니다. 직접 수정하지 마세요.

## 라이선스

MIT
