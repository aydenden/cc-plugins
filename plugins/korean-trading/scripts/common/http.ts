// --- HTTP Fetch Wrapper ---
// Rate-limited fetch with retry, stderr logging, JSON envelope output

export interface ApiResponse<T = unknown> {
  ok: true;
  data: T;
  meta: { source: string; fetched_at: string };
}

export interface ApiError {
  ok: false;
  error: { code: string; message: string };
}

export type ApiResult<T = unknown> = ApiResponse<T> | ApiError;

// --- Rate Limit ---

const lastCallByHost: Map<string, number> = new Map();

const RATE_LIMITS: Record<string, number> = {
  "openapi.koreainvestment.com": 200,
  "data-dbg.krx.co.kr": 1000,
  "opendart.fss.or.kr": 1000,
  "ecos.bok.or.kr": 1000,
  "api.stlouisfed.org": 500,
  "oapi.koreaexim.go.kr": 1000,
  "apis.data.go.kr": 1000,
  "www.alphavantage.co": 12000,
};

function getDelayForHost(url: string): number {
  for (const [host, delay] of Object.entries(RATE_LIMITS)) {
    if (url.includes(host)) return delay;
  }
  return 0;
}

async function rateLimit(url: string): Promise<void> {
  const delay = getDelayForHost(url);
  if (delay === 0) return;

  const host = new URL(url).host;
  const last = lastCallByHost.get(host) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < delay) {
    await Bun.sleep(delay - elapsed);
  }
  lastCallByHost.set(host, Date.now());
}

// --- Retry Logic ---

interface FetchOptions extends RequestInit {
  timeoutMs?: number;
  maxRetries?: number;
}

export async function fetchWithRetry(
  url: string,
  options: FetchOptions = {},
): Promise<Response> {
  const { timeoutMs = 30_000, maxRetries = 3, ...init } = options;

  let lastError: Error | null = null;
  let delay = 500;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await rateLimit(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (resp.status === 429) {
        log(`Rate limited (429), retry ${attempt + 1}/${maxRetries}`);
        await Bun.sleep(delay);
        delay *= 2;
        continue;
      }

      return resp;
    } catch (err) {
      clearTimeout(timer);
      lastError = err as Error;
      if (attempt < maxRetries) {
        log(`Fetch error: ${lastError.message}, retry ${attempt + 1}/${maxRetries}`);
        await Bun.sleep(delay);
        delay *= 2;
      }
    }
  }

  throw lastError ?? new Error("Fetch failed after retries");
}

// --- Logging ---

export function log(msg: string): void {
  console.error(`[korean-trading] ${msg}`);
}

// --- Output Helpers ---

export function success<T>(data: T, source: string): ApiResponse<T> {
  return {
    ok: true,
    data,
    meta: { source, fetched_at: new Date().toISOString() },
  };
}

export function fail(code: string, message: string): ApiError {
  return { ok: false, error: { code, message } };
}

export function output(result: ApiResult): void {
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

// --- Env Helper ---

export function requireEnv(name: string): string {
  const val = Bun.env[name];
  if (!val) {
    output(fail("ENV_MISSING", `환경변수 ${name}이(가) 설정되지 않았습니다`));
    process.exit(0);
  }
  return val;
}
