// D1 layer for the satellite pull-channel queue (satellite-pull-channel): the
// `satellite_tasks` table's enqueue / atomic-claim / lifecycle helpers. All access goes
// through src/db.ts so a D1 failure surfaces as a structured storage_error, never a raw
// throw (D4). The queue backs the outbound-only pull channel — the satellite CLAIMS work
// (the Worker never pushes). Correctness rests on RESULT-side arrival dedup (satellite.ts +
// the recipe raw-observation intake), NOT on the lease: the lease only avoids needless
// concurrent double-work and may expire mid-work, so a task may run more than once safely.
//
// There is NO concrete task `kind` here (nor a producer): a later capability (sale-scan,
// order-fill) adds kinds + a producer. `payload` is opaque JSON the channel never interprets.

import { db } from "./db.js";
import type { Env } from "./env.js";
import { DEFAULT_CLAIM_MAX, MAX_CLAIM_TASKS, type TaskEnvelope, type TaskScope, type TaskStatus } from "@grocery-agent/contract";

/**
 * Default lease duration — how long a claimed task is held before its lease expires and the
 * row becomes re-claimable. Purely a tuning knob: correctness does NOT depend on it (a
 * double-run is made safe by result-side arrival dedup, per the design), so it trades needless
 * double-work against reclaim latency and can be changed freely.
 */
export const LEASE_DURATION_MS = 5 * 60 * 1000;

