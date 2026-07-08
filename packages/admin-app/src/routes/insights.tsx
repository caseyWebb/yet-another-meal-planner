// /insights — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/insights")({
  component: () => <p className="screen-loading">Insights</p>,
});
