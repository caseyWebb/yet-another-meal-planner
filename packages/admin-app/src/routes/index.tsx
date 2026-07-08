// Home (/admin) — the Status service-health view (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => <p className="screen-loading">Status</p>,
});
