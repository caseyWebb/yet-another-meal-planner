// /usage — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/usage")({
  component: () => <p className="screen-loading">Usage</p>,
});
