// Pure meal-plan logic (meal-planning capability). The D1 `meal_plan` table is the
// transient, recipe-grain record of committed cook intent. No I/O here; the
// tool/commit wrappers supply the parsed file and today's date.

export interface PlannedItem {
  recipe: string;
  /** ISO date the cook is slated for; optional. */
  planned_for?: string | null;
  /** Free-text open-world side names riding on this main's row; never slug-resolved. */
  sides?: string[];
  /** The night-vibe slot id this row was proposed to fill (advisory provenance; never
   *  slug-resolved). Copied to `cooking_log.satisfied_vibe` on cook. Absent for off-vibe plans. */
  from_vibe?: string | null;
}

export interface MealPlanOp {
  op: "add" | "remove";
  recipe: string;
  planned_for?: string | null;
  /** Open-world sides to attach to the (upserted) main's row on an `add`. */
  sides?: string[];
  /** Night-vibe slot provenance to set on the (upserted) row on an `add`. */
  from_vibe?: string | null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function coercePlanned(raw: Record<string, unknown>): PlannedItem {
  const item: PlannedItem = {
    recipe: typeof raw.recipe === "string" ? raw.recipe : "",
    planned_for: typeof raw.planned_for === "string" ? raw.planned_for : null,
  };
  if (typeof raw.from_vibe === "string") item.from_vibe = raw.from_vibe;
  // sides is free-text open-world side names; carry it only when non-empty so plain
  // rows stay clean (no `sides = []` on every planned row).
  if (Array.isArray(raw.sides)) {
    const sides = raw.sides.filter((s): s is string => typeof s === "string");
    if (sides.length) item.sides = sides;
  }
  return item;
}

/** Union `add` into `existing`, preserving order and dropping exact duplicates. */
function unionSides(existing: string[] | undefined, add: string[]): string[] {
  const out = [...(existing ?? [])];
  for (const s of add) if (!out.includes(s)) out.push(s);
  return out;
}

/** Read the planned array out of a parsed `meal_plan` record (empty when absent). */
export function plannedOf(parsed: Record<string, unknown>): PlannedItem[] {
  const raw = Array.isArray(parsed.planned) ? (parsed.planned as Record<string, unknown>[]) : [];
  return raw.map(coercePlanned);
}

function sameRecipe(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Apply add/remove ops in order. `add` upserts by recipe slug (updating
 * planned_for); `remove` drops every row for the slug. Returns the new list and
 * a per-op report.
 */
export function applyMealPlanOps(
  items: PlannedItem[],
  ops: MealPlanOp[],
): { items: PlannedItem[]; applied: { op: MealPlanOp["op"]; recipe: string }[]; conflicts: { op: MealPlanOp["op"]; recipe: string; reason: string }[] } {
  let next = items.map((it) => ({ ...it }));
  const applied: { op: MealPlanOp["op"]; recipe: string }[] = [];
  const conflicts: { op: MealPlanOp["op"]; recipe: string; reason: string }[] = [];

  for (const op of ops) {
    if (!op.recipe) {
      conflicts.push({ op: op.op, recipe: op.recipe, reason: "op requires a recipe slug" });
      continue;
    }
    if (op.planned_for != null && !ISO_DATE_RE.test(op.planned_for)) {
      conflicts.push({ op: op.op, recipe: op.recipe, reason: `invalid planned_for: ${op.planned_for}` });
      continue;
    }

    if (op.op === "add") {
      const existing = next.find((it) => sameRecipe(it.recipe, op.recipe));
      if (existing) {
        existing.planned_for = op.planned_for ?? existing.planned_for ?? null;
        // Merge open-world sides onto the existing row (union, no duplicate row).
        if (op.sides?.length) existing.sides = unionSides(existing.sides, op.sides);
        // Set provenance only when the op carries it (an add without from_vibe keeps the prior).
        if (op.from_vibe != null) existing.from_vibe = op.from_vibe;
      } else {
        const item: PlannedItem = { recipe: op.recipe, planned_for: op.planned_for ?? null };
        if (op.sides?.length) item.sides = [...op.sides];
        if (op.from_vibe != null) item.from_vibe = op.from_vibe;
        next.push(item);
      }
      applied.push({ op: "add", recipe: op.recipe });
      continue;
    }

    // remove
    const before = next.length;
    next = next.filter((it) => !sameRecipe(it.recipe, op.recipe));
    if (next.length === before) {
      conflicts.push({ op: "remove", recipe: op.recipe, reason: "no planned row for that recipe" });
    } else {
      applied.push({ op: "remove", recipe: op.recipe });
    }
  }

  return { items: next, applied, conflicts };
}

/**
 * Partition planned rows into those that are DUE (planned_for on/before `today`,
 * or unset) and those scheduled for the future. The session-start reconcile only
 * surfaces the due ones.
 */
export function dueAndFuture(
  items: PlannedItem[],
  today: string,
): { due: PlannedItem[]; future: PlannedItem[] } {
  const due: PlannedItem[] = [];
  const future: PlannedItem[] = [];
  for (const it of items) {
    if (it.planned_for && it.planned_for > today) future.push(it);
    else due.push(it);
  }
  return { due, future };
}
