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
  parseOrderReceiptRequest,
  SALE_SCAN_KIND,
  type BatchResponse,
  type ClaimResponse,
  type ResultResponse,
  type TaskStatus,
  type OrderLine,
  type OrderListResponse,
  type OrderReceiptResponse,
} from "@grocery-agent/contract";
import type { Env } from "./env.js";
import { bearer, underRateLimit, intakeObservations } from "./ingest.js";
import { lookupIngestKey, type IngestKeyRow } from "./ingest-db.js";
import { claimTasks, completeTask, failTask, getTask, type SatelliteTaskRow } from "./satellite-tasks-db.js";
import { insertOrderList, getOrderList, parseItemIds } from "./order-lists-db.js";
import { recordLocalRejects } from "./satellite-audit-db.js";
import { readPreferences } from "./profile-db.js";
import { readGroceryList, readPantryNames, readGroceryKeyIndex, advanceOrderedRows, isoDay } from "./session-db.js";
import { computeToBuy } from "./order.js";
import { deriveMenuNeeds } from "./to-buy.js";
import { ingredientContext } from "./corpus-db.js";
import { KROGER_STORE } from "./flyer-warm.js";
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

    // Idempotency guard (satellite-source-audit): a `done` results POST for an ALREADY-TERMINAL task
    // (the common retry — the Worker completed the task but the satellite missed the response and
    // retried) must NOT re-run intake. The rollup REPLACE + `completeTask` transition are idempotent,
    // but `intakeObservations` re-bumps the per-source ACCEPT-TALLY (a monotonic counter, not a REPLACE)
    // and re-appends the reported local-reject rows — inflating the reliability signal on every retry.
    // Short-circuit to the prior terminal status. (Residual: intake succeeded but `completeTask` then
    // failed, then a retry — may still double-count once; acceptable for a health metric.)
    if (task.status === "done" || task.status === "failed") {
      const response: ResultResponse = { task: { id: task.id, status: task.status as TaskStatus } };
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
          keyTenant: key.tenant,
        });
        // Broken-adapter signal: items reported but ZERO survived validation → the store converged
        // to EMPTY. Surface it (an operator-visible marker + a job-style log line) rather than
        // passing a silent zeroing off as a clean success.
        const survived = intake.accepted + intake.deduped;
        if (intake.received > 0 && survived === 0) {
          notice = `reported ${intake.received} items, 0 survived validation`;
          console.warn("[satellite] " + JSON.stringify({ event: "sale_scan_zero_survivors", task_id: task.id, received: intake.received }));
        }
        // Record any satellite-reported local rejects (satellite-source-audit) — origin: local, keyed
        // to the claimed task's AUTHORITATIVE store. On a `done` report only (a failure has none).
        if (req.local_rejects && req.local_rejects.length > 0) {
          await recordLocalRejects(env, { entries: req.local_rejects, tenant: key.tenant, keyId: key.id, kind: "sale", source: sp.value.store }, now);
        }
      } else {
        // A corrupt/legacy sale-scan payload yields no authoritative rollup key — do NOT converge
        // (never guess a store); surface it and still transition the task terminal.
        notice = `sale-scan task payload invalid, no rollup written: ${sp.error}`;
        console.warn("[satellite] " + JSON.stringify({ event: "sale_scan_bad_payload", task_id: task.id, error: sp.error }));
      }
    } else if (req.observations && req.observations.length > 0) {
      intake = await intakeObservations(env, req.observations, `satellite-pull:${task.kind}`, key.id, now, { keyTenant: key.tenant });
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

// === Order-fill (satellite-order-cart-fill) ==================================
//
// Two DIRECT request/response endpoints — NOT pull-channel tasks (ordering is human-directed and a
// store cart write is a non-idempotent side effect, so there is no claim/lease/task). Both reuse
// the SAME ingest-key bearer auth (`authKey`) and require a TENANT-BOUND key — an order-list is
// per-tenant working state, so an operator-global (unbound) key is rejected (there is no
// operator-scope order-fill). Handlers are throw-free and map a D1 failure to `503 storage_error`.

/**
 * POST /satellite/order/list — mint + serve a satellite-fulfilled tenant's to-buy pull-list.
 *
 * Served ONLY when the tenant's primary store is satellite-fulfilled (`preferences.stores.fulfillment
 * === "satellite"`): a Kroger/Worker-native primary gets a structured error directing to `place_order`,
 * and a non-Kroger primary WITHOUT the marker (a plain walk store) gets one directing to the in-store
 * walk (so a walk-only tenant can't mint an order-list by accident). The to-buy set is `computeToBuy`
 * over the current `active` grocery list ∪ the meal plan's server-derived ingredient needs
 * (`deriveMenuNeeds` — the same derivation `place_order` and the to-buy read use, so every flush
 * surface sees the same set) minus pantry on-hand, each line keyed to its canonical id; planned
 * recipes whose ingredient list is not yet derived ride the response as `underived` so the human at
 * the helper knows the list may be incomplete. The mint records the exact issued id set the receipt
 * is later validated against. A POST (not GET)
 * because it MUTATES state (it records the issued set). The list is NOT resolved against store product
 * availability — product matching is the satellite's browser job.
 */
export async function handleOrderList(request: Request, env: Env, now: number = Date.now()): Promise<Response> {
  try {
    const auth = await authKey(request, env, now);
    if ("reject" in auth) return auth.reject;
    const { key } = auth;
    // Tenant-scope only — an operator-global (unbound) key has no order-list.
    if (key.tenant == null) {
      return json({ error: "forbidden", message: "order-fill requires a tenant-bound ingest key" }, 403);
    }
    const tenant = key.tenant;

    // Fulfillment-mode gate (Decision 10): read the tenant's primary store + marker from the profile.
    const prefs = await readPreferences(env, tenant);
    const stores = prefs?.stores as Record<string, unknown> | undefined;
    const primary =
      typeof stores?.primary === "string" && stores.primary.trim() ? stores.primary.trim().toLowerCase() : KROGER_STORE;
    const fulfillment = typeof stores?.fulfillment === "string" ? stores.fulfillment : null;
    if (primary === KROGER_STORE) {
      return json({ error: "wrong_fulfillment_mode", message: "primary store is Kroger (Worker-native); use place_order to fill the cart" }, 409);
    }
    if (fulfillment !== "satellite") {
      return json({ error: "wrong_fulfillment_mode", message: "primary store is a walk store, not satellite-fulfilled; shop it as an in-store walk" }, 409);
    }
    // A satellite store's location is the operator's `preferred_location` label (the Worker has no API
    // to resolve it), which may be unset → a null location_id on the pull-list.
    const locationId = typeof stores?.preferred_location === "string" ? stores.preferred_location : null;

    // Resolve the to-buy set (active list ∪ plan-derived needs − pantry on-hand) via the same
    // food-guarded funnel `place_order` uses. No quantities / include-partials — the standing list
    // + the plan are the input; a derived line's `item_id` is the canonical id a materialized row
    // would use, so a carted disposition advances via the existing insert-on-missing keying.
    const list = await readGroceryList(env, tenant);
    const pantryNames = await readPantryNames(env, tenant);
    const ctx = await ingredientContext(env);
    const derived = await deriveMenuNeeds(env, tenant);
    const { to_buy, partials } = computeToBuy({
      list,
      menuNeeds: derived.needs,
      pantryNames,
      resolve: (n) => ctx.resolve(n),
    });
    // `item_id` is the line's stored `normalized_name` (`computeToBuy`'s food-guarded `key`), NOT a
    // re-derived `resolve(name)` — the latter diverges for a non-food row (household/other or a
    // non-grocery domain), which would both leak the row's term into the ingredient graph and cause a
    // silent non-advance at receipt time (the issued id would miss the stored key).
    const items: OrderLine[] = to_buy.map((t) => ({
      item_id: t.key,
      name: t.name,
      quantity: t.quantity,
      for_recipes: t.for_recipes,
      assumed_quantity: t.assumed_quantity,
    }));

    // Mint the issued-set record (the receipt correlation key + authoritative issued ids).
    const orderListId = await insertOrderList(
      env,
      { tenant, store: primary, locationId, itemIds: items.map((i) => i.item_id) },
      now,
    );
    const response: OrderListResponse = {
      order_list_id: orderListId,
      store: primary,
      location_id: locationId,
      items,
      partials,
      underived: derived.underived,
    };
    return json(response, 200);
  } catch (e) {
    const message = e instanceof ToolError ? e.message : "order-list storage failure";
    return json({ error: "storage_error", message }, 503);
  }
}

/**
 * POST /satellite/order/receipt — land a cart-fill receipt against its issued order-list.
 *
 * The write identity is the ISSUED order-list (loaded by id), never the observation: a foreign or
 * unknown `order_list_id` is masked as `404` (never revealing another tenant's list exists, exactly
 * as `handleSatelliteResults` masks a cross-tenant task). The per-item `order` observations run
 * through the SHARED intake with the order-list as the authoritative context — carted/substituted
 * active lines advance to `in_cart`, an `unissued` id is rejected per-item, `unavailable` stays
 * `active`, and the order-list is marked `received`. The optional `mark_placed` re-post (no new
 * observations) then advances the issued `in_cart` lines to `ordered`.
 */
export async function handleOrderReceipt(request: Request, env: Env, now: number = Date.now()): Promise<Response> {
  try {
    const auth = await authKey(request, env, now);
    if ("reject" in auth) return auth.reject;
    const { key } = auth;
    if (key.tenant == null) {
      return json({ error: "forbidden", message: "order-fill requires a tenant-bound ingest key" }, 403);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad_payload", message: "body is not valid JSON" }, 400);
    }
    const parsed = parseOrderReceiptRequest(body);
    if (!parsed.ok) return json({ error: "bad_payload", message: parsed.error }, 400);
    const req = parsed.value;

    // Load the issued order-list; mask a foreign/unknown id as 404 (tenant isolation — never reveal
    // that another tenant's order-list exists), exactly as results masks a cross-tenant task.
    const row = await getOrderList(env, req.order_list_id);
    if (!row || row.tenant !== key.tenant) {
      return json({ error: "not_found", message: `no order-list ${req.order_list_id}` }, 404);
    }

    // Idempotency guard (satellite-source-audit): a receipt for an ALREADY-received order-list (the
    // common retry — the Worker landed the receipt but the satellite missed the response and retried)
    // must NOT re-run intake, which re-bumps the per-source ACCEPT-TALLY (a monotonic counter) and
    // re-appends the reported local-reject rows — inflating the reliability signal. The `in_cart`
    // advance + `received` mark are idempotent, but the tally is not. So the intake (and its
    // local-reject recording) runs ONLY on the FIRST landing; a `mark_placed` re-post (which carries no
    // observations by design) still advances the issued `in_cart` lines below. (Residual: intake
    // succeeded but `markOrderListReceived` then failed, then a retry — may still double-count once.)
    const orderList = { id: row.id, tenant: row.tenant, store: row.store, locationId: row.location_id, itemIds: parseItemIds(row.item_ids) };
    let intake: BatchResponse | undefined;
    if (row.status !== "received") {
      // Land the observations through the SHARED intake with the order-list as authoritative context.
      intake = await intakeObservations(env, req.observations ?? [], `satellite-order:${row.id}`, key.id, now, { orderList, keyTenant: key.tenant });

      // Record any satellite-reported local rejects (satellite-source-audit) — origin: local, keyed to
      // the issued order-list's store. They do NOT bump the accept-tally (never accepted).
      if (req.local_rejects && req.local_rejects.length > 0) {
        await recordLocalRejects(env, { entries: req.local_rejects, tenant: key.tenant, keyId: key.id, kind: "order", source: row.store }, now);
      }
    }

    // Optional mark-placed: advance the issued lines that are (now) `in_cart` to `ordered`. Read a
    // FRESH index so it reflects any `in_cart` advance the intake just performed in this same call.
    if (req.mark_placed) {
      const idx = await readGroceryKeyIndex(env, row.tenant);
      const lines: { name: string }[] = [];
      for (const id of orderList.itemIds) {
        const g = idx.get(id);
        if (g && g.status === "in_cart") lines.push({ name: g.name });
      }
      if (lines.length > 0) await advanceOrderedRows(env, row.tenant, lines, isoDay(now));
    }

    const after = await getOrderList(env, row.id);
    const response: OrderReceiptResponse = {
      order_list: { id: row.id, status: after?.status ?? "received" },
      // A first landing returns its per-item dispositions; an idempotent replay of an already-received
      // list ran no intake, so it reports no new per-item results (the satellite got them the first time).
      results: intake?.results ?? [],
    };
    return json(response, 200);
  } catch (e) {
    const message = e instanceof ToolError ? e.message : "order-receipt storage failure";
    return json({ error: "storage_error", message }, 503);
  }
}
