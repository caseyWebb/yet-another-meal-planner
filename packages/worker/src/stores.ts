// Shared store registry (in-store-fulfillment capability). The registry is the D1
// `stores` table (d1-shared-corpus) — one row per specific store LOCATION, holding
// store IDENTITY only: name, label, chain, address, domain, location_id. Store content
// is shared and UNATTRIBUTED (like recipe content). The store's LAYOUT (aisle order,
// where non-obvious items hide, not-carried set) is NOT here — it lives in attributed
// store notes (the D1 `store_notes` table) with layout/location/stock tags.
//
// The D1 row read/write lives in corpus-db.ts (the shared-corpus data layer); this
// file is the pure operation/shape logic (the update_pantry / update_kitchen style),
// unit-testable against plain Store objects. The `Store` type itself lives in
// corpus-db.ts so the row mapping owns it.

import { ToolError } from "./errors.js";
import type { Store } from "./corpus-db.js";

// kebab-case location slug; anchored so it also rejects path traversal.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type { Store } from "./corpus-db.js";

/** The compact view `list_stores` returns — identity only. Whether a store has a
 * usable map is a notes concern (read_store_notes), not part of the registry. */
export interface StoreListing {
  slug: string;
  name: string;
  label?: string;
  domain: string;
}

export function toListing(store: Store): StoreListing {
  const l: StoreListing = {
    slug: store.slug,
    name: store.name,
    domain: store.domain,
  };
  if (store.label) l.label = store.label;
  return l;
}

/** Validate a store slug (kebab-case); throws a structured not_found on a bad slug. */
export function assertStoreSlug(slug: string): void {
  if (!SLUG_RE.test(slug)) {
    throw new ToolError("not_found", `Unknown store: ${slug}`, { slug });
  }
}

// --- pure operations (update_store, update_pantry-style) --------------------

export type StoreOperation =
  // Identity edits (set a top-level field). Layout is notes now — no aisle/
  // item_location/doesnt_carry ops here; those moved to add_store_note.
  { op: "set_identity"; field: "name" | "label" | "chain" | "address" | "domain" | "location_id"; value: string };

export interface StoreApplied {
  op: StoreOperation["op"];
  target: string;
}

export interface StoreConflict {
  op: StoreOperation["op"];
  target: string;
  reason: string;
}

export interface StoreApplyResult {
  store: Store;
  applied: StoreApplied[];
  conflicts: StoreConflict[];
}

const IDENTITY_FIELDS = ["name", "label", "chain", "address", "domain", "location_id"] as const;

/**
 * Apply identity update operations in order. An off-target op (an unsettable field,
 * or an empty name) is a structured conflict, never a silent write — the
 * update_pantry / update_kitchen posture.
 */
export function applyStoreOperations(store: Store, operations: StoreOperation[]): StoreApplyResult {
  const next: Store = { ...store };
  const applied: StoreApplied[] = [];
  const conflicts: StoreConflict[] = [];

  for (const op of operations) {
    if (op.op === "set_identity") {
      if (!IDENTITY_FIELDS.includes(op.field)) {
        conflicts.push({ op: op.op, target: op.field, reason: "not a settable identity field" });
        continue;
      }
      if (op.field === "name" && !op.value.trim()) {
        conflicts.push({ op: op.op, target: op.field, reason: "name must not be empty" });
        continue;
      }
      next[op.field] = op.value;
      applied.push({ op: op.op, target: op.field });
    }
  }

  return { store: next, applied, conflicts };
}
