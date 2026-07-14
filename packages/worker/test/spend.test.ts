// Spend telemetry (spend-capture-on-order-commit, D16) over the REAL-SQLite env with
// the actual migration DDL: snapshot-at-send rides the advance batch atomically,
// materialize-at-assertion copies the snapshot VERBATIM through the one shared writer
// (idempotent on (send_id, line_key)), the negative rules are enforced in the shared
// ops (no linkage → no spend; leaving the flight without an assertion clears the
// linkage; re-listing an ordered row VOIDS, never deletes; removes never write spend),
// and the retrospective spend section aggregates non-voided events only.
import { describe, it, expect } from "vitest";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";
import { db } from "../src/db.js";
import {
  addGroceryRow,
  updateGroceryRow,
  removeGroceryRow,
  advanceInCartRows,
  finalizeInCartClaim,
  rollbackInCartRows,
  advanceOrderedRows,
  type SendBatch,
} from "../src/session-db.js";
import { loadRetrospective } from "../src/cooking-tools.js";
import {
  snapshotStatements,
  deleteSendStatements,
  recordPurchaseAssertion,
  voidSpendEvents,
  readSpendAnalyzer,
  readSpendSection,
  type SendSnapshot,
  type SnapshotLine,
} from "../src/spend.js";

const TODAY = "2026-07-11";
const T = "casey";

function sendOf(h: SqliteEnv, id: string, over: Partial<SendSnapshot> = {}): SendSnapshot {
  void h;
  return {
    id,
    tenant: T,
    store: "kroger",
    locationId: "loc-1",
    fulfillment: "kroger_online",
    orderListId: null,
    createdAt: `${TODAY}T12:00:00.000Z`,
    ...over,
  };
}

function lineOf(key: string, over: Partial<SnapshotLine> = {}): SnapshotLine {
  return {
    lineKey: key,
    name: key,
    sku: `SKU-${key}`,
    brand: "Store Brand",
    size: null,
    quantity: 2,
    priceRegular: 4.99,
    pricePromo: 3.99,
    onSale: true,
    unitPrice: 3.99,
    savings: 1.0,
    estimated: 0,
    department: null, // pending — the capture races the classifier
    provenance: "planned",
    forRecipes: ["stew"],
    ...over,
  };
}

/** Advance `keys` to in_cart with a send snapshot composed into the same batch. */
async function flushAdvance(h: SqliteEnv, sendId: string, lines: SnapshotLine[]): Promise<void> {
  const send: SendBatch = {
    id: sendId,
    statements: snapshotStatements(h.env, sendOf(h, sendId), lines),
  };
  await advanceInCartRows(h.env, T, lines.map((l) => ({ name: l.name, key: l.lineKey })), TODAY, send);
}

describe("snapshot at send — the advance batch", () => {
  it("the send record + lines land in the SAME batch as the advance, stamping sent_in", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    await flushAdvance(h, "SEND-1", [lineOf("chicken")]);

    const rows = h.rows<{ normalized_name: string; status: string; sent_in: string | null }>("grocery_list");
    expect(rows).toEqual([expect.objectContaining({ normalized_name: "chicken", status: "in_cart", sent_in: "SEND-1" })]);
    expect(h.rows("order_sends")).toEqual([
      expect.objectContaining({ id: "SEND-1", tenant: T, store: "kroger", fulfillment: "kroger_online" }),
    ]);
    expect(h.rows("order_send_lines")).toEqual([
      expect.objectContaining({
        send_id: "SEND-1",
        line_key: "chicken",
        quantity: 2,
        price_regular: 4.99,
        price_promo: 3.99,
        on_sale: 1,
        unit_price: 3.99,
        savings: 1.0,
        estimated: 0,
        department: null,
        provenance: "planned",
        for_recipes: '["stew"]',
      }),
    ]);
  });

  it("the send exists IFF the advance succeeded: a failing batch lands neither", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    // Poison the send batch with a NOT NULL violation — the whole batch (snapshot +
    // advance upserts) rolls back atomically.
    const poisoned: SendBatch = {
      id: "SEND-BAD",
      statements: [
        ...snapshotStatements(h.env, sendOf(h, "SEND-BAD"), [lineOf("chicken")]),
        db(h.env).prepare("INSERT INTO order_sends (id, tenant, store, fulfillment, created_at) VALUES ('x', NULL, 's', 'f', 'c')"),
      ],
    };
    await expect(
      advanceInCartRows(h.env, T, [{ name: "chicken", key: "chicken" }], TODAY, poisoned),
    ).rejects.toMatchObject({ code: "storage_error" });
    expect(h.rows<{ status: string; sent_in: string | null }>("grocery_list")[0]).toMatchObject({
      status: "active",
      sent_in: null,
    });
    expect(h.rows("order_sends")).toHaveLength(0);
    expect(h.rows("order_send_lines")).toHaveLength(0);
  });

  it("a finalized bare advance leaves no linkage — a degraded flush never manufactures one", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    const lines = [{ name: "chicken", key: "chicken" }];
    const advance = await advanceInCartRows(h.env, T, lines, TODAY);
    await finalizeInCartClaim(h.env, T, lines, advance.claimId);
    expect(h.rows<{ status: string; sent_in: string | null }>("grocery_list")[0]).toMatchObject({
      status: "in_cart",
      sent_in: null,
    });
  });

  it("the rollback compensation deletes the send record and clears the linkage", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    // "flour" is advance-inserted (a plan-derived line with no stored row).
    await flushAdvance(h, "SEND-1", [lineOf("chicken"), lineOf("flour")]);
    expect(h.rows("grocery_list")).toHaveLength(2);

    await rollbackInCartRows(
      h.env,
      T,
      [
        { name: "chicken", key: "chicken" },
        { name: "flour", key: "flour" },
      ],
      ["flour"],
      "SEND-1",
    );
    // Pre-existing row back to active with no linkage; the inserted row deleted; no phantom send.
    expect(h.rows<{ normalized_name: string; status: string; sent_in: string | null }>("grocery_list")).toEqual([
      expect.objectContaining({ normalized_name: "chicken", status: "active", sent_in: null }),
    ]);
    expect(h.rows("order_sends")).toHaveLength(0);
    expect(h.rows("order_send_lines")).toHaveLength(0);
  });

  it("insert-or-ignore: a replayed snapshot with the same (deterministic) id converges", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    await flushAdvance(h, "OL-1", [lineOf("chicken", { unitPrice: 3.99 })]);
    // The replay observes a different price — the FIRST snapshot stands (never rewritten).
    await flushAdvance(h, "OL-1", [lineOf("chicken", { unitPrice: 9.99 })]);
    expect(h.rows("order_sends")).toHaveLength(1);
    const lines = h.rows<{ unit_price: number }>("order_send_lines");
    expect(lines).toHaveLength(1);
    expect(lines[0].unit_price).toBe(3.99);
  });
});

