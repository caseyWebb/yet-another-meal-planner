// Home (/admin) — the Status service-health view.
import { createFileRoute } from "@tanstack/react-router";
import { StatusScreen } from "../screens/status";

export const Route = createFileRoute("/")({
  component: StatusScreen,
});
