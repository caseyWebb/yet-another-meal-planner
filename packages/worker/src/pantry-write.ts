// Pure pantry mutation logic (data-write-tools capability). The tool wrapper
// supplies the current items and today's date; this applies add/remove/verify
// operations and reports what was applied vs. what conflicted (e.g. a remove
// whose target isn't present), so the agent can ask the user to resolve.

export type PantryItem = Record<string, unknown> & { name?: unknown };

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

function matches(item: PantryItem, name: string): boolean {
  return typeof item.name === "string" && item.name.toLowerCase() === name.toLowerCase();
}

/** Apply pantry operations in order, returning the new item list plus a report. */
export function applyPantryOperations(
  items: PantryItem[],
  operations: PantryOperation[],
  today: string,
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
      const existingIdx = next.findIndex((it) => matches(it, name));
      if (existingIdx >= 0) {
        const existing = next[existingIdx];
        next[existingIdx] = {
          ...existing,
          ...op.item,
          name,
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
      next = next.filter((it) => !matches(it, name));
      if (next.length === before) {
        conflicts.push({ op: "remove", name, reason: "no pantry item with that name" });
      } else {
        applied.push({ op: "remove", name });
      }
      continue;
    }

    // verify
    const target = next.find((it) => matches(it, name));
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
): { items: PantryItem[]; verified: string[]; missing: string[] } {
  const next = items.map((it) => ({ ...it }));
  const verified: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const target = next.find((it) => matches(it, name));
    if (target) {
      target.last_verified_at = today;
      verified.push(name);
    } else {
      missing.push(name);
    }
  }
  return { items: next, verified, missing };
}
