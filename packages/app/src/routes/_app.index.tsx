// Cookbook browse + in-place search (member-app-core 7.3 + member-app-differentiators
// D7-D9): the two P1 slots now render "New & trending" (new-for-me first, group
// trending backfill — deduped, capped, honest counts chip, EMPTY on sparse history)
// and "Picked for you" (the favorites-centroid ranking with its favorite-a-few empty
// state); the full-index "All recipes" section stays below as a third section (D9 —
// the only full-index browse over a real-sized corpus). Search behavior unchanged.
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, IconSearch, IconX, PageHead } from "@grocery-agent/ui";
import { RecipeList } from "../components/recipe-list";
import { useIndex, useNewForMe, usePickedForYou, useSearch, useTrending, type Hit } from "../lib/data";

/** Slot 1's cap (the mock's New & trending shows 8 rows before See-more territory). */
const NEW_TRENDING_CAP = 8;

export const Route = createFileRoute("/_app/")({
  component: CookbookPage,
});

function CookbookPage() {
  const [text, setText] = React.useState("");
  const [q, setQ] = React.useState("");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const index = useIndex();
  const newForMe = useNewForMe();
  const trending = useTrending();
  const picked = usePickedForYou();
  const search = useSearch(q);

  function onInput(v: string) {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setQ(v.trim()), 180); // the mock's debounce
  }
  function clear() {
    // Cancel any pending debounce — otherwise a clear clicked within the debounce
    // window is overwritten when the stale timer fires and re-applies the old query.
    if (timer.current) clearTimeout(timer.current);
    setText("");
    setQ("");
  }

  const searching = q.length > 0;
  const results = search.data?.results ?? [];
  const fresh = newForMe.data?.recipes ?? [];

  // Slot 1 (D9): new-for-me first (watermark semantics unchanged), then trending
  // backfill — deduped by slug, capped. Sparse group history means an EMPTY trending
  // set (the min-signal guard), so the row honestly renders new-for-me alone.
  const trendingRows = trending.data?.recipes ?? [];
  const freshSlugs = new Set(fresh.map((r) => r.slug));
  const backfill = trendingRows.filter((r) => !freshSlugs.has(r.slug));
  const newTrending: Hit[] = [...fresh, ...backfill].slice(0, NEW_TRENDING_CAP);
  // The honest counts chip rides ONLY genuinely-trending backfill rows — never
  // fabricated when the trending set is empty.
  const trendingBySlug = new Map(backfill.map((r) => [r.slug, r]));
  const annotateTrending = (slug: string): React.ReactNode => {
    const t = trendingBySlug.get(slug);
    if (!t) return null;
    return (
      <span className="facet trend-chip" data-testid="trending-chip">
        {t.cooks_by > 1 ? `cooked by ${t.cooks_by} members` : `cooked ${t.cooks}× recently`}
      </span>
    );
  };

  const picks = picked.data?.recipes ?? [];

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
        <button type="button" className="search-clear" aria-label="Clear search" onClick={clear}>
          <IconX />
        </button>
      </div>

      {searching ? (
        <div id="results" data-testid="search-results">
          {search.isLoading ? null : results.length === 0 ? (
            <EmptyState
              title="No matches"
              sub={`Nothing matches “${q}”. Try a protein, a cuisine, or an ingredient.`}
            />
          ) : (
            <>
              <p className="resultmeta">
                {results.length} result{results.length === 1 ? "" : "s"} for “<strong>{q}</strong>”
              </p>
              <RecipeList recipes={results} />
            </>
          )}
        </div>
      ) : (
        <div id="browse">
          <section className="browse-section" data-testid="new-trending">
            <div className="section-head">
              <h2>New &amp; trending</h2>
              <p>New for you since you last planned, plus what the group keeps cooking.</p>
            </div>
            {newTrending.length ? (
              <RecipeList recipes={newTrending} annotate={annotateTrending} />
            ) : (
              <p className="muted-line">Nothing new since your last plan.</p>
            )}
          </section>
          <section className="browse-section" data-testid="picked-for-you">
            <div className="section-head">
              <h2>Picked for you</h2>
              <p>From your favorites and what fits your preferences.</p>
            </div>
            {picks.length ? (
              <RecipeList recipes={picks} />
            ) : (
              <p className="muted-line">Favorite a few recipes and tailored picks show up here.</p>
            )}
          </section>
          <section className="browse-section" data-testid="all-recipes">
            <div className="section-head">
              <h2>All recipes</h2>
            </div>
            {index.data ? (
              index.data.recipes.length ? (
                <RecipeList recipes={index.data.recipes} />
              ) : (
                <EmptyState title="No recipes yet" sub="Import a recipe with the agent and it lands here." />
              )
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
