import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  createSession,
  readSession,
  deleteSession,
  refreshSession,
  requireSession,
  SESSION_PREFIX,
  SESSION_TTL_S,
  type ApiEnv,
  type SessionRecord,
} from "../src/session.js";
import { resolveTenant, directoryFromEnv } from "../src/tenant.js";
import type { Env } from "../src/env.js";

const DAY = 24 * 60 * 60 * 1000;

/** In-memory KV that HONORS `expirationTtl` against an injectable clock — the KV TTL is
 *  the session's single expiry authority, so the fake must model it for the expiry test. */
function ttlKv(clock: { now: number }) {
  const m = new Map<string, { value: string; expiresAt: number | null }>();
  let puts = 0;
  const kv = {
    async get(key: string) {
      const e = m.get(key);
      if (!e) return null;
      if (e.expiresAt !== null && clock.now >= e.expiresAt) {
        m.delete(key);
        return null;
      }
      return e.value;
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number }) {
      puts++;
      m.set(key, { value, expiresAt: opts?.expirationTtl ? clock.now + opts.expirationTtl * 1000 : null });
    },
    async delete(key: string) {
      m.delete(key);
    },
    async list({ prefix = "" }: { prefix?: string } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cacheStatus: null };
    },
  } as unknown as KVNamespace;
  return { kv, store: m, putCount: () => puts };
}

/** Minimal Env: the session store + allowlist in TENANT_KV; a stub DB absorbs the
 *  best-effort tenant-activity touch `resolveTenant(recordSeen=true)` fires. */
function sessionEnv(clock: { now: number }, allowlisted: string[] = ["casey"]) {
  const { kv, store, putCount } = ttlKv(clock);
  for (const id of allowlisted) {
    store.set(`tenant:${id}`, { value: JSON.stringify({ id }), expiresAt: null });
  }
  const env = {
    TENANT_KV: kv,
    DB: {
      prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({ meta: { changes: 0 } }) }) }),
    },
  } as unknown as Env;
  return { env, kv, store, putCount };
}

/** Dispatch a request through a real Hono app gated by `requireSession`. */
function whoamiApp() {
  return new Hono<ApiEnv>().get("/whoami", requireSession, (c) => c.json({ tenant: c.get("tenant") }));
}

describe("session store", () => {
  it("mints a 256-bit base64url token and round-trips the record", async () => {
    const clock = { now: 1_700_000_000_000 };
    const { env, kv } = sessionEnv(clock);
    const token = await createSession(env.TENANT_KV, "casey", clock.now);
    // 32 bytes → 43 base64url chars, cookie/KV-key-safe alphabet only.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const record = await readSession(kv, token);
    expect(record).toEqual({ tenant: "casey", created_at: clock.now, refreshed_at: clock.now });
  });

  it("expires via the KV TTL (the single expiry clock)", async () => {
    const clock = { now: 1_700_000_000_000 };
    const { env, kv } = sessionEnv(clock);
    const token = await createSession(env.TENANT_KV, "casey", clock.now);
    clock.now += SESSION_TTL_S * 1000 - 1000;
    expect(await readSession(kv, token)).not.toBeNull();
    clock.now += 2000; // past the 90-day TTL
    expect(await readSession(kv, token)).toBeNull();
  });

  it("throttles the rolling refresh: no re-put under 24h, a fresh TTL after", async () => {
    const clock = { now: 1_700_000_000_000 };
    const { env, kv, putCount } = sessionEnv(clock);
    const token = await createSession(env.TENANT_KV, "casey", clock.now);
    const record = (await readSession(kv, token)) as SessionRecord;
    const before = putCount();

    // Inside the throttle window: a no-op (no KV write).
    await refreshSession(kv, token, record, clock.now + 60 * 60 * 1000);
    expect(putCount()).toBe(before);

    // Past the throttle: re-put with an updated refreshed_at + a fresh 90-day TTL.
    const later = clock.now + 25 * 60 * 60 * 1000;
    clock.now = later; // the fake KV stamps expiry off the run clock, like real KV
    await refreshSession(kv, token, record, later);
    expect(putCount()).toBe(before + 1);
    const refreshed = (await readSession(kv, token)) as SessionRecord;
    expect(refreshed.refreshed_at).toBe(later);
    expect(refreshed.created_at).toBe(record.created_at);
    // The TTL restarted from the refresh: alive well past the ORIGINAL expiry.
    clock.now = record.created_at + SESSION_TTL_S * 1000 + DAY;
    expect(await readSession(kv, token)).not.toBeNull();
  });

  it("logout deletes the record — a replayed token no longer reads", async () => {
    const clock = { now: 1_700_000_000_000 };
    const { env, kv, store } = sessionEnv(clock);
    const token = await createSession(env.TENANT_KV, "casey", clock.now);
    await deleteSession(kv, token);
    expect(await readSession(kv, token)).toBeNull();
    expect([...store.keys()].filter((k) => k.startsWith(SESSION_PREFIX))).toEqual([]);
  });
});

describe("requireSession middleware", () => {
  it("yields the same normalized Tenant the MCP path builds", async () => {
    const clock = { now: 1_700_000_000_000 };
    const { env } = sessionEnv(clock);
    // Store a MIXED-CASE tenant id on the record: the middleware must resolve the same
    // canonical (lowercase) Tenant `resolveTenant` yields on the MCP surface.
    const token = await createSession(env.TENANT_KV, "Casey", clock.now);
    const res = await whoamiApp().request(
      "http://127.0.0.1/whoami",
      { headers: { cookie: `__Host-session=${token}` } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tenant: { id: string } };
    const mcpTenant = await resolveTenant(env, "Casey", directoryFromEnv(env));
    expect(body.tenant).toEqual(mcpTenant);
    expect(body.tenant).toEqual({ id: "casey" });
  });

  it("401s a missing cookie, an unknown token, and an expired record — uniformly", async () => {
    const clock = { now: 1_700_000_000_000 };
    const { env } = sessionEnv(clock);
    const app = whoamiApp();

    const bare = await app.request("http://127.0.0.1/whoami", {}, env);
    const unknown = await app.request(
      "http://127.0.0.1/whoami",
      { headers: { cookie: "__Host-session=not-a-real-token" } },
      env,
    );
    const token = await createSession(env.TENANT_KV, "casey", clock.now);
    clock.now += SESSION_TTL_S * 1000 + 1000; // KV TTL lapses
    const expired = await app.request(
      "http://127.0.0.1/whoami",
      { headers: { cookie: `__Host-session=${token}` } },
      env,
    );

    for (const res of [bare, unknown, expired]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized", message: "No session" });
    }
  });

  it("locks out a delisted member's live session immediately (allowlist re-check)", async () => {
    const clock = { now: 1_700_000_000_000 };
    const { env, store } = sessionEnv(clock);
    const token = await createSession(env.TENANT_KV, "casey", clock.now);
    const app = whoamiApp();
    const before = await app.request("http://127.0.0.1/whoami", { headers: { cookie: `__Host-session=${token}` } }, env);
    expect(before.status).toBe(200);

    store.delete("tenant:casey"); // revoked from the allowlist; the session record still exists
    const after = await app.request("http://127.0.0.1/whoami", { headers: { cookie: `__Host-session=${token}` } }, env);
    expect(after.status).toBe(401);
    expect(await after.json()).toEqual({ error: "unauthorized", message: "No session" });
  });
});
