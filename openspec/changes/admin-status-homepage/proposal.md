## Why

The operator already has a `/health` endpoint and a README badge for background-job health, but the one surface they authenticate into — the `/admin` panel behind Cloudflare Access — never shows it. To check whether the flyer warm, recipe index/embed, email handler, and D1 are healthy, they have to leave the panel and `curl /health` or read the public badge. Surfacing that state as the panel's homepage makes operational health glanceable from the place the operator already is.

## What Changes

- **New Status homepage** at `/admin` that renders the existing `/health` aggregate payload: an overall healthy/degraded headline, one row per registered job (`flyer-warm`, `recipe-index`, `recipe-embed`, `email`) showing its state and last-run age, the per-job `summary` detail, and the D1 reachability row.
- **Member management moves to a `/admin/members` tab.** The panel's nav becomes three peers — **Status** (home), **Members**, **Dev · Tools** — instead of Members-at-root. No member operation changes; only its route and nav placement.
- **The panel fetches the existing open `/health` directly** (same-origin) and **decodes the response body on `503` as well as `200`** — `/health` returns `503` when a job is failing, which carries the full JSON payload. A degraded read is treated as *data* (a `Success` holding a payload whose `ok` is false), not a transport error; only a network failure or an undecodable body (e.g. a `403` from an expired Access session) is an error. This replaces Elm's default `expectJson` (which discards every non-2xx body) with a body-preserving `expectStringResponse`.
- **No Worker/TS changes.** The `/health` contract is unchanged and reused as-is; this is an Elm-only change plus its spec delta.

## Capabilities

### New Capabilities

<!-- None. The Status view is part of the existing operator-admin surface. -->

### Modified Capabilities

- `operator-admin`: adds a requirement that the admin panel presents the aggregate background-job health (`/health`) as its operator-facing homepage — including rendering the degraded (`503`) payload rather than dropping it — and that member management is reached as a tab rather than at the panel root.

## Impact

- **Elm SPA (`admin/`):** new `admin/src/Status.elm` (page model, body-preserving `/health` fetch + decoders, view); `admin/src/Route.elm` (new home route → Status; Members → `/admin/members`); `admin/src/Main.elm` (new page/msg variants, three-tab nav); `admin/tests/` (route parsing for the reorg + a decode test that a `503` body becomes a `Success` degraded payload).
- **Generated bundle:** `admin/dist/` must be rebuilt (`aubr build:admin`), which needs `package.elm-lang.org` reachable; if the build host can't reach it, CI rebuilds rather than committing a stale bundle.
- **Consumes (does not modify)** the `background-job-health` capability's open `/health` endpoint. No `src/**`, `wrangler.jsonc`, or D1 changes; no new bindings or secrets.
