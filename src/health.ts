// Background-job health (background-job-health capability). The cron flyer warm and
// the inbound email() handler run with no human watching, so each upserts a small
// health record to the D1 `job_health` table on every run, and the open `/health`
// endpoint aggregates them for an external monitor (which decides what's alarming and
// pushes the alert — the
// Worker only EMITS truthful state; who may READ it is an edge decision, not Worker
// code). An optional ntfy push is the one in-Worker exception: a failure-domain-
// independent backstop, off unless configured.
//
// Records, the endpoint, and the ntfy message are tenant-data-free by construction —
// counts, timestamps, and error classes only, never usernames or other identifiers.

import { db } from "./db.js";
import { adminPosture, type AdminPosture } from "./admin.js";
import type { Env } from "./env.js";

/** The registered background jobs `/health` aggregates. */
export const HEALTH_JOBS = [
  "flyer-warm",
  "recipe-classify",
  "recipe-index",
  "recipe-embed",
  "email",
  "discovery-sweep",
] as const;

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
   * False iff some job is explicitly failing, the D1 probe failed, OR the admin gate is
   * `exposed`; a never-run job does NOT flip this (D1 is always probed live, so it has no
   * never-run state).
   */
  ok: boolean;
  generated_at: number;
  jobs: JobStatus[];
  d1: D1Status;
  /** Operator admin gate posture (tenant-clean booleans; `exposed` degrades overall `ok`). */
  admin: AdminPosture;
  /**
   * True when an AI-using background job reported Workers AI's daily-free-allocation
   * exhaustion (error 4006). An explicit, distinct signal — the AI cron jobs (classify,
   * describe/embed, discovery) all fall over together when neurons run out, so a generic
   * job-failure is ambiguous; this names the cause. Degrades overall `ok`. Tenant-clean
   * (a boolean derived from the jobs' own tenant-clean summaries).
   */
  ai_quota_exhausted: boolean;
}

/**
 * Detect Workers AI's daily-free-allocation exhaustion (error 4006) from a job's tenant-clean
 * error string, so `/health` can name "Workers AI quota exhausted" rather than report a generic
 * job failure. Matches the 4006 code or the "neurons" allocation message Cloudflare returns.
 */
export function isAiQuotaError(message: unknown): boolean {
  if (typeof message !== "string") return false;
  const m = message.toLowerCase();
  return m.includes("4006") || m.includes("neurons") || m.includes("daily free allocation");
}

/** True when a job's stored summary indicates Workers AI quota exhaustion (an explicit flag the
 *  job set, or a quota-shaped `error` string). */
function summaryHasAiQuota(summary: Record<string, unknown> | undefined): boolean {
  if (!summary) return false;
  return summary.quota_exhausted === true || isAiQuotaError(summary.error);
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

/** The D1 `job_health` row shape (0/1 `ok`, JSON-encoded `summary`). */
interface JobHealthRow {
  name: string;
  ok: number;
  last_run_at: number;
  summary: string;
}

/** Decode a `job_health` row into a `JobHealth` (0/1 → boolean, summary JSON → object). A
 *  malformed `summary` degrades to `{}` rather than throwing — a corrupt row must not break
 *  the whole aggregate. */
function rowToHealth(row: JobHealthRow): JobHealth {
  let summary: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.summary);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) summary = parsed as Record<string, unknown>;
  } catch {
    // leave summary as {}
  }
  return { ok: row.ok === 1, last_run_at: row.last_run_at, summary };
}

const UPSERT_JOB_HEALTH =
  "INSERT INTO job_health (name, ok, last_run_at, summary) VALUES (?1, ?2, ?3, ?4) " +
  "ON CONFLICT(name) DO UPDATE SET ok = excluded.ok, last_run_at = excluded.last_run_at, summary = excluded.summary";

/** Upsert a job's health record into D1 (one row per job, through `src/db.ts`). Tenant-clean
 *  by construction — `summary` carries only counts/timestamps/error classes. */
export async function writeJobHealth(env: Env, name: string, health: JobHealth): Promise<void> {
  await db(env).run(UPSERT_JOB_HEALTH, name, health.ok ? 1 : 0, health.last_run_at, JSON.stringify(health.summary));
}

