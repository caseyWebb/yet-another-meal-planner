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
//   readSpendSection — the retrospective's read-only spend aggregate (trailing 4 ISO
//     weeks over non-voided events + the awaiting-mark-placed count + the weekly
//     budget). Plain SQL + arithmetic; no LLM in the read path.
//
// All D1 access goes through src/db.ts (structured `storage_error`, never a raw throw
// toward tools). Reads are tenant-scoped: `order_send_lines` carries no tenant column,
// so the materializer joins through `order_sends.tenant`.

import type { Env } from "./env.js";
import { db } from "./db.js";
import type { ShopReceiptLine } from "@yamp/contract";

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
  gate: { requestHash: string },
): D1PreparedStatement[] {
  const d = db(env);
  const sendId = `shop:${tenant}:${sessionId}`;
  return lines.filter((line) => line.domain === "grocery").map((line) => d.prepare(
    "INSERT INTO spend_events (send_id,line_key,tenant,occurred_on,name,sku,quantity,unit_price,amount,savings,estimated,department,provenance,store,fulfillment,voided_at) " +
      "SELECT ?1,?2,?3,?4,?5,NULL,?6,?7,?8,?9,1,?10,?11,?12,?13,NULL " +
      "WHERE EXISTS (SELECT 1 FROM shop_commits WHERE tenant=?3 AND session_id=?14 AND request_hash=?15) " +
      "ON CONFLICT(send_id,line_key) DO NOTHING",
    sendId, line.key, tenant, occurredAt.slice(0, 10), line.name, line.purchase_count,
    line.unit_price, line.amount, line.savings, line.department, line.provenance,
    store ?? "manual", mode, sessionId, gate.requestHash,
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

// --- the retrospective spend read (design D8) ---------------------------------------

/** One trailing ISO week's aggregate over non-voided spend events. */
export interface SpendWeek {
  /** The week's Monday (ISO date). */
  week_start: string;
  /** Sum of non-null `amount` (cents-rounded). */
  total: number;
  /** Sum of non-null `savings` (cents-rounded). */
  savings: number;
  /** Non-voided events in the week. */
  events: number;
  /** Of those, how many are fallback-priced (`estimated = 1`). */
  estimated: number;
}

/** The retrospective's read-only spend section (band 1; band 4's analyzer extends it). */
export interface SpendSection {
  weekly_budget: number | null;
  /** Trailing 4 ISO weeks (Monday starts), newest last. */
  weeks: SpendWeek[];
  /** Current `in_cart` rows carrying a send linkage — D16's "awaiting mark-placed"
   *  surface: sent but never user-asserted, never auto-counted as spend. */
  awaiting_mark_placed: number;
}

/** The Monday (ISO date) of the ISO week containing `d` (UTC). */
function isoWeekStart(d: Date): string {
  const day = d.getUTCDay(); // 0 = Sunday
  const monday = new Date(d);
  monday.setUTCDate(monday.getUTCDate() - ((day + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

/**
 * Compute the household's spend section: the trailing 4 ISO weeks' totals over
 * non-voided events (weeks always present, zeroed when empty; newest last), the
 * caller's `weekly_budget` (null when unset), and the awaiting-mark-placed count.
 * Independent of the retrospective `period` (a fixed trailing window, like `underused`).
 */
export async function readSpendSection(env: Env, tenant: string, now: Date = new Date()): Promise<SpendSection> {
  const d = db(env);

  // The 4 week buckets, oldest → newest.
  const starts: string[] = [];
  for (let i = 3; i >= 0; i--) {
    const ref = new Date(now);
    ref.setUTCDate(ref.getUTCDate() - i * 7);
    starts.push(isoWeekStart(ref));
  }
  const weeks = new Map<string, SpendWeek>(
    starts.map((week_start) => [week_start, { week_start, total: 0, savings: 0, events: 0, estimated: 0 }]),
  );

  const [profileRow, events, awaiting] = await Promise.all([
    d.first<{ weekly_budget: number | null }>("SELECT weekly_budget FROM profile WHERE tenant = ?1", tenant),
    d.all<{ occurred_on: string; amount: number | null; savings: number | null; estimated: number }>(
      "SELECT occurred_on, amount, savings, estimated FROM spend_events " +
        "WHERE tenant = ?1 AND voided_at IS NULL AND occurred_on >= ?2",
      tenant,
      starts[0],
    ),
    d.first<{ n: number }>(
      "SELECT COUNT(*) AS n FROM grocery_list WHERE tenant = ?1 AND status = 'in_cart' AND sent_in IS NOT NULL",
      tenant,
    ),
  ]);

  for (const e of events) {
    const bucket = weeks.get(isoWeekStart(new Date(`${e.occurred_on}T00:00:00Z`)));
    if (!bucket) continue; // an occurred_on beyond the newest Monday can't exist (occurred_on <= now)
    bucket.events++;
    if (e.amount != null) bucket.total = Math.round((bucket.total + e.amount) * 100) / 100;
    if (e.savings != null) bucket.savings = Math.round((bucket.savings + e.savings) * 100) / 100;
    if (e.estimated) bucket.estimated++;
  }

  return {
    weekly_budget: profileRow?.weekly_budget ?? null,
    weeks: starts.map((s) => weeks.get(s)!),
    awaiting_mark_placed: awaiting?.n ?? 0,
  };
}
