import { describe, it, expect } from "vitest";
import {
  buildHealthPayload,
  currentStreakStart,
  handleHealthRequest,
  handleHealthSvgRequest,
  isAiQuotaError,
  notifyFailure,
  probeD1,
  readAllJobRuns,
  readJobHealth,
  readJobRunById,
  readJobRuns,
  recordUsagePoint,
  renderHealthSvg,
  writeJobHealth,
  writeJobRun,
  JOB_RUNS_PER_JOB_CAP,
  type JobHealth,
  type JobRun,
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

describe("recordUsagePoint (usage-trends emission)", () => {
  it("emits one tenant-clean data point: indexes=[job], blobs=[job, outcome], doubles=[duration, ...counts]", () => {
    const points: unknown[] = [];
    const env = { USAGE_AE: { writeDataPoint: (p: unknown) => points.push(p) } } as unknown as Env;
    recordUsagePoint(env, "recipe-classify", { ok: true, durationMs: 120, counts: [5, 2, 0, 1, 3] });
    expect(points).toEqual([
      { indexes: ["recipe-classify"], blobs: ["recipe-classify", "ok"], doubles: [120, 5, 2, 0, 1, 3] },
    ]);
  });

  it("encodes a failed run's outcome as the `fail` blob and omits counts", () => {
    const points: { blobs?: unknown[]; doubles?: unknown[] }[] = [];
    const env = { USAGE_AE: { writeDataPoint: (p: never) => points.push(p) } } as unknown as Env;
    recordUsagePoint(env, "flyer-warm", { ok: false, durationMs: 9 });
    expect(points[0].blobs).toEqual(["flyer-warm", "fail"]);
    expect(points[0].doubles).toEqual([9]); // duration only — no counts on the fail path
  });

  it("is a silent no-op when the AE binding is unbound (an un-bound deployment)", () => {
    // No USAGE_AE on env — emission must neither throw nor do anything.
    expect(() => recordUsagePoint({} as unknown as Env, "email", { ok: true, durationMs: 1 })).not.toThrow();
  });

  it("swallows a throwing writeDataPoint (emission must never affect the job)", () => {
    const env = {
      USAGE_AE: {
        writeDataPoint: () => {
          throw new Error("AE unavailable");
        },
      },
    } as unknown as Env;
    expect(() => recordUsagePoint(env, "email", { ok: true, durationMs: 1, counts: [1, 0] })).not.toThrow();
  });
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

// ── job_runs (per-run history) ───────────────────────────────────────────────────────────────

/** A fake D1 backing `job_runs`: INSERT, SELECT (filtered by job, ORDER BY ran_at DESC, LIMIT),
 *  and DELETE-by-id (the writer's prune), plus `batch` for the prune's bulk delete. `reachable:
 *  false` throws on every statement, modeling D1 down (the writer must no-op, the reader must
 *  degrade to []). Enough fidelity to exercise writeJobRun/readJobRuns without a live binding. */
function fakeJobRunsD1(opts: { reachable?: boolean } = {}): D1Database {
  const reachable = opts.reachable ?? true;
  let rows: { id: string; job: string; ok: number; ran_at: number; duration_ms: number; summary: string }[] = [];
  const fail = () => {
    throw new Error("D1_ERROR: no such database");
  };
  const run = (sql: string, binds: unknown[]) => {
    if (!reachable) fail();
    if (/INSERT INTO job_runs/i.test(sql)) {
      const [id, job, ok, ran_at, duration_ms, summary] = binds as [string, string, number, number, number, string];
      rows.push({ id, job, ok, ran_at, duration_ms, summary });
      return { meta: { changes: 1 } };
    }
    if (/DELETE FROM job_runs WHERE id = \?1/i.test(sql)) {
      const before = rows.length;
      rows = rows.filter((r) => r.id !== binds[0]);
      return { meta: { changes: before - rows.length } };
    }
    return { meta: { changes: 0 } };
  };
  const all = (sql: string, binds: unknown[]) => {
    if (!reachable) fail();
    if (/SELECT id FROM job_runs WHERE job = \?1 ORDER BY ran_at DESC LIMIT \?2/i.test(sql)) {
      const job = binds[0] as string;
      const limit = binds[1] as number;
      const matched = rows.filter((r) => r.job === job).sort((a, b) => b.ran_at - a.ran_at);
      return { results: matched.slice(0, limit).map((r) => ({ id: r.id })) };
    }
    if (/SELECT id FROM job_runs WHERE job = \?1$/i.test(sql)) {
      const job = binds[0] as string;
      return { results: rows.filter((r) => r.job === job).map((r) => ({ id: r.id })) };
    }
    if (/SELECT id, ok, ran_at, duration_ms, summary FROM job_runs WHERE job = \?1 ORDER BY ran_at DESC LIMIT \?2/i.test(sql)) {
      const job = binds[0] as string;
      const limit = binds[1] as number;
      const matched = rows.filter((r) => r.job === job).sort((a, b) => b.ran_at - a.ran_at);
      return { results: matched.slice(0, limit) };
    }
    if (/SELECT id, job, ok, ran_at, duration_ms, summary FROM job_runs ORDER BY ran_at DESC LIMIT \?1/i.test(sql)) {
      const limit = binds[0] as number;
      const ordered = [...rows].sort((a, b) => b.ran_at - a.ran_at);
      return { results: ordered.slice(0, limit) };
    }
    if (/SELECT id, job, ok, ran_at, duration_ms, summary FROM job_runs WHERE id = \?1/i.test(sql)) {
      const id = binds[0] as string;
      const found = rows.filter((r) => r.id === id);
      return { results: found };
    }
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
          return all(sql, binds).results[0] ?? null;
        },
        async all() {
          return all(sql, binds);
        },
        async run() {
          return run(sql, binds);
        },
        __exec: () => run(sql, binds),
      };
      return stmt as unknown as D1PreparedStatement;
    },
    async batch(stmts: unknown[]) {
      for (const s of stmts) (s as { __exec: () => void }).__exec();
      return [];
    },
  } as unknown as D1Database;
}

