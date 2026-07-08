// /data/recipes — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/data/recipes/")({
  component: () => <p className="screen-loading">DataRecipesIndex</p>,
});
