## 1. Seed the session server-side and inject it

- [x] 1.1 In `app/visual/setup.mjs`, after the D1 migrate + KV seed, write the `session:<token>` record into `TENANT_KV` for the active member (stable token, record mirroring `createSession`).
- [x] 1.2 Write a Playwright `storageState` JSON to `app/visual/.auth/<member>.json` carrying the `__Host-session` cookie with the exact attributes `setSessionCookie` sets (Path=/, Secure, HttpOnly, SameSite=Lax).
- [x] 1.3 Add `app/visual/.auth/` to `packages/worker/.gitignore` so the generated state is never committed or published.

## 2. Authenticated warmup gate

- [x] 2.1 Add `app/visual/global-setup.mjs` that polls `GET /api/session` with the fabricated cookie until 200 (bounded retry), so no worker starts before the authenticated read + allowlist + D1 are warm.
- [x] 2.2 Wire `globalSetup` into `playwright.app.config.ts`.

## 3. Split the suite into noauth + authed projects

- [x] 3.1 Replace the single `chromium` project with `noauth` (`storageState: undefined`, the real-auth-UI specs) and `authed` (seeded `storageState`, all other specs). Keep `fullyParallel: false`, `workers: 1`, `retries` unchanged.
- [x] 3.2 Reduce `asMember` in `fixtures.ts` to navigate to `/` + assert the shell landmark; delete the cached-cookie module var and the UI-login branch.
- [x] 3.3 Convert `login.spec.ts`'s two `asMember` tests to establish their own session via a real login (the logged-out `noauth` project).
- [x] 3.4 Drop the injected cookie (`context.clearCookies()`) in the logged-out cases: `connect.spec.ts`'s unauthenticated-visit test and `smoke.spec.ts`'s login/signup areas.

## 4. Docs

- [x] 4.1 Update the app-ui harness header comment in `playwright.app.config.ts` and the app-ui testing section of `docs/ARCHITECTURE.md` to describe deterministic server-side session seeding via `storageState` (current-state voice).

## 5. Verify

- [x] 5.1 `aube run typecheck` passes.
- [x] 5.2 The full app-ui suite runs fast (minutes, not tens of minutes) and green; the `noauth` project's login/signup/passkey specs still exercise the real login UI.
- [x] 5.3 `aube run openspec validate "app-ui-suite-deterministic-auth" --strict` passes.
