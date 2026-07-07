// Pure grocery-list operations (grocery-list capability). No I/O — the tool
// wrappers supply the current items and today's date and persist the result, so
// the merge/update/remove logic is unit-testable in isolation.
//
// Items are keyed by NORMALIZED name: re-adding an existing name merges into the
// existing entry (union for_recipes, reconcile quantity) rather than duplicating.
// Resolution to a Kroger SKU is deferred to order time (Change 06b) — nothing
// here stores a SKU, and new items are always created `status: "active"`.

export type GroceryKind = "grocery" | "household" | "other";
export type GroceryStatus = "active" | "in_cart" | "ordered";
export type GrocerySource = "ad_hoc" | "menu" | "pantry_low" | "stockup";

export interface GroceryItem {
  name: string;
  quantity: string;
  kind: GroceryKind;
  /**
   * The kind of STORE this is bought at — a free string, default "grocery"
   * (common values grocery | home-improvement | garden | pharmacy). Orthogonal to
   * `kind`: `kind` governs pantry reconcile on receive; `domain` governs which
   * store-type an in-store walk includes the item in.
   */
  domain: string;
  status: GroceryStatus;
  source: GrocerySource;
  for_recipes: string[];
  note: string | null;
  added_at: string;
  ordered_at: string | null;
}

/** Input for adding an item; everything but `name` is optional with sensible defaults. */
export interface GroceryAddInput {
  name: string;
  quantity?: string;
  kind?: GroceryKind;
  domain?: string;
  source?: GrocerySource;
  for_recipes?: string[];
  note?: string | null;
}

