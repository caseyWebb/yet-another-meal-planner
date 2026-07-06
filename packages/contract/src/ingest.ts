// The satellite ingest WIRE CONTRACT — the single source of truth for the
// `POST /admin/api/ingest` payload, shared by the Worker (validates inbound) and
// the satellite (constructs outbound). Because both import this module, the batch
// envelope + observation-item shapes can never drift between the two runtimes.
//
// The v2 contract is a CAPABILITY-TAGGED envelope carrying an array of OBSERVATION
// ITEMS as a discriminated union keyed by `kind`. Two capabilities are defined:
// `recipe-scrape` (`kind: "recipe"`) and `sale-scan` (`kind: "sale"`); the enum + union
// stay the clean extension point for later capabilities (order). The Worker also accepts
// the prior v1 recipe batch, normalizing it inward to the recipe-scrape capability (see
// parseSatelliteEnvelope).
//
// See openspec specs/recipe-ingestion and specs/satellite.

import { z } from "zod";

/**
 * The contract version this build targets. A satellite reports it on every push; the
 * Worker compares it to its own current version to flag skew in the admin liveness
 * view. Bump on any breaking change to the wire shapes below.
 */
export const CONTRACT_VERSION = "v2";

/**
 * The capabilities a satellite can run. `recipe-scrape` (extract functional recipe facts
 * from an authenticated source, delivered by PUSHING observations) and `sale-scan` (observe
 * in-store/loyalty sale prices at a store the Worker has no API for, delivered by CLAIMING
 * operator-scope work over the pull channel and reporting `sale` observations). The enum is
 * the closed, extensible extension point for later capabilities (e.g. order) — do not add
 * members here without their contract + code.
 */
