# 스펙 변경을 생성물에 반영하기

축 추가는 데이터라 재생성이 필요 없다. 그러나 `stages`·`skills`·`evidence_store`가 바뀌면 생성된 스킬 본문을 고쳐야 한다. 이 문서는 그 절차를 다룬다.

**create-plugin을 다시 부르지 않는다.** 그것은 처음부터 만드는 도구라 기존 파일을 덮어쓰고, 손으로 다듬은 내용이 날아간다. 영향받는 파일만 편집한다.

## 변경 종류별 파급

| 스펙에서 바뀐 것 | 고쳐야 하는 것 |
|---|---|
| `axes`·`axes_excluded` | 없음 — 실행 시점에 읽힌다 |
| `citations`·`negation` | 없음 — 실행 시점에 읽힌다 |
| `stages[].artifact`·`preview`·`invariants` | hook 은 그대로(실행 시점에 읽힌다). 산출물 위치·frontmatter 를 안내하는 스킬 본문, `invariants` 가 부르는 스크립트 |
| `stages` 추가 | 스킬 1개 신규 + 앞뒤 단계의 "다음 단계" 문구 |
| `stages` 삭제 | 스킬 제거 + 그것을 가리키던 문구 전부 |
| `stages[].kind` seam↔delegate | 스킬 신규/제거 + 위임 문구 |
| `stages[].checks` | 해당 스킬의 증거 절. hooks.json 은 그대로 — 시점과 차단 여부는 검사 종류가 정한다 |
| `skills.required/recommended` | 위임 대상을 언급한 모든 스킬 본문 |
| (스펙은 그대로, 위임 대상 스킬의 `disable-model-invocation` 이 바뀜) | 그 단계로 넘기는 앞 스킬의 문구와 `PRIME.md` 의 단계 순서 (`stage-patterns.md` 「위임 단계의 문구」) |
| `evidence_store` | 증거 경로를 다루는 스킬. 검사가 걸린 단계의 `artifact.dirs` 도 함께 |
| (스펙은 그대로, wf가 올라감) | 생성물 `scripts/`의 검사 스크립트 복사본과 `hooks/hooks.json` |

가장 자주 빠뜨리는 것은 **앞뒤 단계의 연결 문구**다. 단계를 하나 넣으면 그 앞 단계의 "다음은 X" 와 뒤 단계의 "앞서 Y가 끝났으면" 이 둘 다 어긋난다.

## 1. drift부터 본다

스펙과 생성물이 이미 어긋나 있을 수 있다. 변경을 얹기 전에 현재 차이를 확인한다.

```bash
# 스펙의 seam 단계 목록 — 생성물 루트에서, 생성물이 가진 스펙 리더로 읽는다
node --input-type=module -e 'import { loadSpec } from "./scripts/lib/spec-file.mjs"; for (const s of loadSpec(process.argv[1]).stages) if (s.kind === "seam") console.log(s.id)' <프로젝트 루트>/.claude/<플러그인>.spec.jsonc
# 실제 존재하는 스킬
ls skills/
```

스펙이 깨져 있으면 이 명령이 어디가 틀렸는지와 함께 실패한다. 그 상태에서는 hook 이 모든 티켓 닫기를 막고 있으므로 스펙부터 고친다.

복사된 검사 스크립트도 본다. 생성 시점에 `scripts/`로 복사된 것이라 wf가 올라가도 따라오지 않는다 — 스펙을 한 줄도 안 바꿨어도 생기는 drift다.

```bash
# wf 플러그인 루트에서
for f in scripts/hook-*.mjs scripts/lib/*.mjs; do
  cmp -s "$f" "<생성물 루트>/$f" || echo "STALE $f"
done
cmp -s templates/hooks.json "<생성물 루트>/hooks/hooks.json" || echo "STALE hooks.json"
```

