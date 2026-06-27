import { describe, it, expect } from "vitest";
import {
  buildHealthPayload,
  handleHealthRequest,
  handleHealthSvgRequest,
  notifyFailure,
  probeD1,
  readJobHealth,
  renderHealthSvg,
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
  it("is open (no token gate) and reports each registered job", async () => {
    const kv = fakeKv();
    await writeJobHealth(kv, "flyer-warm", rec(true, { action: "completed" }));
    const e = { KROGER_KV: kv, DB: fakeD1() } as unknown as Env;
    const res = await handleHealthRequest(e);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; jobs: { name: string }[] };
    expect(body.ok).toBe(true);
    expect(body.jobs.map((j) => j.name)).toEqual(["flyer-warm", "recipe-embed", "email"]);
  });

  it("503s (so plain HTTP monitors trip) when a job is failing", async () => {
    const kv = fakeKv();
    await writeJobHealth(kv, "flyer-warm", rec(false, { error: "boom" }));
    const e = { KROGER_KV: kv, DB: fakeD1() } as unknown as Env;
    const res = await handleHealthRequest(e);
    expect(res.status).toBe(503);
  });

  it("coarsens the D1 probe to a boolean — no raw error string in the public payload", async () => {
    const kv = fakeKv();
    await writeJobHealth(kv, "flyer-warm", rec(true));
    const e = { KROGER_KV: kv, DB: fakeD1(false) } as unknown as Env;
    const res = await handleHealthRequest(e);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { d1: { ok: boolean; error?: string } };
    expect(body.d1.ok).toBe(false);
    expect(body.d1.error).toBeUndefined();
  });

  it("exposes only aggregate fields (no per-tenant data)", async () => {
    const kv = fakeKv();
    await writeJobHealth(kv, "email", rec(true, { accepted: true, reason: "sender_dkim", written: true }));
    const e = { KROGER_KV: kv, DB: fakeD1() } as unknown as Env;
    const res = await handleHealthRequest(e);
    const text = await res.text();
    // The summary we stored is gate-outcome only; no address/tenant id should appear.
    expect(text).not.toMatch(/@/);
  });
});

describe("handleHealthSvgRequest", () => {
  it("200s with an SVG card listing every job + d1 when healthy (open, no token)", async () => {
    const kv = fakeKv();
    await writeJobHealth(kv, "flyer-warm", rec(true));
    await writeJobHealth(kv, "recipe-embed", rec(true));
    await writeJobHealth(kv, "email", rec(true));
    const e = { KROGER_KV: kv, DB: fakeD1() } as unknown as Env;
    const res = await handleHealthSvgRequest(e);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/image\/svg\+xml/);
    expect(res.headers.get("cache-control")).toMatch(/max-age=\d+/);
    const body = await res.text();
    expect(body.startsWith("<svg")).toBe(true);
    for (const name of ["flyer-warm", "recipe-embed", "email", "d1"]) expect(body).toContain(name);
    expect(body).toContain("healthy");
    expect(body).not.toContain("#d29922"); // no amber when nothing is never-run
  });

  it("still 200s (never 503) when degraded, showing the degraded headline", async () => {
    const kv = fakeKv();
    await writeJobHealth(kv, "flyer-warm", rec(false, { error: "boom" }));
    const e = { KROGER_KV: kv, DB: fakeD1() } as unknown as Env;
    const res = await handleHealthSvgRequest(e);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("degraded");
  });

  it("renders a never-run job in the distinct amber/pending style (not as broken)", async () => {
    const kv = fakeKv();
    await writeJobHealth(kv, "flyer-warm", rec(true)); // recipe-embed + email never run
    const e = { KROGER_KV: kv, DB: fakeD1() } as unknown as Env;
    const res = await handleHealthSvgRequest(e);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain("#d29922"); // amber present for the never-run rows
    expect(body).toContain("never");
    expect(body).toContain("healthy"); // a never-run job does NOT make the card read degraded
  });

  it("renders only aggregate data (no per-tenant identifiers)", async () => {
    const kv = fakeKv();
    await writeJobHealth(kv, "email", rec(true, { accepted: true, reason: "sender_dkim", written: true }));
    const e = { KROGER_KV: kv, DB: fakeD1() } as unknown as Env;
    const res = await handleHealthSvgRequest(e);
    const body = await res.text();
    expect(body).not.toMatch(/@/); // no email addresses
    expect(body).not.toContain("sender_dkim"); // summary fields are never rendered
  });
});

describe("renderHealthSvg", () => {
  it("formats relative last-run ages and reflects a degraded headline", () => {
    const now = 1_700_000_000_000;
    const svg = renderHealthSvg({
      ok: false,
      generated_at: now,
      jobs: [
        { name: "flyer-warm", ok: true, last_run_at: now - 2 * 3_600_000 },
        { name: "email", ok: false, last_run_at: now - 30_000 },
      ],
      d1: { ok: true },
      admin: { access_configured: true, email_allowlist: false, dev_bypass_set: false, exposed: false },
    });
    expect(svg).toContain("2h ago");
    expect(svg).toContain("just now");
    expect(svg).toContain("degraded");
  });
});

describe("admin gate posture in health", () => {
  const okJobs = async (kv: ReturnType<typeof fakeKv>) => {
    await writeJobHealth(kv, "flyer-warm", rec(true));
    await writeJobHealth(kv, "recipe-embed", rec(true));
    await writeJobHealth(kv, "email", rec(true));
  };

  it("reports the gate posture as booleans and never the allowlisted emails", async () => {
    const kv = fakeKv();
    await okJobs(kv);
    const e = {
      KROGER_KV: kv,
      DB: fakeD1(),
      ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      ACCESS_AUD: "aud123",
      ACCESS_ALLOWED_EMAILS: "operator@example.com",
    } as unknown as Env;
    const res = await handleHealthRequest(e);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; admin: Record<string, boolean> };
    expect(body.admin).toEqual({
      access_configured: true,
      email_allowlist: true,
      dev_bypass_set: false,
      exposed: false,
    });
    expect(body.ok).toBe(true);
    expect(JSON.stringify(body)).not.toContain("operator@example.com");
  });

  it("degrades to 503 when the dev bypass is set without Access (exposed)", async () => {
    const kv = fakeKv();
    await okJobs(kv);
    const e = { KROGER_KV: kv, DB: fakeD1(), ADMIN_DEV_BYPASS: "1" } as unknown as Env;
    const res = await handleHealthRequest(e);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; admin: { exposed: boolean } };
    expect(body.admin.exposed).toBe(true);
    expect(body.ok).toBe(false);
  });

  it("svg renders the admin row exposed + degraded headline, still 200", async () => {
    const kv = fakeKv();
    await okJobs(kv);
    const e = { KROGER_KV: kv, DB: fakeD1(), ADMIN_DEV_BYPASS: "1" } as unknown as Env;
    const res = await handleHealthSvgRequest(e);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("admin");
    expect(body).toContain("exposed");
    expect(body).toContain("degraded");
    expect(body).toContain("#f85149"); // the exposed row is red
  });

  it("svg renders the admin row gated (healthy) when Access is configured", async () => {
    const kv = fakeKv();
    await okJobs(kv);
    const e = {
      KROGER_KV: kv,
      DB: fakeD1(),
      ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      ACCESS_AUD: "aud123",
    } as unknown as Env;
    const res = await handleHealthSvgRequest(e);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("gated");
    expect(body).toContain("healthy");
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
