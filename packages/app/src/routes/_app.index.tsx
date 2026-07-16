// Cookbook — ONE unified filterable list (member-app-core "Cookbook browse and keyword
// search" + member-app-differentiators' promoted panel): search bar → global filter bar
// → the "Recommended for you" panel → a flat title-sorted organic list. The panel
// repackages the three existing differentiator reads as reason badges — "Just Added"
// (new-for-me watermark), the cook signal (the guarded group read — "Trending" with
// today's chip copy under self-hosted; "Popular with Friends" with household-counted
// chip copy under SaaS; the trending read's `profile` conditions both), "Picked for
// You" (favorites centroid) — at most one row per signal, deduped out of the organic list.
// Under SaaS, a household with zero non-curated imports gets the cold-start onboarding
// (design request #11): the curated-floor panel above the badged curated list, or the
// true-zero empty treatment — filter bar and promoted panel hidden in both; retired by
// the first own import (derived) or an explicit household-level dismiss (preferences).
// Favorites is an in-page VIEW MODE (?view=favorites): same filters, panel hidden, its
// own empty copy — entered through the All recipes / Favorites tab row (the
// design-requests #1 bundle) between the search bar and the filter bar. All shareable
// state (query, filters, view) lives in validated URL search params with defaults
// stripped; only the un-debounced input text is local.
// Search keeps the debounce-against-API behavior (the mock's keystroke search is
// in-memory only — painted door).
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Link,
  createFileRoute,
  getRouteApi,
  stripSearchParams,
  type SearchSchemaInput,
} from "@tanstack/react-router";
import {
  Button,
  EmptyState,
  IconBook,
  IconHeart,
  IconHeartFill,
  IconSearch,
  IconSparkles,
  IconX,
  NativeSelect,
  PageHead,
  SegmentedControl,
} from "@yamp/ui";
import { ConnectClaudeModal } from "../components/connect-claude";
import { RecipeRow, RecipeList } from "../components/recipe-list";
import { patchPreferences } from "../lib/preferences";
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
  useProfile,
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

/** One promoted row: the hit plus its uppercase reason badge. The cook-signal reason is
 *  profile-conditioned (member-app-differentiators): "Trending" under self-hosted,
 *  "Popular with Friends" under SaaS — one signal, two labels. */
interface PromotedRow {
  hit: Hit;
  badge: "Just Added" | "Trending" | "Popular with Friends" | "Picked for You";
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

const appRoute = getRouteApi("/_app");

function CookbookPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  // The deployment profile + operator identity from the shell's whoami loader: the
  // profile gates the SaaS-only cold-start states (never rendered under self-hosted);
  // the operator templates the onboarding's Connect-to-Claude modal.
  const { profile: deployProfile, operator } = appRoute.useLoaderData();
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
  const memberProfile = useProfile();
  const qc = useQueryClient();
  const [connectOpen, setConnectOpen] = React.useState(false);

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
  function setView(v: "all" | "favorites") {
    void navigate({ search: (prev) => ({ ...prev, view: v }) });
  }

  const searching = q.length > 0;
  const active = filtersActive(filters);
  const indexHits = index.data?.recipes ?? [];
  const cuisineOptions = facetOptions(indexHits, "cuisine");
  const proteinOptions = facetOptions(indexHits, "protein");

  // Favorites view source (and the tab's count pill): the caller's overlay favorites
  // joined client-side to the cached index.
  const favSlugs = new Set(
    Object.entries(overlay.data?.overlay ?? {})
      .filter(([, row]) => row.favorite)
      .map(([slug]) => slug),
  );
  const favHits = indexHits.filter((r) => favSlugs.has(r.slug));

