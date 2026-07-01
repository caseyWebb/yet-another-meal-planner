// The Ingest Keys island (recipe-ingestion): hydrates Config › Ingest Keys with the scraper
// key roster + the mint / revoke flows. Mirrors the Members island (members.tsx): the in-flight
// mutation + target + failure are ONE union (ActionState); the freshly-minted secret is a single
// `banner` variant shown once. Mutations call the typed /admin/api/* routes via hc<AdminApp>.

import { render, useState, useRef, useEffect } from "hono/jsx/dom";
import { hc } from "hono/client";
import type { AdminApp } from "../app.js";
import type { ScraperLiveness } from "../../ingest-db.js";
import { KeyIcon, TrashIcon } from "../ui/icons.js";

const client = hc<AdminApp>(location.origin);

type Op = { kind: "mint" } | { kind: "revoke"; id: string };
type ActionState =
  | { status: "idle" }
  | { status: "busy"; op: Op }
  | { status: "failed"; op: Op; message: string };

/** The one-time secret banner — present only right after a mint. */
type Banner = { label: string; secret: string; prefix: string };

function errMessage(body: unknown): string {
  if (body && typeof body === "object" && "message" in body) {
    const m = (body as Record<string, unknown>).message;
    if (typeof m === "string") return m;
  }
  return "Something went wrong.";
}

