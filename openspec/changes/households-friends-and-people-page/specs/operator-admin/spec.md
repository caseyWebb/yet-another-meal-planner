## MODIFIED Requirements

### Requirement: Member onboarding mints an invite without a public log

The admin surface SHALL onboard a member entirely within the Worker, writing the allowlist entry (`tenant:<id>`), the tenant's FOUNDING MEMBER row in the D1 `members` table (member id and handle equal to the canonical tenant id, written in the same flow), and an invite mapping (`invite:<code>` resolving to the `(tenant, member)` pair) to their stores through the Worker's own bindings, with the username canonicalized to lowercase and validated against the ONE new-mint handle grammar (`^[a-z0-9_]{3,20}$`; a failing username is refused with a structured error naming the grammar — existing tenants are grandfathered and unaffected). The minted invite SHALL be a SINGLE-USE BOOTSTRAP: it carries an expiry and it authenticates the member only until their first passkey enrollment consumes it (see the `passkey-auth` capability). When no invite code is supplied, the Worker SHALL generate a random one. The response SHALL surface the invite code and the connector URL **once** to the authenticated operator, and the Worker SHALL NOT write the invite code to any log, run summary, or other externally-readable sink. The connector URL SHALL be derived from the request's own origin (`<origin>/mcp`).

#### Scenario: Onboard creates the allowlist entry, the founding member, and a single-use invite

- **WHEN** the operator onboards `Casey` (no code supplied)
- **THEN** the Worker writes `tenant:casey`, a `members` row with id and handle `casey` under tenant `casey`, and a single-use `invite:<generated>` resolving to `(casey, casey)`, and returns the generated code plus `<origin>/mcp` to the operator

#### Scenario: Invite code is shown once, never logged

- **WHEN** an onboard response returns an invite code
- **THEN** the code appears only in that authenticated response and in no log line, run summary, or other externally-readable output

#### Scenario: Username is canonicalized

- **WHEN** the operator onboards a mixed-case username such as `Casey`
- **THEN** the allowlist key, the stored record id, the founding member id and handle, and the invite target are all the canonical lowercase form (`casey`)

#### Scenario: A grammar-violating username is refused

- **WHEN** the operator attempts to onboard `caseys-kitchen` (hyphen) or `cj` (too short)
- **THEN** the onboard is refused with a structured error naming the handle grammar, nothing is written, and every existing grandfathered tenant keeps working unmodified

### Requirement: Household purge fully removes a tenant

The admin surface SHALL purge a household within the Worker — the whole-tenant half of the split lifecycle (the existing revoke route and roster action retain this behavior) — by removing its allowlist entry (`tenant:<id>`), deleting every invite mapping that resolves to that tenant (located by scanning `invite:*`, so no code need be supplied), deleting the tenant's per-tenant Kroger refresh token (`kroger:refresh:<id>`), deleting every web session record that resolves to that tenant (located by scanning `session:*` in `TENANT_KV` and matching the stored tenant), deleting the household's enrolled passkeys (all `webauthn_credentials` rows for that tenant), and purging the household's per-tenant D1 rows — every tenant-scoped table INCLUDING the `members` table, plus its members' attributed `recipe_notes` / `store_notes` — through `src/db.ts`. The purge SHALL also clear the household's social rows in BOTH directions: `friendships` and `social_requests` where the tenant is either party, its `member_invites`, `nicknames` rows the household holds AND rows targeting its members, and `blocks` it minted as well as blocks recorded against it or its members. After the purge the household's previously-issued access tokens SHALL no longer resolve, even though the tokens may still exist in the OAuth store, and previously-issued session cookies SHALL no longer authenticate (the resolver's allowlist re-check locks them out even before the purge, and the purge removes the records). The shared recipe corpus SHALL NOT be deleted (recipes are not tenant-owned); the household's `recipe_imports` grants are removed with its per-tenant rows, so its recipes leave every friend's lens.

#### Scenario: Purge removes the allowlist entry and all invites

- **WHEN** the operator purges `casey`'s household
- **THEN** `tenant:casey` is deleted and every `invite:*` resolving to that tenant is deleted, with no invite code supplied by the operator

#### Scenario: Purge removes per-tenant D1, members, passkeys, and the Kroger token

- **WHEN** the operator purges `casey`'s household
- **THEN** every per-tenant D1 table is cleared of `casey`'s rows — including every `members` row for the tenant — the members' attributed notes and all `webauthn_credentials` rows are removed, and `kroger:refresh:casey` is deleted

#### Scenario: Purge severs the social graph in both directions

- **WHEN** the operator purges a household that holds friendships, pending requests in both directions, minted invite links, nicknames, and block records
- **THEN** no `friendships`, `social_requests`, `member_invites`, `nicknames`, or `blocks` row referencing that tenant or its members survives, and former friends' lenses no longer include its recipes

#### Scenario: A purged household's token stops resolving

- **WHEN** a request arrives carrying a previously-issued access token after the household purge
- **THEN** tenant resolution fails (the allowlist entry is gone) and no tool runs, even though the token still exists in the OAuth store

#### Scenario: Purge removes web sessions and the cookie stops authenticating

- **WHEN** the operator purges a household while its members hold live web sessions
- **THEN** every `session:*` record resolving to that tenant is deleted, and a request replaying such a session cookie receives a structured `unauthorized` 401

### Requirement: Member revoke removes one member without disturbing the household

The admin surface SHALL provide a member-revoke operation, distinct from household purge, that removes a SINGLE member from a tenant: deleting the `members` row, the member's `webauthn_credentials` rows, every web session record resolving to that member (including pre-split records that default to the founding member), every invite mapping resolving to that member, the member's attributed `recipe_notes` / `store_notes` rows (`author = member id`), and the member's social rows — nicknames they set and nicknames targeting them, their outgoing `social_requests` (cancelled), `member_invites` they minted (revoked), and block records naming them as `blocked_member` — through `src/db.ts` for the D1 rows. Member-revoke SHALL NOT touch the tenant's allowlist entry, the `tenants` registry row, the Kroger refresh token, or any household-scoped per-tenant table. After member-revoke, the member's previously-issued MCP access tokens SHALL no longer resolve (the shared resolver's member-liveness check fails, even though grant records may persist in the OAuth store) and their session cookies SHALL no longer authenticate. Member-revoke of a tenant's LAST member SHALL be refused with a structured error naming household purge as the applicable operation — an allowlisted household with zero members is never produced. Member-revoke SHALL be operable from the admin roster UI (see the roster requirement); member-initiated removal is the member-app governance flow, not this operation.

