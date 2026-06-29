## Why

The operator admin Usage page is dead on a configured deployment: all three panels render `HTTP 500`. The root cause is a `this`-binding bug in `src/usage.ts` — the default deps store the global `fetch` as an object property and invoke it as a method, which `workerd` rejects with "Illegal invocation: function called with incorrect `this` reference". Separately, even once that is fixed, the next upstream failure (a mis-scoped token, a Cloudflare 5xx, an AE schema drift) would still show a bare `HTTP 500`: the admin SPA discards the helpful `{ error, message }` body the Worker already returns. The operator currently has to open the browser console to see what actually failed.

## What Changes

- **Fix the `fetch` `this`-binding bug** in `src/usage.ts`: bind the global `fetch` in `defaultDeps` so invoking it as `deps.fetchImpl(...)` no longer rebinds `this` to the deps object. Restores `GET /admin/api/usage`, `/admin/api/usage/trends`, and `/admin/api/usage/tools` on a configured deployment. Scope is confined to `usage.ts` — every other `fetchImpl`/`doFetch` site calls `fetch` as a bare identifier (`this` undefined, which `workerd` permits), not as an object method.
- **Add a regression guard** that exercises the real default `fetchImpl` detached from its object. The existing usage tests always inject their own `fetchImpl`, so they structurally cannot catch this class of bug.
- **Surface upstream error detail in the admin Usage UI** (`admin/src/Usage.elm`): decode the Worker's `{ error, message }` body on a non-2xx response into a domain error type carried in the `Failure` state, and render the real message + error code instead of `HTTP 500`. Shared across all three panels. Admin-facing only, behind the Cloudflare Access gate — no privacy/security concern with full error detail.

## Capabilities

### New Capabilities
<!-- None — all three surfaces already exist as capabilities. -->

### Modified Capabilities
- `usage-observability`: the snapshot surface's error behavior gains a requirement that an upstream failure is reported with its detail to the operator (not swallowed to a bare status), and the `fetch` egress must invoke the global `fetch` with a correct `this` binding.
- `usage-trends`: same error-surfacing + `fetch`-binding requirement for the per-job trends surface.
- `tool-usage-trends`: same error-surfacing + `fetch`-binding requirement for the per-tool surface.

## Impact

- **Code:** `src/usage.ts` (the bind fix); `test/usage.test.ts` (regression guard); `admin/src/Usage.elm` + `admin/tests/UsageTest.elm` (error decode/modeling); `admin/dist/admin/{elm.js,index.html}` (regenerated bundle — requires `aubr build:admin`, which needs `package.elm-lang.org` reachable).
- **Docs:** `docs/SCHEMAS.md` — note that the three usage endpoints' `upstream_unavailable` body is rendered by the panel (no contract field change; the `{ error, message }` shape is unchanged).
- **No API/data-shape change.** The Worker already returns `{ error, message }` with HTTP 500; this change makes the live path actually reach it and the panel actually show it. No migration, no new binding, no new secret.
