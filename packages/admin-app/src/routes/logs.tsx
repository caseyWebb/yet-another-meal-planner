// /logs — the all-cron-jobs run log (operator-admin). `?job=`/`?page=` are the SSR page's
// query params, defaults omitted from the URL (job "All", page 1 — the stripSearchParams
// middleware keeps navigation fully typed while the bare /logs stays the default view);
// `?run=<id>` is the Status sparkline's deep-link, resolved client-side against the payload.
import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { LogsScreen } from "../screens/logs";

const DEFAULTS = { job: "All", page: 1 };

export const Route = createFileRoute("/logs")({
  validateSearch: (s: Record<string, unknown>) => ({
    job: typeof s.job === "string" ? s.job : DEFAULTS.job,
    page: Number(s.page) >= 2 ? Math.floor(Number(s.page)) : DEFAULTS.page,
    run: typeof s.run === "string" ? s.run : undefined,
  }),
  search: { middlewares: [stripSearchParams(DEFAULTS)] },
  component: LogsScreen,
});
