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

function findIndex(items: GroceryItem[], name: string): number {
  const key = normalizeName(name);
  return items.findIndex((it) => normalizeName(it.name) === key);
}

function uniq(values: string[]): string[] {
  return [...new Set(values)];
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
): AddResult {
  const next = items.map((it) => ({ ...it, for_recipes: [...it.for_recipes] }));
  const idx = findIndex(next, input.name);

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
): UpdateResult {
  const idx = findIndex(items, name);
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
): { items: GroceryItem[]; found: boolean } {
  const idx = findIndex(items, name);
  if (idx < 0) return { items, found: false };
  return { items: items.filter((_, i) => i !== idx), found: true };
}
