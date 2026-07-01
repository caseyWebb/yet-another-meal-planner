// D1 shared-corpus data layer (d1-shared-corpus, slice 6 — the last). The remaining
// shared, tool-written corpus — ingredient aliases, the store registry + store notes,
// recipe notes, RSS feeds, the newsletter allowlist + discovery inbox, the Kroger SKU
// cache, flyer terms — lives in the D1 tables of migrations/d1/0006_shared_corpus.sql.
// This module is the SINGLE place those rows are read into the agent-facing shapes and
// mutated — every tool's shared-corpus read/write goes through here, over src/db.ts
// (so a D1 failure surfaces as a structured `storage_error`). It replaces the GitHub
// TOML these artifacts used to live in; after this slice GitHub holds only recipes/*.md.
//
// Most tables are GLOBAL shared config (no tenant column). The two attributed kinds
// (store_notes, recipe_notes) carry an `author` (the writing tenant) + a `private`
// flag; the read filters apply own-private + group-shared (private=0 OR author=?).

import type { Env } from "./env.js";
import { db, type Db } from "./db.js";
import { canonicalizeUrl, isPublicHttpUrl } from "./url.js";
import { ToolError } from "./errors.js";
import type { CachedMapping } from "./matching.js";
import { baseOf, normalizeIngredient, normalizeIngredientList } from "./matching.js";

/** Parse a JSON column, tolerating null/empty/garbage as `[]`. */
function parseJsonArray(value: string | null): string[] {
  if (value == null || value === "") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as unknown[]).filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

// === Ingredient identity / normalization =====================================
// The organic normalization layer (organic-ingredient-normalization): an alias
// front-door (variant → canonical id) over a node registry with union-find
// `representative` merges. `readResolver` bakes the representative chain into the
// variant→id map so the hot path stays a plain lookup; `readAliases` returns just that
// map, preserving the matcher's `MatchDeps.aliases` contract.

/** The hot-path normalization state: variant→id map (representative-resolved) + the id set. */
export interface Resolver {
  /** Lowercased variant → surviving canonical id. Passed to the matcher as `aliases`. */
  toId: Record<string, string>;
  /** The surviving canonical ids. A normalized term in this set is "known" (not novel). */
  ids: Set<string>;
  /** Surviving canonical id → human Kroger search phrase (only for ids that store one). */
  searchTerms: Record<string, string>;
}

