// POST /admin/api/ingest — the satellite ingest endpoint (recipe-ingestion).
//
// Authenticated by a bearer INGEST KEY (NOT Cloudflare Access) as an explicit,
// allowlisted carve-out from the /admin* Access gate — a headless home satellite carries
// no Access JWT. Wired in src/index.ts BEFORE the /admin dispatch so it never reaches
// the admin app's access middleware, and scoped to exactly POST /admin/api/ingest.
//
// It validates the batch envelope + each observation item against the shared
// @grocery-agent/contract wire types (accepting BOTH the v2 capability-tagged batch and a
// legacy v1 recipe batch, normalized inward to one recipe-intake path), dedups on arrival
// (corpus / rejections / settled-log / in-flight inbox, with the walled-park supersede
// exception), persists accepted candidates to ingest_candidates, and returns the
// { received, accepted, deduped, rejected, results } summary. The classify/match/import
// pipeline runs later in the background sweep — never synchronously here.

import { parseSatelliteEnvelope, parseObservationItem, type BatchResponse, type ItemResult } from "@grocery-agent/contract";
import type { Env } from "./env.js";
import {
  lookupIngestKey,
  touchIngestKey,
  insertIngestCandidate,
  ingestCandidateUrls,
  recordIngestPush,
} from "./ingest-db.js";
import { readDiscoveryRejections } from "./corpus-db.js";
import { loadSettledUrls } from "./discovery-db.js";
import { recipeSourceMap } from "./recipe-index.js";
import { extractRecipeSources, canonicalizeUrl } from "./discovery.js";
import { writeStoreRollup, KROGER_STORE } from "./flyer-warm.js";
import type { FlyerItem } from "./matching.js";
import type { KvStore } from "./kroger-user.js";
import { validateSale } from "./sale-intake.js";
import { advanceInCartRows, readGroceryKeyIndex, isoDay } from "./session-db.js";
import { markOrderListReceived } from "./order-lists-db.js";
import { appendRejection, bumpAcceptTally, getQuarantine, recordLocalRejects } from "./satellite-audit-db.js";
import { ToolError } from "./errors.js";

