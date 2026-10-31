const TIMEOUT_MS = 10_000;
const MAX_GET_RETRIES = 2;

export class SendieeError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const baseUrl = () => (process.env.SENDIEE_BASE_URL ?? "https://api.sendiee.com").replace(/\/$/, "");

export const isSendieeConfigured = () => Boolean(process.env.SENDIEE_API_KEY && process.env.SENDIEE_BRAND_NUMBER);

export function brandNumber() {
  const value = process.env.SENDIEE_BRAND_NUMBER;
  if (!value) throw new SendieeError("NOT_CONFIGURED", "SENDIEE_BRAND_NUMBER is not set", 503);
  return value;
}

type Options = {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The only place that talks to Sendiee. GETs retry on 429/5xx/network errors; POSTs never
 * retry, because a resent message would reach the customer twice.
 */
export async function sendieeRequest<T>(path: string, { method = "GET", body, query }: Options = {}): Promise<T> {
  const key = process.env.SENDIEE_API_KEY;
  if (!key) throw new SendieeError("NOT_CONFIGURED", "SENDIEE_API_KEY is not set", 503);

  const url = new URL(`${baseUrl()}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

  const attempts = method === "GET" ? MAX_GET_RETRIES + 1 : 1;
  let lastError: SendieeError | undefined;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await wait(backoffMs(attempt, lastError));
    try {
      const res = await fetch(url, {
        method,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
      if (res.ok) return json as T;

      lastError = new SendieeError(json?.code ?? "SENDIEE_ERROR", json?.message ?? `Sendiee returned ${res.status}`, res.status);
      console.error(`Sendiee ${method} ${path} failed: ${res.status} ${lastError.code}`);
      if (res.status !== 429 && res.status < 500) throw lastError;
    } catch (err) {
      if (err instanceof SendieeError && err === lastError && err.status !== 429 && err.status < 500) throw err;
      if (!(err instanceof SendieeError)) {
        lastError = new SendieeError("SENDIEE_UNREACHABLE", "Could not reach Sendiee", 503);
        console.error(`Sendiee ${method} ${path} network error: ${(err as Error).name}`);
      }
    }
  }
  throw lastError ?? new SendieeError("SENDIEE_ERROR", "Sendiee request failed", 502);
}

function backoffMs(attempt: number, _err?: SendieeError) {
  return process.env.NODE_ENV === "test" ? 1 : 500 * 2 ** attempt;
}
