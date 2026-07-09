# member-app-shell Specification

## Purpose
TBD - created by archiving change member-app-foundations. Update Purpose after archive.
## Requirements
### Requirement: The member SPA is served at the root from Workers Static Assets with an SPA fallback

The Worker SHALL serve the member app at `/` from the Workers Static Assets binding (one merged assets root also carrying the admin bundle at its unchanged URLs), replacing the plain-text liveness banner — `/health` remains the machine liveness check. The assets config SHALL set `not_found_handling: "single-page-application"` so client-side routes deep-link to the shell, and `run_worker_first` SHALL enumerate every Worker-owned path — `/mcp` (+ subpaths), the OAuth provider endpoints (`/token`, `/register`, `/.well-known/*`), `/authorize`, `/oauth/*`, the satellite channel (`/satellite/*`), `/api` (+ subpaths), `/admin` (+ subpaths), `/cookbook` (+ subpaths), `/health`, `/health.svg`, and `/source` — so the SPA fallback can never shadow them. App assets SHALL be built with hashed, immutable filenames. The assets root is a build artifact, never committed.

#### Scenario: A deep link serves the shell

- **WHEN** a browser requests a client-side route that is not a Worker-owned path and not a built file
- **THEN** the response is the SPA's `index.html` and the client router resolves the route

#### Scenario: Worker-owned paths are untouched by the fallback

- **WHEN** requests arrive for `/mcp`, `/api/*`, `/authorize`, `/oauth/*`, `/satellite/*`, `/cookbook`, `/admin`, `/health`, or `/source`
- **THEN** each is handled by the Worker exactly as before the SPA existed — never answered with the SPA shell

#### Scenario: The admin bundle survives the shared assets root

- **WHEN** the admin panel loads its islands and stylesheet
- **THEN** they are served at their existing `/admin/*` asset URLs from the merged assets root

#### Scenario: The assets config survives the operator deploy merge

- **WHEN** the deploy merges the code repo's wrangler config with an operator's
- **THEN** the deployed `assets` block carries `not_found_handling` and the full `run_worker_first` enumeration verbatim from code

### Requirement: A new Worker-owned route ships with its run_worker_first entry

Because the SPA fallback answers every path not routed to the Worker first, adding a Worker-owned HTTP route SHALL include adding its path to the `run_worker_first` enumeration in the same change — otherwise the fallback silently swallows the route. The rule SHALL be documented where wrangler config changes are made (the config comment and the contribution guide).

#### Scenario: The enumeration is maintained with the router

- **WHEN** a change adds a Worker-served HTTP path
- **THEN** the same change adds the matching `run_worker_first` entry, and the path resolves to the Worker, not the shell

### Requirement: Frontend workspaces on the native-toolchain stack

The repository SHALL provide two frontend workspaces consumed via `workspace:*`: `packages/app` (the member SPA — React 19, Vite on the Rolldown core, TanStack Router with history-API routing (no hash routing), TanStack Query, `vite-plugin-pwa` with a prompt-to-reload service-worker posture) and `packages/ui` (shared shadcn/ui components and Tailwind v4 theme tokens, translated from the committed design bundle). New-package tooling SHALL follow the native-toolchain principle: the Oxc/SWC-class React transform (no Babel), Tailwind v4, Oxlint for linting and Biome for formatting (no ESLint/Prettier in the new packages), `tsc` for typechecking. Both packages SHALL be covered by the repo's `typecheck` and CI installs (with explicit `aube.allowBuilds` decisions for any build-gated dependency).

#### Scenario: The app builds into the Worker's assets root

- **WHEN** the app workspace builds
- **THEN** it emits `index.html` plus hashed immutable chunks into the Worker's assets root without disturbing the admin bundle's subtree, in either build order

#### Scenario: Shared UI is a workspace dependency

- **WHEN** the app imports components or tokens
- **THEN** they come from `packages/ui` via `workspace:*`, and the design source of truth remains the companion design project's bundle

### Requirement: The build stamps one version id into both the bundle and the Worker

The deploy SHALL stamp the same build id (the code SHA) into the SPA bundle at build time and into the Worker as a deploy-injected var, and both SHALL default to `"dev"` when unstamped (local dev, tests) so skew detection is inert locally. This is the SPA side of the version-skew contract (the API side emits it on every response).

#### Scenario: One SHA, both sides

- **WHEN** an operator deploy completes
- **THEN** the served bundle's embedded build id equals the Worker's `X-App-Build` value, and a subsequent code deploy makes the mismatch detectable to the cached bundle

### Requirement: Developer scripts for the app surface

The repository SHALL provide root-level scripts: `build:app` (build the SPA into the assets root), `test:app` (the app's Playwright suite), and `dev:app` (the Worker under `wrangler dev` alongside the Vite dev server with `/api` proxied to the Worker, so the SPA develops with HMR against real auth and data). `aubr dev` remains plain `wrangler dev`, serving the last-built SPA.

#### Scenario: HMR development against the real Worker

- **WHEN** a contributor runs `aubr dev:app` and logs in from the Vite dev server
- **THEN** `/api` requests reach the local Worker (cookies intact via the same-origin proxy) while the SPA hot-reloads

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

