// Spend telemetry (spend-telemetry capability, D16): snapshot at send, materialize at
// the purchase assertion. This module is the WHOLE spend write surface:
//
//   snapshotStatements / deleteSendStatements — the send-record rows (`order_sends` +
//     `order_send_lines`) as prepared statements, composed into the SAME D1 batch as
//     the in-cart advance (the send exists iff the advance succeeded; the cart-write
//     rollback deletes it). Insert-or-ignore, so the satellite's deterministic send id
//     (= the order-list id) makes a replayed receipt converge instead of double-record.
//
//   recordPurchaseAssertion — the ONE writer that materializes `spend_events`, called
//     from exactly the two shared assertion ops (`updateGroceryRow`'s guarded
//     in_cart → ordered advance; `advanceOrderedRows` on the satellite mark-placed
//     path) and NEVER from a surface. It copies each row's `(sent_in, line_key)`
//     snapshot line VERBATIM — no re-pricing, no re-derivation; a pending NULL
//     department copies as NULL (the ingredient-category cron fills both rows) —
//     idempotent on the `(send_id, line_key)` primary key. A row without a send
//     linkage (or whose snapshot line is missing) is skipped: no assertion-time
//     fabrication, ever.
//
//   voidSpendEvents — re-listing an `ordered` row voids its materialized events
//     (`voided_at` stamp, never a delete — keep-forever retention; reads filter
//     voided events out).
//
//   readSpendAnalyzer — the retrospective's read-only 4/8/12-week UTC ISO aggregate
//     over non-voided events, qualifying cooking rows, the awaiting-mark-placed count,
//     and weekly budget. Plain bounded SQL + arithmetic; no LLM or analyzer cron.
//
// All D1 access goes through src/db.ts (structured `storage_error`, never a raw throw
// toward tools). Reads are tenant-scoped: `order_send_lines` carries no tenant column,
// so the materializer joins through `order_sends.tenant`.

import type { Env } from "./env.js";
import { db } from "./db.js";
import { COST_PER_MEAL_EXCLUDED } from "./department.js";
import type { ShopReceiptLine } from "@yamp/contract";
import type {
  BreakdownItem,
  ClassificationCoverage,
  CostPerMealKpi,
  CoverageStatus,
  MonetaryCoverage,
  SavingsCoverage,
  SpendAnalyzer,
  SpendBreakdown,
  SpendDriver,
  SpendRange,
  SpendWeek,
  TrendKpi,
} from "./spend-shapes.js";

export type {
  BreakdownItem,
  ClassificationCoverage,
  CostPerMealKpi,
  CoverageStatus,
  MonetaryCoverage,
  MoneyKpi,
  SavingsCoverage,
  SpendAnalyzer,
  SpendBreakdown,
  SpendDriver,
  SpendRange,
  SpendWeek,
  TrendKpi,
} from "./spend-shapes.js";

/** Shop-completion arm of the one spend writer. The immutable receipt line is the
 * source; deterministic send/line keys make a response-loss replay a no-op. */
export function shopReceiptSpendStatements(
  env: Env,
  tenant: string,
  sessionId: string,
  mode: "store_walk" | "manual_shop",
  store: string | null,
  occurredAt: string,
  lines: ShopReceiptLine[],
  gate: { requestHash: string; claimToken: string },
): D1PreparedStatement[] {
  const d = db(env);
  const sendId = `shop:${tenant}:${sessionId}`;
  return lines.filter((line) => line.domain === "grocery").map((line) => d.prepare(
    "INSERT INTO spend_events (send_id,line_key,tenant,occurred_on,name,sku,quantity,unit_price,amount,savings,estimated,department,provenance,store,fulfillment,voided_at,price_source) " +
      "SELECT ?1,?2,?3,?4,?5,NULL,?6,?7,?8,?9,1,?10,?11,?12,?13,NULL,?16 " +
      "WHERE EXISTS (SELECT 1 FROM shop_commits WHERE tenant=?3 AND session_id=?14 AND request_hash=?15 AND claim_token=?17) " +
      "ON CONFLICT(send_id,line_key) DO NOTHING",
    sendId, line.key, tenant, occurredAt.slice(0, 10), line.name, line.purchase_count,
    line.unit_price, line.amount, line.savings, line.department, line.provenance,
    store ?? "manual", mode, sessionId, gate.requestHash, line.price_source, gate.claimToken,
  ));
}

