// /discovery — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/discovery/")({
  component: () => <p className="screen-loading">Discovery</p>,
});
