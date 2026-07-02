// The satellite PULL-CHANNEL wire contract — the source of truth for the
// `POST /satellite/tasks/claim` and `POST /satellite/results` payloads, shared by the
// Worker (validates inbound, constructs the returned task batch) and, in a later
// capability, the satellite (constructs the claim, reports the result). Because both
// runtimes import this module, the task-envelope + claim/result shapes can never drift.
//
// The channel is CAPABILITY-AGNOSTIC: a task is an envelope carrying an opaque `id`, a
// `kind` discriminant, its `scope`, and an opaque per-kind `payload`. The `kind` set is a
// closed, EXTENSIBLE enumeration; `sale-scan` (satellite-sale-scan) is its first concrete
// member, and `order-fill` extends it later, exactly as the observation union in ./ingest.ts
// is extended. The channel never interprets `payload`; only the capability that owns a `kind`
// does (the `sale-scan` payload shape below). Results reuse ./ingest.ts's ObservationItem union.
//
// See openspec specs/satellite-pull-channel.

import { z } from "zod";
import { MAX_BATCH_ITEMS, type ItemResult } from "./ingest.js";

/** Format a ZodError's issues into a compact, field-scoped message (mirrors ./ingest.ts). */
function fmtIssues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * A task's scope. `operator` work is public-derived and cross-tenant (store-wide, like the
 * flyer cache); `tenant` work is a single tenant's own work, isolated to that tenant.
 */
export const TASK_SCOPES = ["operator", "tenant"] as const;
export type TaskScope = (typeof TASK_SCOPES)[number];

/** A task's lifecycle status in the D1 queue. `done`/`failed` are terminal. */
export const TASK_STATUSES = ["pending", "claimed", "done", "failed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * A pulled task — a capability-tagged envelope. `kind` is the discriminant of a closed,
 * extensible enumeration that has NO concrete member today (a later capability adds one,
 * mirroring the observation union). `payload` is OPAQUE to the channel — only the capability
 * that owns a `kind` interprets it. The envelope carries no derived conclusion: it instructs
 * the satellite what to observe or prepare, never a judgment (sensor-not-judge).
 */
export interface TaskEnvelope {
  /** Opaque task id (the results correlation key). */
  id: string;
  /** The discriminant. Empty-today, extensible enum — a `string` until a kind is added. */
  kind: string;
  scope: TaskScope;
  /** Per-kind task body — opaque to the channel; interpreted only by the owning capability. */
  payload: unknown;
}

/**
 * The task envelope's structural schema. The channel validates the shape (id/kind/scope
 * present, `scope` a known value) but keeps `payload` opaque (`unknown`) — it does not
 * enforce a per-kind body because no kind is defined here. A consumer that handles only
 * today's (zero) kinds keeps validating envelopes unchanged when a kind is added later.
 */
export const TaskEnvelopeSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.string().trim().min(1),
  scope: z.enum(TASK_SCOPES),
  payload: z.unknown(),
});

/**
 * The `sale-scan` task kind — the FIRST concrete task kind (satellite-sale-scan). The channel
 * still treats `TaskEnvelope.payload` as opaque; only this capability interprets it.
 */
export const SALE_SCAN_KIND = "sale-scan";

/**
 * The `sale-scan` task payload: it instructs the satellite WHAT to observe (a `store`, a
 * `locationId`, a set of broad `terms`) and carries NO derived conclusion or judgment
 * (sensor-not-judge, inherited). `terms` are the broad flyer terms to scan (may be empty →
 * the satellite scans nothing and reports an empty sale set). The channel keeps `payload`
 * opaque; the Worker producer builds it and a `sale-scan` adapter reads it.
 */
export const SaleScanPayloadSchema = z.object({
  store: z.string().trim().min(1),
  locationId: z.string().trim().min(1),
  terms: z.array(z.string().trim().min(1)),
});
export type SaleScanPayload = z.infer<typeof SaleScanPayloadSchema>;

