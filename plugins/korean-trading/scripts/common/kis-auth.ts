// --- KIS OAuth2 Token Management ---
// 토큰 발급 → 파일 캐시 → mkdir 기반 lock → 만료 10분 전 갱신

import { fetchWithRetry, requireEnv, log, fail, output } from "./http.ts";
import { getCachePath, readCache, writeCache, withLock } from "./cache.ts";

const KIS_BASE = "https://openapi.koreainvestment.com:9443";
const TOKEN_CACHE_PATH = getCachePath("kis", "token.json");
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // 23시간 (실제 24시간, 1시간 마진)
const RENEW_BEFORE_MS = 10 * 60 * 1000; // 만료 10분 전 갱신

interface KisToken {
  access_token: string;
  token_type: string;
  expires_at: string;
}

interface KisHeaders {
  authorization: string;
  appkey: string;
  appsecret: string;
  tr_id: string;
  "Content-Type": string;
}

let memoryToken: KisToken | null = null;

function isTokenValid(token: KisToken): boolean {
  const expiresAt = new Date(token.expires_at).getTime();
  return Date.now() < expiresAt - RENEW_BEFORE_MS;
}

async function issueToken(appKey: string, appSecret: string): Promise<KisToken> {
  log("Issuing new KIS token");
  const resp = await fetchWithRetry(`${KIS_BASE}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: appKey,
      appsecret: appSecret,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Token issue failed: HTTP ${resp.status}`);
  }

  const json = await resp.json() as {
    access_token: string;
    token_type: string;
    access_token_token_expired: string;
  };

  return {
    access_token: json.access_token,
    token_type: json.token_type,
    expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString(),
  };
}

export async function getKisToken(): Promise<KisToken> {
  const appKey = requireEnv("KIS_APP_KEY");
  const appSecret = requireEnv("KIS_APP_SECRET");

  // 1. 메모리 캐시
  if (memoryToken && isTokenValid(memoryToken)) {
    log("Using memory-cached token");
    return memoryToken;
  }

  // 2. 파일 캐시
  const cached = readCache<KisToken>(TOKEN_CACHE_PATH);
  if (cached && isTokenValid(cached.data)) {
    log("Using file-cached token");
    memoryToken = cached.data;
    return cached.data;
  }

  // 3. Lock 획득 후 발급
  const token = await withLock("kis-token", async () => {
    // Double-check after lock
    const rechecked = readCache<KisToken>(TOKEN_CACHE_PATH);
    if (rechecked && isTokenValid(rechecked.data)) {
      return rechecked.data;
    }
    const newToken = await issueToken(appKey, appSecret);
    writeCache(TOKEN_CACHE_PATH, newToken, TOKEN_TTL_MS);
    return newToken;
  });

  memoryToken = token;
  return token;
}

export function buildKisHeaders(token: KisToken, trId: string): Record<string, string> {
  const appKey = Bun.env.KIS_APP_KEY!;
  const appSecret = Bun.env.KIS_APP_SECRET!;
  return {
    authorization: `Bearer ${token.access_token}`,
    appkey: appKey,
    appsecret: appSecret,
    tr_id: trId,
    "Content-Type": "application/json; charset=utf-8",
  };
}

export async function kisGet<T = unknown>(
  path: string,
  trId: string,
  params: Record<string, string>,
): Promise<T> {
  const token = await getKisToken();
  const headers = buildKisHeaders(token, trId);
  const qs = new URLSearchParams(params).toString();
  const url = `${KIS_BASE}${path}?${qs}`;

  const resp = await fetchWithRetry(url, { headers });
  if (!resp.ok) {
    throw new Error(`KIS API error: HTTP ${resp.status}`);
  }

  const json = await resp.json() as { rt_cd: string; msg1: string; msg_cd: string; output?: unknown; output1?: unknown; output2?: unknown };
  if (json.rt_cd !== "0") {
    if (json.msg_cd === "EGW00201") {
      throw new Error("KIS rate limit exceeded");
    }
    throw new Error(`KIS error: ${json.msg_cd} - ${json.msg1}`);
  }

  return json as T;
}
