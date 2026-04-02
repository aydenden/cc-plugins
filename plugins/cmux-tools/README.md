# cmux-tools

cmux 환경에서 병렬 Claude Code 세션을 관리하는 플러그인.

## 요구사항

- [cmux](https://github.com/manaflow-ai/cmux) 설치 및 실행 중
- cmux 터미널 내에서 Claude Code 사용

## Skills

### spawn

현재 워크스페이스에 새 터미널 탭을 열고 Claude Code 세션을 시작한다.

```bash
# 빈 세션
/cmux-tools:spawn

# 프롬프트와 함께
/cmux-tools:spawn "auth 모듈 테스트 작성해줘"
```

## 설치

```bash
/plugin marketplace add aydenden/cc-plugins
```

## 로드맵

- `--split` 옵션 (탭 대신 화면 분할)
- `--model` 옵션 (모델 지정)
- 세션 목록 조회 (`list`)
- 세션 간 메시지 전송 (`send`)
