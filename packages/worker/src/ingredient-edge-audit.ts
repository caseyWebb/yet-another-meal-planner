// The rolling edge re-audit pass (normalization-decision-reaudit, calibrated by
// normalization-audit-calibration). The pre-hardening capture wrote contradictory and
// wrong-direction satisfies edges; the hardened commit gate stops NEW ones but never touches
// standing rows. This pass converges the AUTO backlog by itself, bounded per tick, oldest first:
// representative-resolved SELF-LOOPS are deleted deterministically (no LLM); a STRUCTURAL edge
// (`X::detail -> X`, its from-node surviving) is definitionally valid — kept + stamped
// deterministically, never deleted, no LLM; a REVERSE-PAIR 2-cycle is resolved by one satisfies
// direction check (against a human reverse the auto edge loses with no model call — human
// authority); every other STANDING edge gets the same cheap check ("does having FROM acceptably
// fulfill a request for TO?") and is dropped when the direction does not hold.
//
// Two deterministic/one-shot sub-passes ride the same job:
//   * a per-tick STRUCTURAL pre-pass — sweeps STAMPED rep-resolved self-loop auto edges (the
//     drain's own rule covers un-stamped ones) and guarantees every surviving `base::detail`
//     node an edge to its base (born-stamped inserts, missing base minted) — restoring the
//     wrongly-dropped structural class with zero model calls; idempotent, converged = no writes.
//   * a one-shot REPLAY of the `edge_drop` log backlog under the recalibrated direction check —
//     each row re-evaluated once and marked in its log detail (`replayed_at`; new drops are
//     born-marked); a drop whose resolved REVERSE still stands is re-decided as a PAIR by the
//     same single check (the true direction restored, a wrongly-kept reverse deleted — even a
//     stamped one; human and structural reverses are deterministically immune).
//
// Human edges are never selected or deleted. Kept edges are stamped `audited_at` (capture,
// re-confirm, the guarantee, and the replay write born-stamped edges), so the pass drains its
// backlogs and quiesces to a no-op. Failure handling: a transient env.AI/D1 error skips the
// edge (or leaves the replay row un-marked) for a later tick; a contract-invalid direction
// check KEEPS the edge / restores nothing (never a delete on an undecidable). Per-edge writes
// run mutation-first, log-after: a mid-sequence failure leaves the edge un-stamped (retried)
// and deletes are idempotent.

import type { Env } from "./env.js";
import { ToolError } from "./errors.js";
import {
  readEdgeAuditBatch,
  readIdentitySources,
  readAllEdges,
  deleteIngredientEdge,
  stampEdgeAudited,
  appendNormalizationLog,
  insertAuditedEdge,
  readUnreplayedEdgeDrops,
  markEdgeDropReplayed,
  type EdgeAuditRow,
  type EdgeRow,
  type EdgeDropLogRow,
  type IdentitySourceRow,
  type NormalizationLog,
} from "./corpus-db.js";
import {
  confirmSatisfiesDirection,
  NORMALIZE_MODEL,
  type DirectionCheck,
  type SatisfiesDirection,
} from "./ingredient-classify.js";
import { writeJobHealth, writeJobRun } from "./health.js";

/** The background-job name the pass records its health + per-run history under. */
export const EDGE_AUDIT_JOB = "ingredient-edge-audit";

/** Edges audited per scheduled tick (bounded; worst case one direction check each). */
export const EDGE_AUDIT_MAX_PER_TICK = 10;

/** `edge_drop` log rows replayed per tick (worst case one direction check each; the backlog is
 *  one-time — every processed row is marked, new drops are born-marked). */
export const EDGE_REPLAY_MAX_PER_TICK = 10;

/** Write cap for the deterministic structural pre-pass (sweep deletes + guarantee inserts). */
export const STRUCTURAL_RESTORE_MAX_PER_TICK = 20;

