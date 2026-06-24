// Background-job health (background-job-health capability). The cron flyer warm and
// the inbound email() handler run with no human watching, so each writes a small
// health record to KV on every run, and the token-gated `/health` endpoint aggregates
// them for an external monitor (which decides what's alarming and pushes the alert —
// the Worker only EMITS truthful state). An optional ntfy push is the one in-Worker
// exception: a failure-domain-independent backstop, off unless configured.
//
// Records, the endpoint, and the ntfy message are tenant-data-free by construction —
// counts, timestamps, and error classes only, never usernames or other identifiers.

import { db } from "./db.js";
import type { Env } from "./env.js";
import type { KvStore } from "./kroger-user.js";

const JOB_PREFIX = "health:job:";

/** The registered background jobs `/health` aggregates. */
export const HEALTH_JOBS = ["flyer-warm", "recipe-embed", "email"] as const;

/** One job's stored health record. `summary` MUST stay tenant-data-free. */
export interface JobHealth {
  ok: boolean;
  /** Epoch ms of the run that wrote this record. */
  last_run_at: number;
  summary: Record<string, unknown>;
}

/** A `/health` row: the stored record, or a never-run marker (distinct from healthy). */
export interface JobStatus {
  name: string;
  ok: boolean | null;
  last_run_at: number | null;
  never_run?: true;
  summary?: Record<string, unknown>;
}

/** The D1 reachability probe row in `/health`. `ok: false` flips overall `ok`. */
export interface D1Status {
  ok: boolean;
  /** Present only when the probe failed — the structured error message (no tenant data). */
  error?: string;
}

export interface HealthPayload {
  /**
   * False iff some job is explicitly failing OR the D1 probe failed; a never-run job
   * does NOT flip this (D1 is always probed live, so it has no never-run state).
   */
  ok: boolean;
  generated_at: number;
  jobs: JobStatus[];
  d1: D1Status;
}

/**
 * Probe D1 reachability with `SELECT 1`. A misprovisioned / under-scoped / unreachable
 * database surfaces here at `/health` rather than at the first tool call. Goes through
 * `src/db.ts`, so a failure is a structured `storage_error` (never a raw throw); the
 * probe maps it to `{ ok: false, error }` — it must not throw out of the health path.
 */
export async function probeD1(env: Env): Promise<D1Status> {
  try {
    await db(env).first<{ ok: number }>("SELECT 1 AS ok");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const jobKey = (name: string): string => `${JOB_PREFIX}${name}`;

export async function writeJobHealth(kv: KvStore, name: string, health: JobHealth): Promise<void> {
  await kv.put(jobKey(name), JSON.stringify(health));
}

export async function readJobHealth(kv: KvStore, name: string): Promise<JobHealth | null> {
  const raw = await kv.get(jobKey(name));
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as JobHealth;
  } catch {
    return null;
  }
}

/**
 * Aggregate the named jobs' records plus a live D1 probe into one payload. A missing job
 * record is reported as **never-run** (`ok: null, never_run: true`) — distinct from
 * healthy and never omitted. Overall `ok` is false when a job is *explicitly* failing
 * (`ok: false`) or the D1 probe failed; a never-run job does NOT flip it, so a fresh
 * deploy with pending jobs doesn't read as broken (the monitor catches a job that stays
 * pending too long via `last_run_at` staleness). `env` is the probe's binding source.
 */
export async function buildHealthPayload(
  env: Env,
  kv: KvStore,
  names: readonly string[],
): Promise<HealthPayload> {
  const jobs: JobStatus[] = [];
  for (const name of names) {
    const rec = await readJobHealth(kv, name);
    if (!rec) {
      jobs.push({ name, ok: null, last_run_at: null, never_run: true });
    } else {
      jobs.push({ name, ok: rec.ok, last_run_at: rec.last_run_at, summary: rec.summary });
    }
  }
  const d1 = await probeD1(env);
  return {
    ok: !jobs.some((j) => j.ok === false) && d1.ok,
    generated_at: Date.now(),
    jobs,
    d1,
  };
}

/**
 * Handle a `/health` request. Token-gated and aggregate-only: 404 when `HEALTH_TOKEN`
 * is unset (opt-in), 401 on a missing/wrong token (`?token=` or `Authorization: Bearer`),
 * else the aggregate payload as JSON — 200 when ok, 503 when a job is failing so plain
 * HTTP-status monitors trip too. Lives on the fetch path (independent of the cron).
 */
export async function handleHealthRequest(request: Request, env: Env): Promise<Response> {
  if (!env.HEALTH_TOKEN) return new Response("Not found", { status: 404 });
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const provided = new URL(request.url).searchParams.get("token") ?? bearer;
  if (provided !== env.HEALTH_TOKEN) return new Response("Unauthorized", { status: 401 });
  const payload = await buildHealthPayload(env, env.KROGER_KV as unknown as KvStore, HEALTH_JOBS);
  return new Response(JSON.stringify(payload), {
    status: payload.ok ? 200 : 503,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Optional, secret-gated failure push. POSTs a short tenant-clean alert to an ntfy
 * topic when `NTFY_URL` is set; a no-op when unset. **Never throws** — a failed alert
 * must not change the job's own outcome. `fetchImpl` is injectable for tests.
 */
export async function notifyFailure(
  env: Env,
  name: string,
  message: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!env.NTFY_URL) return;
  try {
    const headers: Record<string, string> = {
      Title: `grocery-mcp: ${name} failed`,
      Priority: "high",
    };
    if (env.NTFY_TOKEN) headers.Authorization = `Bearer ${env.NTFY_TOKEN}`;
    await fetchImpl(env.NTFY_URL, { method: "POST", headers, body: message.slice(0, 500) });
  } catch {
    // Alerting must never affect the job — swallow.
  }
}
