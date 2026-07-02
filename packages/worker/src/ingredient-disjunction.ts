// Disjunctive-term modeling (disjunctive-term-modeling). A surface form "X or Y" is a
// satisfaction CONSTRAINT — either X or Y fulfills the line — never a concrete product
// identity. The registry already has the right primitives (abstract concept nodes,
// `membership` satisfies-edges); this module supplies the behavior:
//
//   * `isDisjunctiveTerm` / `splitDisjuncts` — the deterministic pattern boundary (the
//     standalone ` or ` token, comma lists folded in) and the head-noun-distribution split
//     ("white or yellow onion" → "white onion" / "yellow onion"). `and`-compounds and slash
//     forms deliberately do NOT match (real products / ratio-qualifier collisions).
//   * `disjunctionResolution` — the capture disposal: mint the term as an abstract concept
//     (concrete=0) under the cleaned phrase, search_term = the FIRST disjunct (the matcher
//     must never send a disjunctive phrase to Kroger), no classifier call. Shared with the
//     alias re-audit's parity branch.
//   * `reconcileDisjunctions` — a deterministic per-tick capture-job sub-pass (sibling of the
//     segment repair): the retroactive SHAPE SWEEP (flip wrongly-concrete disjunction nodes
//     abstract, fold `::detail` children into the base, re-root the inverted family, mint a
//     missing base) plus the MEMBERSHIP guarantee (member -[membership]→ concept edges,
//     born-stamped, disjuncts resolved through the full alias/representative front door;
//     unresolved disjuncts enqueued each tick until capture places them). Idempotent,
//     write-capped, self-quiescing by selection predicate (a flipped node fails `concrete=1`,
//     a folded child stops surviving) — no stamp column.
//
// Human nodes are never flipped or folded. No model calls anywhere in this module.

import { baseOf } from "./matching.js";
import {
  representativeResolver,
  type IdentitySourceRow,
  type AliasAuditRow,
  type EdgeRow,
  type NormalizationLog,
  type Resolution,
  type DisjunctionRepairPlan,
} from "./corpus-db.js";

/** Write cap shared by the shape sweep and the membership guarantee (families + edge inserts). */
export const DISJUNCTION_MAX_WRITES_PER_TICK = 10;

const tokensOf = (s: string): string[] => s.split(/\s+/).filter(Boolean);

/**
 * Split a term's BASE segment into its disjunct terms, or `[]` when the term is not a
 * disjunction. The pattern is the standalone ` or ` token; a comma list ("a, b, or c") folds
 * into the same separator. Head-noun distribution: the FINAL fragment's tokens after its first
 * token are the shared head ("yellow onion" → head "onion"), appended to any earlier fragment
 * with FEWER tokens than the final fragment — so "white" becomes "white onion" while
 * "olive oil or butter" splits verbatim (no fragment is shorter than the final one).
 */