describe("materialize at the purchase assertion — the one writer", () => {
  it("the guarded in_cart → ordered advance copies the snapshot line VERBATIM", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    await flushAdvance(h, "SEND-1", [lineOf("chicken")]);

    await updateGroceryRow(h.env, T, "chicken", { status: "ordered" }, TODAY);

    const row = h.rows<{ status: string; sent_in: string | null; ordered_at: string }>("grocery_list")[0];
    expect(row).toMatchObject({ status: "ordered", sent_in: "SEND-1", ordered_at: TODAY });
    expect(h.rows("spend_events")).toEqual([
      expect.objectContaining({
        send_id: "SEND-1",
        line_key: "chicken",
        tenant: T,
        occurred_on: TODAY,
        sku: "SKU-chicken",
        quantity: 2,
        unit_price: 3.99,
        amount: 7.98, // unit_price × quantity — no live re-pricing at assertion time
        savings: 1.0,
        estimated: 0,
        department: null, // a pending NULL copies as NULL (the cron fills both rows)
        provenance: "planned",
        store: "kroger",
        fulfillment: "kroger_online",
        voided_at: null,
      }),
    ]);
  });

  it("is idempotent on (send_id, line_key): a replayed assertion converges to one event", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    await flushAdvance(h, "SEND-1", [lineOf("chicken")]);
    await updateGroceryRow(h.env, T, "chicken", { status: "ordered" }, TODAY);

    // A second `ordered` write is rejected by the W3 guard before the writer runs…
    await expect(updateGroceryRow(h.env, T, "chicken", { status: "ordered" }, TODAY)).rejects.toMatchObject({
      code: "validation_failed",
    });
    // …and even a direct writer replay is absorbed by the PK.
    await recordPurchaseAssertion(h.env, T, [{ sendId: "SEND-1", lineKey: "chicken" }], TODAY);
    expect(h.rows("spend_events")).toHaveLength(1);
  });

  it("an unpriced (satellite-shaped) snapshot materializes with NULL amount — never fabricated", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    await flushAdvance(h, "OL-1", [
      lineOf("chicken", { priceRegular: null, pricePromo: null, onSale: null, unitPrice: null, savings: null }),
    ]);
    await updateGroceryRow(h.env, T, "chicken", { status: "ordered" }, TODAY);
    expect(h.rows<{ unit_price: number | null; amount: number | null }>("spend_events")[0]).toMatchObject({
      unit_price: null,
      amount: null,
    });
  });

  it("the writer is tenant-scoped: another tenant's send id materializes nothing", async () => {
    const h = sqliteEnv([T, "everett"]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    await flushAdvance(h, "SEND-1", [lineOf("chicken")]);
    // everett asserts against casey's send — the tenant-scoped read finds no line.
    await recordPurchaseAssertion(h.env, "everett", [{ sendId: "SEND-1", lineKey: "chicken" }], TODAY);
    expect(h.rows("spend_events")).toHaveLength(0);
  });
});

describe("negative rules — no purchase assertion, no spend", () => {
  it("a manual active → in_cart move carries no linkage, so marking it ordered writes nothing", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    await updateGroceryRow(h.env, T, "chicken", { status: "in_cart" }, TODAY);
    expect(h.rows<{ sent_in: string | null }>("grocery_list")[0].sent_in).toBeNull();
    await updateGroceryRow(h.env, T, "chicken", { status: "ordered" }, TODAY);
    expect(h.rows("spend_events")).toHaveLength(0); // no send, no spend — nothing resurrected
  });

  it("in_cart → active clears the linkage and writes nothing (the snapshot never materializes)", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    await flushAdvance(h, "SEND-1", [lineOf("chicken")]);
    await updateGroceryRow(h.env, T, "chicken", { status: "active" }, TODAY);

    expect(h.rows<{ status: string; sent_in: string | null }>("grocery_list")[0]).toMatchObject({
      status: "active",
      sent_in: null,
    });
    expect(h.rows("spend_events")).toHaveLength(0);
    // The snapshot line still stands (audit) — it simply never materializes; and a
    // LATER re-advance + assertion under no send writes nothing either.
    expect(h.rows("order_send_lines")).toHaveLength(1);
    await updateGroceryRow(h.env, T, "chicken", { status: "in_cart" }, TODAY);
    await updateGroceryRow(h.env, T, "chicken", { status: "ordered" }, TODAY);
    expect(h.rows("spend_events")).toHaveLength(0);
  });

  it("re-listing an ordered row VOIDS its events (never deletes) and clears the linkage", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    await flushAdvance(h, "SEND-1", [lineOf("chicken")]);
    await updateGroceryRow(h.env, T, "chicken", { status: "ordered" }, TODAY);
    expect(h.rows("spend_events")).toHaveLength(1);

    await updateGroceryRow(h.env, T, "chicken", { status: "active" }, TODAY);
    const events = h.rows<{ voided_at: string | null }>("spend_events");
    expect(events).toHaveLength(1); // retained, not deleted
    expect(events[0].voided_at).not.toBeNull();
    expect(h.rows<{ sent_in: string | null; ordered_at: string | null }>("grocery_list")[0]).toMatchObject({
      sent_in: null,
      ordered_at: null,
    });
  });

  it("a bare removal of an in_cart row writes no spend — the linkage dies with the row", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    await flushAdvance(h, "SEND-1", [lineOf("chicken")]);
    const { found } = await removeGroceryRow(h.env, T, "chicken");
    expect(found).toBe(true);
    expect(h.rows("spend_events")).toHaveLength(0);
    expect(h.rows("grocery_list")).toHaveLength(0);
  });
});

