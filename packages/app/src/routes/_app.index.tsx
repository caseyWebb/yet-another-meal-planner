// Cookbook browse + in-place search (member-app-core 7.3, D5/D6): "New for you"
// (the watermark-aware discovery read) + the all-recipes list, with the debounced
// keyword search swapping the browse sections for results — the design bundle's
// cookbook page, with the P4 trending/picked-for-you rows' slots taken by the P1
// sections (no ad-hoc approximations).
import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, IconSearch, IconX, PageHead } from "@grocery-agent/ui";
import { RecipeList } from "../components/recipe-list";
import { useIndex, useNewForMe, useSearch } from "../lib/data";

export const Route = createFileRoute("/_app/")({
  component: CookbookPage,
});

function CookbookPage() {
  const [text, setText] = React.useState("");
  const [q, setQ] = React.useState("");
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const index = useIndex();
  const newForMe = useNewForMe();
  const search = useSearch(q);

  function onInput(v: string) {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setQ(v.trim()), 180); // the mock's debounce
  }
  function clear() {
    setText("");
    setQ("");
  }

  const searching = q.length > 0;
  const results = search.data?.results ?? [];
  const fresh = newForMe.data?.recipes ?? [];

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
          <section className="browse-section" data-testid="new-for-you">
            <div className="section-head">
              <h2>New for you</h2>
              <p>Imported since you last planned — nothing here means nothing new.</p>
            </div>
            {fresh.length ? (
              <RecipeList recipes={fresh} />
            ) : (
              <p className="muted-line">Nothing new since your last plan.</p>
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
