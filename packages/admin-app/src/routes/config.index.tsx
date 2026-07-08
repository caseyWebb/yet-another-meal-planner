// /config — the Config area's Discovery default group (calibration + feeds + email sources).
import { createFileRoute } from "@tanstack/react-router";
import { ConfigDiscoveryScreen } from "../screens/config/discovery";

export const Route = createFileRoute("/config/")({
  component: ConfigDiscoveryScreen,
});