describe("advanceOrderedRows — the satellite mark-placed assertion", () => {
  it("materializes linked rows idempotently across a replayed mark-placed", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    await addGroceryRow(h.env, T, { name: "paper towels", kind: "household" }, TODAY);
    await flushAdvance(h, "OL-1", [
      lineOf("chicken", { unitPrice: 6.49, priceRegular: null, pricePromo: null, onSale: null, savings: null }),
      lineOf("paper towels", { department: "household" }),
    ]);

    const lines = [
      { name: "chicken", key: "chicken" },
      { name: "paper towels", key: "paper towels" },
    ];
    await advanceOrderedRows(h.env, T, lines, TODAY);
    await advanceOrderedRows(h.env, T, lines, TODAY); // the helper's replay converges
    const events = h.rows<{ line_key: string; department: string | null }>("spend_events");
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.line_key === "paper towels")!.department).toBe("household");
  });

  it("a row with no linkage advances without writing spend", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    await updateGroceryRow(h.env, T, "chicken", { status: "in_cart" }, TODAY); // manual — no send
    await advanceOrderedRows(h.env, T, [{ name: "chicken", key: "chicken" }], TODAY);
    expect(h.rows<{ status: string }>("grocery_list")[0].status).toBe("ordered");
    expect(h.rows("spend_events")).toHaveLength(0);
  });
});

describe("voidSpendEvents / deleteSendStatements", () => {
  it("voids only the addressed (tenant, send, line) events, and only once", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    await addGroceryRow(h.env, T, { name: "flour" }, TODAY);
    await flushAdvance(h, "SEND-1", [lineOf("chicken"), lineOf("flour")]);
    await recordPurchaseAssertion(
      h.env,
      T,
      [
        { sendId: "SEND-1", lineKey: "chicken" },
        { sendId: "SEND-1", lineKey: "flour" },
      ],
      TODAY,
    );
    await voidSpendEvents(h.env, T, [{ sendId: "SEND-1", lineKey: "chicken" }]);
    const events = h.rows<{ line_key: string; voided_at: string | null }>("spend_events");
    expect(events.find((e) => e.line_key === "chicken")!.voided_at).not.toBeNull();
    expect(events.find((e) => e.line_key === "flour")!.voided_at).toBeNull();
    // Re-voiding does not restamp (voided_at IS NULL guard).
    const stamp = events.find((e) => e.line_key === "chicken")!.voided_at;
    await voidSpendEvents(h.env, T, [{ sendId: "SEND-1", lineKey: "chicken" }]);
    expect(h.rows<{ line_key: string; voided_at: string | null }>("spend_events").find((e) => e.line_key === "chicken")!.voided_at).toBe(stamp);
  });

  it("deleteSendStatements removes the send and its lines", async () => {
    const h = sqliteEnv([T]);
    await db(h.env).batch(snapshotStatements(h.env, sendOf(h, "SEND-1"), [lineOf("chicken")]));
    await db(h.env).batch(deleteSendStatements(h.env, "SEND-1"));
    expect(h.rows("order_sends")).toHaveLength(0);
    expect(h.rows("order_send_lines")).toHaveLength(0);
  });
});

describe("readSpendSection — the retrospective spend read", () => {
  const NOW = new Date("2026-07-11T18:00:00Z"); // Saturday; current ISO week starts 2026-07-06

  function seedEvent(h: SqliteEnv, over: Record<string, unknown> = {}): void {
    const row = {
      send_id: "S",
      line_key: "chicken",
      tenant: T,
      occurred_on: "2026-07-08",
      name: "chicken",
      sku: null,
      quantity: 1,
      unit_price: 5,
      amount: 5,
      savings: 0,
      estimated: 0,
      department: null,
      provenance: "planned",
      store: "kroger",
      fulfillment: "kroger_online",
      voided_at: null,
      ...over,
    };
    h.raw
      .prepare(
        "INSERT INTO spend_events (send_id, line_key, tenant, occurred_on, name, sku, quantity, unit_price, amount, savings, estimated, department, provenance, store, fulfillment, voided_at) " +
          "VALUES (:send_id, :line_key, :tenant, :occurred_on, :name, :sku, :quantity, :unit_price, :amount, :savings, :estimated, :department, :provenance, :store, :fulfillment, :voided_at)",
      )
      .run(row as never);
  }

  it("buckets non-voided events into the trailing 4 ISO weeks (newest last) and echoes the budget", async () => {
    const h = sqliteEnv([T]);
    h.raw.prepare("INSERT INTO profile (tenant, weekly_budget) VALUES (?, 95)").run(T);
    seedEvent(h, { line_key: "a", occurred_on: "2026-07-08", amount: 20.5, savings: 1.5 }); // week of 7/06
    seedEvent(h, { line_key: "b", occurred_on: "2026-07-06", amount: 9.5 }); // week of 7/06
    seedEvent(h, { line_key: "c", occurred_on: "2026-06-30", amount: 12, estimated: 1 }); // week of 6/29
    seedEvent(h, { line_key: "d", occurred_on: "2026-07-07", amount: 99, voided_at: "2026-07-09T00:00:00Z" }); // voided — excluded
    seedEvent(h, { line_key: "e", occurred_on: "2026-05-01", amount: 40 }); // outside the window

    const s = await readSpendSection(h.env, T, NOW);
    expect(s.weekly_budget).toBe(95);
    expect(s.weeks.map((w) => w.week_start)).toEqual(["2026-06-15", "2026-06-22", "2026-06-29", "2026-07-06"]);
    expect(s.weeks[3]).toMatchObject({ week_start: "2026-07-06", total: 30, savings: 1.5, events: 2, estimated: 0 });
    expect(s.weeks[2]).toMatchObject({ week_start: "2026-06-29", total: 12, savings: 0, events: 1, estimated: 1 });
    expect(s.weeks[0].events).toBe(0);
  });

  it("counts awaiting-mark-placed as current in_cart rows WITH a send linkage", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    await addGroceryRow(h.env, T, { name: "flour" }, TODAY);
    await flushAdvance(h, "SEND-1", [lineOf("chicken")]);
    await updateGroceryRow(h.env, T, "flour", { status: "in_cart" }, TODAY); // manual — no linkage

    expect((await readSpendSection(h.env, T, NOW)).awaiting_mark_placed).toBe(1);
    // The assertion drains the count.
    await updateGroceryRow(h.env, T, "chicken", { status: "ordered" }, TODAY);
    expect((await readSpendSection(h.env, T, NOW)).awaiting_mark_placed).toBe(0);
  });

  it("is empty-data resilient: a fresh tenant reads a zeroed section with a null budget", async () => {
    const h = sqliteEnv([T]);
    const s = await readSpendSection(h.env, T, NOW);
    expect(s.weekly_budget).toBeNull();
    expect(s.awaiting_mark_placed).toBe(0);
    expect(s.weeks).toHaveLength(4);
    expect(s.weeks.every((w) => w.total === 0 && w.events === 0)).toBe(true);
  });

  it("rides the retrospective tool result as its `spend` section", async () => {
    const h = sqliteEnv([T]);
    h.raw.prepare("INSERT INTO profile (tenant, weekly_budget) VALUES (?, 80)").run(T);
    seedEvent(h, { occurred_on: new Date().toISOString().slice(0, 10), amount: 15 });
    const res = await loadRetrospective(h.env, T, "month");
    expect(res.spend.weekly_budget).toBe(80);
    expect(res.spend.weeks).toHaveLength(4);
    expect(res.spend.weeks.reduce((n, w) => n + w.total, 0)).toBe(15);
    expect(res.period).toBe("month"); // the existing aggregation is untouched
  });
});

