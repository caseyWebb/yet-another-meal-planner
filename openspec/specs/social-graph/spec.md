# social-graph Specification

## Purpose
TBD - created by archiving change households-friends-and-people-page. Update Purpose after archive.
## Requirements
### Requirement: Friendships are symmetric accepted-only household edges that feed the lens seam

The Worker SHALL maintain friendships as a D1 `friendships` table storing each edge exactly once as a canonically ordered tenant pair (`tenant_a < tenant_b`, enforced by a CHECK constraint, with the originating member recorded), accessed only through `src/db.ts`. A `friendships` row SHALL exist only for an ACCEPTED friendship — pending state lives in the request table, never here — so the relation is accepted-only by construction. The named friend-relation seam provider in the visibility module SHALL read this table (the union of both orientations for the queried tenant), replacing the empty relation the lens change shipped, with NO change to any lens consumer, to the seam's stated contract (symmetric, accepted-only edges, keyed by tenant), or to the `shared-corpus` spec. Because visibility is a live lens, creating an edge SHALL make both households' cookbooks visible to each other immediately, and severing it SHALL hide them immediately. Severing (unfriend) SHALL be available to any member of either household and SHALL NOT notify the other household. A friend household's "N shared" count SHALL be its own `recipe_imports` row count (D27: the whole household cookbook is the share scope; curated-tenant rows never inflate it).

#### Scenario: Accepting a friend request grants immediate mutual visibility

- **WHEN** a member of household B accepts a pending friend request from household A
- **THEN** exactly one canonically ordered `friendships` row exists for {A, B}, and on the next lens evaluation each household's members see the other household's cookbook through the unchanged seam provider

#### Scenario: Unfriending hides immediately and silently

- **WHEN** any member of household A severs the friendship with household B
- **THEN** the edge row is deleted, B's recipes leave A's lens (and vice versa) on the next read, and no notification of any kind reaches household B

#### Scenario: The edge is unduplicable and never self-referential

- **WHEN** an accept path attempts to write an edge that already exists in either orientation, or an edge from a household to itself
- **THEN** the canonical-pair primary key and CHECK constraint make the duplicate and the self-edge unrepresentable

#### Scenario: Shared count is the friend household's cookbook size

- **WHEN** the People page reads friend household B that owns N `recipe_imports` rows
- **THEN** B's row reports "N shared", with curated-tenant grants contributing nothing

### Requirement: Handle lookup is exact-match and enumeration-bounded

The Worker SHALL expose member lookup by EXACT @handle only — no browse, search, prefix, or fuzzy access to the member directory exists on any member surface. Exact-handle existence disclosure is accepted (the signup "username taken" precedent); ENUMERATION SHALL be bounded instead: lookup rides the shared fixed-window KV limiter keyed per-member AND per-client-IP (placeholder budget 30 lookups/hour on each key; tuned at implementation), and request-send rides the same limiter per-member AND per-IP (placeholder 10 sends/day each), fail-open on limiter storage errors, answering over-limit calls with a structured `rate_limited` 429.

#### Scenario: Lookup resolves an exact handle only

- **WHEN** a member looks up `@sam` and separately attempts any prefix or partial query
- **THEN** the exact handle resolves (found or honestly not-found), and no endpoint returns more than one member or accepts a partial pattern

#### Scenario: Enumeration is rate-bounded on both keys

- **WHEN** a member exceeds the lookup budget, or many lookups arrive from one IP across members
- **THEN** further lookups on the exhausted key receive a structured `rate_limited` 429 until the window rolls over, and a limiter-storage failure never blocks a legitimate lookup (fail-open)

### Requirement: Requests carry a tier; the household tier is an invitation into the sender's household

The Worker SHALL maintain social requests (`social_requests`, ULID-keyed) with `tier ∈ {household, friend}`, sender household + member, target, an optional inert note, an optional sender-supplied display name, and a lifecycle state (`pending | accepted | declined | cancelled | swallowed`). A FRIEND-tier request SHALL target a household through a looked-up member: every member of the target household sees it in their inbox, any of them may accept (household authority), and acceptance mints the friendship edge. A HOUSEHOLD-tier request SHALL be an INVITATION from a member of a household to a prospective member ("join my household"), addressed to the invitee personally; acceptance is what moves the invitee into the sender's household (subject to the household size bound and, for invitees with an existing account, the member-move flow in `multi-tenancy`). Notes SHALL be server-capped at 200 characters and stored/rendered as inert plain text only. A duplicate pending request to the same party SHALL be answered idempotently as already-sent; requests to the sender's own household or to an already-friend household SHALL fail with honest structured errors. Under the self-hosted deployment profile, friend-tier lookup/send/accept operations SHALL be refused with a structured `profile_disabled` error while household-tier flows work unchanged.

