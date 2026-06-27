## Why

The operator already has a `/health` endpoint and a README badge for background-job health, but the one surface they authenticate into — the `/admin` panel behind Cloudflare Access — never shows it. To check whether the flyer warm, recipe index/embed, email handler, and D1 are healthy, they have to leave the panel and `curl /health` or read the public badge. Surfacing that state as the panel's homepage makes operational health glanceable from the place the operator already is.

## What Changes

- **New Status homepage** at `/admin` that renders the existing `/health` aggregate payload: an overall healthy/degraded headline, one row per registered job (`flyer-warm`, `recipe-index`, `recipe-embed`, `email`) showing its state and last-run age, the per-job `summary` detail, the D1 reachability row, and the **admin-gate posture** section (`access_configured` / `email_allowlist` / `dev_bypass_set` / `exposed`) that `/health` now reports.
- **Reflexive gate check.** Because `/health` surfaces whether the operator admin surface is correctly gated or dangerously `exposed`, the panel — which the operator views *through* that very Cloudflare Access gate — shows the operator whether their own gate is configured right. An `exposed` posture is rendered as a prominent warning, mirroring the loud-signal intent of the public badge's red `admin` row.
- **Member management moves to a `/admin/members` tab.** The panel's nav becomes three peers — **Status** (home), **Members**, **Dev · Tools** — instead of Members-at-root. No member operation changes; only its route and nav placement.
- **The panel fetches the existing open `/health` directly** (same-origin) and **decodes the response body on `503` as well as `200`** — `/health` returns `503` when a job is failing, the D1 probe fails, **or the admin gate is `exposed`**, and that response still carries the full JSON payload. A degraded read is treated as *data* (a `Success` holding a payload whose `ok` is false), not a transport error; only a network failure or an undecodable body (e.g. a `403` from an expired Access session) is an error. This replaces Elm's default `expectJson` (which discards every non-2xx body) with a body-preserving `expectStringResponse` — without it, an `exposed` gate (the most alarming state) would render as a generic HTTP error instead of the warning the operator needs.
- **No Worker/TS changes.** The `/health` contract is unchanged and reused as-is; this is an Elm-only change plus its spec delta.

## Capabilities

### New Capabilities

<!-- None. The Status view is part of the existing operator-admin surface. -->

### Modified Capabilities

- `operator-admin`: adds a requirement that the admin panel presents the aggregate `/health` payload — background-job health, the D1 probe, and the admin-gate posture (including a prominent `exposed` warning) — as its operator-facing homepage, rendering the degraded (`503`) payload rather than dropping it, and that member management is reached as a tab rather than at the panel root.

## Impact

- **Elm SPA (`admin/`):** new `admin/src/Status.elm` (page model, body-preserving `/health` fetch + decoders, view); `admin/src/Route.elm` (new home route → Status; Members → `/admin/members`); `admin/src/Main.elm` (new page/msg variants, three-tab nav); `admin/tests/` (route parsing for the reorg + a decode test that a `503` body becomes a `Success` degraded payload).
- **Generated bundle:** `admin/dist/` must be rebuilt (`aubr build:admin`), which needs `package.elm-lang.org` reachable; if the build host can't reach it, CI rebuilds rather than committing a stale bundle.
- **Consumes (does not modify)** the `background-job-health` capability's open `/health` endpoint — including the `admin` posture section added by the recently-landed `harden-admin-access-gate` change. No `src/**`, `wrangler.jsonc`, or D1 changes; no new bindings or secrets.
