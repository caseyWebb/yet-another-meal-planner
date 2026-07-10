# Page 13 — Profile: Account & security tab

Screens: `screens/profile-account.png`, `screens/tall-profile-account.png`.
Story: 01 (handles are the identity primitive).

## 1. Functional requirements

**Account card**: **Username** — @handle with inline Change (validation
`[a-z0-9_]{3,20}`, taken-check with inline errors); handle is a mutable display key over
stable member/tenant ids (story 01 §3). **Recovery email** (optional) — Add/Change,
empty-save clears; Unverified badge + "Resend verification" + "Verification link sent"
state; Verified badge; changing resets verification. Requires an email sender (none
exists today) and a defined recovery flow — in a passkey-first model, presumably
magic-link sign-in that permits enrolling a new passkey.

**Passkeys card**: Add passkey (exists); rows = device name, "Added {Mon YYYY} · Last
used {rel}", Remove → **cross-passkey removal ceremony**: "For your security, confirm
with a *different* passkey — a passkey can't authorize its own removal." The removal
ceremony requires a UV assertion. Chooser over other passkeys → waiting/error states;
**only-passkey guard**: removal impossible, "Add another passkey first — otherwise you'd
lock yourself out." Two lost-only-device flows keep the guard + ceremony from ever being
a lockout: the recovery-email magic-link path and the operator rotate() bootstrap. Every
passkey add AND remove notifies the verified recovery email when set. Honest threat
model: this is unattended-device protection, not session-compromise protection — a live
session can enroll a new passkey, so notification is the mitigation. Needs credential
metadata (names, created, last-used) persisted.

**Appearance card**: Light / Dark / **System** (tracks `prefers-color-scheme` live;
per-device, survives data purge as today).

**Your data card**: "Export my data" — a **synchronous streamed download** (D33): a
session-gated GET under the existing /api mount assembles the export in-request and
streams a zip (`yamp-export.zip · 2.4 MB`); friend-group data is single-digit MB. No
async job, no stored artifact, no retention question, no email dependency — the mock's
"we'll email you" copy drops (no sender exists); "preparing" is just the in-flight
request. Scope (ownership-based and lens-aware, never visibility-based): (a) the
member's own member-scoped data (notes incl. private — own only; cook log, favorites,
taste/preferences, own friend/follow edges, nicknames they SET, never nicknames set for
them); (b) household-shared operational state (pantry, plan, list, cook log, stores +
store notes, spend/waste events); (c) recipe bodies only for the household's own
imports/authored recipes. Never: friend-lens recipes (an export is a durable copy —
including them would nullify unfriending), other members' notes, shared derived caches,
or the curated set. The R2-fallback path (dedicated bucket + lifecycle TTL + an explicit
ARCHITECTURE.md amendment) applies only on a measured size failure. Any future
notification email is notification-only: no token, signed URL, or direct link.

**Connections & sessions card**: **Claude** — per-client MCP OAuth grants ("Claude.ai ·
This client", "Claude Code — Mac mini", … with device/location/last-active), per-row
Disconnect (revoke; hidden on current), **Disconnect all** (mock lacks a confirm — add
one; it revokes ALL of the member's MCP grants/tokens including the current client's,
touches nothing else). **Kroger** — Connected chip, "Last synced 12 min ago · {store}",
Disconnect/Reconnect (state exists; management here is new). **App sessions** —
signed-in browsers/devices with per-row Sign out + "Sign out all others" (all except
current). Metadata model: provider state stays in KV; sibling D1 metadata tables are
written at issuance/use (`mcp_grants_meta`, `web_sessions_meta`: tenant, member,
client/device label from parsed UA, created_at, last_active throttled like the session
re-put, coarse city-level geo from CF headers computed at issuance — never raw IP;
retained only on the live record, purged with the session/grant and on member
revocation). Revoke calls the existing KV deletion paths keyed from the metadata row;
metadata is advisory — a stale meta row can never authenticate.

No delete-account affordance exists in the mock — decide whether one is required (data
export exists; deletion is a productization-era question).

## 2. Delta vs today

Exists: passkey enrollment, single logout, Kroger badge, theme toggle (two-state).
New: username change, recovery email + mail infra, passkey management (list/metadata/
removal ceremony), System theme, streamed data export, grant/session metadata +
revocation UI, sign-out-others.

## 3. Open questions

1. Email infra choice and recovery-flow security model (magic link → passkey enroll) —
   resolved by 7c's planning-time spike (D25).
2. Handle-rename ripple (links, pending requests, `?tenant=` URLs) and old-handle
   reservation.
3. ~~Export scope + retention of the generated zip.~~ — decided (D33): ownership-scoped
   streamed download, no stored artifact, no retention (§1).
4. ~~Metadata collection stance (geo-IP coarseness, retention) for grants/sessions.~~ —
   decided: coarse city-level geo from CF headers at issuance, never raw IP; retained
   only on the live record, purged with the session/grant (§1).
5. Delete account: in or out of scope.
6. ~~Disconnect-all: session invalidation vs grant revocation semantics.~~ — decided:
   Disconnect all (Claude) revokes ALL of the member's MCP grants/tokens including the
   current client's, touches nothing else, and gains the missing confirm (mock bug);
   web sessions get their own "Sign out all others" (all except current) (§1).

Sequencing (D25): the 7a basics land any time on tenant-as-member identity; handle
rename + export scope wait for band 5 (D10); recovery email is blocked on the
outbound-sender spike.
