// SKU-cache key re-key reconcile (normalization-decision-reaudit). `sku_cache` is keyed by the
// canonical ingredient id, but rows learned before a term entered the identity graph keep their
// legacy raw-term key ('whole milk', 'parmesan') — and unlike grocery/pantry (which have
// `grocery-pantry-reconcile`), nothing re-keyed the cache when resolution changed. This pass is
// the cache's counterpart: each tick, plain code (no LLM) resolves every cache key through the
// current alias front-door + representative chain and re-keys rows whose resolution differs, so
// the cache converges as capture (and the alias re-audit) move resolution under it.
//
// On a (canonical ingredient, location_id) collision — with an existing canonical row or another
// moving row — the row with the newer `last_used` wins WHOLE (its sku/brand/size travel with it);
// a null `last_used` loses; a tie keeps the already-canonical row. Idempotent and stampless:
// convergence is a pure function of current resolver state, and a pass over converged rows plans
// nothing. Deliberately built on `readResolver` (NOT `ingredientContext`): the re-key must have
// NO capture side effect, so a key that resolves to nothing — a non-food or never-captured term —
// stays as-is by construction and is never enqueued as a novel term.
//
// The pass also converges the alias front-door's own TARGETS (alias-target-convergence):
// `ingredient_alias.id` stores the pre-representative id, so a merge leaves rows pointing at the
// loser forever — resolution stays correct (reads chase the chain) but the stored targets rot
// and the admin renders dead ids. Each tick, every alias row whose stored id no longer survives
// the representative chain is re-pointed to its survivor — the chain over IDENTITY rows only,
// never the alias front-door (front-door values are themselves what this step repairs). Only the
// `id` column is written: source/confidence/decided_at/audited_at are untouched and no per-row
// normalization-log entry lands — this is key maintenance, not a re-decision; the summary's
// `alias_retargeted` count is the audit trail (sibling re-keys log nothing per row either). A
// self-alias of a merged-away node (variant === old id) correctly becomes a real
// variant → survivor mapping.
//
// Ownership rule: an UN-AUDITED auto row (`source='auto' AND audited_at IS NULL`) still belongs
// to the alias re-audit — its re-decision IS the re-point — so the retarget skips it; racing it
// could overwrite a same-tick re-decision with a stale chase, and with both rows then stamped
// nothing would ever revisit the clobber. Audited rows and human rows are retarget-eligible
// (human rows are never audited; moving their target to the survivor is key maintenance, not an
// auto override of the human decision).

import type { Env } from "./env.js";
import { db } from "./db.js";
import { readResolver, readIdentitySources, readAliasTargets, representativeResolver, type AliasTargetRow } from "./corpus-db.js";
import { normalizeIngredient } from "./matching.js";
import { writeJobHealth, writeJobRun } from "./health.js";

/** The background-job name the pass records its health + per-run history under. */
export const SKU_REKEY_JOB = "sku-cache-rekey";

/** Max re-keyed groups per tick (writes, not reads). The cache is tiny (tens of rows), so a
 *  full converge fits one tick; the bound guards a pathological cache, grocery-reconcile-style. */
export const SKU_REKEY_MAX_PER_TICK = 200;

export interface SkuCacheRekeyRow {
  ingredient: string;
  location_id: string;
  sku: string;
  brand: string | null;
  size: string | null;
  last_used: string | null;
  /** Aisle placement columns (member-app-differentiators D5) — carried whole through
   *  the delete+reinsert so a re-key never erases a captured placement. */
  aisle_number: string | null;
  aisle_description: string | null;
  aisle_side: string | null;
  aisle_captured_at: string | null;
}

/** One (target key, location) group needing convergence: the stale PKs to DELETE plus the
 *  winning row to UPSERT under the canonical key (null when the standing canonical row won and
 *  needs no write). Deletes + upsert stay together so a bound never splits a re-key. */
export interface SkuRekeyGroup {
  deletes: { ingredient: string; location_id: string }[];
  upsert: SkuCacheRekeyRow | null;
  /** Rows collapsed away beyond the survivor (collision losers). */
  merged: number;
}

