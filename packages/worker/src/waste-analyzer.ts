// The bounded, read-only Waste retrospective. Values come only from the latest
// eligible household Spend unit price; all aggregation is deterministic plain code.

import type { WasteReason } from "@yamp/contract";
import { db } from "./db.js";
import type { Env } from "./env.js";
import {
  addUtcDays,
  compareRawKeys,
  fromCents,
  presentationLabel,
  roundPercent,
  spendBounds,
  toCents,
  type SpendBounds,
} from "./spend.js";
import type { ClassificationCoverage, CoverageStatus, MonetaryCoverage } from "./spend-shapes.js";
import { resolveWasteAvoidabilityMapping, type WasteAvoidabilityMapping } from "./waste-avoidability.js";
import type {
  Avoidability,
  QualifyingSpendCoverage,
  WasteAnalyzer,
  WasteBreakdown,
  WasteBreakdownItem,
  WasteItemGroup,
  WasteItemStatus,
  WasteRange,
  WasteRateKpi,
  WasteTrendKpi,
  WasteWeek,
} from "./waste-shapes.js";

const WASTE_ITEM_CAP = 6 as const;

interface WasteEventRow {
  id: string;
  item_id: string;
  name: string;
  prepared_from: string | null;
  department: string | null;
  reason: WasteReason;
  occurred_at: string;
  last_paid_unit_price: number | null;
  last_paid_estimated: number | null;
}

interface SpendRateRow {
  amount: number | null;
  estimated: number;
  department: string | null;
}

interface ReducedWasteEvent extends WasteEventRow {
  valueCents: number | null;
  estimated: boolean;
  effectiveDepartment: string | null;
  avoidability: Avoidability;
}

interface MonetarySummary {
  coverage: MonetaryCoverage;
  knownCents: number;
}

function reduceWasteEvents(
  rows: WasteEventRow[],
  mapping: WasteAvoidabilityMapping,
): ReducedWasteEvent[] {
  return rows.map((row) => ({
    ...row,
    valueCents: row.last_paid_unit_price == null ? null : toCents(row.last_paid_unit_price),
    estimated: row.last_paid_unit_price != null && Boolean(row.last_paid_estimated),
    effectiveDepartment: row.prepared_from != null ? "leftovers" : row.department,
    avoidability: mapping[row.reason],
  }));
}

function monetarySummary(rows: ReducedWasteEvent[]): MonetarySummary {
  let priced = 0;
  let estimated = 0;
  let knownCents = 0;
  for (const row of rows) {
    if (row.valueCents == null) continue;
    priced++;
    knownCents += row.valueCents;
    if (row.estimated) estimated++;
  }
  const unpriced = rows.length - priced;
  const status: CoverageStatus = rows.length === 0
    ? "empty"
    : priced === 0
      ? "unavailable"
      : unpriced > 0 || estimated > 0
        ? "partial"
        : "complete";
  return {
    knownCents,
    coverage: {
      status,
      event_count: rows.length,
      priced_event_count: priced,
      unpriced_event_count: unpriced,
      estimated_event_count: estimated,
      known_amount: fromCents(knownCents),
    },
  };
}

function exposedAmount(summary: MonetarySummary): number | null {
  return summary.coverage.status === "unavailable" ? null : summary.coverage.known_amount;
}

function classificationCoverage(eventCount: number, classifiedCount: number): ClassificationCoverage {
  const pending = eventCount - classifiedCount;
  const status: CoverageStatus = eventCount === 0
    ? "empty"
    : classifiedCount === 0
      ? "unavailable"
      : pending > 0
        ? "partial"
        : "complete";
  return {
    status,
    event_count: eventCount,
    classified_event_count: classifiedCount,
    pending_event_count: pending,
  };
}

function departmentCoverage(rows: ReducedWasteEvent[]): ClassificationCoverage {
  return classificationCoverage(
    rows.length,
    rows.filter((row) => row.effectiveDepartment != null).length,
  );
}

