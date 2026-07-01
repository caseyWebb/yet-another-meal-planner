// The Members island (operator-admin): hydrates the server-rendered #members-island with the
// interactive roster — clickable rows linking to `/admin/members/<id>` (navigation, not island
// state — design.md decision 2), a `Dialog`-based invite flow, and a per-row `DropdownMenu`
// (Rotate invite / Link Kroger / Revoke). Mutations call the typed `/admin/api/*` routes via
// `hc<AdminApp>` (zero codegen). The in-flight mutation + its target + its failure are ONE
// union (ActionState) so they cannot contradict and one-at-a-time is structural
// (admin/CLAUDE.md discipline, ported to TS).

import { render, useState, useRef, useEffect } from "hono/jsx/dom";
import { hc } from "hono/client";
import type { AdminApp } from "../app.js";
import type { MembersIslandProps } from "../shared.js";
import type { TenantRosterRow } from "../../admin.js";
import { LinkIcon, KeyIcon, TrashIcon, MoreIcon, UserPlusIcon } from "../ui/icons.js";

const client = hc<AdminApp>(location.origin);

// The "show once" banner: either freshly-minted invite credentials or a single-use Kroger
// consent link for a member. One field, two variants — so the two banners can't both be set
// in contradictory ways (admin/CLAUDE.md discipline, ported from the Elm `Minted` type).
type Banner =
  | { kind: "invite"; username: string; invite_code: string; connector_url: string }
  | { kind: "kroger"; username: string; url: string };

type Op =
  | { kind: "onboard" }
  | { kind: "rotate"; id: string }
  | { kind: "kroger"; id: string }
  | { kind: "revoke"; id: string };

type ActionState =
  | { status: "idle" }
  | { status: "busy"; op: Op }
  | { status: "failed"; op: Op; message: string };

function errMessage(body: unknown): string {
  if (body && typeof body === "object" && "message" in body) {
    const m = (body as Record<string, unknown>).message;
    if (typeof m === "string") return m;
  }
  return "Something went wrong.";
}

