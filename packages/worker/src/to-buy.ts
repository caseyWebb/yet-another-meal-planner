// The DERIVED to-buy view (member-app-grocery D1/D3): the plan's ingredient needs are
// computed at read time — meal_plan rows × the projected `recipes.ingredients_full` —
// and composed with the UNCHANGED `computeToBuy` set algebra (active list ∪ plan needs
// − pantry on-hand, all on canonical ids). One shared operation behind the MCP
// `read_to_buy` tool and `GET /api/grocery/to-buy`, and the derivation half
// (`deriveMenuNeeds`) is what `place_order` and the satellite pull-list union in (D4),
// so EVERY flush surface sees the same set.
//
// Pure D1 work: no Workers AI call, no Kroger call, and NO writes — derived lines exist
// only in the read (materialization is an explicit member/agent add, never automatic).
// The ingredient context is loaded resolve-only (capture OFF): a read must not enqueue
// novel terms, and the derived need names are already current-resolver canonical ids.

import type { Env } from "./env.js";
import { computeToBuy, type MenuNeed } from "./order.js";
import { isFoodItem, normalizeName, storedGroceryKey, type GroceryItem } from "./grocery.js";
import { readGroceryList, readMealPlan, readPantryByKey, readPantryNames } from "./session-db.js";
import { recipeIngredientsFull } from "./recipe-index.js";
import {
  ingredientContext,
  emptyIngredientContext,
  readIdentityNeighbors,
  readSkuCache,
  type IngredientContext,
} from "./corpus-db.js";
import { readPreferences } from "./profile-db.js";
import { createKrogerClient } from "./kroger.js";
import { readStoreFlyer, filterByMinSavings, isSatelliteRollupStale, KROGER_STORE, type FlyerRollup } from "./flyer-warm.js";
import { loadOperatorConfig, DEFAULT_OPERATOR_CONFIG } from "./operator-config.js";
import type { KvStore } from "./kroger-user.js";
import { annotateSubstitutes } from "./substitute-annotator.js";
import { MIN_FLYER_DISCOUNT, type CachedMapping } from "./matching.js";
import type { ToBuyViewLine, PantryCoveredLine, InCartLine, LinePlacement, ToBuyView } from "./order-shapes.js";

// The view's line shapes live in the leaf order-shapes.ts (member-app-grocery D9 — the
// app imports them directly instead of hand-mirroring); re-exported so every existing
// importer is unchanged.
export type { ToBuyViewLine, PantryCoveredLine, InCartLine, ToBuyView } from "./order-shapes.js";

/** What the plan derives: presence-only needs (no quantities — the no-portion-math stance). */
export interface DerivedMenuNeeds {
  needs: MenuNeed[];
  /** Planned recipe slugs whose `ingredients_full` is not yet derived (no index row, or a
   *  NULL/empty facet) — reported, never silently under-listed. */
  underived: string[];
}

/**
 * Derive the meal plan's ingredient needs from the projected `ingredients_full` facets:
 * one `MenuNeed { name, for_recipes }` per canonical ingredient id, merged across the
 * planned recipes. Open-world `sides` strings contribute nothing — they have no recipe;
 * their ingredients remain the agent's explicit world-knowledge capture. Presence-only:
 * no quantities are derived.
 */
export async function deriveMenuNeeds(env: Env, tenant: string): Promise<DerivedMenuNeeds> {
  const planned = await readMealPlan(env, tenant);
  if (planned.length === 0) return { needs: [], underived: [] };

  const slugs = [...new Set(planned.map((p) => p.recipe))];
  const fullBySlug = await recipeIngredientsFull(env, slugs);

  const needsByName = new Map<string, MenuNeed>();
  const underived: string[] = [];
  for (const slug of slugs) {
    const list = fullBySlug.get(slug);
    if (!list || list.length === 0) {
      underived.push(slug);
      continue;
    }
    for (const name of list) {
      const need = needsByName.get(name) ?? { name, for_recipes: [] };
      if (!need.for_recipes!.includes(slug)) need.for_recipes!.push(slug);
      needsByName.set(name, need);
    }
  }
  return { needs: [...needsByName.values()], underived };
}

/**
 * Drop derived needs already IN FLIGHT: a need whose canonical id matches a stored
 * `in_cart`/`ordered` row is being bought by the current order — re-deriving it would
 * put the same ingredient back on to-buy and double-buy it on every subsequent flush
 * (the pre-derivation world never hit this: the materialized row advanced with the
 * order and no need was re-supplied). Applied by every composition site (the view,
 * `place_order`, the satellite pull-list) BEFORE `computeToBuy`, which itself stays
 * unchanged. Caller-supplied `menu_needs` are deliberately NOT suppressed — passing
 * one while its row is in flight re-bought it before this change too (the unchanged
 * baseline). The suppression clears organically: receiving removes the row (and the
 * pantry restock then covers the need), while a canceled order re-lists it `active`.
 */
