// Recipe-embedding reconcile (semantic-meal-plan). The recipe vector is DERIVED from
// the description, and is generated Worker-side on the cron — NOT projected by the
// Node build, which has no `env.AI` binding (see the design's embedding-placement
// decision, option B). Each scheduled tick reconciles the sibling `recipe_embeddings`
// table (migration 0008) toward the current `recipes.description` set:
//
//   * embed any recipe whose description is new or changed (a description-hash gate,
//     so a steady corpus does ~no work), and
//   * prune any embedding whose slug no longer has a description (recipe deleted or
//     its description cleared).
//
// Why this is NOT the flyer's free-tier problem (the reason the flyer became a cron):
// the flyer exhausts the 50 EXTERNAL-subrequest cap with Kroger fetches; `env.AI` is
// an INTERNAL Cloudflare-services call (the 1,000/invocation bucket, shared with D1),
// a different budget. Embedding also BATCHES (`embedTexts` = one subrequest for a
// whole chunk) and is change-driven, so it rides far lighter than the flyer beside
// it. We still bound the work per tick — for the 1,000 cap, Workers AI's own rate
// limit, and tidy wall-clock — and let the remainder reconcile on later ticks.
//
// Logic is split from I/O (injected `EmbedDeps`) so the reconcile is unit-testable
// with in-memory fakes, exactly as `flyer-warm.ts` does for the sweep.

import { db } from "./db.js";
import { embedTexts } from "./embedding.js";
import type { Env } from "./env.js";
import { notifyFailure, writeJobHealth } from "./health.js";
import type { KvStore } from "./kroger-user.js";

/** Max recipes embedded per tick. The remainder waits for the next tick; change-driven
 *  steady state is ~0, so this only bites on a cold backfill of a large corpus. */
export const RECONCILE_MAX_PER_TICK = 100;

/** Texts per `embedTexts` (Workers AI) call — one subrequest each. The per-tick batch
 *  is embedded in chunks of this size, so a full tick is at most a handful of calls. */
export const EMBED_INPUT_BATCH = 25;

/** A recipe with an embeddable description (slug + the text to embed). */
export interface RecipeDescription {
  slug: string;
  description: string;
}

/** A stored embedding's change-detection key (the vector itself is not loaded). */
export interface EmbeddingHash {
  slug: string;
  description_hash: string;
}

/** One embedding to write: the vector + the hash of the description it was built from. */
export interface UpsertRow {
  slug: string;
  embedding: number[];
  description_hash: string;
}

/** What one reconcile did, for the `health:job:recipe-embed` summary (tenant-data-free). */
export interface ReconcileResult {
  /** Recipes (re)embedded and upserted this tick. */
  embedded: number;
  /** Orphan embeddings deleted (slug no longer has a description). */
  pruned: number;
  /** Stale/missing embeddings deferred to a later tick (over the per-tick cap). */
  pending: number;
}

/** The I/O the reconcile needs, injected so the logic is testable without D1/AI. */
export interface EmbedDeps {
  /** Recipes that have a non-empty description (the embed inputs). */
  loadDescriptions(): Promise<RecipeDescription[]>;
  /** Every stored embedding's slug + description hash. */
  loadEmbeddingHashes(): Promise<EmbeddingHash[]>;
  /** Delete embeddings whose slug no longer has a description; return the count deleted. */
  pruneOrphans(): Promise<number>;
  /** Embed a chunk of texts (one Workers AI call), vectors returned in input order. */
  embedTexts(texts: string[]): Promise<number[][]>;
  /** Upsert a chunk of embeddings (idempotent on slug). */
  upsertEmbeddings(rows: UpsertRow[]): Promise<void>;
  /** Per-tick caps (injected so tests can shrink them). */
  maxPerTick: number;
  inputBatch: number;
  /** KV for the health record + epoch-ms clock, mirroring the flyer's WarmDeps. */
  kv: KvStore;
  now(): number;
}

/**
 * FNV-1a (32-bit) of a string → 8-char hex. NON-cryptographic: this is a
 * change-detection key, not a security primitive. A collision merely skips a re-embed
 * until the next unrelated description edit, which self-heals — acceptable for a
 * derived index. Deterministic and synchronous (no `crypto.subtle` await on the hot
 * path), so the same description always maps to the same hash across ticks.
 */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    // FNV prime 16777619, kept in 32-bit range via Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * One reconcile pass: (re)embed new/changed descriptions and prune orphans, bounded to
 * `maxPerTick` embeds (the rest reconcile on later ticks). Pure orchestration over the
 * injected deps. A partial run is safe: upserts are idempotent and the hash gate means
 * the next tick simply continues from where this one stopped.
 */