/** Build a union-find resolver over the identity rows: id → surviving id (cycle-safe). */
function representativeResolver(
  rows: { id: string; representative: string | null }[],
): (id: string) => string {
  const rep = new Map<string, string | null>();
  for (const r of rows) rep.set(r.id, r.representative);
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

/**
 * Load the shared normalization resolver: the alias front-door + identity registry,
 * with `representative` merges followed so every variant maps to its SURVIVING id and
 * `ids` holds the survivor set. Small, group-shared, loaded wholesale (like the old
 * `readAliases`) — embeddings are NOT loaded here (cron-only).
 */
export async function readResolver(env: Env): Promise<Resolver> {
  const d = db(env);
  const [identities, aliases] = await Promise.all([
    d.all<{ id: string; representative: string | null; search_term: string | null }>(
      "SELECT id, representative, search_term FROM ingredient_identity",
    ),
    d.all<{ variant: string; id: string }>("SELECT variant, id FROM ingredient_alias"),
  ]);
  const resolve = representativeResolver(identities);
  const ids = new Set<string>();
  const searchTerms: Record<string, string> = {};
  for (const r of identities) {
    const surv = resolve(r.id);
    ids.add(surv);
    // Prefer the survivor's own search_term; else let a merged member's fill in.
    if (r.search_term && (r.id === surv || !(surv in searchTerms))) searchTerms[surv] = r.search_term;
  }
  const toId: Record<string, string> = {};
  for (const { variant, id } of aliases) toId[variant] = resolve(id);
  return { toId, ids, searchTerms };
}

/** Read the shared ingredient-alias map (variant → surviving canonical id). Empty when none. */
export async function readAliases(env: Env): Promise<Record<string, string>> {
  return (await readResolver(env)).toId;
}

// --- IngredientContext: the single consumption funnel (design D9) -------------
// One accessor loaded once per request/tick that centralizes the whole ingredient
// pipeline so a consumer doesn't re-wire "load resolver → normalize → enqueue-on-miss
// → thread search terms". The pure core (`normalizeIngredient`/`normalizeIngredientList`/
// `baseOf`) stays in src/matching.ts; the façade COMPOSES it and layers on the env
// side-effects (best-effort novel-term capture, the §3.4 edge read). It is built from the
// existing `readResolver` (no duplicate representative logic). The matcher stays pure over
// injected `MatchDeps` — the façade is the CALLER-side funnel, not a matcher dependency.

/** One directed satisfies-edge, endpoints representative-resolved (the §3.4 read shape). */
export interface SatisfiesEdge {
  from: string;
  to: string;
  kind: string;
}

/** The single ingredient-pipeline accessor consumers funnel through (design D9). */
export interface IngredientContext {
  /** Normalize a surface form to its canonical id AND capture it if novel (best-effort enqueue). */
  resolve(term: string): string;
  /**
   * Normalize a list to canonical ids (dedup/drop-empty like `normalizeIngredientList`),
   * capturing every miss. A non-array / non-string entry passes through unchanged so
   * write/build validation can reject the bad shape (matches `normalizeIngredientList`).
   */
  resolveList(value: unknown): unknown;
  /**
   * Resolve a name array to canonical ids for internal set-math (pantry overlap, perishable
   * vocab, key-ingredient sets): resolve+capture each string entry, drop non-strings, dedupe,
   * drop empties → always a `string[]`. Unlike `resolveList` (which passes a bad shape through
   * so write/build validation can reject it), this is the lenient set-builder read-time ranking
   * wants — the SAME funnel, so a novel boost/index/pantry term is captured here too.
   */
  resolveNames(value: unknown): string[];
  /** The base of an id (`baseOf`) — the readable grouping / search-term fallback. */
  base(id: string): string;
  /** The Kroger search phrase for an id (stored `search_term`, else the flattened base). */
  searchTerm(id: string): string;
  /**
   * §3.4 read path — the satisfies-edges AMONG a given id set: only edges where BOTH
   * endpoints, resolved through the representative pointer, are in the set. Lazy: the
   * `ingredient_edge` table is loaded (and memoized) on the first call, never when the
   * context is built (the hot path never needs edges).
   */
  satisfiesAmong(ids: string[]): Promise<SatisfiesEdge[]>;
  /** The underlying resolver (for callers that feed `toId`/`searchTerms` into `MatchDeps`). */
  resolver: Resolver;
}

/**
 * Build the per-request/tick ingredient context from the shared resolver. The resolver is
 * read once here; edges are NOT — `satisfiesAmong` lazy-loads them so a hot-path caller that
 * only resolves pays no edge read. `resolve` returns the pure normalized id and, when that id
 * is NOT a known survivor (a novel surface form), enqueues it via `enqueueNovelTerms` —
 * deduped within the context (a `Set` of already-enqueued terms) and best-effort (the enqueue
 * is fire-and-forget and swallows its own errors, so it never throws into the caller).
 */
export async function ingredientContext(env: Env): Promise<IngredientContext> {
  return contextFromResolver(env, await readResolver(env));
}

/** An empty (no-alias) context — the graceful-degradation fallback when a resolver read fails
 *  in a non-critical path: normalization degrades to lowercase/strip and capture is DISABLED
 *  (a read failure must not flood the novel-term queue with un-resolved surface forms). It
 *  reads no D1, so it never throws. */
export function emptyIngredientContext(env: Env): IngredientContext {
  return contextFromResolver(env, { toId: {}, ids: new Set(), searchTerms: {} }, { capture: false });
}

/** The context builder over an already-loaded resolver (shared by the live + fallback paths). */
function contextFromResolver(
  env: Env,
  resolver: Resolver,
  opts: { capture: boolean } = { capture: true },
): IngredientContext {
  const enqueued = new Set<string>();
  // Lazily-loaded, then memoized: representative resolver + the surviving-endpoint edge list.
  let edgesPromise: Promise<{ resolve: (id: string) => string; edges: SatisfiesEdge[] }> | null = null;

  /** Enqueue a novel (unknown) canonical form once per context, best-effort. */
  const captureIfNovel = (id: string): void => {
    if (!opts.capture || !id || resolver.ids.has(id) || enqueued.has(id)) return;
    enqueued.add(id);
    // Fire-and-forget; enqueueNovelTerms already swallows its own errors (best-effort).
    void enqueueNovelTerms(env, [id]);
  };

  const loadEdges = (): Promise<{ resolve: (id: string) => string; edges: SatisfiesEdge[] }> => {
    if (!edgesPromise) {
      edgesPromise = (async () => {
        const d = db(env);
        const [identities, edges] = await Promise.all([
          d.all<{ id: string; representative: string | null }>(
            "SELECT id, representative FROM ingredient_identity",
          ),
          d.all<{ from_id: string; to_id: string; kind: string }>(
            "SELECT from_id, to_id, kind FROM ingredient_edge",
          ),
        ]);
        const resolve = representativeResolver(identities);
        return {
          resolve,
          edges: edges.map((e) => ({ from: resolve(e.from_id), to: resolve(e.to_id), kind: e.kind })),
        };
      })();
    }
    return edgesPromise;
  };

  /** Normalize one surface form to its canonical id and capture it if novel. */
  const resolveOne = (term: string): string => {
    const id = normalizeIngredient(term, resolver.toId);
    captureIfNovel(id);
    return id;
  };

  return {
    resolver,
    resolve(term: string): string {
      return resolveOne(term);
    },
    resolveList(value: unknown): unknown {
      const out = normalizeIngredientList(value, resolver.toId);
      // A returned array is the normalized-ids case; a passthrough (non-array/non-string
      // present) is the reject-later shape — capture only the real ids.
      if (Array.isArray(out) && out !== value) {
        for (const id of out) captureIfNovel(id as string);
      }
      return out;
    },
    resolveNames(value: unknown): string[] {
      if (!Array.isArray(value)) return [];
      const seen = new Set<string>();
      const out: string[] = [];
      for (const entry of value) {
        if (typeof entry !== "string") continue;
        const norm = resolveOne(entry);
        if (norm && !seen.has(norm)) {
          seen.add(norm);
          out.push(norm);
        }
      }
      return out;
    },
    base(id: string): string {
      return baseOf(id);
    },
    searchTerm(id: string): string {
      return resolver.searchTerms[id] ?? id.split("::").join(" ");
    },
    async satisfiesAmong(ids: string[]): Promise<SatisfiesEdge[]> {
      const { resolve, edges } = await loadEdges();
      // Resolve the requested set through the representative pointer so a merged id matches
      // its survivor endpoint; keep only edges with BOTH endpoints in that set.
      const want = new Set(ids.map((id) => resolve(id)));
      return edges.filter((e) => want.has(e.from) && want.has(e.to));
    },
  };
}

/**
 * Add alias mappings (variant → canonical id), upserting each by variant as a HUMAN edit
 * (source='human', which the auto capture pass never overwrites). Ensures the target id
 * exists as a base-level identity node. Returns the count written. Empty entries skipped.
 */
export async function addAliases(
  env: Env,
  mappings: { variant: string; canonical: string }[],
): Promise<number> {
  const d = db(env);
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const { variant, canonical } of mappings) {
    const v = variant.trim().toLowerCase();
    const id = canonical.trim();
    if (!v || !id) continue;
    stmts.push(
      d.prepare(
        "INSERT INTO ingredient_identity (id, base, detail, source, decided_at) VALUES (?1, ?2, ?3, ?4, ?5) " +
          "ON CONFLICT(id) DO UPDATE SET source = excluded.source",
        id,
        baseOf(id),
        id.includes("::") ? id.slice(id.indexOf("::") + 2) : null,
        "human",
        now,
      ),
      d.prepare(
        "INSERT INTO ingredient_alias (variant, id, source, decided_at) VALUES (?1, ?2, ?3, ?4) " +
          "ON CONFLICT(variant) DO UPDATE SET id = excluded.id, source = excluded.source, decided_at = excluded.decided_at",
        v,
        id,
        "human",
        now,
      ),
    );
  }
  if (stmts.length > 0) await d.batch(stmts);
  return mappings.filter((m) => m.variant.trim() && m.canonical.trim()).length;
}

/** Delete an alias by variant (its PK). Returns whether a row was removed. */
export async function deleteAlias(env: Env, variant: string): Promise<boolean> {
  const res = await db(env).run(
    "DELETE FROM ingredient_alias WHERE variant = ?1",
    variant.trim().toLowerCase(),
  );
  return res.changes > 0;
}

/**
 * Enqueue novel surface forms for the capture job (insert-or-ignore). BEST-EFFORT: a
 * queue-write failure is swallowed so it never breaks the read/match it rides alongside.
 * Callers pass only terms that did NOT resolve to a known id.
 */