/**
 * Pure planner: group rows by (resolved key, location); a group needs work when any member's
 * stored key differs from the target. The winner is the newest `last_used` (null loses; a tie
 * keeps the already-canonical row, else input order), kept whole. Deterministic and idempotent —
 * over converged rows every group is a canonical singleton and the plan is empty.
 */
export function planSkuRekey(rows: SkuCacheRekeyRow[], resolve: (term: string) => string): SkuRekeyGroup[] {
  const order: string[] = [];
  const groups = new Map<string, { target: string; rows: SkuCacheRekeyRow[] }>();
  for (const r of rows) {
    const target = resolve(r.ingredient);
    const gk = `${target}\u0000${r.location_id}`;
    let g = groups.get(gk);
    if (!g) {
      g = { target, rows: [] };
      groups.set(gk, g);
      order.push(gk);
    }
    g.rows.push(r);
  }

  const plans: SkuRekeyGroup[] = [];
  for (const gk of order) {
    const { target, rows: members } = groups.get(gk)!;
    if (members.length === 1 && members[0].ingredient === target) continue; // already canonical
    let winner = members[0];
    for (const m of members.slice(1)) {
      const a = m.last_used ?? "";
      const b = winner.last_used ?? "";
      if (a > b || (a === b && m.ingredient === target && winner.ingredient !== target)) winner = m;
    }
    plans.push({
      deletes: members
        .filter((m) => m.ingredient !== target)
        .map((m) => ({ ingredient: m.ingredient, location_id: m.location_id })),
      // The standing canonical row winning needs no write; a moving winner (or a mover beating
      // the canonical row) upserts whole under the target key (ON CONFLICT overwrites the loser).
      upsert: winner.ingredient === target && members.length === 1 ? null : { ...winner, ingredient: target },
      merged: members.length - 1,
    });
  }
  return plans;
}

/**
 * Pure planner for the alias-target step: one UPDATE per RETARGET-ELIGIBLE row (audited, or
 * human — an un-audited auto row still belongs to the alias re-audit, whose re-decision IS its
 * re-point) whose stored id no longer survives the representative chain. `chase` is the
 * identity-table union-find only — an id with no identity row resolves to itself and plans
 * nothing. Idempotent by the same argument as `planSkuRekey`: over converged rows every chase
 * is a fixpoint and the plan is empty.
 */
export function planAliasRetarget(
  aliases: AliasTargetRow[],
  chase: (id: string) => string,
): { variant: string; id: string }[] {
  const updates: { variant: string; id: string }[] = [];
  for (const a of aliases) {
    if (a.source === "auto" && a.audited_at == null) continue; // audit-owned: its re-decision re-points
    const target = chase(a.id);
    if (target !== a.id) updates.push({ variant: a.variant, id: target });
  }
  return updates;
}

export interface SkuRekeyResult {
  /** Groups re-keyed this tick (each one converged key, possibly collapsing collisions). */
  rekeyed: number;
  /** Collision losers dropped in favor of a newer `last_used` row. */
  merged: number;
  /** Alias rows re-pointed to their surviving id (targets converged, metadata untouched). */
  alias_retargeted: number;
  /** True when the per-tick bound deferred part of the plan to the next tick. */
  truncated: boolean;
}

/**
 * One idempotent re-key pass. A resolver/identity read failure returns early with a zero result —
 * the pass must NEVER plan against partial resolver state (even an "empty" resolver would still
 * lowercase/quantity-strip keys and could delete collision losers on a transient D1 blip). A key
 * resolves through the alias front-door first (representative already baked in), then — for a key
 * that is itself a node id with no alias row, e.g. a canonical mint or a merged-away loser the
 * order path keyed directly — through the identity table's representative chain.
 */