/** Fields a caller may patch on an existing item. */
export interface GroceryUpdateInput {
  quantity?: string;
  kind?: GroceryKind;
  domain?: string;
  status?: GroceryStatus;
  source?: GrocerySource;
  for_recipes?: string[];
  note?: string | null;
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Whether a grocery row is a **food** item — the only rows routed through the ingredient
 * identity funnel (canonical-id dedup + capture). `household` / `other` kinds and non-grocery
 * domains (home-improvement, garden, pharmacy) stay on `normalizeName` and never enter the
 * identity graph, so it only ever ingests real food vocabulary. Both signals default to
 * `grocery` (the schema defaults), so an unqualified item is food. (Pantry has no kind/domain —
 * it is kitchen inventory, food by construction — so pantry callers do not consult this.)
 */
export function isFoodItem(kind?: string, domain?: string): boolean {
  return (kind ?? "grocery") === "grocery" && (domain ?? "grocery") === "grocery";
}

/**
 * The dedup / D1 `normalized_name` key for a grocery row: the canonical ingredient id
 * (`resolve` = normalize + capture) for a food row, else `normalizeName`. `resolve` is the
 * injected `IngredientContext.resolve`; it defaults to `normalizeName` so the pure ops and
 * their unit tests keep today's behavior when no resolver is threaded (production always
 * injects `ctx.resolve`).
 */
export function groceryKey(
  name: string,
  kind: string | undefined,
  domain: string | undefined,
  resolve: (n: string) => string = normalizeName,
): string {
  return isFoodItem(kind, domain) ? resolve(name) : normalizeName(name);
}

/**
 * Find an item matching `name`. A lookup-by-bare-name carries no kind/domain, so it
 * matches BOTH candidate keys: an item matches when its `groceryKey` (food → `resolve`,
 * non-food → `normalizeName`) equals `resolve(name)` OR `normalizeName(name)`. This finds
 * a food target across surface forms and a non-food target without knowing foodness upfront.
 * `resolve` defaults to `normalizeName`, so an un-threaded caller keeps today's behavior
 * (both candidate keys collapse to `normalizeName(name)`).
 */
function findIndex(items: GroceryItem[], name: string, resolve: (n: string) => string = normalizeName): number {
  const resolved = resolve(name);
  const plain = normalizeName(name);
  return items.findIndex((it) => {
    const key = groceryKey(it.name, it.kind, it.domain, resolve);
    return key === resolved || key === plain;
  });
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * The W3 status-transition guard (grocery-list capability), pure. `active ⇄ in_cart`
 * is freely writable in both directions — and so is re-listing an `ordered` row back
 * to `active`/`in_cart` (a canceled order is a legitimate member correction). Entering
 * `ordered` is legal ONLY from `in_cart`: that write is the user-asserted "I placed
 * the order" advance. Every other path into `ordered` (including re-asserting it on an
 * already-`ordered` row) is rejected — the order flow's own advances
 * (`advanceInCartRows` / `advanceOrderedRows`) are separate code paths and never come
 * through here. Returns the rejection reason, or null when the transition is legal.
 */
export function illegalStatusTransition(current: GroceryStatus, next: GroceryStatus): string | null {
  if (next === "ordered" && current !== "in_cart") {
    return (
      `cannot set status "ordered" on a "${current}" item — "ordered" is accepted only as the ` +
      `user-asserted advance from "in_cart" (order placed); move the item to "in_cart" first`
    );
  }
  return null;
}

/** Find an item matching `name` (the exported face of the dual-key lookup below). */
export function findGroceryItem(
  items: GroceryItem[],
  name: string,
  resolve: (n: string) => string = normalizeName,
): GroceryItem | undefined {
  const idx = findIndex(items, name, resolve);
  return idx >= 0 ? items[idx] : undefined;
}

export interface AddResult {
  items: GroceryItem[];
  item: GroceryItem;
  merged: boolean;
}

/**
 * Add an item, or merge into an existing same-name entry (union for_recipes;
 * take the new quantity/note/source when provided). Returns the next item list.
 */
export function addToGroceryList(
  items: GroceryItem[],
  input: GroceryAddInput,
  today: string,
  resolve: (n: string) => string = normalizeName,
): AddResult {
  const next = items.map((it) => ({ ...it, for_recipes: [...it.for_recipes] }));
  // The add's foodness is known from the input — a NON-food add must never touch the
  // capturing resolver (decision #5: non-food stays on normalizeName and never enters the
  // identity graph), so gate the injected resolver by the food guard before matching.
  const keyResolve = isFoodItem(input.kind, input.domain) ? resolve : normalizeName;
  const idx = findIndex(next, input.name, keyResolve);

  if (idx >= 0) {
    const existing = next[idx];
    const merged: GroceryItem = {
      ...existing,
      quantity: input.quantity ?? existing.quantity,
      kind: input.kind ?? existing.kind,
      domain: input.domain ?? existing.domain,
      source: input.source ?? existing.source,
      for_recipes: uniq([...existing.for_recipes, ...(input.for_recipes ?? [])]),
      note: input.note !== undefined ? input.note : existing.note,
    };
    next[idx] = merged;
    return { items: next, item: merged, merged: true };
  }

  const created: GroceryItem = {
    name: input.name.trim(),
    quantity: input.quantity ?? "1",
    kind: input.kind ?? "grocery",
    domain: input.domain ?? "grocery",
    status: "active",
    source: input.source ?? "ad_hoc",
    for_recipes: uniq(input.for_recipes ?? []),
    note: input.note ?? null,
    added_at: today,
    ordered_at: null,
  };
  next.push(created);
  return { items: next, item: created, merged: false };
}

export interface UpdateResult {
  items: GroceryItem[];
  item: GroceryItem;
}

/** Patch an existing item by name. Throws if the item is absent. */
export function updateGroceryItem(
  items: GroceryItem[],
  name: string,
  patch: GroceryUpdateInput,
  resolve: (n: string) => string = normalizeName,
): UpdateResult {
  const idx = findIndex(items, name, resolve);
  if (idx < 0) throw new Error(`not found: ${name}`);
  const next = items.map((it) => ({ ...it, for_recipes: [...it.for_recipes] }));
  next[idx] = {
    ...next[idx],
    ...patch,
    for_recipes: patch.for_recipes ?? next[idx].for_recipes,
  };
  return { items: next, item: next[idx] };
}

/** Remove an item by name. `found` is false when no such item existed. */
export function removeGroceryItem(
  items: GroceryItem[],
  name: string,
  resolve: (n: string) => string = normalizeName,
): { items: GroceryItem[]; found: boolean } {
  const idx = findIndex(items, name, resolve);
  if (idx < 0) return { items, found: false };
  return { items: items.filter((_, i) => i !== idx), found: true };
}