export async function enqueueNovelTerms(env: Env, terms: string[]): Promise<void> {
  const unique = [...new Set(terms.map((t) => t.trim()).filter(Boolean))];
  if (unique.length === 0) return;
  try {
    const d = db(env);
    const now = Date.now();
    await d.batch(
      unique.map((term) =>
        d.prepare("INSERT OR IGNORE INTO novel_ingredient_terms (term, first_seen) VALUES (?1, ?2)", term, now),
      ),
    );
  } catch {
    // best-effort: never fail the caller on a queue write
  }
}

// --- capture-job helpers (the cron drains the queue; see src/ingredient-normalize.ts) ---

/** A due batch of queued novel terms (oldest first), skipping backed-off retries. */
export async function readNovelTermsBatch(env: Env, limit: number, now: number): Promise<string[]> {
  const rows = await db(env).all<{ term: string }>(
    "SELECT term FROM novel_ingredient_terms WHERE next_retry_at IS NULL OR next_retry_at <= ?1 " +
      "ORDER BY first_seen LIMIT ?2",
    now,
    limit,
  );
  return rows.map((r) => r.term);
}

/** EVERY identity node id AND alias variant — merged losers and unembedded nodes included. The
 *  capture job's collision set for a classifier-proposed canonical id: a canonical equal to ANY
 *  existing id falls back to the verbatim mint (an upsert onto a merged loser would silently
 *  alias the term through the representative chain), and one equal to ANY alias variant likewise
 *  (the resolver's front door is the alias map, so a standing variant→other-node row would
 *  shadow the freshly minted node for every later lookup of that exact string). */
export async function readIdentityIds(env: Env): Promise<Set<string>> {
  const [ids, variants] = await Promise.all([
    db(env).all<{ id: string }>("SELECT id FROM ingredient_identity"),
    db(env).all<{ variant: string }>("SELECT variant FROM ingredient_alias"),
  ]);
  return new Set([...ids.map((r) => r.id), ...variants.map((r) => r.variant)]);
}

/** Surviving identity nodes with NO stored embedding (e.g. human-minted via update_aliases) —
 *  the capture job's per-tick backfill batch, oldest decision first. */
export async function readEmbeddinglessIds(env: Env, limit: number): Promise<string[]> {
  const rows = await db(env).all<{ id: string }>(
    "SELECT id FROM ingredient_identity WHERE embedding IS NULL AND representative IS NULL " +
      "ORDER BY decided_at LIMIT ?1",
    limit,
  );
  return rows.map((r) => r.id);
}

/** Store a backfilled embedding on an identity node (the capture job's backfill write). */
export async function writeIdentityEmbedding(env: Env, id: string, embedding: number[]): Promise<void> {
  await db(env).run("UPDATE ingredient_identity SET embedding = ?2 WHERE id = ?1", id, JSON.stringify(embedding));
}

/** Survivor identity nodes carrying an embedding, for cosine retrieval by the capture job. */
export async function readIdentityEmbeddings(env: Env): Promise<{ id: string; embedding: number[] }[]> {
  const rows = await db(env).all<{ id: string; embedding: string }>(
    "SELECT id, embedding FROM ingredient_identity WHERE embedding IS NOT NULL AND representative IS NULL",
  );
  const out: { id: string; embedding: number[] }[] = [];
  for (const r of rows) {
    const v = parseJsonNumbers(r.embedding);
    if (v) out.push({ id: r.id, embedding: v });
  }
  return out;
}

function parseJsonNumbers(s: string): number[] | null {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) && v.every((n) => typeof n === "number") ? (v as number[]) : null;
  } catch {
    return null;
  }
}

// --- re-confirm-pass helpers (periodic-identity-reconfirm; see src/ingredient-reconfirm.ts) ---

/** One under-connected node the re-confirm pass re-examines: id + readable base/detail + vector. */
export interface ReconfirmNode {
  id: string;
  base: string;
  detail: string | null;
  embedding: number[];
}

/**
 * A batch of nodes ELIGIBLE for re-confirm, oldest `decided_at` first, bounded by `limit`.
 * Eligible = `source='auto' AND concrete=1 AND representative IS NULL AND reconfirmed_at IS NULL`
 * AND EDGELESS (the id is neither a `from_id` nor a `to_id` in `ingredient_edge`) — precisely the
 * below-floor bare mints. The `representative IS NULL` filter excludes an already-merged-away loser
 * (a co-resolution merge sets its representative but writes no edge and no stamp, so it would
 * otherwise re-qualify and let re-confirm silently redirect an existing merge). The edgeless filter
 * is done in JS (select the candidate rows + the distinct edge endpoints, then exclude in code)
 * rather than a SQL subquery/UNION, so it exercises against the fake D1. A node with no stored
 * embedding is dropped (the pass can't retrieve neighbors for it — capture will embed it, then it
 * becomes eligible next tick).
 */
export async function readReconfirmBatch(env: Env, limit: number): Promise<ReconfirmNode[]> {
  const d = db(env);
  const [candidates, edges] = await Promise.all([
    d.all<{ id: string; base: string; detail: string | null; embedding: string | null }>(
      "SELECT id, base, detail, embedding FROM ingredient_identity " +
        "WHERE source = 'auto' AND concrete = 1 AND representative IS NULL AND reconfirmed_at IS NULL " +
        "ORDER BY decided_at",
    ),
    d.all<{ from_id: string; to_id: string }>("SELECT from_id, to_id FROM ingredient_edge"),
  ]);
  const hasEdge = new Set<string>();
  for (const e of edges) {
    hasEdge.add(e.from_id);
    hasEdge.add(e.to_id);
  }
  const out: ReconfirmNode[] = [];
  for (const r of candidates) {
    if (hasEdge.has(r.id)) continue; // an edge means already connected — skip
    if (!r.embedding) continue;
    const v = parseJsonNumbers(r.embedding);
    if (!v) continue;
    out.push({ id: r.id, base: r.base, detail: r.detail, embedding: v });
    if (out.length >= limit) break;
  }
  return out;
}

/** Stamp a node re-confirmed (one-shot eligibility filter; `reconfirmed_at` = `now`). */
export async function stampReconfirmed(env: Env, id: string, now: number): Promise<void> {
  await db(env).run("UPDATE ingredient_identity SET reconfirmed_at = ?2 WHERE id = ?1", id, now);
}

/** A proposed edge the commit filter withheld, with why — recorded in the decision's log detail. */
export interface SkippedEdge {
  from: string;
  to: string;
  kind: string;
  reason: "self_loop" | "reverse_exists";
}

