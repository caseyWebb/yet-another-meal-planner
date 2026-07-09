// /members — the roster + the Invite codes sub-tab (`?tab=codes`). Stat tiles, invite dialog,
// per-row actions (roster); mint/list/revoke group codes (codes).
import { createFileRoute, stripSearchParams, type SearchSchemaInput } from "@tanstack/react-router";
import { MembersScreen, type MembersTab } from "../screens/members";

const DEFAULT_TAB: MembersTab = "roster";

export const Route = createFileRoute("/members/")({
  // `?tab=codes` opens the Invite-codes sub-tab; the default (roster) is omitted from the URL
  // so a bare /members stays canonical (defaults-omitted, mirroring discovery/normalize).
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => ({
    tab: s.tab === "codes" ? ("codes" as const) : DEFAULT_TAB,
  }),
  search: { middlewares: [stripSearchParams({ tab: DEFAULT_TAB })] },
  component: MembersRoute,
});

function MembersRoute() {
  const { tab } = Route.useSearch();
  return <MembersScreen tab={tab} />;
}
