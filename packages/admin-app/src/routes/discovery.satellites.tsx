// /discovery/satellites — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/discovery/satellites")({
  component: () => <p className="screen-loading">Satellites</p>,
});