  // Honest trend chips (D31): rendered ONLY from the guarded trending read — wherever
  // the recipe is listed (panel or organic) — never fabricated when the set is empty.
  // Copy is profile-conditioned: self-hosted keeps today's member counts verbatim;
  // SaaS counts FRIEND HOUSEHOLDS (cooks_by counts non-caller households there), never
  // naming them or their members.
  const trendingRows = trending.data?.recipes ?? [];
  const trendingProfile = trending.data?.profile === "saas" ? "saas" : "self-hosted";
  const trendingBySlug = new Map(trendingRows.map((r) => [r.slug, r]));
  const trendChip = (slug: string): React.ReactNode => {
    const t = trendingBySlug.get(slug);
    if (!t) return null;
    return (
      <span className="facet trend-chip" data-testid="trending-chip">
        {trendingProfile === "saas"
          ? `cooked by ${t.cooks_by} friend household${t.cooks_by === 1 ? "" : "s"}`
          : t.cooks_by > 1
            ? `cooked by ${t.cooks_by} members`
            : `cooked ${t.cooks}× recently`}
      </span>
    );
  };

  // The promoted panel derives per render from the three existing reads. The cook
  // signal's label follows the trending read's profile: "Trending" under self-hosted
  // (unchanged), "Popular with Friends" under SaaS.
  const promoted = promoteRows(
    [
      { badge: "Just Added", rows: newForMe.data?.recipes ?? [] },
      { badge: trendingProfile === "saas" ? "Popular with Friends" : "Trending", rows: trendingRows },
      { badge: "Picked for You", rows: picked.data?.recipes ?? [] },
    ],
    filters,
  );

  // Cookbook cold-start (member-app-core, SaaS only — design request #11): while the
  // household owns ZERO non-curated imports (no hit with provenance "own" — a derived
  // condition, so the first own import retires it with no stored state) and has not
  // explicitly dismissed it (the household-level preferences flag), the browse view
  // renders the onboarding treatment: the curated-floor panel above the curated list,
  // or the true-zero empty treatment when no rows render at all. Never under
  // self-hosted; never in search mode or the favorites view. A missing `provenance`
  // (pre-lens Worker skew) reads as "own", so the states fail closed to today's page.
  const prefs = (memberProfile.data?.preferences ?? {}) as Record<string, unknown>;
  const customPrefs = (prefs.custom ?? {}) as Record<string, unknown>;
  const onboardingDismissed = customPrefs.cookbook_onboarding_dismissed === true;
  const ownsAny = indexHits.some((r) => (r.provenance ?? "own") === "own");
  const coldStart =
    deployProfile === "saas" &&
    index.data !== undefined &&
    memberProfile.data !== undefined &&
    !ownsAny &&
    !onboardingDismissed;
  const coldStartActive = coldStart && !searching && view === "all";
  const coldStartZero = coldStartActive && indexHits.length === 0;
  const coldStartFloor = coldStartActive && indexHits.length > 0;

  async function dismissOnboarding() {
    // Household-level persistence through the ONE preferences path (merge-patch under
    // If-Match): the flag rides `custom`, so a later change can clear it the same way.
    await patchPreferences(qc, { custom: { cookbook_onboarding_dismissed: true } });
  }