function jobRunsEnv(over: Partial<Env> = {}): Env {
  return { DB: fakeJobRunsD1(), ...over } as unknown as Env;
}

const runInput = (ok: boolean, ran_at: number, summary: Record<string, unknown> = {}) => ({
  ok,
  ran_at,
  duration_ms: 42,
  summary,
});

describe("writeJobRun / readJobRuns (per-run history)", () => {
  it("appends a run and reads it back newest-first", async () => {
    const env = jobRunsEnv();
    await writeJobRun(env, "flyer-warm", runInput(true, 1000, { errors: 0 }));
    await writeJobRun(env, "flyer-warm", runInput(false, 2000, { error: "boom" }));
    await writeJobRun(env, "flyer-warm", runInput(true, 3000));
    const runs = await readJobRuns(env, "flyer-warm", 10);
    expect(runs.map((r) => r.ran_at)).toEqual([3000, 2000, 1000]);
    expect(runs[1]).toMatchObject({ ok: false, ran_at: 2000, duration_ms: 42, summary: { error: "boom" } });
    expect(runs.every((r) => typeof r.id === "string" && r.id.length > 0)).toBe(true);
  });

  it("scopes reads to the named job (another job's runs don't leak in)", async () => {
    const env = jobRunsEnv();
    await writeJobRun(env, "flyer-warm", runInput(true, 1000));
    await writeJobRun(env, "email", runInput(true, 2000));
    expect(await readJobRuns(env, "flyer-warm", 10)).toHaveLength(1);
    expect(await readJobRuns(env, "email", 10)).toHaveLength(1);
  });

  it("respects the limit on read", async () => {
    const env = jobRunsEnv();
    for (let i = 0; i < 5; i++) await writeJobRun(env, "flyer-warm", runInput(true, i * 1000));
    expect(await readJobRuns(env, "flyer-warm", 2)).toHaveLength(2);
  });

  it("prunes a job's rows beyond the per-job retention cap", async () => {
    const env = jobRunsEnv();
    const total = JOB_RUNS_PER_JOB_CAP + 10;
    for (let i = 0; i < total; i++) await writeJobRun(env, "flyer-warm", runInput(true, i * 1000));
    const all = await readJobRuns(env, "flyer-warm", total + 50);
    expect(all.length).toBe(JOB_RUNS_PER_JOB_CAP);
    // The retained rows are the most recent ones (highest ran_at survives the prune).
    expect(all[0].ran_at).toBe((total - 1) * 1000);
    expect(Math.min(...all.map((r) => r.ran_at))).toBe((total - JOB_RUNS_PER_JOB_CAP) * 1000);
  });

  it("a write failure degrades to a no-op (never throws)", async () => {
    const env = { DB: fakeJobRunsD1({ reachable: false }) } as unknown as Env;
    await expect(writeJobRun(env, "flyer-warm", runInput(true, 1000))).resolves.toBeUndefined();
  });

  it("a read failure degrades to an empty array (never throws)", async () => {
    const env = { DB: fakeJobRunsD1({ reachable: false }) } as unknown as Env;
    expect(await readJobRuns(env, "flyer-warm", 10)).toEqual([]);
  });
});

