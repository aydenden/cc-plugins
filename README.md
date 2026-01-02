# CC Plugins

개인용 Claude Code 플러그인 마켓플레이스

## 설치

### 마켓플레이스로 등록

```bash
# Public repo
/plugin marketplace add aydenden/cc-plugins

# Private repo (full URL 사용)
/plugin marketplace add https://github.com/aydenden/cc-plugins.git
```

등록 후 `/plugin` 명령어로 개별 플러그인을 선택하여 설치할 수 있습니다.

### 개별 플러그인 직접 사용

```bash
git clone https://github.com/aydenden/cc-plugins.git
claude --plugin-dir ./cc-plugins/plugins/marksman-lsp
```

## 포함된 플러그인

| 플러그인 | 설명 |
|---------|------|
| marksman-lsp | Markdown LSP - 링크 완성, 정의 이동, 참조 찾기, 진단 |

## 새 플러그인 추가

```bash
# 템플릿 복사
cp -r templates/plugin-template plugins/my-new-plugin

# plugin.json 수정
# marketplace.json에 추가
```

자세한 내용은 [CLAUDE.md](./CLAUDE.md) 참고.

## 라이선스

MIT
