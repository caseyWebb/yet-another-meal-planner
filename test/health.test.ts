import { describe, it, expect } from "vitest";
import {
  buildHealthPayload,
  handleHealthRequest,
  handleHealthSvgRequest,
  isAiQuotaError,
  notifyFailure,
  probeD1,
  readJobHealth,
  renderHealthSvg,
  writeJobHealth,
  type JobHealth,
} from "../src/health.js";
import type { Env } from "../src/env.js";

// A fake D1 that backs the `job_health` table (upsert + read-all + read-by-name) and answers
// the `SELECT 1 AS ok` probe. `reachable: false` throws on every statement — modeling D1 down,
// so the probe fails AND the health-row read must degrade gracefully (not throw). Enough fidelity
// to exercise health's D1 access without a live binding.
function fakeHealthD1(opts: { reachable?: boolean } = {}): D1Database {
  const reachable = opts.reachable ?? true;
  const rows = new Map<string, { name: string; ok: number; last_run_at: number; summary: string }>();
  const fail = () => {
    throw new Error("D1_ERROR: no such database");
  };
  const run = (sql: string, binds: unknown[]) => {
    if (!reachable) fail();
    if (/INSERT INTO job_health/i.test(sql)) {
      const [name, ok, last_run_at, summary] = binds as [string, number, number, string];
      rows.set(name, { name, ok, last_run_at, summary });
      return { meta: { changes: 1 } };
    }
    return { meta: { changes: 0 } };
  };
  const first = (sql: string, binds: unknown[]) => {
    if (!reachable) fail();
    if (/SELECT 1 AS ok/i.test(sql)) return { ok: 1 };
    if (/FROM job_health WHERE name = \?1/i.test(sql)) return rows.get(binds[0] as string) ?? null;
    return null;
  };
  const all = (sql: string) => {
    if (!reachable) fail();
    if (/FROM job_health/i.test(sql)) return { results: [...rows.values()] };
    return { results: [] };
  };
  return {
    prepare(sql: string) {
      let binds: unknown[] = [];
      const stmt = {
        bind(...v: unknown[]) {
          binds = v;
          return stmt;
        },
        async first() {
          return first(sql, binds);
        },
        async all() {
          return all(sql);
        },
        async run() {
          return run(sql, binds);
        },
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
}

/** A fresh env backed by a single reachable `job_health` D1 (write + read share it). */
function healthEnv(over: Partial<Env> = {}): Env {
  return { DB: fakeHealthD1(), ...over } as unknown as Env;
}

const rec = (ok: boolean, summary: Record<string, unknown> = {}): JobHealth => ({
  ok,
  last_run_at: 1_700_000_000_000,
  summary,
});

describe("job health records", () => {
  it("round-trips write/read through D1", async () => {
    const env = healthEnv();
    await writeJobHealth(env, "flyer-warm", rec(true, { action: "completed" }));
    expect(await readJobHealth(env, "flyer-warm")).toEqual(rec(true, { action: "completed" }));
    expect(await readJobHealth(env, "missing")).toBeNull();
  });
});

describe("buildHealthPayload", () => {
  it("marks a missing record never-run and does not let it flip overall ok", async () => {
    const env = healthEnv();
    await writeJobHealth(env, "flyer-warm", rec(true));
    const p = await buildHealthPayload(env, ["flyer-warm", "email"]);
    expect(p.ok).toBe(true);
    const email = p.jobs.find((j) => j.name === "email")!;
    expect(email).toMatchObject({ ok: null, last_run_at: null, never_run: true });
  });

  it("overall ok is false when a job is explicitly failing", async () => {
    const env = healthEnv();
    await writeJobHealth(env, "flyer-warm", rec(false, { error: "boom" }));
    await writeJobHealth(env, "email", rec(true));
    const p = await buildHealthPayload(env, ["flyer-warm", "email"]);
    expect(p.ok).toBe(false);
  });

  it("includes a D1 probe row and reports it reachable", async () => {
    const env = healthEnv();
    await writeJobHealth(env, "flyer-warm", rec(true));
    const p = await buildHealthPayload(env, ["flyer-warm"]);
    expect(p.d1).toEqual({ ok: true });
    expect(p.ok).toBe(true);
  });

  it("degrades gracefully when D1 is unreachable: still responds, jobs never-run, d1 down, no throw", async () => {
    const env = { DB: fakeHealthD1({ reachable: false }) } as unknown as Env;
    const p = await buildHealthPayload(env, ["flyer-warm", "email"]);
    expect(p.d1.ok).toBe(false);
    expect(p.d1.error).toMatch(/storage_error|D1/i);
    expect(p.ok).toBe(false);
    expect(p.jobs.every((j) => j.never_run === true)).toBe(true);
  });
});

describe("probeD1", () => {
  it("returns ok for a reachable database", async () => {
    expect(await probeD1(healthEnv())).toEqual({ ok: true });
  });

  it("maps an unreachable database to a structured ok:false (never throws)", async () => {
    const status = await probeD1({ DB: fakeHealthD1({ reachable: false }) } as unknown as Env);
    expect(status.ok).toBe(false);
    expect(typeof status.error).toBe("string");
  });
});

describe("handleHealthRequest", () => {
  it("is open (no token gate) and reports each registered job", async () => {
    const env = healthEnv();
    await writeJobHealth(env, "flyer-warm", rec(true, { action: "completed" }));
    const res = await handleHealthRequest(env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; jobs: { name: string }[] };
    expect(body.ok).toBe(true);
    expect(body.jobs.map((j) => j.name)).toEqual([
      "flyer-warm",
      "recipe-classify",
      "recipe-index",
      "recipe-embed",
      "email",
      "discovery-sweep",
    ]);
  });

  it("503s (so plain HTTP monitors trip) when a job is failing", async () => {
    const env = healthEnv();
    await writeJobHealth(env, "flyer-warm", rec(false, { error: "boom" }));
    const res = await handleHealthRequest(env);
    expect(res.status).toBe(503);
  });

  it("coarsens the D1 probe to a boolean — no raw error string in the public payload", async () => {
    const env = { DB: fakeHealthD1({ reachable: false }) } as unknown as Env;
    const res = await handleHealthRequest(env);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { d1: { ok: boolean; error?: string } };
    expect(body.d1.ok).toBe(false);
    expect(body.d1.error).toBeUndefined();
  });

  it("exposes only aggregate fields (no per-tenant data)", async () => {
    const env = healthEnv();
    await writeJobHealth(env, "email", rec(true, { accepted: true, reason: "sender_dkim", written: true }));
    const res = await handleHealthRequest(env);
    const text = await res.text();
    // The summary we stored is gate-outcome only; no address/tenant id should appear.
    expect(text).not.toMatch(/@/);
  });
});

describe("handleHealthSvgRequest", () => {
  it("200s with an SVG card listing every job + d1 when healthy (open, no token)", async () => {
    const env = healthEnv();
    for (const name of ["flyer-warm", "recipe-classify", "recipe-index", "recipe-embed", "email", "discovery-sweep"])
      await writeJobHealth(env, name, rec(true));
    const res = await handleHealthSvgRequest(env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/image\/svg\+xml/);
    expect(res.headers.get("cache-control")).toMatch(/max-age=\d+/);
    const body = await res.text();
    expect(body.startsWith("<svg")).toBe(true);
    for (const name of ["flyer-warm", "recipe-classify", "recipe-index", "recipe-embed", "email", "discovery-sweep", "d1"])
      expect(body).toContain(name);
    expect(body).toContain("healthy");
    expect(body).not.toContain("#d29922"); // no amber when nothing is never-run
  });

  it("still 200s (never 503) when degraded, showing the degraded headline", async () => {
    const env = healthEnv();
    await writeJobHealth(env, "flyer-warm", rec(false, { error: "boom" }));
    const res = await handleHealthSvgRequest(env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("degraded");
  });

  it("renders a never-run job in the distinct amber/pending style (not as broken)", async () => {
    const env = healthEnv();
    await writeJobHealth(env, "flyer-warm", rec(true)); // recipe-embed + email never run
    const res = await handleHealthSvgRequest(env);
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain("#d29922"); // amber present for the never-run rows
    expect(body).toContain("never");
    expect(body).toContain("healthy"); // a never-run job does NOT make the card read degraded
  });

  it("renders only aggregate data (no per-tenant identifiers)", async () => {
    const env = healthEnv();
    await writeJobHealth(env, "email", rec(true, { accepted: true, reason: "sender_dkim", written: true }));
    const res = await handleHealthSvgRequest(env);
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
      ai_quota_exhausted: false,
    });
    expect(svg).toContain("2h ago");
    expect(svg).toContain("just now");
    expect(svg).toContain("degraded");
  });

  it("renders an explicit Workers AI quota-exhausted row when flagged", () => {
    const svg = renderHealthSvg({
      ok: false,
      generated_at: 1_700_000_000_000,
      jobs: [{ name: "recipe-classify", ok: false, last_run_at: 1_700_000_000_000 }],
      d1: { ok: true },
      admin: { access_configured: true, email_allowlist: false, dev_bypass_set: false, exposed: false },
      ai_quota_exhausted: true,
    });
    expect(svg).toContain("ai");
    expect(svg).toContain("quota exhausted");
    expect(svg).toContain("degraded");
  });
});

describe("Workers AI quota signal", () => {
  it("flags ai_quota_exhausted from a job's 4006 error and degrades health (503)", async () => {
    const env = healthEnv();
    await writeJobHealth(
      env,
      "recipe-embed",
      rec(false, {
        error:
          "Workers AI description generation failed: 4006: you have used up your daily free allocation of 10,000 neurons",
      }),
    );
    const res = await handleHealthRequest(env);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; ai_quota_exhausted: boolean };
    expect(body.ai_quota_exhausted).toBe(true);
    expect(body.ok).toBe(false);
  });

  it("flags ai_quota_exhausted from a job's explicit quota_exhausted summary flag", async () => {
    const env = healthEnv();
    await writeJobHealth(env, "recipe-classify", rec(false, { classified: 0, quota_exhausted: true }));
    const body = (await (await handleHealthRequest(env)).json()) as { ai_quota_exhausted: boolean };
    expect(body.ai_quota_exhausted).toBe(true);
  });

  it("does not flag quota for healthy jobs", async () => {
    const env = healthEnv();
    await writeJobHealth(env, "recipe-classify", rec(true, { classified: 20, quota_exhausted: false }));
    const payload = await buildHealthPayload(env, ["recipe-classify"]);
    expect(payload.ai_quota_exhausted).toBe(false);
  });

  it("isAiQuotaError matches 4006 / neurons messages, not generic errors", () => {
    expect(isAiQuotaError("4006: you have used up your daily free allocation of 10,000 neurons")).toBe(true);
    expect(isAiQuotaError("Some neurons message")).toBe(true);
    expect(isAiQuotaError("Workers AI returned an empty description")).toBe(false);
    expect(isAiQuotaError(undefined)).toBe(false);
  });
});

describe("admin gate posture in health", () => {
  const okJobs = async (env: Env) => {
    await writeJobHealth(env, "flyer-warm", rec(true));
    await writeJobHealth(env, "recipe-embed", rec(true));
    await writeJobHealth(env, "email", rec(true));
  };

  it("reports the gate posture as booleans and never the allowlisted emails", async () => {
    const env = healthEnv({
      ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
      ACCESS_AUD: "aud123",
      ACCESS_ALLOWED_EMAILS: "operator@example.com",
    });
    await okJobs(env);
    const res = await handleHealthRequest(env);
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
    const env = healthEnv({ ADMIN_DEV_BYPASS: "1" });
    await okJobs(env);
    const res = await handleHealthRequest(env);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { ok: boolean; admin: { exposed: boolean } };
    expect(body.admin.exposed).toBe(true);
    expect(body.ok).toBe(false);
  });

  it("svg renders the admin row exposed + degraded headline, still 200", async () => {
    const env = healthEnv({ ADMIN_DEV_BYPASS: "1" });
    await okJobs(env);
    const res = await handleHealthSvgRequest(env);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("admin");
    expect(body).toContain("exposed");
    expect(body).toContain("degraded");
    expect(body).toContain("#f85149"); // the exposed row is red
  });

  it("svg renders the admin row gated (healthy) when Access is configured", async () => {
    const env = healthEnv({ ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com", ACCESS_AUD: "aud123" });
    await okJobs(env);
    const res = await handleHealthSvgRequest(env);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("gated");
    expect(body).toContain("healthy");
  });
});

describe("notifyFailure", () => {
  const env = (over: Partial<Env>): Env => ({ ...over }) as unknown as Env;

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
