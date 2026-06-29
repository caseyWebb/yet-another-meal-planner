## Context

The operator Usage page (`/admin/usage`) is fully broken on a configured deployment: every panel shows `HTTP 500`. Two independent defects stack:

1. **`src/usage.ts` rebinds `this` on the global `fetch`.** `defaultDeps` is `{ fetchImpl: fetch, now: … }` (line 166); the three fetchers call it as `deps.fetchImpl(...)` (lines 183, 328, 434). Invoking a method off an object sets `this` to that object, and `workerd`'s `fetch` rejects a non-global `this` with *"Illegal invocation: function called with incorrect `this` reference."* The thrown error is caught and mapped to `upstream_unavailable` → HTTP 500.

2. **`admin/src/Usage.elm` throws away the error body.** All three panels fetch with `Http.expectJson`, which collapses any non-2xx into `Http.BadStatus Int` — the response **body is discarded before Elm sees it**. The Worker already returns a helpful `{ error, message }` body (`admin.ts:722`, `ToolError.toShape()`), but `httpError` (line 759) only has the status code, so it renders `"HTTP 500"`. The real message is reachable only via the browser console.

Blast radius for defect 1 is confirmed to be `usage.ts` alone. Every other egress site calls `fetch` as a **bare identifier** (`fetchImpl(...)` from a default parameter in `http.ts`/`weather.ts`/`health.ts`/`recipe-acquire.ts`, or `doFetch(...)` from a local in `kroger.ts`/`kroger-user.ts`), which leaves `this` undefined — and `workerd` permits an undefined `this`, only rejecting a *wrong-object* `this`. Only `usage.ts` stores `fetch` on an object and calls it as a method.

## Goals / Non-Goals

**Goals:**
- Restore all three usage endpoints on a configured deployment (fix the `this` binding).
- Add a regression guard that can actually catch this class of bug (the current tests inject `fetchImpl`, so they never run the real default).
- Make the Usage page render the upstream `message` + error code on any failure, so the operator never needs the console. Model it as a typed error per `admin/CLAUDE.md` ("make impossible states impossible").

**Non-Goals:**
- No repo-wide sweep or refactor of the other `fetchImpl`/`doFetch` sites — they are not affected, and changing them would be churn.
- No change to the wire contract: the `{ error, message }` body and the `upstream_unavailable` code are unchanged. No new binding, secret, or migration.
- No change to the `not-configured` / success rendering paths.

## Decisions

**D1 — Fix the binding once in `defaultDeps`, not at each call site.**
Set `fetchImpl: fetch.bind(globalThis)` (equivalently an arrow wrapper `(input, init) => fetch(input, init)`). One edit covers all three fetchers because they share `defaultDeps`, and it keeps the injectable-deps testing seam intact (tests still pass their own `fetchImpl`). Alternative — calling `deps.fetchImpl.call(globalThis, …)` at each of the three sites — was rejected: three edits, easy to miss a fourth future site, and it leaves the footgun in `defaultDeps` for the next reader.

**D2 — Regression guard invokes the default `fetchImpl` detached.**
A unit test that grabs `const f = defaultDeps.fetchImpl` (or otherwise calls it without `defaultDeps` as the receiver) against a stub global and asserts it does not throw an incorrect-`this` error. This is the seam the existing tests bypass by always injecting a mock. To make `defaultDeps` reachable from the test, export it (or a small accessor) from `usage.ts`. Alternative — an integration test against `wrangler dev` — was rejected as too heavy for a one-line binding invariant.

**D3 — Decode the error body with `Http.expectStringResponse`, into a typed error.**
Replace `Http.expectJson` with a custom expectation that, on `BadStatus_ metadata body`, decodes the `{ error, message }` JSON into a domain error and preserves it (and on `GoodStatus_` runs the existing JSON decoder). The failed state carries a typed value — e.g. a `UsageError` union with an `UpstreamError { code : String, message : String }` variant plus the transport cases — **not** `Maybe String` and **not** the status-only `Http.BadStatus`. This satisfies the `admin/CLAUDE.md` prime directive: the error and its content cannot be in contradictory states.

**D4 — One shared error renderer + decoder across the three panels.**
The three panels (`viewBody`, `viewTrends`, `viewTools`) share identical failure handling, so the custom expect, the body decoder, and the failure renderer are written once and reused. The existing `httpError` helper is extended/replaced to render the typed error (transport cases keep their friendly strings; the new upstream case prints `message` + `error`).

**D5 — Show full upstream detail; no redaction.**
The page is behind the `/admin*` Cloudflare Access gate and is operator-only; the user confirmed there is no privacy/security concern. So the raw upstream `message` is rendered verbatim — the whole point is diagnosability.

## Risks / Trade-offs

- **[`fetch.bind(globalThis)` vs arrow wrapper differ subtly under mocking]** → Both preserve the injectable seam (tests override `fetchImpl` wholesale). Pick whichever reads cleaner; the regression guard (D2) pins the behavior either way.
- **[Elm bundle drift]** → `admin/dist/` is generated and committed; a stale bundle ships an old UI. `aubr build:admin --check` is the CI drift gate. The Elm compiler needs `package.elm-lang.org` reachable — if the build box can't reach it, leave the rebuild to CI and say so rather than committing a stale bundle.
- **[A non-JSON error body]** (e.g. an HTML 502 from an edge proxy, or the 403/404 Access cases) → the body decoder must fall back gracefully: if the body isn't `{ error, message }`, render the status with whatever text is present rather than failing the decode. The existing 403/404 friendly cases are preserved.
- **[Over-scoping the fix]** → Tempting to "fix all the `fetchImpl: fetch` patterns". They are not bugs (bare-call `this` is undefined, which `workerd` allows); touching them is churn and risk. Hold the line at `usage.ts`.

## Migration Plan

No data or contract migration. Deploy is the normal `main`-merge path (Worker-relevant `src/**` change → auto-deploy). Rollback is a straight revert; no state is written. The Elm change requires the regenerated `admin/dist/` bundle to be committed in the same change.

## Open Questions

- None blocking. (Binding style D1 and the exact `UsageError` variant names are implementation taste, pinned by the tests and the spec scenarios.)
