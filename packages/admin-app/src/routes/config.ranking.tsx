// /config/ranking — the Ranking group (ranking-weights knob console).
import { createFileRoute } from "@tanstack/react-router";
import { ConfigRankingScreen } from "../screens/config/ranking";

export const Route = createFileRoute("/config/ranking")({
  component: ConfigRankingScreen,
});
