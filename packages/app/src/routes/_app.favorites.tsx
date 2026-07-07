// Favorites (member-app-core 7.5): the caller's overlay favorites joined client-side
// to the cached cookbook index — the design bundle's favorites page, with its empty
// state for a heartless overlay.
import { createFileRoute } from "@tanstack/react-router";
import { EmptyState, IconHeart, PageHead } from "@grocery-agent/ui";
import { RecipeList } from "../components/recipe-list";
import { useIndex, useOverlay } from "../lib/data";

export const Route = createFileRoute("/_app/favorites")({
  component: FavoritesPage,
});

function FavoritesPage() {
  const overlay = useOverlay();
  const index = useIndex();
  const favSlugs = new Set(
    Object.entries(overlay.data?.overlay ?? {})
      .filter(([, row]) => row.favorite)
      .map(([slug]) => slug),
  );
  const recipes = (index.data?.recipes ?? []).filter((r) => favSlugs.has(r.slug));

  return (
    <div data-testid="favorites-page">
      <PageHead title="Favorites" sub={`${recipes.length} saved recipe${recipes.length === 1 ? "" : "s"}.`} />
      {overlay.data && index.data ? (
        recipes.length ? (
          <RecipeList recipes={recipes} />
        ) : (
          <EmptyState title="No favorites yet" sub="Tap the heart on any recipe to save it here." icon={<IconHeart />} />
        )
      ) : null}
    </div>
  );
}
