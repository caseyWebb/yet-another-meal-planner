// /data — the Data area's default view IS the Recipes list (the SSR `/admin/data` alias).
import { createFileRoute } from "@tanstack/react-router";
import { RecipesListScreen, validateRecipesSearch } from "../screens/data-recipes";

export const Route = createFileRoute("/data/")({
  validateSearch: validateRecipesSearch,
  component: DataIndexRoute,
});

function DataIndexRoute() {
  const search = Route.useSearch();
  return <RecipesListScreen search={search} />;
}