export interface EdgeAuditDeps {
  loadBatch(limit: number): Promise<EdgeAuditRow[]>;
  /** Every identity row's id/representative/source — endpoint resolution. */
  identities(): Promise<IdentitySourceRow[]>;
  /** The full edge table (with source + audit stamp) — the reverse-pair lookup set. */
  allEdges(): Promise<EdgeRow[]>;
  /** The satisfies direction check over the endpoints' readable forms. */
  checkDirection(from: string, to: string): Promise<DirectionCheck>;
  deleteEdge(from: string, to: string, kind: string): Promise<void>;
  stamp(from: string, to: string, kind: string, now: number): Promise<void>;
  log(entry: NormalizationLog): Promise<void>;
  /** Insert an edge BORN-STAMPED (guarantee + replay restores), optionally minting a base node. */
  insertEdge(from: string, to: string, kind: string, opts?: { mintBase?: { id: string } }): Promise<void>;
  /** Un-replayed `edge_drop` log rows, oldest first, bounded. */
  unreplayedDrops(limit: number): Promise<EdgeDropLogRow[]>;
  /** Write a drop row's replay-marked detail (the full merged object). */
  markReplayed(id: number, detail: unknown): Promise<void>;
  now(): number;
  maxPerTick: number;
  replayMaxPerTick: number;
  structuralMaxPerTick: number;
}

export interface EdgeAuditSummary {
  /** Edges reaching a terminal audited state this tick (stamped or deleted). */
  audited: number;
  /** Representative-resolved self-loops deleted deterministically by the drain (no LLM). */
  self_loops: number;
  /** Reverse-pair 2-cycles resolved (one direction check — or human authority — per pair). */
  cycles: number;
  /** Standing edges deleted because the FROM→TO direction does not hold. */
  dropped: number;
  /** Edges validated and stamped (incl. fail-safe keeps on an undecidable check). */
  kept: number;
  /** Edges skipped on a transient error (un-stamped; retried next tick). */
  skipped: number;
  /** Structural edges (X::detail → X, from surviving) kept deterministically — no model call. */
  structural: number;
  /** Structural edges restored by the per-tick guarantee (born-stamped inserts). */
  structural_restored: number;
  /** STAMPED rep-resolved self-loop edges swept by the pre-pass. */
  self_loops_swept: number;
  /** `edge_drop` log rows replayed to a terminal mark this tick. */
  replayed: number;
  /** Edges re-inserted by the replay under the recalibrated verdict. */
  restored: number;
}

function emptySummary(): EdgeAuditSummary {
  return {
    audited: 0,
    self_loops: 0,
    cycles: 0,
    dropped: 0,
    kept: 0,
    skipped: 0,
    structural: 0,
    structural_restored: 0,
    self_loops_swept: 0,
    replayed: 0,
    restored: 0,
  };
}

/** The readable surface form of a node id (base + detail flattened) — the check's terms. */
const readable = (id: string): string => id.split("::").join(" ");

const edgeKey = (e: EdgeAuditRow): string => `${e.from_id} ${e.to_id} ${e.kind}`;

/**
 * A STRUCTURAL edge: `from` is exactly `to` plus one detail segment (`X::detail → X`). The
 * specialization's link to its base is definitionally valid — the audit never spends a model
 * call on one and never deletes one (callers additionally require the from-node to be a
 * SURVIVOR: a merged-away from resolves elsewhere, so the textual shape alone proves nothing).
 */
export function isStructuralEdge(from: string, to: string): boolean {
  const seg = from.split("::");
  return seg.length === 2 && seg[1] !== "" && !to.includes("::") && seg[0] === to;
}

/** Follow the representative chain to the surviving id (cycle-safe; mirrors readResolver). */
function makeResolve(identities: IdentitySourceRow[]): (id: string) => string {
  const rep = new Map(identities.map((r) => [r.id, r.representative]));
  return (id: string): string => {
    let cur = id;
    const seen = new Set<string>();
    for (;;) {
      const next = rep.get(cur);
      if (!next || next === cur || seen.has(next)) return cur;
      seen.add(cur);
      cur = next;
    }
  };
}

/** An edge-audit decision log row: edge-shaped term, `detail.audit = "edge"` plus structured
 *  from/to/kind fields (the Decisions admin stream filters `edge_*` outcomes out — these rows
 *  are D1-queryable audit trail). Drop rows are BORN-MARKED `replayed_at` — they are already
 *  under recalibrated judgment, so the one-shot replay never re-selects them. */