function relAge(at: number | null, now: number): string {
  if (at == null) return "never";
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 60) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function MintDialog({
  open,
  label,
  setLabel,
  busy,
  onSubmit,
  onClose,
}: {
  open: boolean;
  label: string;
  setLabel: (v: string) => void;
  busy: boolean;
  onSubmit: (e: Event) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog ref={ref} class="dialog" aria-labelledby="mint-key-title" onClose={onClose} onClick={(e: Event) => e.target === ref.current && onClose()}>
      <form onSubmit={onSubmit}>
        <header>
          <h2 id="mint-key-title">Mint ingest key</h2>
        </header>
        <section>
          <p class="muted small">Name the scraper machine this key is for. The secret is shown once after minting.</p>
          <div class="grid gap-2">
            <label class="label" for="mint-key-label">
              Label
            </label>
            <input
              class="input"
              id="mint-key-label"
              type="text"
              placeholder="home-nas-scraper"
              value={label}
              onInput={(e: Event) => setLabel((e.target as HTMLInputElement).value)}
            />
            <p class="muted small">A name for the scraper — lowercase, no spaces.</p>
          </div>
        </section>
        <footer class="form-actions">
          <button type="button" class="btn" data-variant="outline" data-size="sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="btn" data-size="sm" disabled={busy || !label.trim()}>
            Mint key
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function RevokeDialog({
  row,
  busy,
  onConfirm,
  onClose,
}: {
  row: ScraperLiveness | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (row && !el.open) el.showModal();
    else if (!row && el.open) el.close();
  }, [row]);
  return (
    <dialog ref={ref} class="dialog" aria-labelledby="revoke-key-title" onClose={onClose} onClick={(e: Event) => e.target === ref.current && onClose()}>
      <header>
        <h2 id="revoke-key-title">{row ? `Revoke ${row.label}?` : "Revoke key?"}</h2>
      </header>
      <section>
        <p class="muted small">
          The next push from this scraper will be rejected immediately. This can't be undone — mint a new key to reconnect the machine.
        </p>
      </section>
      <footer class="form-actions">
        <button type="button" class="btn" data-variant="outline" data-size="sm" onClick={onClose}>
          Cancel
        </button>
        <button type="button" class="btn" data-variant="destructive" data-size="sm" disabled={busy} onClick={onConfirm}>
          Revoke key
        </button>
      </footer>
    </dialog>
  );
}

function KeyRow({ s, now, busy, onRevoke }: { s: ScraperLiveness; now: number; busy: boolean; onRevoke: () => void }) {
  const revoked = s.status === "revoked";
  return (
    <tr class={revoked ? "cfg-key-revoked" : ""}>
      <td>
        <div class="item-title">{s.label}</div>
        <code class="muted small">{s.prefix}…</code>
      </td>
      <td>
        {s.sources.length === 0 ? (
          <span class="muted small">none yet</span>
        ) : (
          <span class="badge-row">
            {s.sources.map((src) => (
              <span class="badge" data-variant="outline">
                {src.name}
              </span>
            ))}
          </span>
        )}
      </td>
      <td class="muted small">{relAge(s.created, now)}</td>
      <td class="muted small">{relAge(s.lastPush, now)}</td>
      <td>
        <span class="badge" data-variant={revoked ? "outline" : "secondary"}>
          {s.status}
        </span>
      </td>
      <td>
        {revoked ? (
          <span class="muted small">revoked</span>
        ) : (
          <button type="button" class="btn" data-variant="ghost" data-size="sm" disabled={busy} onClick={onRevoke}>
            <TrashIcon size={13} /> Revoke
          </button>
        )}
      </td>
    </tr>
  );
}

function IngestKeysIsland(initial: { scrapers: ScraperLiveness[] }) {
  const [rows, setRows] = useState<ScraperLiveness[]>(initial.scrapers);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const [banner, setBanner] = useState<Banner | null>(null);
  const [confirm, setConfirm] = useState<ScraperLiveness | null>(null);
  const now = Date.now();
  const busy = action.status === "busy";

  async function refresh(): Promise<void> {
    const res = await client.admin.api.ingest.keys.$get();
    if (res.ok) setRows((await res.json()).scrapers);
  }

  async function doMint(e: Event): Promise<void> {
    e.preventDefault();
    if (!label.trim()) return;
    setAction({ status: "busy", op: { kind: "mint" } });
    const res = await client.admin.api.ingest.keys.$post({ json: { label } });
    if (res.ok) {
      const data = await res.json();
      setBanner({ label, secret: data.secret, prefix: data.prefix });
      setLabel("");
      setDialogOpen(false);
      setAction({ status: "idle" });
      await refresh();
    } else {
      setAction({ status: "failed", op: { kind: "mint" }, message: errMessage(await res.json()) });
    }
  }

  async function doRevoke(id: string): Promise<void> {
    setAction({ status: "busy", op: { kind: "revoke", id } });
    const res = await client.admin.api.ingest.keys[":id"].revoke.$post({ param: { id } });
    setConfirm(null);
    if (res.ok) {
      setAction({ status: "idle" });
      await refresh();
    } else {
      setAction({ status: "failed", op: { kind: "revoke", id }, message: errMessage(await res.json()) });
    }
  }

  return (
    <div>
      {banner ? (
        <div class="minted">
          <div class="minted-head">
            <strong>Ingest key minted · {banner.label}</strong>
            <button type="button" class="btn" data-variant="ghost" data-size="sm" onClick={() => setBanner(null)}>
              Dismiss
            </button>
          </div>
          <p class="once">Shown once — copy it now and store it in the scraper's config. You won't see this secret again; revoke and re-mint if it's lost.</p>
          <div class="row">
            <span class="k">secret</span>
            <span class="v">{banner.secret}</span>
          </div>
        </div>
      ) : null}
      {action.status === "failed" ? (
        <div class="alert" data-variant="destructive">
          <section>{action.message}</section>
        </div>
      ) : null}

      <div class="roster-head">
        <p class="group-label" style="margin:0">
          Keys
        </p>
        <button type="button" class="btn" data-size="sm" onClick={() => setDialogOpen(true)}>
          <KeyIcon size={14} /> Mint key
        </button>
      </div>

      {rows.length === 0 ? (
        <p class="muted">No ingest keys yet — mint one for your home scraper (a box on your network that logs in to a paid recipe site, extracts recipes, and pushes them here).</p>
      ) : (
        <div class="cfg-table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Scraper</th>
                <th>Sources</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <KeyRow s={s} now={now} busy={busy} onRevoke={() => setConfirm(s)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <MintDialog open={dialogOpen} label={label} setLabel={setLabel} busy={busy} onSubmit={doMint} onClose={() => setDialogOpen(false)} />
      <RevokeDialog row={confirm} busy={busy} onConfirm={() => confirm && doRevoke(confirm.id)} onClose={() => setConfirm(null)} />
    </div>
  );
}

const host = document.getElementById("ingest-keys-island");
const propsEl = document.getElementById("ingest-keys-props");
if (host && propsEl) {
  const props = JSON.parse(propsEl.textContent ?? "{}") as { scrapers: ScraperLiveness[] };
  host.replaceChildren();
  render(<IngestKeysIsland scrapers={props.scrapers} />, host);
}
