// Recipe-DERIVED reconcile (semantic recipe search + derived-recipe-metadata). The cron
// reconciles the `recipe_derived` table (migration 0013, formerly `recipe_embeddings`)
// toward the current corpus in TWO passes per tick:
//
//   1. DESCRIBE — (re)generate the AI `description` for any recipe whose authored FACETS
//      changed (a `content_hash` gate over title/ingredients_key/course/protein/cuisine/
//      time_total/dietary/season — NOT the body; pure D1 + env.AI, no GitHub read). The
//      description is also seeded synchronously at import (src/write-tools.ts) so a new
//      recipe reads well immediately; this pass covers later edits + anything missed.
//   2. EMBED — embed any description whose vector is new/changed (a `description_hash`
//      gate), exactly as before; the freshly-described recipes flow straight into it.
//
// Both are change-driven (steady state ≈ 0 work) and bounded per tick. `env.AI` is an
// INTERNAL Cloudflare-services call (the 1,000/invocation bucket, shared with D1), a
// different budget than the flyer's 50 external-subrequest cap, so the two crons coexist
// in one tick. Logic is split from I/O (injected `DerivedDeps`) so it is unit-testable
// with in-memory fakes, exactly as `flyer-warm.ts` does for the sweep.

import { db } from "./db.js";
import { contentHash, generateDescription, type RecipeFacets } from "./description.js";
import { embedTexts } from "./embedding.js";
import type { Env } from "./env.js";
import { hashText } from "./hash.js";
import { notifyFailure, writeJobHealth } from "./health.js";

// Re-exported so existing importers (and tests) keep a single hash entry point.
export { hashText } from "./hash.js";

/** Max descriptions GENERATED per tick. Each is one env.AI text call (not batchable like
 *  embeds), so this is smaller than the embed cap; steady state is ~0 (change-driven). */
export const DESCRIBE_MAX_PER_TICK = 20;

/** Max recipes EMBEDDED per tick. The remainder waits for the next tick. */
export const RECONCILE_MAX_PER_TICK = 100;

/** Texts per `embedTexts` (Workers AI) call — one subrequest each. */
export const EMBED_INPUT_BATCH = 25;

/** A recipe's authored facets plus its slug (the describe input + content_hash domain). */
export interface FacetRow extends RecipeFacets {
  slug: string;
}

/** One `recipe_derived` row's change-detection state (vectors are not loaded here). */
export interface DerivedRow {
  slug: string;
  content_hash: string | null;
  description: string | null;
  description_hash: string | null;
}

/** One embedding to write: the vector + the hash of the description it was built from. */
export interface UpsertEmbeddingRow {
  slug: string;
  embedding: number[];
  description_hash: string;
}

/** What one reconcile did, for the `recipe-embed` job_health summary (tenant-data-free). */
export interface ReconcileResult {
  /** Descriptions (re)generated this tick. */
  described: number;
  /** Descriptions deferred to a later tick (over the describe cap). */
  describePending: number;
  /** Recipes (re)embedded this tick. */
  embedded: number;
  /** Orphan derived rows deleted (slug no longer in `recipes`). */
  pruned: number;
  /** Stale/missing embeddings deferred to a later tick (over the embed cap). */
  pending: number;
}

/** The I/O the reconcile needs, injected so the logic is testable without D1/AI. */
export interface DerivedDeps {
  /** Every recipe's authored facets (the describe input). */
  loadFacets(): Promise<FacetRow[]>;
  /** Every derived row's change-detection state. */
  loadDerived(): Promise<DerivedRow[]>;
  /** Generate one description from a recipe's facets (one Workers AI call). */
  describe(facets: RecipeFacets): Promise<string>;
  /** Upsert a description + its content_hash (preserves any existing embedding/description_hash). */
  upsertDescription(slug: string, description: string, contentHash: string): Promise<void>;
  /** Embed a chunk of texts (one Workers AI call), vectors returned in input order. */
  embedTexts(texts: string[]): Promise<number[][]>;
  /** Upsert a chunk of embeddings (idempotent on slug; preserves description/content_hash). */
  upsertEmbeddings(rows: UpsertEmbeddingRow[]): Promise<void>;
  /** Delete derived rows whose slug no longer exists in `recipes`; return the count deleted. */
  pruneOrphans(): Promise<number>;
  /** Per-tick caps (injected so tests can shrink them). */
  describeMaxPerTick: number;
  embedMaxPerTick: number;
  inputBatch: number;
  /** Epoch-ms clock (injected so tests can pin it). */
  now(): number;
}