function edgeLog(
  e: EdgeAuditRow,
  outcome: "edge_drop" | "edge_keep",
  model: string | null,
  detail: Record<string, unknown>,
  now: number,
): NormalizationLog {
  const full: Record<string, unknown> = { audit: "edge", from: e.from_id, to: e.to_id, kind: e.kind, ...detail };
  if (outcome === "edge_drop") full.replayed_at = now;
  return {
    term: `${e.from_id} -[${e.kind}]-> ${e.to_id}`,
    outcome,
    model,
    detail: full,
  };
}

/** The pass's in-tick view, shared by the pre-pass, the drain, and the replay. */
interface AuditView {
  resolve: (id: string) => string;
  identities: IdentitySourceRow[];
  ids: Set<string>;
  /** Live edges (deleted here disappear for later steps; restores appear). */
  live: Map<string, EdgeRow>;
  /** Edge keys terminalized this tick (never re-processed). */
  handled: Set<string>;
  now: number;
}

/**
 * The deterministic structural pre-pass (no model calls), run EVERY tick — including after the
 * audit backlog quiesces: (a) sweep STAMPED rep-resolved self-loop auto edges (the drain's own
 * self-loop rule reaches only un-stamped rows — a segment-overflow repair can turn a born-stamped
 * structural edge into a self-loop); (b) guarantee every surviving `base::detail` node an edge
 * of some kind to its exact base — a missing one is inserted born-stamped (`general`), minting
 * the base node when absent (embedding NULL → the capture backfill embeds it), EXCEPT when the
 * base resolves to the same survivor as the node (an inverted family — the insert would be a
 * rep-resolved self-loop and (a)/(b) would churn forever). Idempotent and write-capped; a
 * converged registry plans nothing.
 */
async function ensureStructuralEdges(deps: EdgeAuditDeps, summary: EdgeAuditSummary, view: AuditView): Promise<void> {
  let writes = 0;
  for (const e of [...view.live.values()]) {
    if (writes >= deps.structuralMaxPerTick) return;
    if (e.source === "human" || e.audited_at == null) continue;
    if (view.resolve(e.from_id) !== view.resolve(e.to_id)) continue;
    try {
      await deps.deleteEdge(e.from_id, e.to_id, e.kind);
      view.live.delete(edgeKey(e));
      await deps.log(edgeLog(e, "edge_drop", null, { note: "self_loop" }, view.now));
      view.handled.add(edgeKey(e));
      summary.self_loops_swept++;
      writes++;
    } catch (err) {
      // Best-effort: the loop survives; retried next tick.
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ingredient-edge-audit] self-loop sweep failed for "${edgeKey(e)}":`, msg);
    }
  }
  const pairs = new Set<string>();
  for (const e of view.live.values()) pairs.add(`${e.from_id} ${e.to_id}`);
  for (const r of view.identities) {
    if (writes >= deps.structuralMaxPerTick) return;
    if (r.representative) continue;
    const seg = r.id.split("::");
    if (seg.length !== 2 || !seg[1]) continue;
    const base = seg[0];
    if (pairs.has(`${r.id} ${base}`)) continue; // any-kind edge to the base already stands
    // Oscillation guard (disjunctive-term-modeling): never guarantee an edge that is CURRENTLY a
    // representative-resolved self-loop. When the base resolves to the same survivor as the node
    // (the base was merged into its own child — the inverted-family shape), inserting here would
    // only feed the (a) sweep: delete + re-insert, churning every tick. The guard makes any
    // inversion quiescent; converging the SHAPE belongs to a shape-owning pass, not the guarantee.
    if (view.resolve(base) === view.resolve(r.id)) continue;
    try {
      await deps.insertEdge(r.id, base, "general", view.ids.has(base) ? undefined : { mintBase: { id: base } });
      const row: EdgeRow = { from_id: r.id, to_id: base, kind: "general", source: "auto", audited_at: view.now };
      view.live.set(edgeKey(row), row);
      view.handled.add(edgeKey(row));
      pairs.add(`${r.id} ${base}`);
      if (!view.ids.has(base)) {
        view.ids.add(base);
        view.identities.push({ id: base, representative: null, source: "auto" });
      }
      await deps.log({
        term: `${r.id} -[general]-> ${base}`,
        outcome: "edge_restore",
        model: null,
        detail: { audit: "edge", note: "structural_guarantee", from: r.id, to: base, kind: "general" },
      });
      summary.structural_restored++;
      writes++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ingredient-edge-audit] structural restore failed for "${r.id}":`, msg);
    }
  }
}

