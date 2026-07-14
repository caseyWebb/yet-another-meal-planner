// Retrospective (retrospective-shell): the renamed Cooking-log destination, now a tabbed
// shell — Cooking log (default) / Spend analyzer / Waste analyzer — with the tab in a `?tab`
// search param. The Cooking log tab is meal-aware (band 1 landed `cooking_log.meal`, the
// `/api/log` meal field, and the meal-aware `retrospective` tool): a composer with a meal
// segmented control (defaulting by time of day) and a source control (From cookbook → recipe,
// Something else → ad_hoc — the mock's "Leftovers" source is deliberately dropped, the log is
// a cooking log not an eating log), plus a day-grouped, meal-tagged list. Band 4 replaces only
// the Spend placeholder with the shared bounded analyzer; Waste remains its existing placeholder.
import * as React from "react";
import { Link, createFileRoute, stripSearchParams } from "@tanstack/react-router";
import type { SearchSchemaInput } from "@tanstack/react-router";
import {
  Button,
  EmptyState,
  IconPlus,
  IconTrash,
  NativeSelect,
  PageHead,
  RecipeFacets,
  SegmentedControl,
  toast,
} from "@yamp/ui";
import {
  useIndex,
  useLog,
  useSpendAnalyzer,
  type LogRow,
  type SpendAnalyzer,
  type SpendBreakdown,
  type SpendCoverageStatus,
  type SpendRange,
  type SpendWeek,
} from "../lib/data";
import { useLogAdd, useLogRemove } from "../lib/mutations";
import { fmtDay, isoToday } from "../lib/format";

type Tab = "log" | "spend" | "waste";
const SPEND_RANGES: SpendRange[] = ["4w", "8w", "12w"];

export const Route = createFileRoute("/_app/retrospective")({
  validateSearch: (s: { tab?: string; range?: string } & SearchSchemaInput): { tab: Tab; range: SpendRange | undefined } => ({
    tab: s.tab === "spend" ? "spend" : s.tab === "waste" ? "waste" : "log",
    // Explicitly overwrite an invalid raw value: parent search is merged into this
    // route's validated search, so omission would leave the invalid value visible.
    range: SPEND_RANGES.includes(s.range as SpendRange) ? s.range as SpendRange : undefined,
  }),
  // The Cooking-log default is the bare URL — strip it so `/retrospective` stays clean.
  search: { middlewares: [stripSearchParams({ tab: "log" as const })] },
  component: RetrospectivePage,
});

const TABS: { key: Tab; label: string }[] = [
  { key: "log", label: "Cooking log" },
  { key: "spend", label: "Spend analyzer" },
  { key: "waste", label: "Waste analyzer" },
];

