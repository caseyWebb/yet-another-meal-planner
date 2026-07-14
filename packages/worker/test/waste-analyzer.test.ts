import { WASTE_REASONS } from "@yamp/contract";
import { describe, expect, it } from "vitest";
import { db } from "../src/db.js";
import { applyPantryRowOps } from "../src/session-db.js";
import {
  recordPurchaseAssertion,
  snapshotStatements,
  voidSpendEvents,
  type SendSnapshot,
  type SnapshotLine,
} from "../src/spend.js";
import {
  CURRENT_WASTE_AVOIDABILITY_VERSION,
  WASTE_AVOIDABILITY_MAPPINGS,
} from "../src/waste-avoidability.js";
import { readWasteAnalyzer } from "../src/waste-analyzer.js";
import { sqliteEnv, type SqliteEnv } from "./sqlite-d1.js";

const T = "casey";
const OTHER = "everett";
const NOW = new Date("2026-07-15T18:30:00.000Z");

function seedWaste(h: SqliteEnv, over: Record<string, unknown> = {}): void {
  const id = String(over.id ?? "W-item");
  const itemId = String(over.item_id ?? "item");
  h.raw.prepare(
    "INSERT INTO waste_events " +
      "(tenant, id, name, item_id, prepared_from, quantity, department, reason, occurred_at, created_at) " +
      "VALUES (:tenant, :id, :name, :item_id, :prepared_from, :quantity, :department, :reason, :occurred_at, :created_at)",
  ).run({
    tenant: T,
    id,
    name: itemId,
    item_id: itemId,
    prepared_from: null,
    quantity: "1",
    department: "produce",
    reason: "spoiled",
    occurred_at: "2026-07-14",
    created_at: "2026-07-14T12:00:00.000Z",
    ...over,
  } as never);
}

function seedSpend(h: SqliteEnv, over: Record<string, unknown> = {}): void {
  const lineKey = String(over.line_key ?? "item");
  h.raw.prepare(
    "INSERT INTO spend_events " +
      "(send_id, line_key, tenant, occurred_on, name, sku, quantity, unit_price, amount, savings, estimated, department, provenance, store, fulfillment, voided_at) " +
      "VALUES (:send_id, :line_key, :tenant, :occurred_on, :name, :sku, :quantity, :unit_price, :amount, :savings, :estimated, :department, :provenance, :store, :fulfillment, :voided_at)",
  ).run({
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
  } as never);
}

async function capturePurchase(
  h: SqliteEnv,
  fixture: {
    sendId: string;
    lineKey: string;
    occurredOn: string;
    unitPrice: number;
    quantity?: number;
    estimated?: 0 | 1;
    department?: string | null;
  },
): Promise<void> {
  const send: SendSnapshot = {
    id: fixture.sendId,
    tenant: T,
    store: "kroger",
    locationId: "loc-1",
    fulfillment: "kroger_online",
    orderListId: null,
    createdAt: `${fixture.occurredOn}T09:00:00.000Z`,
  };
  const line: SnapshotLine = {
    lineKey: fixture.lineKey,
    name: fixture.lineKey,
    sku: `SKU-${fixture.lineKey}`,
    brand: "Store Brand",
    size: null,
    quantity: fixture.quantity ?? 1,
    priceRegular: fixture.unitPrice,
    pricePromo: null,
    onSale: false,
    unitPrice: fixture.unitPrice,
    savings: 0,
    estimated: fixture.estimated ?? 0,
    department: fixture.department === undefined ? "produce" : fixture.department,
    provenance: "planned",
    forRecipes: [],
  };
  await db(h.env).batch(snapshotStatements(h.env, send, [line]));
  await recordPurchaseAssertion(
    h.env,
    T,
    [{ sendId: fixture.sendId, lineKey: fixture.lineKey }],
    fixture.occurredOn,
  );
}