/** The strict parse of an edge-shaped log `term` (`` `from -[kind]-> to` `` — the shape `edgeLog`
 *  writes). The ONE definition shared by the replay's legacy-row parse and the admin audit
 *  reader (`audit-admin.ts`), so a drift in the term shape breaks loudly in both. */
export const EDGE_TERM_RE = /^(.+) -\[(general|containment|membership)\]-> (.+)$/;

/**
 * The one-shot replay of the pre-calibration `edge_drop` backlog: each row re-evaluated ONCE
 * under the recalibrated direction check and marked in its log detail (`replayed_at` + the
 * outcome), so the sub-pass drains and quiesces. Deterministic marks spend no model call
 * (unparseable term; self-loop / human-reverse drops; structural rows the guarantee restores;
 * merged-away from-endpoints). A row whose resolved REVERSE edge still stands is re-decided as
 * a PAIR by the same single check — forward restores the drop AND deletes the wrongly-kept
 * reverse (stamped or not); `both` restores and keeps; `reverse` stands; `neither` stands and
 * deletes the reverse. Human and structural standing reverses are immune (no model call).
 */
async function replayEdgeDrops(deps: EdgeAuditDeps, summary: EdgeAuditSummary, view: AuditView): Promise<void> {
  let rows: EdgeDropLogRow[];
  try {
    rows = await deps.unreplayedDrops(deps.replayMaxPerTick);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingredient-edge-audit] replay read failed:", msg);
    return;
  }
  for (const row of rows) {
    const prior = row.detail ?? {};
    const mark = (patch: Record<string, unknown>): Promise<void> =>
      deps.markReplayed(row.id, { ...prior, replayed_at: view.now, ...patch });
    try {
      const m = EDGE_TERM_RE.exec(row.term);
      if (!m) {
        await mark({ replay: "unparseable" });
        summary.replayed++;
        continue;
      }
      const from = m[1];
      const kind = m[2];
      const to = m[3];
      if (prior.note === "self_loop" || prior.note === "human_reverse") {
        // Deterministic drops were structurally correct by construction — nothing to re-judge.
        await mark({ replay: String(prior.note) });
        summary.replayed++;
        continue;
      }
      if (isStructuralEdge(from, to) && view.ids.has(from) && view.resolve(from) === from) {
        // The structural guarantee restores this class deterministically; the replay only marks.
        await mark({ replay: "structural" });
        summary.replayed++;
        continue;
      }
      if (!view.ids.has(from) || view.resolve(from) !== from || view.resolve(from) === view.resolve(to)) {
        // A merged-away (or vanished) from-node: the edge is moot — resolution flows through the
        // representative chain — and restoring it would re-attach a dead endpoint.
        await mark({ replay: "endpoint_merged" });
        summary.replayed++;
        continue;
      }
      const rFrom = view.resolve(from);
      const rTo = view.resolve(to);
      // Standing resolved reverses escalate to a PAIR re-decision — never a withheld restore.
      // Immunity is decided over ALL of them, mirroring the drain: ANY human reverse wins
      // deterministically, ANY structural-and-surviving reverse blocks the restore; only a
      // fully-unprotected reverse set reaches the model.
      const reverses = [...view.live.values()].filter(
        (r) => view.resolve(r.from_id) === rTo && view.resolve(r.to_id) === rFrom,
      );
      if (reverses.some((r) => r.source === "human")) {
        await mark({ replay: "human_reverse_standing" });
        summary.replayed++;
        continue;
      }
      if (reverses.some((r) => isStructuralEdge(r.from_id, r.to_id) && view.resolve(r.from_id) === r.from_id)) {
        await mark({ replay: "structural_reverse" });
        summary.replayed++;
        continue;
      }
      let check: DirectionCheck;
      try {
        check = await deps.checkDirection(readable(rFrom), readable(rTo));
      } catch (err) {
        // Contract-invalid → terminal mark, restore nothing (fail safe = don't resurrect on an
        // undecidable). Transient → rethrow (row left un-marked, retried next tick).
        if (!(err instanceof ToolError && err.code === "validation_failed")) throw err;
        await mark({ replay: "confirm_failed_safe" });
        summary.replayed++;
        continue;
      }
      const forwardHolds = check.direction === "forward" || check.direction === "both";
      const reverseHolds = check.direction === "reverse" || check.direction === "both";
      if (!reverseHolds) {
        // The pair re-decision's losing side(s) — deleted even when carrying an earlier keep
        // stamp (the architect-ratified carve-out; pair-scoped, bounded by the drop backlog).
        // The one verdict terminalizes every unprotected reverse consistently.
        for (const r of reverses) {
          await deps.deleteEdge(r.from_id, r.to_id, r.kind);
          view.live.delete(edgeKey(r));
          await deps.log(
            edgeLog(
              r,
              "edge_drop",
              NORMALIZE_MODEL,
              { note: "replay_cycle", replay_of: row.id, direction: check.direction, reason: check.reason },
              view.now,
            ),
          );
          summary.dropped++;
        }
      }
      if (forwardHolds) {
        // Re-attach the restored edge to the RESOLVED surviving to-endpoint (a merged-away TO
        // would re-point the edge at a dead node); `from` stays guarded surviving above.
        await deps.insertEdge(from, rTo, kind);
        const inserted: EdgeRow = { from_id: from, to_id: rTo, kind, source: "auto", audited_at: view.now };
        view.live.set(edgeKey(inserted), inserted);
        view.handled.add(edgeKey(inserted));
        await deps.log({
          term: row.term,
          outcome: "edge_restore",
          model: NORMALIZE_MODEL,
          detail: { audit: "edge", replay_of: row.id, direction: check.direction, reason: check.reason, from, to: rTo, kind },
        });
        await mark(
          reverses.length > 0
            ? { replay: "restored", direction: check.direction, cycle: true }
            : { replay: "restored", direction: check.direction },
        );
        summary.restored++;
      } else {
        await mark({ replay: "stands", direction: check.direction, reason: check.reason });
      }
      summary.replayed++;
    } catch (err) {
      // Transient (env.AI/D1) → the row stays un-marked and is retried next tick.
      summary.skipped++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ingredient-edge-audit] replay skipped log #${row.id}:`, msg);
    }
  }
}