export async function reconcileEmbeddings(deps: EmbedDeps): Promise<ReconcileResult> {
  const recipes = await deps.loadDescriptions();
  const existing = await deps.loadEmbeddingHashes();
  const existingHash = new Map(existing.map((e) => [e.slug, e.description_hash]));

  // New or changed descriptions (hash differs from what's stored, or no row yet).
  const stale: Array<{ slug: string; text: string; hash: string }> = [];
  for (const r of recipes) {
    const hash = hashText(r.description);
    if (existingHash.get(r.slug) !== hash) stale.push({ slug: r.slug, text: r.description, hash });
  }

  // Prune embeddings whose recipe lost its description (deleted or cleared) — one
  // server-side DELETE, independent of the embed batch.
  const pruned = await deps.pruneOrphans();

  // Bound the embed work; embed in chunks (one AI call each) and upsert each chunk so
  // partial progress survives a later-chunk failure.
  const batch = stale.slice(0, deps.maxPerTick);
  for (let i = 0; i < batch.length; i += deps.inputBatch) {
    const chunk = batch.slice(i, i + deps.inputBatch);
    const vectors = await deps.embedTexts(chunk.map((c) => c.text));
    await deps.upsertEmbeddings(
      chunk.map((c, j) => ({ slug: c.slug, embedding: vectors[j], description_hash: c.hash })),
    );
  }

  return { embedded: batch.length, pruned, pending: stale.length - batch.length };
}

const UPSERT_SQL =
  "INSERT INTO recipe_embeddings (slug, embedding, description_hash) VALUES (?1, ?2, ?3) " +
  "ON CONFLICT(slug) DO UPDATE SET embedding = excluded.embedding, description_hash = excluded.description_hash";

// A recipe counts as having a description only when it is present AND non-blank — the
// same predicate the prune uses, so a whitespace-only description is neither embedded
// nor left with a stale orphan vector.
const HAS_DESCRIPTION = "description IS NOT NULL AND TRIM(description) != ''";

/** Wire the real D1 + Workers AI + KV clients for the scheduled handler. */
export function buildEmbedDeps(env: Env): EmbedDeps {
  return {
    loadDescriptions: () =>
      db(env).all<RecipeDescription>(
        `SELECT slug, description FROM recipes WHERE ${HAS_DESCRIPTION}`,
      ),
    loadEmbeddingHashes: () =>
      db(env).all<EmbeddingHash>("SELECT slug, description_hash FROM recipe_embeddings"),
    async pruneOrphans() {
      const r = await db(env).run(
        `DELETE FROM recipe_embeddings WHERE slug NOT IN (SELECT slug FROM recipes WHERE ${HAS_DESCRIPTION})`,
      );
      return r.changes;
    },
    embedTexts: (texts) => embedTexts(env, texts),
    async upsertEmbeddings(rows) {
      if (rows.length === 0) return;
      await db(env).batch(
        rows.map((r) => db(env).prepare(UPSERT_SQL, r.slug, JSON.stringify(r.embedding), r.description_hash)),
      );
    },
    maxPerTick: RECONCILE_MAX_PER_TICK,
    inputBatch: EMBED_INPUT_BATCH,
    kv: env.KROGER_KV as unknown as KvStore,
    now: () => Date.now(),
  };
}

/**
 * One scheduled run of the reconcile: do the pass, record `health:job:recipe-embed`
 * (ok with a counts summary, or fail), push an optional ntfy alert on failure, and
 * **rethrow** so the platform's native cron status reflects a failure — the same
 * shape as `runWarmJob`. Kept out of the handler so it is unit-testable with injected
 * deps + env.
 */
export async function runEmbedJob(env: Env, deps: EmbedDeps): Promise<void> {
  const startedAt = deps.now();
  try {
    const r = await reconcileEmbeddings(deps);
    await writeJobHealth(deps.kv, "recipe-embed", {
      ok: true,
      last_run_at: startedAt,
      summary: { embedded: r.embedded, pruned: r.pruned, pending: r.pending },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[recipe-embed] reconcile failed:", msg);
    await writeJobHealth(deps.kv, "recipe-embed", {
      ok: false,
      last_run_at: startedAt,
      summary: { error: msg },
    }).catch(() => {});
    await notifyFailure(env, "recipe-embed", msg);
    throw e; // cron is not retried; surfacing the failure loses nothing
  }
}