/**
 * The commit-time edge gate (shared by the capture + re-confirm commits): drop any proposed edge
 * that would contradict the directional "from satisfies to" semantics — a SELF-LOOP once both
 * endpoints are resolved through the `representative` pointer, or an edge whose REVERSE resolved
 * pair already exists (any kind) in the table or earlier in the same batch (the 2-cycle guard).
 * Kept edges keep their ORIGINAL endpoints (resolution stays a read-time concern). Never deletes:
 * when old and new edges disagree, the existing edge stands and the new one is withheld + logged.
 * Full-table reads + JS filtering, the module's fake-D1-compatible idiom.
 */
async function filterCommittableEdges(
  d: Db,
  edges: { from: string; to: string; kind: string }[],
): Promise<{ kept: { from: string; to: string; kind: string }[]; skipped: SkippedEdge[] }> {
  if (edges.length === 0) return { kept: [], skipped: [] };
  const [identities, existing] = await Promise.all([
    d.all<{ id: string; representative: string | null }>("SELECT id, representative FROM ingredient_identity"),
    d.all<{ from_id: string; to_id: string }>("SELECT from_id, to_id FROM ingredient_edge"),
  ]);
  const resolve = representativeResolver(identities);
  const key = (from: string, to: string) => `${from} ${to}`;
  const have = new Set(existing.map((e) => key(resolve(e.from_id), resolve(e.to_id))));
  const kept: { from: string; to: string; kind: string }[] = [];
  const skipped: SkippedEdge[] = [];
  for (const e of edges) {
    const from = resolve(e.from);
    const to = resolve(e.to);
    if (from === to) {
      skipped.push({ ...e, reason: "self_loop" });
      continue;
    }
    if (have.has(key(to, from))) {
      skipped.push({ ...e, reason: "reverse_exists" });
      continue;
    }
    have.add(key(from, to));
    kept.push(e);
  }
  return { kept, skipped };
}

/** Fold withheld edges into a decision log's detail (additive over an existing object detail). */
function withSkippedEdges(log: NormalizationLog, skipped: SkippedEdge[]): NormalizationLog {
  if (skipped.length === 0) return log;
  const base =
    log.detail && typeof log.detail === "object" && !Array.isArray(log.detail)
      ? (log.detail as Record<string, unknown>)
      : {};
  return { ...log, detail: { ...base, edges_skipped: skipped } };
}

/**
 * Commit a re-confirm decision that ONLY enriches: insert-or-ignore any proposed edges and append
 * the decision to the log — no node/alias/queue writes (the node already exists). Additive by
 * construction (`INSERT OR IGNORE`), so re-confirm can never remove or downgrade an existing edge.
 * Edges pass the commit-time contradiction gate (`filterCommittableEdges`); withheld ones land in
 * the log detail. The `log` is written with its `isReconfirm` marker so the Decisions view can
 * distinguish it.
 */
export async function commitReconfirmEdges(
  env: Env,
  r: { edges?: { from: string; to: string; kind: string }[]; log: NormalizationLog },
): Promise<void> {
  const d = db(env);
  const now = Date.now();
  const { kept, skipped } = await filterCommittableEdges(d, r.edges ?? []);
  const stmts: D1PreparedStatement[] = [];
  for (const e of kept) {
    stmts.push(
      d.prepare(
        "INSERT OR IGNORE INTO ingredient_edge (from_id, to_id, kind, source, decided_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        e.from,
        e.to,
        e.kind,
        "auto",
        now,
      ),
    );
  }
  stmts.push(logStmt(d, withSkippedEdges(r.log, skipped), now));
  await d.batch(stmts);
}

/** One decision to append to the normalization audit log. */
export interface NormalizationLog {
  term: string;
  outcome: "same" | "specialization" | "novel" | "merge" | "error" | "failed";
  resolved_id?: string | null;
  candidates?: { id: string; score: number }[];
  model?: string | null;
  detail?: unknown;
  /** True when this decision came from the periodic re-confirm pass (vs the initial capture). */
  isReconfirm?: boolean;
}

function logStmt(d: Db, entry: NormalizationLog, now: number): D1PreparedStatement {
  return d.prepare(
    "INSERT INTO ingredient_normalization_log (term, outcome, resolved_id, candidates, model, detail, is_reconfirm, created_at) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    entry.term,
    entry.outcome,
    entry.resolved_id ?? null,
    entry.candidates ? JSON.stringify(entry.candidates) : null,
    entry.model ?? null,
    entry.detail !== undefined ? JSON.stringify(entry.detail) : null,
    entry.isReconfirm ? 1 : 0,
    now,
  );
}

/** A resolved term: the id it maps to, an optional new node to mint, and any proposed edges. */
export interface Resolution {
  term: string;
  id: string;
  /** Present when a NEW node is minted (specialization / novel); absent for SAME. */
  node?: { base: string; detail: string | null; search_term: string; concrete: boolean; embedding: number[] };
  edges?: { from: string; to: string; kind: string }[];
  confidence?: number;
  log: NormalizationLog;
}

/**
 * Commit a term's resolution atomically: (optionally) mint the node + its embedding, upsert the
 * alias front-door, insert any edges, remove the term from the queue, and append the audit log —
 * one D1 batch. Node upserts only fill the embedding on conflict (never downgrade a human node's
 * source); edges are insert-or-ignore after the commit-time contradiction gate
 * (`filterCommittableEdges`; withheld edges land in the log detail). Queued terms have no prior
 * alias, so the alias upsert is effectively an insert.
 */
export async function commitResolution(env: Env, r: Resolution): Promise<void> {
  const d = db(env);
  const now = Date.now();
  const { kept, skipped } = await filterCommittableEdges(d, r.edges ?? []);
  const stmts: D1PreparedStatement[] = [];
  if (r.node) {
    stmts.push(
      d.prepare(
        "INSERT INTO ingredient_identity (id, base, detail, search_term, concrete, embedding, source, decided_at) " +
          "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) " +
          "ON CONFLICT(id) DO UPDATE SET embedding = excluded.embedding, " +
          "search_term = COALESCE(ingredient_identity.search_term, excluded.search_term)",
        r.id,
        r.node.base,
        r.node.detail,
        r.node.search_term,
        r.node.concrete ? 1 : 0,
        JSON.stringify(r.node.embedding),
        "auto",
        now,
      ),
    );
  }
  stmts.push(
    d.prepare(
      "INSERT INTO ingredient_alias (variant, id, source, confidence, decided_at) VALUES (?1, ?2, ?3, ?4, ?5) " +
        "ON CONFLICT(variant) DO UPDATE SET id = excluded.id, confidence = excluded.confidence, decided_at = excluded.decided_at",
      r.term,
      r.id,
      "auto",
      r.confidence ?? null,
      now,
    ),
  );
  for (const e of kept) {
    stmts.push(
      d.prepare(
        "INSERT OR IGNORE INTO ingredient_edge (from_id, to_id, kind, source, decided_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        e.from,
        e.to,
        e.kind,
        "auto",
        now,
      ),
    );
  }
  stmts.push(d.prepare("DELETE FROM novel_ingredient_terms WHERE term = ?1", r.term));
  stmts.push(logStmt(d, withSkippedEdges(r.log, skipped), now));
  await d.batch(stmts);
}

