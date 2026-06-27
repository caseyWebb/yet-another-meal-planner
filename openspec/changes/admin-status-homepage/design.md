## Context

The Worker already serves an open, tenant-data-free `/health` endpoint (the `background-job-health` capability): an aggregate of each registered job's state (`flyer-warm`, `recipe-index`, `recipe-embed`, `email`), each with `ok` / `null`-never-run, `last_run_at`, and a free-form `summary`, plus a live D1 reachability probe. It returns `200` when healthy and `503` when a job is failing (so plain HTTP monitors trip), and there is also a `/health.svg` README badge. None of this is visible inside the `/admin` operator panel — an Elm `Browser.application` behind Cloudflare Access, today organized as an **Admin** area (member management, at the panel root) and a **Dev** area (the tool console).

This change makes background-job health the panel's home view and relocates member management to its own tab. The panel discipline is `admin/CLAUDE.md`'s "make impossible states impossible": remote reads are `RemoteData`, finite states are unions, no `Bool`/`Maybe String` smearing.

## Goals / Non-Goals

**Goals:**
- Surface the `/health` aggregate as the panel's home route, glanceable from where the operator already authenticates.
- Render the **degraded** (`503`) payload — the state the operator most wants — rather than dropping it.
- Relocate member management to a `/admin/members` tab; nav becomes Status / Members / Dev · Tools.
- Reuse the existing endpoint with **zero Worker/TS changes**.

**Non-Goals:**
- No new `/admin/api/health` route, no Worker code, no new binding/secret.
- No change to the `/health` contract, the `/health.svg` badge, or `background-job-health`.
- No live polling (a deferred follow-up) and no change to the member operations themselves.

## Decisions

### Fetch the open `/health` directly (not a gated `/admin/api/health`)

The panel calls same-origin `/health` from the Status page. The endpoint is already open and tenant-data-free, so no gateway wrapper is needed; the page loaded behind Access can fetch the public path with no CORS and no new route. **Alternative considered:** a gated `/admin/api/health` that wraps `buildHealthPayload` and always returns `200`. Rejected — it adds Worker surface to re-expose data that is already safely public, for no gain once the body-preserving fetch (below) handles the `503`.

### Body-preserving fetch: `expectStringResponse`, not `expectJson`

Elm's `Http.expectJson` discards the body on any non-2xx, so a `503` would arrive as a bare `BadStatus 503` — losing exactly the per-job detail we want. The Status page uses `Http.expectStringResponse` with a custom handler that decodes the JSON body on **both** `GoodStatus_` (200) and `BadStatus_` (503):

```
GoodStatus_ _ body  ─┐
                     ├─▶ decodeString healthDecoder body
BadStatus_  _ body  ─┘      ├─ Ok payload → Ok payload      (success, possibly ok:false)
                            └─ Err _      → Err (BadStatus statusCode)
NetworkError_ / Timeout_ / BadUrl_ ──────▶ Err (mapped Http.Error)
```

Decoding is keyed on **decode success, not status code**: a `503` from `/health` always carries the payload (it decodes → success), while a `403` HTML page from an expired Access session does not (→ `BadStatus 403`, a real error). **Alternative considered:** branch on the status code (treat exactly 200/503 as "has body"). Rejected — decode-or-fail is simpler and correctly handles any future status that carries a valid payload, and any that doesn't.

### Degraded is *data* (`Success ok:false`), not a transport `Failure`

The fetch result is `WebData HealthPayload`. A decoded payload — healthy or degraded — is `Success`; only network/decode failures are `Failure`. The healthy-vs-degraded headline derives from `payload.ok`, never from the HTTP layer. This cleanly separates "the service is degraded" (a successful read of bad news) from "I couldn't reach the service" (an error), and means the most important view state is a normal `Success` render, not an error path.

### Collapse the job shape into a `JobState` union at the decode boundary

`/health`'s per-job JSON is the smeared shape `admin/CLAUDE.md` warns against — `{ ok: boolean | null, never_run?: true }` (three legal states across two fields). The decoder maps it to one union so impossible combos can't exist downstream:

```
ok = Just True  → Healthy
ok = Just False → Failing
ok = Nothing    → NeverRun     (never_run:true corroborates)
```

The view then case-matches `Healthy | Failing | NeverRun` exhaustively. **Alternative:** carry `ok : Maybe Bool` + a `neverRun : Bool` in the model and guard in the view. Rejected — that is the exact antipattern the panel exists to avoid.

### Status is a new top-level module + home route; Members relocates

A new `admin/src/Status.elm` owns the page (model `{ health : WebData HealthPayload }`, the decoders, the fetch, the view). `Route` gains a `Health` variant mapped to `/admin` (and `/`); `Members` moves to `/admin/members`. `Main` gains `HealthPage` / `HealthMsg`, lands on Status at init, and renders a three-link nav. **Alternative:** keep an "Admin area" grouping Status + Members behind a sub-nav. Rejected — the user wants Members as a peer tab, and three flat top-level areas matches the existing "a surface is its own routed module" rule.

### Render `summary` generically

The per-job `summary` is `Record<string, unknown>`, heterogeneous per job. The page decodes it as `Dict String Json.Decode.Value` and renders each entry as `key: <encoded value>`, so new summary fields (e.g. flyer-warm's sweep-freshness timestamp) appear with no panel change. **Alternative:** typed per-job summary decoders. Rejected — couples the panel to each job's internal summary shape; generic rendering is future-proof. **Alternative:** omit summary (mirror the badge's state+age only). Rejected — the spec calls out sweep freshness as the monitor's key signal, and it lives in `summary`.

### Refresh: load-on-open + a manual button

`init` fires the fetch; a "Refresh" button re-fires it. **Alternative:** `Time.every 60s` polling (matching the badge's TTL). Deferred — `Main` currently wires `subscriptions = always Sub.none`, so polling would need `Main` to thread the live page's subscriptions; out of scope for this change but an easy follow-up.

## Risks / Trade-offs

- **Elm build needs `package.elm-lang.org`** → the committed `admin/dist/` bundle must be rebuilt (`aubr build:admin`); if the build host can't reach the package server, leave the rebuild to CI and do **not** commit a stale bundle (per `admin/CLAUDE.md`).
- **Panel now depends on the `/health` JSON shape** (a cross-capability coupling to `background-job-health`) → pin it with a decode test (a healthy `200` body and a degraded `503` body), so a future shape change surfaces as a failing test rather than a silent blank view.
- **Generic `summary` rendering is unpolished** (raw epoch timestamps, raw values) → acceptable for this pass; known keys can be prettified later without a contract change.
- **`/admin` now shows Status, not member management** → a bookmark to the old root lands on Status; member management is one click away at `/admin/members`. Minor, intended UX change.

## Open Questions

- Home-tab label: **Status** (chosen) vs "Health". One-word change if preferred.
- Whether to prettify known `summary` keys (e.g. format the sweep-freshness timestamp) now or in the polling follow-up. Defaulted to generic-only for this change.