export async function rekeySkuCache(env: Env): Promise<SkuRekeyResult> {
  let resolveTerm: (term: string) => string;
  let chase: (id: string) => string;
  let aliasRows: AliasTargetRow[];
  try {
    const [resolver, identities, aliases] = await Promise.all([
      readResolver(env),
      readIdentitySources(env),
      readAliasTargets(env),
    ]);
    chase = representativeResolver(identities);
    resolveTerm = (term) => chase(normalizeIngredient(term, resolver.toId));
    aliasRows = aliases;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sku-cache-rekey] resolver read failed; converging nothing this tick:", msg);
    return { rekeyed: 0, merged: 0, alias_retargeted: 0, truncated: false };
  }
  const d = db(env);
  const rows = await d.all<SkuCacheRekeyRow>(
    "SELECT ingredient, location_id, sku, brand, size, last_used, aisle_number, aisle_description, aisle_side, aisle_captured_at FROM sku_cache",
  );
  const plans = planSkuRekey(rows, resolveTerm);

  const stmts: D1PreparedStatement[] = [];

  // Alias-target convergence: id-column-only UPDATEs (source/confidence/decided_at/audited_at
  // ride untouched), bounded like the sku plan — the deferred remainder converges next tick.
  const aliasPlan = planAliasRetarget(aliasRows, chase);
  const aliasUpdates = aliasPlan.slice(0, SKU_REKEY_MAX_PER_TICK);
  for (const u of aliasUpdates) {
    stmts.push(d.prepare("UPDATE ingredient_alias SET id = ?2 WHERE variant = ?1", u.variant, u.id));
  }

  let rekeyed = 0;
  let merged = 0;
  for (const p of plans) {
    if (rekeyed >= SKU_REKEY_MAX_PER_TICK) break;
    for (const g of p.deletes) {
      stmts.push(
        d.prepare("DELETE FROM sku_cache WHERE ingredient = ?1 AND location_id = ?2", g.ingredient, g.location_id),
      );
    }
    if (p.upsert) {
      stmts.push(
        d.prepare(
          "INSERT INTO sku_cache (ingredient, location_id, sku, brand, size, last_used, aisle_number, aisle_description, aisle_side, aisle_captured_at) " +
            "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) " +
            "ON CONFLICT(ingredient, location_id) DO UPDATE SET " +
            "sku = excluded.sku, brand = excluded.brand, size = excluded.size, last_used = excluded.last_used, " +
            "aisle_number = excluded.aisle_number, aisle_description = excluded.aisle_description, " +
            "aisle_side = excluded.aisle_side, aisle_captured_at = excluded.aisle_captured_at",
          p.upsert.ingredient,
          p.upsert.location_id,
          p.upsert.sku,
          p.upsert.brand,
          p.upsert.size,
          p.upsert.last_used,
          p.upsert.aisle_number,
          p.upsert.aisle_description,
          p.upsert.aisle_side,
          p.upsert.aisle_captured_at,
        ),
      );
    }
    rekeyed++;
    merged += p.merged;
  }
  if (stmts.length > 0) await d.batch(stmts);
  const truncated = plans.length > rekeyed || aliasPlan.length > aliasUpdates.length;
  if (truncated) {
    console.warn(`[sku-cache-rekey] truncated at ${SKU_REKEY_MAX_PER_TICK} re-keys/tick; backlog re-keys next tick`);
  }
  return { rekeyed, merged, alias_retargeted: aliasUpdates.length, truncated };
}

/**
 * One scheduled run: do the re-key pass, record the `sku-cache-rekey` job_health + job_run rows
 * (tenant-clean counts only), and rethrow so the platform's cron status reflects a hard failure
 * (mirrors runReconcileJob). A converged tick is a healthy run that re-keyed nothing.
 */
export async function runSkuRekeyJob(env: Env): Promise<void> {
  const startedAt = Date.now();
  try {
    const s = await rekeySkuCache(env);
    const summary = { rekeyed: s.rekeyed, merged: s.merged, alias_retargeted: s.alias_retargeted, truncated: s.truncated };
    await writeJobHealth(env, SKU_REKEY_JOB, { ok: true, last_run_at: startedAt, summary });
    await writeJobRun(env, SKU_REKEY_JOB, { ok: true, ran_at: startedAt, duration_ms: Date.now() - startedAt, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[sku-cache-rekey] pass failed:", msg);
    await writeJobHealth(env, SKU_REKEY_JOB, { ok: false, last_run_at: startedAt, summary: { error: msg } }).catch(
      () => {},
    );
    await writeJobRun(env, SKU_REKEY_JOB, {
      ok: false,
      ran_at: startedAt,
      duration_ms: Date.now() - startedAt,
      summary: { error: msg },
    }).catch(() => {});
    throw e;
  }
}