/** Delete a decision from the audit log by its id (operator prune of a failed row). */
export async function deleteNormalizationLog(env: Env, id: number): Promise<boolean> {
  const res = await db(env).run("DELETE FROM ingredient_normalization_log WHERE id = ?1", id);
  return res.changes > 0;
}

/** Defer a term after a transient failure: bump attempts and set the next retry time (kept queued). */
export async function deferNovelTerm(env: Env, term: string, nextRetryAt: number): Promise<void> {
  await db(env).run(
    "UPDATE novel_ingredient_terms SET attempts = attempts + 1, next_retry_at = ?2 WHERE term = ?1",
    term,
    nextRetryAt,
  );
}

/**
 * Merge two existing identities via the union-find `representative` pointer (no key rewrites),
 * logging the merge. Used by the SKU-cache co-resolution signal for cross-lexical synonyms the
 * embedder can't retrieve, and by the re-confirm pass for a `same`-outcome synonym. `loser`'s
 * representative is set to `survivor`. `opts.isReconfirm` marks the log row so a re-confirm merge
 * is distinguishable from a capture-time one.
 */
export async function mergeIdentities(
  env: Env,
  loser: string,
  survivor: string,
  opts: { isReconfirm?: boolean } = {},
): Promise<void> {
  if (loser === survivor) return;
  const d = db(env);
  const now = Date.now();
  await d.batch([
    d.prepare("UPDATE ingredient_identity SET representative = ?2 WHERE id = ?1", loser, survivor),
    logStmt(d, { term: loser, outcome: "merge", resolved_id: survivor, isReconfirm: opts.isReconfirm }, now),
  ]);
}

/**
 * A candidate cross-lexical merge: two distinct surviving ids that resolve to the same Kroger SKU
 * in `sku_cache`. The signal embeddings can't produce (zucchini/courgette rank far apart), so the
 * co-resolution pass confirms these before merging. `source` per id lets the caller protect human
 * nodes (a human node is always the survivor, never merged away).
 */
export interface CoResolutionPair {
  a: string;
  b: string;
  sku: string;
  aSource: "auto" | "human";
  bSource: "auto" | "human";
  /** A's Kroger search phrase (or A itself when the node stores none) — the confirm's `term`. */
  aTerm: string;
}

const normSource = (s: string | null | undefined): "auto" | "human" => (s === "human" ? "human" : "auto");

/**
 * Candidate cross-lexical merge pairs from the shared SKU cache: distinct SURVIVING ids that map
 * to the same Kroger SKU. Each `sku_cache.ingredient` is resolved through the representative chain
 * to its survivor first, then grouped by `sku` alone (a shared SKU across locations is still strong
 * evidence). A SKU covered by ≥2 distinct survivors yields one pair per unordered survivor combo,
 * with each side's identity `source`. Grouping/counting is done in JS (the fake-d1 can't `GROUP BY`).
 * Ids are sorted so the output is deterministic (stable for tests). Pairs already unified (same
 * survivor) never appear. `limit` caps the returned pairs.
 */
