## RENAMED Requirements

- FROM: `### Requirement: Member revocation fully purges tenant state`
- TO: `### Requirement: Household purge fully removes a tenant`

## ADDED Requirements

### Requirement: Member revoke removes one member without disturbing the household

The admin surface SHALL provide a member-revoke operation, distinct from household purge, that removes a SINGLE member from a tenant: deleting the `members` row, the member's `webauthn_credentials` rows, every web session record resolving to that member (including pre-split records that default to the founding member), every invite mapping resolving to that member, and the member's attributed `recipe_notes` / `store_notes` rows (`author = member id`) — through `src/db.ts` for the D1 rows. Member-revoke SHALL NOT touch the tenant's allowlist entry, the `tenants` registry row, the Kroger refresh token, or any household-scoped per-tenant table. After member-revoke, the member's previously-issued MCP access tokens SHALL no longer resolve (the shared resolver's member-liveness check fails, even though grant records may persist in the OAuth store) and their session cookies SHALL no longer authenticate. Member-revoke of a tenant's LAST member SHALL be refused with a structured error naming household purge as the applicable operation — an allowlisted household with zero members is never produced; member-initiated removal governance is deferred to the household-membership change.

#### Scenario: Member-revoke removes only member-scoped state

- **WHEN** the operator revokes one member of a household
- **THEN** the member's `members` row, credentials, sessions, invites, and authored notes are removed, while the household's allowlist entry, registry row, Kroger token, and household-scoped tables (pantry, plan, list, ...) are untouched

#### Scenario: A member-revoked identity stops resolving on both surfaces

- **WHEN** a request arrives carrying a revoked member's MCP token or session cookie while the tenant remains allowlisted
- **THEN** the member-liveness check fails and the request receives a structured `unauthorized` — no tool or route runs

#### Scenario: The last member cannot be member-revoked

- **WHEN** the operator attempts member-revoke on a tenant whose `members` table holds exactly one row
- **THEN** the operation is refused with a structured error directing the operator to household purge, and nothing is deleted

## MODIFIED Requirements

### Requirement: Household purge fully removes a tenant

The admin surface SHALL purge a household within the Worker — the whole-tenant half of the split lifecycle (the existing revoke route and roster action retain this behavior) — by removing its allowlist entry (`tenant:<id>`), deleting every invite mapping that resolves to that tenant (located by scanning `invite:*`, so no code need be supplied), deleting the tenant's per-tenant Kroger refresh token (`kroger:refresh:<id>`), deleting every web session record that resolves to that tenant (located by scanning `session:*` in `TENANT_KV` and matching the stored tenant), deleting the household's enrolled passkeys (all `webauthn_credentials` rows for that tenant), and purging the household's per-tenant D1 rows — every tenant-scoped table INCLUDING the `members` table, plus its members' attributed `recipe_notes` / `store_notes` — through `src/db.ts`. After the purge the household's previously-issued access tokens SHALL no longer resolve, even though the tokens may still exist in the OAuth store, and previously-issued session cookies SHALL no longer authenticate (the resolver's allowlist re-check locks them out even before the purge, and the purge removes the records). The shared recipe corpus SHALL NOT be deleted (recipes are not tenant-owned).

#### Scenario: Purge removes the allowlist entry and all invites

- **WHEN** the operator purges `casey`'s household
- **THEN** `tenant:casey` is deleted and every `invite:*` resolving to that tenant is deleted, with no invite code supplied by the operator

#### Scenario: Purge removes per-tenant D1, members, passkeys, and the Kroger token

- **WHEN** the operator purges `casey`'s household
- **THEN** every per-tenant D1 table is cleared of `casey`'s rows — including every `members` row for the tenant — the members' attributed notes and all `webauthn_credentials` rows are removed, and `kroger:refresh:casey` is deleted

#### Scenario: A purged household's token stops resolving

- **WHEN** a request arrives carrying a previously-issued access token after the household purge
- **THEN** tenant resolution fails (the allowlist entry is gone) and no tool runs, even though the token still exists in the OAuth store

#### Scenario: Purge removes web sessions and the cookie stops authenticating

- **WHEN** the operator purges a household while its members hold live web sessions
- **THEN** every `session:*` record resolving to that tenant is deleted, and a request replaying such a session cookie receives a structured `unauthorized` 401

### Requirement: Member onboarding mints an invite without a public log

The admin surface SHALL onboard a member entirely within the Worker, writing the allowlist entry (`tenant:<id>`), the tenant's FOUNDING MEMBER row in the D1 `members` table (member id and handle equal to the canonical tenant id, written in the same flow), and an invite mapping (`invite:<code>` resolving to the `(tenant, member)` pair) to their stores through the Worker's own bindings, with the username canonicalized to lowercase. The minted invite SHALL be a SINGLE-USE BOOTSTRAP: it carries an expiry and it authenticates the member only until their first passkey enrollment consumes it (see the `passkey-auth` capability). When no invite code is supplied, the Worker SHALL generate a random one. The response SHALL surface the invite code and the connector URL **once** to the authenticated operator, and the Worker SHALL NOT write the invite code to any log, run summary, or other externally-readable sink. The connector URL SHALL be derived from the request's own origin (`<origin>/mcp`).

#### Scenario: Onboard creates the allowlist entry, the founding member, and a single-use invite

- **WHEN** the operator onboards `Casey` (no code supplied)
- **THEN** the Worker writes `tenant:casey`, a `members` row with id and handle `casey` under tenant `casey`, and a single-use `invite:<generated>` resolving to `(casey, casey)`, and returns the generated code plus `<origin>/mcp` to the operator

#### Scenario: Invite code is shown once, never logged

- **WHEN** an onboard response returns an invite code
- **THEN** the code appears only in that authenticated response and in no log line, run summary, or other externally-readable output

#### Scenario: Username is canonicalized

- **WHEN** the operator onboards a mixed-case username such as `Casey`
- **THEN** the allowlist key, the stored record id, the founding member id and handle, and the invite target are all the canonical lowercase form (`casey`)

### Requirement: Invite rotation

The admin surface SHALL rotate a member's invite code: mint a new single-use bootstrap `invite:<new>` mapping resolving to that member's `(tenant, member)` pair and delete the member's prior invite mapping(s), without otherwise altering the tenant's allowlist entry, the member's row, or per-tenant data. Rotation SHALL be member-addressed and SHALL default to the founding member when no member is named — which keeps the existing tenant-addressed admin endpoint contract unchanged while every household has exactly one member. The rotated code SHALL be valid REGARDLESS of the grace control — it is the recovery primitive that lets a member who lost every device, or who never enrolled before grace was turned off, sign in once to enroll a (new) passkey. The new code SHALL be surfaced once to the operator under the same no-log guarantee as onboarding.

#### Scenario: Rotate replaces the code and invalidates the old one

- **WHEN** the operator rotates `casey`'s invite
- **THEN** a new single-use invite mapping resolving to `(casey, casey)` is created, every prior invite mapping resolving to that member is deleted, and the old code no longer authorizes; `casey`'s allowlist entry, member row, and per-tenant data are unchanged

#### Scenario: A rotated code works even with grace off

- **WHEN** grace is off and the operator rotates `casey`'s invite for recovery
- **THEN** `casey` can redeem the new code at `/login` to establish a session bound to `(casey, casey)` and enroll a passkey, and that enrollment consumes the code
