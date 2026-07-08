// /data — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/data/")({
  component: () => <p className="screen-loading">DataRecipes</p>,
});
