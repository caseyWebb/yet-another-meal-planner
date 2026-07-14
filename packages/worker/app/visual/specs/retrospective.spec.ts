// Retrospective (member-app-core): the tabbed shell, production Spend analyzer, meal-aware
// cooking composer, and /log redirect. Populated Spend assertions use the real seeded API;
// interception is limited to otherwise-unreachable loading/error/missingness presentations.
import { test, expect } from "../fixtures";
import type { BrowserContext, Locator, Page } from "@playwright/test";
import { SEED } from "../../../admin/visual/seed.mjs";
import type {
  CoverageStatus as SpendCoverageStatus,
  SpendAnalyzer,
  SpendRange,
} from "../../../src/spend-shapes";
import type {
  WasteAnalyzer,
  WasteRange,
  WasteWeek,
} from "../../../src/waste-shapes";

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const FIXED_SPEND = {
  "4w": {
    eventCount: 4, amount: 174, savings: 5, average: 43.5, costNumerator: 174,
    trend: { percent: 190, current_known_amount: 174, prior_known_amount: 60, status: "available", reason: null },
    departmentCount: 4, driverPercentage: 63.2,
    insight: "Meat was the largest department at $110.00. Planned purchases were 81.6% of known spend; impulse purchases were 18.4%. Spend was 190.0% higher than the matched prior range.",
  },
  "8w": {
    eventCount: 8, amount: 234, savings: 7, average: 29.25, costNumerator: 212,
    trend: { percent: 680, current_known_amount: 234, prior_known_amount: 30, status: "available", reason: null },
    departmentCount: 8, driverPercentage: 47,
    insight: "Meat was the largest department at $110.00. Planned purchases were 71.8% of known spend; impulse purchases were 28.2%. Spend was 680.0% higher than the matched prior range.",
  },
  "12w": {
    eventCount: 9, amount: 264, savings: 8, average: 22, costNumerator: 242,
    trend: { percent: null, current_known_amount: 264, prior_known_amount: 0, status: "unavailable", reason: "prior_zero" },
    departmentCount: 9, driverPercentage: 41.7,
    insight: "Meat was the largest department at $110.00. Planned purchases were 75.0% of known spend; impulse purchases were 25.0%.",
  },
} as const satisfies Readonly<Record<SpendRange, {
  eventCount: number;
  amount: number;
  savings: number;
  average: number;
  costNumerator: number;
  trend: SpendAnalyzer["kpis"]["trend"];
  departmentCount: number;
  driverPercentage: number;
  insight: string;
}>>;

function realSpendFixtureProjection(result: SpendAnalyzer) {
  return {
    range: result.range,
    status: result.status,
    coverage: result.coverage,
    weekly_budget: result.weekly_budget,
    awaiting_mark_placed: result.awaiting_mark_placed,
    kpis: result.kpis,
    breakdowns: {
      department: {
        status: result.breakdowns.department.status,
        known_denominator: result.breakdowns.department.known_denominator,
        item_count: result.breakdowns.department.items.length,
      },
      store: {
        status: result.breakdowns.store.status,
        known_denominator: result.breakdowns.store.known_denominator,
        item_count: result.breakdowns.store.items.length,
      },
      provenance: {
        status: result.breakdowns.provenance.status,
        known_denominator: result.breakdowns.provenance.known_denominator,
        item_count: result.breakdowns.provenance.items.length,
      },
    },
    top_drivers: {
      cap: result.top_drivers.cap,
      total_count: result.top_drivers.total_count,
      first: result.top_drivers.items[0],
    },
    insight: result.insight,
  };
}

function expectedRealSpendFixture(range: SpendRange) {
  const expected = FIXED_SPEND[range];
  return {
    range,
    status: "complete",
    coverage: {
      monetary: {
        status: "complete", event_count: expected.eventCount, priced_event_count: expected.eventCount,
        unpriced_event_count: 0, estimated_event_count: 0, known_amount: expected.amount,
      },
      department: {
        status: "complete", event_count: expected.eventCount, classified_event_count: expected.eventCount,
        pending_event_count: 0,
      },
      savings: {
        status: "complete", event_count: expected.eventCount, known_event_count: expected.eventCount,
        unknown_event_count: 0, known_savings: expected.savings,
      },
    },
    weekly_budget: 95,
    awaiting_mark_placed: 1,
    kpis: {
      total_spend: { amount: expected.amount, status: "complete" },
      average_per_week: { amount: expected.average, status: "complete" },
      cost_per_meal: {
        amount: expected.costNumerator, known_numerator: expected.costNumerator,
        meal_count: 1, status: "complete", reason: null,
      },
      trend: expected.trend,
    },
    breakdowns: {
      department: { status: "complete", known_denominator: expected.amount, item_count: expected.departmentCount },
      store: { status: "complete", known_denominator: expected.amount, item_count: 2 },
      provenance: { status: "complete", known_denominator: expected.amount, item_count: 2 },
    },
    top_drivers: {
      cap: 6,
      total_count: expected.eventCount,
      first: {
        key: "chicken-thighs", name: "Chicken thighs", department: { key: "meat", label: "Meat" },
        amount: 110, event_count: 1, priced_event_count: 1, unpriced_event_count: 0,
        percentage: expected.driverPercentage,
      },
    },
    insight: expected.insight,
  };
}

async function switchToSpendFixture(context: BrowserContext, page: Page): Promise<void> {
  await context.addCookies([{
    name: "__Host-session",
    value: `pw-app-session-${SEED.app.spend.fixtureTenant}`,
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  }]);
  await page.goto("/retrospective");
  await page.getByTestId("retro-page").waitFor();
}

async function switchToWasteFixture(context: BrowserContext, page: Page): Promise<void> {
  await context.addCookies([{
    name: "__Host-session",
    value: `pw-app-session-${SEED.app.waste.fixtureTenant}`,
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  }]);
  await page.goto("/retrospective");
  await page.getByTestId("retro-page").waitFor();
}

async function readFixedRealSpend(page: Page, range: SpendRange): Promise<SpendAnalyzer> {
  const response = await page.evaluate(async (selectedRange) => {
    const fetched = await fetch(`/api/retrospective/spend?range=${selectedRange}`);
    if (!fetched.ok) throw new Error(`Spend fixture read failed (${fetched.status})`);
    return fetched.json() as Promise<SpendAnalyzer>;
  }, range);

  expect(response.range).toBe(range);
  expect(realSpendFixtureProjection(response)).toEqual(expectedRealSpendFixture(range));
  return response;
}

async function expectFixedRealSpendUiState(
  retrospectivePage: {
    spendState: (state: SpendCoverageStatus) => Locator;
    spendInsight: () => Locator;
    spendAwaiting: () => Locator;
  },
  range: SpendRange,
): Promise<void> {
  const state = retrospectivePage.spendState("complete");
  await expect(state).toBeVisible();
  await expect(state).toContainText("Complete captured spend");
  await expect(retrospectivePage.spendInsight().locator("p")).toHaveText(FIXED_SPEND[range].insight);
  await expect(retrospectivePage.spendAwaiting()).toContainText('1 item is awaiting “mark placed.”');
  await expect(retrospectivePage.spendAwaiting()).toContainText("These sent cart items are not counted as spend.");
}

