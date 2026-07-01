// The Email Sources island (operator-admin, Discovery group) — a presentation-layer
// consolidation of the `members` and `senders` shared-corpus tables into ONE interleaved
// list, each row tagged "member" (someone in the friend group) or "automated forward" (a
// third-party newsletter/service set up to auto-forward here). No schema change: this is
// two D1 reads/writes behind one list (design.md Decision 5) — `isCorpusTable`/
// `admin-corpus.ts` are untouched. Adding/removing a row routes to the correct underlying
// table (`/admin/api/corpus/members` or `/admin/api/corpus/senders`) based on the row's own
// `kind` (for remove) or the add form's selected `kind` (for add) — never the other way
// around, so a "member" add can't land in `senders` or vice versa. Refetches BOTH tables
// after any add/remove (admin/CLAUDE.md's "refetch, don't locally patch" rule), so the
// merged list is always the authoritative server state.

import { render, useState } from "hono/jsx/dom";
import { hc } from "hono/client";
import type { AdminApp } from "../app.js";
import { Badge, RemoveButton } from "../ui/kit.js";

const client = hc<AdminApp>(location.origin);

type Kind = "member" | "automated";

interface Row {
  address: string;
  kind: Kind;
}

interface CorpusPage {
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
}

type Op = { op: "add" } | { op: "remove"; kind: Kind; address: string };
type Action = { t: "idle" } | { t: "busy"; op: Op } | { t: "failed"; op: Op; error: string };

async function readErr(res: { status: number; json: () => Promise<unknown> }): Promise<string> {
  const b = (await res.json().catch(() => null)) as { message?: string } | null;
  return b?.message ?? `HTTP ${res.status}`;
}

function toRows(kind: Kind, page: CorpusPage): Row[] {
  return page.rows.map((r) => ({ address: String(r.address ?? ""), kind }));
}

function EmailSourcesIsland({ members, senders }: { members: CorpusPage; senders: CorpusPage }) {
  const [rows, setRows] = useState<Row[]>([...toRows("member", members), ...toRows("automated", senders)]);
  const [draft, setDraft] = useState<{ address: string; kind: Kind }>({ address: "", kind: "member" });
  const [action, setAction] = useState<Action>({ t: "idle" });

  const busy = action.t === "busy";

  async function refetch(): Promise<void> {
    const [m, s] = await Promise.all([
      client.admin.api.corpus[":table"].$get({ param: { table: "members" } }),
      client.admin.api.corpus[":table"].$get({ param: { table: "senders" } }),
    ]);
    const next: Row[] = [];
    if (m.ok) next.push(...toRows("member", (await m.json()) as CorpusPage));
    if (s.ok) next.push(...toRows("automated", (await s.json()) as CorpusPage));
    setRows(next);
  }

  function tableFor(kind: Kind): "members" | "senders" {
    return kind === "member" ? "members" : "senders";
  }

  async function add(): Promise<void> {
    const address = draft.address.trim();
    if (!address) return;
    setAction({ t: "busy", op: { op: "add" } });
    const res = await client.admin.api.corpus[":table"].$post({ param: { table: tableFor(draft.kind) }, json: { address } });
    if (res.ok) {
      setDraft({ address: "", kind: draft.kind });
      setAction({ t: "idle" });
      await refetch();
    } else {
      setAction({ t: "failed", op: { op: "add" }, error: await readErr(res) });
    }
  }

  async function remove(row: Row): Promise<void> {
    setAction({ t: "busy", op: { op: "remove", kind: row.kind, address: row.address } });
    const res = await client.admin.api.corpus[":table"][":key"].$delete({
      param: { table: tableFor(row.kind), key: row.address },
    });
    if (res.ok) {
      setAction({ t: "idle" });
      await refetch();
    } else {
      setAction({ t: "failed", op: { op: "remove", kind: row.kind, address: row.address }, error: await readErr(res) });
    }
  }

  return (
    <div class="cfg-corpus">
      <p class="cfg-help muted small">
        Mail forwarded from these addresses skips taste-matching and is imported directly. <strong>Members</strong> are
        people in your group sharing recipes they like; <strong>automated forwards</strong> are third-party newsletters or
        services you've set up to forward here.
      </p>

      {action.t === "failed" ? (
        <div class="alert" data-variant="destructive">
          <section>
            {action.op.op === "add" ? "Add" : "Remove"} failed: {action.error}
          </section>
        </div>
      ) : null}

      <div class="item-group ai-list">
        {rows.map((row) => (
          <div class="item ai-row">
            <section class="item-body">
              <span class="ai-addr">{row.address}</span>
            </section>
            <aside class="item-actions">
              <Badge variant="outline">{row.kind === "member" ? "member" : "automated"}</Badge>
              <RemoveButton disabled={busy} onClick={() => remove(row)} />
            </aside>
          </div>
        ))}
      </div>

      <div class="cfg-add">
        <span class="cfg-add-label">Add address</span>
        <div class="cfg-add-fields">
          <input
            class="input cfg-add-wide"
            type="text"
            placeholder="email address"
            aria-label="email address"
            value={draft.address}
            onInput={(e: Event) => setDraft({ ...draft, address: (e.target as HTMLInputElement).value })}
          />
          <select
            class="input cfg-add-norm"
            value={draft.kind}
            onChange={(e: Event) => setDraft({ ...draft, kind: (e.target as HTMLSelectElement).value as Kind })}
          >
            <option value="member">member</option>
            <option value="automated">automated forward</option>
          </select>
          <button class="btn" data-size="sm" disabled={busy} onClick={add}>
            {busy && action.t === "busy" && action.op.op === "add" ? "adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

const host = document.getElementById("email-sources-island");
const propsEl = document.getElementById("email-sources-props");
if (host && propsEl) {
  const props = JSON.parse(propsEl.textContent ?? "{}") as { members: CorpusPage; senders: CorpusPage };
  host.replaceChildren();
  render(<EmailSourcesIsland members={props.members} senders={props.senders} />, host);
}