export const CAPABILITIES = ["recipe-scrape", "sale-scan"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/**
 * Hard cap on observation items per batch. The Worker processes a batch with one D1 write
 * per item (plus a handful of dedup reads) inside a single request, so an unbounded batch
 * would blow the Worker's per-invocation subrequest budget mid-loop. The satellite chunks
 * a large backfill into batches of this size; the Worker rejects an over-cap batch with
 * `bad_payload` rather than failing partway through. Shared so the two sides never disagree.
 */
export const MAX_BATCH_ITEMS = 200;

/** Public http(s) URL guard — mirrors the Worker's egress posture (no other schemes). */
function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Format a ZodError's issues into a compact, field-scoped message. */
function fmtIssues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

/**
 * The functional facts one recipe carries — the same fields `parse_recipe` returns,
 * plus identity. Publisher prose (headnotes) and images are deliberately NOT part of
 * the contract (functional-facts-only ingestion); the consumer-facing `description` is
 * derived on-cron by the Worker and is NOT a wire field. The author-provided `summary`
 * (a short author summary) IS a functional fact and is carried optionally.
 */
const recipeFields = {
  title: z.string().trim().min(1),
  ingredients: z.array(z.string().trim().min(1)).min(1),
  instructions: z.array(z.string().trim().min(1)).min(1),
  /** Canonical recipe URL — the dedup + provenance key. */
  source: z.string().refine(isHttpUrl, { message: "source must be a public http(s) URL" }),
  summary: z.string().optional(),
  servings: z.union([z.number(), z.string(), z.null()]).optional(),
  time_total: z.number().nullable().optional(),
  time_active: z.number().nullable().optional(),
} as const;

/** One pre-parsed recipe's functional facts (no `kind` tag) — what an adapter emits. */
export const RecipeItemSchema = z.object(recipeFields);
export type RecipeItem = z.infer<typeof RecipeItemSchema>;

/** A `recipe` observation item: the functional facts tagged with its discriminant `kind`. */
export const RecipeObservationSchema = z.object({ kind: z.literal("recipe"), ...recipeFields });
export type RecipeObservation = z.infer<typeof RecipeObservationSchema>;

/**
 * The RAW price facts of one observed sale — sensor-not-judge: only independently-checkable
 * measurements, NEVER a derived saving. `store`/`locationId` are the rollup key + provenance;
 * `productId` is the merge/dedup identity within a store (named store-neutrally, mapped to
 * `FlyerItem.sku` at intake); `regular`/`promo` are the RAW shelf/loyalty prices as observed.
 * There is NO `savings`/`savings_pct`/on-sale field — the Worker re-derives "on sale" and the
 * saving from `{ regular, promo }`, the same single source of truth the Kroger flyer uses, and
 * applies the deal floor at READ. Any `savings`-like field an adapter set is DROPPED here
 * (default object strip), so it can never reach the wire. `url` (when present) is the product
 * page, retained for spot-checkability.
 */
const saleFields = {
  store: z.string().trim().min(1),
  locationId: z.string().trim().min(1),
  productId: z.string().trim().min(1),
  description: z.string().trim().min(1),
  size: z.string().optional(),
  regular: z.number().positive(),
  promo: z.number().nonnegative(),
  brand: z.string().optional(),
  categories: z.array(z.string()).optional(),
  url: z.string().refine(isHttpUrl, { message: "url must be a public http(s) URL" }).optional(),
} as const;

/** A `sale` observation item: the raw price facts tagged with its discriminant `kind`. */
export const SaleObservationSchema = z.object({ kind: z.literal("sale"), ...saleFields });
export type SaleObservation = z.infer<typeof SaleObservationSchema>;

/**
 * The RAW per-item outcome of one satellite cart-fill line (satellite-order-cart-fill) —
 * sensor-not-judge: what HAPPENED to this line in the store cart, keyed to the canonical
 * ingredient id the pull-list carried, with NO derived grocery-list state. `item_id` is the
 * authoritative key (=== `grocery_list.normalized_name`); `disposition` is the raw outcome
 * (`carted`/`substituted`/`unavailable`); `product` is the matched or substitute store product
 * (raw provenance — its price/url retained for spot-checkability), absent when `unavailable`.
 * The Worker re-derives the `in_cart` transition itself (it never trusts a state from the wire),
 * exactly as it re-derives on-sale/savings from a `sale`'s raw `{ regular, promo }`. An `order`
 * observation travels ONLY over the order-receipt endpoint (against an issued order-list), not
 * the capability-tagged push batch (so `CAPABILITIES` is untouched) and not the pull-results.
 */
const orderFields = {
  /** The canonical ingredient id the pull-list carried (the authoritative key; === grocery_list.normalized_name). */
  item_id: z.string().trim().min(1),
  /** What happened to this line in the cart. Raw outcome, not a derived state. */
  disposition: z.enum(["carted", "substituted", "unavailable"]),
  /** The store product carted or substituted in — raw provenance, absent when unavailable. */
  product: z
    .object({
      productId: z.string().trim().min(1),
      description: z.string().trim().min(1),
      size: z.string().optional(),
      price: z.number().nonnegative().optional(),
      url: z.string().refine(isHttpUrl, { message: "url must be a public http(s) URL" }).optional(),
    })
    .optional(),
  note: z.string().optional(),
} as const;

/** An `order` observation item: the raw cart-fill disposition tagged with its discriminant `kind`. */
export const OrderObservationSchema = z.object({ kind: z.literal("order"), ...orderFields });
export type OrderObservation = z.infer<typeof OrderObservationSchema>;

/**
 * An observation item — a discriminated union keyed by `kind`: `recipe` (recipe-scrape),
 * `sale` (sale-scan), and `order` (order-fill). A later capability adds its kind here without
 * breaking a consumer that handles only the existing kinds.
 */
export const ObservationItemSchema = z.discriminatedUnion("kind", [
  RecipeObservationSchema,
  SaleObservationSchema,
  OrderObservationSchema,
]);
export type ObservationItem = z.infer<typeof ObservationItemSchema>;

// --- local-reject summary (satellite-source-audit, Decision D) ----------------
//
// The satellite's local validators (`validateSaleEmit`/`validateOrderEmit`/the recipe adapter's
// contract check) drop a malformed or judgment-smuggling item BEFORE the wire — invisible to a
// Worker-side-only ledger. So the satellite attaches a compact, PRE-AGGREGATED local-reject summary
// to each delivery envelope, and the Worker records it into the ledger with `origin: local`. The
// field is ADDITIVE + OPTIONAL on all three envelopes, so it keeps `CONTRACT_VERSION: "v2"` (a
// satellite that omits it is unaffected; an older Worker ignores an unknown field).

/**
 * The two categories a local reject maps to. `contract_invalid` — the emitted item failed the shared
 * contract parse (`parseSaleObservation`/`parseOrderObservation`/`parseRecipeItem`): a missing/mistyped
 * field, an out-of-shape body — the "DOM changed / adapter rotted" signal. `judgment_smuggled` — the
 * adapter emitted a derived JUDGMENT field a sensor must never report (`JUDGMENT_KEYS`) — the
 * "adapter is trying to be a judge" (sensor-not-judge) signal.
 */
export const LOCAL_REJECT_CATEGORIES = ["contract_invalid", "judgment_smuggled"] as const;
export type LocalRejectCategory = (typeof LOCAL_REJECT_CATEGORIES)[number];

/**
 * Bound on a `local_rejects` array — logically ≤ 2 categories (`contract_invalid`/`judgment_smuggled`),
 * with modest headroom. The Worker records each entry with one awaited D1 INSERT (`recordLocalRejects`),
 * so this caps the per-envelope write fan-out an authenticated-but-buggy/hostile satellite can drive.
 */
export const MAX_LOCAL_REJECTS = 16;
/**
 * Per-entry `count` cap — a sane upper bound on items dropped under one category in ONE delivery, so a
 * runaway count can't arbitrarily inflate a source's fail-rate numerator. A home satellite's real
 * per-delivery drop count is far under this; a genuine broken-adapter flood still trips the quarantine
 * recommendation at the cap.
 */
export const MAX_LOCAL_REJECT_COUNT = 10_000;
/**
 * Max `sample` length — one short redacted example, matching (with headroom) the satellite-side 200-char
 * truncation; caps the `provenance` bloat a multi-MB body would otherwise carry (the satellite-side
 * truncation is advisory-only, so the Worker enforces the ceiling here).
 */
export const MAX_LOCAL_REJECT_SAMPLE = 256;

/**
 * ONE pre-aggregated local-reject summary entry: the `category`, the `count` of items dropped under
 * it in this delivery (bounded), and ONE redacted/truncated example `reason` `sample` (bounded; never
 * a raw body — a leak risk, since a malformed body may carry session/PII fragments). Defined ONCE here
 * so the Worker (validates inbound) and the satellite (assembles outbound) can never drift, and so the
 * Worker's parse ENFORCES the bounds rather than trusting the satellite's own truncation/aggregation.
 */
export const LocalRejectSchema = z.object({
  category: z.enum(LOCAL_REJECT_CATEGORIES),
  count: z.number().int().positive().max(MAX_LOCAL_REJECT_COUNT),
  sample: z.string().max(MAX_LOCAL_REJECT_SAMPLE).optional(),
});
export type LocalReject = z.infer<typeof LocalRejectSchema>;

/** The optional `local_rejects` array carried, ADDITIVELY, on all three delivery envelopes (bounded). */
export const LocalRejectsSchema = z.array(LocalRejectSchema).max(MAX_LOCAL_REJECTS);

/**
 * The v2 batch envelope a satellite POSTs. `capability` is the reported capability, `source`
 * is the human-readable source name (required — the provenance the admin views group by),
 * and the version fields are the machine's reported build + targeted contract version.
 */
export const SatelliteBatchSchema = z.object({
  capability: z.enum(CAPABILITIES),
  source: z.string().trim().min(1).max(200),
  satellite_version: z.string().trim().min(1).max(100),
  contract_version: z.string().trim().min(1).max(100),
  observations: z.array(ObservationItemSchema).min(1).max(MAX_BATCH_ITEMS),
  /** Additive, OPTIONAL local-reject summary (satellite-source-audit) — omitting it keeps v2. */
  local_rejects: LocalRejectsSchema.optional(),
});
export type SatelliteBatch = z.infer<typeof SatelliteBatchSchema>;

/**
 * The LENIENT v2 envelope the Worker validates against: the batch META (capability + source
 * + versions) must be valid, but `observations` is only checked to be a non-empty array —
 * each item is validated individually with `parseObservationItem` so one malformed item is
 * rejected without failing the whole batch. A `capability` the Worker does not implement
 * fails here (the enum), so the batch is rejected before any item is touched.
 */
const SatelliteEnvelopeSchema = z.object({
  capability: z.enum(CAPABILITIES),
  source: z.string().trim().min(1).max(200),
  satellite_version: z.string().trim().min(1).max(100),
  contract_version: z.string().trim().min(1).max(100),
  observations: z.array(z.unknown()).min(1).max(MAX_BATCH_ITEMS),
  local_rejects: LocalRejectsSchema.optional(),
});

/**
 * The LENIENT v1 (legacy) recipe envelope. Retained ONLY for the v1→v2 compatibility path:
 * `parseSatelliteEnvelope` normalizes a v1 batch inward to the recipe-scrape capability, so
 * a self-hosted operator's lagging satellite image is not broken by the Worker deploy.
 */
const IngestEnvelopeV1Schema = z.object({
  source: z.string().trim().min(1).max(200),
  scraper_version: z.string().trim().min(1).max(100),
  contract_version: z.string().trim().min(1).max(100),
  recipes: z.array(z.unknown()).min(1).max(MAX_BATCH_ITEMS),
});

// --- result / error taxonomy -------------------------------------------------

/** Per-item disposition the endpoint reports for each observation in a batch. */
export type ItemDisposition = "accepted" | "deduped" | "rejected";

export interface ItemResult {
  disposition: ItemDisposition;
  /** The canonical source URL this result is for (echoed for the satellite's own log). */
  source: string;
  /** Present on `rejected` — the offending field / reason. */
  reason?: string;
}

/** The endpoint's batch response summary. */
export interface BatchResponse {
  received: number;
  accepted: number;
  deduped: number;
  rejected: number;
  results: ItemResult[];
}

/**
 * The push-level outcome recorded in the admin recent-pushes log — coarser than
 * the per-item disposition: a whole batch is `accepted`, `partial` (some items
 * deduped), or rejected for a bad payload / bad key.
 */
export type PushResult = "accepted" | "partial" | "bad_payload" | "bad_key";

// --- validation helpers ------------------------------------------------------

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validate a raw request body as a strict v2 satellite batch (the satellite self-validates with this). */
export function parseSatelliteBatch(input: unknown): ParseResult<SatelliteBatch> {
  const r = SatelliteBatchSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: fmtIssues(r.error) };
}

