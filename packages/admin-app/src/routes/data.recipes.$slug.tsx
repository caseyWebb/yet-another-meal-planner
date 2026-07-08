// /data/recipes/$slug — one recipe's cross-tier detail (full-width; the sub-nav hides).
import { createFileRoute } from "@tanstack/react-router";
import { RecipeDetailScreen } from "../screens/data-recipes";

export const Route = createFileRoute("/data/recipes/$slug")({
  component: DataRecipeDetailRoute,
});

function DataRecipeDetailRoute() {
  const { slug } = Route.useParams();
  return <RecipeDetailScreen slug={slug} />;
}
