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
  /** Surviving canonical id → curated human display label (only for ids that store one). */
  displayNames: Record<string, string>;
}

/** Build a union-find resolver over the identity rows: id → surviving id (cycle-safe). */
export function representativeResolver(
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
    d.all<{ id: string; representative: string | null; search_term: string | null; display_name: string | null }>(
      "SELECT id, representative, search_term, display_name FROM ingredient_identity",
    ),
    d.all<{ variant: string; id: string }>("SELECT variant, id FROM ingredient_alias"),
  ]);
  const resolve = representativeResolver(identities);
  const ids = new Set<string>();
  const searchTerms: Record<string, string> = {};
  const displayNames: Record<string, string> = {};
  for (const r of identities) {
    const surv = resolve(r.id);
    ids.add(surv);
    // Prefer the survivor's own search_term; else let a merged member's fill in.
    if (r.search_term && (r.id === surv || !(surv in searchTerms))) searchTerms[surv] = r.search_term;
    // Same precedence for the curated display label (survivor's own wins; else a merged member's).
    if (r.display_name && (r.id === surv || !(surv in displayNames))) displayNames[surv] = r.display_name;
  }
  const toId: Record<string, string> = {};
  for (const { variant, id } of aliases) toId[variant] = resolve(id);
  return { toId, ids, searchTerms, displayNames };
}

/** Read the shared ingredient-alias map (variant → surviving canonical id). Empty when none. */
export async function readAliases(env: Env): Promise<Record<string, string>> {
  return (await readResolver(env)).toId;
}

/**
 * The identity category memo, resolved for the given stored keys (pantry `normalized_name`s /
 * waste-event `item_id`s): key → the identity funnel's category (`ingredient_identity.category`
 * — the 14-value food taxonomy or `household`; design D6). Resolution follows the funnel —
 * key as an identity id (else an alias variant) → representative-resolved survivor → category,
 * with the survivor's own value preferred and a merged member's filling in (the `search_term`/
 * `display_name` precedence). One wholesale batched read (like `readResolver`); keys with no
 * memo are simply absent from the map (NULL = pending, converged by the `ingredient-category`
 * cron). This is the ONE deterministic item→department derivation source (D17) — the pantry
 * autofill, the waste-event stamp, and the sibling spend capture all read through here.
 */