async function readFixedRealWaste(page: Page, range: WasteRange): Promise<WasteAnalyzer> {
  const response = await page.evaluate(async (selectedRange) => {
    const fetched = await fetch(`/api/retrospective/waste?range=${selectedRange}`);
    if (!fetched.ok) throw new Error(`Waste fixture read failed (${fetched.status})`);
    return fetched.json() as Promise<WasteAnalyzer>;
  }, range);

  expect(response.range).toBe(range);
  expect(response.status).toBe("complete");
  expect(response.weeks).toHaveLength(Number(range.slice(0, -1)));
  expect(response.coverage.monetary).toMatchObject({
    status: "complete",
    event_count: SEED.app.waste.events[range],
    priced_event_count: SEED.app.waste.events[range],
    unpriced_event_count: 0,
    estimated_event_count: 0,
    known_amount: SEED.app.waste.amounts[range],
  });
  expect(response.kpis.tossed_value).toEqual({ amount: SEED.app.waste.amounts[range], status: "complete" });
  expect(response.kpis.items_binned.count).toBe(SEED.app.waste.events[range]);
  expect(response.kpis.waste_rate).toMatchObject({
    percent: SEED.app.waste.rates[range],
    known_waste_amount: SEED.app.waste.amounts[range],
    status: "available",
    reason: null,
  });
  expect(response.avoidability_mapping).toEqual({
    version: "waste-avoidability-v1",
    current_version: "waste-avoidability-v1",
    is_current: true,
  });

  if (range === "8w") {
    expect(response.kpis.items_binned.per_week).toBe(0.8);
    expect(response.kpis.waste_rate.qualifying_spend_amount).toBe(222);
    expect(response.kpis.trend).toEqual({
      percent: 533.3,
      current_known_amount: 190,
      prior_known_amount: 30,
      status: "available",
      reason: null,
    });
    expect(response.breakdowns.department).toMatchObject({
      count_denominator: 6,
      known_amount_denominator: 190,
      classification_coverage: { status: "complete", classified_event_count: 6, pending_event_count: 0 },
    });
    expect(response.breakdowns.department.items.map((item) => item.key)).toEqual([
      "meat", "produce", "dairy", "frozen", "leftovers", "beverages",
    ]);
    expect(response.breakdowns.reason.items[0]).toMatchObject({
      key: "bought_too_much", label: "Bought Too Much", event_count: 1, amount: 110,
    });
    expect(response.breakdowns.avoidability.items).toEqual([
      expect.objectContaining({ key: "avoidable", label: "Avoidable", event_count: 3, amount: 140, amount_percentage: 73.7 }),
      expect.objectContaining({ key: "hard_to_avoid", label: "Hard to avoid", event_count: 3, amount: 50, amount_percentage: 26.3 }),
    ]);
    expect(response.most_wasted).toMatchObject({ cap: 6, total_count: 6 });
    expect(response.most_wasted.items[0]).toMatchObject(SEED.app.waste.topItem);
    expect(response.most_wasted.items.find((item) => item.key === SEED.app.waste.leftover.key)).toMatchObject({
      name: SEED.app.waste.leftover.name,
      department: { key: "leftovers", label: "Leftovers" },
    });
    expect(response.insight).toBe(SEED.app.waste.insight8w);
  }

  return response;
}

async function expectFixedRealWasteUiState(
  retrospectivePage: {
    wasteState: (state: SpendCoverageStatus) => Locator;
    wasteKpi: (key: "tossed" | "items" | "rate" | "trend") => Locator;
    wasteWeeks: () => Locator;
    wasteInsight: () => Locator;
  },
  range: WasteRange,
): Promise<void> {
  await expect(retrospectivePage.wasteState("complete")).toContainText("Last-paid estimate");
  await expect(retrospectivePage.wasteKpi("tossed")).toContainText(`$${SEED.app.waste.amounts[range].toFixed(2)}`);
  await expect(retrospectivePage.wasteKpi("tossed")).toContainText("Last-paid estimate");
  await expect(retrospectivePage.wasteKpi("items")).toContainText(String(SEED.app.waste.events[range]));
  await expect(retrospectivePage.wasteKpi("rate")).toContainText(`${SEED.app.waste.rates[range].toFixed(1)}%`);
  await expect(retrospectivePage.wasteKpi("rate")).toHaveClass(/waste-kpi-rate-alert/);
  await expect(retrospectivePage.wasteWeeks()).toHaveCount(Number(range.slice(0, -1)));
}

/** A typed wire fixture for presentation-only states. It contains no aggregate reducer;
 * correctness of every metric is proven by the real seeded case and Worker tests. */
function presentationFixture(status: Exclude<SpendCoverageStatus, "complete">, range: SpendRange = "8w"): SpendAnalyzer {
  const count = Number(range.slice(0, -1));
  const asOf = "2026-07-15";
  const selectedStart = addDays("2026-07-13", -(count - 1) * 7);
  const eventCount = status === "empty" ? 0 : status === "partial" ? 2 : 1;
  const knownAmount = status === "partial" ? 12 : 0;
  const monetary = {
    status,
    event_count: eventCount,
    priced_event_count: status === "partial" ? 1 : 0,
    unpriced_event_count: status === "empty" ? 0 : 1,
    estimated_event_count: status === "partial" ? 1 : 0,
    known_amount: knownAmount,
  };
  const department = {
    status: status === "empty" ? "empty" as const : status === "partial" ? "partial" as const : "complete" as const,
    event_count: eventCount,
    classified_event_count: status === "empty" ? 0 : 1,
    pending_event_count: status === "partial" ? 1 : 0,
  };
  const savings = {
    status,
    event_count: eventCount,
    known_event_count: status === "partial" ? 1 : 0,
    unknown_event_count: status === "empty" ? 0 : 1,
    known_savings: 0,
  };
  const weeks = Array.from({ length: count }, (_, index) => {
    const weekStart = addDays(selectedStart, index * 7);
    const populated = index === count - 1 && status !== "empty";
    const weekMonetary = populated ? monetary : {
      status: "empty" as const,
      event_count: 0,
      priced_event_count: 0,
      unpriced_event_count: 0,
      estimated_event_count: 0,
      known_amount: 0,
    };
    const weekDepartment = populated ? department : {
      status: "empty" as const,
      event_count: 0,
      classified_event_count: 0,
      pending_event_count: 0,
    };
    const weekSavings = populated ? savings : {
      status: "empty" as const,
      event_count: 0,
      known_event_count: 0,
      unknown_event_count: 0,
      known_savings: 0,
    };
    return {
      week_start: weekStart,
      week_end: addDays(weekStart, 6),
      through: index === count - 1 ? asOf : addDays(weekStart, 6),
      is_partial: index === count - 1,
      total: populated ? knownAmount : 0,
      savings: 0,
      events: populated ? eventCount : 0,
      estimated: populated && status === "partial" ? 1 : 0,
      status: populated ? status : "empty" as const,
      monetary_coverage: weekMonetary,
      department_coverage: weekDepartment,
      savings_coverage: weekSavings,
      over_budget: null,
    };
  });
  const items = status === "partial" ? [{
    key: "produce",
    label: "Produce",
    amount: 12,
    event_count: 1,
    priced_event_count: 1,
    unpriced_event_count: 0,
    percentage: 100,
  }] : [];
  return {
    range,
    as_of: asOf,
    selected_start: selectedStart,
    selected_end: asOf,
    prior_start: addDays(selectedStart, -count * 7),
    prior_end: addDays(asOf, -count * 7),
    status,
    coverage: { monetary, department, savings },
    weekly_budget: null,
    weeks,
    awaiting_mark_placed: 0,
    kpis: {
      total_spend: { amount: status === "unavailable" ? null : knownAmount, status },
      average_per_week: { amount: status === "unavailable" ? null : knownAmount / count, status },
      cost_per_meal: {
        amount: status === "unavailable" ? null : knownAmount,
        known_numerator: knownAmount,
        meal_count: 1,
        status,
        reason: status === "unavailable" ? "numerator_unavailable" : null,
      },
      trend: {
        percent: null,
        current_known_amount: knownAmount,
        prior_known_amount: 0,
        status: "unavailable",
        reason: status === "partial" ? "current_incomplete" : "prior_zero",
      },
    },
    breakdowns: {
      department: { known_denominator: knownAmount, status, items },
      store: { known_denominator: knownAmount, status, items: items.map((item) => ({ ...item, key: "kroger", label: "Kroger" })) },
      provenance: { known_denominator: knownAmount, status, items: items.map((item) => ({ ...item, key: "planned", label: "Planned" })) },
    },
    top_drivers: {
      cap: 6,
      total_count: status === "partial" ? 1 : 0,
      items: status === "partial" ? [{
        key: "apples", name: "Apples", department: { key: "produce", label: "Produce" },
        amount: 12, event_count: 1, priced_event_count: 1, unpriced_event_count: 0, percentage: 100,
      }] : [],
    },
    insight: status === "empty"
      ? "No recorded spend in this range."
      : status === "unavailable"
        ? "Spend is unavailable because none of the recorded purchases in this range has a usable price."
        : "Known spend is incomplete: 1 purchase had no usable price, 1 purchase used an estimated price, and 1 purchase is awaiting department classification.",
  };
}

/** A wire-valid department-only partial result: every price is known, but one priced
 * driver still awaits classification. This isolates the UI's shared-partial honesty. */
