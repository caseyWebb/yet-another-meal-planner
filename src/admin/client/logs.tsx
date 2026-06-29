// The Logs entries island (operator-admin): hydrates #logs-island with per-row Retry / Delete
// (error/failed rows only) and the detail dialog. The in-flight mutation + its target + its
// failure are ONE `RowAction` union, so "which row is acting", "which action", and "the error"
// cannot contradict and one-at-a-time is structural (admin/CLAUDE.md). A successful retry/delete
// reloads the page (re-SSRs the fresh log).

import { render, useState } from "hono/jsx/dom";
import { hc } from "hono/client";
import type { AdminApp } from "../app.js";
import type { DiscoveryLogRow } from "../../discovery-db.js";
import { outcomeClassWord, hasDetail, isRetryable, entryTitle } from "../logs-shared.js";

const client = hc<AdminApp>(location.origin);

type RowAction =
  | { kind: "retrying"; id: string }
  | { kind: "deleting"; id: string }
  | { kind: "failed"; id: string; action: "retry" | "delete"; error: string };

async function readError(res: { status: number; json: () => Promise<unknown> }): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body === "object" && "message" in body) {
      const m = (body as Record<string, unknown>).message;
      if (typeof m === "string") return m;
    }
  } catch {
    /* fall through */
  }
  return `HTTP ${res.status}`;
}

function DetailDialog({ entry, onClose }: { entry: DiscoveryLogRow; onClose: () => void }) {
  const rows: [string, string | null][] = [
    ["outcome", entry.outcome],
    ["url", entry.url],
    ["source", entry.source],
    ["imported as", entry.slug],
    ["at", entry.created_at],
  ];
  return (
    <div class="dialog-backdrop" onClick={onClose}>
      <div class="dialog" onClick={(e: Event) => e.stopPropagation()}>
        <div class="dialog-head">
          <h2>{entryTitle(entry)}</h2>
          <button class="link" onClick={onClose}>
            Close
          </button>
        </div>
        <div class="dialog-body">
          {rows
            .filter(([, v]) => v != null && v !== "")
            .map(([k, v]) => (
              <div class="row">
                <span class="k">{k}</span>
                <span class="v">{v}</span>
              </div>
            ))}
          <pre class="detail-blob">{JSON.stringify(entry.detail, null, 2)}</pre>
        </div>
      </div>
    </div>
  );
}

function LogsIsland({ entries }: { entries: DiscoveryLogRow[] }) {
  const [action, setAction] = useState<RowAction | null>(null);
  const [dialog, setDialog] = useState<DiscoveryLogRow | null>(null);
  const busy = action != null && action.kind !== "failed";

  async function retry(id: string): Promise<void> {
    setAction({ kind: "retrying", id });
    const res = await client.admin.api.discovery[":id"].retry.$post({ param: { id } });
    if (res.ok) location.reload();
    else setAction({ kind: "failed", id, action: "retry", error: await readError(res) });
  }

  async function del(id: string): Promise<void> {
    setAction({ kind: "deleting", id });
    const res = await client.admin.api.discovery[":id"].$delete({ param: { id } });
    if (res.ok) location.reload();
    else setAction({ kind: "failed", id, action: "delete", error: await readError(res) });
  }

  return (
    <div>
      <div class="log-head">
        <h2>Discovery</h2>
        <div class="log-actions">
          <button class="link" disabled={busy} onClick={() => location.reload()}>
            Refresh
          </button>
        </div>
      </div>
      {action != null && action.kind === "failed" ? (
        <div class="error">
          {action.action === "retry" ? "Retry" : "Delete"} failed: {action.error}
        </div>
      ) : null}
      {entries.length === 0 ? (
        <p class="muted">No discovery activity yet.</p>
      ) : (
        <ul class="entry-list">
          {entries.map((e) => {
            const [cls, word] = outcomeClassWord(e.outcome);
            const retryable = isRetryable(e.outcome);
            const detail = hasDetail(e);
            const openable = detail && !retryable;
            return (
              <li
                key={e.id}
                class={openable ? "entry-row has-detail" : "entry-row"}
                onClick={openable ? () => setDialog(e) : undefined}
              >
                <span class={`entry-outcome ${cls}`}>{word}</span>
                <span class="entry-title">{entryTitle(e)}</span>
                <span class="entry-source muted small">{e.source ?? ""}</span>
                <span class="entry-time muted small">{e.created_at ?? ""}</span>
                {retryable ? (
                  <span class="log-actions">
                    <button class="link" disabled={busy} onClick={() => retry(e.id)}>
                      {action != null && action.kind === "retrying" && action.id === e.id ? "Retrying…" : "Retry"}
                    </button>
                    <button class="danger" disabled={busy} onClick={() => del(e.id)}>
                      {action != null && action.kind === "deleting" && action.id === e.id ? "Deleting…" : "Delete"}
                    </button>
                  </span>
                ) : openable ? (
                  <span class="entry-more">details →</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {dialog != null ? <DetailDialog entry={dialog} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}

const host = document.getElementById("logs-island");
const propsEl = document.getElementById("logs-props");
if (host && propsEl) {
  const props = JSON.parse(propsEl.textContent ?? "{}") as { entries: DiscoveryLogRow[] };
  host.replaceChildren();
  render(<LogsIsland entries={props.entries} />, host);
}
