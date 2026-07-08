// The recipe list row (member-app-core): the design bundle's recipeRow — title /
// description / facet chips as the row link, with the plan-toggle and favorite
// actions on the right. Actions are EXPLICIT sets on the wire (D8): the row computes
// the target state from the cached overlay/plan and sends it.
import type * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  RecipeFacets,
  IconCalendar,
  IconHeart,
  IconHeartFill,
  toast,
} from "@grocery-agent/ui";
import { setFavorite, applyPlanOps, useOverlay, usePlan, type Hit } from "../lib/data";

export function RecipeRow({ recipe, annotation }: { recipe: Hit; annotation?: React.ReactNode }) {
  const qc = useQueryClient();
  const overlay = useOverlay();
  const plan = usePlan();
  const fav = Boolean(overlay.data?.overlay[recipe.slug]?.favorite);
  const planned = Boolean(plan.data?.planned.some((p) => p.recipe.toLowerCase() === recipe.slug.toLowerCase()));

  async function onPlanToggle() {
    try {
      await applyPlanOps(qc, [{ op: planned ? "remove" : "add", recipe: recipe.slug }]);
      toast(planned ? "Removed from meal plan" : "Added to meal plan");
    } catch {
      toast("Couldn't update the plan — try again");
    }
  }

  async function onFavorite() {
    try {
      await setFavorite(qc, recipe.slug, !fav);
    } catch {
      toast("Couldn't update favorites — try again");
    }
  }

  return (
    <li className="rrow" data-testid="recipe-row" data-slug={recipe.slug}>
      <Link className="rrow-link" to="/recipe/$slug" params={{ slug: recipe.slug }}>
        <span className="rtitle">{recipe.title}</span>
        {recipe.description ? <span className="rdesc">{recipe.description}</span> : null}
        <span className="rfacets">
          <RecipeFacets protein={recipe.protein} cuisine={recipe.cuisine} />
          {annotation ?? null}
        </span>
      </Link>
      <div className="rrow-actions">
        <button
          type="button"
          className={`plan-btn${planned ? " on" : ""}`}
          aria-pressed={planned}
          title={planned ? "In meal plan — remove" : "Add to meal plan"}
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
