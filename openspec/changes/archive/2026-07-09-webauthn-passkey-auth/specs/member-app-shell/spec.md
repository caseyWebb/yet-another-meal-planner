## MODIFIED Requirements

### Requirement: The invite code opens the member app

The member app SHALL authenticate through the session flow, with a PASSKEY as the primary credential and the invite code as a single-use bootstrap: an unauthenticated visit presents the login screen, which offers passkey sign-in and (while the operator grace control is on, or for a fresh bootstrap code) invite-code entry; a successful sign-in establishes the session and lands on the app shell; and logout returns to login. A member without a passkey who signs in with a bootstrap code SHALL be prompted to enroll one (see `passkey-auth`). The app SHALL additionally serve a `/connect` screen where a signed-in member approves a pending Claude.ai connection (the cross-device approval target). This holds in local `wrangler dev` and under the Playwright gate.

#### Scenario: Passkey opens the app shell

- **WHEN** a member with an enrolled passkey visits `/` with no session and completes a passkey assertion
- **THEN** they land on the authenticated app shell, and reloading keeps them signed in (cookie session)

#### Scenario: Bootstrap code signs in and prompts enrollment

- **WHEN** a member without a passkey signs in with a valid bootstrap code
- **THEN** they land on the app shell and are prompted to enroll a passkey

#### Scenario: The connect screen approves a pending connection

- **WHEN** a signed-in member opens the `/connect` deep link for a pending approval reference and approves
- **THEN** the pending Claude.ai connection is authorized for their tenant (see `passkey-auth` and `multi-tenancy`)
