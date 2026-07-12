import { KNOWN_GROCERY_CONTRACT_VERSION, type GroceryListData, type GroceryLine, type GrocerySendGroup } from "@yamp/contract";
import type { Env } from "./env.js";
import { db } from "./db.js";
import { computeToBuyView } from "./to-buy.js";
import { readGroceryDecisionInputs } from "./to-buy.js";
import { readGroceryList } from "./session-db.js";
import { emptyIngredientContext, ingredientContext } from "./corpus-db.js";
import { readStaples } from "./profile-db.js";

interface SendReadRow {
  send_id: string;
  store: string;
  location_id: string | null;
  fulfillment: string;
  created_at: string;
  placed_at: string | null;
  line_key: string | null;
  line_name: string | null;
  quantity: number | null;
  unit_price: number | null;
  savings: number | null;
  row_version: number | null;
  current_key: string | null;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function digest(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return `sha256:${[...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

function n(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function sendGroups(env: Env, tenant: string, asOf: Date): Promise<GrocerySendGroup[]> {
  const rows = await db(env).all<SendReadRow>(
    "SELECT s.id AS send_id, s.store, s.location_id, s.fulfillment, s.created_at, s.placed_at, " +
      "l.line_key, l.name AS line_name, l.quantity, l.unit_price, l.savings, g.row_version, g.normalized_name AS current_key " +
      "FROM order_sends s LEFT JOIN order_send_lines l ON l.send_id = s.id " +
      "LEFT JOIN grocery_list g ON g.tenant = s.tenant AND g.normalized_name = l.line_key " +
      "AND g.status = 'in_cart' AND g.sent_in = s.id WHERE s.tenant = ?1 AND s.placed_at IS NULL " +
      "ORDER BY s.created_at, s.id, l.line_key",
    tenant,
  );
  const groups = new Map<string, GrocerySendGroup>();
  const quoteTotals = new Map<string, { total: number; priced: boolean; savings: number; saved: boolean }>();
  for (const row of rows) {
    const group = groups.get(row.send_id) ?? {
      send_id: row.send_id,
      store: row.store,
      location_id: row.location_id,
      fulfillment: row.fulfillment,
      sent_at: row.created_at,
      placed_at: row.placed_at,
      awaiting_confirmation: asOf.getTime() - Date.parse(row.created_at) > 72 * 3_600_000,
      estimated_total: 0,
      flyer_savings: 0,
      can_mark_placed: false,
      lines: [],
    };
    const quote = quoteTotals.get(row.send_id) ?? { total: 0, priced: false, savings: 0, saved: false };
    if (row.unit_price != null) { quote.total += row.unit_price * (row.quantity ?? 1); quote.priced = true; }
    if (row.savings != null) { quote.savings += row.savings * (row.quantity ?? 1); quote.saved = true; }
    quoteTotals.set(row.send_id, quote);
    if (row.line_key && row.line_name && row.row_version != null && row.current_key != null) {
      group.lines.push({
        key: row.line_key,
        name: row.line_name,
        quantity: row.quantity ?? 1,
        row_version: row.row_version,
        unit_price: row.unit_price,
        savings: row.savings,
      });
    }
    groups.set(row.send_id, group);
  }
  return [...groups.values()].map((g) => {
    const quote = quoteTotals.get(g.send_id ?? "");
    return {
      ...g,
      estimated_total: quote?.priced ? n(quote.total) : null,
      flyer_savings: quote?.saved ? n(quote.savings) : null,
      can_mark_placed: g.lines.length > 0,
    };
  }).filter((group) => group.lines.length > 0);
}

/** Authoritative, tenant-scoped state behind the member route and MCP app. */
export async function readGrocerySnapshot(env: Env, tenant: string, now = new Date()): Promise<GroceryListData> {
  const view = await computeToBuyView(env, tenant, { enrich: true });
  const [storedList, staples, stapleContext] = await Promise.all([
    readGroceryList(env, tenant),
    readStaples(env, tenant),
    ingredientContext(env, { capture: false }).catch(() => emptyIngredientContext(env)),
  ]);
  const stapleKeys = new Set(staples.map((item) => stapleContext.resolve(item.name)));
  const decisions = await readGroceryDecisionInputs(env, tenant, [], storedList, (name) => name);
  const linked = await sendGroups(env, tenant, now);
  const linkedKeys = new Set(linked.flatMap((g) => g.lines.map((l) => l.key)));
  const unlinked = view.in_cart.filter((line) => !line.key || !linkedKeys.has(line.key));
  const in_cart_groups: GrocerySendGroup[] = [...linked];
  if (unlinked.length) {
    in_cart_groups.push({
      send_id: null,
      store: null,
      location_id: null,
      fulfillment: null,
      sent_at: null,
      placed_at: null,
      awaiting_confirmation: false,
      estimated_total: null,
      flyer_savings: null,
      can_mark_placed: false,
      lines: unlinked.map((line) => ({
        key: line.key ?? line.name,
        name: line.display_name ?? line.name,
        quantity: line.quantity ?? "1",
        row_version: line.row_version ?? 1,
        unit_price: null,
        savings: null,
      })),
    });
  }
  const toLine = (line: (typeof view.to_buy)[number]): GroceryLine => ({
    key: line.key,
    name: line.name,
    ...(line.display_name ? { display_name: line.display_name } : {}),
    quantity: line.quantity,
    assumed_quantity: line.assumed_quantity,
    kind: line.kind,
    domain: line.domain,
    origin: line.origin,
    checked_at: line.checked_at ?? null,
    row_version: line.row_version ?? 0,
    updated_at: line.updated_at ?? null,
    ...(line.note !== undefined ? { note: line.note } : {}),
    ...(stapleKeys.has(line.key) ? { staple: true } : {}),
    for_recipes: line.for_recipes,
    recipe_attribution: line.recipe_attribution ?? line.for_recipes.map((slug) => ({ slug })),
    placement: line.placement
      ? {
          ...(line.placement.aisle_description || line.placement.department_label
            ? { section: line.placement.aisle_description ?? line.placement.department_label }
            : {}),
          ...(line.placement.aisle_number ? { aisle_number: line.placement.aisle_number } : {}),
          ...(line.placement.aisle_side ? { aisle_side: line.placement.aisle_side } : {}),
        }
      : null,
    ...(line.substitutes ? { substitutes: line.substitutes } : {}),
  });
  const lines = [...view.to_buy, ...view.checked].map(toLine).sort((a, b) => a.key.localeCompare(b.key));
  const pantry_covered = view.pantry_covered.map((line) => ({
    key: line.key ?? line.name,
    name: line.name,
    ...(line.display_name ? { display_name: line.display_name } : {}),
    for_recipes: line.for_recipes,
    freshness: line.freshness ?? "covered" as const,
    ...(line.freshness_reason ? { freshness_reason: line.freshness_reason } : {}),
    on_hand: line.on_hand,
    buy_anyway: line.buy_anyway ?? false,
  })).sort((a, b) => a.key.localeCompare(b.key));
  for (const group of in_cart_groups) group.lines.sort((a, b) => a.key.localeCompare(b.key));
  in_cart_groups.sort((a, b) => (a.sent_at ?? "9999").localeCompare(b.sent_at ?? "9999") || (a.send_id ?? "~").localeCompare(b.send_id ?? "~"));
  const stable = {
    contract_version: KNOWN_GROCERY_CONTRACT_VERSION,
    lines,
    to_buy: view.to_buy.map((line) => line.key).sort(),
    pantry_covered,
    substitution_decisions: decisions.substitutions.map((row) => ({ ...row, created_replacement: Boolean(row.created_replacement) })),
    coverage_decisions: decisions.coverage.map((row) => ({ ...row, created_row: Boolean(row.created_row) })),
    in_cart_groups,
    underived: [...view.underived].sort(),
    location: view.location ?? null,
    flyer_as_of: view.flyer_as_of ?? null,
    counts: {
      to_buy: view.to_buy.length,
      checked: view.checked.length,
      in_carts: in_cart_groups.reduce((sum, group) => sum + group.lines.length, 0),
      recipes: new Set(lines.flatMap((line) => line.for_recipes)).size,
    },
  };
  return { ...stable, snapshot_version: await digest(stable), as_of: now.toISOString() };
}

export function grocerySnapshotText(data: GroceryListData): string {
  const lines = data.lines.map((line) => {
    const recipes = line.recipe_attribution?.map((item) => item.slug) ?? line.for_recipes;
    const placement = [line.placement?.section, line.placement?.aisle_number ? `aisle ${line.placement.aisle_number}` : null]
      .filter(Boolean).join(", ");
    const substitutes = (line.substitutes ?? []).flatMap((candidate) => {
      if (!candidate || typeof candidate !== "object") return [];
      const row = candidate as { id?: unknown; label?: unknown; in_pantry?: unknown; on_sale_hint?: unknown };
      const label = typeof row.label === "string" ? row.label : typeof row.id === "string" ? row.id : null;
      return label ? [`${label}${row.in_pantry ? " (pantry)" : ""}${row.on_sale_hint ? " (sale)" : ""}`] : [];
    });
    return `${line.checked_at ? "✓" : "○"} ${line.display_name ?? line.name} (${line.quantity}${line.assumed_quantity ? " assumed" : ""})${line.staple ? " [Staple]" : ""}${line.note ? ` — ${line.note}` : ""}${recipes.length ? ` [for: ${recipes.join(", ")}]` : ""}${placement ? ` [${placement}]` : ""}${substitutes.length ? ` [try: ${substitutes.join(", ")}]` : ""}`;
  });
  const pantry = data.pantry_covered.map((line) => `Pantry covers: ${line.display_name ?? line.name}${line.freshness === "worth_a_look" ? ` (worth a look${line.freshness_reason ? `: ${line.freshness_reason}` : ""})` : ""}${line.for_recipes.length ? ` [for: ${line.for_recipes.join(", ")}]` : ""}`);
  const decisions = [
    ...(data.substitution_decisions ?? []).map((d) => `Decision: use ${d.replacement_key} instead of ${d.original_key}`),
    ...(data.coverage_decisions ?? []).map((d) => `Decision: buy ${d.line_key} despite pantry coverage`),
  ];
  const carts = data.in_cart_groups.flatMap((g) => [
    `${g.store ?? "Unlinked cart"}: ${g.lines.length} item${g.lines.length === 1 ? "" : "s"}${g.sent_at == null ? "" : `, sent ${g.sent_at}`}${g.awaiting_confirmation ? ", awaiting confirmation" : ""}${g.estimated_total == null ? "" : `, sent estimate $${Number(g.estimated_total).toFixed(2)}`}${g.flyer_savings == null || g.flyer_savings <= 0 ? "" : `, flyer savings $${Number(g.flyer_savings).toFixed(2)}`}`,
    ...g.lines.map((line) => `  - ${line.name} (${line.quantity})`),
  ]);
  const underived = data.underived.length ? [`Underived recipes: ${data.underived.join(", ")}`] : [];
  return [`Grocery list: ${data.counts.to_buy} to buy, ${data.counts.checked} checked, ${data.counts.in_carts} in carts.`, ...lines, ...pantry, ...decisions, ...underived, ...carts, "Send prices are quotes, not final fulfillment prices."].join("\n");
}