/** Validate a single observation item (used for per-item accept/reject within a batch). */
export function parseObservationItem(input: unknown): ParseResult<ObservationItem> {
  const r = ObservationItemSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: fmtIssues(r.error) };
}

/** Validate a single recipe item's functional facts (an adapter validates its emit with this). */
export function parseRecipeItem(input: unknown): ParseResult<RecipeItem> {
  const r = RecipeItemSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: fmtIssues(r.error) };
}

/**
 * Validate a single `sale` observation (a sale-scan adapter self-validates its emit with this
 * before the satellite will report it — so a non-contract shape, or a smuggled `savings` field,
 * never reaches the wire). Returns the parsed observation with any unmodeled field stripped.
 */
export function parseSaleObservation(input: unknown): ParseResult<SaleObservation> {
  const r = SaleObservationSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: fmtIssues(r.error) };
}

/**
 * Validate a single `order` observation (an order-fill adapter self-validates its per-item emit
 * with this before the satellite posts the receipt — so a non-contract disposition, or an
 * unmodeled derived-state field, never reaches the wire). Returns the parsed observation with any
 * unmodeled field stripped.
 */
export function parseOrderObservation(input: unknown): ParseResult<OrderObservation> {
  const r = OrderObservationSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: fmtIssues(r.error) };
}

