// The Insights island (group-insights): hydrates #insights-island with the interactive dashboard.
// Window / sort / expanded-source are client state (admin/CLAUDE.md rule 8 permits in-surface
// state that doesn't navigate); every window's aggregates were precomputed server-side and seeded
// via the #insights-props block, so a toggle re-renders from data already on the page — no refetch.
// The dashboard markup is the SHARED `InsightsView` (one source of truth between first paint and
// this hydrated re-render), driven here with real callbacks the SSR pass omitted.

import { render, useState } from "hono/jsx/dom";
import { InsightsView } from "../pages/insights.js";
import type { InsightsPayload, WindowKey, SortKey } from "../../insights.js";

function InsightsIsland({ payload }: { payload: InsightsPayload }) {
  const [win, setWin] = useState<WindowKey>("all");
  const [sort, setSort] = useState<SortKey>("cooks");
  const [openSource, setOpenSource] = useState<string | null>(null);

  return (
    <InsightsView
      payload={payload}
      win={win}
      sort={sort}
      openSource={openSource}
      onWin={setWin}
      onSort={setSort}
      onToggleSource={(key) => setOpenSource(openSource === key ? null : key)}
      onFeedLink={() => {
        location.href = "/admin/config";
      }}
    />
  );
}

const host = document.getElementById("insights-island");
const propsEl = document.getElementById("insights-props");
if (host && propsEl) {
  const props = JSON.parse(propsEl.textContent ?? "{}") as { payload: InsightsPayload };
  host.replaceChildren();
  render(<InsightsIsland payload={props.payload} />, host);
}
