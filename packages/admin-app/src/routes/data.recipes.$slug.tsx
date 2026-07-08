// /data/recipes/$slug — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/data/recipes/$slug")({
  component: () => <p className="screen-loading">RecipeDetail</p>,
});
