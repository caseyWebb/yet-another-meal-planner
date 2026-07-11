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

  it("a bare advance (no send) stamps no linkage — a degraded flush never manufactures one", async () => {
    const h = sqliteEnv([T]);
    await addGroceryRow(h.env, T, { name: "chicken" }, TODAY);
    await advanceInCartRows(h.env, T, [{ name: "chicken", key: "chicken" }], TODAY);
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
    expect(s.weeks[3]).toEqual({ week_start: "2026-07-06", total: 30, savings: 1.5, events: 2, estimated: 0 });
    expect(s.weeks[2]).toEqual({ week_start: "2026-06-29", total: 12, savings: 0, events: 1, estimated: 1 });
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