function trendFor(current: MonetarySummary, prior: MonetarySummary): WasteTrendKpi {
  const currentIncomplete = current.coverage.status === "partial" || current.coverage.status === "unavailable";
  const priorIncomplete = prior.coverage.status === "partial" || prior.coverage.status === "unavailable";
  if (currentIncomplete) {
    return {
      percent: null,
      current_known_amount: current.coverage.known_amount,
      prior_known_amount: prior.coverage.known_amount,
      status: "unavailable",
      reason: "current_incomplete",
    };
  }
  if (priorIncomplete) {
    return {
      percent: null,
      current_known_amount: current.coverage.known_amount,
      prior_known_amount: prior.coverage.known_amount,
      status: "unavailable",
      reason: "prior_incomplete",
    };
  }
  if (prior.knownCents === 0) {
    return {
      percent: null,
      current_known_amount: current.coverage.known_amount,
      prior_known_amount: 0,
      status: "unavailable",
      reason: "prior_zero",
    };
  }
  return {
    percent: roundPercent((current.knownCents - prior.knownCents) / prior.knownCents * 100),
    current_known_amount: current.coverage.known_amount,
    prior_known_amount: prior.coverage.known_amount,
    status: "available",
    reason: null,
  };
}

function qualifyingSpendCoverage(rows: SpendRateRow[]): { coverage: QualifyingSpendCoverage; knownCents: number } {
  let qualifying = 0;
  let excludedHousehold = 0;
  let pendingDepartment = 0;
  let priced = 0;
  let unpriced = 0;
  let estimated = 0;
  let knownCents = 0;

  for (const row of rows) {
    if (row.department == null) {
      pendingDepartment++;
      continue;
    }
    if (row.department === "household") {
      excludedHousehold++;
      continue;
    }

    qualifying++;
    if (row.amount == null) unpriced++;
    else {
      priced++;
      knownCents += toCents(row.amount);
    }
    if (row.estimated) estimated++;
  }

  const status: CoverageStatus = qualifying === 0 && pendingDepartment === 0
    ? "empty"
    : priced === 0
      ? "unavailable"
      : unpriced > 0 || estimated > 0 || pendingDepartment > 0
        ? "partial"
        : "complete";

  return {
    knownCents,
    coverage: {
      status,
      spend_event_count: rows.length,
      qualifying_event_count: qualifying,
      excluded_household_event_count: excludedHousehold,
      pending_department_event_count: pendingDepartment,
      priced_event_count: priced,
      unpriced_event_count: unpriced,
      estimated_event_count: estimated,
      known_amount: fromCents(knownCents),
    },
  };
}

function wasteRateFor(waste: MonetarySummary, spend: ReturnType<typeof qualifyingSpendCoverage>): WasteRateKpi {
  const base = {
    known_waste_amount: waste.coverage.known_amount,
    qualifying_spend_amount: spend.coverage.known_amount,
    spend_coverage: spend.coverage,
  };
  if (waste.coverage.status === "partial" || waste.coverage.status === "unavailable") {
    return { ...base, percent: null, status: "unavailable", reason: "waste_incomplete" };
  }
  if (spend.coverage.status === "partial" || spend.coverage.status === "unavailable") {
    return { ...base, percent: null, status: "unavailable", reason: "spend_incomplete" };
  }
  const denominatorCents = waste.knownCents + spend.knownCents;
  if (denominatorCents <= 0) {
    return { ...base, percent: null, status: "unavailable", reason: "zero_denominator" };
  }
  return {
    ...base,
    percent: roundPercent(waste.knownCents / denominatorCents * 100),
    status: "available",
    reason: null,
  };
}

