## MODIFIED Requirements

### Requirement: Member onboarding mints an invite without a public log

The admin surface SHALL onboard a member entirely within the Worker, writing the allowlist entry (`tenant:<id>`) and an invite mapping (`invite:<code> → <id>`) to `TENANT_KV` through the Worker's own binding, with the username canonicalized to lowercase. The minted invite SHALL be a SINGLE-USE BOOTSTRAP: it carries an expiry and it authenticates the member only until their first passkey enrollment consumes it (see the `passkey-auth` capability). When no invite code is supplied, the Worker SHALL generate a random one. The response SHALL surface the invite code and the connector URL **once** to the authenticated operator, and the Worker SHALL NOT write the invite code to any log, run summary, or other externally-readable sink. The connector URL SHALL be derived from the request's own origin (`<origin>/mcp`).

#### Scenario: Onboard creates the allowlist entry and a single-use invite

- **WHEN** the operator onboards `Casey` (no code supplied)
- **THEN** the Worker writes `tenant:casey` and a single-use `invite:<generated> → casey` mapping to `TENANT_KV`, and returns the generated code plus `<origin>/mcp` to the operator

#### Scenario: Invite code is shown once, never logged

- **WHEN** an onboard response returns an invite code
- **THEN** the code appears only in that authenticated response and in no log line, run summary, or other externally-readable output

#### Scenario: Username is canonicalized

- **WHEN** the operator onboards a mixed-case username such as `Casey`
- **THEN** the allowlist key, the stored record id, and the invite target are all the canonical lowercase form (`casey`)

### Requirement: Member revocation fully purges tenant state

The admin surface SHALL revoke a member within the Worker by removing their allowlist entry (`tenant:<id>`), deleting every invite mapping that resolves to that member (located by scanning `invite:*`, so no code need be supplied), deleting the member's per-tenant Kroger refresh token (`kroger:refresh:<id>`), deleting every web session record that resolves to that member (located by scanning `session:*` in `TENANT_KV` and matching the stored tenant), deleting the member's enrolled passkeys (all `webauthn_credentials` rows for that tenant), and purging the member's per-tenant D1 rows — every tenant-scoped table and their attributed `recipe_notes` / `store_notes` — through `src/db.ts`. After revocation the member's previously-issued access token SHALL no longer resolve to a tenant, even though the token may still exist in the OAuth store, and their previously-issued session cookie SHALL no longer authenticate (the session middleware's allowlist re-check locks them out even before the purge, and the purge removes the records). The shared recipe corpus SHALL NOT be deleted (recipes are not tenant-owned).

#### Scenario: Revoke removes the allowlist entry and all invites

- **WHEN** the operator revokes `casey`
- **THEN** `tenant:casey` is deleted and every `invite:*` whose value is `casey` is deleted, with no invite code supplied by the operator

#### Scenario: Revoke purges per-tenant D1, passkeys, and the Kroger token

- **WHEN** the operator revokes `casey`
- **THEN** every per-tenant D1 table is cleared of `casey`'s rows, `casey`'s attributed notes and all `casey` `webauthn_credentials` rows are removed, and `kroger:refresh:casey` is deleted

#### Scenario: A revoked token stops resolving

- **WHEN** a request arrives carrying `casey`'s previously-issued access token after revocation
- **THEN** tenant resolution fails (the allowlist entry is gone) and no tool runs, even though the token still exists in the OAuth store

#### Scenario: Revoke purges web sessions and the cookie stops authenticating

- **WHEN** the operator revokes `casey` while `casey` holds live web sessions
- **THEN** every `session:*` record resolving to `casey` is deleted, and a request replaying `casey`'s session cookie receives a structured `unauthorized` 401

### Requirement: Invite rotation

The admin surface SHALL rotate a member's invite code: mint a new single-use bootstrap `invite:<new> → <id>` mapping and delete the member's prior invite mapping(s), without otherwise altering the member's allowlist entry or per-tenant data. The rotated code SHALL be valid REGARDLESS of the grace control — it is the recovery primitive that lets a member who lost every device, or who never enrolled before grace was turned off, sign in once to enroll a (new) passkey. The new code SHALL be surfaced once to the operator under the same no-log guarantee as onboarding.

#### Scenario: Rotate replaces the code and invalidates the old one

- **WHEN** the operator rotates `casey`'s invite
- **THEN** a new single-use invite mapping is created, every prior `invite:* → casey` mapping is deleted, and the old code no longer authorizes; `casey`'s allowlist entry and per-tenant data are unchanged

#### Scenario: A rotated code works even with grace off

- **WHEN** grace is off and the operator rotates `casey`'s invite for recovery
- **THEN** `casey` can redeem the new code at `/login` to establish a session and enroll a passkey, and that enrollment consumes the code

## ADDED Requirements

### Requirement: Operator controls the invite-code grace period

The Worker SHALL provide an operator-set grace control that governs whether LEGACY standing invite codes are accepted. While grace is on (the migration default), a legacy standing invite code SHALL authenticate at both `/login` and `/authorize`, so members onboarded before passkeys migrate organically. Once the operator turns grace off, a legacy standing invite code SHALL NOT authenticate on any surface; only passkeys and fresh single-use bootstrap codes (issued by onboarding or rotation) SHALL be accepted. The grace control SHALL default to on so that deploying this capability locks no existing member out.

#### Scenario: Grace on admits a legacy code

- **WHEN** grace is on and a pre-migration member presents their standing invite code
- **THEN** the code authenticates as before

#### Scenario: Grace off rejects a legacy code but not a fresh bootstrap

- **WHEN** grace is off and a legacy standing code is presented, versus a freshly rotated single-use bootstrap code
- **THEN** the legacy code is rejected with a structured `unauthorized` response while the fresh bootstrap code is accepted for one enrollment