function departmentPendingFixture(): SpendAnalyzer {
  const base = presentationFixture("partial");
  const monetary = {
    status: "complete" as const,
    event_count: 2,
    priced_event_count: 2,
    unpriced_event_count: 0,
    estimated_event_count: 0,
    known_amount: 20,
  };
  const department = {
    status: "partial" as const,
    event_count: 2,
    classified_event_count: 1,
    pending_event_count: 1,
  };
  const savings = {
    status: "complete" as const,
    event_count: 2,
    known_event_count: 2,
    unknown_event_count: 0,
    known_savings: 0,
  };
  const produce = {
    key: "produce", label: "Produce", amount: 12, event_count: 1,
    priced_event_count: 1, unpriced_event_count: 0, percentage: 100,
  };
  const whole = {
    key: "kroger", label: "Kroger", amount: 20, event_count: 2,
    priced_event_count: 2, unpriced_event_count: 0, percentage: 100,
  };
  return {
    ...base,
    status: "partial",
    coverage: { monetary, department, savings },
    weekly_budget: 100,
    weeks: base.weeks.map((week, index) => index === base.weeks.length - 1 ? {
      ...week,
      total: 20,
      savings: 0,
      events: 2,
      estimated: 0,
      status: "partial",
      monetary_coverage: monetary,
      department_coverage: department,
      savings_coverage: savings,
      over_budget: false,
    } : week),
    kpis: {
      total_spend: { amount: 20, status: "complete" },
      average_per_week: { amount: 2.5, status: "complete" },
      cost_per_meal: { amount: 12, known_numerator: 12, meal_count: 1, status: "partial", reason: null },
      trend: {
        percent: 25,
        current_known_amount: 20,
        prior_known_amount: 16,
        status: "available",
        reason: null,
      },
    },
    breakdowns: {
      department: { known_denominator: 12, status: "partial", items: [produce] },
      store: { known_denominator: 20, status: "complete", items: [whole] },
      provenance: {
        known_denominator: 20,
        status: "complete",
        items: [{ ...whole, key: "planned", label: "Planned" }],
      },
    },
    top_drivers: {
      cap: 6,
      total_count: 2,
      items: [
        {
          key: "apples", name: "Apples", department: { key: "produce", label: "Produce" },
          amount: 12, event_count: 1, priced_event_count: 1, unpriced_event_count: 0, percentage: 60,
        },
        {
          key: "cereal", name: "Cereal", department: null,
          amount: 8, event_count: 1, priced_event_count: 1, unpriced_event_count: 0, percentage: 40,
        },
      ],
    },
    insight: "Known spend is incomplete: 1 purchase is awaiting department classification.",
  };
}

// Presentation-only Waste payloads. They are fixed production-wire objects, not an
// analyzer or expected-value oracle; the populated correctness proof above reads the
// real seeded endpoint. Interception only holds states that one stable seed cannot show.
const EMPTY_WASTE_MONETARY: WasteAnalyzer["coverage"]["monetary"] = {
  status: "empty", event_count: 0, priced_event_count: 0,
  unpriced_event_count: 0, estimated_event_count: 0, known_amount: 0,
};
const EMPTY_WASTE_DEPARTMENT: WasteAnalyzer["coverage"]["department"] = {
  status: "empty", event_count: 0, classified_event_count: 0, pending_event_count: 0,
};
const EMPTY_WASTE_BREAKDOWN: WasteAnalyzer["breakdowns"]["department"] = {
  count_denominator: 0,
  known_amount_denominator: 0,
  classification_coverage: EMPTY_WASTE_DEPARTMENT,
  monetary_coverage: EMPTY_WASTE_MONETARY,
  items: [],
};

function emptyWasteWeek(
  weekStart: string,
  weekEnd: string,
  through = weekEnd,
  isPartial = false,
): WasteWeek {
  return {
    week_start: weekStart,
    week_end: weekEnd,
    through,
    is_partial: isPartial,
    events: 0,
    amount: 0,
    status: "empty",
    monetary_coverage: EMPTY_WASTE_MONETARY,
    department_coverage: EMPTY_WASTE_DEPARTMENT,
  };
}

const EMPTY_WASTE_WEEKS: WasteWeek[] = [
  emptyWasteWeek("2026-05-25", "2026-05-31"),
  emptyWasteWeek("2026-06-01", "2026-06-07"),
  emptyWasteWeek("2026-06-08", "2026-06-14"),
  emptyWasteWeek("2026-06-15", "2026-06-21"),
  emptyWasteWeek("2026-06-22", "2026-06-28"),
  emptyWasteWeek("2026-06-29", "2026-07-05"),
  emptyWasteWeek("2026-07-06", "2026-07-12"),
  emptyWasteWeek("2026-07-13", "2026-07-19", "2026-07-15", true),
];

const EMPTY_WASTE: WasteAnalyzer = {
  range: "8w",
  as_of: "2026-07-15",
  selected_start: "2026-05-25",
  selected_end: "2026-07-15",
  prior_start: "2026-03-30",
  prior_end: "2026-05-20",
  status: "empty",
  avoidability_mapping: {
    version: "waste-avoidability-v1",
    current_version: "waste-avoidability-v1",
    is_current: true,
  },
  coverage: { monetary: EMPTY_WASTE_MONETARY, department: EMPTY_WASTE_DEPARTMENT },
  weeks: EMPTY_WASTE_WEEKS,
  kpis: {
    tossed_value: { amount: 0, status: "empty" },
    items_binned: { count: 0, per_week: 0 },
    waste_rate: {
      percent: null,
      known_waste_amount: 0,
      qualifying_spend_amount: 0,
      status: "unavailable",
      reason: "zero_denominator",
      spend_coverage: {
        status: "empty", spend_event_count: 0, qualifying_event_count: 0,
        excluded_household_event_count: 0, pending_department_event_count: 0,
        priced_event_count: 0, unpriced_event_count: 0, estimated_event_count: 0,
        known_amount: 0,
      },
    },
    trend: {
      percent: null, current_known_amount: 0, prior_known_amount: 0,
      status: "unavailable", reason: "prior_zero",
    },
  },
  breakdowns: {
    department: EMPTY_WASTE_BREAKDOWN,
    reason: EMPTY_WASTE_BREAKDOWN,
    avoidability: EMPTY_WASTE_BREAKDOWN,
  },
  most_wasted: { cap: 6, total_count: 0, items: [] },
  insight: "No recorded waste in this range.",
};

const PARTIAL_WASTE_MONETARY: WasteAnalyzer["coverage"]["monetary"] = {
  status: "partial", event_count: 3, priced_event_count: 2,
  unpriced_event_count: 1, estimated_event_count: 1, known_amount: 12,
};
const PARTIAL_WASTE_DEPARTMENT: WasteAnalyzer["coverage"]["department"] = {
  status: "partial", event_count: 3, classified_event_count: 2, pending_event_count: 1,
};
const PARTIAL_WASTE: WasteAnalyzer = {
  ...EMPTY_WASTE,
  status: "partial",
  coverage: { monetary: PARTIAL_WASTE_MONETARY, department: PARTIAL_WASTE_DEPARTMENT },
  weeks: [
    ...EMPTY_WASTE_WEEKS.slice(0, -1),
    {
      week_start: "2026-07-13", week_end: "2026-07-19", through: "2026-07-15", is_partial: true,
      events: 3, amount: 12, status: "partial",
      monetary_coverage: PARTIAL_WASTE_MONETARY,
      department_coverage: PARTIAL_WASTE_DEPARTMENT,
    },
  ],
  kpis: {
    tossed_value: { amount: 12, status: "partial" },
    items_binned: { count: 3, per_week: 0.4 },
    waste_rate: {
      percent: null, known_waste_amount: 12, qualifying_spend_amount: 88,
      status: "unavailable", reason: "waste_incomplete",
      spend_coverage: {
        status: "complete", spend_event_count: 4, qualifying_event_count: 4,
        excluded_household_event_count: 0, pending_department_event_count: 0,
        priced_event_count: 4, unpriced_event_count: 0, estimated_event_count: 0,
        known_amount: 88,
      },
    },
    trend: {
      percent: null, current_known_amount: 12, prior_known_amount: 10,
      status: "unavailable", reason: "current_incomplete",
    },
  },
  breakdowns: {
    department: {
      count_denominator: 2,
      known_amount_denominator: 12,
      classification_coverage: PARTIAL_WASTE_DEPARTMENT,
      monetary_coverage: {
        status: "partial", event_count: 2, priced_event_count: 2,
        unpriced_event_count: 0, estimated_event_count: 1, known_amount: 12,
      },
      items: [
        { key: "produce", label: "Produce", event_count: 1, valued_event_count: 1, unvalued_event_count: 0, estimated_event_count: 0, amount: 8, count_percentage: 50, amount_percentage: 66.7 },
        { key: "dairy", label: "Dairy", event_count: 1, valued_event_count: 1, unvalued_event_count: 0, estimated_event_count: 1, amount: 4, count_percentage: 50, amount_percentage: 33.3 },
      ],
    },
    reason: {
      count_denominator: 3,
      known_amount_denominator: 12,
      classification_coverage: { status: "complete", event_count: 3, classified_event_count: 3, pending_event_count: 0 },
      monetary_coverage: PARTIAL_WASTE_MONETARY,
      items: [
        { key: "spoiled", label: "Spoiled", event_count: 1, valued_event_count: 1, unvalued_event_count: 0, estimated_event_count: 0, amount: 8, count_percentage: 33.3, amount_percentage: 66.7 },
        { key: "expired", label: "Expired", event_count: 1, valued_event_count: 1, unvalued_event_count: 0, estimated_event_count: 1, amount: 4, count_percentage: 33.3, amount_percentage: 33.3 },
        { key: "forgot", label: "Forgot", event_count: 1, valued_event_count: 0, unvalued_event_count: 1, estimated_event_count: 0, amount: null, count_percentage: 33.3, amount_percentage: 0 },
      ],
    },
    avoidability: {
      count_denominator: 3,
      known_amount_denominator: 12,
      classification_coverage: { status: "complete", event_count: 3, classified_event_count: 3, pending_event_count: 0 },
      monetary_coverage: PARTIAL_WASTE_MONETARY,
      items: [
        { key: "hard_to_avoid", label: "Hard to avoid", event_count: 2, valued_event_count: 2, unvalued_event_count: 0, estimated_event_count: 1, amount: 12, count_percentage: 66.7, amount_percentage: 100 },
        { key: "avoidable", label: "Avoidable", event_count: 1, valued_event_count: 0, unvalued_event_count: 1, estimated_event_count: 0, amount: null, count_percentage: 33.3, amount_percentage: 0 },
      ],
    },
  },
  most_wasted: {
    cap: 6,
    total_count: 3,
    items: [
      { key: "apples", name: "Apples", department: { key: "produce", label: "Produce" }, event_count: 1, valued_event_count: 1, unvalued_event_count: 0, estimated_event_count: 0, amount: 8, amount_percentage: 66.7, status: "complete" },
      { key: "yogurt", name: "Yogurt", department: { key: "dairy", label: "Dairy" }, event_count: 1, valued_event_count: 1, unvalued_event_count: 0, estimated_event_count: 1, amount: 4, amount_percentage: 33.3, status: "partial" },
      { key: "herbs", name: "Mystery herbs", department: null, event_count: 1, valued_event_count: 0, unvalued_event_count: 1, estimated_event_count: 0, amount: null, amount_percentage: 0, status: "unavailable" },
    ],
  },
  insight: "Known waste value is incomplete: 1 tossed item had no matching last-paid price and 1 tossed item used an estimated last-paid price.",
};