export function splitDisjuncts(term: string): string[] {
  const base = baseOf(term).trim();
  if (!/(?:^|\s)or(?:\s|$)/.test(base)) return [];
  const folded = base.replace(/,\s*or\s+/g, " or ").replace(/,\s*/g, " or ");
  const parts = folded
    .split(/\s+or\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return [];
  const final = tokensOf(parts[parts.length - 1]);
  const head = final.slice(1);
  return parts.map((p, i) => {
    const t = tokensOf(p);
    if (i < parts.length - 1 && head.length > 0 && t.length < final.length) return [...t, ...head].join(" ");
    return t.join(" ");
  });
}

/** Whether a term/id names a disjunction ("X or Y") — tested on the base segment, so a
 *  `base::detail` child matches through its disjunctive base. */
export function isDisjunctiveTerm(term: string): boolean {
  return splitDisjuncts(term).length >= 2;
}

/** The member phrase a disjunction concept searches as: its first disjunct. */
export function firstDisjunct(term: string): string {
  const parts = splitDisjuncts(term);
  return parts[0] ?? term.split("::").join(" ");
}

/**
 * The deterministic capture disposal for a disjunctive term: an abstract concept node under
 * the cleaned phrase verbatim (no classifier canonical — determinism is the point), the
 * member-phrase search_term, the surface form aliased to it, no edges (the membership
 * reconcile is the single owner of member edges — the disjunct nodes mostly don't exist yet).
 */
export function disjunctionResolution(term: string, vec: number[]): Resolution {
  const disjuncts = splitDisjuncts(term);
  return {
    term,
    id: term,
    node: { base: term, detail: null, search_term: firstDisjunct(term), concrete: false, embedding: vec },
    edges: [],
    log: {
      term,
      outcome: "novel",
      resolved_id: term,
      candidates: [],
      model: null,
      detail: { note: "disjunction_concept", disjuncts },
    },
  };
}

/** The sub-pass's dependencies — a structural subset of `NormalizeDeps` (the capture job
 *  passes itself in), kept local so this module imports nothing from the job. */
export interface DisjunctionDeps {
  /** Every identity row's id/representative/source/concrete. */
  identitySources(): Promise<IdentitySourceRow[]>;
  /** Every alias mapping (variant → pre-representative id) — the disjunct front door. */
  aliasTargets(): Promise<AliasAuditRow[]>;
  /** The full edge table — the either-direction pair check for membership inserts. */
  allEdges(): Promise<EdgeRow[]>;
  /** Apply one family's shape repair (flip / fold / reroot / mint-base) atomically. */
  applyRepair(plan: DisjunctionRepairPlan): Promise<void>;
  /** Insert a satisfies edge BORN-STAMPED (the structural-guarantee primitive). */
  insertEdge(from: string, to: string, kind: string): Promise<void>;
  /** Enqueue unresolved disjunct terms for capture (insert-or-ignore, best-effort). */
  enqueue(terms: string[]): Promise<void>;
  /** Append a standalone normalization-log row (the membership-edge audit trail). */
  log(entry: NormalizationLog): Promise<void>;
  disjunctionMaxPerTick: number;
}

/** The summary slice the sub-pass mutates (`NormalizeSummary` satisfies it structurally). */
export interface DisjunctionCounters {
  /** Wrongly-concrete disjunction bases flipped abstract this tick. */
  disjunctionFlipped: number;
  /** `::detail` children folded into their disjunction base (incl. the re-root shape). */
  disjunctionFolded: number;
  /** Member -[membership]→ concept edges inserted born-stamped this tick. */
  disjunctionEdges: number;
  /** Unresolved disjunct terms enqueued for capture this tick. */
  disjunctionEnqueued: number;
  /** Human-sourced disjunction nodes skipped (never flipped or folded). */
  disjunctionSkipped: number;
}

/**
 * The per-tick disjunction reconcile: shape sweep first (so the membership step reads the
 * post-repair registry), then the membership guarantee + disjunct enqueue. Runs even on an
 * empty queue; a converged registry plans nothing (an in-memory pattern scan, zero writes).
 * Failures are per-family/per-edge best-effort — unrepaired IS the retry state.
 */
export async function reconcileDisjunctions(deps: DisjunctionDeps, summary: DisjunctionCounters): Promise<void> {
  let identities: IdentitySourceRow[];
  try {
    identities = await deps.identitySources();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingredient-disjunction] identity read failed:", msg);
    return;
  }
  const byId = new Map(identities.map((r) => [r.id, r]));
  const resolve = representativeResolver(identities);
  let writes = 0;

  // --- Shape sweep: one repair plan per disjunctive family (base + its ::detail children) ---
  const families = new Map<string, { baseRow?: IdentitySourceRow; children: IdentitySourceRow[] }>();
  for (const r of identities) {
    const b = baseOf(r.id);
    if (!isDisjunctiveTerm(b)) continue;
    let f = families.get(b);
    if (!f) families.set(b, (f = { children: [] }));
    if (r.id === b) f.baseRow = r;
    else f.children.push(r);
  }
  for (const [base, f] of families) {
    if (writes >= deps.disjunctionMaxPerTick) break;
    // Children eligible to fold: surviving, auto (human children are pinned, counted).
    const foldChildren: string[] = [];
    for (const c of f.children) {
      if (c.representative) continue; // already folded/merged away
      if (c.source === "human") {
        summary.disjunctionSkipped++;
        continue;
      }
      foldChildren.push(c.id);
    }
    let flip = false;
    let reroot = false;
    let mintBase = false;
    if (!f.baseRow) {
      if (foldChildren.length === 0) continue; // no base and nothing to hang one on
      mintBase = true;
    } else if (f.baseRow.source === "human") {
      // Operator intent is never auto-reshaped; a concrete human base also blocks the fold
      // (folding a child into a still-concrete base would be shape-wrong).
      if (!f.baseRow.representative && (f.baseRow.concrete ?? 1) !== 0) summary.disjunctionSkipped++;
      continue;
    } else if (f.baseRow.representative == null) {
      if ((f.baseRow.concrete ?? 1) !== 0) flip = true;
    } else {
      // The base merged away. Inverted (into its own surviving child) → re-root the family at
      // the base; merged ELSEWHERE → leave alone (not a shape this sweep owns).
      const surv = resolve(base);
      if (!foldChildren.includes(surv)) continue;
      reroot = true;
      flip = true;
    }
    if (!flip && !reroot && !mintBase && foldChildren.length === 0) continue;
    try {
      await deps.applyRepair({ base, searchTerm: firstDisjunct(base), mintBase, reroot, flip, children: foldChildren });
      writes++;
      if (flip) summary.disjunctionFlipped++;
      summary.disjunctionFolded += foldChildren.length;
      // Keep the in-memory view current for the membership step below.
      if (mintBase) {
        const row: IdentitySourceRow = { id: base, representative: null, source: "auto", concrete: 0 };
        identities.push(row);
        byId.set(base, row);
      }
      const baseRow = byId.get(base);
      if (baseRow) {
        baseRow.representative = null;
        baseRow.concrete = 0;
      }
      for (const cid of foldChildren) {
        const c = byId.get(cid);
        if (c) c.representative = base;
      }
    } catch (e) {
      // Transient (D1) → the family stays un-repaired and is retried next tick.
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ingredient-disjunction] shape repair failed for "${base}":`, msg);
    }
  }

  // --- Membership guarantee: member edges + disjunct enqueue over the post-repair view ---
  const concepts = identities.filter(
    (r) => !r.representative && (r.concrete ?? 1) === 0 && isDisjunctiveTerm(r.id),
  );
  if (concepts.length === 0) return;
  let aliasRows: AliasAuditRow[];
  let edges: EdgeRow[];
  try {
    [aliasRows, edges] = await Promise.all([deps.aliasTargets(), deps.allEdges()]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ingredient-disjunction] membership read failed:", msg);
    return;
  }
  const resolveNow = representativeResolver(identities);
  const aliasMap = new Map(aliasRows.map((a) => [a.variant, a.id]));
  const pairs = new Set<string>();
  for (const e of edges) {
    const from = resolveNow(e.from_id);
    const to = resolveNow(e.to_id);
    pairs.add(`${from} ${to}`);
    pairs.add(`${to} ${from}`);
  }
  const toEnqueue = new Set<string>();
  for (const concept of concepts) {
    if (writes >= deps.disjunctionMaxPerTick) break;
    for (const disjunct of splitDisjuncts(concept.id)) {
      // The full front door: exact alias variant, else the id itself; then the chain.
      const target = aliasMap.get(disjunct) ?? (byId.has(disjunct) ? disjunct : undefined);
      if (target === undefined) {
        if (disjunct !== concept.id) toEnqueue.add(disjunct);
        continue;
      }
      const member = resolveNow(target);
      if (member === concept.id || !byId.has(member)) continue;
      if (pairs.has(`${member} ${concept.id}`)) continue; // an edge already stands, either direction
      if (writes >= deps.disjunctionMaxPerTick) break;
      try {
        await deps.insertEdge(member, concept.id, "membership");
        pairs.add(`${member} ${concept.id}`);
        pairs.add(`${concept.id} ${member}`);
        await deps.log({
          term: `${member} -[membership]-> ${concept.id}`,
          outcome: "edge_restore",
          model: null,
          detail: { audit: "edge", note: "disjunction_membership", from: member, to: concept.id, kind: "membership" },
        });
        summary.disjunctionEdges++;
        writes++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[ingredient-disjunction] membership insert failed for "${member}" → "${concept.id}":`, msg);
      }
    }
  }
  if (toEnqueue.size > 0) {
    try {
      await deps.enqueue([...toEnqueue]);
      summary.disjunctionEnqueued += toEnqueue.size;
    } catch {
      // best-effort — the disjuncts re-surface every tick until captured
    }
  }
}
