// The Members screen (operator-admin SPA): the roster GROUPED BY HOUSEHOLD + stat tiles
// + the invite dialog + split household/member action menus (households-friends-and-
// people-page). One primary query (tenantsQuery) and ONE mutation whose variables are
// the `Op` union — `isPending` + `variables` ARE the ActionState, so one-at-a-time
// stays structural (src/admin/CLAUDE.md discipline). Household-level actions (Kroger
// link, Purge household) live on the group; member-level actions (Rotate invite,
// Revoke member) live on member rows. Single-member households — the common case —
// render COMPACTLY: one row carrying both affordance sets, whose destructive action is
// "Revoke access" mapping to household purge (the API's last-member refusal, mirrored).
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
  HomeIcon,
  CheckCircleIcon,
  ClockIcon,
  LinkIcon,
  KeyIcon,
  TrashIcon,
  MoreIcon,
  UserPlusIcon,
} from "../components/icons";

type MemberRow = TenantRow["members"][number];

// The "show once" banner: either freshly-minted invite credentials or a single-use Kroger
// consent link for a member. One field, two variants — so the two banners can't both be set
// in contradictory ways.
type Banner =
  | { kind: "invite"; username: string; invite_code: string; connector_url: string }
  | { kind: "kroger"; username: string; url: string };

// The one in-flight mutation's identity — the useMutation's `variables`, so the busy op and
// its target can never contradict. `rotate` optionally targets a non-founding member;
// `revokeMember` is the single-member half of the split lifecycle, `revoke` the purge.
type Op =
  | { kind: "onboard"; username: string }
  | { kind: "rotate"; id: string; member?: string }
  | { kind: "kroger"; id: string }
  | { kind: "revoke"; id: string }
  | { kind: "revokeMember"; id: string; member: string };

