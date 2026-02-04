# Workflow Plugin

beads 작업 생성 워크플로우를 자동화하는 Claude Code 플러그인입니다.

## Features

- **`/new-work` 커맨드**: 자연어 프롬프트를 beads issue/epic/task 구조로 자동 변환
- **`workflow-skills` 스킬**: beads 필드(Title, Design, Acceptance, Notes) 작성 규약 제공

## Installation

### 로컬 테스트
```bash
cc --plugin-dir /path/to/cc-plugins/plugins/workflow
```

### Marketplace 추가
`.claude-plugin/marketplace.json`에 추가:
```json
{
  "name": "workflow",
  "source": "./plugins/workflow",
  "description": "beads 작업 생성 워크플로우 자동화",
  "version": "0.1.0"
}
```

## Usage

### `/new-work` 커맨드

자유로운 프롬프트로 beads 작업을 생성합니다.

```bash
/new-work "FRED API 통합하고, 캐싱 레이어 추가해야 함. 테스트도 필요함."
```

**동작:**
1. 프롬프트 분석 (작업 개수, 의존성, 범위)
2. Epic/Task/Subtask 구조 제안
3. 애매한 부분 질문 (기술 선택, 우선순위 등)
4. `bd create`, `bd epic create` 자동 실행
5. 결과를 트리 구조로 출력

**출력 예시:**
```
✅ 생성 완료:

Epic #42: FRED API 통합 파이프라인
├─ Task #43: API 인증 구현 (ready)
├─ Task #44: 캐싱 레이어 추가 (blocked by #43)
└─ Task #45: 테스트 작성 (blocked by #44)

다음: bd show 43
```

### `workflow-skills` 스킬

beads 작업 생성 시 자동으로 로드되어 필드 작성 가이드를 제공합니다.

**포함 내용:**
- Title, Description, Design, Acceptance, Notes 필드 작성 가이드
- 문서화 판단 기준
- 작업 체크리스트

## Prerequisites

- [beads](https://github.com/steveyegge/beads) 플러그인 설치 필요
- `bd` 명령어가 PATH에 있어야 함

## Components

- `commands/new-work.md`: 작업 생성 커맨드
- `skills/workflow-skills/SKILL.md`: 필드 작성 규약 스킬

## License

MIT
