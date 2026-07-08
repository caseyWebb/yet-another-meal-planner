// /data/recipes — the Recipes list (search + mode + page/size ride the URL, defaults omitted).
import { createFileRoute } from "@tanstack/react-router";
import { RecipesListScreen, validateRecipesSearch } from "../screens/data-recipes";

export const Route = createFileRoute("/data/recipes/")({
  validateSearch: validateRecipesSearch,
  component: DataRecipesIndexRoute,
});

function DataRecipesIndexRoute() {
  const search = Route.useSearch();
  return <RecipesListScreen search={search} />;
}
