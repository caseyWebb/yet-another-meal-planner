// /data/stores/$slug — placeholder (screen lands with group 3).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/data/stores/$slug")({
  component: () => <p className="screen-loading">StoreDetail</p>,
});
