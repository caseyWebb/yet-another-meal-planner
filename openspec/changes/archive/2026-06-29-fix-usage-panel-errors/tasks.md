## 1. Fix the `fetch` `this`-binding bug (`src/usage.ts`)

- [x] 1.1 Bind the global `fetch` in `defaultDeps` (line ~166): `fetchImpl: fetch.bind(globalThis)` (or an arrow wrapper), so `deps.fetchImpl(...)` at lines ~183/328/434 no longer rebinds `this`.
- [x] 1.2 Export `defaultDeps` (or a small accessor) from `usage.ts` so the regression guard can reach the real default implementation.
- [x] 1.3 Run `aubr typecheck` and confirm no other module references the old shape.

## 2. Regression guard (`test/usage.test.ts`)

- [x] 2.1 Add a test that invokes the default `fetchImpl` **detached from `defaultDeps`** (e.g. `const f = defaultDeps.fetchImpl; await f(url, init)`) against a stub global `fetch`, asserting it does not throw an incorrect-`this` runtime error.
- [x] 2.2 Confirm the guard FAILS against the pre-fix code (bare `{ fetchImpl: fetch }`) and PASSES after task 1.1 — it must actually catch the regression.
- [x] 2.3 Run `aubr test test/usage.test.ts`.

## 3. Surface upstream error detail in the UI (`admin/src/Usage.elm`)

- [x] 3.1 Define a typed error (e.g. `UsageError = Transport Http.Error | UpstreamError { code : String, message : String }`) — not `Maybe String`, not status-only `BadStatus` — per `admin/CLAUDE.md`.
- [x] 3.2 Replace `Http.expectJson` (all three: `fetchUsage`, `fetchTrends`, `fetchTools`) with a shared `Http.expectStringResponse` that decodes `{ error, message }` on `BadStatus_` into `UpstreamError`, runs the existing JSON decoder on `GoodStatus_`, and falls back gracefully when the body is not `{ error, message }` (preserve the friendly 403/404 cases).
- [x] 3.3 Carry the typed error in the `Failure` variant (adjust the `WebData`/`Msg` wiring or wrap as needed) and write one shared failure renderer that prints `message` + `error` code.
- [x] 3.4 Update `httpError` (or its replacement) to render the typed transport cases as today and the upstream case with full detail.

## 4. Frontend tests + bundle (`admin/`)

- [x] 4.1 Add/extend `admin/tests/UsageTest.elm` to pin the error-body decode (a `{ error, message }` body → `UpstreamError` with both fields) and the not-`{error,message}` fallback.
- [x] 4.2 Rebuild the bundle: `aubr build:admin` (needs `package.elm-lang.org`); if unreachable, leave the rebuild to CI and note it rather than committing a stale `admin/dist/`.
- [x] 4.3 Verify `aubr build:admin --check` passes (committed bundle not drifted).

## 5. Docs + validation

- [x] 5.1 `docs/SCHEMAS.md`: note that the three usage endpoints' `upstream_unavailable` body (`{ error, message }`) is rendered by the panel; confirm no contract field changed.
- [x] 5.2 `openspec validate "fix-usage-panel-errors" --strict` passes.
- [x] 5.3 Full `aubr typecheck && aubr test` green; manually confirm the Usage page shows a real upstream message (force a failure, e.g. a bad token) instead of `HTTP 500`.