/** Run one lifecycle op; returns the banner to show (the revokes mint nothing). */
async function runOp(op: Op): Promise<Banner | null> {
  switch (op.kind) {
    case "onboard": {
      const data = await unwrap(api.admin.api.tenants.$post({ json: { username: op.username } }));
      return { kind: "invite", username: data.username, invite_code: data.invite_code, connector_url: data.connector_url };
    }
    case "rotate": {
      // Built as a variable (the hc idiom): the route reads its optional body directly,
      // so the typed client's args carry no `json` member.
      const args = { param: { id: op.id }, json: op.member ? { member: op.member } : {} };
      const data = await unwrap(api.admin.api.tenants[":id"].rotate.$post(args));
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
    case "revokeMember": {
      await unwrap(
        api.admin.api.tenants[":id"].members[":member"].$delete({ param: { id: op.id, member: op.member } }),
      );
      return null;
    }
    default:
      return assertNever(op);
  }
}

/** Coarse relative age with the roster's week/month buckets. */
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

/** The household activity meta line: cooked/favorites + last-active age for an active
 *  household, invited age for a pending one. */
function metaLine(m: TenantRow, now: number): string {
  if (m.status === "active") {
    const active = m.lastActive != null ? `active ${rosterAge(now - m.lastActive)}` : "active";
    return `${m.cooked} recipes cooked · ${m.favorites} favorites · ${active}`;
  }
  return m.joined != null ? `Invited ${rosterAge(now - m.joined)} · awaiting Claude.ai connection` : "Awaiting Claude.ai connection";
}

/** How many member rows a household renders (a pre-split tenant may have zero member
 *  rows until its lazy convergence — it still IS one member operationally). */
function memberCountOf(t: TenantRow): number {
  return Math.max(1, t.members.length);
}

function counts(tenants: TenantRow[]) {
  return {
    households: tenants.length,
    members: tenants.reduce((n, t) => n + memberCountOf(t), 0),
    active: tenants.filter((t) => t.status === "active").length,
    pending: tenants.filter((t) => t.status === "pending").length,
    kroger: tenants.filter((t) => t.kroger === "linked").length,
  };
}

/** The pending revoke confirmation's target — purge (whole household) or one member. */
type RevokeTarget =
  | { kind: "purge"; row: TenantRow }
  | { kind: "member"; tenant: string; member: MemberRow };

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
// menu must not trap the page (the Radix body pointer-events lock); the trigger's click is
// prevented/stopped so opening the menu never also navigates a wrapping row link.
function ActionsMenu({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          <MoreIcon size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A SINGLE-MEMBER household: one compact row carrying both the household and member
 *  affordances, so the regrouping adds no noise until a second member exists. Its
 *  destructive action is Revoke access = household purge (the last-member routing). */
function CompactHouseholdRow({
  t,
  now,
  busy,
  busyOp,
  act,
  onRevoke,
}: {
  t: TenantRow;
  now: number;
  busy: boolean;
  busyOp: Op | null;
  act: (op: Op) => void;
  onRevoke: (target: RevokeTarget) => void;
}) {
  return (
    <Link className="item-link" to="/members/$id" params={{ id: t.id }}>
      <div className="item item-outline" data-testid="household-row" data-household={t.id}>
        <figure className="item-media avatar avatar-lg" aria-hidden="true">
          {t.id.slice(0, 2).toUpperCase()}
        </figure>
        <section className="item-body">
          <div className="item-title member-head">
            {`@${t.id}`}
            {t.owner ? <Badge variant="secondary">owner</Badge> : null}
          </div>
          <div className="item-desc">{metaLine(t, now)}</div>
        </section>
        <aside className="item-actions">
          {t.kroger === "linked" ? (
            <Badge variant="secondary">
              <LinkIcon size={11} /> kroger
            </Badge>
          ) : null}
          <Badge variant={t.status === "active" ? "secondary" : "outline"}>{t.status}</Badge>
          <ActionsMenu label="Member actions">
            <DropdownMenuItem disabled={busy} onSelect={() => act({ kind: "rotate", id: t.id })}>
              <KeyIcon size={13} /> {busyOp?.kind === "rotate" && busyOp.id === t.id ? "Rotating…" : "Rotate invite"}
            </DropdownMenuItem>
            {t.status === "active" ? (
              <DropdownMenuItem disabled={busy} onSelect={() => act({ kind: "kroger", id: t.id })}>
                <LinkIcon size={13} />{" "}
                {busyOp?.kind === "kroger" && busyOp.id === t.id ? "Minting…" : t.kroger === "linked" ? "Re-link Kroger" : "Link Kroger"}
              </DropdownMenuItem>
            ) : null}
            {/* The only member's destructive action routes to household purge. */}
            <DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => onRevoke({ kind: "purge", row: t })}>
              <TrashIcon size={13} />{" "}
              {busyOp?.kind === "revoke" && busyOp.id === t.id ? "Revoking…" : t.status === "pending" ? "Revoke invite" : "Revoke access"}
            </DropdownMenuItem>
          </ActionsMenu>
        </aside>
      </div>
    </Link>
  );
}

/** A MULTI-MEMBER household group: the household header row (id, member count, badges,
 *  household-level actions) over its member rows (each with member-level actions). */
function HouseholdGroup({
  t,
  now,
  busy,
  busyOp,
  act,
  onRevoke,
}: {
  t: TenantRow;
  now: number;
  busy: boolean;
  busyOp: Op | null;
  act: (op: Op) => void;
  onRevoke: (target: RevokeTarget) => void;
}) {
  return (
    <div className="household-group" data-testid="household-group" data-household={t.id}>
      <Link className="item-link" to="/members/$id" params={{ id: t.id }}>
        <div className="item item-outline" data-testid="household-row" data-household={t.id}>
          <figure className="item-media avatar avatar-lg" aria-hidden="true">
            {t.id.slice(0, 2).toUpperCase()}
          </figure>
          <section className="item-body">
            <div className="item-title member-head">
              {`@${t.id}`}
              {t.owner ? <Badge variant="secondary">owner</Badge> : null}
              <Badge variant="outline" testId="household-count">
                {memberCountOf(t)} members
              </Badge>
            </div>
            <div className="item-desc">{metaLine(t, now)}</div>
          </section>
          <aside className="item-actions">
            {t.kroger === "linked" ? (
              <Badge variant="secondary">
                <LinkIcon size={11} /> kroger
              </Badge>
            ) : null}
            <Badge variant={t.status === "active" ? "secondary" : "outline"}>{t.status}</Badge>
            <ActionsMenu label="Household actions">
              {t.status === "active" ? (
                <DropdownMenuItem disabled={busy} onSelect={() => act({ kind: "kroger", id: t.id })}>
                  <LinkIcon size={13} />{" "}
                  {busyOp?.kind === "kroger" && busyOp.id === t.id ? "Minting…" : t.kroger === "linked" ? "Re-link Kroger" : "Link Kroger"}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => onRevoke({ kind: "purge", row: t })}>
                <TrashIcon size={13} /> {busyOp?.kind === "revoke" && busyOp.id === t.id ? "Purging…" : "Purge household"}
              </DropdownMenuItem>
            </ActionsMenu>
          </aside>
        </div>
      </Link>
      <div className="household-members">
        {t.members.map((m) => (
          <div className="item" data-testid="member-row" data-member={m.handle} key={m.id}>
            <figure className="item-media avatar" aria-hidden="true">
              {m.handle.slice(0, 2).toUpperCase()}
            </figure>
            <section className="item-body">
              <div className="item-title member-head">{`@${m.handle}`}</div>
              <div className="item-desc">
                {m.founding ? metaLine(t, now) : `joined ${rosterAge(now - m.joined)}`}
              </div>
            </section>
            <aside className="item-actions">
              <Badge variant={m.founding && t.status === "pending" ? "outline" : "secondary"}>
                {m.founding && t.status === "pending" ? "pending" : "active"}
              </Badge>
              <ActionsMenu label="Member actions">
                <DropdownMenuItem
                  disabled={busy}
                  onSelect={() => act({ kind: "rotate", id: t.id, ...(m.founding ? {} : { member: m.id }) })}
                >
                  <KeyIcon size={13} />{" "}
                  {busyOp?.kind === "rotate" && busyOp.id === t.id && (busyOp.member ?? t.id) === (m.founding ? t.id : m.id)
                    ? "Rotating…"
                    : "Rotate invite"}
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  disabled={busy}
                  onSelect={() => onRevoke({ kind: "member", tenant: t.id, member: m })}
                >
                  <TrashIcon size={13} />{" "}
                  {busyOp?.kind === "revokeMember" && busyOp.member === m.id ? "Revoking…" : "Revoke member"}
                </DropdownMenuItem>
              </ActionsMenu>
            </aside>
          </div>
        ))}
      </div>
    </div>
  );
}

function MembersView({ tenants }: { tenants: TenantRow[] }) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [username, setUsername] = React.useState("");
  const [banner, setBanner] = React.useState<Banner | null>(null);
  const [revokeTarget, setRevokeTarget] = React.useState<RevokeTarget | null>(null);
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
  const act = (op: Op) => action.mutate(op);
  const c = counts(tenants);

  return (
    <div>
      <StatCardGrid>
        <StatCard icon={<HomeIcon size={15} />} label="Households" value={c.households} />
        <StatCard icon={<UsersIcon size={15} />} label="Members" value={c.members} />
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

      {tenants.length === 0 ? (
        <p className="muted">No members yet.</p>
      ) : (
        <div className="item-group">
          {tenants.map((t) =>
            t.members.length > 1 ? (
              <HouseholdGroup key={t.id} t={t} now={now} busy={busy} busyOp={busyOp} act={act} onRevoke={setRevokeTarget} />
            ) : (
              <CompactHouseholdRow key={t.id} t={t} now={now} busy={busy} busyOp={busyOp} act={act} onRevoke={setRevokeTarget} />
            ),
          )}
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
                placeholder="friend_handle"
                value={username}
                onChange={(e) => setUsername(e.currentTarget.value)}
              />
              <p className="muted small">
                Their tenant id — 3–20 lowercase letters, numbers, underscores. No email is sent.
              </p>
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
            <AlertDialogTitle>{revokeTarget?.kind === "member" ? "Revoke member" : "Purge household"}</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget?.kind === "member"
                ? `This removes @${revokeTarget.member.handle} from @${revokeTarget.tenant}'s household — their passkeys, sessions, notes, and social rows go with them; the household and its other members stay.`
                : revokeTarget?.row.status === "pending"
                  ? `This removes @${revokeTarget?.row.id ?? ""} from the allowlist — their invite code stops working immediately.`
                  : `This removes @${revokeTarget?.row.id ?? ""}'s whole household — every member, their data, and their social graph. Their Claude.ai connectors lose access immediately.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (revokeTarget?.kind === "member") {
                  action.mutate({ kind: "revokeMember", id: revokeTarget.tenant, member: revokeTarget.member.id });
                } else if (revokeTarget) {
                  action.mutate({ kind: "revoke", id: revokeTarget.row.id });
                }
                setRevokeTarget(null);
              }}
            >
              {revokeTarget?.kind === "member"
                ? "Revoke member"
                : revokeTarget?.row.status === "pending"
                  ? "Revoke invite"
                  : "Revoke access"}
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
      return <MembersView tenants={q.data.tenants} />;
    default:
      return assertNever(q);
  }
}
