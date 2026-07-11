// /log → /retrospective (retrospective-shell): the cooking log became the default tab of
// the Retrospective page. The route survives only as a redirect so old links and bookmarks
// keep resolving.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/log")({
  beforeLoad: () => {
    throw redirect({ to: "/retrospective" });
  },
});