/** Per-key fixed-window rate limit (best-effort, KV-backed; fail-open on a KV error). */
const RL_MAX = 120;
const RL_WINDOW_S = 60;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Extract the bearer ingest key from the Authorization header (shared by the push + pull surfaces). */
export function bearer(request: Request): string | null {
  const h = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

/** Best-effort per-key fixed-window limiter over KROGER_KV. Returns true when the request is allowed.
 *  Shared by `/admin/api/ingest` (push) and `/satellite/*` (pull) so one key shares one rate bucket. */
export async function underRateLimit(env: Env, keyId: string, now: number): Promise<boolean> {
  try {
    const bucket = Math.floor(now / 1000 / RL_WINDOW_S);
    const k = `ingest:rl:${keyId}:${bucket}`;
    const cur = Number.parseInt((await env.KROGER_KV.get(k)) ?? "0", 10) || 0;
    if (cur >= RL_MAX) return false;
    await env.KROGER_KV.put(k, String(cur + 1), { expirationTtl: RL_WINDOW_S * 2 });
    return true;
  } catch {
    return true; // never let the limiter's own failure reject a valid push
  }
}

/** Join a (store, locationId) into a Map key with a NUL delimiter: a locationId that is a raw
 *  `preferred_location` label can contain spaces, so a bare-space join could collide two pairs. */
const salePairKey = (store: string, locationId: string): string => `${store}\u0000${locationId}`;

/**
 * Task/order-scoped authoritative context for the `sale` and `order` arms.
 */
export interface IntakeOptions {
  /**
   * Present ONLY when the observations were reported for a CLAIMED `sale-scan` task (via
   * satellite.ts): the task-AUTHORITATIVE `(store, locationId)` the sale rollup is keyed on —
   * Worker-created by the producer (which excludes Kroger), never taken from the untrusted
   * observation (which carries store/location for PROVENANCE only). Absent on the push path
   * (`/admin/api/ingest`), where `sale` items are therefore rejected — sale-scan is pull-channel-only.
   */
  saleTask?: { store: string; locationId: string };
  /**
   * Present ONLY when the observations were posted for an ISSUED order-list (via the order-receipt
   * endpoint): the order-AUTHORITATIVE record the receipt is validated against — the exact set of
   * canonical `itemIds` the Worker handed this tenant, plus its identity/store. The write identity
   * is this record's, never the observation's (the order-fill analog of `saleTask`). Absent on the
   * push path AND the pull-results path, where `order` items are therefore rejected — order-fill is
   * order-receipt-only.
   */
  orderList?: { id: string; tenant: string; store: string; locationId: string | null; itemIds: string[] };
  /**
   * The CARRYING ingest key's tenant binding (satellite-source-audit): NULL for an operator-global
   * key, else the bound tenant. Threaded from the call site so the rejection ledger, the accept-tally,
   * and the per-source quarantine check all key off the KEY (not the kind) — sale is operator-global,
   * order tenant-bound, but recipe MAY be either. Absent ⇒ null (an unbound/synthesized origin).
   */
  keyTenant?: string | null;
}

/**
 * The SHARED raw-observation intake, DISPATCHED BY observation `kind` (Decision 6): `recipe` →
 * the recipe-candidate path (dedup on canonical URL → insert `ingest_candidates`); `sale` → the
 * store-rollup path (re-derive + replace `flyer:{store}:{locationId}`). Both `POST /admin/api/ingest`
 * (recipe-scrape push) and the pull channel's `POST /satellite/results` (satellite.ts) run their
 * observations through THIS one function, so per-item validation and ARRIVAL DEDUP are identical
 * per arm — a re-push / late report / double-run dedups to the same landed rows (recipe: URL
 * dedup; sale: productId dedup within the store + rollup REPLACE). `origin` is the human-readable
 * provenance stored on each recipe candidate (unused by the sale arm).
 *
 * The sale arm is TASK-SCOPED: a `sale` observation is valid ONLY as a claimed `sale-scan` task's
 * result, and the rollup identity is `options.saleTask`'s `(store, locationId)` — never the
 * observation's, never the Worker-owned `kroger` namespace. Called WITHOUT `saleTask` (the push
 * path), every `sale` item is rejected (recipe items unaffected).
 *
 * The `order` arm is ORDER-SCOPED (satellite-order-cart-fill): an `order` observation is valid ONLY
 * against an ISSUED order-list (`options.orderList`), keyed by canonical `item_id`. A per-item
 * `item_id` NOT in the issued `itemIds` set is rejected; `carted`/`substituted` lines advance to
 * `in_cart` (via the SAME `advanceInCartRows` `place_order` uses, filtered to still-`active` rows so
 * a stale pull-list can't resurrect a removed line), an `unavailable` line stays `active`, and the
 * order-list is marked `received`. Called WITHOUT `orderList` (the push path OR the pull-results
 * path), every `order` item is rejected. Application is idempotent (a re-post converges). May throw
 * a `storage_error` ToolError on a D1/KV failure (the caller wraps it into a structured `503`).
 */
export async function intakeObservations(
  env: Env,
  observations: unknown[],
  origin: string,
  keyId: string,
  now: number,
  options: IntakeOptions = {},
): Promise<BatchResponse> {
  const receivedAt = new Date(now).toISOString();
  const results: ItemResult[] = [];
  let accepted = 0;
  let deduped = 0;
  let rejected = 0;

  // Validate each item up front (one bad item never sinks the batch), preserving input order.
  const parsedItems = observations.map((raw) => ({ raw, parsed: parseObservationItem(raw) }));
  const anyRecipe = parsedItems.some((p) => p.parsed.ok && p.parsed.value.kind === "recipe");

  // The recipe arm's arrival-dedup sets are loaded ONLY when the batch carries a recipe — a pure
  // `sale` batch (the sale-scan case over /satellite/results) skips these corpus/settled/inbox reads.
  let corpusUrls = new Set<string>();
  let rejections = new Set<string>();
  let settled = new Set<string>();
  let inflight = new Set<string>();
  if (anyRecipe) {
    const [sourceMap, rej, set, inf] = await Promise.all([
      recipeSourceMap(env),
      readDiscoveryRejections(env),
      loadSettledUrls(env),
      ingestCandidateUrls(env),
    ]);
    corpusUrls = extractRecipeSources(sourceMap);
    rejections = rej;
    settled = set;
    inflight = inf;
  }
  const seenThisBatch = new Set<string>();

  // --- source-audit setup (satellite-source-audit) ---------------------------------------------
  // The ledger/tally/quarantine key off the carrying KEY's tenant binding (not the kind): sale is
  // operator-global, order tenant-bound, recipe MAY be either — so `keyTenant` is threaded in.
  const keyTenant = options.keyTenant ?? null;
  // The audit source per arm: recipe → the batch source; sale/order → the store slug (from the
  // authoritative task/order-list context). Used for the ledger, the accept-tally, and the quarantine
  // gate. A parse-failed item (no resolved kind) is attributed to the batch's implied kind/source.
  const saleAuditSource = options.saleTask?.store ?? null;
  const orderAuditSource = options.orderList?.store ?? null;
  const batchKind = options.orderList ? "order" : options.saleTask ? "sale" : "recipe";
  const batchSource = orderAuditSource ?? saleAuditSource ?? origin;

  // Quarantine set (Decision E): loaded ONCE per batch (not per item), keyed {tenant, kind, source}
  // off THIS key's tenant. A quarantined source's items are rejected before acceptance and ledgered
  // `origin: worker, reason: "quarantined"`, persisting nothing downstream.
  const quarantineRows = await getQuarantine(env);
  // NUL-delimited to match qKey/salePairKey (a store-slug `source` can contain spaces, so a
  // bare-space join could collide two distinct {tenant, kind, source} keys).
  const quarantineSet = new Set(quarantineRows.map((q) => `${q.tenant ?? ""}\u0000${q.kind}\u0000${q.source}`));
  const isQuarantinedArm = (kind: string, source: string | null): boolean =>
    source != null && quarantineSet.has(`${keyTenant ?? ""}\u0000${kind}\u0000${source}`);
  const recipeQuarantined = isQuarantinedArm("recipe", origin);
  const saleQuarantined = isQuarantinedArm("sale", saleAuditSource);
  const orderQuarantined = isQuarantinedArm("order", orderAuditSource);

  // Append one ledger row for a Worker-side reject (origin: worker). Awaited so a D1 failure surfaces
  // as the caller's structured storage_error, exactly like the existing intake D1 access.
  const ledgerReject = (kind: string, source: string, reason: string, provenance: string | null): Promise<void> =>
    appendRejection(env, { tenant: keyTenant, keyId, kind, source, origin: "worker", reason, provenance }, now);

  // The per-{kind, source} accept-tally accumulator — the uniform rate denominator. Flushed once per
  // source after the loop (a dedup counts too; last_accepted_at advances only on a real accept).
  const acceptTally = new Map<string, { kind: string; source: string; accepted: number; deduped: number }>();
  const tally = (kind: string, source: string, field: "accepted" | "deduped"): void => {
    const k = `${kind}\u0000${source}`;
    const e = acceptTally.get(k) ?? { kind, source, accepted: 0, deduped: 0 };
    e[field]++;
    acceptTally.set(k, e);
  };

  // Sale intake is TASK-SCOPED (Decision 6): the rollup identity is the CLAIMED `sale-scan` task's
  // `(store, locationId)`, authoritative over anything the observation claims. Resolve it once, up
  // front. The store is normalized (trim + lowercase) BEFORE the KROGER-namespace guard so a
  // `"Kroger"` can't slip a bare `=== "kroger"` check — `flyer:kroger:*` is Worker-owned and a
  // sensor must NEVER write it (defense in depth; a legit producer task never carries store kroger).
  const saleTask = options.saleTask;
  const saleStore = saleTask ? saleTask.store.trim().toLowerCase() : null;
  const saleLocation = saleTask ? saleTask.locationId.trim() : null;
  const saleStoreForbidden = saleStore === KROGER_STORE;

  // The sale arm accumulates surviving rows for the TASK's single (store, locationId); after the
  // loop that store's rollup is REPLACED with the observed set (one sale-scan task = one store's
  // full current sale set). Seeded up front for a WRITABLE task store, so an empty / all-rejected
  // `done` still REPLACES the store to empty — a genuine "no sales today" scan converges the same
  // way a fresh one does, rather than leaving stale sales. No task store (the push path) or a
  // forbidden (kroger) store → no bucket → no write at all.
  const saleByStore = new Map<string, { store: string; locationId: string; items: Map<string, FlyerItem> }>();
  // A quarantined sale source is NOT seeded — so its all-rejected scan never REPLACEs the store's
  // rollup (a quarantine must land nothing, not zero out the existing sales).
  if (saleStore && saleLocation && !saleStoreForbidden && !saleQuarantined) {
    saleByStore.set(salePairKey(saleStore, saleLocation), { store: saleStore, locationId: saleLocation, items: new Map() });
  }

  // The order arm is ORDER-SCOPED: the AUTHORITATIVE issued set is `options.orderList.itemIds` — a
  // per-item `item_id` outside it is rejected (a receipt cannot invent an item or graft another
  // list's id). Carted/substituted ids accumulate here for a single `in_cart` advance after the
  // loop; `unavailable` collects nothing (the line stays `active` to retry). Absent an orderList
  // context (the push / pull-results paths) every `order` item is rejected.
  const orderList = options.orderList;
  const orderIssuedIds = orderList ? new Set(orderList.itemIds) : null;
  const orderSeenIds = new Set<string>();
  const orderCartedIds: string[] = [];

  for (const { raw, parsed } of parsedItems) {
    if (!parsed.ok) {
      const src = typeof (raw as { source?: unknown })?.source === "string" ? (raw as { source: string }).source : "";
      results.push({ disposition: "rejected", source: src, reason: parsed.error });
      // A parse-failed item has no resolved kind — attribute it to the batch's implied kind/source.
      await ledgerReject(batchKind, batchSource, parsed.error, src || null);
      rejected++;
      continue;
    }
    const item = parsed.value;

    // --- sale arm: re-derive + accumulate into the TASK's store rollup (Decision 6/7) ---
    if (item.kind === "sale") {
      // Provenance echoed in the ItemResult.source slot: the product url when reported, else its id.
      const provenance = item.url ?? item.productId;
      // The audit source is the TASK's store (when present); on the no-task push path it degrades to
      // the observation's claimed store so the reject is still ledgered against something legible.
      const saleSrc = saleAuditSource ?? item.store;
      // Quarantine gate (Decision E): a quarantined sale source is rejected before acceptance; the
      // bucket was never seeded, so no rollup REPLACE runs and nothing lands.
      if (saleQuarantined) {
        results.push({ disposition: "rejected", source: provenance, reason: "quarantined" });
        await ledgerReject("sale", saleSrc, "quarantined", provenance);
        rejected++;
        continue;
      }
      // Pull-channel-only: a `sale` is valid ONLY as a claimed sale-scan task's result. On the push
      // path (`/admin/api/ingest`) there is no task context, so reject it (recipe items unaffected).
      if (!saleTask || saleStore === null || saleLocation === null) {
        const reason = "sale observation requires a claimed sale-scan task (pull channel only)";
        results.push({ disposition: "rejected", source: provenance, reason });
        await ledgerReject("sale", saleSrc, reason, provenance);
        rejected++;
        continue;
      }
      // Defense in depth: never write the Worker-owned `kroger` namespace, even for a forged/buggy task.
      if (saleStoreForbidden) {
        const reason = "sale intake cannot write the kroger namespace";
        results.push({ disposition: "rejected", source: provenance, reason });
        await ledgerReject("sale", saleSrc, reason, provenance);
        rejected++;
        continue;
      }
      // The WRITE identity is the TASK's; an observation reporting a DIFFERENT store/location under
      // this task (a satellite scanning the wrong store) is rejected: it cannot redirect the write.
      if (item.store.trim().toLowerCase() !== saleStore || item.locationId.trim() !== saleLocation) {
        const reason = `observation store/location (${item.store}/${item.locationId}) does not match the claimed sale-scan task`;
        results.push({ disposition: "rejected", source: provenance, reason });
        await ledgerReject("sale", saleSrc, reason, provenance);
        rejected++;
        continue;
      }
      const v = validateSale(item);
      if (!v.ok) {
        results.push({ disposition: "rejected", source: provenance, reason: v.reason });
        await ledgerReject("sale", saleSrc, v.reason, provenance);
        rejected++;
        continue;
      }
      // The bucket is the task's, seeded above (a writable task store is guaranteed at this point).
      const bucket = saleByStore.get(salePairKey(saleStore, saleLocation))!;
      if (bucket.items.has(v.item.sku)) {
        // Arrival dedup by productId within the store — a double-reported product lands once.
        results.push({ disposition: "deduped", source: provenance });
        tally("sale", saleSrc, "deduped");
        deduped++;
        continue;
      }
      bucket.items.set(v.item.sku, v.item);
      results.push({ disposition: "accepted", source: provenance });
      tally("sale", saleSrc, "accepted");
      accepted++;
      continue;
    }

    // --- order arm: per-item cart-fill disposition, keyed to the ISSUED order-list (Decision 4) ---
    if (item.kind === "order") {
      // Provenance echoed in the ItemResult.source slot: the product url/id when reported, else the item_id.
      const provenance = item.product?.url ?? item.product?.productId ?? item.item_id;
      // The audit source is the order-list's store (when present); degrades to a legible sentinel on
      // the no-list path (an order pushed to the wrong endpoint has no authoritative store).
      const orderSrc = orderAuditSource ?? "unknown";
      // Quarantine gate (Decision E): a quarantined order source is rejected before acceptance; no
      // line advances and the order-list is not marked received (nothing lands downstream).
      if (orderQuarantined) {
        results.push({ disposition: "rejected", source: item.item_id, reason: "quarantined" });
        await ledgerReject("order", orderSrc, "quarantined", provenance);
        rejected++;
        continue;
      }
      // Order-receipt-only: an `order` is valid ONLY against an issued order-list. On the push path
      // (`/admin/api/ingest`) or the pull-results path there is no order-list context, so reject it.
      if (!orderList || !orderIssuedIds) {
        const reason = "order observation requires an issued order-list (order-receipt endpoint only)";
        results.push({ disposition: "rejected", source: item.item_id, reason });
        await ledgerReject("order", orderSrc, reason, provenance);
        rejected++;
        continue;
      }
      // Issued-set membership: an item_id the Worker did not issue for this list is rejected per-item
      // (a receipt cannot invent an item or graft in another list's id).
      if (!orderIssuedIds.has(item.item_id)) {
        const reason = "item_id is not in the issued order-list";
        results.push({ disposition: "rejected", source: item.item_id, reason });
        await ledgerReject("order", orderSrc, reason, provenance);
        rejected++;
        continue;
      }
      // Arrival dedup by item_id within the receipt — a double-reported line lands once.
      if (orderSeenIds.has(item.item_id)) {
        results.push({ disposition: "deduped", source: provenance });
        tally("order", orderSrc, "deduped");
        deduped++;
        continue;
      }
      orderSeenIds.add(item.item_id);
      // Carted/substituted advance to in_cart (a substitute still satisfies the canonical ingredient);
      // unavailable collects nothing (the line stays active to retry on the next order).
      if (item.disposition === "carted" || item.disposition === "substituted") orderCartedIds.push(item.item_id);
      results.push({ disposition: "accepted", source: provenance });
      tally("order", orderSrc, "accepted");
      accepted++;
      continue;
    }

    // --- recipe arm: dedup on canonical URL → insert ingest_candidates ---
    // Quarantine gate (Decision E): a quarantined recipe source is rejected before acceptance; no
    // candidate is inboxed.
    if (recipeQuarantined) {
      results.push({ disposition: "rejected", source: item.source, reason: "quarantined" });
      await ledgerReject("recipe", origin, "quarantined", item.source);
      rejected++;
      continue;
    }
    const url = canonicalizeUrl(item.source);
    if (!url) {
      const reason = "unresolvable source url";
      results.push({ disposition: "rejected", source: item.source, reason });
      await ledgerReject("recipe", origin, reason, item.source);
      rejected++;
      continue;
    }
    if (corpusUrls.has(url) || rejections.has(url) || settled.has(url) || inflight.has(url) || seenThisBatch.has(url)) {
      results.push({ disposition: "deduped", source: url });
      tally("recipe", origin, "deduped");
      deduped++;
      continue;
    }
    const written = await insertIngestCandidate(env, {
      url,
      title: item.title,
      content: {
        ingredients: item.ingredients,
        instructions: item.instructions,
        summary: item.summary ?? null,
        servings: item.servings ?? null,
        time_total: item.time_total ?? null,
        time_active: item.time_active ?? null,
      },
      origin,
      keyId,
      receivedAt,
    });
    seenThisBatch.add(url);
    if (written) {
      results.push({ disposition: "accepted", source: url });
      tally("recipe", origin, "accepted");
      accepted++;
    } else {
      // A concurrent insert won the UNIQUE(url) race — count as deduped, not accepted.
      results.push({ disposition: "deduped", source: url });
      tally("recipe", origin, "deduped");
      deduped++;
    }
  }

  // Publish the sale arm: REPLACE the TASK's store rollup with its freshly-observed set at `now`
  // (there is at most one bucket — the claimed task's store). An empty set REPLACES to empty, so a
  // genuine "no sales today" scan converges rather than leaving stale sales; a late/double report of
  // the same scan replaces to the same rows (idempotent). Goes through the shared KV store, so a KV
  // blip surfaces as the caller's structured storage_error like the recipe arm.
  for (const { store, locationId, items } of saleByStore.values()) {
    await writeStoreRollup(env.KROGER_KV as unknown as KvStore, store, locationId, [...items.values()], now);
  }

  // Publish the order arm (satellite-order-cart-fill): advance the carted/substituted lines to
  // `in_cart` via the SAME helper `place_order` uses, keyed by canonical id — but ONLY ids still
  // on the list as `active`, so a stale pull-list can't resurrect a removed line or regress an
  // `ordered`/`in_cart` one. Then mark the order-list `received` (idempotent — a re-post converges).
  if (orderList && !orderQuarantined) {
    if (orderCartedIds.length > 0) {
      const idx = await readGroceryKeyIndex(env, orderList.tenant);
      // Pass each active row's DISPLAY name (not the id) so `advanceInCartRows`' resolve keys it to
      // the existing row exactly — never hitting its insert-missing branch for the filtered set.
      const advanceLines: { name: string }[] = [];
      for (const id of orderCartedIds) {
        const row = idx.get(id);
        if (row && row.status === "active") advanceLines.push({ name: row.name });
      }
      if (advanceLines.length > 0) await advanceInCartRows(env, orderList.tenant, advanceLines, isoDay(now));
    }
    await markOrderListReceived(env, orderList.id, now);
  }

  // Flush the accept-tally (satellite-source-audit): one upsert per source with this batch's
  // accepted/deduped counts, so B's rate math has a uniform per-source denominator across all three
  // arms. Left untouched: `ingest_pushes` (Decision B — the recipe recency view keeps its own log).
  for (const e of acceptTally.values()) {
    if (e.accepted > 0 || e.deduped > 0) {
      await bumpAcceptTally(env, { tenant: keyTenant, kind: e.kind, source: e.source, accepted: e.accepted, deduped: e.deduped }, now);
    }
  }

  return { received: observations.length, accepted, deduped, rejected, results };
}

/**
 * Handle one POST /admin/api/ingest. `now` is injectable for tests.
 */
export async function handleIngest(request: Request, env: Env, now: number = Date.now()): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // [1] key auth — bad/absent/revoked key → 401 (bad_key). Never persists anything.
  const secret = bearer(request);
  if (!secret) return json({ error: "bad_key", message: "missing bearer ingest key" }, 401);
  const key = await lookupIngestKey(env, secret);
  if (!key) return json({ error: "bad_key", message: "unknown or revoked ingest key" }, 401);

  // [2] rate limit (best-effort).
  if (!(await underRateLimit(env, key.id, now))) {
    return json({ error: "rate_limited", message: "too many pushes; slow down" }, 429);
  }

  // [3] parse body + validate the envelope META via the lenient DUAL-SHAPE parser: accepts a v2
  // capability-tagged batch OR a legacy v1 recipe batch, normalizing both to one recipe-intake
  // path. A batch declaring a `capability` the Worker does not implement fails the parse here
  // (rejected `bad_payload`, nothing persisted), so only recipe-scrape ever reaches the loop.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad_payload", message: "body is not valid JSON" }, 400);
  }
  const env0 = parseSatelliteEnvelope(body);
  if (!env0.ok) {
    const rawSrc = typeof (body as { source?: unknown })?.source === "string" ? (body as { source: string }).source : "unknown";
    const src = rawSrc.slice(0, 200);
    await recordIngestPush(
      env,
      { keyId: key.id, source: src || "unknown", received: 0, accepted: 0, deduped: 0, rejected: 0, result: "bad_payload" },
      now,
    ).catch(() => {});
    return json({ error: "bad_payload", message: env0.error }, 400);
  }
  const batch = env0.value;

  // Record liveness (last_used + reported versions) now that the key + envelope are valid. The
  // reported `satelliteVersion` (a v1 batch's `scraper_version` maps to it) is stamped into the
  // retained `last_scraper_version` column; the reported contract version drives skew detection.
  await touchIngestKey(env, key.id, batch.satelliteVersion, batch.contractVersion, now).catch(() => {});

  // [4]+[5] arrival dedup + per-item persist via the SHARED intake (reused by the pull channel's
  // /satellite/results). Pushed candidates dedup against the SETTLED log only (not parks), so a
  // push supersedes a prior walled `unreachable`/`no_jsonld` park for the same url. The intake
  // goes through `db()`, which THROWS on a D1 failure; wrap it so a transient db blip returns a
  // structured storage_error, not a bare 500 (this endpoint is wired raw in index.ts).
  try {
  const response = await intakeObservations(env, batch.observations, batch.source, key.id, now, { keyTenant: key.tenant });
  // Record any satellite-reported local rejects (satellite-source-audit) — origin: local, one ledger
  // row per entry, keyed to this envelope's kind + source. The push batch is the recipe-scrape
  // delivery path; map the declared capability to its observation kind. Inside the try so a D1
  // failure surfaces as the structured storage_error below (they do NOT bump the accept-tally).
  if (batch.localRejects && batch.localRejects.length > 0) {
    const kind = batch.capability === "sale-scan" ? "sale" : "recipe";
    await recordLocalRejects(env, { entries: batch.localRejects, tenant: key.tenant, keyId: key.id, kind, source: batch.source }, now);
  }
  // Record the push for the admin liveness/recent-pushes view (best-effort).
  await recordIngestPush(
    env,
    {
      keyId: key.id,
      source: batch.source,
      received: response.received,
      accepted: response.accepted,
      deduped: response.deduped,
      rejected: response.rejected,
      result: response.deduped > 0 || response.rejected > 0 ? "partial" : "accepted",
    },
    now,
  ).catch(() => {});
  return json(response, 200);
  } catch (e) {
    // A D1 failure anywhere in the dedup reads or per-item inserts. Map it to a structured
    // storage_error (503, retryable) so the satellite backs off and re-pushes — arrival dedup
    // makes the re-push safe for any items that did land before the failure. The internal
    // SQL/context on a ToolError is not leaked over the wire (the satellite keys off the status).
    const message = e instanceof ToolError ? e.message : "ingest storage failure";
    return json({ error: "storage_error", message }, 503);
  }
}