/**
 * Emit ONE tenant-clean usage data point for a job run to the `grocery_usage` Analytics Engine
 * dataset (usage-trends) — the **history** tier that complements this job's `job_health` D1
 * **liveness** row. Carries the job name, the run outcome, the run duration, and the job's own
 * numeric summary counts (a per-job, documented, **positional** order — see `docs/SCHEMAS.md`):
 *
 *   indexes: [job]                      — the sampling key (one per job)
 *   blobs:   [job, ok ? "ok" : "fail"]  — dimensions
 *   doubles: [durationMs, ...counts]    — metrics
 *
 * **Best-effort and additive**, exactly like the optional ntfy push and the `job_health` write's
 * `.catch(() => {})`: a failed or unconfigured emission MUST NOT change the job's outcome. The
 * `USAGE_AE?.` makes an unbound deployment a silent no-op, and a throw is swallowed. **Tenant-clean
 * by construction** — only the job name, outcome, duration, and counts; never a per-tenant id. AE
 * `writeDataPoint` is non-blocking and consumes neither the KV nor the D1 budget, so this never
 * re-introduces the standing write load `job_health`-in-D1 was moved to avoid.
 */
export function recordUsagePoint(
  env: Pick<Env, "USAGE_AE">,
  job: string,
  point: { ok: boolean; durationMs: number; counts?: readonly number[] },
): void {
  try {
    env.USAGE_AE?.writeDataPoint({
      indexes: [job],
      blobs: [job, point.ok ? "ok" : "fail"],
      doubles: [point.durationMs, ...(point.counts ?? [])],
    });
  } catch {
    // Emission must never affect the job — swallow (mirrors notifyFailure / the job_health catch).
  }
}

/**
 * Emit ONE tenant-clean data point for a single MCP tool call to the `grocery_tool` Analytics
 * Engine dataset (tool-usage-trends) — the request-path **history** tier (per-tool frequency +
 * performance), sibling to `recordUsagePoint`'s per-job tier. Fired once per call from the
 * `buildServer` registration decorator (`src/tools.ts`). Carries the tool name, the call outcome,
 * and the call duration in a **positional** slot order (see `docs/SCHEMAS.md`):
 *
 *   indexes: [tool]                     — the sampling key (one per tool)
 *   blobs:   [tool, ok ? "ok":"error",  — dimensions; blob3 RESERVED for a future error code
 *             ]
 *   doubles: [durationMs]               — the call duration metric
 *
 * **Best-effort and non-blocking**, exactly like `recordUsagePoint`: an unbound `TOOL_AE` is a
 * silent no-op (`TOOL_AE?.`) and a throw is swallowed, so instrumentation never changes a tool's
 * result. **Tenant-clean by construction** — only the tool name (a fixed, low-cardinality enum),
 * the outcome, and the duration; never a per-tenant id or any call argument. AE `writeDataPoint`
 * is non-blocking and consumes neither the KV nor the D1 budget.
 */
export function recordToolPoint(
  env: Pick<Env, "TOOL_AE">,
  tool: string,
  point: { ok: boolean; durationMs: number },
): void {
  try {
    env.TOOL_AE?.writeDataPoint({
      indexes: [tool],
      blobs: [tool, point.ok ? "ok" : "error"],
      doubles: [point.durationMs],
    });
  } catch {
    // Emission must never affect the tool — swallow (mirrors recordUsagePoint).
  }
}

/** Read one job's health row, or null when it has never run. */
export async function readJobHealth(env: Env, name: string): Promise<JobHealth | null> {
  const row = await db(env).first<JobHealthRow>(
    "SELECT name, ok, last_run_at, summary FROM job_health WHERE name = ?1",
    name,
  );
  return row ? rowToHealth(row) : null;
}

/**
 * Read every `job_health` row into a name→record map. Degrades to an EMPTY map when D1 is
 * unreachable (a `storage_error` from `src/db.ts`) rather than throwing — `/health` must stay
 * answerable on the fetch path even when D1 is down; the live D1 probe carries that signal
 * (`d1.ok: false` degrades overall `ok`), and the jobs then read as never-run.
 */
