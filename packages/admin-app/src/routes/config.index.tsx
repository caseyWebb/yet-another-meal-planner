// /config — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/config/")({
  component: () => <p className="screen-loading">Config</p>,
});