/**
 * The single, capability-tagged shape both wire versions collapse to after the envelope
 * parse forks. `observations` are still RAW (each validated one-by-one downstream with
 * `parseObservationItem`), so one bad item never sinks the batch.
 */
export interface NormalizedBatch {
  /** Which wire version produced this batch — for observability only. */
  wire: "v1" | "v2";
  capability: Capability;
  source: string;
  /** The machine's reported build (`satellite_version`, or a v1 `scraper_version`). */
  satelliteVersion: string;
  contractVersion: string;
  /** Raw observation items — validate each with `parseObservationItem`. */
  observations: unknown[];
  /** The satellite-reported local-reject summary (satellite-source-audit) — v2 only; absent on v1. */
  localRejects?: LocalReject[];
}

/** Wrap a v1 recipe (raw) as a `recipe` observation item; forces `kind: "recipe"`. */
function toRecipeObservation(raw: unknown): unknown {
  if (raw !== null && typeof raw === "object") return { ...(raw as Record<string, unknown>), kind: "recipe" };
  // A non-object v1 item is tagged so it flows to per-item validation, where it is rejected.
  return { kind: "recipe" };
}

/**
 * The LENIENT dual-shape envelope parser the Worker endpoint uses. Accepts BOTH:
 *  - v2 `{ capability, source, satellite_version, contract_version, observations[] }` → used directly.
 *  - v1 `{ source, scraper_version, contract_version, recipes[] }` → normalized to the recipe-scrape
 *    capability (`satelliteVersion := scraper_version`, `observations := recipes` tagged `kind:"recipe"`).
 * Only the envelope parse forks; everything after is a single recipe-intake path. A batch whose
 * declared v2 `capability` the Worker does not implement fails the enum here (→ `bad_payload`).
 */