export function dropInFlightNeeds(
  needs: MenuNeed[],
  list: GroceryItem[],
  resolve: (n: string) => string,
): MenuNeed[] {
  if (needs.length === 0) return needs;
  const inFlight = new Set(
    list
      .filter((it) => it.status !== "active")
      .map((it) => storedGroceryKey(it, resolve)),
  );
  if (inFlight.size === 0) return needs;
  return needs.filter((n) => !inFlight.has(resolve(n.name)));
}

/**
 * Compute the derived to-buy view: the same `computeToBuy` algebra `place_order` flushes
 * (derived plan needs included), post-partitioned by `key` against the stored rows into
 * `origin: list | plan | both`; `computeToBuy`'s `partials` become `pantry_covered`
 * (joined with the pantry rows' verify metadata — the same set `place_order` prompts on);
 * the stored `in_cart` rows ride along as the stale-cart signal. Writes nothing.
 *
 * `opts.enrich` (member-app-differentiators D6, generalized by inline-substitution-
 * hints D2) is OPT-IN enrichment: absent, the read is byte-identical to the plain view
 * and keeps its zero-Kroger guarantee absolute. Set, each line gains a `placement`
 * (captured aisle fields from the `sku_cache` row at (key, caller's location) with the
 * legacy `''` fallback, plus a `department` derived from the identity graph's parents)
 * AND `substitutes[]` (the shared annotator's identity-graph siblings, each carrying
 * `in_pantry` + `on_sale_hint` — inline-substitution-hints D1/D3), and the result
 * carries the resolved `location` plus `flyer_as_of` (D8). Cost: at most ONE Kroger
 * Locations resolve (label → locationId, exactly `kroger_flyer`'s posture) and ZERO
 * product searches; no resolvable Kroger location (non-Kroger primary, unresolvable
 * label) means placements carry `department` only, while `substitutes[].in_pantry`
 * (pure D1) and a satellite store's label-keyed `on_sale_hint` are still served.
 */
export async function computeToBuyView(
  env: Env,
  tenant: string,
  opts: { enrich?: boolean } = {},
): Promise<ToBuyView> {
  // Resolve-only context (capture OFF) — a read never enqueues; degrade to the empty
  // context (cleaned passthrough) rather than failing the view on a resolver-read blip.
  const [list, pantryByKey, ctx, derived] = await Promise.all([
    readGroceryList(env, tenant),
    readPantryByKey(env, tenant),
    ingredientContext(env, { capture: false }).catch(() => emptyIngredientContext(env)),
    deriveMenuNeeds(env, tenant),
  ]);
  const resolve = (n: string) => ctx.resolve(n);
  // An in-flight (in_cart/ordered) row suppresses its derived need — it is already
  // being bought; it reappears via the in_cart section, not as a to-buy line.
  const needs = dropInFlightNeeds(derived.needs, list, resolve);

  const { to_buy, partials } = computeToBuy({
    list,
    menuNeeds: needs,
    pantryNames: new Set(pantryByKey.keys()),
    resolve,
  });

  // Post-partition (computeToBuy itself is unchanged): a line whose key matches a stored
  // ACTIVE row is list-origin (or both, when the plan also needs it); no stored row = a
  // virtual plan line. Keys are the rows' STORED `normalized_name` (`storedGroceryKey`), so an
  // add-by-id row (whose `name` is a display) partitions on its id, not a re-derived display key.
  const storedByKey = new Map(
    list
      .filter((it) => it.status === "active")
      .map((it) => [storedGroceryKey(it, resolve), it] as const),
  );
  const planKeys = new Set(needs.map((n) => resolve(n.name)));

  const lines: ToBuyViewLine[] = to_buy.map((line) => {
    const stored = storedByKey.get(line.key);
    const inPlan = planKeys.has(line.key);
    return {
      name: line.name,
      quantity: line.quantity,
      assumed_quantity: line.assumed_quantity,
      for_recipes: line.for_recipes,
      origin: stored ? (inPlan ? "both" : "list") : "plan",
      key: line.key,
      // A derived (virtual) line is a recipe ingredient — food by construction.
      kind: stored?.kind ?? "grocery",
      domain: stored?.domain ?? "grocery",
      ...(stored?.note != null ? { note: stored.note } : {}),
    };
  });

  // pantry_covered ≙ place_order's `partials`, joined to the pantry rows' verify metadata.
  // The partial's merge key is reproducible from its name (a food key = resolve(name));
  // fall back to the plain normalizeName for the non-food edge.
  const pantry_covered: PantryCoveredLine[] = partials.map((p) => {
    const meta = pantryByKey.get(resolve(p.name)) ?? pantryByKey.get(normalizeName(p.name));
    return {
      name: p.name,
      for_recipes: p.for_recipes,
      on_hand: {
        ...(meta?.quantity != null ? { quantity: meta.quantity } : {}),
        ...(meta?.category != null ? { category: meta.category } : {}),
        ...(meta?.last_verified_at != null ? { last_verified_at: meta.last_verified_at } : {}),
      },
    };
  });

  const in_cart: InCartLine[] = list
    .filter((it) => it.status === "in_cart")
    .map((it) => ({ name: it.name, added_at: it.added_at }));

  const view: ToBuyView = { to_buy: lines, pantry_covered, in_cart, underived: derived.underived };
  if (!opts.enrich) return view; // the default read: byte-identical, zero Kroger
  return enrichView(env, tenant, view, ctx, storedByKey, list);
}