#### Scenario: Member-revoke removes only member-scoped state

- **WHEN** the operator revokes one member of a household
- **THEN** the member's `members` row, credentials, sessions, invites, authored notes, set-and-targeting nicknames, outgoing requests, and minted invite links are removed or terminally resolved, while the household's allowlist entry, registry row, Kroger token, and household-scoped tables (pantry, plan, list, ...) are untouched

#### Scenario: A member-revoked identity stops resolving on both surfaces

- **WHEN** a request arrives carrying a revoked member's MCP token or session cookie while the tenant remains allowlisted
- **THEN** the member-liveness check fails and the request receives a structured `unauthorized` — no tool or route runs

#### Scenario: The last member cannot be member-revoked

- **WHEN** the operator attempts member-revoke on a tenant whose `members` table holds exactly one row
- **THEN** the operation is refused with a structured error directing the operator to household purge, and nothing is deleted

### Requirement: Members roster shows summary tiles and a per-member action menu

The Members area SHALL render a summary stat-tile row (Households, Members, Active, Pending, Kroger linked counts, derived from the tenant listing) above a roster GROUPED BY HOUSEHOLD, composed from the shared component kit's stat-card grid and `Item`/`ItemGroup` primitives. Each household group SHALL show the household id, its member count, a Kroger-linked badge when linked, and household-level actions (the kit `DropdownMenu`): **Link Kroger** (or **Re-link Kroger**), and **Purge household** (the existing revocation operation, relabeled to its split-lifecycle name). Within a group, each member row SHALL show the member's avatar (initials), `@handle`, an active/pending status badge, and an activity meta line (cooked/favorites counts and last-active age for an active member; invited age for a pending one), with member-level actions: **Rotate invite** and **Revoke member** (the member-revoke operation; for a household's only member the menu offers **Revoke access** mapping to household purge instead, mirroring the API's last-member refusal). Single-member households (the deployment's common case) SHALL render compactly — one row carrying both the household and member affordances — so the regrouping adds no noise until a second member exists. Activating an actions menu SHALL NOT also navigate to the member's detail view. The regrouped roster SHALL ship with admin Playwright coverage (page objects + specs under `admin/visual/`).

#### Scenario: Stat tiles reflect the roster

- **WHEN** the operator opens the Members area
- **THEN** the stat tiles show the household count, total member count, the active count, the pending count, and the Kroger-linked count, each matching the grouped roster below

#### Scenario: A multi-member household groups its members

- **WHEN** a household holds three members
- **THEN** the roster renders one household group with member count 3 and three member rows inside it, each with its own status badge, meta line, and member-level actions menu

#### Scenario: A pending member's row reflects its state

- **WHEN** a member has been invited but has not yet connected
- **THEN** their row shows a pending badge and an "invited <age>" meta line instead of activity counts

#### Scenario: Row actions menus invoke the split lifecycle correctly

- **WHEN** the operator uses the menus on a multi-member household
- **THEN** member rows offer Rotate invite and Revoke member (member-revoke), the household group offers Kroger linking and Purge household (full purge), and revoking a non-last member removes exactly that member while the household and its other members survive

#### Scenario: The last member's menu routes to purge

- **WHEN** the operator opens the actions menu for a household's only member
- **THEN** the member-revoke action is not offered (or is disabled with the refusal reason); the offered Revoke access action performs household purge
