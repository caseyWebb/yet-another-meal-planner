## MODIFIED Requirements

### Requirement: The suite establishes member sessions deterministically, never via per-test UI login

Authenticated specs SHALL start pre-authenticated from a session minted server-side, never by driving the login UI per test. The app harness (`packages/worker/app/visual/setup.mjs`) SHALL seed a member session directly into `TENANT_KV` (a `session:<token>` record mirroring `createSession`, alongside the already-seeded `tenant:<active>` allowlist key) and SHALL emit a Playwright `storageState` carrying the `__Host-session` cookie with the exact attributes `setSessionCookie` sets. The suite SHALL run as two Playwright projects: an `authed` project that loads that `storageState` and runs every non-login spec, and a `noauth` project that carries no `storageState` and runs the dedicated real-auth-UI specs (login, signup, passkey) genuinely logged out — the ONLY specs that exercise `POST /api/session`. The `asMember` fixture SHALL be a plain navigation to `/` that asserts the shell landmark, with no login request and no cached-cookie state. This SHALL hold `fullyParallel: false`, `workers: 1`, and the existing `retries` unchanged; the fix is the removal of login from the authenticated test path, not any relaxation of timeouts, retries, or the limiter.

#### Scenario: An authenticated spec issues no login request

- **WHEN** any spec in the `authed` project runs (it enters the app through `asMember` or a direct navigation)
- **THEN** it establishes its session from the injected `storageState` and issues no `POST /api/session` request

#### Scenario: The login limiter is exercised only by the dedicated login specs

- **WHEN** the full suite runs
- **THEN** only the `noauth` project's login/signup/passkey specs drive the real login UI, and the total `POST /api/session` attempts stay within the 10/min/IP limiter so it is never tripped

#### Scenario: A cold Worker is gated by an authenticated warmup

- **WHEN** the suite starts against a freshly booted local `wrangler dev`
- **THEN** a `globalSetup` blocks every worker until `GET /api/session` returns 200 for the seeded session — proving the KV-session read, the tenant allowlist, and D1 are warm — so the first spec's requests do not flake