#### Scenario: A friend request reaches the whole target household

- **WHEN** a member of household A sends a friend request via `@sam` of household B
- **THEN** every member of B sees one pending inbox row for household A, and any B member's accept resolves the request and creates the edge

#### Scenario: A household invitation is personal and moves the acceptor

- **WHEN** a member of household A sends a household-tier invitation to `@sam`
- **THEN** only `@sam`'s inbox carries the row ("invites you to join their household"), and `@sam`'s accept — never anyone else's — adds `@sam` to household A

#### Scenario: Notes are inert and capped

- **WHEN** a request is sent with a 500-character note containing markdown and a URL
- **THEN** the write is rejected (over cap) or the capped plain text is stored verbatim, and any rendered note appears as quoted plain text with no link or markup interpretation

#### Scenario: Friend tier is absent under self-hosted

- **WHEN** any friend-tier lookup, send, or accept call arrives on a self-hosted deployment
- **THEN** it is refused with a structured `profile_disabled` error, and household-tier calls on the same deployment behave normally

### Requirement: Declines are invisible and re-requests cool down; caps cannot become oracles

Declining a request SHALL be invisible to the requester: the requester's row renders "Request sent" indefinitely (states `pending`, `declined`, and `swallowed` are indistinguishable on the sender's surface). A declined pair — keyed by `(tier, sender household, target household)` for friend tier and `(tier, sender household, target member)` for household tier — SHALL enter a 30-day re-request cooldown from decline time, during which a re-send appears to succeed but writes a `swallowed` row that reaches no inbox and delivers no note or display name. The standing outgoing cap (placeholder 25 rows per member, tuned at implementation) SHALL count EVERY requester-visible row — pending, declined, and swallowed alike — so hitting the cap discloses nothing about outcomes; cancelling an outgoing request frees a slot without notifying anyone.

#### Scenario: A declined requester sees no change, ever

- **WHEN** household B declines household A's friend request
- **THEN** A's awaiting-response row still reads "Request sent" (with block/cancel affordances unchanged), and no response, count, or timing distinguishes the declined state from a pending one

#### Scenario: A re-send inside the cooldown delivers nothing

- **WHEN** A re-sends the request to B 10 days after B's decline
- **THEN** the send appears to succeed and a `swallowed` row is recorded for A's view, no inbox row reaches B, and the attached note is never delivered

#### Scenario: The cap counts swallowed rows

- **WHEN** a member's outgoing rows are a mix of pending, declined, and swallowed and their total reaches the cap
- **THEN** the next send is refused for being at the cap regardless of the mix, and cancelling any visible row (including a swallowed one) frees a slot silently

### Requirement: Blocks are directional, tier-scoped, household-evaluated, and silent

A block SHALL be mintable from an inbox row, an awaiting-response row, or a friend row, recording the minting member, the suppressed tier, and the blocked counterparty (the household; additionally the member for household-tier blocks, matched by member id so the protection follows the person across moves). Evaluation SHALL be household-wide — any member's block binds their household (the governance rule). Effects: the blocked party's future requests of that tier silently swallow (their view: still "Request sent"); the blocked party's existing pending inbox rows are swallowed at block time; a block minted from a friend row severs the friendship in the same operation; a block minted from an awaiting-response row also cancels the household's own outgoing request. No block, sever, or swallow SHALL emit any notification. The silent-swallow block subsumes mute — no separate mute exists. Unblocking SHALL be a plain deletion available to the blocking household, retroactively delivering nothing. Redemption of a member invite link by a blocked party SHALL consume the token and create no relationship, indistinguishable (to the redeemer) from a successful-looking terminal state.

#### Scenario: A blocked party's requests swallow silently

- **WHEN** household B blocks household A on the friend tier and A later sends a friend request
- **THEN** A sees "Request sent", no row reaches any B inbox, and no notification of the block ever reaches A

#### Scenario: Blocking a friend severs the link without notification

- **WHEN** a member of B blocks friend household A from A's friend row
- **THEN** the friendship edge is deleted in the same operation, A's recipes leave B's lens (and vice versa), and A receives no notification — A can at most observe the absence

#### Scenario: One member's block binds the household

- **WHEN** one member of B blocks A, and A then addresses a request to a DIFFERENT member of B on the same tier
- **THEN** the request swallows exactly as if addressed to the blocking member

### Requirement: Nicknames are per-viewer, others-only aliases exported only to the viewer who set them