function RetrospectivePage() {
  const { tab, range } = Route.useSearch();
  const navigate = Route.useNavigate();
  const tabRefs = React.useRef<Record<Tab, HTMLButtonElement | null>>({ log: null, spend: null, waste: null });

  React.useEffect(() => {
    if (tab !== "spend" || range !== undefined) return;
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, tab: "spend", range: "8w" }),
    });
  }, [navigate, range, tab]);

  function selectTab(next: Tab, focus = false) {
    void navigate({ search: (previous) => ({ ...previous, tab: next }) });
    if (focus) tabRefs.current[next]?.focus();
  }

  function onTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    if (next == null) return;
    event.preventDefault();
    selectTab(TABS[next].key, true);
  }

  return (
    <div data-testid="retro-page">
      <PageHead title="Retrospective" sub="Look back at what you cooked — and what it cost." />
      <nav className="prof-tabs retrospective-tabs" role="tablist" aria-label="Retrospective">
        {TABS.map((t, index) => (
          <button
            key={t.key}
            id={`retro-tab-${t.key}`}
            ref={(node) => { tabRefs.current[t.key] = node; }}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            aria-controls={`retro-panel-${t.key}`}
            tabIndex={tab === t.key ? 0 : -1}
            className={`prof-tab${tab === t.key ? " on" : ""}`}
            data-testid={`retro-tab-${t.key}`}
            onClick={() => selectTab(t.key)}
            onKeyDown={(event) => onTabKeyDown(event, index)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <section
        id="retro-panel-log"
        className="prof-tabpanel"
        role="tabpanel"
        aria-labelledby="retro-tab-log"
        hidden={tab !== "log"}
      >
        {tab === "log" ? <CookingLogTab /> : null}
      </section>
      <section
        id="retro-panel-spend"
        className="prof-tabpanel"
        role="tabpanel"
        aria-labelledby="retro-tab-spend"
        hidden={tab !== "spend"}
      >
        {tab === "spend" ? (
          <SpendAnalyzerTab
            range={range ?? "8w"}
            enabled={range !== undefined}
            onRange={(next) => void navigate({ search: (previous) => ({ ...previous, tab: "spend", range: next }) })}
          />
        ) : null}
      </section>
      <section
        id="retro-panel-waste"
        className="prof-tabpanel"
        role="tabpanel"
        aria-labelledby="retro-tab-waste"
        hidden={tab !== "waste"}
      >
        {tab === "waste" ? (
          <div data-testid="waste-page">
            <EmptyState title="Coming soon" sub="Your waste analysis will show up here." />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function SpendAnalyzerTab(props: {
  range: SpendRange;
  enabled: boolean;
  onRange: (range: SpendRange) => void;
}) {
  const query = useSpendAnalyzer(props.range, props.enabled);
  return (
    <div className="spend-panel" data-testid="spend-page">
      <div className="spend-toolbar">
        <div>
          <h2>Household spend</h2>
          <p>{props.range.slice(0, -1)} weeks · UTC weeks start Monday</p>
        </div>
        <div className="spend-range" role="group" aria-label="Spend range">
          {SPEND_RANGES.map((range) => (
            <button
              key={range}
              type="button"
              aria-pressed={props.range === range}
              onClick={() => props.onRange(range)}
            >
              {range.slice(0, -1)} weeks
            </button>
          ))}
        </div>
      </div>

      {!props.enabled || query.isPending ? (
        <div className="spend-state" role="status" data-testid="spend-loading">
          Loading spend analysis…
        </div>
      ) : query.isError ? (
        <div className="spend-state spend-state-error" role="alert" data-testid="spend-error">
          <h3>Spend analysis couldn’t load</h3>
          <p>{query.error.message || "The request failed."}</p>
          <Button size="sm" type="button" onClick={() => void query.refetch()}>Retry spend analysis</Button>
        </div>
      ) : query.data ? (
        <SpendResult result={query.data} />
      ) : null}
    </div>
  );
}

function SpendResult({ result }: { result: SpendAnalyzer }) {
  const empty = result.status === "empty";
  const unavailable = result.status === "unavailable";
  return (
    <div className="spend-result" data-status={result.status}>
      <div className={`spend-state spend-state-${result.status}`} data-testid={`spend-state-${result.status}`}>
        {empty ? (
          <>
            <h3>No recorded spend</h3>
            <p>No non-voided purchases were recorded from {fmtSpendDay(result.selected_start)} through {fmtSpendDay(result.selected_end)}.</p>
          </>
        ) : unavailable ? (
          <>
            <h3>Spend is unavailable</h3>
            <p>{result.coverage.monetary.event_count} recorded {plural(result.coverage.monetary.event_count, "purchase has", "purchases have")} no usable price.</p>
          </>
        ) : result.status === "partial" ? (
          <>
            <h3>Known spend is incomplete</h3>
            <CoverageEvidence result={result} />
          </>
        ) : (
          <>
            <h3>Complete captured spend</h3>
            <p>{fmtSpendDay(result.selected_start)}–{fmtSpendDay(result.selected_end)} · through {fmtSpendDay(result.as_of)} UTC</p>
          </>
        )}
      </div>

      {result.awaiting_mark_placed > 0 ? (
        <aside className="spend-awaiting" aria-label="Awaiting placement" data-testid="spend-awaiting">
          <strong>{result.awaiting_mark_placed} {plural(result.awaiting_mark_placed, "item is", "items are")} awaiting “mark placed.”</strong>
          <span>These sent cart items are not counted as spend.</span>
        </aside>
      ) : null}

      {!empty && !unavailable ? <SpendKpis result={result} /> : null}
      {!empty ? <SpendWeeks result={result} /> : null}
      {!empty && !unavailable ? (
        <>
          <SpendBreakdowns result={result} />
          <SpendDrivers result={result} />
        </>
      ) : null}
      <aside className="spend-insight" aria-label="Spend insight" data-testid="spend-insight">
        <span>Insight</span>
        <p>{result.insight}</p>
      </aside>
    </div>
  );
}

function CoverageEvidence({ result }: { result: SpendAnalyzer }) {
  const evidence = [
    result.coverage.monetary.unpriced_event_count > 0
      ? `${result.coverage.monetary.unpriced_event_count} ${plural(result.coverage.monetary.unpriced_event_count, "purchase has", "purchases have")} no usable price`
      : null,
    result.coverage.monetary.estimated_event_count > 0
      ? `${result.coverage.monetary.estimated_event_count} ${plural(result.coverage.monetary.estimated_event_count, "purchase uses", "purchases use")} an estimated price`
      : null,
    result.coverage.department.pending_event_count > 0
      ? `${result.coverage.department.pending_event_count} ${plural(result.coverage.department.pending_event_count, "purchase awaits", "purchases await")} department classification`
      : null,
  ].filter((item): item is string => item != null);
  return <ul className="spend-evidence">{evidence.map((item) => <li key={item}>{item}</li>)}</ul>;
}

function SpendKpis({ result }: { result: SpendAnalyzer }) {
  const total = result.kpis.total_spend;
  const average = result.kpis.average_per_week;
  const cost = result.kpis.cost_per_meal;
  const trend = result.kpis.trend;
  return (
    <dl className="spend-kpis" aria-label="Spend key metrics">
      <Kpi label="Total spend" value={moneyKpi(total.amount, result.status)} detail={coverageLabel(result.status)} testId="spend-kpi-total" />
      <Kpi label="Average per week" value={moneyKpi(average.amount, result.status)} detail={`${result.weeks.length} selected buckets`} testId="spend-kpi-average" />
      <Kpi
        label="Cost per meal"
        value={cost.amount == null ? "Unavailable" : moneyKpi(cost.amount, cost.status)}
        detail={cost.reason === "zero_meals"
          ? "No qualifying cooking events"
          : cost.reason === "numerator_unavailable"
            ? "Spend numerator unavailable"
            : `${cost.meal_count} qualifying ${plural(cost.meal_count, "cook", "cooks")}`}
        testId="spend-kpi-meal"
      />
      <Kpi
        label="Matched trend"
        value={trend.status === "available" ? trendLabel(trend.percent!) : "Unavailable"}
        detail={trend.status === "available" ? "Against the matched prior range" : trendReason(trend.reason)}
        testId="spend-kpi-trend"
      />
    </dl>
  );
}

function Kpi(props: { label: string; value: string; detail: string; testId: string }) {
  return (
    <div className="spend-kpi" data-testid={props.testId}>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
      <span>{props.detail}</span>
    </div>
  );
}

function SpendWeeks({ result }: { result: SpendAnalyzer }) {
  const max = Math.max(1, result.weekly_budget ?? 0, ...result.weeks.map((week) => week.total));
  return (
    <section className="spend-section" aria-labelledby="spend-weeks-heading">
      <div className="spend-section-head">
        <div>
          <h3 id="spend-weeks-heading">Weekly spend</h3>
          <p>Chronological known amounts, oldest to newest.</p>
        </div>
        {result.weekly_budget == null ? null : (
          <span className="spend-budget" data-testid="spend-budget">Budget {money(result.weekly_budget)} / week</span>
        )}
      </div>
      <div className="spend-chart-scroll" role="region" aria-label="Weekly spend chart" tabIndex={0}>
        <ol className="spend-weeks" data-testid="spend-weeks" data-range={result.range}>
          {result.weeks.map((week) => (
            <SpendWeekItem key={week.week_start} week={week} max={max} budget={result.weekly_budget} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function SpendWeekItem({ week, max, budget }: { week: SpendWeek; max: number; budget: number | null }) {
  const scaledHeight = week.total / max * 100;
  const height = `${budget == null ? Math.max(week.total > 0 ? 8 : 0, scaledHeight) : scaledHeight}%`;
  return (
    <li className="spend-week" data-testid="spend-week" data-week={week.week_start}>
      <div className="spend-bar-wrap" aria-hidden="true">
        {budget == null ? null : <span className="spend-budget-line" style={{ bottom: `${Math.min(100, budget / max * 100)}%` }} />}
        <span className={`spend-bar spend-bar-${week.status}`} style={{ height }} />
      </div>
      <strong>{fmtSpendDay(week.week_start)}</strong>
      <span className="spend-week-value">{weekAmount(week)}</span>
      <span className="spend-week-coverage">{weekCoverage(week)}</span>
      {budget == null ? null : <span className="spend-week-budget">{budgetComparison(week.over_budget, week.through)}</span>}
    </li>
  );
}

function SpendBreakdowns({ result }: { result: SpendAnalyzer }) {
  return (
    <div className="spend-breakdown-grid">
      <Breakdown title="By department" breakdown={result.breakdowns.department} displayStatus={result.status} testId="spend-breakdown-department" />
      <Breakdown title="By store" breakdown={result.breakdowns.store} displayStatus={result.status} testId="spend-breakdown-store" />
      <Breakdown title="Planned vs impulse" breakdown={result.breakdowns.provenance} displayStatus={result.status} testId="spend-breakdown-provenance" />
    </div>
  );
}

function Breakdown({ title, breakdown, displayStatus, testId }: { title: string; breakdown: SpendBreakdown; displayStatus: SpendCoverageStatus; testId: string }) {
  return (
    <section className="spend-breakdown" data-testid={testId}>
      <h3>{title}</h3>
      {breakdown.items.length === 0 ? <p className="spend-muted">No classified groups available.</p> : (
        <ul>
          {breakdown.items.map((item) => (
            <li key={item.key}>
              <span><strong>{item.label}</strong><small>{item.event_count} {plural(item.event_count, "purchase", "purchases")}</small></span>
              <span><strong>{moneyKpi(item.amount, displayStatus)}</strong><small>{item.percentage == null ? "Percentage unavailable" : `${item.percentage.toFixed(1)}%`}</small></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SpendDrivers({ result }: { result: SpendAnalyzer }) {
  if (result.top_drivers.items.length === 0) return null;
  return (
    <section className="spend-section spend-drivers" aria-labelledby="spend-drivers-heading" data-testid="spend-drivers">
      <div className="spend-section-head">
        <div>
          <h3 id="spend-drivers-heading">Top drivers</h3>
          <p>Showing {result.top_drivers.items.length} of {result.top_drivers.total_count} priced line groups.</p>
        </div>
      </div>
      <ol>
        {result.top_drivers.items.map((driver) => (
          <li key={driver.key}>
            <span><strong>{driver.name}</strong><small>{driver.department?.label ?? "Department pending"} · {driver.event_count} {plural(driver.event_count, "purchase", "purchases")}</small></span>
            <span><strong>{moneyKpi(driver.amount, result.status)}</strong><small>{driver.percentage == null ? "Percentage unavailable" : `${driver.percentage.toFixed(1)}% of known spend`}</small></span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function moneyKpi(value: number | null, status: SpendCoverageStatus): string {
  if (value == null) return "Unavailable";
  return `${status === "partial" ? "Known " : ""}${money(value)}`;
}

function coverageLabel(status: SpendCoverageStatus): string {
  return status === "partial" ? "Known subtotal; coverage incomplete" : status === "complete" ? "Complete captured coverage" : status;
}

function trendLabel(percent: number): string {
  if (percent === 0) return "Unchanged";
  return `${Math.abs(percent).toFixed(1)}% ${percent > 0 ? "higher" : "lower"}`;
}

function trendReason(reason: SpendAnalyzer["kpis"]["trend"]["reason"]): string {
  if (reason === "current_incomplete") return "Current price coverage incomplete";
  if (reason === "prior_incomplete") return "Prior price coverage incomplete";
  return "No positive prior denominator";
}

function weekAmount(week: SpendWeek): string {
  if (week.monetary_coverage.status === "unavailable") return "Price unavailable";
  return moneyKpi(week.total, week.status);
}

function weekCoverage(week: SpendWeek): string {
  if (week.status === "empty") return "No recorded purchases";
  if (week.monetary_coverage.status === "unavailable") {
    return `${week.events} ${plural(week.events, "purchase", "purchases")}; no usable price`;
  }
  const details = [`${week.events} ${plural(week.events, "purchase", "purchases")}`];
  if (week.monetary_coverage.unpriced_event_count > 0) details.push(`${week.monetary_coverage.unpriced_event_count} unpriced`);
  if (week.monetary_coverage.estimated_event_count > 0) details.push(`${week.monetary_coverage.estimated_event_count} estimated`);
  if (week.department_coverage.pending_event_count > 0) details.push(`${week.department_coverage.pending_event_count} department pending`);
  if (week.is_partial) details.push(`through ${fmtSpendDay(week.through)}`);
  return details.join(" · ");
}

function budgetComparison(over: boolean | null, through: string): string {
  if (over === true) return `Over budget through ${fmtSpendDay(through)}`;
  if (over === false) return `Within budget through ${fmtSpendDay(through)}`;
  return "Budget comparison unavailable";
}

function fmtSpendDay(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00.000Z`));
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

const MEALS = ["breakfast", "lunch", "dinner"] as const;
type Meal = (typeof MEALS)[number];

/** The composer's meal default follows the time of day (pages/07): before 11:00 breakfast,
 *  before 16:00 lunch, else dinner. */
function defaultMeal(): Meal {
  const h = new Date().getHours();
  return h < 11 ? "breakfast" : h < 16 ? "lunch" : "dinner";
}

function CookingLogTab() {
  const log = useLog();
  const index = useIndex();
  const logAdd = useLogAdd();

  const [meal, setMeal] = React.useState<Meal>(defaultMeal);
  const [source, setSource] = React.useState<"cookbook" | "else">("cookbook");
  const [slug, setSlug] = React.useState("");
  const [name, setName] = React.useState("");
  const [date, setDate] = React.useState(isoToday);

  const entries = log.data?.entries ?? [];
  const canSubmit = source === "cookbook" ? !!slug : name.trim().length > 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    // Registry mutation: defaults invalidate log/plan/vibes on settle; the server's
    // (date, meal, type, recipe|name) dedupe makes a replayed delivery converge. Meal and
    // date persist for rapid multi-logging; only the per-source input resets.
    if (source === "cookbook") {
      logAdd.mutate(
        { type: "recipe", recipe: slug, meal, date },
        { onSuccess: () => { toast("Logged as cooked"); setSlug(""); } },
      );
    } else {
      logAdd.mutate(
        { type: "ad_hoc", name: name.trim(), meal, date },
        { onSuccess: () => { toast("Logged"); setName(""); } },
      );
    }
  }

  return (
    <div data-testid="log-page">
      <div className="log-composer">
        <div className="log-composer-cap">
          <IconPlus /> Log a cook
        </div>
        <form onSubmit={submit} data-testid="log-add" style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
          <div className="log-composer-row">
            <SegmentedControl name="meal" value={meal} options={MEALS} onChange={setMeal} labelFor={cap} />
            <SegmentedControl
              name="source"
              value={source}
              options={["cookbook", "else"] as const}
              onChange={setSource}
              labelFor={(s) => (s === "cookbook" ? "From cookbook" : "Something else")}
            />
          </div>
          <div className="log-composer-row">
            {source === "cookbook" ? (
              <NativeSelect
                className="select log-what"
                aria-label="Recipe cooked"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              >
                <option value="">Pick a recipe…</option>
                {(index.data?.recipes ?? []).map((r) => (
                  <option key={r.slug} value={r.slug}>
                    {r.title}
                  </option>
                ))}
              </NativeSelect>
            ) : (
              <input
                className="input log-what"
                aria-label="What you ate"
                placeholder="What did you eat? e.g. takeout ramen"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
            <input
              className="input log-date-in"
              type="date"
              aria-label="Date cooked"
              value={date}
              max={isoToday()}
              onChange={(e) => setDate(e.target.value)}
            />
            <Button size="sm" type="submit" disabled={!canSubmit}>
              <IconPlus /> Log it
            </Button>
          </div>
        </form>
      </div>

      {log.data && entries.length === 0 ? (
        <EmptyState title="No history yet" sub="Log a cook and it shows up here." />
      ) : (
        <div className="log-days" data-testid="log-list">
          {groupByDay(entries).map((day) => (
            <div className="log-day" key={day.date}>
              <div className="log-day-head">
                <span className="log-day-rel">{day.label}</span>
                <span className="log-day-sub">{day.entries.length} logged</span>
              </div>
              <div className="log-day-entries">
                {day.entries.map((e) => (
                  <LogEntryView key={e.id} entry={e} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LogEntryView({ entry }: { entry: LogRow }) {
  const logRemove = useLogRemove();
  const title = entry.title ?? entry.name ?? entry.recipe ?? "—";
  return (
    <div className="log-entry" data-testid="log-row" data-id={entry.id}>
      <span className="log-meal" data-meal={entry.meal ?? ""}>
        {entry.meal ?? ""}
      </span>
      <div className="log-entry-main">
        {entry.recipe ? (
          <Link className="log-entry-title plain-link" to="/recipe/$slug" params={{ slug: entry.recipe }}>
            {title}
          </Link>
        ) : (
          <span className="log-entry-title">{title}</span>
        )}
        <div className="log-facets">
          <RecipeFacets protein={entry.protein} cuisine={entry.cuisine} />
          {entry.type !== "recipe" ? <span className="log-type">{typeLabel(entry.type)}</span> : null}
        </div>
      </div>
      <button
        type="button"
        className="icon-btn"
        title="Remove"
        data-testid="log-remove"
        onClick={() => logRemove.mutate({ id: entry.id })}
      >
        <IconTrash />
      </button>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function typeLabel(type: LogRow["type"]): string {
  return type === "ad_hoc" ? "made something else" : "ready to eat";
}

const MEAL_RANK: Record<NonNullable<LogRow["meal"]>, number> = { breakfast: 0, lunch: 1, dinner: 2, project: 3 };
const mealRank = (m: LogRow["meal"]): number => (m ? MEAL_RANK[m] : 4);

interface DayGroup {
  date: string;
  label: string;
  entries: LogRow[];
}

/** Group the (already date-DESC) log into per-day sections, ordering rows within a day by
 *  meal (breakfast < lunch < dinner < project; a meal-less legacy row sorts last). */
function groupByDay(entries: LogRow[]): DayGroup[] {
  const days: DayGroup[] = [];
  const byDate = new Map<string, LogRow[]>();
  for (const e of entries) {
    const bucket = byDate.get(e.date);
    if (bucket) bucket.push(e);
    else {
      const created: LogRow[] = [e];
      byDate.set(e.date, created);
      days.push({ date: e.date, label: dayLabel(e.date), entries: created });
    }
  }
  for (const d of days) d.entries.sort((a, b) => mealRank(a.meal) - mealRank(b.meal));
  return days;
}

function dayLabel(date: string): string {
  const today = isoToday();
  if (date === today) return "Today";
  // `isoToday()` is a UTC calendar day; derive "yesterday" in the SAME calendar (parse and
  // step in UTC) so the label can't slip a day in zones east of UTC.
  const y = new Date(`${today}T00:00:00Z`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (date === y.toISOString().slice(0, 10)) return "Yesterday";
  return fmtDay(date);
}
