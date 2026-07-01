// Reader for the operator admin "Normalization" area (organic-ingredient-normalization).
// Assembles the ingredient-identity graph's operator view — the decisions audit stream, the
// pending-term queue, the live alias table, and the stat tiles — from the D1 tables the capture
// cron writes. Pure reads over `src/db.ts` (structured errors); the admin app SSR-renders these
// and the island calls the typed mutation routes. No redaction (the graph is shared corpus).

import type { Env } from "./env.js";
import { db } from "./db.js";
import { baseOf } from "./matching.js";
import { NORMALIZE_FLOOR } from "./ingredient-normalize.js";

/** UI presentation kind — derived from the raw log outcome + whether an LLM ran. */
export type DecisionKind = "same" | "spec" | "novel" | "merge" | "nollm" | "fail";

export interface DecisionCandidate {
  id: string;
  score: number;
  chosen: boolean;
}
export interface DecisionEdge {
  from: string;
  to: string;
  rel: string;
}

export interface NormalizationDecision {
  id: number;
  term: string;
  base: string;
  detail: string | null;
  concept: boolean;
  outcome: DecisionKind;
  source: "auto" | "human";
  createdAt: number;
  model: string | null;
  belowFloor: boolean;
  failedSafe: boolean;
  mergeInto: string | null;
  candidates: DecisionCandidate[];
  edges: DecisionEdge[];
  members: string[];
  reason: string;
}

export interface QueueRow {
  term: string;
  firstSeenAt: number | null;
  attempts: number;
  nextRetryAt: number | null;
}

export interface AliasRow {
  variant: string;
  base: string;
  detail: string | null;
  concept: boolean;
  source: "auto" | "human";
  merged: boolean;
}

export interface NormalizationStats {
  nodes: number;
  aliases: number;
  satisfies: number;
  pending: number;
  decisions24h: number;
  needsAttention: number;
}

export interface NormalizationPage {
  floor: number;
  stats: NormalizationStats;
  decisions: NormalizationDecision[];
  queue: QueueRow[];
  aliases: AliasRow[];
  knownIds: string[];
  lastSweep: number | null;
}

const REL: Record<string, string> = { general: "satisfies", containment: "contains", membership: "member-of" };

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseCandidates(json: string | null, resolvedId: string | null): DecisionCandidate[] {
  if (!json) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const base = resolvedId ? baseOf(resolvedId) : null;
  return arr
    .filter((c): c is { id: string; score: number } => !!c && typeof (c as { id?: unknown }).id === "string")
    .map((c) => ({
      id: c.id,
      score: typeof c.score === "number" ? c.score : 0,
      chosen: c.id === resolvedId || c.id === base,
    }));
}

