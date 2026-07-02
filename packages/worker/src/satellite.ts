// The satellite PULL CHANNEL endpoints (satellite-pull-channel):
//
//   POST /satellite/tasks/claim   { capabilities, max? }                    → { tasks }
//   POST /satellite/results       { task_id, status, reason?, observations? } → { task, results? }
//
// New `/satellite/*` paths added ALONGSIDE the unchanged `POST /admin/api/ingest`. Because they
// are OUTSIDE `/admin*`, the Cloudflare Access gate (scoped to `/admin*`) never applies — the
// SAME ingest-key bearer auth + per-key rate limit is their sole gate (reused from ingest.ts).
// The channel is strictly OUTBOUND-ONLY: these are request/response endpoints the satellite
// initiates; the Worker never dials in, holds no socket, uses no Durable Object.
//
// Claiming leases work atomically (satellite-tasks-db.ts); reporting reuses the SHARED
// raw-observation intake (ingest.ts `intakeObservations`) so results dedup on arrival exactly
// like a recipe push — which is what makes a double-run safe (correctness rests on that dedup,
// not on the lease). Handlers return STRUCTURED errors, never throw.

import {
  parseClaimRequest,
  parseResultRequest,
  parseSaleScanPayload,
  SALE_SCAN_KIND,
  type BatchResponse,
  type ClaimResponse,
  type ResultResponse,
  type TaskStatus,
} from "@grocery-agent/contract";
import type { Env } from "./env.js";
import { bearer, underRateLimit, intakeObservations } from "./ingest.js";
import { lookupIngestKey, type IngestKeyRow } from "./ingest-db.js";
import { claimTasks, completeTask, failTask, getTask, type SatelliteTaskRow } from "./satellite-tasks-db.js";
import { ToolError } from "./errors.js";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Shared key auth + rate limit for a `/satellite/*` request, IDENTICAL to `/admin/api/ingest`.
 * Returns the resolved key, or a ready `Response` to short-circuit (401 bad_key / 429). Never
 * persists anything on a rejection.
 */
async function authKey(request: Request, env: Env, now: number): Promise<{ key: IngestKeyRow } | { reject: Response }> {
  if (request.method !== "POST") return { reject: json({ error: "method_not_allowed" }, 405) };
  const secret = bearer(request);
  if (!secret) return { reject: json({ error: "bad_key", message: "missing bearer ingest key" }, 401) };
  const key = await lookupIngestKey(env, secret);
  if (!key) return { reject: json({ error: "bad_key", message: "unknown or revoked ingest key" }, 401) };
  if (!(await underRateLimit(env, key.id, now))) {
    return { reject: json({ error: "rate_limited", message: "too many requests; slow down" }, 429) };
  }
  return { key };
}

/**
 * Whether a key may see a task, mirroring the claim scope: an `operator`-scope task is
 * public-derived (claimable by any active key); a `tenant`-scope task is visible ONLY to a key
 * bound to that same tenant. A results report for a task outside the key's scope is treated as
 * `not_found` so another tenant's task existence is never revealed (tenant isolation).
 */
function keyCanAccessTask(key: IngestKeyRow, task: SatelliteTaskRow): boolean {
  if (task.scope === "operator") return true;
  return key.tenant != null && key.tenant === task.tenant;
}

/** POST /satellite/tasks/claim — atomically lease a scope- & capability-filtered batch of tasks. */
export async function handleSatelliteClaim(request: Request, env: Env, now: number = Date.now()): Promise<Response> {
  try {
    // Key lookup goes through db.ts, so a D1 blip surfaces as a thrown storage_error ToolError —
    // caught here (auth is INSIDE the try) so it becomes a structured 503, never an unstructured throw.
    const auth = await authKey(request, env, now);
    if ("reject" in auth) return auth.reject;
    const { key } = auth;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad_payload", message: "body is not valid JSON" }, 400);
    }
    const parsed = parseClaimRequest(body);
    if (!parsed.ok) return json({ error: "bad_payload", message: parsed.error }, 400);

    const tasks = await claimTasks(env, {
      keyId: key.id,
      tenant: key.tenant, // NULL = operator-global (operator-scope only); else + own tenant's work
      capabilities: parsed.value.capabilities,
      max: parsed.value.max,
      now,
    });
    const response: ClaimResponse = { tasks };
    return json(response, 200);
  } catch (e) {
    // A D1 failure anywhere (the auth key lookup or the atomic claim). Structured storage_error
    // (503, retryable) rather than a throw — the handler's contract is to return structured errors.
    const message = e instanceof ToolError ? e.message : "claim storage failure";
    return json({ error: "storage_error", message }, 503);
  }
}

