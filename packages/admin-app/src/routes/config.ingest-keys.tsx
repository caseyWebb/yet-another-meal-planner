// /config/ingest-keys — the satellite ingest-key roster (mint / revoke).
import { createFileRoute } from "@tanstack/react-router";
import { ConfigIngestKeysScreen } from "../screens/config/ingest-keys";

export const Route = createFileRoute("/config/ingest-keys")({
  component: ConfigIngestKeysScreen,
});
