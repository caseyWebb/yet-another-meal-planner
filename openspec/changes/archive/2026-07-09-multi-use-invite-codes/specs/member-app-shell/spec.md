## ADDED Requirements

### Requirement: The member app offers self-service signup

The member app SHALL offer a self-service signup path. The login screen SHALL present an affordance to sign up with a group invite code, leading to a `/signup` screen where a visitor enters the code and chooses a username. On success the app SHALL establish the standard session, land on the app shell, and prompt passkey enrollment (see `self-service-signup` and `passkey-auth`). A taken username SHALL be surfaced inline so the visitor can choose another; an invalid, exhausted, expired, or revoked code SHALL surface a uniform failure with no oracle. The `/signup` route SHALL be a client route served by the SPA shell — the `/api/signup` endpoint is already covered by the `/api/*` `run_worker_first` enumeration, so no new enumeration entry is required. This holds in local `wrangler dev` and under the Playwright gate.

#### Scenario: Signup creates an account and prompts enrollment

- **WHEN** a visitor opens `/signup`, enters a valid group invite code, and picks an available username
- **THEN** they land on the authenticated app shell signed in as the new tenant and are prompted to enroll a passkey

#### Scenario: A taken username is surfaced inline

- **WHEN** a visitor's chosen username is already taken
- **THEN** the signup screen tells them to choose another and no account is created

#### Scenario: An invalid code fails uniformly

- **WHEN** a visitor submits an exhausted, expired, revoked, or unknown group invite code
- **THEN** signup fails with a uniform error and no account is created
