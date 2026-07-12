import type { GroceryLine, GroceryListData } from "@yamp/contract";

export type GroceryGrouping = "department" | "recipe";
export interface GroceryGroup {
  key: string;
  label: string;
  lines: GroceryLine[];
}
export type GroceryAction =
  | { kind: "add"; name: string }
  | { kind: "checked"; key: string; checked: boolean; expected_row_version: number; snapshot_version: string }
  | { kind: "remove"; key: string }
  | { kind: "relist"; send_id: string | null; key: string; expected_row_version: number }
  | { kind: "mark_placed"; send_id: string; expected_line_keys: string[]; snapshot_version: string }
  | { kind: "pantry_verify"; key: string; snapshot_version: string }
  | { kind: "pantry_buy_anyway" | "pantry_undo"; key: string; snapshot_version: string }
  | {
      kind: "substitute";
      original_key: string;
      replacement_key: string;
      replacement_name: string;
      snapshot_version: string;
    }
  | { kind: "substitute_undo"; original_key: string; snapshot_version: string };

export interface GroceryHostAdapter {
  mode: "interactive" | "delegate" | "readonly";
  online?: boolean;
  mutate(action: GroceryAction): Promise<GroceryListData>;
  delegate?(action: GroceryAction): Promise<void> | void;
}

const aisleNumber = (line: GroceryLine): number => {
  const match = line.placement?.aisle_number?.match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
};
const labelOf = (line: GroceryLine): string => line.display_name ?? line.name;
const lineCmp = (a: GroceryLine, b: GroceryLine): number =>
  aisleNumber(a) - aisleNumber(b) ||
  (a.placement?.aisle_side ?? "").localeCompare(b.placement?.aisle_side ?? "") ||
  labelOf(a).localeCompare(labelOf(b)) ||
  a.key.localeCompare(b.key);

export function orderedRecipeAttribution(
  line: GroceryLine,
): { slug: string; planned_for?: string | null; plan_id?: string }[] {
  const attribution: { slug: string; planned_for?: string | null; plan_id?: string }[] =
    line.recipe_attribution ?? line.for_recipes.map((slug) => ({ slug }));
  return [...attribution]
    .filter((item, index, values) => values.findIndex((candidate) => candidate.slug === item.slug) === index)
    .sort(
      (a, b) =>
        (a.planned_for ?? "9999-99-99").localeCompare(b.planned_for ?? "9999-99-99") ||
        (a.plan_id ?? "").localeCompare(b.plan_id ?? "") ||
        a.slug.localeCompare(b.slug),
    );
}

export function groupGroceryLines(lines: GroceryLine[], grouping: GroceryGrouping): GroceryGroup[] {
  const groups = new Map<string, GroceryLine[]>();
  if (grouping === "department") {
    for (const line of lines) {
      const label =
        line.kind !== "grocery" || line.domain !== "grocery"
          ? "Household"
          : line.placement?.section?.trim() || "Not mapped";
      groups.set(label, [...(groups.get(label) ?? []), line]);
    }
    const fallback = (label: string): number => (label === "Household" ? 1 : label === "Not mapped" ? 2 : 0);
    return [...groups]
      .map(([label, values]) => ({ key: label.toLowerCase(), label, lines: values.sort(lineCmp) }))
      .sort(
        (a, b) =>
          fallback(a.label) - fallback(b.label) ||
          Math.min(...a.lines.map(aisleNumber)) - Math.min(...b.lines.map(aisleNumber)) ||
          a.label.localeCompare(b.label) ||
          a.key.localeCompare(b.key),
      );
  }
  for (const line of lines) {
    const ordered = orderedRecipeAttribution(line);
    const label = ordered[0]?.slug ?? "No recipe";
    groups.set(label, [...(groups.get(label) ?? []), line]);
  }
  return [...groups]
    .map(([label, values]) => ({ key: label, label, lines: values.sort(lineCmp) }))
    .sort(
      (a, b) =>
        (a.label === "No recipe" ? 1 : 0) - (b.label === "No recipe" ? 1 : 0) ||
        recipeGroupOrder(a).localeCompare(recipeGroupOrder(b)) ||
        a.label.localeCompare(b.label),
    );
}

function recipeGroupOrder(group: GroceryGroup): string {
  if (group.label === "No recipe") return "9999-99-99\uffff";
  const attrs: { slug: string; planned_for?: string | null; plan_id?: string }[] = group.lines.flatMap(
    (line) => line.recipe_attribution ?? line.for_recipes.map((slug) => ({ slug })),
  );
  const matching = attrs
    .filter((item) => item.slug === group.label)
    .sort(
      (a, b) =>
        (a.planned_for ?? "9999-99-99").localeCompare(b.planned_for ?? "9999-99-99") ||
        (a.plan_id ?? "").localeCompare(b.plan_id ?? "") ||
        a.slug.localeCompare(b.slug),
    );
  const first = matching[0];
  return `${first?.planned_for ?? "9999-99-99"}\u0000${first?.plan_id ?? ""}\u0000${group.label}`;
}

export interface GroceryControllerState {
  data: GroceryListData;
  grouping: GroceryGrouping;
  pending: string[];
  conflict: string | null;
  confirmation: GroceryAction | null;
}

export function createGroceryController(data: GroceryListData): GroceryControllerState {
  return { data, grouping: "department", pending: [], conflict: null, confirmation: null };
}