function relAge(deltaMs: number): string {
  const s = Math.max(0, Math.floor(deltaMs / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 14) return `${d}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

function metaLine(m: TenantRosterRow, now: number): string {
  if (m.status === "active") {
    const active = m.lastActive != null ? `active ${relAge(now - m.lastActive)}` : "active";
    return `${m.cooked} recipes cooked · ${m.favorites} favorites · ${active}`;
  }
  return m.joined != null ? `Invited ${relAge(now - m.joined)} · awaiting Claude.ai connection` : "Awaiting Claude.ai connection";
}

// The invite dialog: the native <dialog> element (Basecoat CSS-only, no Basecoat JS — see
// admin/CLAUDE.md › Styling), opened/closed imperatively via a ref + effect (the logs island's
// detail-dialog pattern).
function InviteDialog({
  open,
  username,
  setUsername,
  busy,
  onSubmit,
  onClose,
}: {
  open: boolean;
  username: string;
  setUsername: (v: string) => void;
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
    <dialog ref={ref} class="dialog" aria-labelledby="invite-dialog-title" onClose={onClose} onClick={(e: Event) => e.target === ref.current && onClose()}>
      <form onSubmit={onSubmit}>
        <header>
          <h2 id="invite-dialog-title">Invite member</h2>
        </header>
        <section>
          <p class="muted small">Mint an invite code for someone in your friend group.</p>
          <div class="grid gap-2">
            <label class="label" for="invite-username">
              Username
            </label>
            <input
              class="input"
              id="invite-username"
              type="text"
              placeholder="friend-handle"
              value={username}
              onInput={(e: Event) => setUsername((e.target as HTMLInputElement).value)}
            />
            <p class="muted small">Their tenant id — lowercase, no spaces. No email is sent.</p>
          </div>
        </section>
        <footer class="form-actions">
          <button type="button" class="btn" data-variant="outline" data-size="sm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="btn" data-size="sm" disabled={busy || !username.trim()}>
            Mint invite
          </button>
        </footer>
      </form>
    </dialog>
  );
}

// A per-row actions menu: a ghost icon-button trigger + a popover toggled by island state (no
// Basecoat component JS — see admin/CLAUDE.md › Styling). Stops propagation on every interior
// click so opening/using the menu never also navigates the row's wrapping link.
function RowMenu({
  m,
  busy,
  busyOp,
  onRotate,
  onKrogerLink,
  onRevoke,
}: {
  m: TenantRosterRow;
  busy: boolean;
  busyOp: Op | null;
  onRotate: () => void;
  onKrogerLink: () => void;
  onRevoke: () => void;
}) {
  const [open, setOpen] = useState(false);
  const stop = (fn: () => void) => (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    fn();
  };
  return (
    <div class="dropdown-menu" onClick={(e: Event) => e.stopPropagation()}>
      <button
        type="button"
        class="btn"
        data-variant="ghost"
        data-size="icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Member actions"
        onClick={() => setOpen((v) => !v)}
      >
        <MoreIcon size={16} />
      </button>
      <div class="dropdown-pop" role="menu" hidden={!open}>
        <button type="button" role="menuitem" class="menu-item" disabled={busy} onClick={stop(onRotate)}>
          <KeyIcon size={13} /> {busyOp?.kind === "rotate" && busyOp.id === m.id ? "Rotating…" : "Rotate invite"}
        </button>
        {m.status === "active" ? (
          <button type="button" role="menuitem" class="menu-item" disabled={busy} onClick={stop(onKrogerLink)}>
            <LinkIcon size={13} /> {busyOp?.kind === "kroger" && busyOp.id === m.id ? "Minting…" : m.kroger === "linked" ? "Re-link Kroger" : "Link Kroger"}
          </button>
        ) : null}
        <button type="button" role="menuitem" class="menu-item destructive" disabled={busy} onClick={stop(onRevoke)}>
          <TrashIcon size={13} /> {busyOp?.kind === "revoke" && busyOp.id === m.id ? "Revoking…" : m.status === "pending" ? "Revoke invite" : "Revoke access"}
        </button>
      </div>
    </div>
  );
}

function RosterRow({
  m,
  now,
  busy,
  busyOp,
  onRotate,
  onKrogerLink,
  onRevoke,
}: {
  m: TenantRosterRow;
  now: number;
  busy: boolean;
  busyOp: Op | null;
  onRotate: () => void;
  onKrogerLink: () => void;
  onRevoke: () => void;
}) {
  return (
    <a class="item-link" href={`/admin/members/${encodeURIComponent(m.id)}`}>
      <div class="item item-outline">
        <figure class="item-media avatar avatar-lg" aria-hidden="true">
          {m.id.slice(0, 2).toUpperCase()}
        </figure>
        <section class="item-body">
          <div class="item-title member-head">
            {`@${m.id}`}
            {m.owner ? (
              <span class="badge" data-variant="secondary">
                owner
              </span>
            ) : null}
          </div>
          <div class="item-desc">{metaLine(m, now)}</div>
        </section>
        <aside class="item-actions">
          {m.kroger === "linked" ? (
            <span class="badge" data-variant="secondary">
              <LinkIcon size={11} /> kroger
            </span>
          ) : null}
          <span class="badge" data-variant={m.status === "active" ? "secondary" : "outline"}>
            {m.status}
          </span>
          <RowMenu m={m} busy={busy} busyOp={busyOp} onRotate={onRotate} onKrogerLink={onKrogerLink} onRevoke={onRevoke} />
        </aside>
      </div>
    </a>
  );
}

function MembersIsland(initial: MembersIslandProps) {
  const [members, setMembers] = useState<TenantRosterRow[]>(initial.members);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [action, setAction] = useState<ActionState>({ status: "idle" });
  const [banner, setBanner] = useState<Banner | null>(null);
  const now = Date.now();

  const busy = action.status === "busy";
  const busyOp = action.status === "busy" ? action.op : null;

  async function refresh(): Promise<void> {
    const res = await client.admin.api.tenants.$get();
    if (res.ok) setMembers((await res.json()).tenants);
  }

  async function doOnboard(e: Event): Promise<void> {
    e.preventDefault();
    if (!username.trim()) return;
    setAction({ status: "busy", op: { kind: "onboard" } });
    const res = await client.admin.api.tenants.$post({ json: { username } });
    if (res.ok) {
      const data = await res.json();
      setBanner({ kind: "invite", username: data.username, invite_code: data.invite_code, connector_url: data.connector_url });
      setUsername("");
      setAction({ status: "idle" });
      setDialogOpen(false);
      await refresh();
    } else {
      setAction({ status: "failed", op: { kind: "onboard" }, message: errMessage(await res.json()) });
    }
  }

  async function doRotate(id: string): Promise<void> {
    setAction({ status: "busy", op: { kind: "rotate", id } });
    const res = await client.admin.api.tenants[":id"].rotate.$post({ param: { id } });
    if (res.ok) {
      const data = await res.json();
      setBanner({ kind: "invite", username: data.username, invite_code: data.invite_code, connector_url: data.connector_url });
      setAction({ status: "idle" });
    } else {
      setAction({ status: "failed", op: { kind: "rotate", id }, message: errMessage(await res.json()) });
    }
  }

  async function doKrogerLink(id: string): Promise<void> {
    setAction({ status: "busy", op: { kind: "kroger", id } });
    const res = await client.admin.api.tenants[":id"]["kroger-login"].$post({ param: { id } });
    if (res.ok) {
      const data = await res.json();
      setBanner({ kind: "kroger", username: id, url: data.url });
      setAction({ status: "idle" });
    } else {
      setAction({ status: "failed", op: { kind: "kroger", id }, message: errMessage(await res.json()) });
    }
  }

  async function doRevoke(id: string): Promise<void> {
    setAction({ status: "busy", op: { kind: "revoke", id } });
    const res = await client.admin.api.tenants[":id"].$delete({ param: { id } });
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
            <strong>{banner.kind === "kroger" ? `Kroger consent link · @${banner.username}` : `Invite minted · @${banner.username}`}</strong>
            <button type="button" class="btn" data-variant="ghost" data-size="sm" onClick={() => setBanner(null)}>
              Dismiss
            </button>
          </div>
          <p class="once">
            {banner.kind === "kroger"
              ? "Single-use, expires in ~10 minutes; never logged. Share it with the member to authorize Kroger."
              : "Shown once — copy it now. Share with the invitee to connect their Claude.ai."}
          </p>
          {banner.kind === "invite" ? (
            <>
              <div class="row">
                <span class="k">invite code</span>
                <span class="v">{banner.invite_code}</span>
              </div>
              <div class="row">
                <span class="k">connector</span>
                <span class="v">{banner.connector_url}</span>
              </div>
            </>
          ) : (
            <div class="row">
              <span class="k">consent url</span>
              <span class="v">{banner.url}</span>
            </div>
          )}
        </div>
      ) : null}
      {action.status === "failed" ? (
        <div class="alert" data-variant="destructive">
          <section>{action.message}</section>
        </div>
      ) : null}

      <div class="roster-head">
        <p class="group-label" style="margin:0">
          Roster
        </p>
        <button type="button" class="btn" data-size="sm" onClick={() => setDialogOpen(true)}>
          <UserPlusIcon size={14} /> Invite member
        </button>
      </div>

      {members.length === 0 ? (
        <p class="muted">No members yet.</p>
      ) : (
        <div class="item-group">
          {members.map((m) => (
            <RosterRow
              m={m}
              now={now}
              busy={busy}
              busyOp={busyOp}
              onRotate={() => doRotate(m.id)}
              onKrogerLink={() => doKrogerLink(m.id)}
              onRevoke={() => doRevoke(m.id)}
            />
          ))}
        </div>
      )}

      <InviteDialog
        open={dialogOpen}
        username={username}
        setUsername={setUsername}
        busy={busy}
        onSubmit={doOnboard}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}

const host = document.getElementById("members-island");
const propsEl = document.getElementById("members-props");
if (host && propsEl) {
  const props = JSON.parse(propsEl.textContent ?? "{}") as MembersIslandProps;
  host.replaceChildren();
  render(<MembersIsland members={props.members} />, host);
}
