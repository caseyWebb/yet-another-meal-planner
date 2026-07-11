// Retrospective (retrospective-shell): the renamed Cooking-log destination, now a tabbed
// shell — Cooking log (default) / Spend analyzer / Waste analyzer — with the tab in a `?tab`
// search param. The Cooking log tab is meal-aware (band 1 landed `cooking_log.meal`, the
// `/api/log` meal field, and the meal-aware `retrospective` tool): a composer with a meal
// segmented control (defaulting by time of day) and a source control (From cookbook → recipe,
// Something else → ad_hoc — the mock's "Leftovers" source is deliberately dropped, the log is
// a cooking log not an eating log), plus a day-grouped, meal-tagged list. The Spend and Waste
// analyzers themselves are band 4 — their tabs render a placeholder here.
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
import { useIndex, useLog, type LogRow } from "../lib/data";
import { useLogAdd, useLogRemove } from "../lib/mutations";
import { fmtDay, isoToday } from "../lib/format";

type Tab = "log" | "spend" | "waste";

export const Route = createFileRoute("/_app/retrospective")({
  validateSearch: (s: { tab?: string } & SearchSchemaInput): { tab: Tab } => ({
    tab: s.tab === "spend" ? "spend" : s.tab === "waste" ? "waste" : "log",
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
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();

  return (
    <div data-testid="retro-page">
      <PageHead title="Retrospective" sub="Look back at what you cooked — and what it cost." />
      <nav className="prof-tabs" role="tablist" aria-label="Retrospective">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`prof-tab${tab === t.key ? " on" : ""}`}
            data-testid={`retro-tab-${t.key}`}
            onClick={() => void navigate({ search: (prev) => ({ ...prev, tab: t.key }) })}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="prof-tabpanel" role="tabpanel">
        {tab === "log" ? (
          <CookingLogTab />
        ) : (
          <div data-testid={`${tab}-page`}>
            <EmptyState
              title="Coming soon"
              sub={tab === "spend" ? "Your spend analysis will show up here." : "Your waste analysis will show up here."}
            />
          </div>
        )}
      </div>
    </div>
  );
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