/** One send record — the flush-level identity of a snapshot. */
export interface SendSnapshot {
  /** place_order: minted per flush; satellite: the order-list id (deterministic). */
  id: string;
  tenant: string;
  /** 'kroger' | the satellite store slug. */
  store: string;
  locationId: string | null;
  fulfillment: "kroger_online" | "satellite";
  /** Satellite correlation; null on the Kroger path. */
  orderListId: string | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/** One send line — the per-line snapshot of what was sent and what was known. */
export interface SnapshotLine {
  /** === grocery_list.normalized_name (the canonical key the advance uses). */
  lineKey: string;
  /** Display at send. */
  name: string;
  sku: string | null;
  brand: string | null;
  size: string | null;
  /** Package count sent. */
  quantity: number;
  priceRegular: number | null;
  pricePromo: number | null;
  /** true/false, or null = unknown (satellite). */
  onSale: boolean | null;
  /** Effective per-package price: promo when on sale else regular; the satellite's
   *  observed product.price; null when unpriced. */
  unitPrice: number | null;
  /** deriveSavings(regular, promo) when on sale, else 0; null = unknown (satellite). */
  savings: number | null;
  /** 1 = fallback-priced (band 3's estimation ladder); send-path quotes are 0. */
  estimated: 0 | 1;
  /** D17 stamp; null ONLY while pending classification. */
  department: string | null;
  provenance: "planned" | "impulse";
  forRecipes: string[];
}

/**
 * The send-record inserts as prepared statements, for composition into the in-cart
 * advance's D1 batch. Insert-or-ignore on both tables: the `place_order` send id is
 * freshly minted (never collides), and the satellite's deterministic id makes the
 * residual double-intake replay converge instead of duplicating.
 */
export function snapshotStatements(
  env: Env,
  send: SendSnapshot,
  lines: SnapshotLine[],
): D1PreparedStatement[] {
  const d = db(env);
  const stmts: D1PreparedStatement[] = [
    d.prepare(
      "INSERT INTO order_sends (id, tenant, store, location_id, fulfillment, order_list_id, created_at) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(id) DO NOTHING",
      send.id,
      send.tenant,
      send.store,
      send.locationId,
      send.fulfillment,
      send.orderListId,
      send.createdAt,
    ),
  ];
  for (const line of lines) {
    stmts.push(
      d.prepare(
        "INSERT INTO order_send_lines (send_id, line_key, name, sku, brand, size, quantity, " +
          "price_regular, price_promo, on_sale, unit_price, savings, estimated, department, provenance, for_recipes) " +
          "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16) " +
          "ON CONFLICT(send_id, line_key) DO NOTHING",
        send.id,
        line.lineKey,
        line.name,
        line.sku,
        line.brand,
        line.size,
        line.quantity,
        line.priceRegular,
        line.pricePromo,
        line.onSale === null ? null : line.onSale ? 1 : 0,
        line.unitPrice,
        line.savings,
        line.estimated,
        line.department,
        line.provenance,
        JSON.stringify(line.forRecipes),
      ),
    );
  }
  return stmts;
}

/** The rollback compensation: delete the send record + its lines (a failed cart write
 *  means nothing was sent — no phantom order survives). Composed into the rollback batch. */
export function deleteSendStatements(env: Env, sendId: string): D1PreparedStatement[] {
  const d = db(env);
  return [
    d.prepare("DELETE FROM order_send_lines WHERE send_id = ?1", sendId),
    d.prepare("DELETE FROM order_sends WHERE id = ?1", sendId),
  ];
}

/** One asserted row as the shared status ops hand it to the writer: the row's send
 *  linkage (`grocery_list.sent_in`) + its stored canonical key. */
export interface AssertedRow {
  sendId: string;
  lineKey: string;
}

/** A snapshot line joined with its send's store/fulfillment (the materializer's read). */
interface SnapshotLineRow {
  send_id: string;
  line_key: string;
  name: string;
  sku: string | null;
  quantity: number;
  unit_price: number | null;
  savings: number | null;
  estimated: number;
  department: string | null;
  provenance: string;
  store: string;
  fulfillment: string;
}

/**
 * The ONE spend writer (D16's materialize phase): for each asserted row that carries a
 * send linkage, load its `(send_id, line_key)` snapshot line (tenant-scoped through the
 * send row) and INSERT OR IGNORE a `spend_events` row copying it VERBATIM —
 * `amount = unit_price × quantity` (null when unpriced), department as stored (a pending
 * NULL copies as NULL), provenance/store/fulfillment from the snapshot. Idempotent on
 * the `(send_id, line_key)` PK, so a replayed assertion converges. Rows without a
 * linkage, or whose snapshot line is missing (a degraded send), are skipped — a
 * purchase assertion never fabricates a price. Called ONLY from the shared status ops
 * (`updateGroceryRow`, `advanceOrderedRows`); no tool or route writes spend directly.
 * `recorded` counts MATCHED snapshot lines, not new inserts — a fully-replayed
 * assertion still reports every matched line even though ON CONFLICT inserted nothing.
 */
export async function purchaseAssertionStatements(
  env: Env,
  tenant: string,
  rows: AssertedRow[],
  occurredOn: string,
  gate?: { placementToken: string },
): Promise<{ statements: D1PreparedStatement[]; recorded: number }> {
  if (rows.length === 0) return { statements: [], recorded: 0 };
  const d = db(env);

  // Group by send id and load each send's asserted snapshot lines in one query,
  // tenant-scoped through the send row (order_send_lines has no tenant column).
  const bySend = new Map<string, string[]>();
  for (const row of rows) {
    const keys = bySend.get(row.sendId) ?? [];
    keys.push(row.lineKey);
    bySend.set(row.sendId, keys);
  }

  const stmts: D1PreparedStatement[] = [];
  let recorded = 0;
  for (const [sendId, keys] of bySend) {
    const placeholders = keys.map((_, i) => `?${i + 3}`).join(", ");
    const lines = await d.all<SnapshotLineRow>(
      "SELECT l.send_id, l.line_key, l.name, l.sku, l.quantity, l.unit_price, l.savings, " +
        "l.estimated, l.department, l.provenance, s.store, s.fulfillment " +
        "FROM order_send_lines l JOIN order_sends s ON s.id = l.send_id " +
        `WHERE s.tenant = ?1 AND l.send_id = ?2 AND l.line_key IN (${placeholders})`,
      tenant,
      sendId,
      ...keys,
    );
    for (const l of lines) {
      const amount = l.unit_price == null ? null : Math.round(l.unit_price * l.quantity * 100) / 100;
      stmts.push(
        d.prepare(
          "INSERT INTO spend_events (send_id, line_key, tenant, occurred_on, name, sku, quantity, " +
            "unit_price, amount, savings, estimated, department, provenance, store, fulfillment, voided_at) " +
            `SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, NULL${gate ? " WHERE EXISTS (SELECT 1 FROM order_sends WHERE id=?1 AND tenant=?3 AND placement_token=?16)" : ""} ` +
            "ON CONFLICT(send_id, line_key) DO NOTHING",
          l.send_id,
          l.line_key,
          tenant,
          occurredOn,
          l.name,
          l.sku,
          l.quantity,
          l.unit_price,
          amount,
          l.savings,
          l.estimated,
          l.department,
          l.provenance,
          l.store,
          l.fulfillment,
          ...(gate ? [gate.placementToken] : []),
        ),
      );
      recorded++;
    }
  }
  return { statements: stmts, recorded };
}

export async function recordPurchaseAssertion(
  env: Env,
  tenant: string,
  rows: AssertedRow[],
  occurredOn: string,
): Promise<{ recorded: number }> {
  const built = await purchaseAssertionStatements(env, tenant, rows, occurredOn);
  if (built.statements.length > 0) await db(env).batch(built.statements);
  return { recorded: built.recorded };
}

/**
 * Void the materialized events for rows leaving `ordered` (re-listed in either
 * direction): stamp `voided_at` where not already voided — never a delete (audit +
 * keep-forever retention). Reads filter `voided_at IS NULL`.
 */
export async function voidSpendEvents(env: Env, tenant: string, rows: AssertedRow[]): Promise<void> {
  if (rows.length === 0) return;
  const d = db(env);
  const voidedAt = new Date().toISOString();
  const stmts = rows.map((row) =>
    d.prepare(
      "UPDATE spend_events SET voided_at = ?1 WHERE tenant = ?2 AND send_id = ?3 AND line_key = ?4 AND voided_at IS NULL",
      voidedAt,
      tenant,
      row.sendId,
      row.lineKey,
    ),
  );
  await d.batch(stmts);
}

// --- the bounded retrospective spend read (Band 4) ---------------------------------

export const SPEND_RANGE_WEEKS: Readonly<Record<SpendRange, 4 | 8 | 12>> = {
  "4w": 4,
  "8w": 8,
  "12w": 12,
};
export const SPEND_DRIVER_CAP = 6 as const;
export const SPEND_INSIGHT_TEMPLATES = {
  empty: "No recorded spend in this range.",
  unavailable: "Spend is unavailable because none of the recorded purchases in this range has a usable price.",
  partialPrefix: "Known spend is incomplete: ",
} as const;

/** Backward-compatible name for the retrospective's Spend object. */
export type SpendSection = SpendAnalyzer;

interface SpendEventRow {
  send_id: string;
  line_key: string;
  occurred_on: string;
  name: string;
  amount: number | null;
  savings: number | null;
  estimated: number;
  department: string | null;
  provenance: string;
  store: string;
}

export interface SpendBounds {
  asOf: string;
  selectedStart: string;
  priorStart: string;
  priorEnd: string;
  starts: string[];
}

export function addUtcDays(isoDate: string, days: number): string {
  const value = new Date(`${isoDate}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** The Monday (ISO date) of the ISO week containing an ISO date. */
function isoWeekStart(isoDate: string): string {
  const value = new Date(`${isoDate}T00:00:00.000Z`);
  return addUtcDays(isoDate, -((value.getUTCDay() + 6) % 7));
}

export function spendBounds(range: SpendRange, now: Date): SpendBounds {
  const asOf = now.toISOString().slice(0, 10);
  const count = SPEND_RANGE_WEEKS[range];
  const currentStart = isoWeekStart(asOf);
  const selectedStart = addUtcDays(currentStart, -(count - 1) * 7);
  const priorStart = addUtcDays(selectedStart, -count * 7);
  const priorEnd = addUtcDays(asOf, -count * 7);
  const starts = Array.from({ length: count }, (_, index) => addUtcDays(selectedStart, index * 7));
  return { asOf, selectedStart, priorStart, priorEnd, starts };
}

export function toCents(value: number): number {
  return Math.round(value * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

function roundCurrency(value: number): number {
  return fromCents(toCents(value));
}

export function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

export function compareRawKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function presentationLabel(key: string): string {
  return key
    .split(/[_-]+/)
    .map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function monetaryCoverage(rows: SpendEventRow[]): MonetaryCoverage {
  let priced = 0;
  let unpriced = 0;
  let estimated = 0;
  let knownCents = 0;
  for (const row of rows) {
    if (row.amount == null) unpriced++;
    else {
      priced++;
      knownCents += toCents(row.amount);
    }
    if (row.estimated) estimated++;
  }
  const status: CoverageStatus = rows.length === 0
    ? "empty"
    : priced === 0
      ? "unavailable"
      : unpriced > 0 || estimated > 0
        ? "partial"
        : "complete";
  return {
    status,
    event_count: rows.length,
    priced_event_count: priced,
    unpriced_event_count: unpriced,
    estimated_event_count: estimated,
    known_amount: fromCents(knownCents),
  };
}

function departmentCoverage(rows: SpendEventRow[]): ClassificationCoverage {
  const classified = rows.filter((row) => row.department != null).length;
  const pending = rows.length - classified;
  const status: CoverageStatus = rows.length === 0
    ? "empty"
    : classified === 0
      ? "unavailable"
      : pending > 0
        ? "partial"
        : "complete";
  return {
    status,
    event_count: rows.length,
    classified_event_count: classified,
    pending_event_count: pending,
  };
}

function savingsCoverage(rows: SpendEventRow[]): SavingsCoverage {
  let known = 0;
  let knownCents = 0;
  for (const row of rows) {
    if (row.savings != null) {
      known++;
      knownCents += toCents(row.savings);
    }
  }
  const unknown = rows.length - known;
  const status: CoverageStatus = rows.length === 0
    ? "empty"
    : known === 0
      ? "unavailable"
      : unknown > 0
        ? "partial"
        : "complete";
  return {
    status,
    event_count: rows.length,
    known_event_count: known,
    unknown_event_count: unknown,
    known_savings: fromCents(knownCents),
  };
}

function overallStatus(monetary: MonetaryCoverage, department: ClassificationCoverage): CoverageStatus {
  if (monetary.event_count === 0) return "empty";
  if (monetary.status === "unavailable") return "unavailable";
  if (monetary.status === "partial" || department.status !== "complete") return "partial";
  return "complete";
}

function makeBreakdown(
  rows: SpendEventRow[],
  keyFor: (row: SpendEventRow) => string | null,
  knownDenominatorCents: number,
  status: CoverageStatus,
): SpendBreakdown {
  const groups = new Map<string, { amountCents: number; events: number; priced: number; unpriced: number }>();
  for (const row of rows) {
    const key = keyFor(row);
    if (key == null) continue;
    const group = groups.get(key) ?? { amountCents: 0, events: 0, priced: 0, unpriced: 0 };
    group.events++;
    if (row.amount == null) group.unpriced++;
    else {
      group.priced++;
      group.amountCents += toCents(row.amount);
    }
    groups.set(key, group);
  }
  const items = [...groups.entries()].map(([key, group]): BreakdownItem => ({
    key,
    label: presentationLabel(key),
    amount: fromCents(group.amountCents),
    event_count: group.events,
    priced_event_count: group.priced,
    unpriced_event_count: group.unpriced,
    percentage: knownDenominatorCents === 0 ? null : roundPercent(group.amountCents / knownDenominatorCents * 100),
  })).sort((a, b) => b.amount - a.amount || compareRawKeys(a.key, b.key));
  return { known_denominator: fromCents(knownDenominatorCents), status, items };
}

function topDrivers(rows: SpendEventRow[], knownDenominatorCents: number): SpendAnalyzer["top_drivers"] {
  const groups = new Map<string, {
    amountCents: number;
    events: number;
    priced: number;
    unpriced: number;
    representative: SpendEventRow;
  }>();
  for (const row of rows) {
    const prior = groups.get(row.line_key);
    const later = prior == null || row.occurred_on > prior.representative.occurred_on ||
      (row.occurred_on === prior.representative.occurred_on && row.send_id > prior.representative.send_id);
    const group = prior ?? { amountCents: 0, events: 0, priced: 0, unpriced: 0, representative: row };
    group.events++;
    if (row.amount == null) group.unpriced++;
    else {
      group.priced++;
      group.amountCents += toCents(row.amount);
    }
    if (later) group.representative = row;
    groups.set(row.line_key, group);
  }
  const eligible = [...groups.entries()].filter(([, group]) => group.priced > 0);
  const items = eligible.map(([key, group]): SpendDriver => ({
    key,
    name: group.representative.name,
    department: group.representative.department == null
      ? null
      : { key: group.representative.department, label: presentationLabel(group.representative.department) },
    amount: fromCents(group.amountCents),
    event_count: group.events,
    priced_event_count: group.priced,
    unpriced_event_count: group.unpriced,
    percentage: knownDenominatorCents === 0 ? null : roundPercent(group.amountCents / knownDenominatorCents * 100),
  })).sort((a, b) => b.amount - a.amount || b.event_count - a.event_count || compareRawKeys(a.key, b.key));
  return { cap: SPEND_DRIVER_CAP, total_count: eligible.length, items: items.slice(0, SPEND_DRIVER_CAP) };
}

function joinInsightClauses(clauses: string[]): string {
  if (clauses.length <= 1) return clauses[0] ?? "";
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`;
  return `${clauses.slice(0, -1).join(", ")}, and ${clauses.at(-1)}`;
}

function insightFor(
  status: CoverageStatus,
  monetary: MonetaryCoverage,
  department: ClassificationCoverage,
  departmentBreakdown: SpendBreakdown,
  provenanceBreakdown: SpendBreakdown,
  trend: TrendKpi,
): string {
  if (status === "empty") return SPEND_INSIGHT_TEMPLATES.empty;
  if (monetary.status === "unavailable") return SPEND_INSIGHT_TEMPLATES.unavailable;
  if (status === "partial") {
    const clauses: string[] = [];
    if (monetary.unpriced_event_count > 0) {
      clauses.push(`${monetary.unpriced_event_count} ${monetary.unpriced_event_count === 1 ? "purchase had" : "purchases had"} no usable price`);
    }
    if (monetary.estimated_event_count > 0) {
      clauses.push(`${monetary.estimated_event_count} ${monetary.estimated_event_count === 1 ? "purchase used" : "purchases used"} an estimated price`);
    }
    if (department.pending_event_count > 0) {
      clauses.push(`${department.pending_event_count} ${department.pending_event_count === 1 ? "purchase is" : "purchases are"} awaiting department classification`);
    }
    return `${SPEND_INSIGHT_TEMPLATES.partialPrefix}${joinInsightClauses(clauses)}.`;
  }

  const topDepartment = departmentBreakdown.items[0]!;
  let insight = `${topDepartment.label} was the largest department at $${topDepartment.amount.toFixed(2)}.`;
  if (monetary.known_amount > 0) {
    const planned = provenanceBreakdown.items.find((item) => item.key === "planned")?.percentage ?? 0;
    const impulse = provenanceBreakdown.items.find((item) => item.key === "impulse")?.percentage ?? 0;
    insight += ` Planned purchases were ${planned.toFixed(1)}% of known spend; impulse purchases were ${impulse.toFixed(1)}%.`;
  }
  if (trend.status === "available") {
    if (trend.percent! > 0) insight += ` Spend was ${trend.percent!.toFixed(1)}% higher than the matched prior range.`;
    else if (trend.percent! < 0) insight += ` Spend was ${Math.abs(trend.percent!).toFixed(1)}% lower than the matched prior range.`;
    else insight += " Spend was unchanged from the matched prior range.";
  }
  return insight;
}

/**
 * Compute one tenant's bounded Spend analyzer over immutable captured facts. All four
 * reads are tenant-scoped; date-bearing history has inclusive lower and upper bounds.
 * Reduction is deterministic and has no write, cache, queue, or scheduled side effect.
 */
export async function readSpendAnalyzer(
  env: Env,
  tenant: string,
  range: SpendRange,
  now: Date = new Date(),
): Promise<SpendAnalyzer> {
  const d = db(env);
  const bounds = spendBounds(range, now);
  const [profileRow, allEvents, mealRow, awaiting] = await Promise.all([
    d.first<{ weekly_budget: number | null }>("SELECT weekly_budget FROM profile WHERE tenant = ?1", tenant),
    d.all<SpendEventRow>(
      "SELECT send_id, line_key, occurred_on, name, amount, savings, estimated, department, provenance, store " +
        "FROM spend_events WHERE tenant = ?1 AND voided_at IS NULL AND occurred_on >= ?2 AND occurred_on <= ?3 " +
        "ORDER BY occurred_on ASC, send_id ASC, line_key ASC",
      tenant,
      bounds.priorStart,
      bounds.asOf,
    ),
    d.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM cooking_log " +
        "WHERE tenant = ?1 AND date >= ?2 AND date <= ?3 AND type IN ('recipe', 'ad_hoc')",
      tenant,
      bounds.selectedStart,
      bounds.asOf,
    ),
    d.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM grocery_list WHERE tenant = ?1 AND status = 'in_cart' AND sent_in IS NOT NULL",
      tenant,
    ),
  ]);