/**
 * One reconcile pass: regenerate stale/missing descriptions, prune orphans, then embed
 * new/changed descriptions — each bounded per tick. Pure orchestration over the injected
 * deps. A partial run is safe: all writes are idempotent and the hash gates mean the next
 * tick continues from where this one stopped. A freshly-described recipe is embedded in the
 * SAME tick (its new description fails the description_hash gate).
 */
export async function reconcileRecipeDerived(deps: DerivedDeps): Promise<ReconcileResult> {
  const facets = await deps.loadFacets();
  const derived = new Map((await deps.loadDerived()).map((d) => [d.slug, d]));

  // DESCRIBE PASS — facets whose content_hash differs from what's stored (or no row yet).
  const staleDesc = facets.filter((f) => derived.get(f.slug)?.content_hash !== contentHash(f));
  const describeBatch = staleDesc.slice(0, deps.describeMaxPerTick);
  for (const f of describeBatch) {
    const description = await deps.describe(f);
    const ch = contentHash(f);
    await deps.upsertDescription(f.slug, description, ch);
    // Reflect the new description in-memory so the embed pass below picks it up this tick.
    derived.set(f.slug, {
      slug: f.slug,
      content_hash: ch,
      description,
      description_hash: derived.get(f.slug)?.description_hash ?? null,
    });
  }

  // Prune derived rows whose recipe is gone — one server-side DELETE, independent of the batches.
  const pruned = await deps.pruneOrphans();

  // EMBED PASS — descriptions present but un/stale-embedded (description_hash ≠ hash(description)).
  const embedCandidates = facets
    .map((f) => derived.get(f.slug))
    .filter((d): d is DerivedRow => !!d && typeof d.description === "string" && d.description.trim() !== "")
    .filter((d) => d.description_hash !== hashText(d.description as string));
  const embedBatch = embedCandidates.slice(0, deps.embedMaxPerTick);
  for (let i = 0; i < embedBatch.length; i += deps.inputBatch) {
    const chunk = embedBatch.slice(i, i + deps.inputBatch);
    const vectors = await deps.embedTexts(chunk.map((c) => c.description as string));
    await deps.upsertEmbeddings(
      chunk.map((c, j) => ({
        slug: c.slug,
        embedding: vectors[j],
        description_hash: hashText(c.description as string),
      })),
    );
  }

  return {
    described: describeBatch.length,
    describePending: staleDesc.length - describeBatch.length,
    embedded: embedBatch.length,
    pruned,
    pending: embedCandidates.length - embedBatch.length,
  };
}

const LOAD_FACETS_SQL =
  "SELECT slug, title, ingredients_key, course, protein, cuisine, time_total, dietary, season FROM recipes";
const LOAD_DERIVED_SQL = "SELECT slug, content_hash, description, description_hash FROM recipe_derived";
const DESC_UPSERT_SQL =
  "INSERT INTO recipe_derived (slug, description, content_hash) VALUES (?1, ?2, ?3) " +
  "ON CONFLICT(slug) DO UPDATE SET description = excluded.description, content_hash = excluded.content_hash";
const EMBED_UPSERT_SQL =
  "INSERT INTO recipe_derived (slug, embedding, description_hash) VALUES (?1, ?2, ?3) " +
  "ON CONFLICT(slug) DO UPDATE SET embedding = excluded.embedding, description_hash = excluded.description_hash";
const PRUNE_SQL = "DELETE FROM recipe_derived WHERE slug NOT IN (SELECT slug FROM recipes)";