export function parseSatelliteEnvelope(input: unknown): ParseResult<NormalizedBatch> {
  if (input === null || typeof input !== "object") {
    return { ok: false, error: "(root): batch envelope must be an object" };
  }
  const o = input as Record<string, unknown>;

  // v2 — detected by either discriminator being present.
  if ("capability" in o || "observations" in o) {
    const r = SatelliteEnvelopeSchema.safeParse(o);
    if (!r.success) return { ok: false, error: fmtIssues(r.error) };
    return {
      ok: true,
      value: {
        wire: "v2",
        capability: r.data.capability,
        source: r.data.source,
        satelliteVersion: r.data.satellite_version,
        contractVersion: r.data.contract_version,
        observations: r.data.observations,
        ...(r.data.local_rejects !== undefined ? { localRejects: r.data.local_rejects } : {}),
      },
    };
  }

  // v1 — legacy recipe batch, normalized inward to the recipe-scrape capability. This fork is
  // reached only when NEITHER v2 discriminator is present, so a failure here means the batch fits
  // neither shape (e.g. a v2 producer that dropped `capability` and typo'd `observations`). Report
  // that plainly rather than only the v1-shaped complaint, which would mislead a v2 producer.
  const r = IngestEnvelopeV1Schema.safeParse(o);
  if (!r.success) {
    return {
      ok: false,
      error:
        "(root): batch matches neither the v1 recipe shape (source, scraper_version, contract_version, recipes[]) nor the v2 capability-tagged shape (capability, source, satellite_version, contract_version, observations[])",
    };
  }
  return {
    ok: true,
    value: {
      wire: "v1",
      capability: "recipe-scrape",
      source: r.data.source,
      satelliteVersion: r.data.scraper_version,
      contractVersion: r.data.contract_version,
      observations: r.data.recipes.map(toRecipeObservation),
    },
  };
}
