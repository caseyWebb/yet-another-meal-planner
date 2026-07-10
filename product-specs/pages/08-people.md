# Page 08 — People

Screens: `screens/nav-people.png`, `screens/tall-people.png`.
Story: 01 (the model — tenant = household, friends = tenant links; read it first).

## 1. Design summary

"Everyone you cook alongside. Your household shares your pantry and meal plan; friends
trade recipes into your cookbook." Sections: Requests inbox → nickname hint → HOUSEHOLD →
FRIENDS, each with find/invite adders and awaiting-response lists.

**Profile gating (D9)**: under the self-hosted profile the FRIENDS section (and
friend-tier requests) is hidden — the page is household-only; nicknames still apply to
everyone in the deployment. The full page ships under the SaaS profile.

## 2. Functional requirements

**Requests inbox** (only when non-empty): rows = avatar initial, the **@handle ALWAYS**,
with any supplied display name beside it, never instead of it; HOUSEHOLD/FRIEND badge;
"wants to join your household" / "wants to be friends"; optional note rendered as inert
quoted plain text, length-capped (~200 chars), no links/markdown; relative time;
Accept / Decline. Household-accept adds the member to the tenant and seeds your nickname
for them from their supplied display name — the accept flow shows 'will be saved as
"{name}" (@handle) — edit'. Household-accept for a requester with an existing account
shows the not-carried-over list before completing (household state purged; member state
moves — the member-move + dissolution flow, D23). Friend-accept creates the tenant
link. Block affordances (D24) appear on inbox rows, awaiting-response rows, and friend
rows; decline is invisible to the requester (their row stays "Request sent"). **Sidebar
badge counts actionable pending inbound requests** (the mock's friend count is a listed
mock bug).

**Nickname hint** (always visible): "Name people the way you actually talk about them.
The assistant only knows handles — a name you set lets you refer to someone in plain
language when you chat." + live example composed from your actual nicknames ("Mom and
Grandma are coming to town — pick a crowd-pleaser."). Nicknames: per-viewer, others-only
(never self), inline edit, empty-save clears; never shown to the named person; loaded
into agent context only on the owning member's grant (story 01 §3); a member's export
includes nicknames they SET, never nicknames set FOR them (D33).

**HOUSEHOLD**: sub-label "N people share your pantry and meal plan."; member rows =
avatar (local color-picker popover — client-only personalization, keep out of backend),
name states (You / nickname + @handle / @handle + "Add a nickname"), remove (needs a
confirm + governance decision — mock removes instantly, anyone-removes-anyone). The
member list is also the reference set for meal-vibe member assignment (pages/10) and
propose's attendance input (D29) — nicknames are what make "kids are gone this weekend"
resolvable in chat.
**Find household members** split button: find-by-handle popover (exact @handle + optional
note, "Send request") | invite-link popover ("No account yet? Share your invite link —
when they join they're added to your household automatically."). **Awaiting response**:
outgoing rows ("Connection request sent" / "Invite link sent · hasn't joined yet") with
cancel.

**FRIENDS**: sub-label "N friends sharing M recipes into your cookbook." / "Invite people
to share recipes back and forth."; rows add a "N shared" chip; same nickname/remove
mechanics; find/invite adders with friend-tier copy; empty state "No friends yet — add
someone above; their shared recipes will show up in your cookbook."

**Invite links**: per-invite minted, carrying inviter + tier (+ expiry/one-time —
story 01 §3; the mock's single static link for both tiers is a mock bug). Copy-link with
"Copied!" feedback. Signup via link creates the account AND the relationship.

## 3. Delta vs today

Everything on this page is **new** (no requests, household members, friends, nicknames,
handles, or invite links exist). The primitives and their collisions with
`multi-tenancy`/`shared-corpus`/`self-service-signup` are story 01 §3–4.

## 4. Open questions (beyond story 01's)

1. Governance: who can remove a household member; leave-household; confirm dialogs.
2. ~~Request lifecycle UX: decline visibility to the requester, re-request after
   decline.~~ — decided (D24): decline is invisible (requester's row stays "Request
   sent" forever); a declined pair enters a ~30-day cooldown during which re-sends
   appear to succeed but deliver nothing; the outgoing cap counts every row the
   requester sees. Still open: the notification path (purely on-page? email if set?).
3. Cancel semantics for a sent invite link (revoke the link?).
4. Max household size; ~~can a member belong to only one household~~ — ratified: yes,
   one household per member, with D23 (member-move + dissolution) as its specced
   consequence.
5. Avatar colors: confirm client-local only (mock: localStorage).