export async function readIngredientCategoryMemo(env: Env, keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (keys.length === 0) return out;
  const d = db(env);
  const [identities, aliases] = await Promise.all([
    d.all<{ id: string; representative: string | null; category: string | null }>(
      "SELECT id, representative, category FROM ingredient_identity",
    ),
    d.all<{ variant: string; id: string }>("SELECT variant, id FROM ingredient_alias"),
  ]);
  const resolve = representativeResolver(identities);
  const ids = new Set(identities.map((r) => r.id));
  const aliasTo = new Map(aliases.map((a) => [a.variant, a.id]));
  const categories: Record<string, string> = {};
  for (const r of identities) {
    const surv = resolve(r.id);
    if (r.category && (r.id === surv || !(surv in categories))) categories[surv] = r.category;
  }
  for (const key of keys) {
    const id = ids.has(key) ? key : (aliasTo.get(key) ?? key);
    const category = categories[resolve(id)];
    if (category) out.set(key, category);
  }
  return out;
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

/** The taste-substitution edge kind (D6/D7): a swap a member actually made whose replacement
 *  crosses a canonical-id boundary that is not already an identity neighbor. It is NOT a factual
 *  satisfies kind (`general`/`containment`/`membership`) — "A can stand in for B, with caveats" is
 *  a taste judgment, not "having A satisfies a request for B" — so it is EXCLUDED from `satisfies()`
 *  reachability (never gates a match, never causes a purchase) and surfaces only as a labeled
 *  read-time suggestion via the depth-1 walk. */
export const SUBSTITUTION_KIND = "substitution";
/** Observation-count threshold a candidate `substitution` edge reaches to PROMOTE — the read
 *  surfaces only promoted edges. An edge is born at weight 1 (candidate) and a single repeat
 *  observation (weight 2) promotes it, mirroring the capture pass's conservative candidate→confirm
 *  discipline (`NORMALIZE_CONFIRM_MIN`). */
export const SUBSTITUTION_PROMOTE_MIN = 2;

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
   * The RAW curated display label for an id (stored `display_name`), or `undefined` when the node
   * stores none — NO `labelOf`/base synthesis fallback (that is a RENDERED-label concern). The row
   * plane copies this onto an add-by-id row so the row renders the curated name while keying on the
   * id; a caller that wants a guaranteed string falls back to `base`/`labelOf` synthesis itself.
   */
  displayName(id: string): string | undefined;
  /**
   * The RENDERED human label for an id: the curated `display_name` when the node stores one, else a
   * deterministic synthesis (`base (detail)` / `base`) — NEVER a raw `::` id. This is `labelOf`
   * exposed at the context level, the read-time face of `displayName` (which returns the raw stored
   * value or `undefined`). Read surfaces rendering a bare id (an add-by-id / legacy id-named row, a
   * plan-derived line) resolve the label through this; keys/joins never do.
   */
  idLabel(id: string): string;
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
 * Pass `{ capture: false }` for a resolve-only context over the live resolver, for a caller
 * that batches its own enqueue (the recipe-index projection flushes once per pass).
 */
export async function ingredientContext(env: Env, opts?: { capture: boolean }): Promise<IngredientContext> {
  return contextFromResolver(env, await readResolver(env), opts);
}

/** An empty (no-alias) context — the graceful-degradation fallback when a resolver read fails
 *  in a non-critical path: normalization degrades to lowercase/strip and capture is DISABLED
 *  (a read failure must not flood the novel-term queue with un-resolved surface forms). It
 *  reads no D1, so it never throws. */
export function emptyIngredientContext(env: Env): IngredientContext {
  return contextFromResolver(env, { toId: {}, ids: new Set(), searchTerms: {}, displayNames: {} }, { capture: false });
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
          // Substitution edges are EXCLUDED from satisfies() reachability (D7): a substitute is a
          // taste judgment, not identity, so it must never complete a match or cause a purchase.
          edges: edges
            .filter((e) => e.kind !== SUBSTITUTION_KIND)
            .map((e) => ({ from: resolve(e.from_id), to: resolve(e.to_id), kind: e.kind })),
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
    displayName(id: string): string | undefined {
      return resolver.displayNames[id];
    },
    idLabel(id: string): string {
      const stored = resolver.displayNames[id];
      if (stored) return stored;
      // No curated label → the deterministic synthesis (`labelOf`'s fallback): base (detail) / base,
      // never the raw `::` id.
      const base = baseOf(id);
      const detail = id.includes("::") ? id.slice(base.length + 2) : null;
      return detail ? `${base} (${detail})` : base;
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

// --- identity-graph depth-1 neighbors (member-app-differentiators D3) ----------
// The substitution walk's raw material, read the same way `satisfiesAmong` reads the
// graph: load the identities+edges pair once, resolve EVERY endpoint through the
// representative pointer, compute in JS. This returns the three depth-1 neighbor
// sets per queried id — in-edges (what satisfies it), out-edges (what it satisfies,
// with kinds), and shared-parent co-children (same kind on both edges) — for the
// pure walk (`identitySiblings`, src/substitutions.ts) to order, label, and cap.

/** One depth-1 neighbor: a resolved endpoint with the relation's edge kind. */
export interface IdentityNeighbor {
  /** The neighbor's surviving canonical id. */
  id: string;
  /** Human-readable label from the identity row (`base (detail)`), else the id. */
  label: string;
  kind: string;
  /** Whether the neighbor is a concrete (buyable) node; absent rows default concrete. */
  concrete: boolean;
  /** The shared parent, for co-children only. */
  via?: string;
}

/** One promoted `substitution` target of a queried id (D6/D7): a taste substitute the graph
 *  observed, NOT an identity relation. Depth-1 — surfaced as a labeled read-time suggestion, never
 *  a satisfies neighbor. NOT pre-filtered by concreteness: `neighbors.substitutions` may carry a
 *  non-concrete (non-buyable) target, so any non-annotator consumer must filter on `concrete`
 *  itself (the substitute annotator does). */
export interface SubstitutionNeighbor {
  /** The substitution target's surviving canonical id. */
  id: string;
  /** Human-readable label (`base (detail)`), else the id. */
  label: string;
  /** Whether the target is a concrete (buyable) node; absent rows default concrete. */
  concrete: boolean;
  /** Accrued observation weight (≥ `SUBSTITUTION_PROMOTE_MIN` for a surfaced edge). */
  weight: number;
  /** Optional authored caveat (a sub ratio like `1:2`, a leavening/cook-time note), when present. */
  qualifier?: string;
}

/** The depth-1 neighbor sets of one queried id (all endpoints representative-resolved). */
export interface IdentityNeighbors {
  /** The queried id's surviving canonical id. */
  id: string;
  /** In-edges (`from → id`): nodes the graph declares usable where this id is requested. */
  satisfiedBy: IdentityNeighbor[];
  /** Out-edges (`id → to`): the nodes this id itself satisfies (its parents). */
  satisfies: IdentityNeighbor[];
  /** Co-children sharing one parent through SAME-kind edges (`via` = the parent). */
  coChildren: IdentityNeighbor[];
  /** Outgoing PROMOTED `substitution`-kind targets (`id → to`, weight ≥ promote threshold),
   *  each carrying its weight + optional qualifier. Kept SEPARATE from the factual sets so a
   *  substitute never enters `satisfies()` reachability; the walk surfaces it after all factual
   *  relations. Empty when the id has no promoted substitution edge. */
  substitutions: SubstitutionNeighbor[];
}

/**
 * Read the depth-1 identity-graph neighbors for a set of ids. Loads the identity and
 * edge tables once per call (the `satisfiesAmong` posture — 100s of rows, trivially
 * in-memory); every endpoint is resolved through the representative chain first and
 * self-loops produced by resolution are dropped, so a merged-away id can never be
 * suggested. The returned map is keyed by the RAW queried id.
 */
export async function readIdentityNeighbors(env: Env, ids: string[]): Promise<Map<string, IdentityNeighbors>> {
  const d = db(env);
  const [identities, edges] = await Promise.all([
    d.all<{ id: string; base: string | null; detail: string | null; representative: string | null; concrete: number | null; display_name: string | null }>(
      "SELECT id, base, detail, representative, concrete, display_name FROM ingredient_identity",
    ),
    d.all<{ from_id: string; to_id: string; kind: string; weight: number | null; qualifier: string | null }>(
      "SELECT from_id, to_id, kind, weight, qualifier FROM ingredient_edge",
    ),
  ]);
  const resolve = representativeResolver(identities);
  const rowOf = new Map(identities.map((r) => [r.id, r] as const));
  // The RAW curated display label (stored `display_name`), or undefined — no synthesis (mirrors
  // `IngredientContext.displayName`); `labelOf` layers the synthesis fallback on top.
  const displayName = (id: string): string | undefined => rowOf.get(id)?.display_name ?? undefined;
  const synthLabel = (id: string): string => {
    const r = rowOf.get(id);
    if (!r || !r.base) return id;
    return r.detail ? `${r.base} (${r.detail})` : r.base;
  };
  const labelOf = (id: string): string => displayName(id) ?? synthLabel(id);
  const concreteOf = (id: string): boolean => (rowOf.get(id)?.concrete ?? 1) !== 0;

  // Resolve + dedup the edge list once; a post-resolution self-loop carries no relation.
  // Substitution edges are held SEPARATELY (D6/D7): NEVER folded into the factual neighbor sets
  // (satisfiedBy/satisfies/coChildren), collected only as PROMOTED (weight ≥ threshold) OUTGOING
  // targets so a substitute surfaces as a labeled read-time suggestion, never as identity.
  const seen = new Set<string>();
  const resolved: { from: string; to: string; kind: string }[] = [];
  const subByPair = new Map<string, SubstitutionNeighbor>(); // resolved from+to → the merged sub target
  const subByFrom = new Map<string, SubstitutionNeighbor[]>(); // resolved from-id → its promoted subs
  for (const e of edges) {
    const from = resolve(e.from_id);
    const to = resolve(e.to_id);
    if (from === to) continue;
    if (e.kind === SUBSTITUTION_KIND) {
      const weight = e.weight ?? 1;
      if (weight < SUBSTITUTION_PROMOTE_MIN) continue; // only promoted edges surface
      const qualifier = e.qualifier ?? undefined;
      const pairKey = `${from}\u0000${to}`;
      const prior = subByPair.get(pairKey);
      if (prior) {
        // Two rows resolving to the same pair (a merged endpoint): keep the strongest observation
        // and the first authored qualifier. The object is shared with `subByFrom`, so both update.
        prior.weight = Math.max(prior.weight, weight);
        if (!prior.qualifier && qualifier) prior.qualifier = qualifier;
        continue;
      }
      const sub: SubstitutionNeighbor = {
        id: to,
        label: labelOf(to),
        concrete: concreteOf(to),
        weight,
        ...(qualifier ? { qualifier } : {}),
      };
      subByPair.set(pairKey, sub);
      const list = subByFrom.get(from);
      if (list) list.push(sub);
      else subByFrom.set(from, [sub]);
      continue;
    }
    const key = `${from}\u0000${to}\u0000${e.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push({ from, to, kind: e.kind });
  }

  const neighbor = (id: string, kind: string, via?: string): IdentityNeighbor => ({
    id,
    label: labelOf(id),
    kind,
    concrete: concreteOf(id),
    ...(via !== undefined ? { via } : {}),
  });

  const out = new Map<string, IdentityNeighbors>();
  for (const raw of ids) {
    if (out.has(raw)) continue;
    const x = resolve(raw);
    const satisfiedBy: IdentityNeighbor[] = [];
    const satisfies: IdentityNeighbor[] = [];
    const coChildren: IdentityNeighbor[] = [];
    const coSeen = new Set<string>();
    for (const e of resolved) {
      if (e.to === x) satisfiedBy.push(neighbor(e.from, e.kind));
      if (e.from === x) {
        satisfies.push(neighbor(e.to, e.kind));
        // Co-children of this parent through the SAME kind (two edges through one parent).
        for (const f of resolved) {
          if (f.to !== e.to || f.kind !== e.kind || f.from === x) continue;
          const key = `${f.from}\u0000${f.kind}\u0000${e.to}`;
          if (coSeen.has(key)) continue;
          coSeen.add(key);
          coChildren.push(neighbor(f.from, f.kind, e.to));
        }
      }
    }
    // A sibling reachable through two same-kind parents is pushed once per parent
    // (each carrying a different `via`); sort by (id, via) so the tie the downstream
    // first-relation-wins dedup (`identitySiblings`) resolves is stable rather than
    // dependent on the edge table's scan order.
    coChildren.sort((a, b) => {
      if (a.id !== b.id) return a.id < b.id ? -1 : 1;
      const av = a.via ?? "";
      const bv = b.via ?? "";
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    // x's own outgoing promoted substitution targets — depth-1 only (never followed
    // transitively), lexicographically ordered so the downstream walk's tie is stable.
    const substitutions = (subByFrom.get(x) ?? [])
      .slice()
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    out.set(raw, { id: x, satisfiedBy, satisfies, coChildren, substitutions });
  }
  return out;
}

/**
 * Capture-first taste-substitution edge write (D6/D7) — the DETERMINISTIC, agent-side capture
 * trigger. Called when a member ACCEPTS a purchasable swap: an `add_to_grocery_list` annotated with
 * `substitutes_for` (the recipe ingredient the added item stands in for). `wantedTerm` is the
 * replaced ingredient X (`substitutes_for`); `addedTerm` is the added item Y. Both resolve through
 * the SAME `IngredientContext` funnel the add used, then — by PURE SET LOGIC against the identity
 * graph, no classifier — a candidate `substitution` edge X → Y is recorded ONLY when Y crosses a
 * canonical-id boundary that is not already an identity relation: X and Y resolve to DISTINCT
 * survivors AND Y is not a factual neighbor of X (`satisfiedBy` ∪ `satisfies` ∪ `coChildren`, all
 * representative-resolved — the exact neighbor sets `readIdentityNeighbors` returns). A same-id or
 * already-neighbor swap is a product/price swap, not a taste substitution, and mints nothing.
 *
 * The edge is operator-global like the rest of the identity graph, so observations from different
 * members accrue to one edge: it is born a weight-1 CANDIDATE and its `weight` increments on each
 * repeat (`ON CONFLICT … weight = weight + 1`), promoting at `SUBSTITUTION_PROMOTE_MIN` — at which
 * point the depth-1 walk surfaces it. A single idiosyncratic swap stays an unsurfaced weight-1
 * candidate until a second observation promotes it, mirroring the capture pass's candidate→confirm
 * discipline. BEST-EFFORT: every failure (resolution, read, or write) is swallowed, so a capture
 * miss can NEVER fail the grocery add it rides alongside.
 */
export async function captureSubstitution(
  env: Env,
  ctx: IngredientContext,
  wantedTerm: string,
  addedTerm: string,
): Promise<void> {
  try {
    const x0 = ctx.resolve(wantedTerm);
    const y0 = ctx.resolve(addedTerm);
    if (!x0 || !y0 || x0 === y0) return; // empty or trivially identical — nothing to capture
    // One read gives BOTH the survivor ids AND X's factual neighbor sets (representative-resolved).
    const neighbors = await readIdentityNeighbors(env, [x0, y0]);
    const nx = neighbors.get(x0);
    const ny = neighbors.get(y0);
    const sx = nx ? nx.id : x0;
    const sy = ny ? ny.id : y0;
    if (sx === sy) return; // same surviving identity — a product/price swap, not a taste sub
    // Pure set logic: Y already an identity neighbor of X (synonym / containment / membership
    // sibling) → the graph already relates them, so this is identity, not a taste substitution.
    if (nx && [...nx.satisfiedBy, ...nx.satisfies, ...nx.coChildren].some((n) => n.id === sy)) return;
    // Upsert the candidate substitution edge X → Y: born weight 1, +1 per repeat observation
    // (candidate → promoted at SUBSTITUTION_PROMOTE_MIN). audited_at is left NULL — substitution
    // edges are EXCLUDED (by kind) from the edge-audit reads, so they are never selected or deleted.
    await db(env).run(
      "INSERT INTO ingredient_edge (from_id, to_id, kind, source, decided_at, weight) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, 1) " +
        "ON CONFLICT(from_id, to_id, kind) DO UPDATE SET weight = ingredient_edge.weight + 1",
      sx,
      sy,
      SUBSTITUTION_KIND,
      "auto",
      Date.now(),
    );
  } catch (err) {
    // Best-effort: a capture failure MUST NOT fail the grocery add it rides alongside.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[corpus-db] substitution capture failed for "${wantedTerm}" → "${addedTerm}":`, msg);
  }
}

/**
 * Add alias mappings (variant → canonical id), upserting each by variant as a HUMAN edit
 * (source='human', which the auto capture pass never overwrites). Ensures the target id
 * exists as a base-level identity node. An optional per-entry `display_name` is written as the
 * node's curated human label, `source='human'`: it WINS on conflict (a human override always
 * takes, over an auto value or an earlier human one), while an absent one never clobbers an
 * existing label — `COALESCE(excluded.display_name, …)`. This is the "human wins" half of the
 * `display_name` precedence: the auto path (`commitResolution`, the reconcile backfill) only ever
 * fills a NULL, so it can never downgrade a value written here. Returns the count written. Empty
 * entries skipped. NOTE: the `update_aliases` tool wiring lives in `write-tools.ts` (out of this
 * scope) — that caller must thread the member-supplied label into `display_name` for it to persist.
 */
export async function addAliases(
  env: Env,
  mappings: { variant: string; canonical: string; display_name?: string }[],
): Promise<number> {
  const d = db(env);
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const { variant, canonical, display_name } of mappings) {
    const v = variant.trim().toLowerCase();
    const id = canonical.trim();
    if (!v || !id) continue;
    const label = typeof display_name === "string" && display_name.trim() ? display_name.trim() : null;
    stmts.push(
      d.prepare(
        "INSERT INTO ingredient_identity (id, base, detail, display_name, source, decided_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
          "ON CONFLICT(id) DO UPDATE SET source = excluded.source, " +
          "display_name = COALESCE(excluded.display_name, ingredient_identity.display_name)",
        id,
        baseOf(id),
        id.includes("::") ? id.slice(id.indexOf("::") + 2) : null,
        label,
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

/** Surviving identity nodes with NO stored `display_name` — the reconcile display-name backfill's
 *  per-tick batch, oldest decision first. Carries `base`/`detail` so the pass can synthesize a
 *  deterministic label. Mirrors `readEmbeddinglessIds` (survivors only; merged losers resolve to
 *  their survivor at read time and are never rendered directly). */
export async function readDisplayNamelessNodes(
  env: Env,
  limit: number,
): Promise<{ id: string; base: string; detail: string | null }[]> {
  return db(env).all<{ id: string; base: string; detail: string | null }>(
    "SELECT id, base, detail FROM ingredient_identity WHERE display_name IS NULL AND representative IS NULL " +
      "ORDER BY decided_at LIMIT ?1",
    limit,
  );
}

/** Store a backfilled `display_name` on an identity node (the reconcile display-name backfill's
 *  write). Guarded to rows STILL null so a concurrent human override (`addAliases`) landing between
 *  the batch read and this write is never clobbered — the auto path only ever fills a NULL. */
export async function writeIdentityDisplayName(env: Env, id: string, displayName: string): Promise<void> {
  await db(env).run(
    "UPDATE ingredient_identity SET display_name = ?2 WHERE id = ?1 AND display_name IS NULL",
    id,
    displayName,
  );
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
    // Substitution edges are excluded: they are NOT factual connectivity, so a node whose only
    // edge is a substitution one is still (correctly) edgeless for the re-confirm eligibility test.
    d.all<{ from_id: string; to_id: string }>(
      "SELECT from_id, to_id FROM ingredient_edge WHERE kind != 'substitution'",
    ),
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
    // Substitution edges are excluded: they are not satisfies-reachable, so they must never trip
    // the reverse-pair 2-cycle guard against a factual edge commit.
    d.all<{ from_id: string; to_id: string }>(
      "SELECT from_id, to_id FROM ingredient_edge WHERE kind != 'substitution'",
    ),
  ]);
  const resolve = representativeResolver(identities);
  const key = (from: string, to: string) => `${from}\u0000${to}`;
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
 * distinguish it. Edge inserts are born-audited (`audited_at` stamped) so the edge re-audit never
 * re-enters them.
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
        "INSERT OR IGNORE INTO ingredient_edge (from_id, to_id, kind, source, decided_at, audited_at) " +
          "VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        e.from,
        e.to,
        e.kind,
        "auto",
        now,
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
  outcome: "same" | "specialization" | "novel" | "merge" | "error" | "failed" | "edge_drop" | "edge_keep" | "edge_restore" | "reshape";
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
  /** Present when a NEW node is minted (specialization / novel); absent for SAME. `display_name` is
   *  the curated human label the classifier proposed — OPTIONAL (a no-LLM verbatim mint and the
   *  disjunction disposal leave it absent → NULL, and the reconcile backfill synthesizes one). */
  node?: { base: string; detail: string | null; search_term: string; display_name?: string | null; concrete: boolean; embedding: number[] };
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
 * alias, so the alias upsert is effectively an insert. Alias + edge writes are born-audited
 * (`audited_at` stamped) so the re-audit passes never re-enter post-hardening decisions.
 */
export async function commitResolution(env: Env, r: Resolution): Promise<void> {
  const d = db(env);
  const now = Date.now();
  const { kept, skipped } = await filterCommittableEdges(d, r.edges ?? []);
  const stmts: D1PreparedStatement[] = [];
  if (r.node) {
    stmts.push(
      d.prepare(
        "INSERT INTO ingredient_identity (id, base, detail, search_term, display_name, concrete, embedding, source, decided_at) " +
          "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) " +
          "ON CONFLICT(id) DO UPDATE SET embedding = excluded.embedding, " +
          "search_term = COALESCE(ingredient_identity.search_term, excluded.search_term), " +
          "display_name = COALESCE(ingredient_identity.display_name, excluded.display_name)",
        r.id,
        r.node.base,
        r.node.detail,
        r.node.search_term,
        r.node.display_name ?? null,
        r.node.concrete ? 1 : 0,
        JSON.stringify(r.node.embedding),
        "auto",
        now,
      ),
    );
  }
  stmts.push(
    d.prepare(
      "INSERT INTO ingredient_alias (variant, id, source, confidence, decided_at, audited_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) " +
        "ON CONFLICT(variant) DO UPDATE SET id = excluded.id, confidence = excluded.confidence, " +
        "decided_at = excluded.decided_at, audited_at = excluded.audited_at",
      r.term,
      r.id,
      "auto",
      r.confidence ?? null,
      now,
      now,
    ),
  );
  for (const e of kept) {
    stmts.push(
      d.prepare(
        "INSERT OR IGNORE INTO ingredient_edge (from_id, to_id, kind, source, decided_at, audited_at) " +
          "VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        e.from,
        e.to,
        e.kind,
        "auto",
        now,
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
 * embedder can't retrieve, by the re-confirm pass for a `same`-outcome synonym, and by the alias
 * audit's orphan cleanup. `loser`'s representative is set to `survivor`. `opts.isReconfirm` marks
 * the log row so a re-confirm merge is distinguishable from a capture-time one. Every pass
 * funnels through here, so this is the one choke point that guards the representative graph:
 * before writing, the SURVIVOR is resolved through the current chain — when it lands on the
 * loser (a concurrent/older merge already points the survivor's tree at it) or the two already
 * share a root, the write would close (or is redundant to) a representative cycle, so the merge
 * no-ops and logs the refusal (`detail {note:"merge_cycle_skip"}`) instead.
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
  const rows = await d.all<{ id: string; representative: string | null }>(
    "SELECT id, representative FROM ingredient_identity",
  );
  const resolve = representativeResolver(rows);
  if (resolve(survivor) === resolve(loser)) {
    // Covers both resolve(survivor) === loser (the direct cycle) and the transitive shared-root
    // case — writing loser→survivor would spin resolution or is already implied.
    await d.batch([
      logStmt(
        d,
        {
          term: loser,
          outcome: "merge",
          resolved_id: survivor,
          isReconfirm: opts.isReconfirm,
          detail: { note: "merge_cycle_skip" },
        },
        now,
      ),
    ]);
    return;
  }
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
  /** Whether each survivor is a concrete product (false = concept node) — the concept–concrete
   *  merge guard's input. Optional so pre-existing fixtures stay valid (absent = concrete). */
  aConcrete?: boolean;
  bConcrete?: boolean;
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
    d.all<{ id: string; representative: string | null; source: string | null; search_term: string | null; concrete: number | null }>(
      "SELECT id, representative, source, search_term, concrete FROM ingredient_identity",
    ),
    d.all<{ ingredient: string; sku: string }>("SELECT ingredient, sku FROM sku_cache"),
  ]);
  const resolve = representativeResolver(identities);
  const sourceOf = new Map(identities.map((r) => [r.id, normSource(r.source)] as const));
  const searchTermOf = new Map(identities.map((r) => [r.id, r.search_term] as const));
  const concreteOf = new Map(identities.map((r) => [r.id, r.concrete] as const));

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
        const key = `${a}\u0000${b}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push({
          a,
          b,
          sku,
          aSource: sourceOf.get(a) ?? "auto",
          bSource: sourceOf.get(b) ?? "auto",
          aConcrete: (concreteOf.get(a) ?? 1) !== 0,
          bConcrete: (concreteOf.get(b) ?? 1) !== 0,
          aTerm: searchTermOf.get(a) || a,
        });
        if (pairs.length >= limit) return pairs;
      }
    }
  }
  return pairs;
}

// --- re-audit-pass helpers (normalization-decision-reaudit; see src/ingredient-alias-audit.ts
// and src/ingredient-edge-audit.ts) ---

/** One auto alias mapping awaiting re-audit: the surface variant + its (pre-representative) id. */
export interface AliasAuditRow {
  variant: string;
  id: string;
}

/** A batch of alias mappings ELIGIBLE for re-audit — `source='auto' AND audited_at IS NULL`
 *  (the pre-hardening backlog; post-hardening writes are born-stamped) — oldest `decided_at`
 *  first, bounded by `limit`. Human mappings are never selected. */
export async function readAliasAuditBatch(env: Env, limit: number): Promise<AliasAuditRow[]> {
  return db(env).all<AliasAuditRow>(
    "SELECT variant, id FROM ingredient_alias WHERE source = 'auto' AND audited_at IS NULL " +
      "ORDER BY decided_at LIMIT ?1",
    limit,
  );
}

/** Stamp an alias mapping audited (the one-shot backlog filter; `audited_at` = `now`). */
export async function stampAliasAudited(env: Env, variant: string, now: number): Promise<void> {
  await db(env).run("UPDATE ingredient_alias SET audited_at = ?2 WHERE variant = ?1", variant, now);
}

/** One alias mapping with its ownership fields: `audited_at`/`source` decide whether the
 *  retarget reconcile may re-point the row (audited or human) or the alias re-audit still owns
 *  it (un-audited auto — its re-decision is the re-point). */
export interface AliasTargetRow {
  variant: string;
  id: string;
  source: "auto" | "human";
  audited_at: number | null;
}

/** EVERY alias mapping (variant → pre-representative id) — the alias audit's orphan-check
 *  reference set (an auto node with no remaining alias after a re-point is merged away) and
 *  the retarget reconcile's scan. */
export async function readAliasTargets(env: Env): Promise<AliasTargetRow[]> {
  const rows = await db(env).all<{ variant: string; id: string; source: string | null; audited_at: number | null }>(
    "SELECT variant, id, source, audited_at FROM ingredient_alias",
  );
  return rows.map((r) => ({ variant: r.variant, id: r.id, source: normSource(r.source), audited_at: r.audited_at ?? null }));
}

/** An identity row as the audit passes need it: representative resolution + human protection. */
export interface IdentitySourceRow {
  id: string;
  representative: string | null;
  source: "auto" | "human";
  /** 0 = concept node. Optional so pre-existing fixtures stay valid (absent = concrete). */
  concrete?: number | null;
}

/** Every identity row's id/representative/source (full-table + JS, the module's idiom). */
export async function readIdentitySources(env: Env): Promise<IdentitySourceRow[]> {
  const rows = await db(env).all<{ id: string; representative: string | null; source: string | null; concrete: number | null }>(
    "SELECT id, representative, source, concrete FROM ingredient_identity",
  );
  return rows.map((r) => ({ id: r.id, representative: r.representative, source: normSource(r.source), concrete: r.concrete }));
}

/** The concept-node id set (`concrete = 0`) — the re-confirm pass's merge guard (a `same`
 *  outcome never merges a concrete node into a concept survivor). */
export async function readConceptIds(env: Env): Promise<Set<string>> {
  const rows = await db(env).all<{ id: string }>("SELECT id FROM ingredient_identity WHERE concrete = 0");
  return new Set(rows.map((r) => r.id));
}

/** One directed edge under audit (its composite PK). */
export interface EdgeAuditRow {
  from_id: string;
  to_id: string;
  kind: string;
}

/** An edge row with its `source` — the reverse-pair lookup set (a human reverse wins a 2-cycle). */
export interface EdgeRow extends EdgeAuditRow {
  source: "auto" | "human";
  /** Audit stamp (NULL = un-audited backlog). Optional so pre-existing fixtures stay valid. */
  audited_at?: number | null;
}

/** A batch of edges ELIGIBLE for re-audit — `source='auto' AND audited_at IS NULL`, oldest
 *  `decided_at` first, bounded. Human edges are never selected. */
export async function readEdgeAuditBatch(env: Env, limit: number): Promise<EdgeAuditRow[]> {
  return db(env).all<EdgeAuditRow>(
    // `kind != 'substitution'`: substitution edges are NOT factual satisfies edges, so the edge
    // re-audit (which validates FROM→TO direction and DELETES edges that fail) must never select
    // one — a captured taste substitution is not a mis-directed satisfies edge to correct.
    "SELECT from_id, to_id, kind FROM ingredient_edge " +
      "WHERE source = 'auto' AND audited_at IS NULL AND kind != 'substitution' " +
      "ORDER BY decided_at LIMIT ?1",
    limit,
  );
}

/** The full edge table (with `source`) — the edge audit's reverse-pair lookup set. */
export async function readAllEdges(env: Env): Promise<EdgeRow[]> {
  const rows = await db(env).all<{ from_id: string; to_id: string; kind: string; source: string | null; audited_at: number | null }>(
    // Substitution edges are excluded: the edge audit's reverse-pair lookup could otherwise delete
    // one as a factual edge's 2-cycle loser. A substitution edge is never audit input OR output.
    "SELECT from_id, to_id, kind, source, audited_at FROM ingredient_edge WHERE kind != 'substitution'",
  );
  return rows.map((r) => ({ from_id: r.from_id, to_id: r.to_id, kind: r.kind, source: normSource(r.source), audited_at: r.audited_at }));
}

/** Delete one edge by its composite PK — the edge audit's correction write. Only ever pointed
 *  at auto edges (the audit never selects a human edge as its subject). */
export async function deleteIngredientEdge(env: Env, from: string, to: string, kind: string): Promise<void> {
  await db(env).run(
    "DELETE FROM ingredient_edge WHERE from_id = ?1 AND to_id = ?2 AND kind = ?3",
    from,
    to,
    kind,
  );
}

/** Stamp an edge audited (it survived the audit; never re-selected). */
export async function stampEdgeAudited(
  env: Env,
  from: string,
  to: string,
  kind: string,
  now: number,
): Promise<void> {
  await db(env).run(
    "UPDATE ingredient_edge SET audited_at = ?4 WHERE from_id = ?1 AND to_id = ?2 AND kind = ?3",
    from,
    to,
    kind,
    now,
  );
}

/** Append one standalone decision to the normalization audit log — the edge audit's log write
 *  (its corrections don't ride a resolution commit). Batched so a D1 failure surfaces as the
 *  same structured `storage_error` every other write here produces. */
export async function appendNormalizationLog(env: Env, entry: NormalizationLog): Promise<void> {
  const d = db(env);
  await d.batch([logStmt(d, entry, Date.now())]);
}


// --- audit-calibration helpers (normalization-audit-calibration; see src/ingredient-normalize.ts
// and src/ingredient-edge-audit.ts) ---

/** A remembered co-resolution rejection: the pair's SURVIVING ids at decision time, ordered a < b. */
export interface CoResolutionRejection {
  a: string;
  b: string;
  decided_at: number;
}

/** Every remembered co-resolution rejection (a small table; full read, the module's idiom). */
export async function readCoResolutionRejections(env: Env): Promise<CoResolutionRejection[]> {
  return db(env).all<CoResolutionRejection>("SELECT a, b, decided_at FROM ingredient_coresolution_rejection");
}

/** Remember (or refresh) a rejected co-resolution pair. `(a, b)` MUST already be ordered a < b
 *  over the pair's surviving ids — a later merge that changes a survivor changes the key, so a
 *  materially-changed graph re-opens the question by construction. */
export async function upsertCoResolutionRejection(env: Env, a: string, b: string, now: number): Promise<void> {
  await db(env).run(
    "INSERT INTO ingredient_coresolution_rejection (a, b, decided_at) VALUES (?1, ?2, ?3) " +
      "ON CONFLICT(a, b) DO UPDATE SET decided_at = excluded.decided_at",
    a,
    b,
    now,
  );
}

/**
 * Repair a segment-overflow node (an id deeper than `base::detail`) onto its 2-segment prefix —
 * the two shapes `mergeIdentities` cannot express (a plain merge goes through it directly):
 * `reroot` — the prefix currently resolves TO the overflow (an earlier orphan merge ran
 * child-ward), so the family is re-rooted: the prefix's representative is cleared and the
 * overflow's pointed at the prefix, one atomic batch (chain members that pointed through the
 * overflow keep resolving — they end at the overflow, which now points to the prefix);
 * `mint` — no prefix node exists, so it is minted (embedding NULL — the capture backfill embeds
 * it) and the overflow pointed at it. The repair is logged as a `merge` with a segment-overflow
 * marker.
 */
export async function repairSegmentOverflow(
  env: Env,
  plan: {
    overflow: string;
    prefix: string;
    shape: "reroot" | "mint";
    prefixNode?: { base: string; detail: string; search_term: string; display_name: string; concrete: boolean };
  },
): Promise<void> {
  const d = db(env);
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  if (plan.shape === "mint" && plan.prefixNode) {
    stmts.push(
      d.prepare(
        "INSERT OR IGNORE INTO ingredient_identity (id, base, detail, search_term, display_name, concrete, source, decided_at) " +
          "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        plan.prefix,
        plan.prefixNode.base,
        plan.prefixNode.detail,
        plan.prefixNode.search_term,
        plan.prefixNode.display_name,
        plan.prefixNode.concrete ? 1 : 0,
        "auto",
        now,
      ),
    );
  }
  if (plan.shape === "reroot") {
    stmts.push(d.prepare("UPDATE ingredient_identity SET representative = ?2 WHERE id = ?1", plan.prefix, null));
  }
  stmts.push(d.prepare("UPDATE ingredient_identity SET representative = ?2 WHERE id = ?1", plan.overflow, plan.prefix));
  stmts.push(
    logStmt(
      d,
      {
        term: plan.overflow,
        outcome: "merge",
        resolved_id: plan.prefix,
        detail:
          plan.shape === "reroot"
            ? { note: "segment_overflow", reroot: true }
            : { note: "segment_overflow", minted_prefix: true },
      },
      now,
    ),
  );
  await d.batch(stmts);
}

/**
 * One disjunctive family's shape repair (disjunctive-term-modeling): a disjunction "X or Y" is a
 * satisfaction constraint, so its node must be an ABSTRACT concept. `flip` turns a surviving
 * wrongly-concrete base abstract (member-phrase `search_term`, so the matcher never sends the
 * disjunctive phrase to Kroger); `children` folds surviving `base::detail` children into the base
 * via the representative pointer; `reroot` first clears the base's own representative (the
 * production serrano inversion — the base was merged INTO its child); `mintBase` inserts the base
 * abstract when it never existed (embedding NULL — the capture backfill embeds it).
 */
export interface DisjunctionRepairPlan {
  base: string;
  /** The member phrase (first disjunct) written as the base's `search_term`. */
  searchTerm: string;
  mintBase: boolean;
  reroot: boolean;
  flip: boolean;
  children: string[];
}

/** Apply one family's repair atomically: mint → reroot → flip → child folds, one D1 batch, with
 *  a `reshape` log row for the flip and a `merge` row per folded child. */
export async function applyDisjunctionRepair(env: Env, plan: DisjunctionRepairPlan): Promise<void> {
  const d = db(env);
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  if (plan.mintBase) {
    stmts.push(
      d.prepare(
        "INSERT OR IGNORE INTO ingredient_identity (id, base, search_term, display_name, concrete, source, decided_at) " +
          "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        plan.base,
        plan.base,
        plan.searchTerm,
        plan.searchTerm,
        0,
        "auto",
        now,
      ),
    );
  }
  if (plan.reroot) {
    stmts.push(d.prepare("UPDATE ingredient_identity SET representative = ?2 WHERE id = ?1", plan.base, null));
  }
  if (plan.flip) {
    stmts.push(
      d.prepare(
        "UPDATE ingredient_identity SET concrete = ?2, search_term = ?3 WHERE id = ?1",
        plan.base,
        0,
        plan.searchTerm,
      ),
    );
    stmts.push(
      logStmt(
        d,
        {
          term: plan.base,
          outcome: "reshape",
          resolved_id: plan.base,
          detail: { note: "disjunction_flip", search_term: plan.searchTerm, ...(plan.reroot ? { reroot: true } : {}) },
        },
        now,
      ),
    );
  }
  for (const child of plan.children) {
    stmts.push(d.prepare("UPDATE ingredient_identity SET representative = ?2 WHERE id = ?1", child, plan.base));
    stmts.push(
      logStmt(
        d,
        {
          term: child,
          outcome: "merge",
          resolved_id: plan.base,
          detail: { note: "disjunction_child_fold", ...(plan.mintBase ? { minted_base: true } : {}) },
        },
        now,
      ),
    );
  }
  if (stmts.length > 0) await d.batch(stmts);
}

/**
 * Insert a satisfies edge BORN-STAMPED (`audited_at` set — it never enters the audit backlog),
 * optionally minting a missing base endpoint (embedding NULL — the capture backfill embeds it).
 * Insert-or-ignore, so the structural guarantee and the edge-drop replay are idempotent. This
 * write deliberately bypasses the commit-time contradiction gate: the guarantee's edge is
 * definitionally valid, and the replay resolves a standing reverse itself (the pair re-decision).
 */
export async function insertAuditedEdge(
  env: Env,
  from: string,
  to: string,
  kind: string,
  opts: { mintBase?: { id: string } } = {},
): Promise<void> {
  const d = db(env);
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  if (opts.mintBase) {
    stmts.push(
      d.prepare(
        "INSERT OR IGNORE INTO ingredient_identity (id, base, search_term, concrete, source, decided_at) " +
          "VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        opts.mintBase.id,
        opts.mintBase.id,
        opts.mintBase.id,
        1,
        "auto",
        now,
      ),
    );
  }
  stmts.push(
    d.prepare(
      "INSERT OR IGNORE INTO ingredient_edge (from_id, to_id, kind, source, decided_at, audited_at) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      from,
      to,
      kind,
      "auto",
      now,
      now,
    ),
  );
  await d.batch(stmts);
}

/** An `edge_drop` log row awaiting replay, its detail JSON-parsed (null when absent/unparseable). */
export interface EdgeDropLogRow {
  id: number;
  term: string;
  detail: Record<string, unknown> | null;
}

/** The replay-pending predicate over a drop row's raw detail: the parsed detail object (null
 *  when absent/unparseable — un-marked; the replay marks it terminally), or `undefined` when
 *  the row already carries a `replayed_at` mark (a completed replay, or a born-marked
 *  post-calibration drop). The ONE definition the replay's selection and the admin gauge's
 *  bounded count share. */
function pendingReplayDetail(raw: string | null): Record<string, unknown> | null | undefined {
  let detail: Record<string, unknown> | null = null;
  if (typeof raw === "string" && raw) {
    try {
      const v = JSON.parse(raw) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) detail = v as Record<string, unknown>;
    } catch {
      detail = null;
    }
  }
  if (detail && detail.replayed_at !== undefined) return undefined;
  return detail;
}

/** Un-replayed `edge_drop` log rows, oldest first, bounded — replay-marked rows are skipped,
 *  so the replay drains its one-time backlog and quiesces. */
export async function readUnreplayedEdgeDrops(env: Env, limit: number): Promise<EdgeDropLogRow[]> {
  const rows = await db(env).all<{ id: number; term: string; detail: string | null }>(
    "SELECT id, term, detail FROM ingredient_normalization_log WHERE outcome = ?1 ORDER BY id",
    "edge_drop",
  );
  const out: EdgeDropLogRow[] = [];
  for (const r of rows) {
    const detail = pendingReplayDetail(r.detail);
    if (detail === undefined) continue;
    out.push({ id: r.id, term: r.term, detail });
    if (out.length >= limit) break;
  }
  return out;
}

/** The un-replayed backlog SIZE, bounded — the admin gauge's probe, never the replay's
 *  selection (that stays `readUnreplayedEdgeDrops`, unchanged). The SQL mirror of the replay
 *  mark (absent / unparseable / markless detail) narrows and LIMITs server-side so the render
 *  path never materializes the whole drop log; the shared JS predicate re-validates the
 *  survivors, so the count can only agree with the replay (the SQL over-selects at worst —
 *  e.g. a literal-null mark the replay never writes — and the JS layer drops it). */
export async function countUnreplayedEdgeDrops(env: Env, probe: number): Promise<number> {
  const rows = await db(env).all<{ detail: string | null }>(
    "SELECT detail FROM ingredient_normalization_log WHERE outcome = ?1 " +
      "AND (detail IS NULL OR NOT json_valid(detail) OR json_extract(detail, '$.replayed_at') IS NULL) " +
      "ORDER BY id LIMIT ?2",
    "edge_drop",
    probe,
  );
  let n = 0;
  for (const r of rows) if (pendingReplayDetail(r.detail) !== undefined) n++;
  return n;
}

/** Write a log row's replay-marked detail (the caller merges the mark into the row's existing
 *  detail — additive inside the row, so the original decision fields are preserved). */
export async function markEdgeDropReplayed(env: Env, id: number, detail: unknown): Promise<void> {
  await db(env).run("UPDATE ingredient_normalization_log SET detail = ?2 WHERE id = ?1", id, JSON.stringify(detail));
}

// === SKU cache ===============================================================

interface SkuRow {
  ingredient: string;
  location_id: string;
  sku: string;
  brand: string | null;
  size: string | null;
  aisle_number: string | null;
  aisle_description: string | null;
  aisle_side: string | null;
  aisle_captured_at: string | null;
  price_regular: number | null;
  price_promo: number | null;
  price_captured_at: string | null;
}

/**
 * Read the shared SKU cache as the matcher's CachedMapping[]. `location_id` '' (the
 * untagged backfill sentinel) reads as absent so the matcher's same-location
 * preference treats it as legacy/untagged. Aisle placement columns (D5) ride as an
 * optional `aisle` — the matcher ignores them; the order commit's identical-skip and
 * the to-buy aisle enrichment read them.
 */
export async function readSkuCache(env: Env): Promise<CachedMapping[]> {
  const rows = await db(env).all<SkuRow>(
    "SELECT ingredient, location_id, sku, brand, size, aisle_number, aisle_description, aisle_side, aisle_captured_at, price_regular, price_promo, price_captured_at FROM sku_cache",
  );
  return rows.map((r) => {
    const m: CachedMapping = { ingredient: r.ingredient, sku: r.sku };
    if (r.brand != null) m.brand = r.brand;
    if (r.size != null) m.size = r.size;
    if (r.location_id) m.locationId = r.location_id;
    if (r.aisle_number != null || r.aisle_description != null) {
      m.aisle = {
        number: r.aisle_number ?? "",
        description: r.aisle_description ?? "",
        ...(r.aisle_side != null ? { side: r.aisle_side } : {}),
      };
    }
    if (r.aisle_captured_at != null) m.aisleCapturedAt = r.aisle_captured_at;
    if (r.price_regular != null) m.priceRegular = r.price_regular;
    if (r.price_promo != null) m.pricePromo = r.price_promo;
    if (r.price_captured_at != null) m.priceCapturedAt = r.price_captured_at;
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
  /** Aisle placement columns (D5) — written together; `aisle_captured_at` is stamped
   *  by the caller only when placement data is present. */
  aisle_number?: string | null;
  aisle_description?: string | null;
  aisle_side?: string | null;
  aisle_captured_at?: string | null;
  price_regular?: number | null;
  price_promo?: number | null;
  price_captured_at?: string | null;
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
        "INSERT INTO sku_cache (ingredient, location_id, sku, brand, size, last_used, aisle_number, aisle_description, aisle_side, aisle_captured_at,price_regular,price_promo,price_captured_at) " +
          "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,?11,?12,?13) " +
          "ON CONFLICT(ingredient, location_id) DO UPDATE SET " +
          "sku = excluded.sku, brand = excluded.brand, size = excluded.size, last_used = excluded.last_used, " +
          "aisle_number = excluded.aisle_number, aisle_description = excluded.aisle_description, " +
          "aisle_side = excluded.aisle_side, aisle_captured_at = excluded.aisle_captured_at, " +
          "price_regular=excluded.price_regular,price_promo=excluded.price_promo,price_captured_at=excluded.price_captured_at",
        m.ingredient,
        m.locationId ?? "",
        m.sku,
        m.brand ?? null,
        m.size ?? null,
        m.last_used ?? null,
        m.aisle_number ?? null,
        m.aisle_description ?? null,
        m.aisle_side ?? null,
        m.aisle_captured_at ?? null,
        m.price_regular ?? null,
        m.price_promo ?? null,
        m.price_captured_at ?? null,
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
  updated_at?: string | null;
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
    updated_at: string | null;
    body: string;
    tags: string | null;
    private: number | null;
  }>(
    `SELECT author, body, tags, private, created_at${table === "store_notes" ? ", updated_at" : ", NULL AS updated_at"} FROM ${table} ` +
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
    `INSERT INTO ${table} (id, ${col}, author, body, tags, private, created_at${table === "store_notes" ? ", updated_at" : ""}) ` +
      `VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7${table === "store_notes" ? ", ?7" : ""})`,
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
    updated_at: string | null;
    body: string;
    tags: string | null;
    private: number | null;
  }>(
    `SELECT id, author, body, tags, private, created_at${table === "store_notes" ? ", updated_at" : ", NULL AS updated_at"} FROM ${table} ` +
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
    `UPDATE ${table} SET body = ?1, tags = ?2, private = ?3${table === "store_notes" ? ", updated_at = ?5" : ""} WHERE id = ?4`,
    body,
    JSON.stringify(tags),
    priv ? 1 : 0,
    existing.id,
    ...(table === "store_notes" ? [new Date().toISOString()] : []),
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
