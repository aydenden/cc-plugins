# cc-deep-tutor

DeepTutor 메커니즘을 Claude Code 네이티브로 재구현한 다중 에이전트 학습 보조 플러그인.

논문·교과서를 깊이 이해하고 약점을 보완하는 능동적 학습 루프:
자료 인덱싱(memsearch) → 분해·조사·요약 → 풀이·집필 → 출제·소크라테스 follow-up → 진행 트래킹(beads).

`cc-opencode-cmux` 설치 시 외부 조사·압축·집필을 `Skill(cc-opencode-cmux:delegate-oc)`을 통해 OpenCode에 위임해 CC 토큰을 절감한다. 위임 가용성·daemon 기동·결과 검증은 delegate-oc Skill이 자체적으로 책임지며, 본 플러그인은 `Skill` 호출 한 줄로만 dispatch한다.

## 기능

| Skill | 용도 | OC 위임 |
|---|---|---|
| `/cc-deep-tutor:deep-research` | 큰 주제 분해 → 병렬 조사 → 압축 보고서 | ✅ researcher·compressor·compose |
| `/cc-deep-tutor:deep-solve` | 수학·과학 문제 계획→풀이→집필 | ✅ writer |
| `/cc-deep-tutor:deep-question` | KB 자료 기반 소크라테스 출제 | ✅ generator |
| `/cc-deep-tutor:learn-chat` | KB 자동 부착 자유 학습 대화 | ❌ 대화형 |
| `/cc-deep-tutor:kb-search` | memsearch 래퍼 (search/expand/add/stats) | ❌ |

## 사전 설치 (사용자 환경)

### 필수
- **memsearch** — Milvus + ollama bge-m3 임베딩 KB
- **MinerU 2.5** — PDF 추출 (`pip install -U "mineru[core]"`)
- **bd (beads)** — 학습 진행 트래킹

### 선택 (OC 위임 활성화)
- **cc-opencode-cmux** — 외부 조사/집필 위임
- **opencode CLI** + auth 설정

미설치 시 자동으로 cc-only 모드로 fallback.

## 사용자 settings (선택)

프로젝트 루트에 `.claude/cc-deep-tutor.local.md` 생성:

```markdown
---
materials_dir: ./materials
extract_dir: ./materials/extracted
max_parallel_topics: 3
oc_delegate: auto              # auto | always | never
oc_only_compose: false         # true면 compose만 OC, 조사는 CC
auto_index_on_write: true      # PostToolUse hook 활성/비활성
---
```

미설정 시 기본값:
- `materials_dir`: `$PWD/materials`
- `extract_dir`: `$PWD/materials/extracted`
- `max_parallel_topics`: 3
- `oc_delegate`: `auto`
- `auto_index_on_write`: `true`

## 권한 추가 (사용자 `.claude/settings.json`)

플러그인은 permissions를 강제하지 못한다. 다음 스니펫을 복사:

```json
{
  "permissions": {
    "allow": [
      "Bash(memsearch search:*)",
      "Bash(memsearch expand:*)",
      "Bash(memsearch index:*)",
      "Bash(memsearch stats)",
      "Bash(memsearch watch:*)",
      "Bash(mineru:*)",
      "Bash(bd:*)"
    ]
  }
}
```

## 디렉토리 구조 (사용자 프로젝트 예)

```
my-study/
├── materials/
│   ├── papers/       # PDF 원본
│   ├── books/        # 교과서
│   ├── notes/        # 직접 작성 md
│   └── extracted/    # MinerU 추출 결과 (.gitignore)
├── .beads/           # 학습 진행 트래킹
└── .claude/cc-deep-tutor.local.md  # 플러그인 설정 (선택)
```

## 학습 워크플로우

1. PDF 추가: `materials/papers/<name>.pdf`
2. 추출 + 인덱싱: `/cc-deep-tutor:kb-search add <pdf>`
3. 리서치: `/cc-deep-tutor:deep-research <주제>`
4. 풀이: `/cc-deep-tutor:deep-solve <문제 또는 PDF경로>`
5. 출제: `/cc-deep-tutor:deep-question <토픽>`
6. 자유 학습: `/cc-deep-tutor:learn-chat`
7. KB 직접: `/cc-deep-tutor:kb-search {search|expand|add|stats}`

## 모델 정책

- 메인(orchestrator): Opus (사용자 세션 모델)
- sub-agent: sonnet 기본, 압축은 haiku
- OC 위임 시: cc-opencode-cmux 설정의 low-cost 모델

## OC 위임 정책

각 sub-agent가 `Skill(cc-opencode-cmux:delegate-oc, args: <spec>)` 한 번을 호출한다. delegate-oc Skill이 다음을 모두 처리:
- cc-opencode-cmux 설치 여부 / opencode CLI 인증 / daemon health 검사
- 위임 가치 판단 (token budget, 작업 복잡도)
- daemon ensure (필요 시 자동 기동, 종료 시 정리)
- spec dispatch + 결과 diff 캡처 + 8줄 보고서 반환

delegate-oc가 `status: declined / error / aborted-perm`을 반환하면 호출 agent가 cc-only fallback으로 직접 작성한다.

위임 대상:
- `deep-research`의 topic-researcher (병렬 N개) + note-compressor + 최종 compose
- `deep-solve`의 solution-writer
- `deep-question`의 question-generator

`oc_delegate: never` 환경변수가 필요하면 호출 agent별 fallback 분기를 강제하는 식으로 사용자 .local.md에서 토글할 수 있다 (각 agent의 cc-only 경로는 항상 살아 있음).

## 자동 인덱싱 Hook

`auto_index_on_write: true` 시, `PostToolUse`로 Write/Edit가 다음 경로를 건드리면 자동으로 `memsearch index` 실행:
- `**/materials/notes/*.md`
- `**/materials/extracted/**/*.md`

백그라운드 실행이라 사용자 작업을 막지 않음.

## 라이선스

MIT