/** Precedence for the graph-derived department fallback (D6): membership parents are
 *  exactly department-shaped class labels (`vegetables`, `flour`), then general, then
 *  containment; lexicographic within a kind for determinism. */
const DEPARTMENT_KIND_ORDER = ["membership", "general", "containment"] as const;

/** The line's `sku_cache` row at the caller's location: exact tag first, `''` legacy next. */
function placementRow(cache: CachedMapping[], key: string, locationId: string | null): CachedMapping | null {
  if (locationId === null) return null;
  const rank = (m: CachedMapping): number => (m.locationId === locationId ? 0 : !m.locationId ? 1 : 2);
  const hits = cache.filter((m) => m.ingredient === key && rank(m) < 2).sort((a, b) => rank(a) - rank(b));
  return hits[0] ?? null;
}

/**
 * The enriched view over an already-computed plain view (member-app-differentiators
 * D6, generalized by inline-substitution-hints D2): one Locations resolve at most, one
 * `sku_cache` read, one identity-graph read (department fallback), shared with the
 * annotator (threaded in, not re-read), one flyer-rollup read, one pantry-names read —
 * zero product searches, no writes. Lines gain `placement` ({} fields optional;
 * null when nothing is known) AND `substitutes` (always an array — empty for a
 * no-edge line), the view gains the resolved `location` (null when none is resolvable)
 * and `flyer_as_of` (null when no rollup was used). Each line also gains the reified
 * `display_name` (reify-ingredient-display-names Move C) under ONE unified rule across every
 * line type: an explicit row-level `display_name` override wins; else an id-named line
 * (`name === key` — an add-by-id row, a legacy id-named row, or a `plan`-derived virtual line)
 * resolves the curated node label (or its deterministic synthesis) via `ctx.idLabel`, NEVER a
 * raw `::` id; else a typed row keeps the member's phrasing (`name`). The same rule reifies
 * `pantry_covered` and `in_cart` (an in_cart line is always a stored row, keyed on its stored
 * id). All display fields are enriched-only; the default read above returns before this and
 * stays byte-identical.
 */