const UNAVAILABLE_WASTE_MONETARY: WasteAnalyzer["coverage"]["monetary"] = {
  status: "unavailable", event_count: 2, priced_event_count: 0,
  unpriced_event_count: 2, estimated_event_count: 0, known_amount: 0,
};
const UNAVAILABLE_WASTE_DEPARTMENT: WasteAnalyzer["coverage"]["department"] = {
  status: "complete", event_count: 2, classified_event_count: 2, pending_event_count: 0,
};
const UNAVAILABLE_WASTE: WasteAnalyzer = {
  ...EMPTY_WASTE,
  status: "unavailable",
  coverage: { monetary: UNAVAILABLE_WASTE_MONETARY, department: UNAVAILABLE_WASTE_DEPARTMENT },
  weeks: [
    ...EMPTY_WASTE_WEEKS.slice(0, -1),
    {
      week_start: "2026-07-13", week_end: "2026-07-19", through: "2026-07-15", is_partial: true,
      events: 2, amount: null, status: "unavailable",
      monetary_coverage: UNAVAILABLE_WASTE_MONETARY,
      department_coverage: UNAVAILABLE_WASTE_DEPARTMENT,
    },
  ],
  kpis: {
    tossed_value: { amount: null, status: "unavailable" },
    items_binned: { count: 2, per_week: 0.3 },
    waste_rate: {
      percent: null, known_waste_amount: 0, qualifying_spend_amount: 0,
      status: "unavailable", reason: "waste_incomplete",
      spend_coverage: {
        status: "unavailable", spend_event_count: 2, qualifying_event_count: 2,
        excluded_household_event_count: 0, pending_department_event_count: 0,
        priced_event_count: 0, unpriced_event_count: 2, estimated_event_count: 0,
        known_amount: 0,
      },
    },
    trend: {
      percent: null, current_known_amount: 0, prior_known_amount: 12,
      status: "unavailable", reason: "current_incomplete",
    },
  },
  breakdowns: {
    department: {
      count_denominator: 2, known_amount_denominator: 0,
      classification_coverage: UNAVAILABLE_WASTE_DEPARTMENT,
      monetary_coverage: UNAVAILABLE_WASTE_MONETARY,
      items: [
        { key: "produce", label: "Produce", event_count: 1, valued_event_count: 0, unvalued_event_count: 1, estimated_event_count: 0, amount: null, count_percentage: 50, amount_percentage: null },
        { key: "dairy", label: "Dairy", event_count: 1, valued_event_count: 0, unvalued_event_count: 1, estimated_event_count: 0, amount: null, count_percentage: 50, amount_percentage: null },
      ],
    },
    reason: {
      count_denominator: 2, known_amount_denominator: 0,
      classification_coverage: UNAVAILABLE_WASTE_DEPARTMENT,
      monetary_coverage: UNAVAILABLE_WASTE_MONETARY,
      items: [
        { key: "forgot", label: "Forgot", event_count: 1, valued_event_count: 0, unvalued_event_count: 1, estimated_event_count: 0, amount: null, count_percentage: 50, amount_percentage: null },
        { key: "spoiled", label: "Spoiled", event_count: 1, valued_event_count: 0, unvalued_event_count: 1, estimated_event_count: 0, amount: null, count_percentage: 50, amount_percentage: null },
      ],
    },
    avoidability: {
      count_denominator: 2, known_amount_denominator: 0,
      classification_coverage: UNAVAILABLE_WASTE_DEPARTMENT,
      monetary_coverage: UNAVAILABLE_WASTE_MONETARY,
      items: [
        { key: "avoidable", label: "Avoidable", event_count: 1, valued_event_count: 0, unvalued_event_count: 1, estimated_event_count: 0, amount: null, count_percentage: 50, amount_percentage: null },
        { key: "hard_to_avoid", label: "Hard to avoid", event_count: 1, valued_event_count: 0, unvalued_event_count: 1, estimated_event_count: 0, amount: null, count_percentage: 50, amount_percentage: null },
      ],
    },
  },
  most_wasted: {
    cap: 6,
    total_count: 2,
    items: [
      { key: "apples", name: "Apples", department: { key: "produce", label: "Produce" }, event_count: 1, valued_event_count: 0, unvalued_event_count: 1, estimated_event_count: 0, amount: null, amount_percentage: null, status: "unavailable" },
      { key: "milk", name: "Milk", department: { key: "dairy", label: "Dairy" }, event_count: 1, valued_event_count: 0, unvalued_event_count: 1, estimated_event_count: 0, amount: null, amount_percentage: null, status: "unavailable" },
    ],
  },
  insight: "Waste value is unavailable because none of the recorded tosses in this range has a matching last-paid price.",
};