/** Validate a task envelope's opaque payload as a `sale-scan` payload (the satellite's adapter dispatch). */
export function parseSaleScanPayload(input: unknown): ParseResult<SaleScanPayload> {
  const r = SaleScanPayloadSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: fmtIssues(r.error) };
}

/**
 * Default / hard cap on tasks handed back in one claim. A claim leases at most `max` rows so
 * a single claim stays within one Worker invocation's budget; the satellite claims again for
 * more. Shared so the two sides never disagree on the ceiling.
 */
export const DEFAULT_CLAIM_MAX = 10;
export const MAX_CLAIM_TASKS = 50;

/**
 * The claim request a satellite POSTs. `capabilities` are the task kinds it can run (the
 * Worker hands back only those kinds); `max` bounds the batch (defaults to DEFAULT_CLAIM_MAX,
 * capped at MAX_CLAIM_TASKS). An empty `capabilities` list can match no task kind → no work.
 */
export const ClaimRequestSchema = z.object({
  capabilities: z.array(z.string().trim().min(1)).max(64),
  max: z.number().int().positive().max(MAX_CLAIM_TASKS).optional(),
});
export type ClaimRequest = z.infer<typeof ClaimRequestSchema>;

/** The claim response — the leased task batch (possibly empty; an idle claim is `{ tasks: [] }`). */
export interface ClaimResponse {
  tasks: TaskEnvelope[];
}

/**
 * The result a satellite reports for a claimed task, correlated by `task_id`. On `done` it
 * carries the observations it gathered (the ./ingest.ts discriminated union — recipe today,
 * sale/order later), which enter the SAME raw-observation intake as `/admin/api/ingest`. On
 * `failed` it carries an optional `reason`. An unknown `task_id` yields a structured `not_found`.
 */
export interface ResultRequest {
  task_id: string;
  status: "done" | "failed";
  /** Present on failure — a human-readable reason (its session expired, source unreachable, …). */
  reason?: string;
  /** Present on success — the gathered observations; each is validated individually downstream. */
  observations?: unknown[];
}

/**
 * The LENIENT results envelope the Worker validates against: the META (`task_id`, `status`,
 * `reason?`) must be valid, but `observations` is only checked to be a bounded array — each
 * item is validated one-by-one with `parseObservationItem` so one malformed observation is
 * rejected without failing the whole report (mirrors the ingest envelope's lenient parse).
 */
const ResultEnvelopeSchema = z.object({
  task_id: z.string().trim().min(1),
  status: z.enum(["done", "failed"]),
  reason: z.string().max(500).optional(),
  observations: z.array(z.unknown()).max(MAX_BATCH_ITEMS).optional(),
});

/** The results endpoint's response: the task's post-transition lifecycle + the per-observation dispositions. */
export interface ResultResponse {
  task: { id: string; status: TaskStatus };
  /** Present when observations were reported — their per-item accept/dedup/reject dispositions. */
  results?: ItemResult[];
}

// --- validation helpers ------------------------------------------------------

/** Validate a raw body as a claim request (the satellite self-validates its outbound with this). */
export function parseClaimRequest(input: unknown): ParseResult<ClaimRequest> {
  const r = ClaimRequestSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: fmtIssues(r.error) };
}

/** Validate a raw body as a results request META (observations stay raw for per-item validation). */
export function parseResultRequest(input: unknown): ParseResult<ResultRequest> {
  const r = ResultEnvelopeSchema.safeParse(input);
  if (r.success) {
    return {
      ok: true,
      value: {
        task_id: r.data.task_id,
        status: r.data.status,
        ...(r.data.reason !== undefined ? { reason: r.data.reason } : {}),
        ...(r.data.observations !== undefined ? { observations: r.data.observations } : {}),
      },
    };
  }
  return { ok: false, error: fmtIssues(r.error) };
}

/** Validate a task envelope (round-trips a Worker-constructed envelope; used in tests + a later satellite consumer). */
export function parseTaskEnvelope(input: unknown): ParseResult<TaskEnvelope> {
  const r = TaskEnvelopeSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data as TaskEnvelope };
  return { ok: false, error: fmtIssues(r.error) };
}
