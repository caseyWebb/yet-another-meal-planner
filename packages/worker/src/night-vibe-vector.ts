// Per-vibe NIGHT-VIBE embedding reconcile (night-vibe-palette capability). Each palette vibe's
// query embedding is derived Worker-side on the scheduled tick, hash-gated on the vibe text so
// it regenerates only when the text changes (steady state ≈ 0 work) and pruned when the vibe is
// deleted — the same change-driven discipline as taste-vector.ts / recipe-embeddings.ts, but
// keyed by the composite `(tenant, id)` (a palette has many vibes per tenant).
//
// Logic is split from I/O (injected `NightVibeVectorDeps`) so it is unit-testable with in-memory
// fakes, exactly as taste-vector.ts does.

import { db } from "./db.js";
import { embedText } from "./embedding.js";
import type { Env } from "./env.js";
import { hashText } from "./hash.js";
import { directoryFromEnv } from "./tenant.js";
import { readNightVibes } from "./night-vibe-db.js";
import { writeJobHealth, writeJobRun, recordUsagePoint, notifyFailure } from "./health.js";

/** Stable hash of the vibe text a vector was built from (the regeneration gate). */
export function vibeHash(text: string): string {
  return hashText(text.trim());
}

/** One vibe's text to embed (the composite key + the input). */
export interface NightVibeText {
  tenant: string;
  id: string;
  vibe: string;
}

/** One `night_vibe_derived` row's change-detection state (the vector is not loaded here). */
export interface NightVibeDerivedRow {
  tenant: string;
  id: string;
  vibe_hash: string | null;
}

/** What one reconcile pass did, for the job's health summary. */
export interface NightVibeReconcileResult {
  /** Vectors (re)generated this pass. */
  updated: number;
  /** Rows pruned (vibe deleted / member gone). */
  pruned: number;
}

/** The I/O the reconcile needs, injected so the logic is testable without D1/AI. */
export interface NightVibeVectorDeps {
  /** Every current vibe's text across all tenants. */
  loadTexts(): Promise<NightVibeText[]>;
  /** Every stored derived row's change-detection state. */
  loadStored(): Promise<NightVibeDerivedRow[]>;
  /** Embed one vibe text (one Workers AI call). */
  embed(text: string): Promise<number[]>;
  /** Upsert a vibe's vector + the hash it was built from. */
  upsert(tenant: string, id: string, hash: string, embedding: number[]): Promise<void>;
  /** Delete derived rows for the given composite keys; return rows deleted. */
  prune(keys: { tenant: string; id: string }[]): Promise<number>;
}

// A space delimiter is injective here because the id side is always a slug (never contains a
// space), so the last space unambiguously separates tenant from id. We never split it back
// apart anyway — orphans are derived from the loaded rows directly.
const compositeKey = (tenant: string, id: string): string => `${tenant} ${id}`;

/**
 * One reconcile pass: (re)embed any vibe whose text hash differs from what's stored (or has no
 * row yet), and prune derived rows whose `(tenant, id)` no longer has a vibe. Change-driven:
 * steady state ≈ 0 work. Pure orchestration over injected deps.
 */
export async function reconcileNightVibeVectors(deps: NightVibeVectorDeps): Promise<NightVibeReconcileResult> {
  const texts = await deps.loadTexts();
  const storedRows = await deps.loadStored();
  const stored = new Map(storedRows.map((r) => [compositeKey(r.tenant, r.id), r.vibe_hash]));

  const live = new Set<string>();
  let updated = 0;
  for (const { tenant, id, vibe } of texts) {
    const text = (vibe ?? "").trim();
    if (!text) continue;
    const k = compositeKey(tenant, id);
    live.add(k);
    const h = vibeHash(text);
    if (stored.get(k) === h) continue; // unchanged
    const vec = await deps.embed(text);
    await deps.upsert(tenant, id, h, vec);
    updated++;
  }

  // Prune derived rows whose (tenant,id) no longer has a vibe (deleted, or member gone). Derive
  // orphan tuples DIRECTLY from the loaded rows — never split the composite key back apart (a
  // tenant id may contain the delimiter, which would mis-target the DELETE at another tenant).
  const orphans = storedRows
    .filter((r) => !live.has(compositeKey(r.tenant, r.id)))
    .map((r) => ({ tenant: r.tenant, id: r.id }));
  const pruned = orphans.length ? await deps.prune(orphans) : 0;

  return { updated, pruned };
}

