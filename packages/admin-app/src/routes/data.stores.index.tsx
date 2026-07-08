// /data/stores — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/data/stores/")({
  component: () => <p className="screen-loading">Stores</p>,
});
