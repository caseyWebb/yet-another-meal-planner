// /data/guidance — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/data/guidance")({
  component: () => <p className="screen-loading">Guidance</p>,
});