  const selected = allEvents.filter((row) => row.occurred_on >= bounds.selectedStart);
  const prior = allEvents.filter((row) => row.occurred_on <= bounds.priorEnd);
  const monetary = monetaryCoverage(selected);
  const department = departmentCoverage(selected);
  const savings = savingsCoverage(selected);
  const status = overallStatus(monetary, department);
  const priorMonetary = monetaryCoverage(prior);
  const weeklyBudget = profileRow?.weekly_budget != null && profileRow.weekly_budget > 0
    ? roundCurrency(profileRow.weekly_budget)
    : null;

  const weeks = bounds.starts.map((weekStart): SpendWeek => {
    const weekEnd = addUtcDays(weekStart, 6);
    const through = weekEnd < bounds.asOf ? weekEnd : bounds.asOf;
    const rows = selected.filter((row) => row.occurred_on >= weekStart && row.occurred_on <= through);
    const weekMonetary = monetaryCoverage(rows);
    const weekDepartment = departmentCoverage(rows);
    const weekSavings = savingsCoverage(rows);
    const overBudget = weeklyBudget == null
      ? null
      : toCents(weekMonetary.known_amount) > toCents(weeklyBudget)
        ? true
        : weekMonetary.status === "partial" || weekMonetary.status === "unavailable"
          ? null
          : false;
    return {
      week_start: weekStart,
      total: weekMonetary.known_amount,
      savings: weekSavings.known_savings,
      events: rows.length,
      estimated: weekMonetary.estimated_event_count,
      week_end: weekEnd,
      through,
      is_partial: through < weekEnd,
      status: overallStatus(weekMonetary, weekDepartment),
      monetary_coverage: weekMonetary,
      department_coverage: weekDepartment,
      savings_coverage: weekSavings,
      over_budget: overBudget,
    };
  });

