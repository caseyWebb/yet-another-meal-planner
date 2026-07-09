// The Members screen (operator-admin SPA): the roster + stat tiles + the invite dialog +
// per-row actions, ported from the SSR page (pages/members.tsx) and its island
// (client/members.tsx). One primary query (tenantsQuery) and ONE mutation whose variables
// are the island's `Op` union — `isPending` + `variables` ARE the ActionState, so
// one-at-a-time stays structural (src/admin/CLAUDE.md discipline). The once-shown invite /
// Kroger-consent banner keeps the island's `Banner` union (one field, two variants).
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Input,
  Label,
} from "@yamp/ui";
import { queryClient, tenantsQuery, type TenantRow } from "../lib/queries";
import { api, unwrap, apiErrorOf } from "../lib/api";
import { assertNever } from "../lib/assert";
import { InviteCodesScreen } from "./invite-codes";
import { Button, Badge, ErrorBanner, StatCardGrid, StatCard } from "../components/kit";
import {
  UsersIcon,
  CheckCircleIcon,
  ClockIcon,
  LinkIcon,
  KeyIcon,
  TrashIcon,
  MoreIcon,
  UserPlusIcon,
} from "../components/icons";

// The "show once" banner: either freshly-minted invite credentials or a single-use Kroger
// consent link for a member. One field, two variants — so the two banners can't both be set
// in contradictory ways (the island's `Banner` type, verbatim).
type Banner =
  | { kind: "invite"; username: string; invite_code: string; connector_url: string }
  | { kind: "kroger"; username: string; url: string };

// The one in-flight mutation's identity — the useMutation's `variables`, so the busy op and
// its target can never contradict (the island's `Op` union; onboard carries its username
// because the mutationFn needs it).
type Op =
  | { kind: "onboard"; username: string }
  | { kind: "rotate"; id: string }
  | { kind: "kroger"; id: string }
  | { kind: "revoke"; id: string };

/** Run one member op; returns the banner to show (revoke mints nothing). */
async function runOp(op: Op): Promise<Banner | null> {
  switch (op.kind) {
    case "onboard": {
      const data = await unwrap(api.admin.api.tenants.$post({ json: { username: op.username } }));
      return { kind: "invite", username: data.username, invite_code: data.invite_code, connector_url: data.connector_url };
    }
    case "rotate": {
      const data = await unwrap(api.admin.api.tenants[":id"].rotate.$post({ param: { id: op.id } }));
      return { kind: "invite", username: data.username, invite_code: data.invite_code, connector_url: data.connector_url };
    }
    case "kroger": {
      const data = await unwrap(api.admin.api.tenants[":id"]["kroger-login"].$post({ param: { id: op.id } }));
      return { kind: "kroger", username: op.id, url: data.url };
    }
    case "revoke": {
      await unwrap(api.admin.api.tenants[":id"].$delete({ param: { id: op.id } }));
      return null;
    }
    default:
      return assertNever(op);
  }
}

/** Coarse relative age with the roster's week/month buckets (the island's helper — the lib
 *  `relAge` caps at days, and the roster's meta line keeps its exact vocabulary). */
