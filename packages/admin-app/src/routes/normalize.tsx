// /normalize — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/normalize")({
  component: () => <p className="screen-loading">Normalize</p>,
});