사본은 원본과 바이트 단위로 같아야 한다 — 프로젝트마다 다른 것은 전부 스펙에 있으므로 스크립트를 고칠 이유가 없다. `STALE`이 뜨면 아래 2번의 손수정 판별을 거친 뒤 다시 복사한다. 손수정이 있었다면 그것은 스펙의 키(`citations`·`negation`·`invariants`)로 옮길 내용이다. `hooks.json` 은 생성물이 다른 hook 을 더해 둔 것이면 다를 수 있다 — 그때는 두 검사 hook 의 항목만 대조한다.

생성물의 `scripts/` 에 `.mjs` 가 없고 bash 검사만 있으면 0.7.0 이전 형식이다. 스펙도 JSONC 가 아니라 YAML frontmatter 를 가진 마크다운일 것이므로, 복사가 아니라 스펙을 새 형식(`templates/workflow.spec.jsonc`)으로 옮기는 일이 먼저다.

스펙과 생성물 사이에 다른 것이 있으면 **어느 쪽이 옳은지 사용자에게 묻는다.** 스펙이 앞서간 것인지(반영 안 됨), 생성물이 앞서간 것인지(스펙 갱신 누락)는 파일만 봐서는 알 수 없다.

## 2. 손수정을 판별한다

생성된 뒤 사람이 고친 파일을 덮으면 안 된다. git이 답을 준다.

```bash
git log --oneline -1 -- plugins/<플러그인>/          # 마지막 변경
git log --oneline --follow -- plugins/<플러그인>/skills/<스킬>/SKILL.md
```

생성 커밋 이후 별도 커밋이 있으면 손수정된 파일이다. 커밋되지 않은 변경도 확인한다.

```bash
git status --short plugins/<플러그인>/
```

손수정된 파일은 **덮지 말고 해당 부분만 편집**한다. 어느 부분인지 애매하면 사용자에게 diff를 보여주고 묻는다.

## 3. 영향 파일을 제시하고 컨펌받는다

고치기 전에 반드시 목록을 낸다. **스펙도 아직 고치지 않는다** — hook 이 스펙을 실행 시점마다 읽으므로, 스펙을 먼저 고치면 승인 전에 검사 동작이 바뀐다. 여기서 내는 것은 스펙의 변경안이다.

```
스펙 변경: stages 에 preview 단계 추가

새로 만들 것
  skills/preview/SKILL.md

고칠 것
  skills/define/SKILL.md   마지막 절 "다음 단계" → preview 로
  skills/implement/SKILL.md 도입부 "정의가 끝났으면" → "프리뷰 컨펌이 끝났으면"
  hooks/hooks.json          preview 단계 커버리지 검사 추가

손수정 감지
  skills/define/SKILL.md   ⚠ 2026-08-20 이후 직접 편집됨 — 해당 절만 고침
```

승인 없이 파일을 건드리지 않는다.

## 4. 반영하고 검증한다

승인받은 대로 스펙을 고치고, 영향받는 파일을 편집한다. 편집 후 생성물이 여전히 유효한지 확인한다.

- 각 `SKILL.md`의 frontmatter `name`이 디렉토리명과 일치하는가
- 스킬 본문과 hooks.json 이 플러그인 루트 기준으로 가리키는 경로가 전부 실재하는가
- 스펙이 읽히는가 (위 1번의 스펙 리더 명령이 오류 없이 끝난다)
- 제거된 스킬을 가리키는 문구가 남아 있지 않은가 (`grep -rn "<제거된 id>"`)
- 사용자만 부를 수 있는 스킬을 Skill 도구로 부르라는 문구가 없는가 (설치본 `SKILL.md` 의 `disable-model-invocation`)
- hooks.json이 유효한가

제거된 스킬을 가리키는 문구가 특히 잘 남는다. 스킬을 지웠는데 다른 스킬 본문이 여전히 그것을 가리키면, 없는 스킬을 부르라는 지시가 남는다.

## 5. 스펙과 생성물을 같은 커밋에 담는다

둘이 다른 커밋에 나뉘면 어느 시점의 스펙이 어느 생성물에 대응하는지 추적이 끊긴다. 커밋은 사용자 승인 후에 하고, 메시지에 무엇이 바뀌었는지 남긴다.
