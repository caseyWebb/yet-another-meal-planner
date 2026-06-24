import { describe, it, expect } from "vitest";
import {
  buildHealthPayload,
  handleHealthRequest,
  notifyFailure,
  probeD1,
  readJobHealth,
  writeJobHealth,
  type JobHealth,
} from "../src/health.js";
import type { KvStore } from "../src/kroger-user.js";
import type { Env } from "../src/env.js";

// A fake D1 binding whose `SELECT 1` either succeeds or throws — enough for the probe,
// which only ever issues `db(env).first("SELECT 1 AS ok")`. The default is reachable.
function fakeD1(reachable = true): D1Database {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async first() {
          if (!reachable) throw new Error("D1_ERROR: no such database");
          return { ok: 1 };
        },
      };
    },
  } as unknown as D1Database;
}

function fakeKv(): KvStore & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

const rec = (ok: boolean, summary: Record<string, unknown> = {}): JobHealth => ({
  ok,
  last_run_at: 1_700_000_000_000,
  summary,
});

describe("job health records", () => {
  it("round-trips write/read", async () => {
    const kv = fakeKv();
    await writeJobHealth(kv, "flyer-warm", rec(true, { action: "completed" }));
    expect(await readJobHealth(kv, "flyer-warm")).toEqual(rec(true, { action: "completed" }));
    expect(await readJobHealth(kv, "missing")).toBeNull();
  });
});

function healthEnv(d1: D1Database = fakeD1()): Env {
  return { DB: d1 } as unknown as Env;
}

describe("buildHealthPayload", () => {
  it("marks a missing record never-run and does not let it flip overall ok", async () => {
    const kv = fakeKv();
    await writeJobHealth(kv, "flyer-warm", rec(true));
    const p = await buildHealthPayload(healthEnv(), kv, ["flyer-warm", "email"]);
    expect(p.ok).toBe(true);
    const email = p.jobs.find((j) => j.name === "email")!;
    expect(email).toMatchObject({ ok: null, last_run_at: null, never_run: true });
  });

  it("overall ok is false when a job is explicitly failing", async () => {
    const kv = fakeKv();
    await writeJobHealth(kv, "flyer-warm", rec(false, { error: "boom" }));
    await writeJobHealth(kv, "email", rec(true));
    const p = await buildHealthPayload(healthEnv(), kv, ["flyer-warm", "email"]);
    expect(p.ok).toBe(false);
  });

  it("includes a D1 probe row and reports it reachable", async () => {
    const kv = fakeKv();
    await writeJobHealth(kv, "flyer-warm", rec(true));
    const p = await buildHealthPayload(healthEnv(), kv, ["flyer-warm"]);
    expect(p.d1).toEqual({ ok: true });
    expect(p.ok).toBe(true);
  });

  it("overall ok is false (and d1 reports the error) when D1 is unreachable", async () => {
    const kv = fakeKv();
    await writeJobHealth(kv, "flyer-warm", rec(true));
    const p = await buildHealthPayload(healthEnv(fakeD1(false)), kv, ["flyer-warm"]);
    expect(p.d1.ok).toBe(false);
    expect(p.d1.error).toMatch(/storage_error|D1/i);
    expect(p.ok).toBe(false);
  });
});

describe("probeD1", () => {
  it("returns ok for a reachable database", async () => {
    expect(await probeD1(healthEnv())).toEqual({ ok: true });
  });

  it("maps an unreachable database to a structured ok:false (never throws)", async () => {
    const status = await probeD1(healthEnv(fakeD1(false)));
    expect(status.ok).toBe(false);
    expect(typeof status.error).toBe("string");
  });
});

function env(over: Partial<Env>): Env {
  return { KROGER_KV: fakeKv(), DB: fakeD1(), ...over } as unknown as Env;
}

describe("handleHealthRequest", () => {
  it("404s when HEALTH_TOKEN is unset (opt-in)", async () => {
    const res = await handleHealthRequest(new Request("https://x/health"), env({}));
    expect(res.status).toBe(404);
  });

  it("401s on a missing or wrong token", async () => {
    const e = env({ HEALTH_TOKEN: "secret" });
    expect((await handleHealthRequest(new Request("https://x/health"), e)).status).toBe(401);
    expect((await handleHealthRequest(new Request("https://x/health?token=nope"), e)).status).toBe(401);
  });

  it("200s with the right token (query or bearer) and reports jobs", async () => {
    const kv = fakeKv();
    await writeJobHealth(kv, "flyer-warm", rec(true, { action: "completed" }));
    const e = { KROGER_KV: kv, DB: fakeD1(), HEALTH_TOKEN: "secret" } as unknown as Env;

    const viaQuery = await handleHealthRequest(new Request("https://x/health?token=secret"), e);
    expect(viaQuery.status).toBe(200);
    const body = (await viaQuery.json()) as { ok: boolean; jobs: { name: string }[] };
    expect(body.ok).toBe(true);
    expect(body.jobs.map((j) => j.name)).toEqual(["flyer-warm", "email"]);

    const viaHeader = await handleHealthRequest(
      new Request("https://x/health", { headers: { authorization: "Bearer secret" } }),
      e,
    );
    expect(viaHeader.status).toBe(200);
  });

  it("503s (so plain HTTP monitors trip) when a job is failing", async () => {
    const kv = fakeKv();
    await writeJobHealth(kv, "flyer-warm", rec(false, { error: "boom" }));
    const e = { KROGER_KV: kv, DB: fakeD1(), HEALTH_TOKEN: "secret" } as unknown as Env;
    const res = await handleHealthRequest(new Request("https://x/health?token=secret"), e);
    expect(res.status).toBe(503);
  });

  it("exposes only aggregate fields (no per-tenant data)", async () => {
    const kv = fakeKv();
    await writeJobHealth(kv, "email", rec(true, { accepted: true, reason: "sender_dkim", written: true }));
    const e = { KROGER_KV: kv, DB: fakeD1(), HEALTH_TOKEN: "secret" } as unknown as Env;
    const res = await handleHealthRequest(new Request("https://x/health?token=secret"), e);
    const text = await res.text();
    // The summary we stored is gate-outcome only; no address/tenant id should appear.
    expect(text).not.toMatch(/@/);
  });
});

describe("notifyFailure", () => {
  it("posts to ntfy with the token when NTFY_URL is set", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("ok");
    }) as unknown as typeof fetch;

    await notifyFailure(
      env({ NTFY_URL: "https://ntfy.sh/topic", NTFY_TOKEN: "tok" }),
      "flyer-warm",
      "KrogerError 429",
      fakeFetch,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://ntfy.sh/topic");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(calls[0].init.body).toBe("KrogerError 429");
  });

  it("is a no-op when NTFY_URL is unset", async () => {
    let called = false;
    const fakeFetch = (async () => {
      called = true;
      return new Response("");
    }) as unknown as typeof fetch;
    await notifyFailure(env({}), "flyer-warm", "x", fakeFetch);
    expect(called).toBe(false);
  });

  it("swallows a failing POST (alerting never affects the job)", async () => {
    const fakeFetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(
      notifyFailure(env({ NTFY_URL: "https://ntfy.sh/topic" }), "flyer-warm", "x", fakeFetch),
    ).resolves.toBeUndefined();
  });
});
