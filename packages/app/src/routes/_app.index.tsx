// Cookbook — ONE unified filterable list (member-app-core "Cookbook browse and keyword
// search" + member-app-differentiators' promoted panel): search bar → global filter bar
// → the "Recommended for you" panel → a flat title-sorted organic list. The panel
// repackages the three existing differentiator reads as reason badges — "Just Added"
// (new-for-me watermark), "Trending" (the guarded group read, min-signal guard and chip
// copy verbatim; "Popular with Friends" waits for the friend lens), "Picked for You"
// (favorites centroid) — at most one row per signal, deduped out of the organic list.
// Favorites is an in-page VIEW MODE (?view=favorites): same filters, panel hidden, its
// own empty copy. All shareable state (query, filters, view) lives in validated URL
// search params with defaults stripped; only the un-debounced input text is local.
// Search keeps the debounce-against-API behavior (the mock's keystroke search is
// in-memory only — painted door).
import * as React from "react";
import { createFileRoute, stripSearchParams, type SearchSchemaInput } from "@tanstack/react-router";
import {
  Button,
  EmptyState,
  IconHeart,
  IconSearch,
  IconSparkles,
  IconX,
  NativeSelect,
  PageHead,
  SegmentedControl,
} from "@yamp/ui";
import { RecipeRow, RecipeList } from "../components/recipe-list";
import {
  facetOptions,
  filterHits,
  filtersActive,
  TIME_FILTER_VALUES,
  type CookbookFilterState,
  type TimeFilterValue,
} from "../lib/cookbook-filters";
import {
  useIndex,
  useNewForMe,
  useOverlay,
  usePickedForYou,
  useSearch as useSearchQuery,
  useTrending,
  type Hit,
} from "../lib/data";

/** The time cap's URL form is a bare NUMBER (`?time=30`) — the default search
 *  stringifier would JSON-quote a numeric-looking string into `time=%2230%22`,
 *  which is neither clean nor what a hand-typed deep link sends. */
type TimeCap = 20 | 30 | 45;

const DEFAULTS = {
  q: "",
  cuisine: "",
  protein: "",
  time: undefined as TimeCap | undefined,
  view: "all" as "all" | "favorites",
};

export const Route = createFileRoute("/_app/")({
  // Every shareable page state lives here (the repo's URL-search-param standard):
  // the debounced query, the three filters, and the favorites view mode. Defaults
  // are stripped so plain "/" stays clean and every combination deep-links.
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => {
    const t = Number(s.time);
    return {
      q: typeof s.q === "string" ? s.q : DEFAULTS.q,
      cuisine: typeof s.cuisine === "string" ? s.cuisine : DEFAULTS.cuisine,
      protein: typeof s.protein === "string" ? s.protein : DEFAULTS.protein,
      time: t === 20 || t === 30 || t === 45 ? (t as TimeCap) : DEFAULTS.time,
      view: s.view === "favorites" ? ("favorites" as const) : DEFAULTS.view,
    };
  },
  // `time: undefined` self-omits from the URL; the middleware strips the rest.
  search: { middlewares: [stripSearchParams({ q: "", cuisine: "", protein: "", view: "all" as const })] },
  component: CookbookPage,
});

/** One promoted row: the hit plus its uppercase reason badge. */
interface PromotedRow {
  hit: Hit;
  badge: "Just Added" | "Trending" | "Picked for You";
}

/**
 * Panel composition (member-app-differentiators): at most ONE row per signal — the
 * signal's TOP-ranked row — in fixed precedence Just Added → Trending → Picked for
 * You. A top row already promoted by a higher-precedence signal contributes nothing
 * (deduped, not re-badged), and a top row failing the active filters is DROPPED, not
 * replaced by a deeper-ranked candidate — the panel never misrepresents a signal's
 * actual top recommendation (the mock's per-row filtering semantics). Pure derivation
 * over the session reads: no persistence, no pinning, no dismissal state.
 */
function promoteRows(
  signals: { badge: PromotedRow["badge"]; rows: Hit[] }[],
  filters: CookbookFilterState,
): PromotedRow[] {
  const promoted: PromotedRow[] = [];
  const seen = new Set<string>();
  for (const { badge, rows } of signals) {
    const top = rows[0];
    if (!top || seen.has(top.slug)) continue;
    seen.add(top.slug);
    if (filterHits([top], filters).length === 0) continue;
    promoted.push({ hit: top, badge });
  }
  return promoted;
}

function CookbookPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { q, view } = search;
  const filters: CookbookFilterState = {
    cuisine: search.cuisine,
    protein: search.protein,
    // URL form is the bare number; the filter model + segmented control speak the
    // string vocabulary ("" = Any).
    time: search.time != null ? (String(search.time) as TimeFilterValue) : "",
  };

  // The un-debounced input text is the ONE piece of transient client state. pushedQ
  // tracks the last query this component navigated to, so an external URL change
  // (back button, deep link) syncs the input without clobbering in-flight typing.
  const [text, setText] = React.useState(q);
  const pushedQ = React.useRef(q);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (q !== pushedQ.current) {
      pushedQ.current = q;
      setText(q);
    }
  }, [q]);

  const index = useIndex();
  const overlay = useOverlay();
  const newForMe = useNewForMe();
  const trending = useTrending();
  const picked = usePickedForYou();
  const apiSearch = useSearchQuery(q);

  function onInput(v: string) {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const next = v.trim();
      pushedQ.current = next;
      // replace, not push — typing must not spam history; the URL is still shareable.
      void navigate({ search: (prev) => ({ ...prev, q: next }), replace: true });
    }, 180); // the mock's debounce
  }
  function clearSearch() {
    // Cancel any pending debounce — otherwise a clear clicked within the debounce
    // window is overwritten when the stale timer fires and re-applies the old query.
    if (timer.current) clearTimeout(timer.current);
    setText("");
    pushedQ.current = "";
    void navigate({ search: (prev) => ({ ...prev, q: "" }), replace: true });
  }
  function setFilter(patch: { cuisine?: string; protein?: string }) {
    void navigate({ search: (prev) => ({ ...prev, ...patch }) });
  }
  function setTime(v: TimeFilterValue) {
    void navigate({ search: (prev) => ({ ...prev, time: v ? (Number(v) as TimeCap) : undefined }) });
  }
  function clearFilters() {
    void navigate({ search: (prev) => ({ ...prev, cuisine: "", protein: "", time: undefined }) });
  }

  const searching = q.length > 0;
  const active = filtersActive(filters);
  const indexHits = index.data?.recipes ?? [];
  const cuisineOptions = facetOptions(indexHits, "cuisine");
  const proteinOptions = facetOptions(indexHits, "protein");

  // Favorites view source: the caller's overlay favorites joined client-side to the
  // cached index (the same join the standalone favorites page ships).
  const favSlugs = new Set(
    Object.entries(overlay.data?.overlay ?? {})
      .filter(([, row]) => row.favorite)
      .map(([slug]) => slug),
  );
  const favHits = indexHits.filter((r) => favSlugs.has(r.slug));

  // Honest trend chips (D31): rendered ONLY from the guarded trending read — wherever
  // the recipe is listed (panel or organic) — never fabricated when the set is empty.
  const trendingRows = trending.data?.recipes ?? [];
  const trendingBySlug = new Map(trendingRows.map((r) => [r.slug, r]));
  const trendChip = (slug: string): React.ReactNode => {
    const t = trendingBySlug.get(slug);
    if (!t) return null;
    return (
      <span className="facet trend-chip" data-testid="trending-chip">
        {t.cooks_by > 1 ? `cooked by ${t.cooks_by} members` : `cooked ${t.cooks}× recently`}
      </span>
    );
  };

  // The promoted panel derives per render from the three existing reads.
  const promoted = promoteRows(
    [
      { badge: "Just Added", rows: newForMe.data?.recipes ?? [] },
      { badge: "Trending", rows: trendingRows },
      { badge: "Picked for You", rows: picked.data?.recipes ?? [] },
    ],
    filters,
  );
  const promotedSlugs = new Set(promoted.map((p) => p.hit.slug));
  const showPromoted = !searching && view === "all" && promoted.length > 0;

  // The flat organic list: full index (title-sorted server-side) minus displayed
  // promoted rows in browse mode; the filtered favorites in the favorites view.
  const listSource =
    view === "favorites"
      ? filterHits(favHits, filters)
      : filterHits(indexHits, filters).filter((r) => !promotedSlugs.has(r.slug));

  // "N of M match" counts the filtered corpus (or favorites) BEFORE promo dedup, so
  // the numbers describe the filter, not the panel layout.
  const countBase = view === "favorites" ? favHits : indexHits;
  const matchCount = filterHits(countBase, filters).length;

  const results = filterHits(apiSearch.data?.results ?? [], filters);
  const favEmpty = view === "favorites" && overlay.data && index.data && favHits.length === 0;

  return (
    <div data-testid="cookbook-page">
      <PageHead title="Cookbook" sub="Search the cookbook, or see what's new for you." />
      <div className="searchbar" id="searchbar" data-has-text={text ? "true" : "false"}>
        <IconSearch />
        <input
          className="input"
          id="q"
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search recipes…"
          aria-label="Search recipes"
          value={text}
          onChange={(e) => onInput(e.target.value)}
        />
        <button type="button" className="search-clear" aria-label="Clear search" onClick={clearSearch}>
          <IconX />
        </button>
      </div>

      {/*
        The favorites view-mode CONTROL mounts here (or as a filter-bar pill) once its
        design lands — design-requests.md #1; its form (pill vs tab row) is design-
        blocked and deliberately not improvised. The view mode itself is live via the
        `view` search param: navigate({ search: (prev) => ({ ...prev, view }) }).
      */}

      <div className="filterbar" data-testid="cookbook-filters">
        <div className="fb-group">
          <span className="fb-label">Cuisine</span>
          <NativeSelect
            className="select"
            aria-label="Filter by cuisine"
            value={filters.cuisine}
            onChange={(e) => setFilter({ cuisine: e.target.value })}
          >
            <option value="">All cuisines</option>
            {cuisineOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="fb-group">
          <span className="fb-label">Protein</span>
          <NativeSelect
            className="select"
            aria-label="Filter by protein"
            value={filters.protein}
            onChange={(e) => setFilter({ protein: e.target.value })}
          >
            <option value="">All proteins</option>
            {proteinOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="fb-group">
          <span className="fb-label">Time</span>
          <SegmentedControl
            name="cook_time"
            value={filters.time}
            options={TIME_FILTER_VALUES}
            labelFor={(v) => (v ? `≤${v}` : "Any")}
            onChange={setTime}
          />
        </div>
        <div className="fb-end">
          {active && !searching ? (
            <span className="fb-count" data-testid="filter-count">
              {matchCount} of {countBase.length} match
            </span>
          ) : null}
          {active ? (
            <Button type="button" variant="ghost" size="sm" data-testid="clear-filters" onClick={clearFilters}>
              <IconX /> Clear
            </Button>
          ) : null}
        </div>
      </div>

      {searching ? (
        <div id="results" data-testid="search-results">
          {apiSearch.isLoading ? null : results.length === 0 ? (
            <EmptyState
              title="No matches"
              sub={`Nothing matches “${q}”. Try a protein, a cuisine, or an ingredient.`}
            />
          ) : (
            <>
              <p className="resultmeta">
                {results.length} result{results.length === 1 ? "" : "s"} for “<strong>{q}</strong>”
              </p>
              <RecipeList recipes={results} annotate={trendChip} />
            </>
          )}
        </div>
      ) : favEmpty ? (
        <EmptyState title="No favorites yet" sub="Tap the heart on any recipe to save it here." icon={<IconHeart />} />
      ) : (
        <div id="browse">
          {showPromoted ? (
            <section className="promo-panel" data-testid="promoted">
              <div className="promo-cap">
                <IconSparkles /> Recommended for you
              </div>
              <ul className="recipes">
                {promoted.map((p) => (
                  <RecipeRow key={p.hit.slug} recipe={p.hit} promoBadge={p.badge} annotation={trendChip(p.hit.slug)} />
                ))}
              </ul>
            </section>
          ) : null}
          <section data-testid="organic-list">
            {listSource.length ? (
              <RecipeList recipes={listSource} annotate={trendChip} />
            ) : active ? (
              <p className="filter-empty" data-testid="filter-empty">
                {view === "favorites"
                  ? "None of your favorites match these filters."
                  : "No recipes match these filters."}{" "}
                <button type="button" className="plain-link" onClick={clearFilters}>
                  Clear filters
                </button>
              </p>
            ) : index.data && view === "all" ? (
              <EmptyState title="No recipes yet" sub="Import a recipe with the agent and it lands here." />
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
