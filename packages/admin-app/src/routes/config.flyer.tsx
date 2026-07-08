// /config/flyer — the Kroger Flyer group (flyer knobs + flyer-terms editor).
import { createFileRoute } from "@tanstack/react-router";
import { ConfigFlyerScreen } from "../screens/config/flyer";

export const Route = createFileRoute("/config/flyer")({
  component: ConfigFlyerScreen,
});
