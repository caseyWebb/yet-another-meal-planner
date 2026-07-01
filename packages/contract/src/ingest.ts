// The walled-source ingest WIRE CONTRACT — the single source of truth for the
// `POST /admin/api/ingest` payload, shared by the Worker (validates inbound) and
// the scraper (constructs outbound). Because both import this module, the batch
// envelope + recipe-item shape can never drift between the two runtimes.
//
// See openspec specs/recipe-ingestion and specs/walled-source-scraper.

import { z } from "zod";

/**
 * The recipe-contract version this build targets. A scraper reports it on every
 * push; the Worker compares it to its own current version to flag skew in the
 * admin liveness view. Bump on any breaking change to the wire shapes below.
 */
export const CONTRACT_VERSION = "v1";

/**
 * Hard cap on recipes per batch. The Worker processes a batch with one D1 write per
 * item (plus a handful of dedup reads) inside a single request, so an unbounded batch
 * would blow the Worker's per-invocation subrequest budget mid-loop. The scraper chunks
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

/**
 * One pre-parsed recipe as a scraper extracts it — the same functional facts
 * `parse_recipe` returns, plus identity. Publisher prose (headnotes) and images
 * are deliberately NOT part of the contract (functional-facts-only ingestion).
 */
export const RecipeItemSchema = z.object({
  title: z.string().trim().min(1),
  ingredients: z.array(z.string().trim().min(1)).min(1),
  instructions: z.array(z.string().trim().min(1)).min(1),
  /** Canonical recipe URL — the dedup + provenance key. */
  source: z.string().refine(isHttpUrl, { message: "source must be a public http(s) URL" }),
  summary: z.string().optional(),
  servings: z.union([z.number(), z.string(), z.null()]).optional(),
  time_total: z.number().nullable().optional(),
  time_active: z.number().nullable().optional(),
});
export type RecipeItem = z.infer<typeof RecipeItemSchema>;

/**
 * The batch envelope a scraper POSTs. `source` is the human-readable paid-source
 * name (required — it is the provenance the admin views group by); the version
 * fields are the machine's reported build + targeted contract version.
 */
export const IngestBatchSchema = z.object({
  source: z.string().trim().min(1).max(200),
  scraper_version: z.string().trim().min(1).max(100),
  contract_version: z.string().trim().min(1).max(100),
  recipes: z.array(RecipeItemSchema).min(1).max(MAX_BATCH_ITEMS),
});
export type IngestBatch = z.infer<typeof IngestBatchSchema>;

/**
 * The LENIENT envelope schema the Worker endpoint validates against: the batch META
 * (source + versions) must be valid, but `recipes` is only checked to be a non-empty
 * array — each item is validated individually with `parseRecipeItem` so one malformed
 * item is rejected without failing the whole batch. (The scraper uses the strict
 * `IngestBatchSchema` above to self-validate before sending.)
 */
export const IngestEnvelopeSchema = z.object({
  source: z.string().trim().min(1).max(200),
  scraper_version: z.string().trim().min(1).max(100),
  contract_version: z.string().trim().min(1).max(100),
  recipes: z.array(z.unknown()).min(1).max(MAX_BATCH_ITEMS),
});
export type IngestEnvelope = z.infer<typeof IngestEnvelopeSchema>;

// --- result / error taxonomy -------------------------------------------------

/** Per-item disposition the endpoint reports for each recipe in a batch. */
export type ItemDisposition = "accepted" | "deduped" | "rejected";

export interface ItemResult {
  disposition: ItemDisposition;
  /** The canonical source URL this result is for (echoed for the scraper's own log). */
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

/** Validate a raw request body as an ingest batch envelope. */
export function parseIngestBatch(input: unknown): ParseResult<IngestBatch> {
  const r = IngestBatchSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
}

/** Validate a single recipe item (used for per-item accept/reject within a batch). */
export function parseRecipeItem(input: unknown): ParseResult<RecipeItem> {
  const r = RecipeItemSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
}

/**
 * Validate the batch ENVELOPE META (source + versions + a non-empty recipes array),
 * leaving per-item validation to `parseRecipeItem`. The endpoint uses this so a single
 * bad item does not reject the whole batch.
 */
export function parseIngestEnvelope(input: unknown): ParseResult<IngestEnvelope> {
  const r = IngestEnvelopeSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ") };
}