async function enrichView(
  env: Env,
  tenant: string,
  view: ToBuyView,
  ctx: IngredientContext,
  storedByKey: Map<string, GroceryItem>,
  list: GroceryItem[],
): Promise<ToBuyView> {
  // Resolve the caller's primary fulfillment store + (Kroger only) its numeric
  // locationId — the ONE Locations call this whole enrichment pays. Only a Kroger
  // primary has a deterministic aisle-placement source; anything else degrades to the
  // graph department (non-Kroger layout stays agent territory — store notes). A
  // satellite store's label IS its own flyer-rollup locationId (`store_flyer`'s
  // posture), so `on_sale_hint` below still reaches a walk/satellite tenant.
  const prefs = await readPreferences(env, tenant).catch(() => null);
  const stores = prefs?.stores as Record<string, unknown> | undefined;
  const primary =
    typeof stores?.primary === "string" && stores.primary.trim() ? stores.primary.trim().toLowerCase() : KROGER_STORE;
  const label = typeof stores?.preferred_location === "string" ? stores.preferred_location : null;

  let locationId: string | null = null;
  if (primary === KROGER_STORE && label) {
    locationId = await createKrogerClient(env).resolveLocationId(label).catch(() => null);
  }

  // The primary store's warmed flyer rollup (inline-substitution-hints D3), resolved
  // + staleness-filtered HERE so `annotateSubstitutes` stays a pure join: a Kroger
  // primary keys on the resolved locationId; a satellite's label IS its rollup
  // locationId. Suppressed entirely past the operator's staleness ceiling
  // (`store_flyer`'s posture) rather than hinting off a stale sale — `flyer_as_of`
  // then reflects that nothing was actually used.
  const kv = env.KROGER_KV as unknown as KvStore;
  const flyerLocation = primary === KROGER_STORE ? locationId : label;
  let rollup: FlyerRollup | null = null;
  if (label && flyerLocation) {
    rollup = await readStoreFlyer(kv, primary, flyerLocation).catch(() => null);
  }
  if (rollup) {
    const operatorConfig = await loadOperatorConfig(env).catch(() => null);
    const stalenessDays = operatorConfig?.scanStalenessDays ?? DEFAULT_OPERATOR_CONFIG.scanStalenessDays;
    if (isSatelliteRollupStale(primary, rollup.as_of, stalenessDays)) rollup = null;
  }
  const saleItems = rollup ? filterByMinSavings(rollup.items, MIN_FLYER_DISCOUNT) : [];
  const flyer_as_of = rollup ? new Date(rollup.as_of).toISOString() : null;

  const keys = view.to_buy.map((l) => l.key);
  const [cache, neighborsByKey, pantry] = await Promise.all([
    locationId !== null ? readSkuCache(env) : Promise.resolve([] as CachedMapping[]),
    readIdentityNeighbors(env, keys),
    readPantryNames(env, tenant),
  ]);
  // The shared cheap-half annotator (inline-substitution-hints D1/D3): reuses the
  // identity-graph read above (same `keys` set) instead of a second batched read —
  // one identity-graph scan for the whole enriched view, not two.
  const substitutesByKey = await annotateSubstitutes(env, keys, { pantry, saleItems, ctx, neighborsByKey });

  const to_buy = view.to_buy.map((line) => {
    const placement: LinePlacement = {};
    const row = placementRow(cache, line.key, locationId);
    if (row?.aisle) {
      if (row.aisle.number) placement.aisle_number = row.aisle.number;
      if (row.aisle.description) placement.aisle_description = row.aisle.description;
      if (row.aisle.side !== undefined) placement.aisle_side = row.aisle.side;
    }
    // Graph-derived department fallback: the key's parents via out-edges,
    // representative-resolved, kind precedence then lexicographic tiebreak.
    const parents = neighborsByKey.get(line.key)?.satisfies ?? [];
    for (const kind of DEPARTMENT_KIND_ORDER) {
      const ofKind = parents
        .filter((p) => p.kind === kind)
        .sort((a, b) => a.id.localeCompare(b.id));
      if (ofKind.length > 0) {
        placement.department = ofKind[0].id;
        // The parent neighbor already carries a curated `labelOf` label — render it as the
        // department heading, keeping the raw id for grouping/keying (additive Tier 2).
        placement.department_label = ofKind[0].label;
        break;
      }
    }
    // The reified display (seam D), ONE unified rule across every line type: an explicit row-level
    // `display_name` override wins; else a FOOD id-named line (`name === key` — a legacy id-named row
    // or a plan-derived virtual line) resolves the curated node label (or its synthesis) via
    // `idLabel`, NEVER a raw `::` id; else the stored `name` (a typed/add-by-id display). The food
    // guard keeps a non-food row (whose `name === normalizeName(name)` can collide with a food id)
    // off the identity graph — a line with no backing row is a plan-derived need (food).
    const stored = storedByKey.get(line.key);
    const foodIdNamed = line.name === line.key && (stored ? isFoodItem(stored.kind, stored.domain) : true);
    const display_name = stored?.display_name ?? (foodIdNamed ? ctx.idLabel(line.key) : line.name);
    return {
      ...line,
      display_name,
      placement: Object.keys(placement).length > 0 ? placement : null,
      substitutes: substitutesByKey.get(line.key) ?? [],
    };
  });

  // Reify pantry_covered + in_cart with the SAME unified rule. A covered line's key is its resolved
  // name (food need); an active stored row that backs it supplies an override, else an id-named line
  // resolves via `idLabel`. An in_cart line is always a stored row — look it up in `list` by name
  // (in_cart rows are not in `storedByKey`, which holds only active rows) and key on its stored id.
  const pantry_covered = view.pantry_covered.map((line) => {
    const key = ctx.resolve(line.name);
    const stored = storedByKey.get(key);
    const foodIdNamed = line.name === key && (stored ? isFoodItem(stored.kind, stored.domain) : true);
    const display_name = stored?.display_name ?? (foodIdNamed ? ctx.idLabel(key) : line.name);
    return { ...line, display_name };
  });
  const inCartByName = new Map(list.filter((it) => it.status === "in_cart").map((it) => [it.name, it] as const));
  const in_cart = view.in_cart.map((line) => {
    const stored = inCartByName.get(line.name);
    const key = stored?.normalized_name ?? ctx.resolve(line.name);
    const foodIdNamed = line.name === key && (stored ? isFoodItem(stored.kind, stored.domain) : true);
    const display_name = stored?.display_name ?? (foodIdNamed ? ctx.idLabel(key) : line.name);
    return { ...line, display_name };
  });

  return {
    ...view,
    to_buy,
    pantry_covered,
    in_cart,
    location: locationId !== null ? { id: locationId } : null,
    flyer_as_of,
  };
}
