// Fixed-window KV rate limiter (best-effort, fail-open) — extracted from the ingest
// endpoint so the member login (`src/api/session.ts`) and the satellite surfaces share
// ONE implementation instead of duplicating the window math. Callers own their key
// namespace (`ingest:rl:<keyId>` in KROGER_KV, `login:rl:<ip>` beside it); the limiter
// appends the window bucket. Counter keys self-expire (`expirationTtl: windowS * 2`),
// so the keyspace stays bounded with no janitor.

/**
 * Best-effort fixed-window limiter over `kv`. Returns true when the request is allowed:
 * the counter at `<key>:<bucket>` (bucket = floor(now / windowS)) is below `max`, in
 * which case it is incremented. FAIL-OPEN: a KV read/write failure allows the request —
 * the limiter's own outage must never reject a valid push or lock a member out of login.
 */
export async function underRateLimit(
  kv: KVNamespace,
  key: string,
  max: number,
  windowS: number,
  now: number,
): Promise<boolean> {
  try {
    const bucket = Math.floor(now / 1000 / windowS);
    const k = `${key}:${bucket}`;
    const cur = Number.parseInt((await kv.get(k)) ?? "0", 10) || 0;
    if (cur >= max) return false;
    await kv.put(k, String(cur + 1), { expirationTtl: windowS * 2 });
    return true;
  } catch {
    return true; // never let the limiter's own failure reject a valid request
  }
}
