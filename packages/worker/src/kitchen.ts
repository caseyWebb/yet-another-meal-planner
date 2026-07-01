// Pure kitchen-inventory logic (kitchen-equipment capability). What a member owns
// to cook WITH. Two structurally-separated regions: `owned` — the gating list, an
// array of EQUIPMENT_VOCAB slugs that is the makeability gate's left operand — and
// `notes`, freeform cook-reasoning context (oven count, pan sizes) the gate never
// reads.

// EQUIPMENT_VOCAB is the makeability gate's vocabulary — the equipment a dish is
// genuinely IMPOSSIBLE without ("no recipe-preserving workaround"). It is defined
// once in the shared single-source module (src/vocab.js) and re-exported here for
// the kitchen logic + the Worker validator; the recipe-index reconcile
// (src/recipe-projection.ts) validates against the same source, so the write-time and
// reconcile gates cannot drift. Extending it is a deliberate edit in src/vocab.js
// (+ a docs/SCHEMAS.md update).
import { EQUIPMENT_VOCAB } from "./vocab.js";
export { EQUIPMENT_VOCAB };

export function isEquipmentSlug(slug: unknown): boolean {
  return typeof slug === "string" && EQUIPMENT_VOCAB.some((v) => v === slug);
}

export interface KitchenInventory {
  owned: string[];
  notes: Record<string, unknown>;
}

export type KitchenOperation = {
  op: "add" | "remove" | "set_note";
  /** For add/remove: the equipment slug. */
  slug?: string;
  /** For set_note: the [notes] field key. */
  key?: string;
  /** For set_note: the [notes] field value. */
  value?: unknown;
};

export interface KitchenApplied {
  op: KitchenOperation["op"];
  target: string;
}

export interface KitchenConflict {
  op: KitchenOperation["op"];
  target: string;
  reason: string;
}

export interface KitchenApplyResult {
  inventory: KitchenInventory;
  applied: KitchenApplied[];
  conflicts: KitchenConflict[];
}

/** Normalize a parsed `kitchen` inventory object into the inventory shape (absent → empty). */
export function toInventory(parsed: Record<string, unknown>): KitchenInventory {
  const owned = Array.isArray(parsed.owned)
    ? (parsed.owned.filter((s): s is string => typeof s === "string"))
    : [];
  const notes =
    parsed.notes && typeof parsed.notes === "object" && !Array.isArray(parsed.notes)
      ? (parsed.notes as Record<string, unknown>)
      : {};
  return { owned, notes };
}

/**
 * Apply kitchen operations in order, returning the new inventory plus a report.
 * An `add` of an off-vocabulary slug is a conflict, never a silent write — the
 * gate's left operand stays vocabulary-clean. A `remove` of an absent slug is a
 * conflict. `add` of an already-owned slug is idempotent (no-op, not a conflict).
 */
export function applyKitchenOperations(
  inventory: KitchenInventory,
  operations: KitchenOperation[],
): KitchenApplyResult {
  const owned = [...inventory.owned];
  const notes = { ...inventory.notes };
  const applied: KitchenApplied[] = [];
  const conflicts: KitchenConflict[] = [];

  for (const op of operations) {
    if (op.op === "add") {
      const slug = op.slug ?? "";
      if (!isEquipmentSlug(slug)) {
        conflicts.push({
          op: op.op,
          target: slug,
          reason: `not a known equipment slug (one of ${EQUIPMENT_VOCAB.join(", ")})`,
        });
      } else if (!owned.includes(slug)) {
        owned.push(slug);
        applied.push({ op: op.op, target: slug });
      }
    } else if (op.op === "remove") {
      const slug = op.slug ?? "";
      const i = owned.indexOf(slug);
      if (i === -1) {
        conflicts.push({ op: op.op, target: slug, reason: "not in owned" });
      } else {
        owned.splice(i, 1);
        applied.push({ op: op.op, target: slug });
      }
    } else {
      const key = op.key ?? "";
      if (!key) {
        conflicts.push({ op: op.op, target: "", reason: "set_note requires a key" });
      } else {
        notes[key] = op.value;
        applied.push({ op: op.op, target: key });
      }
    }
  }

  owned.sort();
  return { inventory: { owned, notes }, applied, conflicts };
}
