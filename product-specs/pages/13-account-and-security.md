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
with a *different* passkey — a passkey can't authorize its own removal." Chooser over
other passkeys → waiting/error states; **only-passkey guard**: removal impossible, "Add
another passkey first — otherwise you'd lock yourself out." Needs credential metadata
(names, created, last-used) persisted.

**Appearance card**: Light / Dark / **System** (tracks `prefers-color-scheme` live;
per-device, survives data purge as today).

**Your data card**: "Export my data" — **async export job** ("When it's ready it will be
available to download here. If your email address is set, we'll send you a message.") →
Download export (`yamp-export.zip · 2.4 MB`). Contents per copy: recipes, plans, cooking
log, pantry, preferences — define exact scope (household-shared data in a member export?
notes? match caches?).

**Connections & sessions card**: **Claude** — per-client MCP OAuth grants ("Claude.ai ·
This client", "Claude Code — Mac mini", … with device/location/last-active), per-row
Disconnect (revoke; hidden on current), **Disconnect all** (mock lacks a confirm — add
one). Requires grant metadata at token issuance/use. **Kroger** — Connected chip, "Last
synced 12 min ago · {store}", Disconnect/Reconnect (state exists; management here is
new). **App sessions** — signed-in browsers/devices with per-row Sign out + "Sign out
all others"; requires session records to carry device/geo/last-seen metadata and
enumerate-by-member.

No delete-account affordance exists in the mock — decide whether one is required (data
export exists; deletion is a productization-era question).

## 2. Delta vs today

Exists: passkey enrollment, single logout, Kroger badge, theme toggle (two-state).
New: username change, recovery email + mail infra, passkey management (list/metadata/
removal ceremony), System theme, async data export, grant/session metadata + revocation
UI, sign-out-others.

## 3. Open questions

1. Email infra choice and recovery-flow security model (magic link → passkey enroll).
2. Handle-rename ripple (links, pending requests, `?tenant=` URLs) and old-handle
   reservation.
3. Export scope + retention of the generated zip.
4. Metadata collection stance (geo-IP coarseness, retention) for grants/sessions.
5. Delete account: in or out of scope.
6. Disconnect-all: session invalidation vs grant revocation semantics; what the member
   sees in Claude afterward.
