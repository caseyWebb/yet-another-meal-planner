## ADDED Requirements

### Requirement: Operator issues and manages group invite codes

The admin surface SHALL let the operator mint a GROUP INVITE CODE that authorizes bounded self-service signup (see `self-service-signup`). Minting SHALL take a cap (maximum redemptions) and MAY take an expiry and a human label, writing the code to D1 (`signup_invites`). The minted code SHALL be surfaced to the authenticated operator ONCE and SHALL NOT be written to any log, run summary, or other externally-readable sink — the same no-log guarantee as member onboarding. The admin surface SHALL list active group invite codes with their live usage — used count against the cap, expiry, revoked state, label — and the provenance of accounts created through each. The admin surface SHALL let the operator revoke a group invite code, after which it SHALL admit no further signups; revoking a code SHALL NOT revoke, alter, or otherwise disturb any account already created through it (those are ordinary tenants, revoked individually through the existing member-revocation flow).

#### Scenario: Mint returns a capped, expiring code once

- **WHEN** the operator mints a group invite code with a cap of 10 and a 7-day expiry
- **THEN** a `signup_invites` row is written, and the code is surfaced to the operator exactly once and appears in no log, run summary, or other externally-readable output

#### Scenario: Usage and provenance are visible

- **WHEN** three members have signed up through a group invite code with a cap of 10
- **THEN** the admin surface shows it as 3/10 used with its expiry and label, and shows which three tenants were created from it

#### Scenario: Revoke halts signups but spares accounts

- **WHEN** the operator revokes a group invite code through which members have already signed up
- **THEN** the code admits no further signups, and every member already created through it retains their account and access