  const showPromoted = !searching && view === "all" && !coldStartActive && promoted.length > 0;
  // Dedupe promoted rows out of the organic list only while the panel actually
  // DISPLAYS them (hidden-panel states must not silently drop rows from the list).
  const promotedSlugs = showPromoted ? new Set(promoted.map((p) => p.hit.slug)) : new Set<string>();

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
        The view-mode tab row (design-requests #1's committed form): a SCOPE switch
        between the full cookbook and the favorites view — distinct from the
        AND-filters below, which stay mounted and apply inside it. The count pill is
        the member's TOTAL favorites (the unfiltered overlay∩index join — the same
        source the view lists), hidden at zero; the heart fills while active.
      */}
      <div className="viewtabs" role="tablist" aria-label="Cookbook view" data-testid="cookbook-viewtabs">
        <button type="button" role="tab" aria-selected={view === "all"} onClick={() => setView("all")}>
          All recipes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "favorites"}
          data-testid="favorites-tab"
          onClick={() => setView("favorites")}
        >
          {view === "favorites" ? <IconHeartFill /> : <IconHeart />}
          Favorites
          {favHits.length > 0 ? (
            <span className="vt-count" data-testid="favorites-tab-count">
              {favHits.length}
            </span>
          ) : null}
        </button>
      </div>

      {coldStartActive ? null : (
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
      )}

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
      ) : coldStartZero ? (
        // True-zero cold start (curated hidden or empty): the three cards carry the
        // page with the fuller empty treatment — no list, no filter bar, no panel.
        <EmptyState
          testId="cookbook-onboarding-zero"
          title="Your cookbook starts here"
          sub="Recipes you and your friends import all land in one place."
          icon={<IconBook />}
          action={
            <>
              <OnboardingCards
                connected={memberProfile.data?.initialized === true}
                onConnect={() => setConnectOpen(true)}
              />
              <Button type="button" variant="ghost" size="sm" data-testid="onboarding-dismiss" onClick={() => void dismissOnboarding()}>
                <IconX /> Dismiss
              </Button>
            </>
          }
        />
      ) : (
        <div id="browse">
          {coldStartFloor ? (
            // Curated-floor cold start: the onboarding panel above the curated list
            // (badged rows below; hearts and plan-toggles work on them immediately).
            <section className="promo-panel" data-testid="cookbook-onboarding">
              <div className="promo-cap">
                <IconSparkles /> Get your cookbook started
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  data-testid="onboarding-dismiss"
                  onClick={() => void dismissOnboarding()}
                >
                  <IconX /> Dismiss
                </Button>
              </div>
              <OnboardingCards
                connected={memberProfile.data?.initialized === true}
                onConnect={() => setConnectOpen(true)}
                onBrowseCurated={() =>
                  document.getElementById("cookbook-list")?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              />
            </section>
          ) : showPromoted ? (
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
          <section id="cookbook-list" data-testid="organic-list">
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
      <ConnectClaudeModal open={connectOpen} onOpenChange={setConnectOpen} operator={operator} />
    </div>
  );
}

/**
 * The cold-start onboarding's three compact action cards (design request #11, local
 * design per Decision 9 — existing card/button primitives only):
 *   1. Add friends — links the People destination (the nav stub the People change fills).
 *   2. Import with the agent — the Connect-to-Claude modal while the member's profile is
 *      not yet initialized (no agent session has ever set it up — the closest wire truth
 *      to "not yet connected"); once initialized, the paste-a-URL copy stands alone.
 *   3. Start from the curated set — anchor-scrolls to the curated list (curated-floor
 *      state only; the true-zero state has no list to scroll to).
 */
function OnboardingCards(props: {
  connected: boolean;
  onConnect: () => void;
  onBrowseCurated?: () => void;
}) {
  return (
    <div className="grid w-full gap-3 py-2 text-left sm:grid-cols-3" data-testid="onboarding-cards">
      <div className="card flex flex-col gap-2 rounded-xl border bg-card p-4" data-testid="onboarding-card-friends">
        <h3 className="text-sm font-semibold">Add friends</h3>
        <p className="text-sm text-muted-foreground">
          Friends' recipes flow into your cookbook — and yours into theirs.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-auto self-start">
          <Link to="/people">Open People</Link>
        </Button>
      </div>
      <div className="card flex flex-col gap-2 rounded-xl border bg-card p-4" data-testid="onboarding-card-agent">
        <h3 className="text-sm font-semibold">Import with the agent</h3>
        <p className="text-sm text-muted-foreground">
          {props.connected
            ? "Paste a recipe URL in a Claude chat — it lands in your cookbook."
            : "Connect to Claude, then paste any recipe URL in a chat — it lands here."}
        </p>
        {props.connected ? null : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-auto self-start"
            data-testid="onboarding-connect"
            onClick={props.onConnect}
          >
            Connect to Claude
          </Button>
        )}
      </div>
      <div className="card flex flex-col gap-2 rounded-xl border bg-card p-4" data-testid="onboarding-card-curated">
        <h3 className="text-sm font-semibold">Start from the curated set</h3>
        <p className="text-sm text-muted-foreground">
          Hearts and plan-toggles work on curated recipes right away.
        </p>
        {props.onBrowseCurated ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-auto self-start"
            data-testid="onboarding-browse-curated"
            onClick={props.onBrowseCurated}
          >
            Browse the curated set
          </Button>
        ) : null}
      </div>
    </div>
  );
}
