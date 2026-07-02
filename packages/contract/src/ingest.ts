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
 * An observation item — a discriminated union keyed by `kind`: `recipe` (recipe-scrape) and
 * `sale` (sale-scan). A later capability adds its kind here without breaking a consumer that
 * handles only the existing kinds.
 */
export const ObservationItemSchema = z.discriminatedUnion("kind", [RecipeObservationSchema, SaleObservationSchema]);
export type ObservationItem = z.infer<typeof ObservationItemSchema>;

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
