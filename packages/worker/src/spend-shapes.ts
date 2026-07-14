// Workerd-free Spend analyzer wire contract. Worker reduction, member app rendering,
// and Playwright presentation fixtures import this leaf so the additive JSON shape
// cannot drift across runtime environments.

export type SpendRange = "4w" | "8w" | "12w";
export type CoverageStatus = "empty" | "unavailable" | "partial" | "complete";

export interface MonetaryCoverage {
  status: CoverageStatus;
  event_count: number;
  priced_event_count: number;
  unpriced_event_count: number;
  estimated_event_count: number;
  known_amount: number;
}

export interface ClassificationCoverage {
  status: CoverageStatus;
  event_count: number;
  classified_event_count: number;
  pending_event_count: number;
}

export interface SavingsCoverage {
  status: CoverageStatus;
  event_count: number;
  known_event_count: number;
  unknown_event_count: number;
  known_savings: number;
}

export interface SpendWeek {
  week_start: string;
  total: number;
  savings: number;
  events: number;
  estimated: number;
  week_end: string;
  through: string;
  is_partial: boolean;
  status: CoverageStatus;
  monetary_coverage: MonetaryCoverage;
  department_coverage: ClassificationCoverage;
  savings_coverage: SavingsCoverage;
  over_budget: boolean | null;
}

export interface MoneyKpi {
  amount: number | null;
  status: CoverageStatus;
}

export interface CostPerMealKpi {
  amount: number | null;
  known_numerator: number;
  meal_count: number;
  status: CoverageStatus;
  reason: null | "zero_meals" | "numerator_unavailable";
}

export interface TrendKpi {
  percent: number | null;
  current_known_amount: number;
  prior_known_amount: number;
  status: "available" | "unavailable";
  reason: null | "current_incomplete" | "prior_incomplete" | "prior_zero";
}

export interface BreakdownItem {
  key: string;
  label: string;
  amount: number;
  event_count: number;
  priced_event_count: number;
  unpriced_event_count: number;
  percentage: number | null;
}

export interface SpendBreakdown {
  known_denominator: number;
  status: CoverageStatus;
  items: BreakdownItem[];
}

export interface SpendDriver {
  key: string;
  name: string;
  department: { key: string; label: string } | null;
  amount: number;
  event_count: number;
  priced_event_count: number;
  unpriced_event_count: number;
  percentage: number | null;
}

export interface SpendAnalyzer {
  range: SpendRange;
  as_of: string;
  selected_start: string;
  selected_end: string;
  prior_start: string;
  prior_end: string;
  status: CoverageStatus;
  coverage: {
    monetary: MonetaryCoverage;
    department: ClassificationCoverage;
    savings: SavingsCoverage;
  };
  weekly_budget: number | null;
  weeks: SpendWeek[];
  awaiting_mark_placed: number;
  kpis: {
    total_spend: MoneyKpi;
    average_per_week: MoneyKpi;
    cost_per_meal: CostPerMealKpi;
    trend: TrendKpi;
  };
  breakdowns: {
    department: SpendBreakdown;
    store: SpendBreakdown;
    provenance: SpendBreakdown;
  };
  top_drivers: { cap: 6; total_count: number; items: SpendDriver[] };
  insight: string;
}
