// /config/ingest-keys — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/config/ingest-keys")({
  component: () => <p className="screen-loading">IngestKeys</p>,
});