describe("readSpendAnalyzer — bounded production reader", () => {
  const NOW = new Date("2026-07-15T18:30:00.000Z"); // Wednesday in UTC

  function seedAnalyzerEvent(h: SqliteEnv, over: Record<string, unknown> = {}): void {
    const lineKey = String(over.line_key ?? "item");
    const row = {
      send_id: `S-${lineKey}`,
      line_key: lineKey,
      tenant: T,
      occurred_on: "2026-07-14",
      name: lineKey,
      sku: null,
      quantity: 1,
      unit_price: 5,
      amount: 5,
      savings: 0,
      estimated: 0,
      department: "produce",
      provenance: "planned",
      store: "kroger",
      fulfillment: "kroger_online",
      voided_at: null,
      ...over,
    };
    h.raw.prepare(
      "INSERT INTO spend_events (send_id, line_key, tenant, occurred_on, name, sku, quantity, unit_price, amount, savings, estimated, department, provenance, store, fulfillment, voided_at) " +
        "VALUES (:send_id, :line_key, :tenant, :occurred_on, :name, :sku, :quantity, :unit_price, :amount, :savings, :estimated, :department, :provenance, :store, :fulfillment, :voided_at)",
    ).run(row as never);
  }

  function seedCooking(
    h: SqliteEnv,
    over: { tenant?: string; date?: string; type?: string; recipe?: string | null; name?: string | null; meal?: string | null } = {},
  ): void {
    const row = {
      tenant: T,
      date: "2026-07-14",
      type: "recipe",
      recipe: "stew",
      name: null,
      meal: "dinner",
      ...over,
    };
    h.raw.prepare(
      "INSERT INTO cooking_log (tenant, date, type, recipe, name, meal) " +
        "VALUES (:tenant, :date, :type, :recipe, :name, :meal)",
    ).run(row as never);
  }

  async function seedAwaiting(h: SqliteEnv, tenant: string, key: string): Promise<void> {
    await addGroceryRow(h.env, tenant, { name: key }, TODAY);
    const send: SendBatch = {
      id: `AWAIT-${tenant}-${key}`,
      statements: snapshotStatements(h.env, {
        ...sendOf(h, `AWAIT-${tenant}-${key}`),
        tenant,
      }, [lineOf(key, { name: key })]),
    };
    await advanceInCartRows(h.env, tenant, [{ name: key, key }], TODAY, send);
  }

  it("derives every UTC ISO-week range, matched prior shape, and Sunday completion", async () => {
    const h = sqliteEnv([T]);
    const expected = {
      "4w": { selected: "2026-06-22", prior: "2026-05-25", priorEnd: "2026-06-17", count: 4 },
      "8w": { selected: "2026-05-25", prior: "2026-03-30", priorEnd: "2026-05-20", count: 8 },
      "12w": { selected: "2026-04-27", prior: "2026-02-02", priorEnd: "2026-04-22", count: 12 },
    } as const;

    for (const range of ["4w", "8w", "12w"] as const) {
      const result = await readSpendAnalyzer(h.env, T, range, NOW);
      expect(result).toMatchObject({
        range,
        as_of: "2026-07-15",
        selected_start: expected[range].selected,
        selected_end: "2026-07-15",
        prior_start: expected[range].prior,
        prior_end: expected[range].priorEnd,
      });
      expect(result.weeks).toHaveLength(expected[range].count);
      expect(result.weeks.map((week) => week.week_start)).toEqual(
        [...result.weeks.map((week) => week.week_start)].sort(),
      );
      expect(result.weeks.at(-1)).toMatchObject({
        week_start: "2026-07-13",
        week_end: "2026-07-19",
        through: "2026-07-15",
        is_partial: true,
      });
    }

    const sunday = await readSpendAnalyzer(h.env, T, "4w", new Date("2026-07-19T23:59:59.000Z"));
    expect(sunday.weeks.at(-1)).toMatchObject({
      week_start: "2026-07-13",
      week_end: "2026-07-19",
      through: "2026-07-19",
      is_partial: false,
    });
  });

  it("bounds selected, prior, future, and cooking facts on both sides", async () => {
    const h = sqliteEnv([T]);
    seedAnalyzerEvent(h, { send_id: "CURRENT", line_key: "current", occurred_on: "2026-07-15", amount: 60 });
    seedAnalyzerEvent(h, { send_id: "SELECTED-START", line_key: "selected-start", occurred_on: "2026-05-25", amount: 20 });
    seedAnalyzerEvent(h, { send_id: "PRIOR-END", line_key: "prior-end", occurred_on: "2026-05-20", amount: 50 });
    seedAnalyzerEvent(h, { send_id: "PRIOR-START", line_key: "prior-start", occurred_on: "2026-03-30", amount: 30 });
    seedAnalyzerEvent(h, { send_id: "BEFORE", line_key: "before", occurred_on: "2026-03-29", amount: 999 });
    seedAnalyzerEvent(h, { send_id: "FUTURE", line_key: "future", occurred_on: "2026-07-16", amount: 999 });
    seedCooking(h, { date: "2026-05-25", type: "recipe", recipe: "a", meal: "breakfast" });
    seedCooking(h, { date: "2026-07-15", type: "ad_hoc", recipe: null, name: "b", meal: "project" });
    seedCooking(h, { date: "2026-05-24", type: "recipe", recipe: "before" });
    seedCooking(h, { date: "2026-07-16", type: "recipe", recipe: "future" });
    seedCooking(h, { date: "2026-07-14", type: "ready_to_eat", recipe: null, name: "ready" });

    const result = await readSpendAnalyzer(h.env, T, "8w", NOW);
    expect(result.coverage.monetary).toMatchObject({ event_count: 2, known_amount: 80, status: "complete" });
    expect(result.kpis.trend).toEqual({
      percent: 0,
      current_known_amount: 80,
      prior_known_amount: 80,
      status: "available",
      reason: null,
    });
    expect(result.kpis.cost_per_meal).toMatchObject({ meal_count: 2, known_numerator: 80, amount: 40 });
    expect(result.top_drivers.items.map((driver) => driver.key)).toEqual(["current", "selected-start"]);
  });

  it("isolates spend, cooking, budget, and awaiting facts by resolved tenant", async () => {
    const h = sqliteEnv([T, "everett"]);
    h.raw.prepare("INSERT INTO profile (tenant, weekly_budget) VALUES (?, ?)").run(T, 95);
    h.raw.prepare("INSERT INTO profile (tenant, weekly_budget) VALUES (?, ?)").run("everett", 500);
    seedAnalyzerEvent(h, { send_id: "CASEY", line_key: "casey", amount: 24 });
    seedAnalyzerEvent(h, { send_id: "EVERETT", line_key: "everett", tenant: "everett", amount: 700 });
    seedCooking(h, { tenant: T, recipe: "casey-meal" });
    seedCooking(h, { tenant: "everett", recipe: "everett-meal" });
    await seedAwaiting(h, T, "casey-awaiting");
    await seedAwaiting(h, "everett", "everett-awaiting");

    const result = await readSpendAnalyzer(h.env, T, "4w", NOW);
    expect(result.weekly_budget).toBe(95);
    expect(result.coverage.monetary).toMatchObject({ event_count: 1, known_amount: 24 });
    expect(result.kpis.cost_per_meal).toMatchObject({ meal_count: 1, amount: 24 });
    expect(result.awaiting_mark_placed).toBe(1);
    expect(result.top_drivers.items.map((driver) => driver.key)).toEqual(["casey"]);
  });

  it("distinguishes empty, unavailable, and per-week mixed coverage without fabricating values", async () => {
    const empty = sqliteEnv([T]);
    const emptyResult = await readSpendAnalyzer(empty.env, T, "4w", NOW);
    expect(emptyResult.status).toBe("empty");
    expect(emptyResult.coverage).toEqual({
      monetary: {
        status: "empty", event_count: 0, priced_event_count: 0, unpriced_event_count: 0,
        estimated_event_count: 0, known_amount: 0,
      },
      department: {
        status: "empty", event_count: 0, classified_event_count: 0, pending_event_count: 0,
      },
      savings: {
        status: "empty", event_count: 0, known_event_count: 0, unknown_event_count: 0, known_savings: 0,
      },
    });
    expect(emptyResult.kpis.total_spend).toEqual({ amount: 0, status: "empty" });
    expect(emptyResult.kpis.average_per_week).toEqual({ amount: 0, status: "empty" });
    expect(emptyResult.insight).toBe("No recorded spend in this range.");

    const unavailable = sqliteEnv([T]);
    seedAnalyzerEvent(unavailable, {
      send_id: "NO-PRICE", line_key: "no-price", amount: null, unit_price: null, savings: null, department: null,
    });
    const unavailableResult = await readSpendAnalyzer(unavailable.env, T, "4w", NOW);
    expect(unavailableResult.status).toBe("unavailable");
    expect(unavailableResult.coverage.monetary).toMatchObject({
      event_count: 1, priced_event_count: 0, unpriced_event_count: 1, known_amount: 0,
    });
    expect(unavailableResult.kpis.total_spend).toEqual({ amount: null, status: "unavailable" });
    expect(unavailableResult.insight).toBe(
      "Spend is unavailable because none of the recorded purchases in this range has a usable price.",
    );

    const mixed = sqliteEnv([T]);
    seedAnalyzerEvent(mixed, {
      send_id: "EXACT", line_key: "exact", occurred_on: "2026-07-07", amount: 1.006, savings: 0.504,
    });
    seedAnalyzerEvent(mixed, {
      send_id: "EST", line_key: "estimated", occurred_on: "2026-07-08", amount: 2.004, savings: 0.506, estimated: 1,
    });
    seedAnalyzerEvent(mixed, {
      send_id: "MISSING", line_key: "missing", occurred_on: "2026-07-14", amount: null, unit_price: null,
      savings: null, department: null,
    });
    seedAnalyzerEvent(mixed, {
      send_id: "VOID", line_key: "void", occurred_on: "2026-07-14", amount: 500,
      voided_at: "2026-07-15T00:00:00.000Z",
    });
    const mixedResult = await readSpendAnalyzer(mixed.env, T, "4w", NOW);
    expect(mixedResult.status).toBe("partial");
    expect(mixedResult.coverage.monetary).toEqual({
      status: "partial", event_count: 3, priced_event_count: 2, unpriced_event_count: 1,
      estimated_event_count: 1, known_amount: 3.01,
    });
    expect(mixedResult.coverage.department).toEqual({
      status: "partial", event_count: 3, classified_event_count: 2, pending_event_count: 1,
    });
    expect(mixedResult.coverage.savings).toEqual({
      status: "partial", event_count: 3, known_event_count: 2, unknown_event_count: 1, known_savings: 1.01,
    });
    expect(mixedResult.weeks.find((week) => week.week_start === "2026-07-06")?.monetary_coverage.status).toBe("partial");
    expect(mixedResult.weeks.at(-1)?.monetary_coverage.status).toBe("unavailable");
    expect(mixedResult.insight).toBe(
      "Known spend is incomplete: 1 purchase had no usable price, 1 purchase used an estimated price, and 1 purchase is awaiting department classification.",
    );
  });

  it("uses the exact cooking denominator, D17 numerator exclusions, averages, and budget tri-state", async () => {
    const h = sqliteEnv([T]);
    h.raw.prepare("INSERT INTO profile (tenant, weekly_budget) VALUES (?, ?)").run(T, 25);
    seedAnalyzerEvent(h, { send_id: "PRODUCE", line_key: "produce", amount: 20, department: "produce" });
    seedAnalyzerEvent(h, { send_id: "BEV", line_key: "beverages", amount: 8, department: "beverages" });
    seedAnalyzerEvent(h, { send_id: "HOME", line_key: "household", amount: 12, department: "household" });
    seedCooking(h, { recipe: "breakfast", meal: "breakfast" });
    seedCooking(h, { type: "ad_hoc", recipe: null, name: "dinner", meal: "dinner" });
    seedCooking(h, { recipe: "project", meal: "project" });
    seedCooking(h, { recipe: "legacy", meal: null });
    seedCooking(h, { type: "ready_to_eat", recipe: null, name: "ready", meal: "lunch" });

    const result = await readSpendAnalyzer(h.env, T, "8w", NOW);
    expect(result.kpis.total_spend).toEqual({ amount: 40, status: "complete" });
    expect(result.kpis.average_per_week).toEqual({ amount: 5, status: "complete" });
    expect(result.kpis.cost_per_meal).toEqual({
      amount: 5,
      known_numerator: 20,
      meal_count: 4,
      status: "complete",
      reason: null,
    });
    expect(result.weeks.at(-1)?.over_budget).toBe(true);

    const partial = sqliteEnv([T]);
    partial.raw.prepare("INSERT INTO profile (tenant, weekly_budget) VALUES (?, ?)").run(T, 95);
    seedAnalyzerEvent(partial, { send_id: "KNOWN", line_key: "known", amount: 100, department: "produce" });
    seedAnalyzerEvent(partial, { send_id: "UNKNOWN", line_key: "unknown", amount: null, unit_price: null, department: "produce" });
    seedCooking(partial);
    const partialResult = await readSpendAnalyzer(partial.env, T, "4w", NOW);
    expect(partialResult.weeks.at(-1)?.over_budget).toBe(true);
    expect(partialResult.kpis.cost_per_meal).toMatchObject({
      amount: 100, known_numerator: 100, status: "partial", reason: null,
    });

    const below = sqliteEnv([T]);
    below.raw.prepare("INSERT INTO profile (tenant, weekly_budget) VALUES (?, ?)").run(T, 95);
    seedAnalyzerEvent(below, { send_id: "KNOWN", line_key: "known", amount: 20 });
    seedAnalyzerEvent(below, { send_id: "UNKNOWN", line_key: "unknown", amount: null, unit_price: null });
    expect((await readSpendAnalyzer(below.env, T, "4w", NOW)).weeks.at(-1)?.over_budget).toBeNull();

    const hidden = sqliteEnv([T]);
    hidden.raw.prepare("INSERT INTO profile (tenant, weekly_budget) VALUES (?, ?)").run(T, 0);
    seedAnalyzerEvent(hidden, { send_id: "KNOWN", line_key: "known", amount: 20 });
    const hiddenResult = await readSpendAnalyzer(hidden.env, T, "4w", NOW);
    expect(hiddenResult.weekly_budget).toBeNull();
    expect(hiddenResult.weeks.every((week) => week.over_budget === null)).toBe(true);

    const completeBelow = sqliteEnv([T]);
    completeBelow.raw.prepare("INSERT INTO profile (tenant, weekly_budget) VALUES (?, ?)").run(T, 95);
    seedAnalyzerEvent(completeBelow, { send_id: "KNOWN", line_key: "known", amount: 20 });
    expect((await readSpendAnalyzer(completeBelow.env, T, "4w", NOW)).weeks.at(-1)?.over_budget).toBe(false);
  });

  it("reports exact zero, unavailable, partial, and zero-meal cost numerator states", async () => {
    const excluded = sqliteEnv([T]);
    seedAnalyzerEvent(excluded, { send_id: "BEV", line_key: "bev", amount: 8, department: "beverages" });
    seedAnalyzerEvent(excluded, { send_id: "HOME", line_key: "home", amount: 12, department: "household" });
    seedCooking(excluded);
    expect((await readSpendAnalyzer(excluded.env, T, "4w", NOW)).kpis.cost_per_meal).toEqual({
      amount: 0, known_numerator: 0, meal_count: 1, status: "complete", reason: null,
    });

    const pending = sqliteEnv([T]);
    seedAnalyzerEvent(pending, { send_id: "PENDING", line_key: "pending", amount: 10, department: null });
    seedCooking(pending);
    expect((await readSpendAnalyzer(pending.env, T, "4w", NOW)).kpis.cost_per_meal).toEqual({
      amount: null, known_numerator: 0, meal_count: 1, status: "unavailable", reason: "numerator_unavailable",
    });

    const estimated = sqliteEnv([T]);
    seedAnalyzerEvent(estimated, { send_id: "EST", line_key: "estimated", amount: 10, estimated: 1 });
    seedCooking(estimated);
    expect((await readSpendAnalyzer(estimated.env, T, "4w", NOW)).kpis.cost_per_meal).toEqual({
      amount: 10, known_numerator: 10, meal_count: 1, status: "partial", reason: null,
    });

    const noMeals = sqliteEnv([T]);
    seedAnalyzerEvent(noMeals, { send_id: "FOOD", line_key: "food", amount: 10 });
    expect((await readSpendAnalyzer(noMeals.env, T, "4w", NOW)).kpis.cost_per_meal).toEqual({
      amount: null, known_numerator: 10, meal_count: 0, status: "unavailable", reason: "zero_meals",
    });

    const empty = sqliteEnv([T]);
    seedCooking(empty);
    expect((await readSpendAnalyzer(empty.env, T, "4w", NOW)).kpis.cost_per_meal).toEqual({
      amount: 0, known_numerator: 0, meal_count: 1, status: "empty", reason: null,
    });
  });

  it("applies deterministic trend reason precedence and exact negative one hundred", async () => {
    const currentIncomplete = sqliteEnv([T]);
    seedAnalyzerEvent(currentIncomplete, { send_id: "CURRENT", line_key: "current", amount: null, unit_price: null });
    seedAnalyzerEvent(currentIncomplete, {
      send_id: "PRIOR", line_key: "prior", occurred_on: "2026-06-10", amount: null, unit_price: null,
    });
    expect((await readSpendAnalyzer(currentIncomplete.env, T, "4w", NOW)).kpis.trend.reason).toBe("current_incomplete");

    const priorIncomplete = sqliteEnv([T]);
    seedAnalyzerEvent(priorIncomplete, { send_id: "CURRENT", line_key: "current", amount: 10 });
    seedAnalyzerEvent(priorIncomplete, {
      send_id: "PRIOR", line_key: "prior", occurred_on: "2026-06-10", amount: null, unit_price: null,
    });
    expect((await readSpendAnalyzer(priorIncomplete.env, T, "4w", NOW)).kpis.trend.reason).toBe("prior_incomplete");

    const priorZero = sqliteEnv([T]);
    seedAnalyzerEvent(priorZero, { send_id: "CURRENT", line_key: "current", amount: 10 });
    expect((await readSpendAnalyzer(priorZero.env, T, "4w", NOW)).kpis.trend.reason).toBe("prior_zero");

    const currentZero = sqliteEnv([T]);
    seedAnalyzerEvent(currentZero, { send_id: "PRIOR", line_key: "prior", occurred_on: "2026-06-10", amount: 50 });
    expect((await readSpendAnalyzer(currentZero.env, T, "4w", NOW)).kpis.trend).toEqual({
      percent: -100,
      current_known_amount: 0,
      prior_known_amount: 50,
      status: "available",
      reason: null,
    });
  });

  it("groups only captured classification keys and applies every stable tie-break", async () => {
    const h = sqliteEnv([T]);
    seedAnalyzerEvent(h, {
      send_id: "A", line_key: "repeat", occurred_on: "2026-07-07", name: "Old name", amount: 10,
      department: "produce", store: "store_one", provenance: "planned", quantity: 99,
    });
    seedAnalyzerEvent(h, {
      send_id: "B", line_key: "repeat", occurred_on: "2026-07-14", name: "Latest lower send", amount: 5,
      department: "bakery", store: "store_one", provenance: "planned",
    });
    seedAnalyzerEvent(h, {
      send_id: "Z", line_key: "repeat", occurred_on: "2026-07-14", name: "Latest winner", amount: null,
      unit_price: null, department: null, store: "store_two", provenance: "impulse",
    });
    seedAnalyzerEvent(h, {
      send_id: "DAIRY", line_key: "dairy-only", amount: null, unit_price: null,
      department: "dairy_and_eggs", store: "store_two", provenance: "impulse",
    });
    seedAnalyzerEvent(h, {
      send_id: "NULL-DEPT", line_key: "pending", amount: 5, department: null,
      store: "store_two", provenance: "impulse",
    });
    for (const [index, key] of ["aa", "ab", "ac", "ad", "ae", "af", "ag"].entries()) {
      seedAnalyzerEvent(h, {
        send_id: `CAP-${key}`, line_key: key, occurred_on: "2026-07-10", amount: index < 2 ? 4 : 1,
        department: index % 2 === 0 ? "bakery" : "produce", store: "store_one", provenance: "planned",
      });
    }

    const result = await readSpendAnalyzer(h.env, T, "4w", NOW);
    expect(result.breakdowns.department.items.some((item) => item.key === "Not mapped")).toBe(false);
    expect(result.breakdowns.department.items.find((item) => item.key === "dairy_and_eggs")).toMatchObject({
      label: "Dairy And Eggs", amount: 0, event_count: 1, priced_event_count: 0, unpriced_event_count: 1,
      percentage: 0,
    });
    expect(result.breakdowns.department.known_denominator).toBe(28);
    expect(result.breakdowns.store.known_denominator).toBe(33);
    expect(result.breakdowns.provenance.known_denominator).toBe(33);
    expect(result.breakdowns.department.items.slice(0, 2).map((item) => item.key)).toEqual(["produce", "bakery"]);
    expect(result.breakdowns.store.items.map((item) => item.key)).toEqual(["store_one", "store_two"]);
    expect(result.breakdowns.department.items[0].percentage).toBe(57.1);
    expect(result.breakdowns.store.items[0].percentage).toBe(84.8);

    expect(result.top_drivers.cap).toBe(6);
    expect(result.top_drivers.total_count).toBe(9);
    expect(result.top_drivers.items).toHaveLength(6);
    expect(result.top_drivers.items[0]).toMatchObject({
      key: "repeat",
      name: "Latest winner",
      department: null,
      amount: 15,
      event_count: 3,
      priced_event_count: 2,
      unpriced_event_count: 1,
      percentage: 45.5,
    });
    expect(result.top_drivers.items.slice(2, 4).map((driver) => driver.key)).toEqual(["aa", "ab"]);

    const unknownOnly = sqliteEnv([T]);
    seedAnalyzerEvent(unknownOnly, {
      send_id: "UNKNOWN", line_key: "unknown", amount: null, unit_price: null,
      department: "frozen", store: "raw_store-key", provenance: "impulse",
    });
    const unknownResult = await readSpendAnalyzer(unknownOnly.env, T, "4w", NOW);
    expect(unknownResult.breakdowns.department.items[0]).toMatchObject({
      key: "frozen", amount: 0, percentage: null,
    });
    expect(unknownResult.breakdowns.store.items[0]).toMatchObject({
      key: "raw_store-key", label: "Raw Store Key", amount: 0, percentage: null,
    });
    expect(unknownResult.top_drivers).toEqual({ cap: 6, total_count: 0, items: [] });
  });

  it("uses plural partial-insight grammar in the fixed clause order", async () => {
    const h = sqliteEnv([T]);
    for (const key of ["unpriced-a", "unpriced-b"]) {
      seedAnalyzerEvent(h, { send_id: `S-${key}`, line_key: key, amount: null, unit_price: null });
    }
    for (const key of ["estimated-a", "estimated-b"]) {
      seedAnalyzerEvent(h, { send_id: `S-${key}`, line_key: key, amount: 2, estimated: 1 });
    }
    for (const key of ["pending-a", "pending-b"]) {
      seedAnalyzerEvent(h, { send_id: `S-${key}`, line_key: key, amount: 3, department: null });
    }
    expect((await readSpendAnalyzer(h.env, T, "4w", NOW)).insight).toBe(
      "Known spend is incomplete: 2 purchases had no usable price, 2 purchases used an estimated price, and 2 purchases are awaiting department classification.",
    );
  });

  it("selects exact complete insight clauses for higher, lower, unchanged, and unavailable trend", async () => {
    function complete(current: number, prior: number | null): SqliteEnv {
      const h = sqliteEnv([T]);
      seedAnalyzerEvent(h, {
        send_id: "CURRENT-A", line_key: "current-a", amount: current / 2,
        department: "bakery", provenance: "planned",
      });
      seedAnalyzerEvent(h, {
        send_id: "CURRENT-B", line_key: "current-b", amount: current / 2,
        department: "produce", provenance: "impulse",
      });
      if (prior != null) {
        seedAnalyzerEvent(h, {
          send_id: "PRIOR", line_key: "prior", occurred_on: "2026-06-10", amount: prior,
          department: "produce", provenance: "planned",
        });
      }
      return h;
    }

    expect((await readSpendAnalyzer(complete(100, 50).env, T, "4w", NOW)).insight).toBe(
      "Bakery was the largest department at $50.00. Planned purchases were 50.0% of known spend; impulse purchases were 50.0%. Spend was 100.0% higher than the matched prior range.",
    );
    expect((await readSpendAnalyzer(complete(50, 100).env, T, "4w", NOW)).insight).toContain(
      "Spend was 50.0% lower than the matched prior range.",
    );
    expect((await readSpendAnalyzer(complete(50, 50).env, T, "4w", NOW)).insight).toContain(
      "Spend was unchanged from the matched prior range.",
    );
    const unavailableTrend = await readSpendAnalyzer(complete(50, null).env, T, "4w", NOW);
    expect(unavailableTrend.insight).toBe(
      "Bakery was the largest department at $25.00. Planned purchases were 50.0% of known spend; impulse purchases were 50.0%.",
    );

    const awaiting = complete(50, 50);
    const insightBefore = (await readSpendAnalyzer(awaiting.env, T, "4w", NOW)).insight;
    await seedAwaiting(awaiting, T, "awaiting-insight");
    const withAwaiting = await readSpendAnalyzer(awaiting.env, T, "4w", NOW);
    expect(withAwaiting.awaiting_mark_placed).toBe(1);
    expect(withAwaiting.insight).toBe(insightBefore);
  });

  it("converges on late, replayed, voided, and independently committed facts without analyzer DDL or writes", async () => {
    const h = sqliteEnv([T]);
    const schemaBefore = h.raw.prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    ).all();
    const first = await readSpendAnalyzer(h.env, T, "4w", NOW);
    expect(first.status).toBe("empty");

    await db(h.env).batch(snapshotStatements(h.env, sendOf(h, "LATE"), [
      lineOf("late", { name: "Late", quantity: 1, unitPrice: 12, department: "produce" }),
    ]));
    await recordPurchaseAssertion(h.env, T, [{ sendId: "LATE", lineKey: "late" }], "2026-07-01");
    await recordPurchaseAssertion(h.env, T, [{ sendId: "LATE", lineKey: "late" }], "2026-07-01");
    const afterLate = await readSpendAnalyzer(h.env, T, "4w", NOW);
    expect(afterLate.coverage.monetary).toMatchObject({ event_count: 1, known_amount: 12 });
    expect(h.rows("spend_events")).toHaveLength(1);

    const stateBeforeRepeat = {
      events: h.rows("spend_events"),
      cooking: h.rows("cooking_log"),
      grocery: h.rows("grocery_list"),
    };
    expect(await readSpendAnalyzer(h.env, T, "4w", NOW)).toEqual(afterLate);
    expect({
      events: h.rows("spend_events"),
      cooking: h.rows("cooking_log"),
      grocery: h.rows("grocery_list"),
    }).toEqual(stateBeforeRepeat);

    seedCooking(h, { date: "2026-07-01", recipe: "late-meal" });
    expect((await readSpendAnalyzer(h.env, T, "4w", NOW)).kpis.cost_per_meal.amount).toBe(12);
    h.raw.prepare("INSERT INTO profile (tenant, weekly_budget) VALUES (?, ?)").run(T, 10);
    expect((await readSpendAnalyzer(h.env, T, "4w", NOW)).weekly_budget).toBe(10);
    await seedAwaiting(h, T, "pending-placement");
    expect((await readSpendAnalyzer(h.env, T, "4w", NOW)).awaiting_mark_placed).toBe(1);

    await voidSpendEvents(h.env, T, [{ sendId: "LATE", lineKey: "late" }]);
    expect((await readSpendAnalyzer(h.env, T, "4w", NOW)).status).toBe("empty");
    const schemaAfter = h.raw.prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    ).all();
    expect(schemaAfter).toEqual(schemaBefore);
    expect(h.raw.prepare("SELECT COUNT(*) AS n FROM spend_events").get()).toEqual({ n: 1 });
  });
});