/** Follow the union-find representative chain to the surviving id (cycle-safe). */
function makeResolve(rows: { id: string; representative: string | null }[]): (id: string) => string {
  const rep = new Map(rows.map((r) => [r.id, r.representative] as const));
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

/** The whole Normalization area payload in one read pass (SSR seeds the island from it). */
export async function readNormalizationPage(env: Env, opts: { decisionLimit?: number; now: number }): Promise<NormalizationPage> {
  const d = db(env);
  const dayAgo = opts.now - 24 * 60 * 60 * 1000;
  const [logRows, edgeRows, identityRows, aliasRows, queueRows, health] = await Promise.all([
    d.all<{
      id: number;
      term: string;
      outcome: string;
      resolved_id: string | null;
      candidates: string | null;
      model: string | null;
      detail: string | null;
      created_at: number | null;
    }>(
      "SELECT id, term, outcome, resolved_id, candidates, model, detail, created_at FROM ingredient_normalization_log " +
        "ORDER BY id DESC LIMIT ?1",
      opts.decisionLimit ?? 200,
    ),
    d.all<{ from_id: string; to_id: string; kind: string }>("SELECT from_id, to_id, kind FROM ingredient_edge"),
    d.all<{ id: string; base: string; detail: string | null; concrete: number; representative: string | null }>(
      "SELECT id, base, detail, concrete, representative FROM ingredient_identity",
    ),
    d.all<{ variant: string; id: string; source: string }>("SELECT variant, id, source FROM ingredient_alias"),
    d.all<{ term: string; first_seen: number | null; attempts: number; next_retry_at: number | null }>(
      "SELECT term, first_seen, attempts, next_retry_at FROM novel_ingredient_terms ORDER BY first_seen",
    ),
    d.first<{ last_run_at: number | null }>("SELECT last_run_at FROM job_health WHERE name = ?1", "ingredient-normalize"),
  ]);

  const byId = new Map(identityRows.map((r) => [r.id, r]));
  const resolve = makeResolve(identityRows);

  // Group edges by the id they touch (excluding membership, surfaced separately as members).
  const edgesFor = new Map<string, DecisionEdge[]>();
  const membersFor = new Map<string, string[]>();
  for (const e of edgeRows) {
    if (e.kind === "membership") {
      const list = membersFor.get(e.to_id) ?? [];
      list.push(e.from_id);
      membersFor.set(e.to_id, list);
    } else {
      const rel = REL[e.kind] ?? e.kind;
      for (const anchor of new Set([e.from_id, e.to_id])) {
        const list = edgesFor.get(anchor) ?? [];
        list.push({ from: e.from_id, to: e.to_id, rel });
        edgesFor.set(anchor, list);
      }
    }
  }

  let failed = 0;
  const decisions: NormalizationDecision[] = logRows.map((r) => {
    let detailObj: Record<string, unknown> = {};
    if (r.detail) {
      try {
        const p = JSON.parse(r.detail);
        if (p && typeof p === "object") detailObj = p as Record<string, unknown>;
      } catch {
        /* ignore */
      }
    }
    const node = r.resolved_id ? byId.get(r.resolved_id) : undefined;
    const base = node?.base ?? (r.resolved_id ? baseOf(r.resolved_id) : r.term);
    const detail = node?.detail ?? (r.resolved_id && r.resolved_id.includes("::") ? r.resolved_id.slice(base.length + 2) : null);
    const concept = node ? node.concrete === 0 : false;
    const belowFloor = r.outcome === "novel" && r.model == null;
    const failedSafe = detailObj.note === "confirm_failed_safe";
    let kind: DecisionKind =
      r.outcome === "same"
        ? "same"
        : r.outcome === "specialization"
          ? "spec"
          : r.outcome === "merge"
            ? "merge"
            : failedSafe
              ? "fail"
              : belowFloor
                ? "nollm"
                : "novel";
    if (kind === "fail") failed++;
    return {
      id: r.id,
      term: r.term,
      base,
      detail,
      concept,
      outcome: kind,
      source: "auto",
      createdAt: r.created_at ?? 0,
      model: r.model,
      belowFloor,
      failedSafe,
      mergeInto: r.outcome === "merge" ? r.resolved_id : null,
      candidates: parseCandidates(r.candidates, r.resolved_id),
      edges: r.resolved_id ? (edgesFor.get(r.resolved_id) ?? []) : [],
      members: r.resolved_id ? (membersFor.get(r.resolved_id) ?? []) : [],
      reason: typeof detailObj.reason === "string" ? (detailObj.reason as string) : "",
    };
  });

  const aliases: AliasRow[] = aliasRows.map((a) => {
    const surv = resolve(a.id);
    const node = byId.get(surv);
    return {
      variant: a.variant,
      base: node?.base ?? surv,
      detail: node?.detail ?? (surv.includes("::") ? surv.slice(baseOf(surv).length + 2) : null),
      concept: node ? node.concrete === 0 : false,
      source: a.source === "human" ? "human" : "auto",
      merged: surv !== a.id,
    };
  });

  const survivors = identityRows.filter((r) => r.representative == null);
  const knownIds = survivors.map((r) => r.id).sort();

  return {
    floor: NORMALIZE_FLOOR,
    // Stats are counted in JS from the loaded arrays — the identity graph is small, group-shared,
    // and already read wholesale here. `decisions24h` counts within the loaded window (the load cap
    // is far above a friend group's daily volume).
    stats: {
      nodes: survivors.length,
      aliases: aliasRows.length,
      satisfies: edgeRows.length,
      pending: queueRows.length,
      decisions24h: decisions.filter((d) => d.createdAt >= dayAgo).length,
      needsAttention: failed,
    },
    decisions,
    queue: queueRows.map((q) => ({
      term: q.term,
      firstSeenAt: num(q.first_seen),
      attempts: q.attempts ?? 0,
      nextRetryAt: num(q.next_retry_at),
    })),
    aliases,
    knownIds,
    lastSweep: num(health?.last_run_at ?? null),
  };
}
