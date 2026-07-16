// People (households-friends-and-people-page, pages/08): the requests inbox, the
// nickname hint, HOUSEHOLD, the find/invite adders, Awaiting response, and — under the
// SaaS profile — FRIENDS with "N shared". The self-hosted variant is an ALTERNATE STATE
// of this same component (design request #12, locally designed under the recorded
// authorization): the friend surface and tier badges are absent, the header drops the
// friends clause, and the nickname hint sits beside HOUSEHOLD on wide viewports.
//
// Write classifications (member-app-offline): the inline nickname edit is the page's
// ONE class (b) write (queued offline, replays on the canonical (viewer, target) key);
// every other action here — send/accept/decline/cancel, block, unfriend, invite
// mint/revoke, leave/remove — is online-only and fails fast with the structured copy.
//
// D24 on this surface: awaiting rows all read "Request sent" (the payload carries no
// state), declines are locally unceremonious and remotely invisible, and blocking is
// silent. Avatar colors are CLIENT-LOCAL (localStorage, per the q5 ratification) —
// never sent to the backend.
import * as React from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  IconCopy,
  IconUsers,
  Input,
  PageHead,
  toast,
} from "@yamp/ui";
import { appFetch, apiError } from "../lib/api";
import { relAge } from "../lib/format";
import { usePeople, type PeopleInboxRow, type PeopleMember, type PeopleFriend, type PeopleTier } from "../lib/data";
import { useNicknameSet } from "../lib/mutations";
import { purgeLocalMemberData } from "../lib/persist";

export const Route = createFileRoute("/_app/people")({
  component: PeoplePage,
});

// --- client-local avatar colors (q5: browser storage only, never the backend) --------

const AVATAR_COLORS = ["#f4a259", "#84a98c", "#7d8cc4", "#c47d7d", "#b48ead", "#8fbcbb"] as const;

function avatarColor(memberId: string): string {
  try {
    return localStorage.getItem(`yamp:avatar:${memberId}`) ?? AVATAR_COLORS[0];
  } catch {
    return AVATAR_COLORS[0];
  }
}

function setAvatarColor(memberId: string, color: string): void {
  try {
    localStorage.setItem(`yamp:avatar:${memberId}`, color);
  } catch {
    // private-mode storage failures are fine — the color just won't persist
  }
}

// --- small shared plumbing -------------------------------------------------------------

