/**
 * paths.ts — 런타임 자산 경로 해석 (SSoT).
 *
 * 모델 캐시 위치는 TS 런타임(models.ts)과 SessionStart 훅(session-start.sh) 양쪽이 알아야 해서
 * 여기가 단일 정의 지점이다. 훅은 `llm-wiki cache-dir`로 이 함수의 결과를 읽는다 — bash에
 * 같은 규칙을 복제하면 드리프트가 생긴다. 무거운 의존성을 임포트하지 않으므로 CLI에서
 * 값싸게 호출할 수 있다(@huggingface/transformers를 끌어오는 models.ts와 분리한 이유).
 */

import fs from "fs"
import path from "path"

/**
 * ONNX 모델 캐시(~1.1GB) 디렉토리.
 *
 * 우선순위:
 *   1. TRANSFORMERS_CACHE / HF_HOME — 사용자가 명시했으면 그대로 따른다.
 *   2. XDG 캐시(`~/.cache/llm-wiki/models`) — 기본값. 플러그인은 `<plugin>/<version>/`으로
 *      버전마다 새 디렉토리에 설치되므로, 플러그인 안에 두면 버전업마다 1.1GB가 고아가 된다.
 *      버전 무관 위치에 두면 여러 버전·다른 도구가 같은 모델을 공유한다.
 *   3. `CLAUDE_PLUGIN_ROOT/.cache/models` — XDG가 쓰기 불가일 때의 폴백.
 *
 * @returns 존재가 보장된(생성 시도까지 마친) 캐시 디렉토리 절대경로.
 */
export function resolveModelCacheDir(): string {
  const explicit = process.env.TRANSFORMERS_CACHE || process.env.HF_HOME
  if (explicit) return explicit

  const xdgBase =
    process.env.XDG_CACHE_HOME ||
    process.env.LOCALAPPDATA ||
    path.join(process.env.HOME || process.env.USERPROFILE || ".", ".cache")
  const preferred = path.join(xdgBase, "llm-wiki", "models")
  try {
    fs.mkdirSync(preferred, { recursive: true })
    fs.accessSync(preferred, fs.constants.W_OK)
    return preferred
  } catch {
    const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(import.meta.dir, "..")
    return path.join(pluginRoot, ".cache", "models")
  }
}