const COMPLETE_WASTE_MONETARY: WasteAnalyzer["coverage"]["monetary"] = {
  status: "complete", event_count: 2, priced_event_count: 2,
  unpriced_event_count: 0, estimated_event_count: 0, known_amount: 20,
};
const PENDING_WASTE_DEPARTMENT: WasteAnalyzer["coverage"]["department"] = {
  status: "partial", event_count: 2, classified_event_count: 1, pending_event_count: 1,
};
const PENDING_DEPARTMENT_WASTE: WasteAnalyzer = {
  ...EMPTY_WASTE,
  status: "complete",
  coverage: { monetary: COMPLETE_WASTE_MONETARY, department: PENDING_WASTE_DEPARTMENT },
  weeks: [
    ...EMPTY_WASTE_WEEKS.slice(0, -1),
    {
      week_start: "2026-07-13", week_end: "2026-07-19", through: "2026-07-15", is_partial: true,
      events: 2, amount: 20, status: "complete",
      monetary_coverage: COMPLETE_WASTE_MONETARY,
      department_coverage: PENDING_WASTE_DEPARTMENT,
    },
  ],
  kpis: {
    tossed_value: { amount: 20, status: "complete" },
    items_binned: { count: 2, per_week: 0.3 },
    waste_rate: {
      percent: null, known_waste_amount: 20, qualifying_spend_amount: 80,
      status: "unavailable", reason: "spend_incomplete",
      spend_coverage: {
        status: "partial", spend_event_count: 4, qualifying_event_count: 3,
        excluded_household_event_count: 0, pending_department_event_count: 1,
        priced_event_count: 3, unpriced_event_count: 0, estimated_event_count: 0,
        known_amount: 80,
      },
    },
    trend: {
      percent: 25, current_known_amount: 20, prior_known_amount: 16,
      status: "available", reason: null,
    },
  },
  breakdowns: {
    department: {
      count_denominator: 1, known_amount_denominator: 12,
      classification_coverage: PENDING_WASTE_DEPARTMENT,
      monetary_coverage: {
        status: "complete", event_count: 1, priced_event_count: 1,
        unpriced_event_count: 0, estimated_event_count: 0, known_amount: 12,
      },
      items: [
        { key: "produce", label: "Produce", event_count: 1, valued_event_count: 1, unvalued_event_count: 0, estimated_event_count: 0, amount: 12, count_percentage: 100, amount_percentage: 100 },
      ],
    },
    reason: {
      count_denominator: 2, known_amount_denominator: 20,
      classification_coverage: { status: "complete", event_count: 2, classified_event_count: 2, pending_event_count: 0 },
      monetary_coverage: COMPLETE_WASTE_MONETARY,
      items: [
        { key: "spoiled", label: "Spoiled", event_count: 1, valued_event_count: 1, unvalued_event_count: 0, estimated_event_count: 0, amount: 12, count_percentage: 50, amount_percentage: 60 },
        { key: "forgot", label: "Forgot", event_count: 1, valued_event_count: 1, unvalued_event_count: 0, estimated_event_count: 0, amount: 8, count_percentage: 50, amount_percentage: 40 },
      ],
    },
    avoidability: {
      count_denominator: 2, known_amount_denominator: 20,
      classification_coverage: { status: "complete", event_count: 2, classified_event_count: 2, pending_event_count: 0 },
      monetary_coverage: COMPLETE_WASTE_MONETARY,
      items: [
        { key: "hard_to_avoid", label: "Hard to avoid", event_count: 1, valued_event_count: 1, unvalued_event_count: 0, estimated_event_count: 0, amount: 12, count_percentage: 50, amount_percentage: 60 },
        { key: "avoidable", label: "Avoidable", event_count: 1, valued_event_count: 1, unvalued_event_count: 0, estimated_event_count: 0, amount: 8, count_percentage: 50, amount_percentage: 40 },
      ],
    },
  },
  most_wasted: {
    cap: 6,
    total_count: 2,
    items: [
      { key: "apples", name: "Apples", department: { key: "produce", label: "Produce" }, event_count: 1, valued_event_count: 1, unvalued_event_count: 0, estimated_event_count: 0, amount: 12, amount_percentage: 60, status: "complete" },
      { key: "cereal", name: "Cereal", department: null, event_count: 1, valued_event_count: 1, unvalued_event_count: 0, estimated_event_count: 0, amount: 8, amount_percentage: 40, status: "complete" },
    ],
  },
  insight: "Spoiled was the leading waste reason by known value with 1 tossed item; avoidable waste represented 40.0% of known waste value.",
};

const PRIOR_INCOMPLETE_WASTE: WasteAnalyzer = {
  ...PENDING_DEPARTMENT_WASTE,
  kpis: {
    ...PENDING_DEPARTMENT_WASTE.kpis,
    trend: {
      percent: null,
      current_known_amount: 20,
      prior_known_amount: 8,
      status: "unavailable",
      reason: "prior_incomplete",
    },
  },
};

test.beforeEach(async ({ asMember, retrospectivePage }) => {
  await asMember();
  await retrospectivePage.goto();
  await retrospectivePage.landmark();
});

test("logging a cook via the composer prepends a row; removing it heals the list", async ({ retrospectivePage }) => {
  await retrospectivePage.rows().first().waitFor(); // the seeded history has rendered
  const before = await retrospectivePage.rows().count();
  await retrospectivePage.logCook(SEED.recipe.title);
  await expect(retrospectivePage.rows()).toHaveCount(before + 1);
  await retrospectivePage.captureForReview("retro-log-after-cook");
  await retrospectivePage.removeFirst();
  await expect(retrospectivePage.rows()).toHaveCount(before);
});

test("the shell defaults to Cooking log and switches tabs via the URL", async ({ page, retrospectivePage }) => {
  await expect(retrospectivePage.tab("log")).toHaveAttribute("aria-selected", "true");
  await expect(retrospectivePage.tab("log")).toHaveAttribute("tabindex", "0");
  await expect(retrospectivePage.tab("log")).toHaveAttribute("aria-controls", "retro-panel-log");
  await expect(retrospectivePage.panel("log")).toHaveAttribute("aria-labelledby", "retro-tab-log");
  await expect(page.getByTestId("log-page")).toBeVisible();

  await retrospectivePage.selectTab("spend");
  await expect(page).toHaveURL(/tab=spend.*range=8w|range=8w.*tab=spend/);
  await expect(page.getByTestId("spend-page")).toBeVisible();
  await expect(retrospectivePage.tab("spend")).toHaveAttribute("aria-selected", "true");
  await expect(retrospectivePage.tab("log")).toHaveAttribute("tabindex", "-1");

  await retrospectivePage.selectTab("waste");
  await expect(page).toHaveURL(/tab=waste/);
  await expect(retrospectivePage.wastePanel()).toBeVisible();
  await expect(retrospectivePage.wasteHeading()).toBeVisible();
});

test("the real seeded Spend analyzer canonicalizes 8w, changes ranges, and remains readable responsively", async ({ context, page, retrospectivePage }) => {
  await switchToSpendFixture(context, page);
  await retrospectivePage.selectTab("spend");
  await expect(page).toHaveURL(/range=8w/);
  await expect(retrospectivePage.spendRange("8w")).toHaveAttribute("aria-pressed", "true");
  await expect(retrospectivePage.analyzerRangeGroup().locator('[aria-pressed="true"]')).toHaveCount(1);
  await readFixedRealSpend(page, "8w");
  await expectFixedRealSpendUiState(retrospectivePage, "8w");
  await expect(retrospectivePage.spendWeeks()).toHaveCount(8);
  await expect(retrospectivePage.spendKpi("total")).toContainText(`$${SEED.app.spend.totals["8w"].toFixed(2)}`);
  await expect(retrospectivePage.spendKpi("average")).toContainText("selected buckets");
  await expect(retrospectivePage.spendKpi("meal")).toContainText("1 qualifying cook");
  await expect(page.getByTestId("spend-budget")).toContainText(`$${SEED.app.spend.budget.toFixed(2)}`);
  await expect(page.getByTestId("spend-drivers")).toContainText(SEED.app.spend.topDriver.name);

  await retrospectivePage.selectSpendRange("4w");
  await expect(page).toHaveURL(/range=4w/);
  await expect(retrospectivePage.spendWeeks()).toHaveCount(4);
  await readFixedRealSpend(page, "4w");
  await expectFixedRealSpendUiState(retrospectivePage, "4w");
  await expect(retrospectivePage.spendKpi("total")).toContainText(`$${SEED.app.spend.totals["4w"].toFixed(2)}`);

  await retrospectivePage.selectSpendRange("12w");
  await expect(page).toHaveURL(/range=12w/);
  await expect(retrospectivePage.spendWeeks()).toHaveCount(12);
  await readFixedRealSpend(page, "12w");
  await expectFixedRealSpendUiState(retrospectivePage, "12w");
  await expect(retrospectivePage.spendKpi("total")).toContainText(`$${SEED.app.spend.totals["12w"].toFixed(2)}`);

  await retrospectivePage.selectSpendRange("8w");
  await expect(retrospectivePage.spendWeeks()).toHaveCount(8);
  const chart = page.getByRole("region", { name: "Weekly spend chart" });
  await retrospectivePage.captureSpendDesktop();
  expect(await overflowsHorizontally(chart)).toBe(false);
  await retrospectivePage.captureSpendTall();
  expect(await overflowsHorizontally(chart)).toBe(true);
  await retrospectivePage.captureSpendNarrow();
  expect(await overflowsHorizontally(chart)).toBe(true);
  await expect(retrospectivePage.tab("waste")).toBeInViewport({ ratio: 1 });
  await expect(retrospectivePage.spendWeeks().first()).toContainText(/\$|Price unavailable/);
});