function makeBreakdown(
  rows: ReducedWasteEvent[],
  keyFor: (row: ReducedWasteEvent) => string | null,
  labelFor: (key: string) => string = presentationLabel,
): WasteBreakdown {
  const keyedRows: { row: ReducedWasteEvent; key: string }[] = [];
  for (const row of rows) {
    const key = keyFor(row);
    if (key != null) keyedRows.push({ row, key });
  }

  const applicableRows = keyedRows.map(({ row }) => row);
  const monetary = monetarySummary(applicableRows);
  const groups = new Map<string, {
    eventCount: number;
    valuedEventCount: number;
    estimatedEventCount: number;
    knownCents: number;
  }>();
  for (const { row, key } of keyedRows) {
    const group = groups.get(key) ?? {
      eventCount: 0,
      valuedEventCount: 0,
      estimatedEventCount: 0,
      knownCents: 0,
    };
    group.eventCount++;
    if (row.valueCents != null) {
      group.valuedEventCount++;
      group.knownCents += row.valueCents;
      if (row.estimated) group.estimatedEventCount++;
    }
    groups.set(key, group);
  }

  const items = [...groups.entries()]
    .sort(([aKey, a], [bKey, b]) =>
      b.knownCents - a.knownCents ||
      b.eventCount - a.eventCount ||
      compareRawKeys(aKey, bKey))
    .map(([key, group]): WasteBreakdownItem => ({
      key,
      label: labelFor(key),
      event_count: group.eventCount,
      valued_event_count: group.valuedEventCount,
      unvalued_event_count: group.eventCount - group.valuedEventCount,
      estimated_event_count: group.estimatedEventCount,
      amount: group.valuedEventCount === 0 ? null : fromCents(group.knownCents),
      count_percentage: keyedRows.length === 0
        ? null
        : roundPercent(group.eventCount / keyedRows.length * 100),
      amount_percentage: monetary.knownCents === 0
        ? null
        : roundPercent(group.knownCents / monetary.knownCents * 100),
    }));

  return {
    count_denominator: keyedRows.length,
    known_amount_denominator: monetary.coverage.known_amount,
    classification_coverage: classificationCoverage(rows.length, keyedRows.length),
    monetary_coverage: monetary.coverage,
    items,
  };
}

interface WasteItemAccumulator {
  knownCents: number;
  eventCount: number;
  valuedEventCount: number;
  estimatedEventCount: number;
  representative: ReducedWasteEvent;
}

function mostWasted(rows: ReducedWasteEvent[], knownDenominatorCents: number): WasteAnalyzer["most_wasted"] {
  const groups = new Map<string, WasteItemAccumulator>();
  for (const row of rows) {
    const prior = groups.get(row.item_id);
    const later = prior == null || row.occurred_at > prior.representative.occurred_at ||
      (row.occurred_at === prior.representative.occurred_at && row.id > prior.representative.id);
    const group = prior ?? {
      knownCents: 0,
      eventCount: 0,
      valuedEventCount: 0,
      estimatedEventCount: 0,
      representative: row,
    };
    group.eventCount++;
    if (row.valueCents != null) {
      group.valuedEventCount++;
      group.knownCents += row.valueCents;
      if (row.estimated) group.estimatedEventCount++;
    }
    if (later) group.representative = row;
    groups.set(row.item_id, group);
  }

  const ordered = [...groups.entries()].sort(([aKey, a], [bKey, b]) => {
    const aValued = a.valuedEventCount > 0;
    const bValued = b.valuedEventCount > 0;
    if (aValued !== bValued) return aValued ? -1 : 1;
    if (aValued) {
      return b.knownCents - a.knownCents ||
        b.eventCount - a.eventCount ||
        compareRawKeys(aKey, bKey);
    }
    return b.eventCount - a.eventCount || compareRawKeys(aKey, bKey);
  });

  const items = ordered.slice(0, WASTE_ITEM_CAP).map(([key, group]): WasteItemGroup => {
    const unvaluedEventCount = group.eventCount - group.valuedEventCount;
    const status: WasteItemStatus = group.valuedEventCount === 0
      ? "unavailable"
      : unvaluedEventCount > 0 || group.estimatedEventCount > 0
        ? "partial"
        : "complete";
    return {
      key,
      name: group.representative.name,
      department: group.representative.effectiveDepartment == null
        ? null
        : {
            key: group.representative.effectiveDepartment,
            label: presentationLabel(group.representative.effectiveDepartment),
          },
      event_count: group.eventCount,
      valued_event_count: group.valuedEventCount,
      unvalued_event_count: unvaluedEventCount,
      estimated_event_count: group.estimatedEventCount,
      amount: group.valuedEventCount === 0 ? null : fromCents(group.knownCents),
      amount_percentage: knownDenominatorCents === 0
        ? null
        : roundPercent(group.knownCents / knownDenominatorCents * 100),
      status,
    };
  });

  return { cap: WASTE_ITEM_CAP, total_count: ordered.length, items };
}