describe("readAllJobRuns (the Logs area's cross-job reader)", () => {
  it("merges runs across every job, newest-first, regardless of which job produced each one", async () => {
    const env = jobRunsEnv();
    await writeJobRun(env, "flyer-warm", runInput(true, 1000));
    await writeJobRun(env, "email", runInput(true, 3000));
    await writeJobRun(env, "flyer-warm", runInput(false, 2000, { error: "boom" }));
    const runs = await readAllJobRuns(env, 10);
    expect(runs.map((r) => r.ran_at)).toEqual([3000, 2000, 1000]);
    expect(runs.map((r) => r.job)).toEqual(["email", "flyer-warm", "flyer-warm"]);
    expect(runs[1]).toMatchObject({ job: "flyer-warm", ok: false, summary: { error: "boom" } });
  });

  it("respects the limit bound across the merged set", async () => {
    const env = jobRunsEnv();
    await writeJobRun(env, "flyer-warm", runInput(true, 1000));
    await writeJobRun(env, "email", runInput(true, 2000));
    await writeJobRun(env, "recipe-index", runInput(true, 3000));
    const runs = await readAllJobRuns(env, 2);
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.ran_at)).toEqual([3000, 2000]);
  });

  it("degrades to an empty array on a storage error (never throws)", async () => {
    const env = { DB: fakeJobRunsD1({ reachable: false }) } as unknown as Env;
    expect(await readAllJobRuns(env, 10)).toEqual([]);
  });
});

describe("readJobRunById (the Status sparkline → Logs deep-link lookup)", () => {
  it("finds a run by id, carrying its job", async () => {
    const env = jobRunsEnv();
    await writeJobRun(env, "flyer-warm", runInput(true, 1000));
    const [run] = await readJobRuns(env, "flyer-warm", 10);
    const found = await readJobRunById(env, run.id);
    expect(found).toMatchObject({ id: run.id, job: "flyer-warm", ok: true, ran_at: 1000 });
  });

  it("returns null for an unknown id", async () => {
    const env = jobRunsEnv();
    await writeJobRun(env, "flyer-warm", runInput(true, 1000));
    expect(await readJobRunById(env, "nonexistent-id")).toBeNull();
  });

  it("degrades to null on a storage error (never throws)", async () => {
    const env = { DB: fakeJobRunsD1({ reachable: false }) } as unknown as Env;
    expect(await readJobRunById(env, "any-id")).toBeNull();
  });
});

describe("currentStreakStart (healthy/unhealthy-since)", () => {
  const r = (ok: boolean, ran_at: number): JobRun => ({ id: `r${ran_at}`, ok, ran_at, duration_ms: 1, summary: {} });

  it("returns null for an empty history (no sparkline / since-label)", () => {
    expect(currentStreakStart([])).toBeNull();
  });

  it("returns the single run's ran_at when there's only one run", () => {
    expect(currentStreakStart([r(true, 5000)])).toBe(5000);
  });

  it("finds the earliest ran_at in the unbroken current-ok streak", () => {
    // newest-first input: ok, ok, ok, fail, ok — the current streak is the first three ok runs.
    const runs = [r(true, 4000), r(true, 3000), r(true, 2000), r(false, 1000), r(true, 0)];
    expect(currentStreakStart(runs)).toBe(2000);
  });

  it("finds the earliest ran_at in the unbroken current-fail streak", () => {
    const runs = [r(false, 4000), r(false, 3000), r(true, 2000)];
    expect(currentStreakStart(runs)).toBe(3000);
  });

  it("returns the newest run's ran_at when the whole history shares its ok value", () => {
    const runs = [r(true, 3000), r(true, 2000), r(true, 1000)];
    expect(currentStreakStart(runs)).toBe(1000);
  });
});
