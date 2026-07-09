// The read-only recipe card (recipe-card-widget). Hydrated from the `display_recipe` tool's
// `structuredContent` (RecipeCardData), it reproduces the member app's recipe-detail surface
// — title, facet chips, total time + dietary, and the markdown body — inside a Card, reusing
// @yamp/ui primitives + the shared cookbook.css classes. READ-ONLY by design: no
// servings-scaling control and no per-step timer (that is the built-in recipe_display_v0's
// lane, and the reader provides no structured ingredients/steps anyway).
import type { RecipeCardData } from "@yamp/contract";
import {
  Card,
  CardContent,
  CardHeader,
  FacetChip,
  IconClock,
  RecipeFacets,
} from "@yamp/ui";
import { mdToHtml } from "./md";

export function RecipeCard({ recipe }: { recipe: RecipeCardData }) {
  const hasFacets =
    Boolean(recipe.protein) ||
    Boolean(recipe.cuisine) ||
    recipe.dietary.length > 0 ||
    (recipe.course?.length ?? 0) > 0 ||
    (recipe.tags?.length ?? 0) > 0 ||
    typeof recipe.time_total === "number";

  return (
    <div className="recipe-card-widget" data-widget="recipe-card">
      <Card>
        <CardHeader>
          <h1 data-testid="recipe-title">{recipe.title}</h1>
          {recipe.description ? <p className="detail-source">{recipe.description}</p> : null}
        </CardHeader>
        <CardContent>
          {hasFacets ? (
            <div className="detail-meta">
              <RecipeFacets protein={recipe.protein ?? null} cuisine={recipe.cuisine ?? null} />
              {recipe.course?.map((c) => (
                <FacetChip key={`course-${c}`}>{c}</FacetChip>
              ))}
              {recipe.dietary.map((d) => (
                <FacetChip key={`diet-${d}`}>{d}</FacetChip>
              ))}
              {recipe.tags?.map((t) => (
                <FacetChip key={`tag-${t}`}>{t}</FacetChip>
              ))}
              {typeof recipe.time_total === "number" ? (
                <span className="detail-time">
                  <IconClock /> {recipe.time_total} min
                </span>
              ) : null}
            </div>
          ) : null}
          {/* Escape-first markdown render (md.ts) — hydrated from structuredContent, no raw HTML. */}
          <div
            className="prose"
            data-testid="recipe-body"
            dangerouslySetInnerHTML={{ __html: mdToHtml(recipe.body) }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