test("the signed-in real Waste analyzer presents returned facts, shared ranges, semantics, and responsive captures", async ({ context, page, retrospectivePage }) => {
  await switchToWasteFixture(context, page);
  await retrospectivePage.selectTab("waste");
  await expect(page).toHaveURL(/tab=waste.*range=8w|range=8w.*tab=waste/);
  await expect(retrospectivePage.wasteRange("8w")).toHaveAttribute("aria-pressed", "true");
  await expect(retrospectivePage.analyzerRangeGroup().locator('[aria-pressed="true"]')).toHaveCount(1);

  await readFixedRealWaste(page, "8w");
  await expectFixedRealWasteUiState(retrospectivePage, "8w");
  await expect(retrospectivePage.wasteKpi("items")).toContainText("0.8 items per selected week");
  await expect(retrospectivePage.wasteKpi("rate")).toContainText("Waste last-paid estimate $190.00");
  await expect(retrospectivePage.wasteKpi("rate")).toContainText("Recorded grocery spend $222.00");
  await expect(retrospectivePage.wasteKpi("trend")).toContainText("533.3% higher");
  await expect(retrospectivePage.wasteKpi("trend")).toContainText("Prior last-paid estimate $30.00");
  await expect(retrospectivePage.wasteBreakdown("department")).toContainText("Count denominator: 6 tosses");
  await expect(retrospectivePage.wasteBreakdown("department")).toContainText("Meat");
  await expect(retrospectivePage.wasteBreakdown("department")).toContainText("Leftovers");
  await expect(retrospectivePage.wasteBreakdown("reason")).toContainText("Bought Too Much");
  await expect(retrospectivePage.wasteBreakdown("avoidability")).toContainText("Avoidable");
  await expect(retrospectivePage.wasteBreakdown("avoidability")).toContainText("73.7%");
  await expect(retrospectivePage.wasteItems()).toContainText(SEED.app.waste.topItem.name);
  await expect(retrospectivePage.wasteItems()).toContainText(SEED.app.waste.leftover.name);
  await expect(retrospectivePage.wasteItems()).toContainText("Leftovers · tossed 1×");
  await expect(retrospectivePage.wasteInsight().locator("p")).toHaveText(SEED.app.waste.insight8w);
  await expect(retrospectivePage.wasteWeeks().first()).toContainText(/toss|tosses/);
  await expect(retrospectivePage.wasteWeeksRegion()).toHaveAttribute("tabindex", "0");
  await expect(retrospectivePage.wasteBarGeometry().first()).toHaveAttribute("aria-hidden", "true");

  await retrospectivePage.wasteRange("4w").focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/range=4w/);
  await readFixedRealWaste(page, "4w");
  await expectFixedRealWasteUiState(retrospectivePage, "4w");

  await retrospectivePage.selectWasteRange("12w");
  await expect(page).toHaveURL(/range=12w/);
  await readFixedRealWaste(page, "12w");
  await expectFixedRealWasteUiState(retrospectivePage, "12w");
  await expect(retrospectivePage.wasteKpi("trend")).toContainText("Reason: prior_zero");

  await retrospectivePage.selectTab("spend");
  await expect(retrospectivePage.spendRange("12w")).toHaveAttribute("aria-pressed", "true");
  await expectFixedRealSpendUiState(retrospectivePage, "12w");
  await retrospectivePage.tab("spend").focus();
  await retrospectivePage.pressTabKey("ArrowRight");
  await expect(retrospectivePage.tab("waste")).toBeFocused();
  await expect(retrospectivePage.wasteRange("12w")).toHaveAttribute("aria-pressed", "true");

  await retrospectivePage.selectWasteRange("8w");
  await expectFixedRealWasteUiState(retrospectivePage, "8w");
  await retrospectivePage.captureWasteDesktop();
  expect(await overflowsHorizontally(retrospectivePage.wasteWeeksRegion())).toBe(false);
  await retrospectivePage.captureWasteTall();
  expect(await overflowsHorizontally(retrospectivePage.wasteWeeksRegion())).toBe(true);
  await retrospectivePage.captureWasteNarrow();
  expect(await overflowsHorizontally(retrospectivePage.wasteWeeksRegion())).toBe(true);
  await expect(retrospectivePage.tab("waste")).toBeInViewport({ ratio: 1 });
  await expect(retrospectivePage.wasteWeeks().last()).toContainText(/Last-paid estimate|No recorded tosses/);
  await retrospectivePage.wasteWeeksRegion().scrollIntoViewIfNeeded();
  await retrospectivePage.wasteWeeksRegion().evaluate((node) => {
    const element = node as unknown as { scrollLeft: number; scrollWidth: number };
    element.scrollLeft = element.scrollWidth;
  });
  await expect(retrospectivePage.wasteWeeks().last()).toBeInViewport({ ratio: 0.5 });
  await retrospectivePage.wasteItems().scrollIntoViewIfNeeded();
  await expect(retrospectivePage.wasteItems()).toBeInViewport({ ratio: 0.5 });
  await retrospectivePage.wasteInsight().scrollIntoViewIfNeeded();
  await expect(retrospectivePage.wasteInsight()).toBeInViewport({ ratio: 0.5 });
});

test("Waste canonicalization and active-only requests retain the shared range", async ({ context, page, retrospectivePage }) => {
  await switchToWasteFixture(context, page);
  const wasteRanges: string[] = [];
  page.on("request", (request) => {
    if (!request.url().includes("/api/retrospective/waste?")) return;
    wasteRanges.push(request.url().match(/[?&]range=([^&]+)/)?.[1] ?? "missing");
  });

  await page.goto("/retrospective?tab=waste&range=invalid");
  await expect(page).toHaveURL(/tab=waste.*range=8w|range=8w.*tab=waste/);
  await expectFixedRealWasteUiState(retrospectivePage, "8w");
  expect(wasteRanges).toEqual(["8w"]);

  await retrospectivePage.selectTab("log");
  await expect(retrospectivePage.panel("log")).toBeVisible();
  expect(wasteRanges).toEqual(["8w"]);

  await retrospectivePage.selectTab("spend");
  await retrospectivePage.selectSpendRange("4w");
  await expectFixedRealSpendUiState(retrospectivePage, "4w");
  expect(wasteRanges).toEqual(["8w"]);

  const activation = page.waitForRequest((request) => request.url().includes("/api/retrospective/waste?range=4w"));
  await retrospectivePage.selectTab("waste");
  await activation;
  await expectFixedRealWasteUiState(retrospectivePage, "4w");
  expect(wasteRanges).toEqual(["8w", "4w"]);
});

async function overflowsHorizontally(locator: Locator): Promise<boolean> {
  return locator.evaluate((node) => {
    const element = node as unknown as { scrollWidth: number; clientWidth: number };
    return element.scrollWidth > element.clientWidth;
  });
}

test("Spend range validation, inactive queries, and tab keyboard behavior stay URL-driven", async ({ context, page, retrospectivePage }) => {
  await switchToSpendFixture(context, page);
  await page.goto("/retrospective?tab=spend&range=invalid");
  await expect(page).toHaveURL(/tab=spend.*range=8w|range=8w.*tab=spend/);
  await expect(retrospectivePage.spendRange("8w")).toHaveAttribute("aria-pressed", "true");

  await retrospectivePage.tab("spend").focus();
  await retrospectivePage.pressTabKey("ArrowRight");
  await expect(retrospectivePage.tab("waste")).toBeFocused();
  await expect(retrospectivePage.tab("waste")).toHaveAttribute("aria-selected", "true");
  await retrospectivePage.pressTabKey("Home");
  await expect(retrospectivePage.tab("log")).toBeFocused();
  await retrospectivePage.pressTabKey("End");
  await expect(retrospectivePage.tab("waste")).toBeFocused();
  await retrospectivePage.pressTabKey("ArrowRight");
  await expect(retrospectivePage.tab("log")).toBeFocused();
  await retrospectivePage.pressTabKey("ArrowLeft");
  await expect(retrospectivePage.tab("waste")).toBeFocused();

  await readFixedRealSpend(page, "4w");

  let spendCalls = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/retrospective/spend")) spendCalls++;
  });
  await page.goto("/retrospective?tab=waste&range=4w");
  await retrospectivePage.landmark();
  await expect(page).toHaveURL(/tab=waste.*range=4w|range=4w.*tab=waste/);
  expect(spendCalls).toBe(0);
  const activationRequest = page.waitForRequest((request) => request.url().includes("/api/retrospective/spend?range=4w"));
  await retrospectivePage.selectTab("spend");
  await activationRequest;
  await expectFixedRealSpendUiState(retrospectivePage, "4w");
  expect(spendCalls).toBe(1);
  await retrospectivePage.selectTab("log");
  const reactivationRequest = page.waitForRequest((request) => request.url().includes("/api/retrospective/spend?range=4w"));
  await retrospectivePage.selectTab("spend");
  await reactivationRequest;
  await expect(retrospectivePage.spendRange("4w")).toHaveAttribute("aria-pressed", "true");
  expect(spendCalls).toBe(2);
});