async function readAllJobHealth(env: Env): Promise<Map<string, JobHealth>> {
  try {
    const rows = await db(env).all<JobHealthRow>("SELECT name, ok, last_run_at, summary FROM job_health");
    return new Map(rows.map((r) => [r.name, rowToHealth(r)]));
  } catch {
    return new Map();
  }
}

/**
 * Aggregate the named jobs' records plus a live D1 probe into one payload. A missing job
 * record is reported as **never-run** (`ok: null, never_run: true`) — distinct from
 * healthy and never omitted. Overall `ok` is false when a job is *explicitly* failing
 * (`ok: false`), the D1 probe failed, or the admin gate is `exposed`; a never-run job does
 * NOT flip it, so a fresh deploy with pending jobs doesn't read as broken (the monitor
 * catches a job that stays pending too long via `last_run_at` staleness). The admin posture
 * is derived from `env` (the same gate logic `requireAccess` uses). `env` is the probe's binding source.
 */
export async function buildHealthPayload(env: Env, names: readonly string[]): Promise<HealthPayload> {
  const records = await readAllJobHealth(env);
  const jobs: JobStatus[] = [];
  for (const name of names) {
    const rec = records.get(name);
    if (!rec) {
      jobs.push({ name, ok: null, last_run_at: null, never_run: true });
    } else {
      jobs.push({ name, ok: rec.ok, last_run_at: rec.last_run_at, summary: rec.summary });
    }
  }
  const d1 = await probeD1(env);
  const admin = adminPosture(env);
  const aiQuotaExhausted = jobs.some((j) => summaryHasAiQuota(j.summary));
  return {
    ok: !jobs.some((j) => j.ok === false) && d1.ok && !admin.exposed && !aiQuotaExhausted,
    generated_at: Date.now(),
    jobs,
    d1,
    admin,
    ai_quota_exhausted: aiQuotaExhausted,
  };
}

/**
 * Handle a `/health` request. **Open and aggregate-only** (background-job-health): the
 * payload is tenant-data-free by construction, so it carries no token gate — restricting
 * who may read it is an edge concern (Cloudflare Access / WAF), not Worker code. The D1
 * probe's raw error string is coarsened to a boolean here so no internal `storage_error`
 * message leaks. Returns the aggregate payload as JSON — 200 when ok, 503 when a job is
 * failing so plain HTTP-status monitors trip too. Lives on the fetch path (independent
 * of the cron), so a stopped job stays detectable via stale `last_run_at`.
 */
export async function handleHealthRequest(env: Env): Promise<Response> {
  const payload = await buildHealthPayload(env, HEALTH_JOBS);
  const safe = { ...payload, d1: { ok: payload.d1.ok } };
  return new Response(JSON.stringify(safe), {
    status: payload.ok ? 200 : 503,
    headers: { "content-type": "application/json" },
  });
}