  const currentIncomplete = monetary.status === "partial" || monetary.status === "unavailable";
  const priorIncomplete = priorMonetary.status === "partial" || priorMonetary.status === "unavailable";
  let trend: TrendKpi;
  if (currentIncomplete) {
    trend = {
      percent: null,
      current_known_amount: monetary.known_amount,
      prior_known_amount: priorMonetary.known_amount,
      status: "unavailable",
      reason: "current_incomplete",
    };
  } else if (priorIncomplete) {
    trend = {
      percent: null,
      current_known_amount: monetary.known_amount,
      prior_known_amount: priorMonetary.known_amount,
      status: "unavailable",
      reason: "prior_incomplete",
    };
  } else if (priorMonetary.known_amount === 0) {
    trend = {
      percent: null,
      current_known_amount: monetary.known_amount,
      prior_known_amount: 0,
      status: "unavailable",
      reason: "prior_zero",
    };
  } else {
    trend = {
      percent: roundPercent((monetary.known_amount - priorMonetary.known_amount) / priorMonetary.known_amount * 100),
      current_known_amount: monetary.known_amount,
      prior_known_amount: priorMonetary.known_amount,
      status: "available",
      reason: null,
    };
  }

  const eligible = selected.filter((row) =>
    row.department != null && !(COST_PER_MEAL_EXCLUDED as readonly string[]).includes(row.department));
  const knownNumeratorCents = eligible.reduce(
    (sum, row) => sum + (row.amount == null ? 0 : toCents(row.amount)),
    0,
  );
  const hasPricedEligible = eligible.some((row) => row.amount != null);
  const numeratorIncomplete = selected.some((row) => row.department == null) ||
    eligible.some((row) => row.amount == null || Boolean(row.estimated));
  const numeratorStatus: CoverageStatus = selected.length === 0
    ? "empty"
    : numeratorIncomplete
      ? hasPricedEligible ? "partial" : "unavailable"
      : "complete";
  const mealCount = mealRow?.n ?? 0;
  let costPerMeal: CostPerMealKpi;
  if (mealCount === 0) {
    costPerMeal = {
      amount: null,
      known_numerator: fromCents(knownNumeratorCents),
      meal_count: 0,
      status: "unavailable",
      reason: "zero_meals",
    };
  } else if (numeratorStatus === "unavailable") {
    costPerMeal = {
      amount: null,
      known_numerator: fromCents(knownNumeratorCents),
      meal_count: mealCount,
      status: "unavailable",
      reason: "numerator_unavailable",
    };
  } else {
    costPerMeal = {
      amount: roundCurrency(fromCents(knownNumeratorCents) / mealCount),
      known_numerator: fromCents(knownNumeratorCents),
      meal_count: mealCount,
      status: numeratorStatus,
      reason: null,
    };
  }