export function groceryActionKey(action: GroceryAction): string {
  if (action.kind === "add") return `add:${action.name.trim().toLocaleLowerCase()}`;
  if (action.kind === "mark_placed" || action.kind === "relist") return `send:${action.send_id}`;
  return `line:${"key" in action ? action.key : action.original_key}`;
}

function recount(data: GroceryListData, lines: GroceryLine[], toBuy: string[]): GroceryListData["counts"] {
  return {
    ...data.counts,
    to_buy: toBuy.length,
    checked: lines.filter((line) => line.checked_at != null).length,
    recipes: new Set(lines.flatMap((line) => line.for_recipes)).size,
  };
}

/**
 * Immediate, reversible presentation while an authoritative mutation is in flight. Decision
 * provenance controls whether an undo may remove a replacement/materialized row. Pantry-covered
 * records deliberately are not fabricated into GroceryLine values: that projection lacks kind,
 * quantity, row-version and placement truth and waits for the returned snapshot instead.
 */
export function projectGroceryAction(data: GroceryListData, action: GroceryAction): GroceryListData {
  let lines = data.lines;
  let toBuy = data.to_buy;
  let substitutions = data.substitution_decisions ?? [];
  let coverage = data.coverage_decisions ?? [];

  if (action.kind === "checked") {
    lines = lines.map((line) =>
      line.key === action.key ? { ...line, checked_at: action.checked ? data.as_of : null } : line,
    );
    toBuy = action.checked
      ? toBuy.filter((key) => key !== action.key)
      : lines.some((line) => line.key === action.key) && !toBuy.includes(action.key)
        ? [...toBuy, action.key]
        : toBuy;
  } else if (action.kind === "substitute") {
    const original = lines.find((line) => line.key === action.original_key);
    const replacement = lines.find((line) => line.key === action.replacement_key);
    substitutions = [
      ...substitutions.filter((decision) => decision.original_key !== action.original_key),
      {
        original_key: action.original_key,
        replacement_key: action.replacement_key,
        attribution_signature: "pending",
        created_replacement: !replacement,
        replacement_version: replacement?.row_version ?? 1,
        row_version: 1,
        created_at: data.as_of,
        updated_at: data.as_of,
      },
    ];
    if (original && !replacement) {
      lines = [
        ...lines,
        {
          ...original,
          key: action.replacement_key,
          name: action.replacement_name,
          display_name: action.replacement_name,
          checked_at: null,
          row_version: 1,
        },
      ];
    }
    lines = lines.filter((line) => line.key !== action.original_key);
    toBuy = toBuy.filter((key) => key !== action.original_key);
    if (!toBuy.includes(action.replacement_key)) toBuy = [...toBuy, action.replacement_key];
  } else if (action.kind === "substitute_undo") {
    const decision = substitutions.find((item) => item.original_key === action.original_key);
    substitutions = substitutions.filter((item) => item.original_key !== action.original_key);
    if (decision?.created_replacement) {
      lines = lines.filter(
        (line) =>
          line.key !== decision.replacement_key ||
          decision.replacement_version == null ||
          line.row_version !== decision.replacement_version,
      );
      if (!lines.some((line) => line.key === decision.replacement_key))
        toBuy = toBuy.filter((key) => key !== decision.replacement_key);
    }
  } else if (action.kind === "pantry_buy_anyway") {
    // Record only the decision. The server response supplies the canonical materialized row.
    coverage = coverage.some((decision) => decision.line_key === action.key)
      ? coverage
      : [
          ...coverage,
          {
            line_key: action.key,
            created_row: true,
            created_row_version: null,
            row_version: 1,
            created_at: data.as_of,
            updated_at: data.as_of,
          },
        ];
  } else if (action.kind === "pantry_undo") {
    coverage = coverage.filter((item) => item.line_key !== action.key);
    // Restored pantry subtraction hides both an existing explicit row and a row that this decision
    // materialized. The server decides whether storage may be deleted; the projection only hides it.
    lines = lines.filter((line) => line.key !== action.key);
    toBuy = toBuy.filter((key) => key !== action.key);
  }

  if (
    lines === data.lines &&
    toBuy === data.to_buy &&
    substitutions === (data.substitution_decisions ?? []) &&
    coverage === (data.coverage_decisions ?? [])
  )
    return data;
  return {
    ...data,
    lines,
    to_buy: toBuy,
    substitution_decisions: substitutions,
    coverage_decisions: coverage,
    counts: recount(data, lines, toBuy),
  };
}

export async function runGroceryAction(
  state: GroceryControllerState,
  adapter: GroceryHostAdapter,
  action: GroceryAction,
): Promise<GroceryControllerState> {
  const key = groceryActionKey(action);
  if (adapter.mode === "readonly") return { ...state, pending: state.pending.filter((p) => p !== key) };
  if (adapter.mode === "delegate") {
    await adapter.delegate?.(action);
    return { ...state, pending: state.pending.filter((p) => p !== key) };
  }
  try {
    const data = await adapter.mutate(action);
    return {
      ...state,
      data,
      pending: state.pending.filter((p) => p !== key),
      conflict: null,
      confirmation: action,
    };
  } catch (error) {
    const detail =
      error && typeof error === "object"
        ? (error as {
            message?: unknown;
            snapshot?: GroceryListData;
            context?: { snapshot?: GroceryListData };
          })
        : undefined;
    const current = detail?.snapshot ?? detail?.context?.snapshot;
    return {
      ...state,
      ...(current ? { data: current } : {}),
      pending: state.pending.filter((p) => p !== key),
      conflict: typeof detail?.message === "string" ? detail.message : "Grocery state changed",
    };
  }
}
