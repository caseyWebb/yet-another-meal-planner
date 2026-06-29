// The Logs area (operator-admin), server-rendered with a client island for the row actions.
// Master/detail: a left submenu of log sources (currently just Discovery) and the discovery
// sweep's per-candidate outcome log on the right. SSR renders the entries (read by
// `readDiscoveryLog` directly) for first paint; the island hydrates them with per-row Retry /
// Delete and the detail dialog. The submenu is extensible — a future source is another entry.

import { Layout } from "../ui/layout.js";
import { outcomeClassWord, entryTitle } from "../logs-shared.js";
import type { DiscoveryLogRow } from "../../discovery-db.js";

function serializeProps(entries: DiscoveryLogRow[]): string {
  return JSON.stringify({ entries }).replace(/</g, "\\u003c");
}

/** The first-paint read-only entries list; the island replaces #logs-island with interactive rows. */
const EntriesList = ({ entries }: { entries: DiscoveryLogRow[] }) => (
  <div>
    <div class="log-head">
      <h2>Discovery</h2>
    </div>
    {entries.length === 0 ? (
      <p class="muted">No discovery activity yet.</p>
    ) : (
      <ul class="entry-list">
        {entries.map((e) => {
          const [cls, word] = outcomeClassWord(e.outcome);
          return (
            <li class="entry-row">
              <span class={`entry-outcome ${cls}`}>{word}</span>
              <span class="entry-title">{entryTitle(e)}</span>
              <span class="entry-source muted small">{e.source ?? ""}</span>
              <span class="entry-time muted small">{e.created_at ?? ""}</span>
            </li>
          );
        })}
      </ul>
    )}
  </div>
);

export const LogsPage = ({ entries }: { entries: DiscoveryLogRow[] }) => (
  <Layout title="Logs · grocery-agent admin" active="/admin/logs" wide>
    <div class="logs">
      <ul class="log-sources">
        <li class="log-source active">
          <a class="log-source-link" href="/admin/logs/discovery">
            Discovery
          </a>
        </li>
      </ul>
      <div id="logs-island">
        <EntriesList entries={entries} />
      </div>
    </div>
    <script
      type="application/json"
      id="logs-props"
      dangerouslySetInnerHTML={{ __html: serializeProps(entries) }}
    />
    <script type="module" src="/admin/islands/logs.js" />
  </Layout>
);

// Exported for unit tests.
export { EntriesList };
