// /logs — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/logs")({
  component: () => <p className="screen-loading">Logs</p>,
});