/** Wire the real D1 + Workers AI clients. `loadTexts` is injected by the caller (the scheduled
 *  handler enumerates the tenant directory), since the directory lives outside D1. */
export function buildNightVibeVectorDeps(
  env: Env,
  loadTexts: () => Promise<NightVibeText[]>,
  now: () => number = () => Date.now(),
): NightVibeVectorDeps {
  const d = db(env);
  return {
    loadTexts,
    loadStored: () => d.all<NightVibeDerivedRow>("SELECT tenant, id, vibe_hash FROM night_vibe_derived"),
    embed: (text) => embedText(env, { activity: "embed-nightvibe" }, text),
    async upsert(tenant, id, hash, embedding) {
      await d.run(
        "INSERT INTO night_vibe_derived (tenant, id, vibe_hash, embedding, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) " +
          "ON CONFLICT(tenant, id) DO UPDATE SET vibe_hash = excluded.vibe_hash, embedding = excluded.embedding, updated_at = excluded.updated_at",
        tenant,
        id,
        hash,
        JSON.stringify(embedding),
        new Date(now()).toISOString(),
      );
    },
    async prune(keys) {
      let changes = 0;
      for (const { tenant, id } of keys) {
        const r = await d.run("DELETE FROM night_vibe_derived WHERE tenant = ?1 AND id = ?2", tenant, id);
        changes += r.changes;
      }
      return changes;
    },
  };
}

/**
 * The scheduled night-vibe-embedding job (registered as `night-vibe-embed`). Enumerates the
 * tenant directory, reconciles every member's palette vectors, and records health — mirroring
 * `runEmbedJob`. Change-driven (the hash gate), so steady state ≈ 0 work; it draws on the
 * internal `env.AI` budget alongside the recipe-derived reconcile.
 */
export async function runNightVibeVectorJob(env: Env, now: () => number = () => Date.now()): Promise<void> {
  const startedAt = now();
  const directory = directoryFromEnv(env);
  try {
    const deps = buildNightVibeVectorDeps(
      env,
      async () => {
        const tenants = await directory.list();
        const texts: NightVibeText[] = [];
        for (const tenant of tenants) {
          for (const v of await readNightVibes(env, tenant)) texts.push({ tenant, id: v.id, vibe: v.vibe });
        }
        return texts;
      },
      now,
    );
    const r = await reconcileNightVibeVectors(deps);
    const summary = { updated: r.updated, pruned: r.pruned };
    await writeJobHealth(env, "night-vibe-embed", { ok: true, last_run_at: startedAt, summary });
    await writeJobRun(env, "night-vibe-embed", { ok: true, ran_at: startedAt, duration_ms: now() - startedAt, summary });
    recordUsagePoint(env, "night-vibe-embed", { ok: true, durationMs: now() - startedAt, counts: [r.updated, r.pruned] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[night-vibe] reconcile failed:", msg);
    await writeJobHealth(env, "night-vibe-embed", { ok: false, last_run_at: startedAt, summary: { error: msg } }).catch(() => {});
    await writeJobRun(env, "night-vibe-embed", { ok: false, ran_at: startedAt, duration_ms: now() - startedAt, summary: { error: msg } });
    recordUsagePoint(env, "night-vibe-embed", { ok: false, durationMs: now() - startedAt });
    await notifyFailure(env, "night-vibe-embed", msg);
    throw e; // cron is not retried; surfacing the failure loses nothing
  }
}
