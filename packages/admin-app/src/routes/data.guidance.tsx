// /data/guidance — the breadcrumb browser over the R2 guidance/** tree (`gpath` opens one
// object, `gprefix` lists a folder; both optional, so every state deep-links).
import { createFileRoute } from "@tanstack/react-router";
import { GuidanceScreen, validateGuidanceSearch } from "../screens/data-guidance";

export const Route = createFileRoute("/data/guidance")({
  validateSearch: validateGuidanceSearch,
  component: DataGuidanceRoute,
});

function DataGuidanceRoute() {
  const search = Route.useSearch();
  return <GuidanceScreen search={search} />;
}
