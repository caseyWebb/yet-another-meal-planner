// Background-job health (background-job-health capability). The cron flyer warm and
// the inbound email() handler run with no human watching, so each writes a small
// health record to KV on every run, and the token-gated `/health` endpoint aggregates
// them for an external monitor (which decides what's alarming and pushes the alert —
// the Worker only EMITS truthful state). An optional ntfy push is the one in-Worker
// exception: a failure-domain-independent backstop, off unless configured.
//
// Records, the endpoint, and the ntfy message are tenant-data-free by construction —
// counts, timestamps, and error classes only, never usernames or other identifiers.

import type { Env } from "./env.js";
import type { KvStore } from "./kroger-user.js";

const JOB_PREFIX = "health:job:";

/** The registered background jobs `/health` aggregates. */
export const HEALTH_JOBS = ["flyer-warm", "email"] as const;

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

export interface HealthPayload {
  /** False iff some job is explicitly failing; a never-run job does NOT flip this. */
  ok: boolean;
  generated_at: number;
  jobs: JobStatus[];
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
 * Aggregate the named jobs' records into one payload. A missing record is reported as
 * **never-run** (`ok: null`, `never_run: true`) — distinct from healthy and never
 * omitted. Overall `ok` is false only when a job is *explicitly* failing (`ok: false`),
 * so a fresh deploy with pending jobs doesn't read as broken; the monitor catches a
 * job that stays pending too long via `last_run_at` staleness.
 */
export async function buildHealthPayload(kv: KvStore, names: readonly string[]): Promise<HealthPayload> {
  const jobs: JobStatus[] = [];
  for (const name of names) {
    const rec = await readJobHealth(kv, name);
    if (!rec) {
      jobs.push({ name, ok: null, last_run_at: null, never_run: true });
    } else {
      jobs.push({ name, ok: rec.ok, last_run_at: rec.last_run_at, summary: rec.summary });
    }
  }
  return { ok: !jobs.some((j) => j.ok === false), generated_at: Date.now(), jobs };
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
  const payload = await buildHealthPayload(env.KROGER_KV as unknown as KvStore, HEALTH_JOBS);
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
