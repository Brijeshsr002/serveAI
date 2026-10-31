/** Browser helper for ServeAI's own API. Sendiee and payment secrets stay behind it. */
export async function api<T = unknown>(path: string, { method = "GET", body }: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Couldn't reach the server. Check your connection.");
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) throw new Error(json?.error?.message ?? "Something went wrong. Please try again.");
  return json.data as T;
}