async function peoplePost(path: string, body?: unknown): Promise<Response> {
  return appFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

async function peopleDelete(path: string, body?: unknown): Promise<Response> {
  return appFetch(path, {
    method: "DELETE",
    ...(body === undefined
      ? {}
      : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
}

function errMessage(err: unknown, fallback: string): string {
  const e = err as { message?: unknown } | null;
  return typeof e?.message === "string" && e.message ? e.message : fallback;
}

function PeoplePage() {
  const people = usePeople();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ["people"] });

  if (people.isPending) {
    return (
      <div data-testid="people-page">
        <PageHead title="People" sub="Loading…" />
      </div>
    );
  }
  if (people.isError || !people.data) {
    return (
      <div data-testid="people-page">
        <PageHead title="People" sub="Couldn't load your people right now." />
        <EmptyState title="Something went wrong" sub="Check your connection and try again." icon={<IconUsers />} />
      </div>
    );
  }

  const data = people.data;
  const saas = data.profile === "saas";
  const sharedTotal = data.friends.reduce((n, f) => n + f.shared, 0);

  return (
    <div data-testid="people-page" data-profile={data.profile}>
      <PageHead
        title="People"
        sub={
          saas
            ? "Everyone you cook alongside. Your household shares your pantry and meal plan; friends share recipes into your cookbook."
            : "Everyone you cook alongside. Your household shares your pantry and meal plan."
        }
      />

      {data.inbox.length > 0 ? <InboxSection rows={data.inbox} saas={saas} onChanged={refresh} /> : null}

      <div className={saas ? "people-body" : "people-body people-body-solo"}>
        <div className="people-main">
          <HouseholdSection data={data} onChanged={refresh} />
          {saas ? <FriendsSection friends={data.friends} sharedTotal={sharedTotal} onChanged={refresh} /> : null}
          <AwaitingSection data={data} saas={saas} onChanged={refresh} />
        </div>
        <NicknameHint members={data.members} friends={data.friends} />
      </div>
    </div>
  );
}

// --- the requests inbox -------------------------------------------------------------------

function InboxSection({ rows, saas, onChanged }: { rows: PeopleInboxRow[]; saas: boolean; onChanged: () => void }) {
  return (
    <section className="people-section" data-testid="people-inbox">
      <h2 className="group-label">Requests</h2>
      <div className="people-list">
        {rows.map((r) => (
          <InboxRow key={r.id} row={r} saas={saas} onChanged={onChanged} />
        ))}
      </div>
    </section>
  );
}

function InboxRow({ row, saas, onChanged }: { row: PeopleInboxRow; saas: boolean; onChanged: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [acceptOpen, setAcceptOpen] = React.useState(false);
  // The nickname seed moment: `will be saved as "{name}" (@handle) — edit`.
  const [seedName, setSeedName] = React.useState(row.display_name ?? "");
  const [manifest, setManifest] = React.useState<{ not_carried_over: string[]; reconnect: string } | null>(null);

  async function finishAccept(confirm: boolean) {
    setBusy(true);
    try {
      const res = await peoplePost(`/api/people/requests/${row.id}/accept`, confirm ? { confirm: true } : {});
      if (!res.ok) throw await apiError(res);
      const body = (await res.json()) as { status: "ok" | "confirm_required"; not_carried_over?: string[]; reconnect?: string };
      if (body.status === "confirm_required") {
        // The server-supplied D23 manifest — rendered, never client-authored.
        setManifest({ not_carried_over: body.not_carried_over ?? [], reconnect: body.reconnect ?? "" });
        return;
      }
      // Accepted. Apply the (possibly edited) nickname seed for the sender.
      const seeded = seedName.trim();
      if (seeded && seeded !== (row.display_name ?? "").trim()) {
        await appFetch(`/api/people/nicknames/${encodeURIComponent(row.from_member)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nickname: seeded }),
        }).catch(() => null); // best-effort — the server already seeded the original
      }
      setAcceptOpen(false);
      if (row.tier === "household") {
        // The member moved households: local member data belongs to the OLD household.
        toast("Welcome to your new household");
        await purgeLocalMemberData();
        router.clearCache();
        window.location.assign("/people");
        return;
      }
      toast(`You're now friends with @${row.from_handle}'s household`);
      onChanged();
    } catch (err) {
      toast(errMessage(err, "Couldn't accept the request — try again"));
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    setBusy(true);
    try {
      const res = await peoplePost(`/api/people/requests/${row.id}/decline`);
      if (!res.ok) throw await apiError(res);
      onChanged(); // locally unceremonious; the requester's view never changes
    } catch (err) {
      toast(errMessage(err, "Couldn't decline — try again"));
    } finally {
      setBusy(false);
    }
  }

  async function block() {
    setBusy(true);
    try {
      const res = await peoplePost("/api/people/blocks", { request_id: row.id });
      if (!res.ok) throw await apiError(res);
      toast("Blocked — they won't be able to reach your household");
      onChanged();
    } catch (err) {
      toast(errMessage(err, "Couldn't block — try again"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="people-item" data-testid="inbox-row" data-request-id={row.id}>
      <span className="people-avatar" style={{ background: avatarColor(row.from_member) }}>
        {row.from_handle.charAt(0).toUpperCase()}
      </span>
      <div className="people-item-main">
        <div className="people-item-name">
          {/* @handle ALWAYS — a display name renders beside it, never instead of it. */}
          <strong data-testid="inbox-handle">@{row.from_handle}</strong>
          {row.display_name ? <span className="people-dim">{row.display_name}</span> : null}
          {saas ? (
            <Badge variant="outline" data-testid="inbox-tier">
              {row.tier === "household" ? "HOUSEHOLD" : "FRIEND"}
            </Badge>
          ) : null}
        </div>
        <div className="people-item-sub">
          {row.tier === "household" ? "invites you to join their household" : "wants to be friends"}
          <span className="people-dim"> · {relAge(row.created_at)}</span>
        </div>
        {row.note ? (
          // Inert quoted plain text — never interpreted as links or markup.
          <blockquote className="people-note" data-testid="inbox-note">
            “{row.note}”
          </blockquote>
        ) : null}
      </div>
      <div className="people-item-actions">
        <Button size="sm" disabled={busy} data-testid="inbox-accept" onClick={() => setAcceptOpen(true)}>
          Accept
        </Button>
        <Button size="sm" variant="outline" disabled={busy} data-testid="inbox-decline" onClick={decline}>
          Decline
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} data-testid="inbox-block" onClick={block}>
          Block
        </Button>
      </div>

      <Dialog open={acceptOpen} onOpenChange={(o) => { setAcceptOpen(o); if (!o) setManifest(null); }}>
        <DialogContent data-testid="accept-dialog">
          <DialogHeader>
            <DialogTitle>
              {row.tier === "household" ? `Join @${row.from_handle}'s household?` : `Be friends with @${row.from_handle}'s household?`}
            </DialogTitle>
            <DialogDescription>
              {row.tier === "household"
                ? "You'll share their pantry, meal plan, and grocery list."
                : "Their shared recipes will show up in your cookbook, and yours in theirs."}
            </DialogDescription>
          </DialogHeader>
          {manifest ? (
            <div className="people-manifest" data-testid="accept-manifest">
              <p>These won't carry over from your current household:</p>
              <ul>
                {manifest.not_carried_over.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <p className="people-dim">{manifest.reconnect}</p>
            </div>
          ) : null}
          {row.display_name ? (
            <label className="people-seed" data-testid="accept-seed">
              <span>
                will be saved as “{seedName.trim() || row.display_name}” (@{row.from_handle}) — edit
              </span>
              <Input value={seedName} onChange={(e) => setSeedName(e.target.value)} maxLength={40} />
            </label>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAcceptOpen(false); setManifest(null); }}>
              Cancel
            </Button>
            <Button disabled={busy} data-testid="accept-confirm" onClick={() => finishAccept(manifest !== null)}>
              {manifest ? "Join household" : "Accept"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- the nickname hint ---------------------------------------------------------------------

function NicknameHint({ members, friends }: { members: PeopleMember[]; friends: PeopleFriend[] }) {
  // The live example composes the viewer's ACTUAL nicknames, falling back to a generic one.
  const names = [
    ...members.map((m) => m.nickname),
    ...friends.map((f) => f.nickname),
  ].filter((n): n is string => !!n);
  const example =
    names.length >= 2
      ? `“${names[0]} and ${names[1]} are coming to town — pick a crowd-pleaser.”`
      : names.length === 1
        ? `“${names[0]} is coming to town — pick a crowd-pleaser.”`
        : "“Mom and Grandma are coming to town — pick a crowd-pleaser.”";
  return (
    <aside className="people-hint" data-testid="nickname-hint">
      <h3>Nicknames</h3>
      <p>
        Nicknames are just for you — the person you name never sees them. Your assistant uses them too, so you can
        say things like <span data-testid="nickname-example">{example}</span>
      </p>
    </aside>
  );
}

// --- HOUSEHOLD -------------------------------------------------------------------------------

function HouseholdSection({ data, onChanged }: { data: NonNullable<ReturnType<typeof usePeople>["data"]>; onChanged: () => void }) {
  const members = data.members;
  return (
    <section className="people-section" data-testid="people-household">
      <div className="people-section-head">
        <div>
          <h2 className="group-label">Household</h2>
          <p className="people-dim">
            {members.length === 1
              ? "Just you so far — invite someone below."
              : `${members.length} people share your pantry and meal plan.`}
          </p>
        </div>
        <AdderSplit tier="household" onChanged={onChanged} />
      </div>
      <div className="people-list">
        {members.map((m) => (
          <MemberRow key={m.id} member={m} soleMember={members.length === 1} onChanged={onChanged} />
        ))}
      </div>
    </section>
  );
}

function MemberRow({ member, soleMember, onChanged }: { member: PeopleMember; soleMember: boolean; onChanged: () => void }) {
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const router = useRouter();

  async function remove() {
    setBusy(true);
    try {
      const res = await peoplePost(`/api/people/members/${encodeURIComponent(member.id)}/remove`);
      if (!res.ok) throw await apiError(res);
      toast(`@${member.handle} was moved to their own household`);
      setConfirmRemove(false);
      onChanged();
    } catch (err) {
      toast(errMessage(err, "Couldn't remove them — try again"));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    setBusy(true);
    try {
      const res = await peoplePost("/api/people/leave");
      if (!res.ok) throw await apiError(res);
      toast("You have your own household now");
      setConfirmRemove(false);
      // The session was re-keyed to the spawned household; local data belongs to the old one.
      await purgeLocalMemberData();
      router.clearCache();
      window.location.assign("/people");
    } catch (err) {
      toast(errMessage(err, "Couldn't leave — try again"));
      setBusy(false);
    }
  }

  return (
    <div className="people-item" data-testid="member-row" data-handle={member.handle}>
      <AvatarWithPicker memberId={member.id} handle={member.handle} />
      <div className="people-item-main">
        <div className="people-item-name">
          {member.you ? (
            <>
              <strong>@{member.handle}</strong>
              <Badge variant="secondary">You</Badge>
            </>
          ) : member.nickname ? (
            <>
              <strong data-testid="member-nickname">{member.nickname}</strong>
              <span className="people-dim">@{member.handle}</span>
            </>
          ) : (
            <strong>@{member.handle}</strong>
          )}
        </div>
        <div className="people-item-sub people-dim">joined {relAge(member.joined_at)}</div>
      </div>
      <div className="people-item-actions">
        {!member.you ? <NicknameEditor member={member} /> : null}
        {member.you ? (
          soleMember ? null : (
            <Button size="sm" variant="ghost" data-testid="member-leave" onClick={() => setConfirmRemove(true)}>
              Leave
            </Button>
          )
        ) : (
          <Button size="sm" variant="ghost" data-testid="member-remove" onClick={() => setConfirmRemove(true)}>
            Remove
          </Button>
        )}
      </div>

      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent data-testid="remove-dialog">
          <DialogHeader>
            <DialogTitle>{member.you ? "Leave this household?" : `Remove @${member.handle}?`}</DialogTitle>
            <DialogDescription>
              {member.you
                ? "You'll move into your own fresh household. Your passkeys, handle, and notes come with you; the pantry, plan, and cookbook stay here. You'll need to re-connect Claude.ai."
                : `They keep their account, passkeys, and notes, and move into their own fresh household. This household keeps its pantry, plan, and cookbook.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} data-testid="remove-confirm" onClick={member.you ? leave : remove}>
              {member.you ? "Leave household" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The avatar with its client-local color popover (localStorage only — q5). */
function AvatarWithPicker({ memberId, handle }: { memberId: string; handle: string }) {
  const [open, setOpen] = React.useState(false);
  const [color, setColor] = React.useState(() => avatarColor(memberId));
  const hostRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (hostRef.current && !hostRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className="people-avatar-host" ref={hostRef}>
      <button
        type="button"
        className="people-avatar"
        style={{ background: color }}
        aria-label={`Avatar color for @${handle}`}
        data-testid="avatar-button"
        onClick={() => setOpen((o) => !o)}
      >
        {handle.charAt(0).toUpperCase()}
      </button>
      {open ? (
        <div className="people-avatar-pop" role="menu" data-testid="avatar-popover">
          {AVATAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="menuitem"
              className="people-avatar-swatch"
              style={{ background: c }}
              aria-label={`Use ${c}`}
              onClick={() => {
                setAvatarColor(memberId, c);
                setColor(c);
                setOpen(false);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Inline nickname edit: the page's one class (b) write; empty-save clears. */
function NicknameEditor({ member }: { member: { id: string; nickname: string | null } }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(member.nickname ?? "");
  const nickname = useNicknameSet();

  function save() {
    nickname.mutate({ member: member.id, nickname: value });
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="people-link"
        data-testid="nickname-edit"
        onClick={() => {
          setValue(member.nickname ?? "");
          setEditing(true);
        }}
      >
        {member.nickname ? "Edit nickname" : "Add a nickname"}
      </button>
    );
  }
  return (
    <span className="people-nick-edit" data-testid="nickname-editor">
      <Input
        autoFocus
        value={value}
        maxLength={40}
        placeholder="Nickname (just for you)"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <Button size="sm" data-testid="nickname-save" onClick={save}>
        Save
      </Button>
    </span>
  );
}

// --- the find / invite split adder ------------------------------------------------------------

function AdderSplit({ tier, onChanged }: { tier: PeopleTier; onChanged: () => void }) {
  const [mode, setMode] = React.useState<null | "find" | "invite">(null);
  return (
    <div className="people-adder" data-testid={`adder-${tier}`}>
      <div className="people-adder-buttons">
        <Button size="sm" variant="outline" data-testid={`adder-${tier}-find`} onClick={() => setMode(mode === "find" ? null : "find")}>
          {tier === "household" ? "Find household members" : "Find friends"}
        </Button>
        <Button size="sm" variant="outline" data-testid={`adder-${tier}-invite`} onClick={() => setMode(mode === "invite" ? null : "invite")}>
          Invite link
        </Button>
      </div>
      {mode === "find" ? <FindPopover tier={tier} onDone={() => { setMode(null); onChanged(); }} /> : null}
      {mode === "invite" ? <InvitePopover tier={tier} onDone={onChanged} /> : null}
    </div>
  );
}

function FindPopover({ tier, onDone }: { tier: PeopleTier; onDone: () => void }) {
  const [handle, setHandle] = React.useState("");
  const [note, setNote] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [found, setFound] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function lookup() {
    setBusy(true);
    try {
      const res = await peoplePost("/api/people/lookup", { tier, handle });
      if (!res.ok) throw await apiError(res);
      const body = (await res.json()) as { found: boolean; handle?: string };
      if (!body.found) {
        setFound(null);
        toast("No member with that handle");
        return;
      }
      setFound(body.handle ?? handle);
    } catch (err) {
      toast(errMessage(err, "Couldn't look that up — try again"));
    } finally {
      setBusy(false);
    }
  }

  async function sendRequest() {
    setBusy(true);
    try {
      const res = await peoplePost("/api/people/requests", {
        tier,
        handle: found,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(displayName.trim() ? { display_name: displayName.trim() } : {}),
      });
      if (!res.ok) throw await apiError(res);
      toast("Request sent");
      onDone();
    } catch (err) {
      toast(errMessage(err, "Couldn't send the request — try again"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="people-pop" data-testid={`find-popover-${tier}`}>
      {found === null ? (
        <div className="people-pop-row">
          <Input
            autoFocus
            value={handle}
            placeholder="Exact @handle"
            aria-label="Exact handle"
            onChange={(e) => setHandle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && lookup()}
          />
          <Button size="sm" disabled={busy || !handle.trim()} data-testid="find-lookup" onClick={lookup}>
            Find
          </Button>
        </div>
      ) : (
        <div className="people-pop-found" data-testid="find-found">
          <p>
            <strong>@{found}</strong>{" "}
            {tier === "household" ? "will be invited to join your household." : "will get a friend request."}
          </p>
          <Input
            value={displayName}
            maxLength={40}
            placeholder="Introduce yourself (optional name)"
            aria-label="Your name for them"
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Input
            value={note}
            maxLength={200}
            placeholder="Add a note (optional)"
            aria-label="Request note"
            onChange={(e) => setNote(e.target.value)}
          />
          <Button size="sm" disabled={busy} data-testid="find-send" onClick={sendRequest}>
            Send request
          </Button>
        </div>
      )}
    </div>
  );
}

function InvitePopover({ tier, onDone }: { tier: PeopleTier; onDone: () => void }) {
  const [link, setLink] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function mint() {
    setBusy(true);
    try {
      const res = await peoplePost("/api/people/invites", { tier });
      if (!res.ok) throw await apiError(res);
      const body = (await res.json()) as { token: string };
      setLink(`${window.location.origin}/join/${body.token}`);
      onDone();
    } catch (err) {
      toast(errMessage(err, "Couldn't create the link — try again"));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // clipboard can be unavailable — the visible input still allows manual copy
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="people-pop" data-testid={`invite-popover-${tier}`}>
      {link === null ? (
        <div className="people-pop-row">
          <p className="people-dim">
            {tier === "household"
              ? "A single-use link that adds someone to your household. Expires in 14 days."
              : "A single-use link that makes their household friends with yours. Expires in 14 days."}
          </p>
          <Button size="sm" disabled={busy} data-testid="invite-mint" onClick={mint}>
            Create link
          </Button>
        </div>
      ) : (
        <div className="people-pop-row">
          <Input readOnly value={link} aria-label="Invite link" data-testid="invite-link" onFocus={(e) => e.target.select()} />
          <Button size="sm" data-testid="invite-copy" onClick={copy}>
            <IconCopy /> {copied ? "Copied!" : "Copy"}
          </Button>
        </div>
      )}
    </div>
  );
}

// --- FRIENDS (SaaS only) -----------------------------------------------------------------------

function FriendsSection({ friends, sharedTotal, onChanged }: { friends: PeopleFriend[]; sharedTotal: number; onChanged: () => void }) {
  return (
    <section className="people-section" data-testid="people-friends">
      <div className="people-section-head">
        <div>
          <h2 className="group-label">Friends</h2>
          <p className="people-dim">
            {friends.length === 0
              ? "Friend households share their cookbooks with yours."
              : `${friends.length} ${friends.length === 1 ? "friend" : "friends"} sharing ${sharedTotal} ${sharedTotal === 1 ? "recipe" : "recipes"} into your cookbook.`}
          </p>
        </div>
        <AdderSplit tier="friend" onChanged={onChanged} />
      </div>
      {friends.length === 0 ? (
        <EmptyState
          title="No friends yet"
          sub="Add someone above; their shared recipes will show up in your cookbook."
          icon={<IconUsers />}
        />
      ) : (
        <div className="people-list">
          {friends.map((f) => (
            <FriendRow key={f.tenant} friend={f} onChanged={onChanged} />
          ))}
        </div>
      )}
    </section>
  );
}

function FriendRow({ friend, onChanged }: { friend: PeopleFriend; onChanged: () => void }) {
  const [confirmUnfriend, setConfirmUnfriend] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  async function unfriend() {
    setBusy(true);
    try {
      const res = await peopleDelete(`/api/people/friends/${encodeURIComponent(friend.tenant)}`);
      if (!res.ok) throw await apiError(res);
      setConfirmUnfriend(false);
      onChanged(); // silent — the other household is never notified
    } catch (err) {
      toast(errMessage(err, "Couldn't unfriend — try again"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="people-item" data-testid="friend-row" data-tenant={friend.tenant}>
      <AvatarWithPicker memberId={friend.member.id} handle={friend.member.handle} />
      <div className="people-item-main">
        <div className="people-item-name">
          {friend.nickname ? (
            <>
              <strong data-testid="friend-nickname">{friend.nickname}</strong>
              <span className="people-dim">@{friend.member.handle}</span>
            </>
          ) : (
            <strong>@{friend.member.handle}</strong>
          )}
          <Badge variant="outline" data-testid="friend-shared">
            {friend.shared} shared
          </Badge>
        </div>
        <div className="people-item-sub people-dim">friends {relAge(friend.since)}</div>
      </div>
      <div className="people-item-actions">
        <NicknameEditor member={{ id: friend.member.id, nickname: friend.nickname }} />
        <Button size="sm" variant="ghost" data-testid="friend-unfriend" onClick={() => setConfirmUnfriend(true)}>
          Unfriend
        </Button>
      </div>

      <Dialog open={confirmUnfriend} onOpenChange={setConfirmUnfriend}>
        <DialogContent data-testid="unfriend-dialog">
          <DialogHeader>
            <DialogTitle>Unfriend @{friend.member.handle}'s household?</DialogTitle>
            <DialogDescription>
              Their recipes leave your cookbook and yours leave theirs. They won't be notified.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmUnfriend(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={busy} data-testid="unfriend-confirm" onClick={unfriend}>
              Unfriend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- Awaiting response ---------------------------------------------------------------------------

function AwaitingSection({
  data,
  saas,
  onChanged,
}: {
  data: NonNullable<ReturnType<typeof usePeople>["data"]>;
  saas: boolean;
  onChanged: () => void;
}) {
  const { requests, invites } = data.awaiting;
  if (requests.length === 0 && invites.length === 0) return null;
  return (
    <section className="people-section" data-testid="people-awaiting">
      <h2 className="group-label">Awaiting response</h2>
      <div className="people-list">
        {requests.map((r) => (
          <AwaitingRequestRow key={r.id} row={r} saas={saas} onChanged={onChanged} />
        ))}
        {invites.map((i) => (
          <AwaitingInviteRow key={i.token} row={i} saas={saas} onChanged={onChanged} />
        ))}
      </div>
    </section>
  );
}

function AwaitingRequestRow({
  row,
  saas,
  onChanged,
}: {
  row: { id: string; tier: PeopleTier; to_handle: string; created_at: number };
  saas: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState(false);

  async function act(kind: "cancel" | "block") {
    setBusy(true);
    try {
      const res =
        kind === "cancel"
          ? await peoplePost(`/api/people/requests/${row.id}/cancel`)
          : await peoplePost("/api/people/blocks", { request_id: row.id });
      if (!res.ok) throw await apiError(res);
      onChanged();
    } catch (err) {
      toast(errMessage(err, "Couldn't do that — try again"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="people-item" data-testid="awaiting-row" data-request-id={row.id}>
      <span className="people-avatar people-avatar-dim">{row.to_handle.charAt(0).toUpperCase()}</span>
      <div className="people-item-main">
        <div className="people-item-name">
          <strong>@{row.to_handle}</strong>
          {saas ? <Badge variant="outline">{row.tier === "household" ? "HOUSEHOLD" : "FRIEND"}</Badge> : null}
        </div>
        {/* Every awaiting row reads the same, whatever happened on the other side (D24). */}
        <div className="people-item-sub people-dim" data-testid="awaiting-status">
          Request sent · {relAge(row.created_at)}
        </div>
      </div>
      <div className="people-item-actions">
        <Button size="sm" variant="outline" disabled={busy} data-testid="awaiting-cancel" onClick={() => act("cancel")}>
          Cancel
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} data-testid="awaiting-block" onClick={() => act("block")}>
          Block
        </Button>
      </div>
    </div>
  );
}

function AwaitingInviteRow({
  row,
  saas,
  onChanged,
}: {
  row: { token: string; tier: PeopleTier; created_at: number; expires_at: number };
  saas: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const link = `${window.location.origin}/join/${row.token}`;

  async function cancel() {
    setBusy(true);
    try {
      const res = await peopleDelete(`/api/people/invites/${encodeURIComponent(row.token)}`);
      if (!res.ok) throw await apiError(res);
      onChanged(); // the visitor-side view is uniformly dead — revocation is oracle-free
    } catch (err) {
      toast(errMessage(err, "Couldn't cancel the link — try again"));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // clipboard unavailable — nothing else to do for a list row
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="people-item" data-testid="awaiting-invite" data-token={row.token}>
      <span className="people-avatar people-avatar-dim">
        <IconCopy />
      </span>
      <div className="people-item-main">
        <div className="people-item-name">
          <strong>Invite link</strong>
          {saas ? <Badge variant="outline">{row.tier === "household" ? "HOUSEHOLD" : "FRIEND"}</Badge> : null}
        </div>
        <div className="people-item-sub people-dim">created {relAge(row.created_at)} · single-use</div>
      </div>
      <div className="people-item-actions">
        <Button size="sm" variant="outline" data-testid="awaiting-invite-copy" onClick={copy}>
          {copied ? "Copied!" : "Copy link"}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} data-testid="awaiting-invite-cancel" onClick={cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