test("Spend loading and exact structured error retry are operable", async ({ page, retrospectivePage }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/retrospective/spend?*", async (route) => {
    await held;
    await route.fulfill({ json: presentationFixture("empty") });
  });
  await page.goto("/retrospective?tab=spend&range=8w");
  await expect(retrospectivePage.spendLoading()).toHaveRole("status");
  release();
  await expect(retrospectivePage.spendState("empty")).toBeVisible();
  await page.unroute("**/api/retrospective/spend?*");

  let calls = 0;
  await page.route("**/api/retrospective/spend?*", async (route) => {
    calls++;
    if (calls === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "storage_error", message: "Seeded Spend read failed." }),
      });
    } else {
      await route.fulfill({ json: presentationFixture("empty") });
    }
  });
  await page.goto("/retrospective?tab=spend&range=8w");
  await expect(retrospectivePage.spendError()).toContainText("Seeded Spend read failed.");
  await retrospectivePage.retrySpend();
  await expect(retrospectivePage.spendState("empty")).toBeVisible();
  expect(calls).toBe(2);
});

test("typed presentation fixtures distinguish partial, unavailable, and empty", async ({ page, retrospectivePage }) => {
  for (const status of ["partial", "unavailable", "empty"] as const) {
    await page.unroute("**/api/retrospective/spend?*");
    await page.route("**/api/retrospective/spend?*", (route) => route.fulfill({ json: presentationFixture(status) }));
    await page.goto("/retrospective?tab=spend&range=8w");
    await expect(retrospectivePage.spendState(status)).toBeVisible();
    if (status === "partial") {
      await expect(retrospectivePage.spendState("partial")).toContainText("1 purchase has no usable price");
      await expect(retrospectivePage.spendKpi("total")).toContainText("Known $12.00");
    } else if (status === "unavailable") {
      await expect(retrospectivePage.spendState("unavailable")).toContainText("no usable price");
      await expect(retrospectivePage.spendKpi("total")).toHaveCount(0);
    } else {
      await expect(retrospectivePage.spendState("empty")).toContainText("No recorded spend");
      await expect(retrospectivePage.spendWeeks()).toHaveCount(0);
    }
  }
});

test("department-only partial spend labels every known amount and scales a higher budget", async ({ page, retrospectivePage }) => {
  const fixture = departmentPendingFixture();
  await page.route("**/api/retrospective/spend?*", (route) => route.fulfill({ json: fixture }));
  await page.goto("/retrospective?tab=spend&range=8w");

  await expect(retrospectivePage.spendState("partial")).toContainText("1 purchase awaits department classification");
  await expect(retrospectivePage.spendKpi("total")).toContainText("Known $20.00");
  await expect(retrospectivePage.spendKpi("average")).toContainText("Known $2.50");
  await expect(retrospectivePage.spendKpi("meal")).toContainText("Known $12.00");
  await expect(retrospectivePage.spendWeeks().last()).toContainText("Known $20.00");
  await expect(page.getByTestId("spend-breakdown-department")).toContainText("Known $12.00");
  await expect(page.getByTestId("spend-breakdown-store")).toContainText("Known $20.00");
  await expect(page.getByTestId("spend-breakdown-provenance")).toContainText("Known $20.00");
  await expect(page.getByTestId("spend-drivers")).toContainText("Department pending");
  await expect(page.getByTestId("spend-drivers").getByText("Known $12.00")).toBeVisible();
  await expect(page.getByTestId("spend-drivers").getByText("Known $8.00")).toBeVisible();

  const populated = retrospectivePage.spendWeeks().last();
  const budgetBottom = await populated.locator(".spend-budget-line").evaluate((node) =>
    (node as unknown as { style: { bottom: string } }).style.bottom);
  const spendHeight = await populated.locator(".spend-bar").evaluate((node) =>
    (node as unknown as { style: { height: string } }).style.height);
  expect(budgetBottom).toBe("100%");
  expect(spendHeight).toBe("20%");
  expect(spendHeight).not.toBe(budgetBottom);
});

test("budget bars preserve within-budget truth at mixed scales", async ({ page, retrospectivePage }) => {
  const base = presentationFixture("empty");
  const monetary = {
    status: "complete" as const,
    event_count: 2,
    priced_event_count: 2,
    unpriced_event_count: 0,
    estimated_event_count: 0,
    known_amount: 101,
  };
  const department = {
    status: "complete" as const,
    event_count: 2,
    classified_event_count: 2,
    pending_event_count: 0,
  };
  const savings = {
    status: "complete" as const,
    event_count: 2,
    known_event_count: 2,
    unknown_event_count: 0,
    known_savings: 0,
  };
  const produce = {
    key: "produce", label: "Produce", amount: 101, event_count: 2,
    priced_event_count: 2, unpriced_event_count: 0, percentage: 100,
  };
  const fixture: SpendAnalyzer = {
    ...base,
    status: "complete",
    coverage: { monetary, department, savings },
    weekly_budget: 5,
    weeks: base.weeks.map((week, index) => {
      if (index < base.weeks.length - 2) return week;
      const total = index === base.weeks.length - 2 ? 100 : 1;
      return {
        ...week,
        total,
        events: 1,
        estimated: 0,
        status: "complete",
        monetary_coverage: {
          status: "complete",
          event_count: 1,
          priced_event_count: 1,
          unpriced_event_count: 0,
          estimated_event_count: 0,
          known_amount: total,
        },
        department_coverage: {
          status: "complete",
          event_count: 1,
          classified_event_count: 1,
          pending_event_count: 0,
        },
        savings_coverage: {
          status: "complete",
          event_count: 1,
          known_event_count: 1,
          unknown_event_count: 0,
          known_savings: 0,
        },
        over_budget: total > 5,
      };
    }),
    kpis: {
      total_spend: { amount: 101, status: "complete" },
      average_per_week: { amount: 12.63, status: "complete" },
      cost_per_meal: {
        amount: null,
        known_numerator: 101,
        meal_count: 0,
        status: "unavailable",
        reason: "zero_meals",
      },
      trend: {
        percent: null,
        current_known_amount: 101,
        prior_known_amount: 0,
        status: "unavailable",
        reason: "prior_zero",
      },
    },
    breakdowns: {
      department: { known_denominator: 101, status: "complete", items: [produce] },
      store: {
        known_denominator: 101,
        status: "complete",
        items: [{ ...produce, key: "kroger", label: "Kroger" }],
      },
      provenance: {
        known_denominator: 101,
        status: "complete",
        items: [{ ...produce, key: "planned", label: "Planned" }],
      },
    },
    top_drivers: {
      cap: 6,
      total_count: 1,
      items: [{
        key: "produce-purchases",
        name: "Produce purchases",
        department: { key: "produce", label: "Produce" },
        amount: 101,
        event_count: 2,
        priced_event_count: 2,
        unpriced_event_count: 0,
        percentage: 100,
      }],
    },
    insight: "Produce was the largest department at $101.00. Planned purchases were 100.0% of known spend; impulse purchases were 0.0%.",
  };
  await page.route("**/api/retrospective/spend?*", (route) => route.fulfill({ json: fixture }));
  await page.goto("/retrospective?tab=spend&range=8w");

  const maxWeek = retrospectivePage.spendWeeks().nth(fixture.weeks.length - 2);
  await expect(maxWeek).toContainText("$100.00");
  await expect(maxWeek).toContainText("Over budget");

  const underBudgetWeek = retrospectivePage.spendWeeks().last();
  await expect(underBudgetWeek).toContainText("$1.00");
  await expect(underBudgetWeek).toContainText("Within budget");
  const budgetBottom = await underBudgetWeek.locator(".spend-budget-line").evaluate((node) =>
    Number.parseFloat((node as unknown as { style: { bottom: string } }).style.bottom));
  const spendHeight = await underBudgetWeek.locator(".spend-bar").evaluate((node) =>
    Number.parseFloat((node as unknown as { style: { height: string } }).style.height));
  expect(budgetBottom).toBe(5);
  expect(spendHeight).toBe(1);
  expect(spendHeight).toBeLessThan(budgetBottom);
});