/** The core pass, pure w.r.t. its injected deps (unit-testable without env). */
export async function auditEdges(deps: EdgeAuditDeps): Promise<EdgeAuditSummary> {
  const now = deps.now();
  const summary = emptySummary();
  const [identities, edges] = await Promise.all([deps.identities(), deps.allEdges()]);
  const resolve = makeResolve(identities);
  const view: AuditView = {
    resolve,
    identities,
    ids: new Set(identities.map((r) => r.id)),
    live: new Map<string, EdgeRow>(edges.map((e) => [edgeKey(e), e])),
    handled: new Set<string>(),
    now,
  };

  // The structural pre-pass runs every tick, including after the audit backlog quiesces.
  await ensureStructuralEdges(deps, summary, view);

  const { live, handled } = view;
  const batch = await deps.loadBatch(deps.maxPerTick);

  for (const e of batch) {
    const key = edgeKey(e);
    if (handled.has(key)) continue; // already resolved with its reverse (or swept) this tick
    try {
      const from = resolve(e.from_id);
      const to = resolve(e.to_id);

      // (a) A representative-resolved self-loop is meaningless by construction: delete, no LLM.
      if (from === to) {
        await deps.deleteEdge(e.from_id, e.to_id, e.kind);
        live.delete(key);
        await deps.log(edgeLog(e, "edge_drop", null, { note: "self_loop" }, now));
        handled.add(key);
        summary.self_loops++;
        summary.audited++;
        continue;
      }

      // (b) A STRUCTURAL edge with a surviving from-node is definitionally valid: keep + stamp,
      // no model call — checked BEFORE the reverse-pair branch, so no verdict (and no human
      // reverse) can ever delete it.
      if (isStructuralEdge(e.from_id, e.to_id) && from === e.from_id) {
        await deps.stamp(e.from_id, e.to_id, e.kind, now);
        await deps.log(edgeLog(e, "edge_keep", null, { note: "structural" }, now));
        handled.add(key);
        summary.structural++;
        summary.audited++;
        continue;
      }

      // (c) A resolved reverse pair (any kind) — the 2-cycle the hardened commit gate now
      // forbids. Against a human reverse the auto edge loses deterministically; a STRUCTURAL
      // reverse is kept deterministically (a pair verdict never deletes it) and the rest of
      // the pair is decided by one direction check.
      // `handled` is excluded: an edge already terminalized this tick (kept + stamped, or part
      // of an earlier pair resolution) must not be re-processed — a later row's 2-cycle verdict
      // could otherwise delete an edge the pass just validated.
      const reverses = [...live.values()].filter(
        (r) =>
          edgeKey(r) !== key &&
          !handled.has(edgeKey(r)) &&
          resolve(r.from_id) === to &&
          resolve(r.to_id) === from,
      );
      if (reverses.length > 0 && reverses.some((r) => r.source === "human")) {
        await deps.deleteEdge(e.from_id, e.to_id, e.kind);
        live.delete(key);
        await deps.log(edgeLog(e, "edge_drop", null, { note: "human_reverse" }, now));
        handled.add(key);
        summary.cycles++;
        summary.audited++;
        continue;
      }
      const shielded = reverses.filter((r) => isStructuralEdge(r.from_id, r.to_id) && resolve(r.from_id) === r.from_id);
      for (const r of shielded) {
        await deps.stamp(r.from_id, r.to_id, r.kind, now);
        await deps.log(edgeLog(r, "edge_keep", null, { note: "structural" }, now));
        handled.add(edgeKey(r));
        summary.structural++;
        summary.audited++;
      }
      const cycleReverses = reverses.filter((r) => !shielded.includes(r));
      if (cycleReverses.length > 0) {
        let check: DirectionCheck;
        try {
          check = await deps.checkDirection(readable(from), readable(to));
        } catch (err) {
          // Undecidable → keep THIS edge and stamp it (never delete on an undecidable); the
          // reverse side gets its own audit turn. Transient → rethrow (skip, retry next tick).
          if (!(err instanceof ToolError && err.code === "validation_failed")) throw err;
          await deps.stamp(e.from_id, e.to_id, e.kind, now);
          await deps.log(edgeLog(e, "edge_keep", NORMALIZE_MODEL, { note: "confirm_failed_safe" }, now));
          handled.add(key);
          summary.kept++;
          summary.audited++;
          continue;
        }
        const forwardHolds = check.direction === "forward" || check.direction === "both";
        const reverseHolds = check.direction === "reverse" || check.direction === "both";
        const detail = { direction: check.direction, reason: check.reason };
        // This edge:
        if (forwardHolds) {
          await deps.stamp(e.from_id, e.to_id, e.kind, now);
          await deps.log(edgeLog(e, "edge_keep", NORMALIZE_MODEL, detail, now));
          summary.kept++;
        } else {
          await deps.deleteEdge(e.from_id, e.to_id, e.kind);
          live.delete(key);
          await deps.log(edgeLog(e, "edge_drop", NORMALIZE_MODEL, detail, now));
        }
        handled.add(key);
        summary.audited++;
        // The reverse side(s) — the same verdict terminalizes them (all auto, non-structural here):
        for (const r of cycleReverses) {
          const rKey = edgeKey(r);
          if (reverseHolds) {
            await deps.stamp(r.from_id, r.to_id, r.kind, now);
            await deps.log(edgeLog(r, "edge_keep", NORMALIZE_MODEL, detail, now));
            summary.kept++;
          } else {
            await deps.deleteEdge(r.from_id, r.to_id, r.kind);
            live.delete(rKey);
            await deps.log(edgeLog(r, "edge_drop", NORMALIZE_MODEL, detail, now));
          }
          handled.add(rKey);
          summary.audited++;
        }
        summary.cycles++;
        continue;
      }

      // (d) A standing edge: validate the FROM→TO satisfies direction; drop when it doesn't hold.
      let check: DirectionCheck;
      try {
        check = await deps.checkDirection(readable(from), readable(to));
      } catch (err) {
        if (!(err instanceof ToolError && err.code === "validation_failed")) throw err;
        await deps.stamp(e.from_id, e.to_id, e.kind, now);
        await deps.log(edgeLog(e, "edge_keep", NORMALIZE_MODEL, { note: "confirm_failed_safe" }, now));
        handled.add(key);
        summary.kept++;
        summary.audited++;
        continue;
      }
      const valid: boolean = (["forward", "both"] as SatisfiesDirection[]).includes(check.direction);
      const detail = { direction: check.direction, reason: check.reason };
      if (valid) {
        await deps.stamp(e.from_id, e.to_id, e.kind, now);
        await deps.log(edgeLog(e, "edge_keep", NORMALIZE_MODEL, detail, now));
        summary.kept++;
      } else {
        await deps.deleteEdge(e.from_id, e.to_id, e.kind);
        live.delete(key);
        await deps.log(edgeLog(e, "edge_drop", NORMALIZE_MODEL, detail, now));
        summary.dropped++;
      }
      handled.add(key);
      summary.audited++;
    } catch (err) {
      // Transient (env.AI/D1) → skip the edge, leave it un-stamped (retried next tick).
      summary.skipped++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ingredient-edge-audit] skipped "${e.from_id} -[${e.kind}]-> ${e.to_id}":`, msg);
    }
  }

  // The one-shot drop replay runs AFTER the drain, so its pair re-decisions see this tick's
  // deletions and its restores never collide with a row the drain just terminalized.
  await replayEdgeDrops(deps, summary, view);
  return summary;
}

/** Wire the real env for the scheduled handler. */
export function buildEdgeAuditDeps(env: Env): EdgeAuditDeps {
  return {
    loadBatch: (limit) => readEdgeAuditBatch(env, limit),
    identities: () => readIdentitySources(env),
    allEdges: () => readAllEdges(env),
    checkDirection: (from, to) => confirmSatisfiesDirection(env, from, to),
    deleteEdge: (from, to, kind) => deleteIngredientEdge(env, from, to, kind),
    stamp: (from, to, kind, now) => stampEdgeAudited(env, from, to, kind, now),
    log: (entry) => appendNormalizationLog(env, entry),
    insertEdge: (from, to, kind, opts) => insertAuditedEdge(env, from, to, kind, opts),
    unreplayedDrops: (limit) => readUnreplayedEdgeDrops(env, limit),
    markReplayed: (id, detail) => markEdgeDropReplayed(env, id, detail),
    now: () => Date.now(),
    maxPerTick: EDGE_AUDIT_MAX_PER_TICK,
    replayMaxPerTick: EDGE_REPLAY_MAX_PER_TICK,
    structuralMaxPerTick: STRUCTURAL_RESTORE_MAX_PER_TICK,
  };
}

/**
 * One scheduled run: do the pass, record the `ingredient-edge-audit` job_health + job_run rows,
 * and rethrow so the platform's cron status reflects a hard failure (mirrors runReconfirmJob).
 */
export async function runEdgeAuditJob(env: Env, deps: EdgeAuditDeps): Promise<void> {
  const startedAt = deps.now();
  try {
    const s = await auditEdges(deps);
    await writeJobHealth(env, EDGE_AUDIT_JOB, { ok: true, last_run_at: startedAt, summary: { ...s } });
    await writeJobRun(env, EDGE_AUDIT_JOB, {
      ok: true,
      ran_at: startedAt,
      duration_ms: deps.now() - startedAt,
      summary: { ...s },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingredient-edge-audit] pass failed:", msg);
    await writeJobHealth(env, EDGE_AUDIT_JOB, { ok: false, last_run_at: startedAt, summary: { error: msg } }).catch(
      () => {},
    );
    await writeJobRun(env, EDGE_AUDIT_JOB, {
      ok: false,
      ran_at: startedAt,
      duration_ms: deps.now() - startedAt,
      summary: { error: msg },
    }).catch(() => {});
    throw e;
  }
}
