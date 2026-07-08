// /config/ranking — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/config/ranking")({
  component: () => <p className="screen-loading">ConfigRanking</p>,
});
