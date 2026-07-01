// The Discovery candidate-list island (operator-admin): hydrates #discovery-island with Retry /
// Delete for retryable and terminal candidate cards — the only mutations on the page (everything
// else is a pure SSR read, admin/CLAUDE.md rule 8). Relocated from `client/logs.tsx`'s Discovery
// row actions (admin-ui-redesign-discovery Decision 2): the candidate log's Retry/Delete now
// live here, reusing the SAME `/admin/api/discovery/:id/*` routes, unchanged in contract.
//
// The in-flight mutation + its target + its failure are ONE `ActionState` union (admin/CLAUDE.md
// rule 3), so "which candidate is acting", "which action", and "the error" cannot contradict and
// one-at-a-time falls out for free. On success the island reloads the page so the resolved/
// removed candidate — and the stat tiles / filter counts, which are derived from the same read —
// reflect immediately (matching the existing Logs island's reload-on-success behavior).

import { render, useState } from "hono/jsx/dom";
import { hc } from "hono/client";
import type { AdminApp } from "../app.js";
import type { DiscoveryCandidate } from "../../discovery-db.js";
import { DiscoveryView } from "../pages/discovery.js";

const client = hc<AdminApp>(location.origin);

type Op = { kind: "retry"; id: string } | { kind: "delete"; id: string };
type ActionState = { status: "idle" } | { status: "busy"; op: Op } | { status: "failed"; op: Op; message: string };

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

function DiscoveryIsland({
  initial,
  filter,
  page,
  now,
}: {
  initial: DiscoveryCandidate[];
  filter: string;
  page: number;
  now: number;
}) {
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const busyId = action.status === "busy" ? action.op.id : action.status === "failed" ? action.op.id : null;

  async function retry(id: string): Promise<void> {
    setAction({ status: "busy", op: { kind: "retry", id } });
    const res = await client.admin.api.discovery[":id"].retry.$post({ param: { id } });
    if (res.ok) location.reload();
    else setAction({ status: "failed", op: { kind: "retry", id }, message: await readError(res) });
  }

  async function del(id: string): Promise<void> {
    setAction({ status: "busy", op: { kind: "delete", id } });
    const res = await client.admin.api.discovery[":id"].$delete({ param: { id } });
    if (res.ok) location.reload();
    else setAction({ status: "failed", op: { kind: "delete", id }, message: await readError(res) });
  }

  // Delegate clicks on the SSR-shaped Retry/Delete buttons (rendered by the shared DiscoveryView
  // so the card markup — including the progression track and stage detail — stays one source of
  // truth between first paint and the hydrated re-render). The buttons live INSIDE <summary> (the
  // retry-clock/actions row is part of the always-visible collapsed-card content per the fidelity
  // pass), so a click on them would otherwise also toggle the native <details> disclosure —
  // `e.preventDefault()` here suppresses that default action (the browser's toggle-on-click for
  // <summary> is itself a preventDefault-able default action), leaving the disclosure toggle to
  // fire normally for every OTHER click on the summary. A data-action delegate keeps the handler
  // wiring in one place regardless of how deep the button is.
  function onListClick(e: Event): void {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest<HTMLElement>("[data-action]");
    if (!btn) return;
    const id = btn.getAttribute("data-id");
    if (!id) return;
    const busy = action.status === "busy";
    if (busy) return;
    e.preventDefault();
    if (btn.getAttribute("data-action") === "retry") void retry(id);
    else if (btn.getAttribute("data-action") === "delete") void del(id);
  }

  return (
    <div onClick={onListClick}>
      {action.status === "failed" ? (
        <div class="alert" data-variant="destructive">
          <section>
            {action.op.kind === "retry" ? "Retry" : "Delete"} failed: {action.message}
          </section>
        </div>
      ) : null}
      <DiscoveryView candidates={initial} filter={filter} page={page} now={now} />
      {busyId != null && action.status === "busy" ? <p class="muted small">Working…</p> : null}
    </div>
  );
}

const host = document.getElementById("discovery-island");
const propsEl = document.getElementById("discovery-props");
if (host && propsEl) {
  const props = JSON.parse(propsEl.textContent ?? "{}") as { candidates: DiscoveryCandidate[] };
  const url = new URL(location.href);
  const filter = url.searchParams.get("filter") ?? "all";
  const pageParam = Number(url.searchParams.get("page") ?? "1");
  const page = Number.isFinite(pageParam) && pageParam > 0 ? pageParam - 1 : 0;
  host.replaceChildren();
  render(<DiscoveryIsland initial={props.candidates} filter={filter} page={page} now={Date.now()} />, host);
}