test("Waste loading, structured error retry, and exact empty presentation stay distinct", async ({ page, retrospectivePage }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/retrospective/waste?*", async (route) => {
    await held;
    await route.fulfill({ json: EMPTY_WASTE });
  });
  await page.goto("/retrospective?tab=waste&range=8w");
  await expect(retrospectivePage.wasteLoading()).toHaveRole("status");
  await expect(retrospectivePage.wasteLoading()).toHaveText("Loading waste analysis…");
  release();
  await expect(retrospectivePage.wasteState("empty")).toContainText("No recorded waste");
  await expect(retrospectivePage.wasteKpi("items")).toContainText("0");
  await expect(retrospectivePage.wasteKpi("tossed")).toHaveCount(0);
  await expect(retrospectivePage.wasteBreakdown("department")).toHaveCount(0);
  await expect(retrospectivePage.wasteWeeks()).toHaveCount(8);
  await expect(retrospectivePage.wasteInsight()).toContainText("No recorded waste in this range.");
  await page.unroute("**/api/retrospective/waste?*");

  let calls = 0;
  await page.route("**/api/retrospective/waste?*", async (route) => {
    calls++;
    if (calls === 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "storage_error", message: "Seeded Waste read failed." }),
      });
      return;
    }
    await route.fulfill({ json: EMPTY_WASTE });
  });
  await page.goto("/retrospective?tab=waste&range=8w");
  await expect(retrospectivePage.wasteError()).toHaveRole("alert");
  await expect(retrospectivePage.wasteError()).toContainText("Seeded Waste read failed.");
  await retrospectivePage.retryWaste();
  await expect(retrospectivePage.wasteState("empty")).toBeVisible();
  expect(calls).toBe(2);
});

test("typed Waste presentation states preserve unavailable and partial evidence", async ({ page, retrospectivePage }) => {
  await page.route("**/api/retrospective/waste?*", (route) => route.fulfill({ json: UNAVAILABLE_WASTE }));
  await page.goto("/retrospective?tab=waste&range=8w");
  await expect(retrospectivePage.wasteState("unavailable")).toContainText("Last-paid value unavailable");
  await expect(retrospectivePage.wasteKpi("tossed")).toContainText("Unavailable");
  await expect(retrospectivePage.wasteKpi("tossed")).not.toContainText("$0.00");
  await expect(retrospectivePage.wasteKpi("rate")).toContainText("Waste last-paid value unavailable");
  await expect(retrospectivePage.wasteKpi("rate")).toContainText("Recorded grocery spend unavailable");
  await expect(retrospectivePage.wasteKpi("rate")).not.toContainText("$0.00");
  await expect(retrospectivePage.wasteKpi("items")).toContainText("2");
  await expect(retrospectivePage.wasteBreakdown("reason")).toContainText("Forgot");
  await expect(retrospectivePage.wasteBreakdown("reason")).toContainText("1 unmatched");
  await expect(retrospectivePage.wasteItems()).toContainText("Last-paid value unavailable");
  await expect(retrospectivePage.wasteKpi("rate")).not.toHaveClass(/waste-kpi-rate-alert/);
  await page.unroute("**/api/retrospective/waste?*");

  await page.route("**/api/retrospective/waste?*", (route) => route.fulfill({ json: PARTIAL_WASTE }));
  await page.goto("/retrospective?tab=waste&range=8w");
  await expect(retrospectivePage.wasteState("partial")).toContainText("Known last-paid estimate");
  await expect(retrospectivePage.wasteState("partial")).toContainText("1 toss has no matching last-paid price");
  await expect(retrospectivePage.wasteState("partial")).toContainText("1 toss uses an estimated last-paid price");
  await expect(retrospectivePage.wasteKpi("tossed")).toContainText("$12.00");
  await expect(retrospectivePage.wasteKpi("tossed")).toContainText("1 unmatched · 1 estimated");
  await expect(retrospectivePage.wasteWeeks().last()).toContainText("Known last-paid estimate $12.00");
  await expect(retrospectivePage.wasteWeeks().last()).toContainText("1 unmatched · 1 estimated");
  await expect(retrospectivePage.wasteBreakdown("reason")).toContainText("1 valued · 0 unmatched · 1 estimated");
  await expect(retrospectivePage.wasteBreakdown("reason")).toContainText("Last-paid value unavailable");
  await expect(retrospectivePage.wasteItems()).toContainText("Known last-paid estimate $4.00");
  await expect(retrospectivePage.wasteItems()).toContainText("Last-paid value unavailable");
  await expect(retrospectivePage.wasteKpi("rate")).toContainText("Reason: waste_incomplete");
  await expect(retrospectivePage.wasteKpi("rate")).not.toHaveClass(/waste-kpi-rate-alert/);
});

test("pending Waste department stays orthogonal to complete money and prior trend evidence is not invented", async ({ page, retrospectivePage }) => {
  await page.route("**/api/retrospective/waste?*", (route) => route.fulfill({ json: PENDING_DEPARTMENT_WASTE }));
  await page.goto("/retrospective?tab=waste&range=8w");
  await expect(retrospectivePage.wasteState("complete")).toContainText("Last-paid estimate");
  await expect(retrospectivePage.wasteState("partial")).toHaveCount(0);
  await expect(retrospectivePage.wasteDepartmentCoverage()).toContainText("Department classification incomplete");
  await expect(retrospectivePage.wasteDepartmentCoverage()).toContainText("Waste money remains labelled last-paid estimate");
  await expect(retrospectivePage.wasteKpi("tossed")).toContainText("Last-paid estimate");
  await expect(retrospectivePage.wasteKpi("tossed")).not.toContainText("Known last-paid estimate");
  await expect(retrospectivePage.wasteBreakdown("department")).toContainText("1 classified, 1 pending");
  await expect(retrospectivePage.wasteItems()).toContainText("Department pending · tossed 1×");
  await expect(retrospectivePage.wasteKpi("rate")).toContainText("Reason: spend_incomplete");
  await expect(retrospectivePage.wasteKpi("rate")).toContainText("Known recorded grocery spend $80.00");
  await expect(retrospectivePage.wasteKpi("rate")).toContainText("1 department pending");
  await expect(retrospectivePage.wasteKpi("rate")).not.toHaveClass(/waste-kpi-rate-alert/);
  await page.unroute("**/api/retrospective/waste?*");

  await page.route("**/api/retrospective/waste?*", (route) => route.fulfill({ json: PRIOR_INCOMPLETE_WASTE }));
  await page.goto("/retrospective?tab=waste&range=8w");
  await expect(retrospectivePage.wasteKpi("trend")).toContainText("Reason: prior_incomplete");
  await expect(retrospectivePage.wasteKpi("trend")).toContainText("Current last-paid estimate $20.00");
  await expect(retrospectivePage.wasteKpi("trend")).toContainText("Prior last-paid estimate $8.00");
  await expect(retrospectivePage.wasteKpi("trend")).not.toContainText(/prior (unmatched|estimated)/i);
});

test("'Something else' logs a meal-tagged non-recipe row; meal persists", async ({ page, retrospectivePage }) => {
  await retrospectivePage.pickMeal("Lunch");
  await retrospectivePage.logSomethingElse("takeout ramen");

  const row = retrospectivePage.rows().filter({ hasText: "takeout ramen" }).first();
  await expect(row).toBeVisible();
  await expect(retrospectivePage.mealTag(row)).toHaveText("lunch");
  await expect(row).toContainText("made something else");
  // Logged today, so it sits under the "Today" day group.
  await expect(retrospectivePage.dayHeads().filter({ hasText: "Today" })).toBeVisible();
  // Meal persists for rapid multi-logging (only the source input clears).
  await expect(page.locator('.seg[data-seg="meal"] button', { hasText: "Lunch" })).toHaveAttribute("aria-pressed", "true");
});

test("an entry dated yesterday is labeled Yesterday", async ({ retrospectivePage }) => {
  // Compute yesterday in the SAME UTC calendar the app's isoToday() uses.
  const today = new Date().toISOString().slice(0, 10);
  const y = new Date(`${today}T00:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  await retrospectivePage.setDate(y.toISOString().slice(0, 10));
  await retrospectivePage.logSomethingElse("last night curry");
  await expect(retrospectivePage.rows().filter({ hasText: "last night curry" })).toBeVisible();
  await expect(retrospectivePage.dayHeads().filter({ hasText: "Yesterday" })).toBeVisible();
});

test("backdating files the cook under an earlier day group, not Today", async ({ retrospectivePage }) => {
  await retrospectivePage.setDate("2026-01-15");
  await retrospectivePage.logSomethingElse("new year stew");
  await expect(retrospectivePage.rows().filter({ hasText: "new year stew" })).toBeVisible();
  await expect(retrospectivePage.dayHeads().filter({ hasText: "Jan 15" })).toBeVisible();
});

test("/log redirects to the retrospective", async ({ page, retrospectivePage }) => {
  await page.goto("/log");
  await retrospectivePage.landmark();
  await expect(page).toHaveURL(/\/retrospective/);
});