The Worker SHALL store nicknames as (viewer member → target member) rows with the viewer's tenant, writable only by the viewer, only for OTHER members (self-nicknames refused), with empty-save clearing the row. A nickname SHALL never be disclosed to the named member or to any third member on any surface, and a member's data export includes nicknames they SET, never nicknames set FOR them (D33's rule, restated here for the owning capability). When a new relationship forms and the newcomer supplied a display name (on the request or in the accept flow), each counterparty viewer without an existing nickname for the newcomer SHALL receive a seeded nickname row from it — an ordinary editable row. The `read_user_profile` tool and the `/api` profile read SHALL export a `household` block — the household's members as `{ handle, nickname, you, joined_at }` — where `nickname` is the CALLING member's own alias for that member (null when unset); the export SHALL never include an alias set by or for anyone other than the caller-as-viewer. Nickname targets MAY be any live member of the deployment (under self-hosted, nicknames apply to everyone in the deployment per D9); the write path validates only target existence and others-only.

#### Scenario: A nickname is invisible to its subject

- **WHEN** member A sets the nickname "Mom" for member B and B reads every member surface and export
- **THEN** B never sees "Mom" anywhere — not on B's People page, B's profile read, or B's export — while A sees it on A's People page and in A's profile read

#### Scenario: The profile read carries the caller's household and own nicknames

- **WHEN** a member's agent calls `read_user_profile`
- **THEN** the payload's `household.members` lists every household member with handle, `you` marking the caller, and `nickname` holding only the caller's own aliases (null where unset)

#### Scenario: Accepting seeds an editable nickname

- **WHEN** a newcomer whose request or accept carried the display name "Grandma" joins a relationship with household A
- **THEN** each A viewer without an existing nickname for them gains a seeded "Grandma" row, presented in the flow as `will be saved as "Grandma" (@handle) — edit`, and later edits or empty-saves behave like any nickname row

#### Scenario: Empty-save clears

- **WHEN** a viewer saves an empty nickname for a member they previously nicknamed
- **THEN** the row is deleted and the member row renders `@handle + "Add a nickname"` again

### Requirement: Member invite links are per-invite minted bearer invitations

Members SHALL mint invite links from the People page: each mint creates one `member_invites` row carrying the inviter member, the tier (`household | friend`), single-use semantics, and a 14-day expiry, keyed by an unguessable URL-safe token of at least 128 random bits; the link is `<origin>/join/<token>`. Friend-tier mints SHALL be refused under the self-hosted profile. Cancelling an awaiting invite SHALL revoke the token; an unknown, expired, revoked, and already-redeemed token SHALL be indistinguishable to a visitor (one uniform `invalid_or_expired` surface — revocation is oracle-free). Redemption SHALL consume the token atomically with what it creates: for a signed-out visitor, a household-tier token mints a new member (ULID id, grammar-valid chosen handle) in the inviter's household (size bound enforced) and a friend-tier token mints a new tenant plus the friendship edge; for a signed-in member, a household-tier token converts to the household-accept flow and a friend-tier token creates the edge after confirmation (idempotent when already friends). Redemption endpoints SHALL be rate-limited per client IP by the shared limiter. Member invite links are a THIRD invite kind: they SHALL share no namespace or redemption path with KV bootstrap invites (which resolve an existing member for login) or D1 group signup codes (which create standalone tenants) — see `self-service-signup`.

#### Scenario: A minted link carries inviter, tier, and bounds

- **WHEN** a member mints a household invite link
- **THEN** one row records that inviter member, tier `household`, single-use, and a 14-day expiry, and the awaiting-response list shows it with a cancel affordance until redeemed, revoked, or expired

#### Scenario: Cancel revokes the token without an oracle

- **WHEN** the inviter (or any household member) cancels an unredeemed invite link and someone later opens it
- **THEN** the visitor sees the same uniform invalid-or-expired state an unknown or expired token produces, and nothing distinguishes revocation from expiry

#### Scenario: Household-tier redemption joins the inviter's household

- **WHEN** a signed-out visitor redeems a valid household-tier link, choosing an available grammar-valid handle
- **THEN** a member with a ULID id and that handle is created in the inviter's household (refused with a structured error when the household is at the size bound), the token is consumed in the same operation, and the visitor is signed in with the standard member-bound session to enroll a passkey

#### Scenario: Friend-tier redemption creates the household and the edge

- **WHEN** a signed-out visitor redeems a valid friend-tier link, choosing an available username
- **THEN** a new tenant is created exactly like a self-service signup AND one friendship edge to the inviter's household exists, both committed together with the token consumption