  const totalKnownCents = toCents(monetary.known_amount);
  const classifiedKnownCents = selected.reduce(
    (sum, row) => sum + (row.department != null && row.amount != null ? toCents(row.amount) : 0),
    0,
  );
  const departmentBreakdown = makeBreakdown(selected, (row) => row.department, classifiedKnownCents, status);
  const storeBreakdown = makeBreakdown(selected, (row) => row.store, totalKnownCents, monetary.status);
  const provenanceBreakdown = makeBreakdown(selected, (row) => row.provenance, totalKnownCents, monetary.status);

  const analyzer: SpendAnalyzer = {
    range,
    as_of: bounds.asOf,
    selected_start: bounds.selectedStart,
    selected_end: bounds.asOf,
    prior_start: bounds.priorStart,
    prior_end: bounds.priorEnd,
    status,
    coverage: { monetary, department, savings },
    weekly_budget: weeklyBudget,
    weeks,
    awaiting_mark_placed: awaiting?.n ?? 0,
    kpis: {
      total_spend: {
        amount: monetary.status === "unavailable" ? null : monetary.known_amount,
        status: monetary.status,
      },
      average_per_week: {
        amount: monetary.status === "unavailable" ? null : roundCurrency(monetary.known_amount / SPEND_RANGE_WEEKS[range]),
        status: monetary.status,
      },
      cost_per_meal: costPerMeal,
      trend,
    },
    breakdowns: {
      department: departmentBreakdown,
      store: storeBreakdown,
      provenance: provenanceBreakdown,
    },
    top_drivers: topDrivers(selected, totalKnownCents),
    insight: "",
  };
  analyzer.insight = insightFor(status, monetary, department, departmentBreakdown, provenanceBreakdown, trend);
  return analyzer;
}

/** Compatible four-week adapter; all aggregation delegates to `readSpendAnalyzer`. */
export function readSpendSection(env: Env, tenant: string, now: Date = new Date()): Promise<SpendSection> {
  return readSpendAnalyzer(env, tenant, "4w", now);
}