/** Random hex of `bytes` length (2 hex chars per byte) — the opaque task id suffix. */
function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A raw `satellite_tasks` row (payload still a JSON string). */
export interface SatelliteTaskRow {
  id: string;
  kind: string;
  scope: TaskScope;
  tenant: string | null;
  dedup_key: string;
  payload: string;
  status: TaskStatus;
  claimed_by: string | null;
  claimed_at: number | null;
  lease_expires_at: number | null;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * A task to enqueue. An `operator`-scope task carries NO tenant (cross-tenant, public-derived);
 * a `tenant`-scope task MUST name its owning tenant. `dedupKey` is the logical identity the
 * idempotent enqueue keys on; `payload` is serialized to opaque JSON.
 */
export interface NewTask {
  kind: string;
  scope: TaskScope;
  tenant: string | null;
  dedupKey: string;
  payload: unknown;
  /** Attempt cap before a repeatedly-failing task is parked terminal `failed` (defaults to 3). */
  maxAttempts?: number;
}

/** Parse a task row's opaque JSON payload into the capability-agnostic envelope. */
function rowToEnvelope(r: { id: string; kind: string; scope: TaskScope; tenant: string | null; payload: string }): TaskEnvelope {
  let payload: unknown = null;
  try {
    payload = JSON.parse(r.payload);
  } catch {
    payload = null; // a corrupt payload degrades to null rather than crashing the claim
  }
  return { id: r.id, kind: r.kind, scope: r.scope, payload };
}

/**
 * Enqueue a task, IDEMPOTENT per `dedupKey`: the `satellite_tasks_dedup` partial-unique index
 * admits at most one NON-TERMINAL (pending|claimed) row per logical key, so `INSERT OR IGNORE`
 * no-ops when an in-flight task for that key already stands. Once the prior task is terminal
 * (done|failed) the key is enqueuable afresh. Returns whether a new row was written + its id.
 * Producers are defined by later capabilities — this is the generic enqueue contract only.
 */
export async function enqueueTask(env: Env, task: NewTask, now: number = Date.now()): Promise<{ enqueued: boolean; id: string }> {
  const id = "st_" + randomHex(8);
  const res = await db(env).run(
    "INSERT OR IGNORE INTO satellite_tasks " +
      "(id, kind, scope, tenant, dedup_key, payload, status, attempts, max_attempts, created_at, updated_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', 0, ?7, ?8, ?9)",
    id,
    task.kind,
    task.scope,
    task.tenant,
    task.dedupKey,
    JSON.stringify(task.payload ?? null),
    task.maxAttempts ?? 3,
    now, // created_at (?8)
    now, // updated_at (?9) — bound separately; D1 rejects a reused placeholder
  );
  return { enqueued: res.changes > 0, id };
}

/** Options for a claim: the key's id + its tenant binding (NULL = operator-global), declared kinds, bound. */
export interface ClaimOptions {
  keyId: string;
  /** The claiming key's tenant binding: NULL = operator-global (operator-scope only). */
  tenant: string | null;
  /** The task kinds the satellite can run — the claim hands back only these kinds. */
  capabilities: string[];
  max?: number;
  now?: number;
  leaseMs?: number;
}

/**
 * ATOMICALLY claim a bounded batch of claimable tasks for the key, scope-filtered by the key's
 * tenant binding and the declared `capabilities`. One conditional `UPDATE … RETURNING` (D1 is
 * SQLite — single-writer, statements serialized), so two concurrent claims cannot both acquire
 * a row: the loser sees it already `claimed` (fresh lease) and skips it. A `pending` row, OR a
 * `claimed` row whose lease has EXPIRED and is still UNDER its attempt cap, is claimable; the claim
 * stamps owner + lease + bumps `attempts`. An expired lease AT/ABOVE the cap (a task claimed then
 * silently dropped up to the cap) is first parked terminal `failed`, not re-leased forever (D5).
 * Scope: an operator-global key (tenant NULL) claims `operator`-scope only; a
 * tenant-bound key claims `operator`-scope PLUS its own tenant's `tenant`-scope, never another
 * tenant's. An empty `capabilities` list matches no kind → returns `[]` without a query.
 */
export async function claimTasks(env: Env, opts: ClaimOptions): Promise<TaskEnvelope[]> {
  const caps = [...new Set(opts.capabilities.filter((c) => c && c.trim()))];
  if (caps.length === 0) return [];
  const now = opts.now ?? Date.now();
  const leaseMs = opts.leaseMs ?? LEASE_DURATION_MS;
  const max = Math.min(Math.max(1, opts.max ?? DEFAULT_CLAIM_MAX), MAX_CLAIM_TASKS);
  const leaseExpiresAt = now + leaseMs;

  // Lazy parking (D5): a claimed row whose lease has expired AT/ABOVE the attempt cap was
  // SILENTLY DROPPED on every claim (the satellite died mid-work and never reported) — enforce the
  // same cap `failTask` applies to explicit failures so it can't be re-leased forever. This is the
  // silent-drop arm of the poison-task cap; reclaim stays lazy (driven by this claim, no cron
  // sweeper), and `attempts` was bumped at claim time so the cap counts claims. The re-lease SELECT
  // below then excludes these parked rows (`AND attempts < max_attempts`).
  await db(env).run(
    "UPDATE satellite_tasks " +
      "SET status = 'failed', last_error = COALESCE(last_error, 'lease expired at attempt cap'), " +
      "updated_at = ?1, claimed_by = NULL, claimed_at = NULL, lease_expires_at = NULL " +
      "WHERE status = 'claimed' AND lease_expires_at < ?2 AND attempts >= max_attempts",
    now,
    now,
  );

  // Build positional placeholders as we accumulate binds so the dynamic capability list (and the
  // optional tenant bind) never desync from their `?N` positions.
  const binds: unknown[] = [];
  const p = (v: unknown): string => {
    binds.push(v);
    return `?${binds.length}`;
  };

  const claimedByP = p(opts.keyId);
  const claimedAtP = p(now);
  const leaseP = p(leaseExpiresAt);
  const updatedP = p(now);
  const nowP = p(now); // lease-expiry comparison for a re-claimable expired lease
  const capsP = caps.map((c) => p(c)).join(", ");
  const scopeClause =
    opts.tenant == null
      ? "scope = 'operator'"
      : `(scope = 'operator' OR (scope = 'tenant' AND tenant = ${p(opts.tenant)}))`;
  const limitP = p(max);

  const sql =
    "UPDATE satellite_tasks " +
    `SET status = 'claimed', claimed_by = ${claimedByP}, claimed_at = ${claimedAtP}, ` +
    `lease_expires_at = ${leaseP}, attempts = attempts + 1, updated_at = ${updatedP} ` +
    "WHERE id IN (" +
    "SELECT id FROM satellite_tasks " +
    `WHERE (status = 'pending' OR (status = 'claimed' AND lease_expires_at < ${nowP} AND attempts < max_attempts)) ` +
    `AND kind IN (${capsP}) ` +
    `AND ${scopeClause} ` +
    `ORDER BY created_at, id LIMIT ${limitP}` +
    ") " +
    "RETURNING id, kind, scope, tenant, payload";

  const rows = await db(env).all<{ id: string; kind: string; scope: TaskScope; tenant: string | null; payload: string }>(sql, ...binds);
  return rows.map(rowToEnvelope);
}

/**
 * Transition a task to terminal `done`, IDEMPOTENTLY: only a non-terminal (pending|claimed) row
 * moves, so reporting `done` for an already-terminal or unknown task is a safe no-op. Returns the
 * resulting status (`"done"`) on transition, or `null` when nothing changed (already terminal /
 * unknown) — the caller reports the task's current status for a late/repeat report.
 */
export async function completeTask(env: Env, taskId: string, now: number = Date.now()): Promise<TaskStatus | null> {
  const rows = await db(env).all<{ status: TaskStatus }>(
    "UPDATE satellite_tasks SET status = 'done', last_error = NULL, updated_at = ?2 " +
      "WHERE id = ?1 AND status IN ('pending', 'claimed') RETURNING status",
    taskId,
    now,
  );
  return rows.length ? rows[0].status : null;
}

/**
 * Record a failure and either return the task to claimable or PARK it terminal `failed` once the
 * attempt cap is reached — one atomic statement (`status = CASE WHEN attempts >= max_attempts …`)
 * so it cannot loop forever. `attempts` was already bumped at claim time, so the cap counts claims.
 * Idempotent: a terminal (or unknown) task does not transition. Returns the resulting status
 * (`"pending"` re-claimable / `"failed"` parked), or `null` when nothing changed.
 */
export async function failTask(env: Env, taskId: string, reason: string | null, now: number = Date.now()): Promise<TaskStatus | null> {
  const rows = await db(env).all<{ status: TaskStatus }>(
    "UPDATE satellite_tasks " +
      "SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END, " +
      "last_error = ?2, updated_at = ?3, claimed_by = NULL, claimed_at = NULL, lease_expires_at = NULL " +
      "WHERE id = ?1 AND status IN ('pending', 'claimed') RETURNING status",
    taskId,
    reason,
    now,
  );
  return rows.length ? rows[0].status : null;
}

/** Load one task row by id (the results endpoint's correlation lookup; NULL = unknown task_id). */
export async function getTask(env: Env, taskId: string): Promise<SatelliteTaskRow | null> {
  const row = await db(env).first<SatelliteTaskRow>(
    "SELECT id, kind, scope, tenant, dedup_key, payload, status, claimed_by, claimed_at, " +
      "lease_expires_at, attempts, max_attempts, last_error, created_at, updated_at " +
      "FROM satellite_tasks WHERE id = ?1",
    taskId,
  );
  return row ?? null;
}
