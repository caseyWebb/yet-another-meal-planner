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
import { normalizeName, groceryKey, type GroceryKind } from "./grocery.js";
import { readGroceryList, readMealPlan, readPantryByKey } from "./session-db.js";
import { recipeIngredientsFull } from "./recipe-index.js";
import { ingredientContext, emptyIngredientContext } from "./corpus-db.js";

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

/** One to-buy line of the derived view: the order-time line + its provenance. */
export interface ToBuyViewLine {
  name: string;
  /** Package count the order would use; derived rows default to 1 (`assumed_quantity`). */
  quantity: number;
  assumed_quantity: boolean;
  for_recipes: string[];
  /** `list` = an explicit row the plan does not need; `plan` = a virtual (derived) line
   *  with no stored row; `both` = a stored row the plan also needs (a materialization). */
  origin: "list" | "plan" | "both";
  /** The canonical merge key — the `grocery_list.normalized_name` a materialization of
   *  this line upserts under (so stored row + derived need can never duplicate). */
  key: string;
  kind: GroceryKind;
  domain: string;
  note?: string | null;
}

/** A need the pantry cancels, joined with the pantry row's verify metadata. */
export interface PantryCoveredLine {
  name: string;
  for_recipes: string[];
  on_hand: { quantity?: string; category?: string; last_verified_at?: string };
}

/** A stored `in_cart` row — the deterministic stale-cart signal. */
export interface InCartLine {
  name: string;
  added_at: string;
}

/** The derived to-buy view (identical from the tool and the endpoint). */
export interface ToBuyView {
  to_buy: ToBuyViewLine[];
  pantry_covered: PantryCoveredLine[];
  in_cart: InCartLine[];
  underived: string[];
}

/**
 * Compute the derived to-buy view: the same `computeToBuy` algebra `place_order` flushes
 * (derived plan needs included), post-partitioned by `key` against the stored rows into
 * `origin: list | plan | both`; `computeToBuy`'s `partials` become `pantry_covered`
 * (joined with the pantry rows' verify metadata — the same set `place_order` prompts on);
 * the stored `in_cart` rows ride along as the stale-cart signal. Writes nothing.
 */
export async function computeToBuyView(env: Env, tenant: string): Promise<ToBuyView> {
  // Resolve-only context (capture OFF) — a read never enqueues; degrade to the empty
  // context (cleaned passthrough) rather than failing the view on a resolver-read blip.
  const [list, pantryByKey, ctx, derived] = await Promise.all([
    readGroceryList(env, tenant),
    readPantryByKey(env, tenant),
    ingredientContext(env, { capture: false }).catch(() => emptyIngredientContext(env)),
    deriveMenuNeeds(env, tenant),
  ]);
  const resolve = (n: string) => ctx.resolve(n);

  const { to_buy, partials } = computeToBuy({
    list,
    menuNeeds: derived.needs,
    pantryNames: new Set(pantryByKey.keys()),
    resolve,
  });

  // Post-partition (computeToBuy itself is unchanged): a line whose key matches a stored
  // ACTIVE row is list-origin (or both, when the plan also needs it); no stored row = a
  // virtual plan line. Keys are the rows' stored normalized_name (food-guarded groceryKey).
  const storedByKey = new Map(
    list
      .filter((it) => it.status === "active")
      .map((it) => [groceryKey(it.name, it.kind, it.domain, resolve), it] as const),
  );
  const planKeys = new Set(derived.needs.map((n) => resolve(n.name)));

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

  return { to_buy: lines, pantry_covered, in_cart, underived: derived.underived };
}