function tossedItems(count: number): string {
  return `${count} tossed ${count === 1 ? "item" : "items"}`;
}

function insightFor(
  monetary: MonetaryCoverage,
  department: WasteBreakdown,
  reason: WasteBreakdown,
  avoidability: WasteBreakdown,
): string {
  if (monetary.status === "empty") return "No recorded waste in this range.";
  if (monetary.status === "unavailable") {
    return "Waste value is unavailable because none of the recorded tosses in this range has a matching last-paid price.";
  }
  if (monetary.status === "partial") {
    const clauses: string[] = [];
    if (monetary.unpriced_event_count > 0) {
      clauses.push(
        `${tossedItems(monetary.unpriced_event_count)} had no matching last-paid price`,
      );
    }
    if (monetary.estimated_event_count > 0) {
      clauses.push(
        `${tossedItems(monetary.estimated_event_count)} used an estimated last-paid price`,
      );
    }
    return `Known waste value is incomplete: ${clauses.join(" and ")}.`;
  }

  const topReason = reason.items[0]!;
  let insight: string;
  if (department.classification_coverage.status === "complete") {
    const topDepartment = department.items[0]!;
    insight = `${topDepartment.label} accounted for the most waste at $${topDepartment.amount!.toFixed(2)}` +
      `; ${topReason.label} was the leading reason by known waste value with ${tossedItems(topReason.event_count)}`;
  } else {
    insight = `${topReason.label} was the leading waste reason by known value with ${tossedItems(topReason.event_count)}`;
  }

  if (monetary.known_amount > 0) {
    const avoidableShare = avoidability.items.find((item) => item.key === "avoidable")?.amount_percentage ?? 0;
    insight += `; avoidable waste represented ${avoidableShare.toFixed(1)}% of known waste value`;
  }
  return `${insight}.`;
}

function weeksFor(bounds: SpendBounds, selected: ReducedWasteEvent[]): WasteWeek[] {
  return bounds.starts.map((weekStart) => {
    const weekEnd = addUtcDays(weekStart, 6);
    const through = weekEnd < bounds.asOf ? weekEnd : bounds.asOf;
    const rows = selected.filter((row) => row.occurred_at >= weekStart && row.occurred_at <= through);
    const monetary = monetarySummary(rows);
    return {
      week_start: weekStart,
      week_end: weekEnd,
      through,
      is_partial: through < weekEnd,
      events: rows.length,
      amount: exposedAmount(monetary),
      status: monetary.coverage.status,
      monetary_coverage: monetary.coverage,
      department_coverage: departmentCoverage(rows),
    };
  });
}

/**
 * Compute one tenant's live Waste analyzer from a bounded Waste scan with indexed
 * last-paid seeks plus one bounded qualifying-Spend read. No state is written.
 */