/** Parse a JSON-array column to a string[] (tolerating null/garbage as []). */
function parseStrArray(value: unknown): string[] {
  if (typeof value !== "string" || value === "") return [];
  try {
    const v = JSON.parse(value);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** One raw `recipes` facet row as returned by the driver. */
interface RawFacetRow {
  slug: string;
  title: string;
  ingredients_key: string | null;
  course: string | null;
  protein: string | null;
  cuisine: string | null;
  time_total: number | null;
  dietary: string | null;
  season: string | null;
}

/** Wire the real D1 + Workers AI + KV clients for the scheduled handler. */
export function buildEmbedDeps(env: Env): DerivedDeps {
  return {
    async loadFacets() {
      const rows = await db(env).all<RawFacetRow>(LOAD_FACETS_SQL);
      return rows.map((r) => ({
        slug: r.slug,
        title: r.title,
        ingredients_key: parseStrArray(r.ingredients_key),
        course: parseStrArray(r.course),
        protein: r.protein,
        cuisine: r.cuisine,
        time_total: r.time_total,
        dietary: parseStrArray(r.dietary),
        season: parseStrArray(r.season),
      }));
    },
    loadDerived: () => db(env).all<DerivedRow>(LOAD_DERIVED_SQL),
    describe: (facets) => generateDescription(env, facets),
    async upsertDescription(slug, description, ch) {
      await db(env).run(DESC_UPSERT_SQL, slug, description, ch);
    },
    embedTexts: (texts) => embedTexts(env, texts),
    async upsertEmbeddings(rows) {
      if (rows.length === 0) return;
      await db(env).batch(
        rows.map((r) =>
          db(env).prepare(EMBED_UPSERT_SQL, r.slug, JSON.stringify(r.embedding), r.description_hash),
        ),
      );
    },
    async pruneOrphans() {
      const r = await db(env).run(PRUNE_SQL);
      return r.changes;
    },
    describeMaxPerTick: DESCRIBE_MAX_PER_TICK,
    embedMaxPerTick: RECONCILE_MAX_PER_TICK,
    inputBatch: EMBED_INPUT_BATCH,
    now: () => Date.now(),
  };
}

/**
 * Synchronously generate + store one recipe's description — the import-time seed
 * (src/discovery-tools.ts `create_recipe`), so a new recipe reads well before the reconcile's
 * next tick. Uses the SAME generate + content_hash + upsert the describe pass uses, so the
 * reconcile sees the hash match and does not regenerate. The embedding is left to the reconcile
 * (kept off the import hot path). Best-effort at the call site: a failure here must not fail the
 * already-committed import — the reconcile backfills.
 */
export async function seedRecipeDescription(env: Env, slug: string, facets: RecipeFacets): Promise<void> {
  const description = await generateDescription(env, facets);
  await db(env).run(DESC_UPSERT_SQL, slug, description, contentHash(facets));
}

/**
 * One scheduled run of the reconcile: do the pass, record the `recipe-embed` job_health row
 * (ok with a counts summary, or fail), push an optional ntfy alert on failure, and
 * **rethrow** so the platform's native cron status reflects a failure — the same shape as
 * `runWarmJob`. Kept out of the handler so it is unit-testable with injected deps + env.
 */
export async function runEmbedJob(env: Env, deps: DerivedDeps): Promise<void> {
  const startedAt = deps.now();
  try {
    const r = await reconcileRecipeDerived(deps);
    await writeJobHealth(env, "recipe-embed", {
      ok: true,
      last_run_at: startedAt,
      summary: {
        described: r.described,
        describePending: r.describePending,
        embedded: r.embedded,
        pruned: r.pruned,
        pending: r.pending,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[recipe-derived] reconcile failed:", msg);
    await writeJobHealth(env, "recipe-embed", {
      ok: false,
      last_run_at: startedAt,
      summary: { error: msg },
    }).catch(() => {});
    await notifyFailure(env, "recipe-embed", msg);
    throw e; // cron is not retried; surfacing the failure loses nothing
  }
}
