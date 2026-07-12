## Why

The member-app Playwright suite (`packages/worker/app/visual/`) established every authenticated test's session by driving the real login UI. The `asMember` fixture logged in through the browser (`login.login()` → `login.skipEnroll()`) once per worker and cached the resulting cookie in a module-level variable **only on success**. With `workers: 1`, a single slow or failed first login left the cache empty, so every subsequent `beforeEach(asMember)` re-ran the full UI login. Those repeated logins tripped `POST /api/session`'s 10/min/IP limiter (`src/api/session.ts` + `src/rate-limit.ts`), after which each remaining authed spec blocked its 30s timeout waiting for `enroll-skip` — and with `retries: 1` the whole cascade ran twice, turning a ~4-minute suite into a ~46-minute flake.

The login UI is a real product surface that deserves coverage, but it does not belong on the hot path of every unrelated area test. The fix is to stop logging in per test: mint the member session deterministically server-side and inject it into the browser context, so authenticated specs issue zero login HTTP.

## What Changes

- **Seed the member session server-side and inject it via Playwright `storageState`.** `app/visual/setup.mjs` writes a stable `session:<token>` record into `TENANT_KV` (mirroring what `createSession` writes in `src/session.ts`) and emits a `storageState` JSON carrying the `__Host-session` cookie with the exact attributes `setSessionCookie` sets. The seed already writes the `tenant:<active>` allowlist key, so `requireSession` → `resolveTenant` resolves.
- **Split the suite into two Playwright projects.** A `noauth` project (no `storageState`) runs the dedicated real-auth-UI specs (`login`, `signup`, `passkey`) genuinely logged out — the only specs that exercise `POST /api/session` and the login limiter. An `authed` project injects the seeded `storageState` and runs every other spec pre-authenticated. `fullyParallel: false`, `workers: 1`, and `retries` are unchanged.
- **Reduce `asMember` to a plain navigation.** The fixture drops its UI-login branch and its module-level cookie cache; it now just navigates to `/` and asserts the shell landmark, since the context is pre-authenticated.
- **Add an authenticated warmup gate.** A Playwright `globalSetup` polls the whoami endpoint (`GET /api/session`) with the fabricated cookie until it returns 200 before any worker starts, proving the KV-session read, the tenant allowlist, and D1 are warm on a cold Worker so the first request cannot flake.

## Capabilities

### Modified Capabilities
- `app-ui-testing`: authenticated specs establish their member session deterministically from a server-seeded `storageState`, never via per-test UI login; the real login/enrollment/signup UI keeps dedicated coverage in a logged-out project; a cold Worker is gated by an authenticated warmup before any spec runs.

## Impact

- **App harness (`packages/worker/app/visual/`):** `setup.mjs` (seeds the `session:<token>` record and writes the `storageState`), `global-setup.mjs` (new authenticated warmup poll), `fixtures.ts` (`asMember` reduced to navigate + landmark; the cached-cookie var removed), `specs/login.spec.ts` (its two `asMember` tests establish their own session with a real login, matching the pre-change behavior), `specs/connect.spec.ts` and `specs/smoke.spec.ts` (drop the injected cookie in their logged-out cases).
- **Config (`packages/worker/playwright.app.config.ts`):** the single `chromium` project becomes `noauth` + `authed`; adds `globalSetup`. `fullyParallel`/`workers`/`retries` unchanged.
- **Gitignore (`packages/worker/.gitignore`):** `app/visual/.auth/` (the generated `storageState`, never committed or published as a CI artifact).
- **Docs:** `docs/ARCHITECTURE.md` app-ui testing section describes deterministic server-side session seeding via `storageState`.
- **No product-code changes, no new dependencies, no new secrets.** The Worker session mechanism, the login limiter, and the seed's identity keys are unchanged.
