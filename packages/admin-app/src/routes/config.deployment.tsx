// /config/deployment — the Config area's Deployment group (profile flip + curated source).
import { createFileRoute } from "@tanstack/react-router";
import { ConfigDeploymentScreen } from "../screens/config/deployment";

export const Route = createFileRoute("/config/deployment")({
  component: ConfigDeploymentScreen,
});