function rosterAge(deltaMs: number): string {
  const s = Math.max(0, Math.floor(deltaMs / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  const d = Math.floor(s / 86400);
  if (d < 14) return `${d}d ago`;
  if (d < 60) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

/** The roster's activity meta line: cooked/favorites + last-active age for an active member,
 *  invited age for a pending one (no activity counts to show yet). */
function metaLine(m: TenantRow, now: number): string {
  if (m.status === "active") {
    const active = m.lastActive != null ? `active ${rosterAge(now - m.lastActive)}` : "active";
    return `${m.cooked} recipes cooked · ${m.favorites} favorites · ${active}`;
  }
  // A pending member has no first-seen yet; joined doubles as "invited" until they connect.
  return m.joined != null ? `Invited ${rosterAge(now - m.joined)} · awaiting Claude.ai connection` : "Awaiting Claude.ai connection";
}

function counts(members: TenantRow[]) {
  return {
    total: members.length,
    active: members.filter((m) => m.status === "active").length,
    pending: members.filter((m) => m.status === "pending").length,
    kroger: members.filter((m) => m.kroger === "linked").length,
  };
}

/** One once-shown credential line: label + mono value + a clipboard copy button. */
const MintedRow = ({ label, value }: { label: string; value: string }) => (
  <div className="minted-row">
    <span className="minted-label">{label}</span>
    <code className="minted-code">{value}</code>
    <Button
      className="minted-copy"
      variant="outline"
      size="sm"
      onClick={() => void navigator.clipboard.writeText(value)}
    >
      Copy
    </Button>
  </div>
);

// A per-row actions menu (shared Radix DropdownMenu). `modal={false}` because a row actions
// menu must not trap the page: a modal Radix menu sets `pointer-events: none` on <body> so only
// the menu is interactive, and that lock is not reliably lifted on close — leaving the whole page
// click-dead. Non-modal is the right posture here and sidesteps the body-lock entirely (outside
// clicks still dismiss the menu; they now also pass through to whatever was clicked, which is fine
// for a row menu). The trigger's click is prevented/stopped so opening the menu never also
// navigates the row's wrapping link; the menu content renders in a portal, outside the link.
function RowMenu({
  m,
  busy,
  busyOp,
  onRotate,
  onKrogerLink,
  onRevoke,
}: {
  m: TenantRow;
  busy: boolean;
  busyOp: Op | null;
  onRotate: () => void;
  onKrogerLink: () => void;
  onRevoke: () => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Member actions"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <MoreIcon size={16} />
        </Button>
      </DropdownMenuTrigger>
      {/* The row is a <Link>; a menu-item click bubbles up the REACT tree (Radix portals the
          content in the DOM, but synthetic events still propagate to React ancestors) and would
          trigger the row's navigation. Stop it here so Rotate/Revoke run without leaving the page —
          the trigger button guards its own click the same way. */}
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem disabled={busy} onSelect={onRotate}>
          <KeyIcon size={13} /> {busyOp?.kind === "rotate" && busyOp.id === m.id ? "Rotating…" : "Rotate invite"}
        </DropdownMenuItem>
        {m.status === "active" ? (
          <DropdownMenuItem disabled={busy} onSelect={onKrogerLink}>
            <LinkIcon size={13} />{" "}
            {busyOp?.kind === "kroger" && busyOp.id === m.id ? "Minting…" : m.kroger === "linked" ? "Re-link Kroger" : "Link Kroger"}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem variant="destructive" disabled={busy} onSelect={onRevoke}>
          <TrashIcon size={13} />{" "}
          {busyOp?.kind === "revoke" && busyOp.id === m.id ? "Revoking…" : m.status === "pending" ? "Revoke invite" : "Revoke access"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
  m: TenantRow;
  now: number;
  busy: boolean;
  busyOp: Op | null;
  onRotate: () => void;
  onKrogerLink: () => void;
  onRevoke: () => void;
}) {
  return (
    <Link className="item-link" to="/members/$id" params={{ id: m.id }}>
      <div className="item item-outline">
        <figure className="item-media avatar avatar-lg" aria-hidden="true">
          {m.id.slice(0, 2).toUpperCase()}
        </figure>
        <section className="item-body">
          <div className="item-title member-head">
            {`@${m.id}`}
            {m.owner ? <Badge variant="secondary">owner</Badge> : null}
          </div>
          <div className="item-desc">{metaLine(m, now)}</div>
        </section>
        <aside className="item-actions">
          {m.kroger === "linked" ? (
            <Badge variant="secondary">
              <LinkIcon size={11} /> kroger
            </Badge>
          ) : null}
          <Badge variant={m.status === "active" ? "secondary" : "outline"}>{m.status}</Badge>
          <RowMenu m={m} busy={busy} busyOp={busyOp} onRotate={onRotate} onKrogerLink={onKrogerLink} onRevoke={onRevoke} />
        </aside>
      </div>
    </Link>
  );
}

function MembersView({ members }: { members: TenantRow[] }) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [username, setUsername] = React.useState("");
  const [banner, setBanner] = React.useState<Banner | null>(null);
  const [revokeTarget, setRevokeTarget] = React.useState<TenantRow | null>(null);
  const [now] = React.useState(() => Date.now());

  const action = useMutation({
    mutationFn: runOp,
    onSuccess: (minted, op) => {
      if (minted) setBanner(minted);
      if (op.kind === "onboard") {
        setUsername("");
        setDialogOpen(false);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["tenants"] }),
  });
  const busy = action.isPending;
  const busyOp = action.isPending ? action.variables : null;
  const c = counts(members);

  return (
    <div>
      <StatCardGrid>
        <StatCard icon={<UsersIcon size={15} />} label="Members" value={c.total} />
        <StatCard icon={<CheckCircleIcon size={15} />} label="Active" value={c.active} />
        <StatCard icon={<ClockIcon size={15} />} label="Pending" value={c.pending} />
        <StatCard icon={<LinkIcon size={15} />} label="Kroger linked" value={c.kroger} />
      </StatCardGrid>

      {banner ? (
        <div className="minted">
          <div className="minted-head">
            <strong>{banner.kind === "kroger" ? `Kroger consent link · @${banner.username}` : `Invite minted · @${banner.username}`}</strong>
            <Button variant="ghost" size="sm" onClick={() => setBanner(null)}>
              Dismiss
            </Button>
          </div>
          <p className="once">
            {banner.kind === "kroger"
              ? "Single-use, expires in ~10 minutes; never logged. Share it with the member to authorize Kroger."
              : "Shown once — copy it now. Share with the invitee to connect their Claude.ai."}
          </p>
          {banner.kind === "invite" ? (
            <>
              <MintedRow label="invite code" value={banner.invite_code} />
              <MintedRow label="connector" value={banner.connector_url} />
            </>
          ) : (
            <MintedRow label="consent url" value={banner.url} />
          )}
        </div>
      ) : null}
      {action.isError ? <ErrorBanner message={apiErrorOf(action.error)?.message ?? String(action.error)} /> : null}

      <div className="roster-head">
        <p className="group-label" style={{ margin: 0 }}>
          Roster
        </p>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <UserPlusIcon size={14} /> Invite member
        </Button>
      </div>

      {members.length === 0 ? (
        <p className="muted">No members yet.</p>
      ) : (
        <div className="item-group">
          {members.map((m) => (
            <RosterRow
              key={m.id}
              m={m}
              now={now}
              busy={busy}
              busyOp={busyOp}
              onRotate={() => action.mutate({ kind: "rotate", id: m.id })}
              onKrogerLink={() => action.mutate({ kind: "kroger", id: m.id })}
              onRevoke={() => setRevokeTarget(m)}
            />
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (busy || !username.trim()) return;
              action.mutate({ kind: "onboard", username });
            }}
          >
            <DialogHeader>
              <DialogTitle>Invite member</DialogTitle>
            </DialogHeader>
            <p className="muted small">Mint an invite code for someone in your friend group.</p>
            <div className="grid gap-2">
              <Label htmlFor="invite-username">Username</Label>
              <Input
                id="invite-username"
                type="text"
                placeholder="friend-handle"
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
              />
              <p className="muted small">Their tenant id — lowercase, no spaces. No email is sent.</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || !username.trim()}>
                Mint invite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={revokeTarget !== null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke member</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget?.status === "pending"
                ? `This removes @${revokeTarget?.id ?? ""} from the allowlist — their invite code stops working immediately.`
                : `This removes @${revokeTarget?.id ?? ""} from the allowlist — their Claude.ai connector loses access immediately.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (revokeTarget) action.mutate({ kind: "revoke", id: revokeTarget.id });
                setRevokeTarget(null);
              }}
            >
              {revokeTarget?.status === "pending" ? "Revoke invite" : "Revoke access"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export type MembersTab = "roster" | "codes";

export function MembersScreen({ tab = "roster" }: { tab?: MembersTab }): React.ReactElement {
  return (
    <>
      <div className="data-nav">
        <Link className={tab === "roster" ? "pill active" : "pill"} to="/members" search={{ tab: "roster" }}>
          Roster
        </Link>
        <Link className={tab === "codes" ? "pill active" : "pill"} to="/members" search={{ tab: "codes" }}>
          Invite codes
        </Link>
      </div>
      {tab === "roster" ? <RosterTab /> : <InviteCodesScreen />}
    </>
  );
}

function RosterTab(): React.ReactElement {
  const q = useQuery(tenantsQuery);
  switch (q.status) {
    case "pending":
      return <p className="screen-loading">Loading members…</p>;
    case "error":
      return <ErrorBanner message={apiErrorOf(q.error)?.message ?? String(q.error)} />;
    case "success":
      return <MembersView members={q.data.tenants} />;
    default:
      return assertNever(q);
  }
}
