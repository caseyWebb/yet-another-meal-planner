// Pure pantry mutation logic (data-write-tools capability). The tool wrapper
// supplies the current items and today's date; this applies add/remove/verify
// operations and reports what was applied vs. what conflicted (e.g. a remove
// whose target isn't present), so the agent can ask the user to resolve.

export type PantryItem = Record<string, unknown> & {
  name?: unknown;
  /** The STORED canonical dedup key (the D1 `normalized_name` / PK). Carried on the shape so the
   *  match/merge keys on the stored id, never a re-derivation of the (independent) display. */
  normalized_name?: unknown;
  /** The human-facing label, stored independently of `name` (resolver input) and the key. */
  display_name?: unknown;
};

export interface PantryOperation {
  op: "add" | "remove" | "verify";
  /** For add: the full item object. */
  item?: Record<string, unknown>;
  /** For remove/verify: the item name (or read from `item.name`). */
  name?: string;
}

export interface AppliedOp {
  op: PantryOperation["op"];
  name: string;
  merged?: boolean;
}

export interface ConflictOp {
  op: PantryOperation["op"];
  name: string;
  reason: string;
}

export interface PantryApplyResult {
  items: PantryItem[];
  applied: AppliedOp[];
  conflicts: ConflictOp[];
}

function nameOf(op: PantryOperation): string {
  if (typeof op.name === "string") return op.name;
  const n = op.item?.name;
  return typeof n === "string" ? n : "";
}

function matches(item: PantryItem, name: string, normalize: (s: string) => string): boolean {
  // Key the EXISTING item on its STORED `normalized_name` (the trusted key) when present, else the
  // re-derived `normalize(item.name)` for a fixture — never on a re-derivation of a display that may
  // no longer equal the key. Only the QUERY side (`name`) derives its key via `normalize`.
  const key =
    typeof item.normalized_name === "string"
      ? item.normalized_name
      : typeof item.name === "string"
        ? normalize(item.name)
        : null;
  return key !== null && key === normalize(name);
}

/**
 * Apply pantry operations in order, returning the new item list plus a report. `normalize`
 * maps a name to its match/dedup key; it defaults to `.toLowerCase()` (today's behavior, so
 * existing callers/tests are unaffected). Production injects `IngredientContext.resolve` —
 * pantry is food by construction (kitchen inventory), so it always keys on the canonical id,
 * merging surface-form variants ("scallions" ≡ "green onions").
 */
export function applyPantryOperations(
  items: PantryItem[],
  operations: PantryOperation[],
  today: string,
  normalize: (s: string) => string = (s) => s.toLowerCase(),
): PantryApplyResult {
  let next: PantryItem[] = items.map((it) => ({ ...it }));
  const applied: AppliedOp[] = [];
  const conflicts: ConflictOp[] = [];

  for (const op of operations) {
    const name = nameOf(op);

    if (op.op === "add") {
      if (!name) {
        conflicts.push({ op: "add", name, reason: "add requires a name (set `name` or `item.name`)" });
        continue;
      }
      const existingIdx = next.findIndex((it) => matches(it, name, normalize));
      if (existingIdx >= 0) {
        const existing = next[existingIdx];
        next[existingIdx] = {
          ...existing,
          ...op.item,
          // Keep-first display (C3): the surviving row keeps its existing `name` and `display_name`
          // rather than adopting the incoming surface form, so a merge never fragments the label.
          name: existing.name,
          display_name: existing.display_name,
          added_at: existing.added_at,
          last_verified_at: today,
        };
        applied.push({ op: "add", name, merged: true });
      } else {
        const item: PantryItem = {
          added_at: today,
          last_verified_at: today,
          prepared_from: null,
          ...op.item,
          name,
        };
        next.push(item);
        applied.push({ op: "add", name });
      }
      continue;
    }

    if (op.op === "remove") {
      const before = next.length;
      next = next.filter((it) => !matches(it, name, normalize));
      if (next.length === before) {
        conflicts.push({ op: "remove", name, reason: "no pantry item with that name" });
      } else {
        applied.push({ op: "remove", name });
      }
      continue;
    }

    // verify
    const target = next.find((it) => matches(it, name, normalize));
    if (!target) {
      conflicts.push({ op: "verify", name, reason: "no pantry item with that name" });
    } else {
      target.last_verified_at = today;
      applied.push({ op: "verify", name });
    }
  }

  return { items: next, applied, conflicts };
}

/** Reset last_verified_at to `today` on the named items. Returns verified + missing names. */
export function markVerified(
  items: PantryItem[],
  names: string[],
  today: string,
  normalize: (s: string) => string = (s) => s.toLowerCase(),
): { items: PantryItem[]; verified: string[]; missing: string[] } {
  const next = items.map((it) => ({ ...it }));
  const verified: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const target = next.find((it) => matches(it, name, normalize));
    if (target) {
      target.last_verified_at = today;
      verified.push(name);
    } else {
      missing.push(name);
    }
  }
  return { items: next, verified, missing };
}
