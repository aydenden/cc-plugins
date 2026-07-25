/**
 * models.ts — Transformers.js 임베딩 + cross-encoder rerank (native onnxruntime-node).
 *
 * - 임베딩: bge-m3 (onnx-community/bge-m3-ONNX), CLS pooling + L2 정규화 → 1024차원 dense.
 * - rerank: bge-reranker-v2-m3 (onnx-community/bge-reranker-v2-m3-ONNX), (query, doc) 쌍의
 *   관련도 로짓 → sigmoid.
 * - 백엔드는 native onnxruntime-node(device "cpu"), dtype q8(속도/메모리 절충 — 부록E spike).
 * - 배치는 패딩 낭비로 이득이 없어 임베딩은 직렬 처리(부록E).
 * - 모델이 아직 없거나 로드 실패면 예외를 던지고, 호출부가 degraded(BM25-only)로 폴백한다.
 */

import { env, pipeline, AutoTokenizer, AutoModelForSequenceClassification } from "@huggingface/transformers"
import path from "path"
import fs from "fs"

export const EMBED_MODEL = "onnx-community/bge-m3-ONNX"
export const RERANK_MODEL = "onnx-community/bge-reranker-v2-m3-ONNX"
const DTYPE = "q8" as const
const DEVICE = "cpu" as const
// reranker 입력 상한(속도) — 청크는 512~1024 토큰 권장이라 512로 자른다.
const RERANK_MAX_LEN = 512

// --- 모델 캐시 경로 (ADR-3: 기기별 공유 자산) ---

export function resolveModelCacheDir(): string {
  const explicit = process.env.TRANSFORMERS_CACHE || process.env.HF_HOME
  if (explicit) return explicit
  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || path.join(import.meta.dir, "..")
  const preferred = path.join(pluginRoot, ".cache", "models")
  try {
    fs.mkdirSync(preferred, { recursive: true })
    fs.accessSync(preferred, fs.constants.W_OK)
    return preferred
  } catch {
    const xdg =
      process.env.XDG_CACHE_HOME ||
      process.env.LOCALAPPDATA ||
      path.join(process.env.HOME || process.env.USERPROFILE || ".", ".cache")
    return path.join(xdg, "llm-wiki", "models")
  }
}

env.cacheDir = resolveModelCacheDir()
env.allowRemoteModels = true

// --- 임베딩 ---

let extractorPromise: Promise<any> | null = null

function getExtractor(): Promise<any> {
  extractorPromise ??= pipeline("feature-extraction", EMBED_MODEL, { dtype: DTYPE, device: DEVICE })
  return extractorPromise
}

/**
 * 텍스트 배열을 직렬로 임베딩(부록E: 배치 이득 없음).
 * 각 벡터는 CLS pooling + L2 정규화된 1024차원.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  // 강제 lexical(BM25-only) 스위치 — 오프라인/테스트/의도적 강등.
  if (process.env.LLM_WIKI_NO_MODEL) throw new Error("LLM_WIKI_NO_MODEL 설정됨 — 임베딩 비활성")
  const extractor = await getExtractor()
  const out: number[][] = []
  for (const text of texts) {
    const res = await extractor(text, { pooling: "cls", normalize: true })
    out.push(Array.from(res.data as Float32Array))
  }
  return out
}

/** 단일 쿼리 임베딩(검색 시 — 수십~수백 ms). */
export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embed([text])
  return vec
}

// --- rerank (cross-encoder) ---

let rerankTokenizerPromise: Promise<any> | null = null
let rerankModelPromise: Promise<any> | null = null

async function getReranker(): Promise<{ tokenizer: any; model: any }> {
  rerankTokenizerPromise ??= AutoTokenizer.from_pretrained(RERANK_MODEL)
  rerankModelPromise ??= AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL, {
    dtype: DTYPE,
    device: DEVICE,
  })
  const [tokenizer, model] = await Promise.all([rerankTokenizerPromise, rerankModelPromise])
  return { tokenizer, model }
}

/**
 * (query, docs[i]) 쌍의 관련도 점수(0~1)를 반환. 높을수록 관련.
 * bge-reranker-v2-m3는 단일 로짓을 내므로 sigmoid로 정규화한다.
 */
export async function rerank(query: string, docs: string[]): Promise<number[]> {
  if (docs.length === 0) return []
  if (process.env.LLM_WIKI_NO_MODEL) throw new Error("LLM_WIKI_NO_MODEL 설정됨 — rerank 비활성")
  const { tokenizer, model } = await getReranker()
  const inputs = tokenizer(new Array(docs.length).fill(query), {
    text_pair: docs,
    padding: true,
    truncation: true,
    max_length: RERANK_MAX_LEN,
  })
  const { logits } = await model(inputs)
  // logits: [n, 1] → sigmoid → [n]
  const scores = (logits.sigmoid().tolist() as number[][]).map((row) => row[0])
  return scores
}

// --- 준비 상태 점검 (status 커맨드용) ---

/**
 * 모델 캐시에 임베딩 모델 흔적이 있는지 가볍게 판정(전체 로드 없이).
 * 정확한 판정이 아니라 status 안내용 힌트.
 */
export function embeddingModelCached(): boolean {
  const dir = path.join(resolveModelCacheDir(), ...EMBED_MODEL.split("/"))
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0
  } catch {
    return false
  }
}
