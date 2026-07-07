# cc-deep-tutor

DeepTutor 메커니즘을 Claude Code 네이티브로 재구현한 다중 에이전트 학습 보조 플러그인.

논문·교과서를 깊이 이해하고 약점을 보완하는 능동적 학습 루프:
자료 추출(MinerU) → 마크다운 위키 인덱싱 → 분해·조사·요약 → 풀이·집필 → 출제·소크라테스 follow-up → 진행 트래킹(beads).

KB는 벡터 DB 없이 **마크다운 위키 + frontmatter scan 검색**(Grep/Glob/Read)으로 동작한다. OC `research` 프로파일이 glob/grep을 직접 수행하므로(실측 확인), CC는 토픽 분류만 하고 조사·검색·집필을 OpenCode에 위임할 수 있다.

`cc-opencode` 설치 시 외부 조사·압축·집필을 `Skill(cc-opencode:delegate-oc)`을 통해 OpenCode에 위임해 CC 토큰을 절감한다. 위임 가용성·daemon 기동·결과 검증은 delegate-oc Skill이 자체적으로 책임지며, 본 플러그인은 `Skill` 호출 한 줄로만 dispatch한다.

## 기능

| Skill | 용도 | OC 위임 |
|---|---|---|
| `/cc-deep-tutor:deep-research` | 큰 주제 분해 → 병렬 조사 → 압축 보고서 | ✅ researcher·compressor·compose |
| `/cc-deep-tutor:deep-solve` | 수학·과학 문제 계획→풀이→집필 | ✅ writer |
| `/cc-deep-tutor:deep-question` | KB 자료 기반 소크라테스 출제 | ✅ generator |
| `/cc-deep-tutor:learn-chat` | KB 자동 부착 자유 학습 대화 | ❌ 대화형 |
| `/cc-deep-tutor:kb-search` | 마크다운 위키 검색 (search/expand/add/stats) | ❌ |

## 사전 설치 (사용자 환경)

### 필수
- **MinerU 2.5** — PDF 추출 (`pip install -U "mineru[core]"`)
- **bd (beads)** — 학습 진행 트래킹

> KB는 마크다운 파일 위키이므로 별도의 벡터 DB/임베딩 인프라(memsearch/Milvus/ollama)가 **필요 없다**.

### 선택 (OC 위임 활성화)
- **cc-opencode** — 외부 조사/집필 위임
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
      "Bash(mineru:*)",
      "Bash(bd:*)"
    ]
  }
}
```

KB 검색은 Grep/Glob/Read 네이티브 도구로 동작하므로 별도 Bash 권한이 필요 없다.

## 디렉토리 구조 (사용자 프로젝트 예)

```
my-study/
├── materials/
│   ├── papers/       # PDF 원본
│   ├── books/        # 교과서
│   ├── notes/        # 직접 작성 md
│   ├── extracted/    # MinerU 추출 결과 (.gitignore)
│   └── _wiki/        # 위키 제어 파일
│       ├── INDEX.md  # 노트 1줄 요약 색인 (hook 자동 갱신)
│       └── tags.md   # 태그 레지스트리 (통제 어휘)
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
- OC 위임 시: cc-opencode 설정의 low-cost 모델

## OC 위임 정책

각 sub-agent가 `Skill(cc-opencode:delegate-oc, args: <spec>)` 한 번을 호출한다. delegate-oc Skill이 다음을 모두 처리:
- cc-opencode 설치 여부 / opencode CLI 인증 / daemon health 검사
- 위임 가치 판단 (token budget, 작업 복잡도)
- daemon ensure (필요 시 자동 기동, 종료 시 정리)
- spec dispatch + 결과 diff 캡처 + 8줄 보고서 반환

delegate-oc가 `status: declined / error / aborted-perm`을 반환하면 호출 agent가 cc-only fallback으로 직접 작성한다.

위임 대상:
- `deep-research`의 topic-researcher (병렬 N개, `research` 타입 — KB glob/grep 검색 + 웹 + 집필 전담) + note-compressor + 최종 compose
- `deep-solve`의 solution-writer
- `deep-question`의 question-generator

`oc_delegate: never` 환경변수가 필요하면 호출 agent별 fallback 분기를 강제하는 식으로 사용자 .local.md에서 토글할 수 있다 (각 agent의 cc-only 경로는 항상 살아 있음).

## 자동 인덱싱 Hook

`auto_index_on_write: true` 시, `PostToolUse`로 Write/Edit가 `materials/` 아래 `.md`(단 `_wiki/` 제외)를 건드리면 `update-index.sh`가 자동 실행:
- 노트 frontmatter(id/type/tags/summary)를 파싱해 `_wiki/INDEX.md`의 해당 줄을 갱신
- `tags`가 `_wiki/tags.md` 레지스트리에 없으면 경고

별도 벡터 인덱싱이 없으므로 즉시 완료된다 (memsearch 시절의 Docker/임베딩 불필요).

## 라이선스

MIT
