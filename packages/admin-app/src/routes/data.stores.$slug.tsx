// /data/stores/$slug — one store's identity/SKU/notes detail (full-width; the sub-nav hides).
import { createFileRoute } from "@tanstack/react-router";
import { StoreDetailScreen } from "../screens/data-stores";

export const Route = createFileRoute("/data/stores/$slug")({
  component: DataStoreDetailRoute,
});

function DataStoreDetailRoute() {
  const { slug } = Route.useParams();
  return <StoreDetailScreen slug={slug} />;
}
