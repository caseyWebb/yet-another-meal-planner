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
  | { kind: "relist"; send_id: string; key: string; expected_row_version: number }
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
    const ordered: { slug: string; planned_for?: string | null; plan_id?: string }[] = [
      ...(line.recipe_attribution ?? line.for_recipes.map((slug) => ({ slug }))),
    ];
    ordered.sort(
      (a, b) =>
        (a.planned_for ?? "9999-99-99").localeCompare(b.planned_for ?? "9999-99-99") ||
        (a.plan_id ?? "").localeCompare(b.plan_id ?? "") ||
        a.slug.localeCompare(b.slug),
    );
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
  return "key" in action
    ? action.key
    : "original_key" in action
      ? action.original_key
      : "send_id" in action
        ? action.send_id
        : action.name;
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
