// Workerd-free Waste analyzer wire contract. Worker reduction, member app rendering,
// and Playwright presentation fixtures import this leaf so the additive JSON shape
// cannot drift across runtime environments.

import type {
  ClassificationCoverage,
  CoverageStatus,
  MonetaryCoverage,
  MoneyKpi,
  SpendRange,
} from "./spend-shapes.js";

export type WasteRange = SpendRange;
export type WasteItemStatus = "unavailable" | "partial" | "complete";
export type Avoidability = "avoidable" | "hard_to_avoid";

export interface WasteWeek {
  week_start: string;
  week_end: string;
  through: string;
  is_partial: boolean;
  events: number;
  amount: number | null;
  status: CoverageStatus;
  monetary_coverage: MonetaryCoverage;
  department_coverage: ClassificationCoverage;
}

export interface ItemsBinnedKpi {
  count: number;
  per_week: number;
}

export interface WasteTrendKpi {
  percent: number | null;
  current_known_amount: number;
  prior_known_amount: number;
  status: "available" | "unavailable";
  reason: null | "current_incomplete" | "prior_incomplete" | "prior_zero";
}

export interface QualifyingSpendCoverage {
  status: CoverageStatus;
  spend_event_count: number;
  qualifying_event_count: number;
  excluded_household_event_count: number;
  pending_department_event_count: number;
  priced_event_count: number;
  unpriced_event_count: number;
  estimated_event_count: number;
  known_amount: number;
}

export interface WasteRateKpi {
  percent: number | null;
  known_waste_amount: number;
  qualifying_spend_amount: number;
  status: "available" | "unavailable";
  reason: null | "waste_incomplete" | "spend_incomplete" | "zero_denominator";
  spend_coverage: QualifyingSpendCoverage;
}

export interface WasteBreakdownItem {
  key: string;
  label: string;
  event_count: number;
  valued_event_count: number;
  unvalued_event_count: number;
  estimated_event_count: number;
  amount: number | null;
  count_percentage: number | null;
  amount_percentage: number | null;
}

export interface WasteBreakdown {
  count_denominator: number;
  known_amount_denominator: number;
  classification_coverage: ClassificationCoverage;
  monetary_coverage: MonetaryCoverage;
  items: WasteBreakdownItem[];
}

export interface WasteItemGroup {
  key: string;
  name: string;
  department: { key: string; label: string } | null;
  event_count: number;
  valued_event_count: number;
  unvalued_event_count: number;
  estimated_event_count: number;
  amount: number | null;
  amount_percentage: number | null;
  status: WasteItemStatus;
}

export interface WasteAnalyzer {
  range: WasteRange;
  as_of: string;
  selected_start: string;
  selected_end: string;
  prior_start: string;
  prior_end: string;
  status: CoverageStatus;
  avoidability_mapping: {
    version: string;
    current_version: string;
    is_current: boolean;
  };
  coverage: {
    monetary: MonetaryCoverage;
    department: ClassificationCoverage;
  };
  weeks: WasteWeek[];
  kpis: {
    tossed_value: MoneyKpi;
    items_binned: ItemsBinnedKpi;
    waste_rate: WasteRateKpi;
    trend: WasteTrendKpi;
  };
  breakdowns: {
    department: WasteBreakdown;
    reason: WasteBreakdown;
    avoidability: WasteBreakdown;
  };
  most_wasted: { cap: 6; total_count: number; items: WasteItemGroup[] };
  insight: string;
}