/** POST /satellite/results — land a claimed task's observations (shared intake) + transition its lifecycle. */
export async function handleSatelliteResults(request: Request, env: Env, now: number = Date.now()): Promise<Response> {
  try {
    // Key lookup goes through db.ts, so a D1 blip surfaces as a thrown storage_error ToolError —
    // caught here (auth is INSIDE the try) so it becomes a structured 503, never an unstructured throw.
    const auth = await authKey(request, env, now);
    if ("reject" in auth) return auth.reject;
    const { key } = auth;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad_payload", message: "body is not valid JSON" }, 400);
    }
    const parsed = parseResultRequest(body);
    if (!parsed.ok) return json({ error: "bad_payload", message: parsed.error }, 400);
    const req = parsed.value;

    const task = await getTask(env, req.task_id);
    // Unknown task_id — OR a task outside this key's scope (masked as not_found so another
    // tenant's task existence is never revealed) — is a structured not_found, nothing persisted.
    if (!task || !keyCanAccessTask(key, task)) {
      return json({ error: "not_found", message: `no task ${req.task_id}` }, 404);
    }

    if (req.status === "failed") {
      // Attempt-cap parking: below max → back to claimable; at/above → terminal failed. Idempotent
      // (a terminal/re-claimed task does not transition); nothing to re-derive on a failure.
      const resulting = await failTask(env, task.id, req.reason ?? null, now);
      const response: ResultResponse = { task: { id: task.id, status: (resulting ?? task.status) as TaskStatus } };
      return json(response, 200);
    }

    // status === "done": land any observations through the SHARED raw-observation intake (same
    // validation + arrival dedup as a recipe push — so a late/double report dedups to the same
    // landed rows), then transition the task terminal. Correctness rests on this dedup, not the lease.
    //
    // Sale intake is TASK-SCOPED: for a `sale-scan` task the rollup `(store, locationId)` is
    // AUTHORITATIVE from the CLAIMED task's payload (Worker-created by the producer, which excludes
    // Kroger) — never from the observation. A `done` therefore ALWAYS converges that store's rollup,
    // INCLUDING an empty / all-rejected scan (a genuine "no sales today" must clear stale sales),
    // which is why the sale intake runs even with zero observations. (A `failed` report never
    // converges — handled above.) Recipe tasks keep the "only when observations present" path.
    let intake: BatchResponse | undefined;
    let notice: string | undefined;
    if (task.kind === SALE_SCAN_KIND) {
      let payload: unknown = null;
      try {
        payload = JSON.parse(task.payload);
      } catch {
        payload = null;
      }
      const sp = parseSaleScanPayload(payload);
      if (sp.ok) {
        intake = await intakeObservations(env, req.observations ?? [], `satellite-pull:${task.kind}`, key.id, now, {
          saleTask: { store: sp.value.store, locationId: sp.value.locationId },
        });
        // Broken-adapter signal: items reported but ZERO survived validation → the store converged
        // to EMPTY. Surface it (an operator-visible marker + a job-style log line) rather than
        // passing a silent zeroing off as a clean success.
        const survived = intake.accepted + intake.deduped;
        if (intake.received > 0 && survived === 0) {
          notice = `reported ${intake.received} items, 0 survived validation`;
          console.warn("[satellite] " + JSON.stringify({ event: "sale_scan_zero_survivors", task_id: task.id, received: intake.received }));
        }
      } else {
        // A corrupt/legacy sale-scan payload yields no authoritative rollup key — do NOT converge
        // (never guess a store); surface it and still transition the task terminal.
        notice = `sale-scan task payload invalid, no rollup written: ${sp.error}`;
        console.warn("[satellite] " + JSON.stringify({ event: "sale_scan_bad_payload", task_id: task.id, error: sp.error }));
      }
    } else if (req.observations && req.observations.length > 0) {
      intake = await intakeObservations(env, req.observations, `satellite-pull:${task.kind}`, key.id, now);
    }
    const resulting = await completeTask(env, task.id, now); // null when already terminal (idempotent no-op)
    const response: ResultResponse = {
      task: { id: task.id, status: (resulting ?? task.status) as TaskStatus },
      ...(intake !== undefined ? { results: intake.results } : {}),
      ...(notice !== undefined ? { notice } : {}),
    };
    return json(response, 200);
  } catch (e) {
    // A D1 failure anywhere (the auth key lookup / getTask / intake / transition). Structured
    // storage_error (503, retryable) — arrival dedup + idempotent transition make the retry safe.
    const message = e instanceof ToolError ? e.message : "results storage failure";
    return json({ error: "storage_error", message }, 503);
  }
}