/** Coarse relative-age label ("just now" / "Nm ago" / "Nh ago" / "Nd ago") — all the badge needs. */
function relAge(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Minimal XML-text escape for safe SVG string interpolation. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render the aggregate health payload as a self-contained SVG **card** for a README
 * badge. Tenant-data-free by construction — it reads only the payload's job states,
 * `last_run_at`s, and the D1 probe (no per-tenant identifier exists in the payload).
 * The card draws its own opaque panel so it reads on both light and dark GitHub themes
 * (the design's theme-neutral choice). A never-run job renders amber ("pending"), not
 * red, so a fresh deploy doesn't look broken; the headline mirrors `payload.ok`.
 * Layout uses a monospace font + fixed columns, so no font-metric width math is needed.
 */
export function renderHealthSvg(payload: HealthPayload): string {
  const C = {
    bg: "#1b1f24",
    border: "#30363d",
    text: "#e6edf3",
    muted: "#8b949e",
    ok: "#3fb950",
    fail: "#f85149",
    never: "#d29922",
  };
  const color = (state: "ok" | "fail" | "never" | "muted") =>
    state === "ok" ? C.ok : state === "fail" ? C.fail : state === "muted" ? C.muted : C.never;

  // Admin gate row: red `exposed` is the loud signal; green `gated` is the healthy operator
  // state; `dev`/`disabled` are muted (safe — the surface is 404 in a deployed context).
  const a = payload.admin;
  const adminWord = a.exposed ? "exposed" : a.access_configured ? "gated" : a.dev_bypass_set ? "dev" : "disabled";
  const adminState: "ok" | "fail" | "muted" = a.exposed ? "fail" : a.access_configured ? "ok" : "muted";

  const rows: { label: string; state: "ok" | "fail" | "never" | "muted"; word: string; age: string }[] = [
    ...payload.jobs.map((j) => {
      const state: "ok" | "fail" | "never" = j.never_run ? "never" : j.ok ? "ok" : "fail";
      return {
        label: j.name,
        state,
        word: state,
        age: j.last_run_at != null ? relAge(j.last_run_at, payload.generated_at) : "",
      };
    }),
    { label: "d1", state: payload.d1.ok ? "ok" : "fail", word: payload.d1.ok ? "ok" : "fail", age: "" },
    { label: "admin", state: adminState, word: adminWord, age: "" },
    // Workers AI quota row: the loud, explicit "neurons exhausted" signal (the AI crons all fail
    // together when it trips, so naming the cause beats a generic job-fail).
    {
      label: "ai",
      state: payload.ai_quota_exhausted ? "fail" : "ok",
      word: payload.ai_quota_exhausted ? "quota exhausted" : "ok",
      age: "",
    },
  ];

  const headWord = payload.ok ? "healthy" : "degraded";
  const headColor = payload.ok ? C.ok : C.fail;

  // Fixed layout (px). Columns are left-anchored at constant x; monospace keeps each
  // column internally aligned without measuring text.
  const width = 320;
  const padX = 14;
  const rowH = 22;
  const firstRow = 60;
  const dotX = padX + 4;
  const nameX = padX + 18;
  const wordX = 150;
  const ageX = 232;
  const lastRow = firstRow + (rows.length - 1) * rowH;
  const footerY = lastRow + 26;
  const height = footerY + 12;
  const asOf = `${new Date(payload.generated_at).toISOString().slice(11, 16)} UTC`;

  const rowSvg = rows
    .map((r, i) => {
      const y = firstRow + i * rowH;
      const c = color(r.state);
      const age = r.age
        ? `<text x="${ageX}" y="${y}" fill="${C.muted}" font-size="12">${esc(r.age)}</text>`
        : "";
      return (
        `<circle cx="${dotX}" cy="${y - 4}" r="4" fill="${c}"/>` +
        `<text x="${nameX}" y="${y}" fill="${C.text}">${esc(r.label)}</text>` +
        `<text x="${wordX}" y="${y}" fill="${c}">${esc(r.word)}</text>` +
        age
      );
    })
    .join("");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
    `viewBox="0 0 ${width} ${height}" role="img" aria-label="grocery-mcp health: ${esc(headWord)}">` +
    `<style>text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px}</style>` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="6" fill="${C.bg}" stroke="${C.border}"/>` +
    `<text x="${padX}" y="26" fill="${C.text}" font-weight="bold">grocery-mcp</text>` +
    `<text x="${width - padX}" y="26" fill="${headColor}" font-weight="bold" text-anchor="end">● ${esc(headWord)}</text>` +
    `<line x1="${padX}" y1="38" x2="${width - padX}" y2="38" stroke="${C.border}"/>` +
    rowSvg +
    `<text x="${padX}" y="${footerY}" fill="${C.muted}" font-size="11">as of ${esc(asOf)}</text>` +
    `</svg>`
  );
}

/**
 * Handle a `/health.svg` request — the README-badge variant of `/health`. **Open**, like
 * `/health` (the card is tenant-clean — only job states + the d1 boolean), and ALWAYS
 * responds 200 with an SVG card (degraded state is shown by color, not HTTP status)
 * because image proxies (e.g. GitHub Camo) may not render a non-200 response as an image
 * — and a public README badge must be anonymously fetchable. A short `Cache-Control` lets
 * an embedding README refresh the badge on a TTL rather than live. Aggregate-only.
 */
export async function handleHealthSvgRequest(env: Env): Promise<Response> {
  const payload = await buildHealthPayload(env, HEALTH_JOBS);
  return new Response(renderHealthSvg(payload), {
    status: 200,
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "max-age=120, s-maxage=120",
    },
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