export async function readWasteAnalyzer(
  env: Env,
  tenant: string,
  range: WasteRange,
  mappingVersion?: string,
  now: Date = new Date(),
): Promise<WasteAnalyzer> {
  const resolvedMapping = resolveWasteAvoidabilityMapping(mappingVersion);
  const bounds: SpendBounds = spendBounds(range, now);
  const d = db(env);
  const [wasteRows, spendRows] = await Promise.all([
    d.all<WasteEventRow>(
      "SELECT w.id, w.item_id, w.name, w.prepared_from, w.department, w.reason, w.occurred_at, " +
        "p.unit_price AS last_paid_unit_price, p.estimated AS last_paid_estimated " +
        "FROM waste_events w " +
        "LEFT JOIN spend_events p ON p.tenant = w.tenant AND p.line_key = w.item_id AND p.send_id = (" +
          "SELECT p2.send_id FROM spend_events p2 " +
          "WHERE p2.tenant = w.tenant AND p2.line_key = w.item_id AND p2.voided_at IS NULL " +
            "AND p2.unit_price IS NOT NULL AND p2.occurred_on <= w.occurred_at " +
          "ORDER BY p2.occurred_on DESC, p2.send_id DESC LIMIT 1" +
        ") " +
        "WHERE w.tenant = ?1 AND w.occurred_at >= ?2 AND w.occurred_at <= ?3 " +
        "ORDER BY w.occurred_at ASC, w.id ASC",
      tenant,
      bounds.priorStart,
      bounds.asOf,
    ),
    d.all<SpendRateRow>(
      "SELECT amount, estimated, department FROM spend_events " +
        "WHERE tenant = ?1 AND voided_at IS NULL AND occurred_on >= ?2 AND occurred_on <= ?3 " +
        "ORDER BY occurred_on ASC, send_id ASC, line_key ASC",
      tenant,
      bounds.selectedStart,
      bounds.asOf,
    ),
  ]);

  const reduced = reduceWasteEvents(wasteRows, resolvedMapping.mapping);
  const selected = reduced.filter((row) => row.occurred_at >= bounds.selectedStart);
  const prior = reduced.filter((row) => row.occurred_at <= bounds.priorEnd);
  const monetary = monetarySummary(selected);
  const priorMonetary = monetarySummary(prior);
  const departmentBreakdown = makeBreakdown(selected, (row) => row.effectiveDepartment);
  const reasonBreakdown = makeBreakdown(selected, (row) => row.reason);
  const avoidabilityBreakdown = makeBreakdown(
    selected,
    (row) => row.avoidability,
    (key) => key === "avoidable" ? "Avoidable" : "Hard to avoid",
  );
  const spend = qualifyingSpendCoverage(spendRows);

  return {
    range,
    as_of: bounds.asOf,
    selected_start: bounds.selectedStart,
    selected_end: bounds.asOf,
    prior_start: bounds.priorStart,
    prior_end: bounds.priorEnd,
    status: monetary.coverage.status,
    avoidability_mapping: {
      version: resolvedMapping.version,
      current_version: resolvedMapping.currentVersion,
      is_current: resolvedMapping.isCurrent,
    },
    coverage: {
      monetary: monetary.coverage,
      department: departmentBreakdown.classification_coverage,
    },
    weeks: weeksFor(bounds, selected),
    kpis: {
      tossed_value: {
        amount: exposedAmount(monetary),
        status: monetary.coverage.status,
      },
      items_binned: {
        count: selected.length,
        per_week: roundPercent(selected.length / bounds.starts.length),
      },
      waste_rate: wasteRateFor(monetary, spend),
      trend: trendFor(monetary, priorMonetary),
    },
    breakdowns: {
      department: departmentBreakdown,
      reason: reasonBreakdown,
      avoidability: avoidabilityBreakdown,
    },
    most_wasted: mostWasted(selected, monetary.knownCents),
    insight: insightFor(
      monetary.coverage,
      departmentBreakdown,
      reasonBreakdown,
      avoidabilityBreakdown,
    ),
  };
}
