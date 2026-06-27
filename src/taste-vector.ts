// Per-member TASTE VECTOR derivation (background-discovery-sweep).
//
// The sweep's matcher scores a candidate recipe's cosine against each member's taste —
// their favorited-recipe vectors AND an embedding of their authored `profile.taste` text
// (the cold-start signal for a member with no favorites yet). This module owns that taste-
// text embedding: derive it via env.AI, store it in `taste_derived` (migration 0016),
// content-hash gated so it regenerates only when the text changes — the same change-driven,
// steady-state-≈0 discipline as the recipe-derived description/embedding reconcile.
//
// Logic is split from I/O (injected `TasteDeps`) so it is unit-testable with in-memory
// fakes, exactly as recipe-embeddings.ts / flyer-warm.ts do.

import { db } from "./db.js";
import { embedText } from "./embedding.js";
import type { Env } from "./env.js";
import { hashText } from "./hash.js";

/** Stable hash of the taste text a vector was built from (the regeneration gate). */
export function tasteHash(text: string): string {
  return hashText(text.trim());
}

/** One tenant's authored taste text (the embed input). */
export interface TasteText {
  tenant: string;
  taste: string | null;
}

/** One `taste_derived` row's change-detection state (the vector is not loaded here). */
export interface TasteRow {
  tenant: string;
  taste_hash: string | null;
}

/** What one taste reconcile did, for the sweep's health summary. */
export interface TasteReconcileResult {
  /** Vectors (re)generated this pass. */
  updated: number;
  /** Rows pruned (tenant has no taste text / left the directory). */
  pruned: number;
}

/** The I/O the taste reconcile needs, injected so the logic is testable without D1/AI. */
export interface TasteDeps {
  /** Every current member's authored taste text. */
  loadTasteTexts(): Promise<TasteText[]>;
  /** Every stored taste row's change-detection state. */
  loadStored(): Promise<TasteRow[]>;
  /** Embed one taste text (one Workers AI call). */
  embed(text: string): Promise<number[]>;
  /** Upsert a tenant's vector + the hash it was built from. */
  upsert(tenant: string, hash: string, embedding: number[]): Promise<void>;
  /** Delete a tenant's row (taste cleared / member gone); return rows deleted. */
  prune(tenants: string[]): Promise<number>;
}

/**
 * One taste-vector reconcile pass: (re)embed any member whose taste text's hash differs
 * from what's stored (or has no row yet), and prune rows for members who no longer have
 * taste text. Change-driven: steady state ≈ 0 work. Pure orchestration over injected deps.
 */
export async function reconcileTasteVectors(deps: TasteDeps): Promise<TasteReconcileResult> {
  const texts = await deps.loadTasteTexts();
  const stored = new Map((await deps.loadStored()).map((r) => [r.tenant, r.taste_hash]));

  const withText = new Set<string>();
  let updated = 0;
  for (const { tenant, taste } of texts) {
    const text = (taste ?? "").trim();
    if (!text) continue; // no taste text → nothing to embed (and a candidate for pruning)
    withText.add(tenant);
    const h = tasteHash(text);
    if (stored.get(tenant) === h) continue; // unchanged
    const vec = await deps.embed(text);
    await deps.upsert(tenant, h, vec);
    updated++;
  }

  // Prune rows whose tenant no longer has taste text (cleared, or left the group).
  const orphans = [...stored.keys()].filter((t) => !withText.has(t));
  const pruned = orphans.length ? await deps.prune(orphans) : 0;

  return { updated, pruned };
}

// --- read helpers (the sweep matcher's input) --------------------------------

/** Every member's taste vector (tenant → vector), skipping NULL/garbage rows. */
export async function readTasteVectors(env: Env): Promise<Map<string, number[]>> {
  const rows = await db(env).all<{ tenant: string; embedding: string | null }>(
    "SELECT tenant, embedding FROM taste_derived WHERE embedding IS NOT NULL",
  );
  const map = new Map<string, number[]>();
  for (const { tenant, embedding } of rows) {
    if (!embedding) continue;
    try {
      const v = JSON.parse(embedding);
      if (Array.isArray(v) && v.every((n) => typeof n === "number")) map.set(tenant, v as number[]);
    } catch {
      // a bad row self-heals on the next reconcile — never abort the matcher over one
    }
  }
  return map;
}

const UPSERT_SQL =
  "INSERT INTO taste_derived (tenant, taste_hash, embedding, updated_at) VALUES (?1, ?2, ?3, ?4) " +
  "ON CONFLICT(tenant) DO UPDATE SET taste_hash = excluded.taste_hash, embedding = excluded.embedding, updated_at = excluded.updated_at";

/** Wire the real D1 + Workers AI clients. `loadTasteTexts` is injected by the caller (the
 *  sweep enumerates the tenant directory), since the directory lives outside D1. */
export function buildTasteDeps(
  env: Env,
  loadTasteTexts: () => Promise<TasteText[]>,
  now: () => number = () => Date.now(),
): TasteDeps {
  const d = db(env);
  return {
    loadTasteTexts,
    loadStored: () => d.all<TasteRow>("SELECT tenant, taste_hash FROM taste_derived"),
    embed: (text) => embedText(env, text),
    async upsert(tenant, hash, embedding) {
      await d.run(UPSERT_SQL, tenant, hash, JSON.stringify(embedding), new Date(now()).toISOString());
    },
    async prune(tenants) {
      if (tenants.length === 0) return 0;
      const placeholders = tenants.map((_, i) => `?${i + 1}`).join(", ");
      const r = await d.run(`DELETE FROM taste_derived WHERE tenant IN (${placeholders})`, ...tenants);
      return r.changes;
    },
  };
}
