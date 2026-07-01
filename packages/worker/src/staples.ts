// Pure helpers for the staples list — the must-have items a member never wants to
// run out of. Add-only (deduped by normalized name) and remove-by-name ops, applied
// over an in-memory list of items; the per-tenant `update_staples` tool persists the
// result as rows in the D1 `staples` table (src/profile-db.ts). Keeping the logic
// pure (object-in/object-out, no TOML, no D1) makes it unit-testable off `workerd`.

import { normalizeName } from "./grocery.js";

export interface StaplesItem {
  name: string;
  perishable?: boolean;
}

/**
 * Apply add/remove operations to a staples list. Adds are deduped by normalized
 * name (existing items untouched); removes match by normalized name (absent name is
 * a silent no-op). Returns the new list and the counts. The caller persists the new
 * list (delete-then-insert the tenant's rows, or a per-row diff).
 */
export function updateStaples(
  existing: StaplesItem[],
  add: StaplesItem[],
  remove: string[],
): { items: StaplesItem[]; added: number; removed: number; changed: boolean } {
  let items = [...existing];

  const have = new Map<string, number>(
    items
      .map((it, i) => [normalizeName(it.name), i] as [string, number])
      .filter(([k]) => k !== ""),
  );

  let added = 0;
  for (const item of add) {
    const key = normalizeName(item.name);
    if (!key || have.has(key)) continue;
    have.set(key, items.length);
    items.push(item.perishable === true ? { name: item.name, perishable: true } : { name: item.name });
    added++;
  }

  let removed = 0;
  const removeKeys = new Set(remove.map((n) => normalizeName(n)).filter(Boolean));
  if (removeKeys.size > 0) {
    const before = items.length;
    items = items.filter((it) => !removeKeys.has(normalizeName(it.name)));
    removed = before - items.length;
  }

  return { items, added, removed, changed: added > 0 || removed > 0 };
}