export async function readSkuCoResolutionPairs(env: Env, limit: number): Promise<CoResolutionPair[]> {
  const d = db(env);
  const [identities, skus] = await Promise.all([
    d.all<{ id: string; representative: string | null; source: string | null; search_term: string | null }>(
      "SELECT id, representative, source, search_term FROM ingredient_identity",
    ),
    d.all<{ ingredient: string; sku: string }>("SELECT ingredient, sku FROM sku_cache"),
  ]);
  const resolve = representativeResolver(identities);
  const sourceOf = new Map(identities.map((r) => [r.id, normSource(r.source)] as const));
  const searchTermOf = new Map(identities.map((r) => [r.id, r.search_term] as const));

  // sku → set of surviving ids that resolve to it.
  const bySku = new Map<string, Set<string>>();
  for (const row of skus) {
    if (!row.ingredient || !row.sku) continue;
    const surv = resolve(row.ingredient);
    let set = bySku.get(row.sku);
    if (!set) bySku.set(row.sku, (set = new Set()));
    set.add(surv);
  }

  // Emit one deterministic pair per (sku, unordered survivor combo). Dedup pairs across SKUs by
  // key so the same synonym candidate proposed by multiple SKUs is confirmed once per tick.
  const pairs: CoResolutionPair[] = [];
  const seen = new Set<string>();
  for (const [sku, set] of [...bySku].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0))) {
    if (set.size < 2) continue;
    const ids = [...set].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];
        const key = `${a} ${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({
          a,
          b,
          sku,
          aSource: sourceOf.get(a) ?? "auto",
          bSource: sourceOf.get(b) ?? "auto",
          aTerm: searchTermOf.get(a) || a,
        });
        if (pairs.length >= limit) return pairs;
      }
    }
  }
  return pairs;
}

// === SKU cache ===============================================================

interface SkuRow {
  ingredient: string;
  location_id: string;
  sku: string;
  brand: string | null;
  size: string | null;
}

/**
 * Read the shared SKU cache as the matcher's CachedMapping[]. `location_id` '' (the
 * untagged backfill sentinel) reads as absent so the matcher's same-location
 * preference treats it as legacy/untagged.
 */
export async function readSkuCache(env: Env): Promise<CachedMapping[]> {
  const rows = await db(env).all<SkuRow>(
    "SELECT ingredient, location_id, sku, brand, size FROM sku_cache",
  );
  return rows.map((r) => {
    const m: CachedMapping = { ingredient: r.ingredient, sku: r.sku };
    if (r.brand != null) m.brand = r.brand;
    if (r.size != null) m.size = r.size;
    if (r.location_id) m.locationId = r.location_id;
    return m;
  });
}

/** One new SKU-cache mapping to persist (the order path's learned resolution). */
export interface NewSkuMapping {
  ingredient: string;
  sku: string;
  brand?: string;
  size?: string;
  locationId?: string;
  last_used?: string;
}

/**
 * Upsert learned SKU mappings, keyed (ingredient, location_id). An untagged mapping
 * stores location_id '' so it shares the composite PK; revalidation overwrites in
 * place. Returns the count written. Mirrors the old append-only TOML cache writer,
 * but upsert-by-key (the indexed lookup the matcher wants).
 */
export async function upsertSkuMappings(env: Env, mappings: NewSkuMapping[]): Promise<number> {
  const d = db(env);
  const stmts: D1PreparedStatement[] = [];
  for (const m of mappings) {
    if (!m.ingredient || !m.sku) continue;
    stmts.push(
      d.prepare(
        "INSERT INTO sku_cache (ingredient, location_id, sku, brand, size, last_used) " +
          "VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
          "ON CONFLICT(ingredient, location_id) DO UPDATE SET " +
          "sku = excluded.sku, brand = excluded.brand, size = excluded.size, last_used = excluded.last_used",
        m.ingredient,
        m.locationId ?? "",
        m.sku,
        m.brand ?? null,
        m.size ?? null,
        m.last_used ?? null,
      ),
    );
  }
  if (stmts.length > 0) await d.batch(stmts);
  return stmts.length;
}

// === Flyer terms =============================================================

/** Read the shared flyer broad-scan terms. */
export async function readFlyerTerms(env: Env): Promise<string[]> {
  const rows = await db(env).all<{ term: string }>("SELECT term FROM flyer_terms");
  return rows.map((r) => r.term);
}

/**
 * Add flyer broad-scan terms, deduped by term (the bare PK; existing untouched —
 * add-only, insert-or-ignore). Each term is trimmed; empties are skipped. Returns the
 * count actually added.
 */
export async function addFlyerTerms(env: Env, terms: string[]): Promise<number> {
  const have = new Set(await readFlyerTerms(env));
  const d = db(env);
  const stmts: D1PreparedStatement[] = [];
  for (const raw of terms) {
    const term = typeof raw === "string" ? raw.trim() : "";
    if (!term || have.has(term)) continue;
    have.add(term);
    stmts.push(d.prepare("INSERT OR IGNORE INTO flyer_terms (term) VALUES (?1)", term));
  }
  if (stmts.length > 0) await d.batch(stmts);
  return stmts.length;
}

/** Delete a flyer term by its value (its PK). Returns whether a row was removed. */
export async function deleteFlyerTerm(env: Env, term: string): Promise<boolean> {
  const res = await db(env).run("DELETE FROM flyer_terms WHERE term = ?1", term);
  return res.changes > 0;
}

// === Feeds ===================================================================

export interface FeedRow {
  url: string;
  name: string | null;
  weight: number | null;
  tags: string[];
}

/** Read the shared RSS/Atom discovery feeds. */
export async function readFeeds(env: Env): Promise<FeedRow[]> {
  const rows = await db(env).all<{ url: string; name: string | null; weight: number | null; tags: string | null }>(
    "SELECT url, name, weight, tags FROM feeds",
  );
  return rows.map((r) => ({
    url: r.url,
    name: r.name,
    weight: r.weight,
    tags: parseJsonArray(r.tags),
  }));
}

/**
 * Add discovery feeds, deduped by url (existing rows untouched — add-only, the shared
 * `feeds` table's dedup semantics). Returns the count of feeds actually added.
 */
export async function addFeedRows(
  env: Env,
  feeds: { url: string; name?: string; weight?: number; tags?: string[] }[],
): Promise<number> {
  const have = new Set((await readFeeds(env)).map((f) => f.url));
  const d = db(env);
  const stmts: D1PreparedStatement[] = [];
  for (const f of feeds) {
    if (typeof f.url !== "string" || !f.url.trim() || have.has(f.url)) continue;
    // Egress safety (outbound-fetch-safety): never STORE a feed URL the sweep/probe could later
    // be steered into fetching against an internal/non-http target — the write-time half of the
    // guard the fetch primitive applies. Atomic: a bad URL rejects the batch before any write.
    if (!isPublicHttpUrl(f.url)) {
      throw new ToolError("validation_failed", `Feed URL must be a public http(s) URL: ${f.url}`, {
        field: "url",
        url: f.url,
      });
    }
    have.add(f.url);
    stmts.push(
      d.prepare(
        "INSERT OR IGNORE INTO feeds (url, name, weight, tags) VALUES (?1, ?2, ?3, ?4)",
        f.url,
        f.name ?? null,
        f.weight ?? 1,
        f.tags && f.tags.length ? JSON.stringify(f.tags) : null,
      ),
    );
  }
  if (stmts.length > 0) await d.batch(stmts);
  return stmts.length;
}

/** Delete a feed by url (its PK). Returns whether a row was removed. */
export async function deleteFeed(env: Env, url: string): Promise<boolean> {
  const res = await db(env).run("DELETE FROM feeds WHERE url = ?1", url);
  return res.changes > 0;
}

// === Discovery allowlist =====================================================

/** Normalize an allowlist address the same way `addSourceRows` stores it (trim + lowercase). */
function normalizeAddress(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface Allowlist {
  members: Set<string>;
  senders: Set<string>;
}

/** Read the shared inbound-newsletter allowlist (trusted member + sender addresses). */
export async function readAllowlist(env: Env): Promise<Allowlist> {
  const [members, senders] = await Promise.all([
    db(env).all<{ address: string }>("SELECT address FROM discovery_members"),
    db(env).all<{ address: string }>("SELECT address FROM discovery_senders"),
  ]);
  return {
    members: new Set(members.map((r) => r.address)),
    senders: new Set(senders.map((r) => r.address)),
  };
}

/**
 * Add trusted members/senders to the allowlist, deduped by address (existing
 * untouched). Addresses are normalized (trim + lowercase) — only valid `@` addresses
 * are kept. Returns how many of each kind were added.
 */
export async function addSourceRows(
  env: Env,
  additions: { members?: { address: string }[]; senders?: { address: string; name?: string }[] },
): Promise<{ members: number; senders: number }> {
  const norm = (raw: unknown): string | null => {
    if (typeof raw !== "string") return null;
    const a = normalizeAddress(raw);
    return a.includes("@") ? a : null;
  };
  const current = await readAllowlist(env);
  const d = db(env);
  const stmts: D1PreparedStatement[] = [];
  let memberCount = 0;
  let senderCount = 0;
  for (const m of additions.members ?? []) {
    const a = norm(m.address);
    if (!a || current.members.has(a)) continue;
    current.members.add(a);
    stmts.push(d.prepare("INSERT OR IGNORE INTO discovery_members (address) VALUES (?1)", a));
    memberCount++;
  }
  for (const s of additions.senders ?? []) {
    const a = norm(s.address);
    if (!a || current.senders.has(a)) continue;
    current.senders.add(a);
    stmts.push(
      d.prepare(
        "INSERT OR IGNORE INTO discovery_senders (address, name) VALUES (?1, ?2)",
        a,
        typeof s.name === "string" && s.name ? s.name : null,
      ),
    );
    senderCount++;
  }
  if (stmts.length > 0) await d.batch(stmts);
  return { members: memberCount, senders: senderCount };
}

/** Delete a newsletter sender by address (normalized to match storage). Returns whether a row was removed. */
export async function deleteSender(env: Env, address: string): Promise<boolean> {
  const res = await db(env).run("DELETE FROM discovery_senders WHERE address = ?1", normalizeAddress(address));
  return res.changes > 0;
}

/** Delete a discovery member by address (normalized to match storage). Returns whether a row was removed. */
export async function deleteMember(env: Env, address: string): Promise<boolean> {
  const res = await db(env).run("DELETE FROM discovery_members WHERE address = ?1", normalizeAddress(address));
  return res.changes > 0;
}

// === Discovery inbox =========================================================

export interface InboxCandidate {
  from: string;
  subject: string;
  received_at: string | null;
  body: string;
}

/**
 * Read the shared email-discovery inbox as the agent reads it (newest-relevant set),
 * dropping any candidate whose URL has been group-rejected (the disposition collapse —
 * a rejected discovery never resurfaces for anyone). Compared on the canonical URL so
 * a tracker-wrapped reject still suppresses the bare candidate.
 */
export async function readDiscoveryInbox(env: Env): Promise<InboxCandidate[]> {
  const [rows, rejected] = await Promise.all([
    db(env).all<{
      url: string | null;
      source: string | null;
      subject: string | null;
      body: string | null;
      discovered_at: string | null;
    }>(
      "SELECT url, source, subject, body, discovered_at FROM discovery_candidates ORDER BY discovered_at DESC, id",
    ),
    readDiscoveryRejections(env),
  ]);
  return rows
    .filter((r) => !(r.url && rejected.has(canonicalizeUrl(r.url))))
    .map((r) => ({
      from: r.source ?? "",
      subject: r.subject ?? "",
      received_at: r.discovered_at && r.discovered_at.length ? r.discovered_at : null,
      body: r.body ?? "",
    }));
}

/** Canonical URLs the group has rejected — the suppression set the discovery sweep's
 *  intake unions into its dedup `seen` set so a rejected source is never re-imported. */
export async function readDiscoveryRejections(env: Env): Promise<Set<string>> {
  const rows = await db(env).all<{ url: string }>("SELECT url FROM discovery_rejections");
  return new Set(rows.map((r) => r.url));
}

/** Record a group-wide discovery rejection (idempotent on the canonical URL; a repeat
 *  refreshes the reason/provenance). `url` must already be canonicalized by the caller. */
export async function addDiscoveryRejection(
  env: Env,
  rejection: { url: string; reason: string | null; rejectedBy: string; rejectedAt: string },
): Promise<void> {
  await db(env).run(
    "INSERT INTO discovery_rejections (url, reason, rejected_by, rejected_at) VALUES (?1, ?2, ?3, ?4) " +
      "ON CONFLICT(url) DO UPDATE SET reason = excluded.reason, rejected_by = excluded.rejected_by, rejected_at = excluded.rejected_at",
    rejection.url,
    rejection.reason,
    rejection.rejectedBy,
    rejection.rejectedAt,
  );
}

/**
 * Insert one email-discovery candidate, deduped by the UNIQUE url column. Returns
 * whether a row was written (false = an exact re-delivery already present).
 */
export async function insertDiscoveryCandidate(
  env: Env,
  cand: { url: string; from: string; subject: string; body: string; received_at: string },
): Promise<boolean> {
  const res = await db(env).run(
    "INSERT OR IGNORE INTO discovery_candidates (id, url, source, subject, body, discovered_at, status) " +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'new')",
    cand.url,
    cand.url,
    cand.from,
    cand.subject,
    cand.body,
    cand.received_at,
  );
  return res.changes > 0;
}

// === Stores ==================================================================

/**
 * Objective store IDENTITY (shared, unattributed). The non-core identity fields
 * (label/chain/address/location_id) are kept in the `extra` JSON column.
 */
export interface Store {
  slug: string;
  name: string;
  label?: string;
  chain?: string;
  address?: string;
  domain: string;
  location_id?: string;
}

const STORE_EXTRA_KEYS = ["label", "chain", "address", "location_id"] as const;

function storeOfRow(r: { slug: string; name: string; domain: string | null; extra: string | null }): Store {
  const store: Store = { slug: r.slug, name: r.name, domain: r.domain ?? "grocery" };
  if (r.extra) {
    try {
      const extra = JSON.parse(r.extra) as Record<string, unknown>;
      for (const k of STORE_EXTRA_KEYS) {
        if (typeof extra[k] === "string" && extra[k]) store[k] = extra[k] as string;
      }
    } catch {
      /* ignore malformed extra */
    }
  }
  return store;
}

function storeExtraJson(store: Store): string | null {
  const extra: Record<string, string> = {};
  for (const k of STORE_EXTRA_KEYS) {
    const v = store[k];
    if (typeof v === "string" && v) extra[k] = v;
  }
  return Object.keys(extra).length ? JSON.stringify(extra) : null;
}

/** List the registered stores (identity only), sorted by slug. */
export async function listStoreRows(env: Env): Promise<Store[]> {
  const rows = await db(env).all<{ slug: string; name: string; domain: string | null; extra: string | null }>(
    "SELECT slug, name, domain, extra FROM stores ORDER BY slug",
  );
  return rows.map(storeOfRow);
}

/** Read one store by slug, or null when absent. */
export async function readStoreRow(env: Env, slug: string): Promise<Store | null> {
  const row = await db(env).first<{ slug: string; name: string; domain: string | null; extra: string | null }>(
    "SELECT slug, name, domain, extra FROM stores WHERE slug = ?1",
    slug,
  );
  return row ? storeOfRow(row) : null;
}

/** Insert a new store row (caller checks the slug isn't already registered). */
export async function insertStore(env: Env, store: Store): Promise<void> {
  await db(env).run(
    "INSERT INTO stores (slug, name, domain, extra) VALUES (?1, ?2, ?3, ?4)",
    store.slug,
    store.name,
    store.domain,
    storeExtraJson(store),
  );
}

/** Upsert a store row by slug (used by update_store after applying its ops). */
export async function upsertStore(env: Env, store: Store): Promise<void> {
  await db(env).run(
    "INSERT INTO stores (slug, name, domain, extra) VALUES (?1, ?2, ?3, ?4) " +
      "ON CONFLICT(slug) DO UPDATE SET name = excluded.name, domain = excluded.domain, extra = excluded.extra",
    store.slug,
    store.name,
    store.domain,
    storeExtraJson(store),
  );
}

/** Delete a store by slug. Returns whether a row was removed. */
export async function deleteStore(env: Env, slug: string): Promise<boolean> {
  const res = await db(env).run("DELETE FROM stores WHERE slug = ?1", slug);
  return res.changes > 0;
}

// === Notes (attributed: recipe_notes, store_notes) ===========================

/** A note surfaced in a group read, carrying its author + privacy. */
export interface AttributedNote {
  author: string;
  created_at: string;
  body: string;
  tags: string[];
  private: boolean;
}

/** A note as the caller owns it (used by update/remove, addressed by created_at). */
export interface OwnedNote extends AttributedNote {
  id: string;
}

type NoteTable = "recipe_notes" | "store_notes";
const noteSubjectCol = (table: NoteTable): "recipe" | "store" =>
  table === "recipe_notes" ? "recipe" : "store";

function attributedNoteOf(r: {
  author: string;
  created_at: string | null;
  body: string;
  tags: string | null;
  private: number | null;
}): AttributedNote {
  return {
    author: r.author,
    created_at: r.created_at ?? "",
    body: r.body,
    tags: parseJsonArray(r.tags),
    private: r.private === 1,
  };
}

/**
 * Read a subject's group notes with the privacy rule applied: the caller's own
 * private notes plus everyone's shared notes (private=0 OR author=caller). Ordered
 * by created_at (author as tiebreak) for determinism.
 */
async function readNotes(
  env: Env,
  table: NoteTable,
  subject: string,
  caller: string,
): Promise<AttributedNote[]> {
  const col = noteSubjectCol(table);
  const rows = await db(env).all<{
    author: string;
    created_at: string | null;
    body: string;
    tags: string | null;
    private: number | null;
  }>(
    `SELECT author, body, tags, private, created_at FROM ${table} ` +
      `WHERE ${col} = ?1 AND (private = 0 OR author = ?2)`,
    subject,
    caller,
  );
  const notes = rows.map(attributedNoteOf);
  notes.sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.author < b.author ? -1 : 1,
  );
  return notes;
}

export const readRecipeNotes = (env: Env, recipe: string, caller: string) =>
  readNotes(env, "recipe_notes", recipe, caller);
export const readStoreNotes = (env: Env, store: string, caller: string) =>
  readNotes(env, "store_notes", store, caller);

/** Insert an attributed note; returns its id (the addressing key for update/remove). */
async function insertNote(
  env: Env,
  table: NoteTable,
  subject: string,
  author: string,
  note: { created_at: string; body: string; tags: string[]; private: boolean },
): Promise<string> {
  const col = noteSubjectCol(table);
  const id = `${author} ${subject} ${note.created_at}`;
  await db(env).run(
    `INSERT INTO ${table} (id, ${col}, author, body, tags, private, created_at) ` +
      "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    id,
    subject,
    author,
    note.body,
    JSON.stringify(note.tags),
    note.private ? 1 : 0,
    note.created_at,
  );
  return id;
}

export const insertRecipeNote = (
  env: Env,
  recipe: string,
  author: string,
  note: { created_at: string; body: string; tags: string[]; private: boolean },
) => insertNote(env, "recipe_notes", recipe, author, note);
export const insertStoreNote = (
  env: Env,
  store: string,
  author: string,
  note: { created_at: string; body: string; tags: string[]; private: boolean },
) => insertNote(env, "store_notes", store, author, note);

/**
 * Find the caller's OWN note on a subject by created_at (self-scoped — only the
 * caller's rows are queryable here, mirroring the structural self-scoping of the old
 * per-tenant note files). Returns null when none matches.
 */
async function findOwnNote(
  env: Env,
  table: NoteTable,
  subject: string,
  author: string,
  createdAt: string,
): Promise<OwnedNote | null> {
  const col = noteSubjectCol(table);
  const row = await db(env).first<{
    id: string;
    author: string;
    created_at: string | null;
    body: string;
    tags: string | null;
    private: number | null;
  }>(
    `SELECT id, author, body, tags, private, created_at FROM ${table} ` +
      `WHERE ${col} = ?1 AND author = ?2 AND created_at = ?3`,
    subject,
    author,
    createdAt,
  );
  if (!row) return null;
  return { id: row.id, ...attributedNoteOf(row) };
}

/** Patch fields on the caller's own note (by created_at). Returns false when no match. */
async function updateOwnNote(
  env: Env,
  table: NoteTable,
  subject: string,
  author: string,
  createdAt: string,
  patch: { body?: string; tags?: string[]; private?: boolean },
): Promise<boolean> {
  const existing = await findOwnNote(env, table, subject, author, createdAt);
  if (!existing) return false;
  const body = patch.body ?? existing.body;
  const tags = patch.tags ?? existing.tags;
  const priv = patch.private ?? existing.private;
  await db(env).run(
    `UPDATE ${table} SET body = ?1, tags = ?2, private = ?3 WHERE id = ?4`,
    body,
    JSON.stringify(tags),
    priv ? 1 : 0,
    existing.id,
  );
  return true;
}

/** Delete the caller's own note (by created_at). Returns false when no match. */
async function removeOwnNote(
  env: Env,
  table: NoteTable,
  subject: string,
  author: string,
  createdAt: string,
): Promise<boolean> {
  const existing = await findOwnNote(env, table, subject, author, createdAt);
  if (!existing) return false;
  await db(env).run(`DELETE FROM ${table} WHERE id = ?1`, existing.id);
  return true;
}

export const updateRecipeNote = (
  env: Env,
  recipe: string,
  author: string,
  createdAt: string,
  patch: { body?: string; tags?: string[]; private?: boolean },
) => updateOwnNote(env, "recipe_notes", recipe, author, createdAt, patch);
export const removeRecipeNote = (env: Env, recipe: string, author: string, createdAt: string) =>
  removeOwnNote(env, "recipe_notes", recipe, author, createdAt);
export const updateStoreNote = (
  env: Env,
  store: string,
  author: string,
  createdAt: string,
  patch: { body?: string; tags?: string[]; private?: boolean },
) => updateOwnNote(env, "store_notes", store, author, createdAt, patch);
export const removeStoreNote = (env: Env, store: string, author: string, createdAt: string) =>
  removeOwnNote(env, "store_notes", store, author, createdAt);
