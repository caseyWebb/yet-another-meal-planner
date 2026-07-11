// The recipe list row (member-app-core): the design bundle's recipeRow — title /
// description / facet chips as the row link, with the plan-toggle and favorite
// actions on the right. Actions are EXPLICIT sets on the wire (D8): the row computes
// the target state from the cached overlay/plan and sends it.
import type * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  RecipeFacets,
  IconCalendar,
  IconHeart,
  IconHeartFill,
  toast,
} from "@yamp/ui";
import { useOverlay, usePlan, type Hit } from "../lib/data";
import { usePlanOps, useSetFavorite } from "../lib/mutations";

export function RecipeRow({
  recipe,
  annotation,
  promoBadge,
}: {
  recipe: Hit;
  annotation?: React.ReactNode;
  /** The promoted panel's uppercase reason badge ("Just Added" / "Trending" /
   *  "Picked for You") — absent on ordinary rows. */
  promoBadge?: string;
}) {
  const overlay = useOverlay();
  const plan = usePlan();
  const planOps = usePlanOps();
  const favorite = useSetFavorite();
  const fav = Boolean(overlay.data?.overlay[recipe.slug]?.favorite);
  const planned = Boolean(plan.data?.planned.some((p) => p.recipe.toLowerCase() === recipe.slug.toLowerCase()));

  function onPlanToggle() {
    // Registry mutation (fire-and-forget): errors toast via the registered defaults.
    planOps.mutate(
      { ops: [{ op: planned ? "remove" : "add", recipe: recipe.slug }] },
      { onSuccess: () => toast(planned ? "Removed from meal plan" : "Added to meal plan") },
    );
  }

  function onFavorite() {
    // EXPLICIT set (never a toggle — D8), optimistic via the registered defaults.
    favorite.mutate({ slug: recipe.slug, favorite: !fav });
  }

  return (
    <li className="rrow" data-testid="recipe-row" data-slug={recipe.slug}>
      <Link className="rrow-link" to="/recipe/$slug" params={{ slug: recipe.slug }}>
        {promoBadge ? (
          <span className="rpromo" data-testid="reason-badge">
            {promoBadge}
          </span>
        ) : null}
        <span className="rtitle">{recipe.title}</span>
        {recipe.description ? <span className="rdesc">{recipe.description}</span> : null}
        <span className="rfacets">
          <RecipeFacets protein={recipe.protein} cuisine={recipe.cuisine} timeTotal={recipe.time_total} />
          {annotation ?? null}
        </span>
      </Link>
      <div className="rrow-actions">
        <button
          type="button"
          className={`plan-btn${planned ? " on" : ""}`}
          aria-pressed={planned}
          title={planned ? "On your “Want To Cook” list — remove" : "Add to my “Want To Cook” list"}
          data-testid="row-plan-toggle"
          onClick={onPlanToggle}
        >
          <IconCalendar />
        </button>
        <button
          type="button"
          className={`fav-btn${fav ? " on" : ""}`}
          aria-pressed={fav}
          title={fav ? "Unfavorite" : "Favorite"}
          data-testid="row-fav"
          onClick={onFavorite}
        >
          {fav ? <IconHeartFill /> : <IconHeart />}
        </button>
      </div>
    </li>
  );
}

export function RecipeList({
  recipes,
  annotate,
}: {
  recipes: Hit[];
  /** Optional per-row annotation (the New & trending row's honest counts chip). */
  annotate?: (slug: string) => React.ReactNode;
}) {
  return (
    <ul className="recipes">
      {recipes.map((r) => (
        <RecipeRow key={r.slug} recipe={r} annotation={annotate?.(r.slug)} />
      ))}
    </ul>
  );
}