describe("readWasteAnalyzer — migration-backed production reader", () => {
  it("uses the shared UTC range bounds and emits chronological Monday-through-Sunday buckets", async () => {
    const h = sqliteEnv([T]);
    const expected = {
      "4w": {
        selected: "2026-06-22",
        prior: "2026-05-25",
        priorEnd: "2026-06-17",
        starts: ["2026-06-22", "2026-06-29", "2026-07-06", "2026-07-13"],
      },
      "8w": {
        selected: "2026-05-25",
        prior: "2026-03-30",
        priorEnd: "2026-05-20",
        starts: [
          "2026-05-25", "2026-06-01", "2026-06-08", "2026-06-15",
          "2026-06-22", "2026-06-29", "2026-07-06", "2026-07-13",
        ],
      },
      "12w": {
        selected: "2026-04-27",
        prior: "2026-02-02",
        priorEnd: "2026-04-22",
        starts: [
          "2026-04-27", "2026-05-04", "2026-05-11", "2026-05-18",
          "2026-05-25", "2026-06-01", "2026-06-08", "2026-06-15",
          "2026-06-22", "2026-06-29", "2026-07-06", "2026-07-13",
        ],
      },
    } as const;

    for (const range of ["4w", "8w", "12w"] as const) {
      const result = await readWasteAnalyzer(h.env, T, range, undefined, NOW);
      expect(result).toMatchObject({
        range,
        as_of: "2026-07-15",
        selected_start: expected[range].selected,
        selected_end: "2026-07-15",
        prior_start: expected[range].prior,
        prior_end: expected[range].priorEnd,
      });
      expect(result.weeks.map((week) => week.week_start)).toEqual(expected[range].starts);
      expect(result.weeks.at(-1)).toMatchObject({
        week_start: "2026-07-13",
        week_end: "2026-07-19",
        through: "2026-07-15",
        is_partial: true,
      });
    }

    const monday = await readWasteAnalyzer(
      h.env,
      T,
      "4w",
      undefined,
      new Date("2026-07-13T00:00:00.000Z"),
    );
    expect(monday.weeks.at(-1)).toMatchObject({
      week_start: "2026-07-13",
      week_end: "2026-07-19",
      through: "2026-07-13",
      is_partial: true,
    });

    const sunday = await readWasteAnalyzer(
      h.env,
      T,
      "4w",
      undefined,
      new Date("2026-07-19T23:59:59.000Z"),
    );
    expect(sunday.weeks.at(-1)).toMatchObject({
      week_start: "2026-07-13",
      week_end: "2026-07-19",
      through: "2026-07-19",
      is_partial: false,
    });
  });

  it("honors the 24-week outer edges, excludes future facts, and isolates the resolved tenant", async () => {
    const h = sqliteEnv([T, OTHER]);
    seedWaste(h, { id: "W-selected-start", item_id: "selected-start", occurred_at: "2026-04-27" });
    seedSpend(h, { send_id: "S-selected-start", line_key: "selected-start", occurred_on: "2026-04-27", unit_price: 20, amount: 20 });
    seedWaste(h, { id: "W-prior-start", item_id: "prior-start", occurred_at: "2026-02-02" });
    seedSpend(h, { send_id: "S-prior-start", line_key: "prior-start", occurred_on: "2026-02-02", unit_price: 20, amount: 20 });
    seedWaste(h, { id: "W-before", item_id: "before", occurred_at: "2026-02-01" });
    seedSpend(h, { send_id: "S-before", line_key: "before", occurred_on: "2026-02-01", unit_price: 999, amount: 999 });
    seedWaste(h, { id: "W-future", item_id: "future", occurred_at: "2026-07-16" });
    seedSpend(h, { send_id: "S-future", line_key: "future", occurred_on: "2026-07-16", unit_price: 999, amount: 999 });
    seedWaste(h, { id: "W-other", tenant: OTHER, item_id: "other", occurred_at: "2026-07-15" });
    seedSpend(h, { send_id: "S-other", tenant: OTHER, line_key: "other", occurred_on: "2026-07-15", unit_price: 700, amount: 700 });

    const result = await readWasteAnalyzer(h.env, T, "12w", undefined, NOW);
    expect(result.coverage.monetary).toMatchObject({
      status: "complete",
      event_count: 1,
      known_amount: 20,
    });
    expect(result.kpis.trend).toEqual({
      percent: 0,
      current_known_amount: 20,
      prior_known_amount: 20,
      status: "available",
      reason: null,
    });
    expect(result.kpis.waste_rate.spend_coverage).toMatchObject({
      spend_event_count: 1,
      qualifying_event_count: 1,
      known_amount: 20,
    });
    expect(result.most_wasted.items.map((item) => item.key)).toEqual(["selected-start"]);
  });

  it("uses only the latest eligible household unit price and preserves price facts", async () => {
    const h = sqliteEnv([T, OTHER]);

    seedWaste(h, { id: "W-tie", item_id: "tie", occurred_at: "2026-07-14" });
    seedSpend(h, { send_id: "S-tie-old", line_key: "tie", occurred_on: "2026-07-12", unit_price: 1, amount: 100 });
    seedSpend(h, { send_id: "S-tie-a", line_key: "tie", occurred_on: "2026-07-14", unit_price: 9, amount: 900, estimated: 0 });
    seedSpend(h, { send_id: "S-tie-z", line_key: "tie", occurred_on: "2026-07-14", unit_price: 3.335, amount: 333.5, estimated: 1 });
    seedSpend(h, { send_id: "S-tie-future", line_key: "tie", occurred_on: "2026-07-15", unit_price: 99, amount: 99 });

    seedWaste(h, { id: "W-fallback", item_id: "fallback", occurred_at: "2026-07-14" });
    seedSpend(h, { send_id: "S-fallback-old", line_key: "fallback", occurred_on: "2026-07-10", unit_price: 2.01, amount: 201 });
    seedSpend(h, { send_id: "S-fallback-null", line_key: "fallback", occurred_on: "2026-07-13", unit_price: null, amount: 500 });
    seedSpend(h, { send_id: "S-fallback-void", line_key: "fallback", occurred_on: "2026-07-14", unit_price: 50, amount: 50, voided_at: "2026-07-15T00:00:00.000Z" });

    seedWaste(h, { id: "W-zero", item_id: "zero", occurred_at: "2026-07-14" });
    seedSpend(h, { send_id: "S-zero", line_key: "zero", occurred_on: "2026-07-14", unit_price: 0, amount: 88, estimated: 1 });

    seedWaste(h, { id: "W-round-a", item_id: "rounding", occurred_at: "2026-07-13" });
    seedWaste(h, { id: "W-round-b", item_id: "rounding", occurred_at: "2026-07-14" });
    seedSpend(h, { send_id: "S-rounding", line_key: "rounding", occurred_on: "2026-07-13", unit_price: 1.234, amount: 123.4 });

    seedWaste(h, { id: "W-quantity", item_id: "quantity", quantity: "100 packages", occurred_at: "2026-07-14" });
    seedSpend(h, { send_id: "S-quantity", line_key: "quantity", occurred_on: "2026-07-14", quantity: 50, unit_price: 4.44, amount: 222 });

    seedWaste(h, { id: "W-cross", item_id: "cross", occurred_at: "2026-07-14" });
    seedSpend(h, { send_id: "S-cross-other", tenant: OTHER, line_key: "cross", occurred_on: "2026-07-14", unit_price: 70, amount: 70 });
    seedWaste(h, {
      id: "W-no-fallback",
      item_id: "no-fallback",
      name: "Recipe leftovers with a suggested $40 value",
      prepared_from: "expensive-recipe",
      quantity: "half a pan",
      occurred_at: "2026-07-14",
    });

    const result = await readWasteAnalyzer(h.env, T, "4w", undefined, NOW);
    expect(result.coverage.monetary).toEqual({
      status: "partial",
      event_count: 8,
      priced_event_count: 6,
      unpriced_event_count: 2,
      estimated_event_count: 2,
      known_amount: 12.25,
    });

    const items = new Map(result.most_wasted.items.map((item) => [item.key, item]));
    expect(items.get("tie")).toMatchObject({ amount: 3.34, estimated_event_count: 1, status: "partial" });
    expect(items.get("fallback")).toMatchObject({ amount: 2.01, estimated_event_count: 0, status: "complete" });
    expect(items.get("zero")).toMatchObject({ amount: 0, valued_event_count: 1, estimated_event_count: 1, status: "partial" });
    expect(items.get("rounding")).toMatchObject({ amount: 2.46, event_count: 2, status: "complete" });
    expect(items.get("quantity")).toMatchObject({ amount: 4.44, event_count: 1, status: "complete" });

    const reasonItems = result.breakdowns.reason.items;
    expect(reasonItems).toHaveLength(1);
    expect(reasonItems[0]).toMatchObject({
      key: "spoiled",
      event_count: 8,
      valued_event_count: 6,
      unvalued_event_count: 2,
      amount: 12.25,
    });
    expect(result.insight).toBe(
      "Known waste value is incomplete: 2 tossed items had no matching last-paid price and 2 tossed items used an estimated last-paid price.",
    );
  });

  it("leaves cross-tenant prices and prepared-recipe hints unresolved without a fallback", async () => {
    const h = sqliteEnv([T, OTHER]);
    seedWaste(h, { id: "W-cross-only", item_id: "cross-only", quantity: "12" });
    seedSpend(h, {
      send_id: "S-cross-only-other",
      tenant: OTHER,
      line_key: "cross-only",
      unit_price: 90,
      amount: 90,
    });
    seedWaste(h, {
      id: "W-recipe-only",
      item_id: "recipe-only",
      name: "Costly leftovers",
      prepared_from: "costly-recipe",
      quantity: "half",
      department: null,
    });

    const result = await readWasteAnalyzer(h.env, T, "4w", undefined, NOW);
    expect(result.coverage.monetary).toMatchObject({
      status: "unavailable",
      event_count: 2,
      priced_event_count: 0,
      unpriced_event_count: 2,
      known_amount: 0,
    });
    expect(result.most_wasted.items.map((item) => ({
      key: item.key,
      amount: item.amount,
      status: item.status,
    }))).toEqual([
      { key: "cross-only", amount: null, status: "unavailable" },
      { key: "recipe-only", amount: null, status: "unavailable" },
    ]);
  });

  it("pins the frozen exhaustive v1 reason mapping and replays it through the reader", async () => {
    const expectedAvoidable = [
      "bought_too_much",
      "forgot",
      "freezer_burned",
      "never_opened",
      "stale",
    ];
    const expectedHardToAvoid = ["expired", "moldy", "other", "over_ripe", "spoiled"];
    const v1 = WASTE_AVOIDABILITY_MAPPINGS["waste-avoidability-v1"];

    expect(CURRENT_WASTE_AVOIDABILITY_VERSION).toBe("waste-avoidability-v1");
    expect(Object.isFrozen(WASTE_AVOIDABILITY_MAPPINGS)).toBe(true);
    expect(Object.isFrozen(v1)).toBe(true);
    expect(Object.keys(v1).sort()).toEqual([...WASTE_REASONS].sort());
    expect(Object.entries(v1).filter(([, value]) => value === "avoidable").map(([key]) => key).sort()).toEqual(
      expectedAvoidable,
    );
    expect(Object.entries(v1).filter(([, value]) => value === "hard_to_avoid").map(([key]) => key).sort()).toEqual(
      expectedHardToAvoid,
    );

    const h = sqliteEnv([T]);
    WASTE_REASONS.forEach((reason, index) => {
      const itemId = `reason-${reason}`;
      seedWaste(h, {
        id: `W-reason-${index}`,
        item_id: itemId,
        name: `Name ${index}`,
        reason,
        quantity: index % 2 === 0 ? "half" : "9",
        department: index % 3 === 0 ? null : "produce",
        prepared_from: index % 4 === 0 ? `recipe-${index}` : null,
        occurred_at: "2026-07-14",
      });
      seedSpend(h, {
        send_id: `S-reason-${index}`,
        line_key: itemId,
        occurred_on: "2026-07-14",
        unit_price: index + 1,
        amount: (index + 1) * 20,
        department: "produce",
      });
    });

    const current = await readWasteAnalyzer(h.env, T, "4w", undefined, NOW);
    const named = await readWasteAnalyzer(h.env, T, "4w", "waste-avoidability-v1", NOW);
    const repeatedNamed = await readWasteAnalyzer(h.env, T, "4w", "waste-avoidability-v1", NOW);

    expect(current.avoidability_mapping).toEqual({
      version: "waste-avoidability-v1",
      current_version: "waste-avoidability-v1",
      is_current: true,
    });
    expect(named.avoidability_mapping).toEqual(current.avoidability_mapping);
    expect(named.breakdowns.avoidability).toEqual(current.breakdowns.avoidability);
    expect(repeatedNamed).toEqual(named);
    expect(named.breakdowns.reason.items.map((item) => item.key).sort()).toEqual(
      [...WASTE_REASONS].sort(),
    );
    expect(new Map(named.breakdowns.avoidability.items.map((item) => [item.key, item.event_count]))).toEqual(
      new Map([
        ["avoidable", 5],
        ["hard_to_avoid", 5],
      ]),
    );

    const sameReason = sqliteEnv([T]);
    seedWaste(sameReason, {
      id: "W-forgot-plain",
      item_id: "forgot-plain",
      name: "Plain",
      quantity: "1",
      department: "produce",
      prepared_from: null,
      reason: "forgot",
    });
    seedWaste(sameReason, {
      id: "W-forgot-leftover",
      item_id: "forgot-leftover",
      name: "Different name",
      quantity: "a tray",
      department: null,
      prepared_from: "dinner",
      reason: "forgot",
    });
    seedSpend(sameReason, { send_id: "S-forgot-plain", line_key: "forgot-plain", unit_price: 1, amount: 1 });
    seedSpend(sameReason, { send_id: "S-forgot-leftover", line_key: "forgot-leftover", unit_price: 20, amount: 20 });
    expect((await readWasteAnalyzer(
      sameReason.env,
      T,
      "4w",
      "waste-avoidability-v1",
      NOW,
    )).breakdowns.avoidability.items).toEqual([
      expect.objectContaining({ key: "avoidable", event_count: 2 }),
    ]);

    await expect(
      readWasteAnalyzer(h.env, T, "4w", "waste-avoidability-unknown", NOW),
    ).rejects.toMatchObject({
      code: "validation_failed",
      message: "unsupported waste avoidability mapping version; supported versions: waste-avoidability-v1",
    });
  });

  it("distinguishes exact empty and fully unvalued history while counting persisted rows", async () => {
    const empty = sqliteEnv([T]);
    const emptyResult = await readWasteAnalyzer(empty.env, T, "4w", undefined, NOW);
    expect(emptyResult.status).toBe("empty");
    expect(emptyResult.coverage).toEqual({
      monetary: {
        status: "empty",
        event_count: 0,
        priced_event_count: 0,
        unpriced_event_count: 0,
        estimated_event_count: 0,
        known_amount: 0,
      },
      department: {
        status: "empty",
        event_count: 0,
        classified_event_count: 0,
        pending_event_count: 0,
      },
    });
    expect(emptyResult.weeks).toHaveLength(4);
    expect(emptyResult.weeks.every((week) =>
      week.status === "empty" && week.events === 0 && week.amount === 0
    )).toBe(true);
    expect(emptyResult.kpis.tossed_value).toEqual({ amount: 0, status: "empty" });
    expect(emptyResult.kpis.items_binned).toEqual({ count: 0, per_week: 0 });
    expect(emptyResult.kpis.trend).toEqual({
      percent: null,
      current_known_amount: 0,
      prior_known_amount: 0,
      status: "unavailable",
      reason: "prior_zero",
    });
    expect(emptyResult.kpis.waste_rate).toMatchObject({
      percent: null,
      known_waste_amount: 0,
      qualifying_spend_amount: 0,
      status: "unavailable",
      reason: "zero_denominator",
    });
    expect(emptyResult.insight).toBe("No recorded waste in this range.");

    const unvalued = sqliteEnv([T]);
    for (let index = 0; index < 8; index++) {
      seedWaste(unvalued, {
        id: `W-unvalued-${index}`,
        item_id: `unvalued-${index}`,
        quantity: index % 2 === 0 ? "2" : "a little",
        occurred_at: index < 4 ? "2026-06-01" : "2026-07-14",
      });
    }
    const unvaluedResult = await readWasteAnalyzer(unvalued.env, T, "8w", undefined, NOW);
    expect(unvaluedResult.status).toBe("unavailable");
    expect(unvaluedResult.coverage.monetary).toEqual({
      status: "unavailable",
      event_count: 8,
      priced_event_count: 0,
      unpriced_event_count: 8,
      estimated_event_count: 0,
      known_amount: 0,
    });
    expect(unvaluedResult.kpis.tossed_value).toEqual({ amount: null, status: "unavailable" });
    expect(unvaluedResult.kpis.items_binned).toEqual({ count: 8, per_week: 1 });
    expect(unvaluedResult.insight).toBe(
      "Waste value is unavailable because none of the recorded tosses in this range has a matching last-paid price.",
    );
  });

  it("keeps monetary and department coverage independent in every selected week", async () => {
    const h = sqliteEnv([T]);
    seedWaste(h, { id: "W-complete-week", item_id: "complete-week", occurred_at: "2026-06-22" });
    seedSpend(h, { send_id: "S-complete-week", line_key: "complete-week", occurred_on: "2026-06-22", unit_price: 10, amount: 10 });
    seedWaste(h, { id: "W-unavailable-week", item_id: "unavailable-week", occurred_at: "2026-06-30", department: null });
    seedWaste(h, { id: "W-partial-week", item_id: "partial-week", occurred_at: "2026-07-14" });
    seedSpend(h, { send_id: "S-partial-week", line_key: "partial-week", occurred_on: "2026-07-14", unit_price: 5, amount: 5, estimated: 1 });
    seedWaste(h, { id: "W-prior-unvalued", item_id: "prior-unvalued", occurred_at: "2026-06-01" });

    const result = await readWasteAnalyzer(h.env, T, "4w", undefined, NOW);
    expect(result.status).toBe("partial");
    expect(result.coverage.monetary).toEqual({
      status: "partial",
      event_count: 3,
      priced_event_count: 2,
      unpriced_event_count: 1,
      estimated_event_count: 1,
      known_amount: 15,
    });
    expect(result.kpis.items_binned).toEqual({ count: 3, per_week: 0.8 });
    expect(result.weeks.map((week) => ({
      week_start: week.week_start,
      events: week.events,
      amount: week.amount,
      status: week.status,
      department_status: week.department_coverage.status,
    }))).toEqual([
      { week_start: "2026-06-22", events: 1, amount: 10, status: "complete", department_status: "complete" },
      { week_start: "2026-06-29", events: 1, amount: null, status: "unavailable", department_status: "unavailable" },
      { week_start: "2026-07-06", events: 0, amount: 0, status: "empty", department_status: "empty" },
      { week_start: "2026-07-13", events: 1, amount: 5, status: "partial", department_status: "complete" },
    ]);
    expect(result.weeks[1].monetary_coverage).toEqual({
      status: "unavailable",
      event_count: 1,
      priced_event_count: 0,
      unpriced_event_count: 1,
      estimated_event_count: 0,
      known_amount: 0,
    });
    expect(result.weeks[3].monetary_coverage).toEqual({
      status: "partial",
      event_count: 1,
      priced_event_count: 1,
      unpriced_event_count: 0,
      estimated_event_count: 1,
      known_amount: 5,
    });
    expect(result.kpis.trend).toEqual({
      percent: null,
      current_known_amount: 15,
      prior_known_amount: 0,
      status: "unavailable",
      reason: "current_incomplete",
    });
  });

  it("applies matched-prior trend arithmetic and reason precedence without prior coverage fields", async () => {
    const available = sqliteEnv([T]);
    seedWaste(available, { id: "W-prior", item_id: "prior", occurred_at: "2026-06-01" });
    seedSpend(available, { send_id: "S-prior", line_key: "prior", occurred_on: "2026-06-01", unit_price: 100, amount: 100 });
    seedWaste(available, { id: "W-current", item_id: "current", occurred_at: "2026-07-01" });
    seedSpend(available, { send_id: "S-current", line_key: "current", occurred_on: "2026-07-01", unit_price: 75, amount: 75 });
    expect((await readWasteAnalyzer(available.env, T, "4w", undefined, NOW)).kpis.trend).toEqual({
      percent: -25,
      current_known_amount: 75,
      prior_known_amount: 100,
      status: "available",
      reason: null,
    });

    const emptyCurrent = sqliteEnv([T]);
    seedWaste(emptyCurrent, { id: "W-prior", item_id: "prior", occurred_at: "2026-06-01" });
    seedSpend(emptyCurrent, { send_id: "S-prior", line_key: "prior", occurred_on: "2026-06-01", unit_price: 100, amount: 100 });
    expect((await readWasteAnalyzer(emptyCurrent.env, T, "4w", undefined, NOW)).kpis.trend).toEqual({
      percent: -100,
      current_known_amount: 0,
      prior_known_amount: 100,
      status: "available",
      reason: null,
    });

    const priorPartial = sqliteEnv([T]);
    seedWaste(priorPartial, { id: "W-prior-priced", item_id: "prior-priced", occurred_at: "2026-06-01" });
    seedSpend(priorPartial, { send_id: "S-prior-priced", line_key: "prior-priced", occurred_on: "2026-06-01", unit_price: 5, amount: 5, estimated: 1 });
    seedWaste(priorPartial, { id: "W-prior-missing", item_id: "prior-missing", occurred_at: "2026-06-02" });
    seedWaste(priorPartial, { id: "W-current", item_id: "current", occurred_at: "2026-07-01" });
    seedSpend(priorPartial, { send_id: "S-current", line_key: "current", occurred_on: "2026-07-01", unit_price: 10, amount: 10 });
    const priorIncompleteTrend = (await readWasteAnalyzer(
      priorPartial.env,
      T,
      "4w",
      undefined,
      NOW,
    )).kpis.trend;
    expect(priorIncompleteTrend).toEqual({
      percent: null,
      current_known_amount: 10,
      prior_known_amount: 5,
      status: "unavailable",
      reason: "prior_incomplete",
    });
    expect(Object.keys(priorIncompleteTrend).sort()).toEqual([
      "current_known_amount",
      "percent",
      "prior_known_amount",
      "reason",
      "status",
    ]);

    const currentAndPriorIncomplete = sqliteEnv([T]);
    seedWaste(currentAndPriorIncomplete, { id: "W-prior", item_id: "prior", occurred_at: "2026-06-01" });
    seedWaste(currentAndPriorIncomplete, { id: "W-current", item_id: "current", occurred_at: "2026-07-01" });
    expect((await readWasteAnalyzer(
      currentAndPriorIncomplete.env,
      T,
      "4w",
      undefined,
      NOW,
    )).kpis.trend.reason).toBe("current_incomplete");

    const zeroPrior = sqliteEnv([T]);
    seedWaste(zeroPrior, { id: "W-prior", item_id: "prior", occurred_at: "2026-06-01" });
    seedSpend(zeroPrior, { send_id: "S-prior", line_key: "prior", occurred_on: "2026-06-01", unit_price: 0, amount: 0 });
    seedWaste(zeroPrior, { id: "W-current", item_id: "current", occurred_at: "2026-07-01" });
    seedSpend(zeroPrior, { send_id: "S-current", line_key: "current", occurred_on: "2026-07-01", unit_price: 10, amount: 10 });
    expect((await readWasteAnalyzer(zeroPrior.env, T, "4w", undefined, NOW)).kpis.trend).toEqual({
      percent: null,
      current_known_amount: 10,
      prior_known_amount: 0,
      status: "unavailable",
      reason: "prior_zero",
    });
  });

  it("derives Leftovers while keeping pending Waste department separate from money and Spend-rate coverage", async () => {
    const h = sqliteEnv([T]);
    seedWaste(h, {
      id: "W-leftover",
      item_id: "leftover",
      prepared_from: "stew",
      department: null,
      reason: "forgot",
      occurred_at: "2026-07-14",
    });
    seedSpend(h, { send_id: "S-leftover", line_key: "leftover", occurred_on: "2026-07-14", unit_price: 10, amount: 10, department: "produce" });
    seedWaste(h, {
      id: "W-pending",
      item_id: "pending",
      department: null,
      reason: "spoiled",
      occurred_at: "2026-07-14",
    });
    seedSpend(h, { send_id: "S-pending", line_key: "pending", occurred_on: "2026-07-14", unit_price: 5, amount: 5, department: "produce" });

    const beforePendingSpend = await readWasteAnalyzer(h.env, T, "4w", undefined, NOW);
    expect(beforePendingSpend.status).toBe("complete");
    expect(beforePendingSpend.coverage.monetary).toMatchObject({
      status: "complete",
      event_count: 2,
      known_amount: 15,
    });
    expect(beforePendingSpend.kpis.tossed_value).toEqual({ amount: 15, status: "complete" });
    expect(beforePendingSpend.coverage.department).toEqual({
      status: "partial",
      event_count: 2,
      classified_event_count: 1,
      pending_event_count: 1,
    });
    expect(beforePendingSpend.breakdowns.department).toMatchObject({
      count_denominator: 1,
      known_amount_denominator: 10,
      items: [{ key: "leftovers", label: "Leftovers", event_count: 1, amount: 10 }],
    });
    expect(beforePendingSpend.most_wasted.items.find((item) => item.key === "leftover")?.department).toEqual({
      key: "leftovers",
      label: "Leftovers",
    });
    expect(beforePendingSpend.most_wasted.items.find((item) => item.key === "pending")?.department).toBeNull();
    expect(beforePendingSpend.kpis.waste_rate).toMatchObject({
      percent: 50,
      status: "available",
      reason: null,
    });
    expect(beforePendingSpend.insight).toBe(
      "Forgot was the leading waste reason by known value with 1 tossed item; avoidable waste represented 66.7% of known waste value.",
    );

    seedSpend(h, {
      send_id: "S-awaiting-department",
      line_key: "awaiting-department",
      occurred_on: "2026-07-14",
      unit_price: 8,
      amount: 8,
      department: null,
    });
    const afterPendingSpend = await readWasteAnalyzer(h.env, T, "4w", undefined, NOW);
    expect(afterPendingSpend.status).toBe("complete");
    expect(afterPendingSpend.coverage.department).toEqual(beforePendingSpend.coverage.department);
    expect(afterPendingSpend.kpis.waste_rate).toMatchObject({
      percent: null,
      known_waste_amount: 15,
      qualifying_spend_amount: 15,
      status: "unavailable",
      reason: "spend_incomplete",
      spend_coverage: {
        status: "partial",
        spend_event_count: 3,
        qualifying_event_count: 2,
        pending_department_event_count: 1,
        known_amount: 15,
      },
    });

    const allPending = sqliteEnv([T]);
    seedWaste(allPending, { id: "W-all-pending", item_id: "all-pending", department: null, reason: "spoiled" });
    seedSpend(allPending, { send_id: "S-all-pending", line_key: "all-pending", unit_price: 4, amount: 4, department: "produce" });
    const allPendingResult = await readWasteAnalyzer(allPending.env, T, "4w", undefined, NOW);
    expect(allPendingResult.status).toBe("complete");
    expect(allPendingResult.coverage.department).toEqual({
      status: "unavailable",
      event_count: 1,
      classified_event_count: 0,
      pending_event_count: 1,
    });
    expect(allPendingResult.breakdowns.department).toMatchObject({
      count_denominator: 0,
      known_amount_denominator: 0,
      items: [],
    });
    expect(allPendingResult.insight).toBe(
      "Spoiled was the leading waste reason by known value with 1 tossed item; avoidable waste represented 0.0% of known waste value.",
    );
  });

  it("uses exact qualifying recorded Spend coverage for every Waste-rate edge", async () => {
    const mixed = sqliteEnv([T]);
    seedWaste(mixed, { id: "W-rate", item_id: "rate", occurred_at: "2026-07-14" });
    seedSpend(mixed, { send_id: "S-rate-history", line_key: "rate", occurred_on: "2026-06-20", unit_price: 7, amount: 7 });
    seedSpend(mixed, { send_id: "S-produce", line_key: "produce-spend", occurred_on: "2026-07-01", unit_price: 20, amount: 20, department: "produce" });
    seedSpend(mixed, { send_id: "S-beverages", line_key: "beverages-spend", occurred_on: "2026-07-02", unit_price: 8, amount: 8, department: "beverages" });
    seedSpend(mixed, { send_id: "S-household", line_key: "household-spend", occurred_on: "2026-07-03", unit_price: null, amount: null, estimated: 1, department: "household" });
    const mixedResult = await readWasteAnalyzer(mixed.env, T, "4w", undefined, NOW);
    expect(mixedResult.kpis.waste_rate).toEqual({
      percent: 20,
      known_waste_amount: 7,
      qualifying_spend_amount: 28,
      status: "available",
      reason: null,
      spend_coverage: {
        status: "complete",
        spend_event_count: 3,
        qualifying_event_count: 2,
        excluded_household_event_count: 1,
        pending_department_event_count: 0,
        priced_event_count: 2,
        unpriced_event_count: 0,
        estimated_event_count: 0,
        known_amount: 28,
      },
    });

    const householdOnly = sqliteEnv([T]);
    seedWaste(householdOnly, { id: "W-rate", item_id: "rate", occurred_at: "2026-07-14" });
    seedSpend(householdOnly, { send_id: "S-rate-history", line_key: "rate", occurred_on: "2026-06-20", unit_price: 5, amount: 5 });
    seedSpend(householdOnly, { send_id: "S-household", line_key: "household-spend", occurred_on: "2026-07-01", unit_price: null, amount: null, estimated: 1, department: "household" });
    const householdOnlyResult = await readWasteAnalyzer(householdOnly.env, T, "4w", undefined, NOW);
    expect(householdOnlyResult.kpis.waste_rate).toMatchObject({
      percent: 100,
      known_waste_amount: 5,
      qualifying_spend_amount: 0,
      status: "available",
      reason: null,
      spend_coverage: {
        status: "empty",
        spend_event_count: 1,
        qualifying_event_count: 0,
        excluded_household_event_count: 1,
        pending_department_event_count: 0,
        priced_event_count: 0,
        unpriced_event_count: 0,
        estimated_event_count: 0,
        known_amount: 0,
      },
    });

    const emptyWaste = sqliteEnv([T]);
    seedSpend(emptyWaste, { send_id: "S-produce", line_key: "produce-spend", occurred_on: "2026-07-01", unit_price: 10, amount: 10, department: "produce" });
    expect((await readWasteAnalyzer(emptyWaste.env, T, "4w", undefined, NOW)).kpis.waste_rate).toMatchObject({
      percent: 0,
      known_waste_amount: 0,
      qualifying_spend_amount: 10,
      status: "available",
      reason: null,
    });

    const zeroDenominator = sqliteEnv([T]);
    seedWaste(zeroDenominator, { id: "W-zero", item_id: "zero", occurred_at: "2026-07-14" });
    seedSpend(zeroDenominator, { send_id: "S-zero-history", line_key: "zero", occurred_on: "2026-06-20", unit_price: 0, amount: 0 });
    expect((await readWasteAnalyzer(
      zeroDenominator.env,
      T,
      "4w",
      undefined,
      NOW,
    )).kpis.waste_rate).toMatchObject({
      percent: null,
      known_waste_amount: 0,
      qualifying_spend_amount: 0,
      status: "unavailable",
      reason: "zero_denominator",
    });

    const bothIncomplete = sqliteEnv([T]);
    seedWaste(bothIncomplete, { id: "W-missing", item_id: "missing", occurred_at: "2026-07-14" });
    seedSpend(bothIncomplete, { send_id: "S-pending", line_key: "pending", occurred_on: "2026-07-01", unit_price: 10, amount: 10, department: null });
    expect((await readWasteAnalyzer(
      bothIncomplete.env,
      T,
      "4w",
      undefined,
      NOW,
    )).kpis.waste_rate).toMatchObject({
      percent: null,
      status: "unavailable",
      reason: "waste_incomplete",
    });

    const spendIncomplete = sqliteEnv([T]);
    seedWaste(spendIncomplete, { id: "W-valued", item_id: "valued", occurred_at: "2026-07-14" });
    seedSpend(spendIncomplete, { send_id: "S-valued-history", line_key: "valued", occurred_on: "2026-06-20", unit_price: 5, amount: 5 });
    seedSpend(spendIncomplete, { send_id: "S-known", line_key: "known", occurred_on: "2026-07-01", unit_price: 10, amount: 10, estimated: 1, department: "produce" });
    expect((await readWasteAnalyzer(
      spendIncomplete.env,
      T,
      "4w",
      undefined,
      NOW,
    )).kpis.waste_rate).toMatchObject({
      percent: null,
      known_waste_amount: 5,
      qualifying_spend_amount: 10,
      status: "unavailable",
      reason: "spend_incomplete",
      spend_coverage: { status: "partial", estimated_event_count: 1 },
    });
  });

  it("uses explicit classified and known-value denominators for every sparse breakdown", async () => {
    const h = sqliteEnv([T]);
    seedWaste(h, {
      id: "W-leftovers",
      item_id: "leftovers-item",
      prepared_from: "soup",
      department: "household",
      reason: "forgot",
      occurred_at: "2026-07-14",
    });
    seedSpend(h, { send_id: "S-leftovers", line_key: "leftovers-item", occurred_on: "2026-06-20", unit_price: 10, amount: 10 });
    seedWaste(h, {
      id: "W-produce",
      item_id: "produce-item",
      department: "produce",
      reason: "spoiled",
      occurred_at: "2026-07-14",
    });
    seedSpend(h, { send_id: "S-produce-history", line_key: "produce-item", occurred_on: "2026-06-20", unit_price: 5, amount: 5, estimated: 1 });
    seedWaste(h, {
      id: "W-pending",
      item_id: "pending-item",
      department: null,
      reason: "forgot",
      occurred_at: "2026-07-14",
    });
    seedWaste(h, {
      id: "W-dairy",
      item_id: "dairy-item",
      department: "dairy",
      reason: "other",
      occurred_at: "2026-07-14",
    });

    const result = await readWasteAnalyzer(h.env, T, "4w", undefined, NOW);
    expect(result.coverage.monetary).toMatchObject({
      status: "partial",
      event_count: 4,
      priced_event_count: 2,
      unpriced_event_count: 2,
      estimated_event_count: 1,
      known_amount: 15,
    });
    expect(result.breakdowns.department).toEqual({
      count_denominator: 3,
      known_amount_denominator: 15,
      classification_coverage: {
        status: "partial",
        event_count: 4,
        classified_event_count: 3,
        pending_event_count: 1,
      },
      monetary_coverage: {
        status: "partial",
        event_count: 3,
        priced_event_count: 2,
        unpriced_event_count: 1,
        estimated_event_count: 1,
        known_amount: 15,
      },
      items: [
        {
          key: "leftovers",
          label: "Leftovers",
          event_count: 1,
          valued_event_count: 1,
          unvalued_event_count: 0,
          estimated_event_count: 0,
          amount: 10,
          count_percentage: 33.3,
          amount_percentage: 66.7,
        },
        {
          key: "produce",
          label: "Produce",
          event_count: 1,
          valued_event_count: 1,
          unvalued_event_count: 0,
          estimated_event_count: 1,
          amount: 5,
          count_percentage: 33.3,
          amount_percentage: 33.3,
        },
        {
          key: "dairy",
          label: "Dairy",
          event_count: 1,
          valued_event_count: 0,
          unvalued_event_count: 1,
          estimated_event_count: 0,
          amount: null,
          count_percentage: 33.3,
          amount_percentage: 0,
        },
      ],
    });
    expect(result.breakdowns.reason).toEqual({
      count_denominator: 4,
      known_amount_denominator: 15,
      classification_coverage: {
        status: "complete",
        event_count: 4,
        classified_event_count: 4,
        pending_event_count: 0,
      },
      monetary_coverage: result.coverage.monetary,
      items: [
        {
          key: "forgot",
          label: "Forgot",
          event_count: 2,
          valued_event_count: 1,
          unvalued_event_count: 1,
          estimated_event_count: 0,
          amount: 10,
          count_percentage: 50,
          amount_percentage: 66.7,
        },
        {
          key: "spoiled",
          label: "Spoiled",
          event_count: 1,
          valued_event_count: 1,
          unvalued_event_count: 0,
          estimated_event_count: 1,
          amount: 5,
          count_percentage: 25,
          amount_percentage: 33.3,
        },
        {
          key: "other",
          label: "Other",
          event_count: 1,
          valued_event_count: 0,
          unvalued_event_count: 1,
          estimated_event_count: 0,
          amount: null,
          count_percentage: 25,
          amount_percentage: 0,
        },
      ],
    });
    expect(result.breakdowns.avoidability).toEqual({
      count_denominator: 4,
      known_amount_denominator: 15,
      classification_coverage: {
        status: "complete",
        event_count: 4,
        classified_event_count: 4,
        pending_event_count: 0,
      },
      monetary_coverage: result.coverage.monetary,
      items: [
        {
          key: "avoidable",
          label: "Avoidable",
          event_count: 2,
          valued_event_count: 1,
          unvalued_event_count: 1,
          estimated_event_count: 0,
          amount: 10,
          count_percentage: 50,
          amount_percentage: 66.7,
        },
        {
          key: "hard_to_avoid",
          label: "Hard to avoid",
          event_count: 2,
          valued_event_count: 1,
          unvalued_event_count: 1,
          estimated_event_count: 1,
          amount: 5,
          count_percentage: 50,
          amount_percentage: 33.3,
        },
      ],
    });
  });

  it("orders tied breakdown groups by canonical key rather than labels or row order", async () => {
    const h = sqliteEnv([T]);
    seedWaste(h, { id: "W-z", item_id: "z", department: "produce", reason: "spoiled" });
    seedSpend(h, { send_id: "S-z", line_key: "z", occurred_on: "2026-06-20", unit_price: 5, amount: 5 });
    seedWaste(h, { id: "W-a", item_id: "a", department: "dairy", reason: "moldy" });
    seedSpend(h, { send_id: "S-a", line_key: "a", occurred_on: "2026-06-20", unit_price: 5, amount: 5 });
    const result = await readWasteAnalyzer(h.env, T, "4w", undefined, NOW);
    expect(result.breakdowns.department.items.map((item) => item.key)).toEqual(["dairy", "produce"]);
    expect(result.breakdowns.reason.items.map((item) => item.key)).toEqual(["moldy", "spoiled"]);
    expect(result.insight).toBe(
      "Dairy accounted for the most waste at $5.00; Moldy was the leading reason by known waste value with 1 tossed item; avoidable waste represented 0.0% of known waste value.",
    );
  });

  it("orders and caps valued, zero, partial, and unvalued item groups with stable representatives", async () => {
    const h = sqliteEnv([T]);

    seedWaste(h, { id: "W-rep-old", item_id: "rep", name: "Old name", department: "bakery", occurred_at: "2026-06-23" });
    seedSpend(h, { send_id: "S-rep", line_key: "rep", occurred_on: "2026-06-24", unit_price: 6, amount: 6 });
    seedWaste(h, { id: "W-rep-a", item_id: "rep", name: "Latest A", department: "produce", occurred_at: "2026-07-14" });
    seedWaste(h, { id: "W-rep-z", item_id: "rep", name: "Latest Z", department: "dairy", occurred_at: "2026-07-14" });

    for (const key of ["alpha", "beta"] as const) {
      seedSpend(h, { send_id: `S-${key}`, line_key: key, occurred_on: "2026-06-20", unit_price: 3, amount: 3 });
      seedWaste(h, { id: `W-${key}-1`, item_id: key, occurred_at: "2026-07-01" });
      seedWaste(h, { id: `W-${key}-2`, item_id: key, occurred_at: "2026-07-02" });
    }

    seedSpend(h, { send_id: "S-zero-group", line_key: "zero-group", occurred_on: "2026-06-20", unit_price: 0, amount: 0 });
    seedWaste(h, { id: "W-zero-group", item_id: "zero-group", occurred_at: "2026-07-03" });
    seedWaste(h, { id: "W-unvalued-many-1", item_id: "unvalued-many", occurred_at: "2026-07-04" });
    seedWaste(h, { id: "W-unvalued-many-2", item_id: "unvalued-many", occurred_at: "2026-07-05" });
    seedWaste(h, { id: "W-unvalued-a", item_id: "unvalued-a", occurred_at: "2026-07-06" });
    seedWaste(h, { id: "W-unvalued-b", item_id: "unvalued-b", occurred_at: "2026-07-06" });

    const result = await readWasteAnalyzer(h.env, T, "4w", undefined, NOW);
    expect(result.coverage.monetary).toMatchObject({
      status: "partial",
      event_count: 12,
      priced_event_count: 7,
      unpriced_event_count: 5,
      known_amount: 24,
    });
    expect(result.most_wasted.cap).toBe(6);
    expect(result.most_wasted.total_count).toBe(7);
    expect(result.most_wasted.items.map((item) => item.key)).toEqual([
      "rep",
      "alpha",
      "beta",
      "zero-group",
      "unvalued-many",
      "unvalued-a",
    ]);
    expect(result.most_wasted.items[0]).toEqual({
      key: "rep",
      name: "Latest Z",
      department: { key: "dairy", label: "Dairy" },
      event_count: 3,
      valued_event_count: 2,
      unvalued_event_count: 1,
      estimated_event_count: 0,
      amount: 12,
      amount_percentage: 50,
      status: "partial",
    });
    expect(result.most_wasted.items.find((item) => item.key === "alpha")).toMatchObject({
      event_count: 2,
      amount: 6,
      amount_percentage: 25,
      status: "complete",
    });
    expect(result.most_wasted.items.find((item) => item.key === "zero-group")).toMatchObject({
      valued_event_count: 1,
      amount: 0,
      amount_percentage: 0,
      status: "complete",
    });
    expect(result.most_wasted.items.find((item) => item.key === "unvalued-many")).toMatchObject({
      event_count: 2,
      valued_event_count: 0,
      amount: null,
      amount_percentage: 0,
      status: "unavailable",
    });
    expect(new Set(result.most_wasted.items.map((item) => item.status))).toEqual(
      new Set(["complete", "partial", "unavailable"]),
    );
    expect(result.most_wasted.items.some((item) => (item.status as string) === "empty")).toBe(false);
  });

  it("authors the remaining exact partial, complete, and known-zero insight templates", async () => {
    const partial = sqliteEnv([T]);
    seedWaste(partial, { id: "W-missing", item_id: "missing", reason: "other" });
    for (const [index, reason] of ["forgot", "spoiled"].entries()) {
      const key = `estimated-${index}`;
      seedWaste(partial, { id: `W-${key}`, item_id: key, reason });
      seedSpend(partial, { send_id: `S-${key}`, line_key: key, occurred_on: "2026-06-20", unit_price: 2, amount: 2, estimated: 1 });
    }
    expect((await readWasteAnalyzer(partial.env, T, "4w", undefined, NOW)).insight).toBe(
      "Known waste value is incomplete: 1 tossed item had no matching last-paid price and 2 tossed items used an estimated last-paid price.",
    );

    const complete = sqliteEnv([T]);
    for (const index of [0, 1]) {
      const key = `produce-${index}`;
      seedWaste(complete, { id: `W-${key}`, item_id: key, department: "produce", reason: "forgot" });
      seedSpend(complete, { send_id: `S-${key}`, line_key: key, occurred_on: "2026-06-20", unit_price: 5, amount: 5 });
    }
    expect((await readWasteAnalyzer(complete.env, T, "4w", undefined, NOW)).insight).toBe(
      "Produce accounted for the most waste at $10.00; Forgot was the leading reason by known waste value with 2 tossed items; avoidable waste represented 100.0% of known waste value.",
    );

    const knownZero = sqliteEnv([T]);
    seedWaste(knownZero, { id: "W-known-zero", item_id: "known-zero", department: "produce", reason: "spoiled" });
    seedSpend(knownZero, { send_id: "S-known-zero", line_key: "known-zero", occurred_on: "2026-06-20", unit_price: 0, amount: 0 });
    expect((await readWasteAnalyzer(knownZero.env, T, "4w", undefined, NOW)).insight).toBe(
      "Produce accounted for the most waste at $0.00; Spoiled was the leading reason by known waste value with 1 tossed item.",
    );
  });

  it("converges across production late capture, replay, newer purchase, and void correction", async () => {
    const h = sqliteEnv([T]);
    const schemaBefore = h.raw.prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    ).all();
    expect((await readWasteAnalyzer(h.env, T, "4w", undefined, NOW)).status).toBe("empty");

    await applyPantryRowOps(
      h.env,
      T,
      [{ op: "add", item: { name: "Late greens", quantity: "three bags", category: "produce" } }],
      "2026-07-15",
    );
    const lateWaste = {
      op: "dispose" as const,
      name: "late greens",
      disposition: "waste" as const,
      reason: "forgot" as const,
      event_id: "W-LATE-REPLAY",
      occurred_at: "2026-07-01",
    };
    expect(await applyPantryRowOps(h.env, T, [lateWaste], "2026-07-15")).toMatchObject({
      applied: [{ op: "dispose", name: "late greens", disposition: "waste" }],
      conflicts: [],
    });
    const afterWaste = await readWasteAnalyzer(h.env, T, "4w", undefined, NOW);
    expect(afterWaste.coverage.monetary).toMatchObject({
      status: "unavailable",
      event_count: 1,
      unpriced_event_count: 1,
    });

    expect(await applyPantryRowOps(h.env, T, [lateWaste], "2026-07-15")).toMatchObject({
      applied: [{ op: "dispose", name: "late greens", disposition: "waste" }],
      conflicts: [],
    });
    expect(h.rows("waste_events")).toHaveLength(1);
    expect((await readWasteAnalyzer(h.env, T, "4w", undefined, NOW)).kpis.items_binned.count).toBe(1);

    await capturePurchase(h, {
      sendId: "S-LATE-OLDER",
      lineKey: "late greens",
      occurredOn: "2026-06-29",
      unitPrice: 4,
    });
    expect((await readWasteAnalyzer(h.env, T, "4w", undefined, NOW)).kpis.tossed_value).toEqual({
      amount: 4,
      status: "complete",
    });

    await capturePurchase(h, {
      sendId: "S-LATE-NEWER",
      lineKey: "late greens",
      occurredOn: "2026-06-30",
      unitPrice: 12,
    });
    const afterNewer = await readWasteAnalyzer(h.env, T, "4w", undefined, NOW);
    expect(afterNewer.kpis.tossed_value).toEqual({ amount: 12, status: "complete" });

    await voidSpendEvents(h.env, T, [{ sendId: "S-LATE-NEWER", lineKey: "late greens" }]);
    const afterNewerVoid = await readWasteAnalyzer(h.env, T, "4w", undefined, NOW);
    expect(afterNewerVoid.kpis.tossed_value).toEqual({ amount: 4, status: "complete" });

    await voidSpendEvents(h.env, T, [{ sendId: "S-LATE-OLDER", lineKey: "late greens" }]);
    const afterAllVoids = await readWasteAnalyzer(h.env, T, "4w", undefined, NOW);
    expect(afterAllVoids.kpis.tossed_value).toEqual({ amount: null, status: "unavailable" });

    const stateBeforeRepeat = {
      waste: h.rows("waste_events"),
      spend: h.rows("spend_events"),
      pantry: h.rows("pantry"),
      sends: h.rows("order_sends"),
      lines: h.rows("order_send_lines"),
    };
    expect(await readWasteAnalyzer(h.env, T, "4w", undefined, NOW)).toEqual(afterAllVoids);
    expect(await readWasteAnalyzer(h.env, T, "4w", undefined, NOW)).toEqual(afterAllVoids);
    expect({
      waste: h.rows("waste_events"),
      spend: h.rows("spend_events"),
      pantry: h.rows("pantry"),
      sends: h.rows("order_sends"),
      lines: h.rows("order_send_lines"),
    }).toEqual(stateBeforeRepeat);
    expect(h.raw.prepare(
      "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
    ).all()).toEqual(schemaBefore);
  });

  it("reads fresh full-migration storage and legacy-shaped nullable past rows through one reader", async () => {
    const fresh = sqliteEnv([T]);
    const freshResult = await readWasteAnalyzer(fresh.env, T, "4w", undefined, NOW);
    expect(freshResult.status).toBe("empty");
    expect(freshResult.weeks).toHaveLength(4);

    const withLegacyRows = sqliteEnv([T]);
    seedWaste(withLegacyRows, {
      id: "W-legacy-null",
      item_id: "legacy-null",
      name: "Legacy nullable row",
      prepared_from: null,
      quantity: null,
      department: null,
      reason: "expired",
      occurred_at: "2026-07-01",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    seedSpend(withLegacyRows, {
      send_id: "S-legacy-null",
      line_key: "legacy-null",
      occurred_on: "2026-06-30",
      unit_price: null,
      amount: null,
      department: null,
    });
    const legacyResult = await readWasteAnalyzer(withLegacyRows.env, T, "4w", undefined, NOW);
    expect(legacyResult.coverage).toEqual({
      monetary: {
        status: "unavailable",
        event_count: 1,
        priced_event_count: 0,
        unpriced_event_count: 1,
        estimated_event_count: 0,
        known_amount: 0,
      },
      department: {
        status: "unavailable",
        event_count: 1,
        classified_event_count: 0,
        pending_event_count: 1,
      },
    });
    expect(legacyResult.kpis.tossed_value).toEqual({ amount: null, status: "unavailable" });
    expect(legacyResult.kpis.waste_rate).toMatchObject({
      percent: null,
      status: "unavailable",
      reason: "waste_incomplete",
    });
    expect(legacyResult.breakdowns.department.items).toEqual([]);
  });
});
