## Why

Paid, bot-walled recipe sources (NYT Cooking, Bon Appétit/Epicurious, Serious Eats, America's Test Kitchen) are the ones members actually subscribe to — yet the Worker can never ingest them: `acquireRecipeContent` runs from the Cloudflare edge and every walled fetch returns `unreachable`. The `acquire` fetch is the *only* step of the discovery pipeline that fails on these sources; classify, taste-match, dedup, attribution, and import are all source-agnostic. If a component running on the operator's **home network** — where the operator's own authenticated subscription session lives — did the fetch+extract and handed back the parsed recipe, the whole back half of the sweep would work unchanged. This keeps automated access to gated content strictly off the operator's cloud infrastructure and on their own machine with their own session, which is the point.

## What Changes

- **New home-network scraper component** (a Docker container, one machine = one API key, configured with many sources). It authenticates to each paid site with the operator's own session, extracts recipes deterministically to the wire-contract shape, and POSTs them in batches. It never runs in the Worker or the cloud.
- **New Worker ingest endpoint** `POST /admin/api/ingest` — bearer-authed with an operator-minted **ingest key** (a deliberate, key-authenticated **carve-out from the Cloudflare Access gate** on `/admin*`, since a headless scraper has no Access JWT). It validates a batch payload, dedups on arrival, and persists accepted candidates for the sweep.
- **New ingest-key roster** (mint-once secret, hash + prefix stored, per-machine, revocable) managed from the admin panel.
- **The discovery sweep gains a push intake arm.** A pushed candidate carries its pre-parsed content, so `acquireContent` returns it instead of fetching (**skips acquire**); everything downstream (triage, classify, describe/embed, dedup, taste-match, confirm, import, attribution, logging, retry) is the existing pipeline. Pushed candidates are taste-matched and governed identically to feed candidates — no special attribution.
- **Walled sources become scraper-owned, not Worker `feeds`** — a walled source must not be polled by the Worker (it would only park `unreachable` and its evaluated-log row would suppress the later real push).
- **Admin gains configuration + observability** — a Config › Ingest Keys editor (mint/revoke) and a Discovery › Scrapers sub-tab (per-machine liveness in the `/health` fresh/stale/never posture, contract-version skew, throughput funnel, recent-pushes log), plus a Status page scraper section and pushed-candidate provenance in the Discovery pipeline view.
- **Monorepo restructure** — the repo becomes an `aube`/npm-workspaces monorepo with a shared, **workerd-pure** contract package the Worker and the scraper both import (the recipe-parse spine + the ingest wire types), so the parse and the payload shape can never drift between the two runtimes.
- **CI + distribution** — workspace-aware CI (typecheck/test every package), and the scraper published as a **container image to GHCR** with a **GitHub Release** per scoped `scraper-v*` tag, independent of the Worker deploy, using the built-in `GITHUB_TOKEN` (no new Actions secrets).

## Capabilities

### New Capabilities
- `recipe-ingestion`: the `POST /admin/api/ingest` endpoint, the batch wire contract + arrival dedup + error/result taxonomy, the ingest-key roster (mint/hash/prefix/revoke/last-used + reported scraper/contract version), and the pushed-candidate intake table the sweep drains.
- `walled-source-scraper`: the home-network container — the source-adapter plugin model (auth / discover / extract), the tiered fetch runtime (plain-HTTP default, headless-browser escalation), session capture (`login`/cookie-import) and the `auth_expired` liveness signal, batch-and-push with backoff, and the operator CLI verbs + Docker packaging.

### Modified Capabilities
- `discovery-sweep`: intake gains a **pushed-content arm** whose candidates skip the acquire fetch (content pre-attached) and whose retries never re-fetch (content persists); a pushed candidate supersedes a prior `unreachable` park for the same URL; walled sources are scraper-owned rather than polled feeds.
- `operator-admin`: a new Config › Ingest Keys editor and a Discovery › Scrapers observability sub-tab (+ Status section + pushed-candidate provenance); and the Access gate gains one exemption — `/admin/api/ingest` is ingest-key-authed, not Access-authed.
- `build-automation`: CI becomes workspace-aware, and a tagged scraper release builds + publishes the container image to GHCR and cuts a GitHub Release, gated independently of the Worker deploy.
- `repo-structure`: the code repository becomes a workspaces monorepo with a shared workerd-pure contract package consumed by both the Worker (workerd) and the scraper (Node).

## Impact

- **New packages:** `packages/contract` (shared, workerd-pure), `packages/scraper` (Node + Playwright); the Worker moves to `packages/worker` (or stays at root — resolved in design).
- **Worker code:** `src/index.ts` (route + Access-exemption), a new `src/ingest.ts` + `src/ingest-db.ts` (endpoint, key auth, arrival dedup), `src/discovery-sweep.ts` + `src/discovery-db.ts` (push intake arm, `pushed`/`origin` on `discovery_log`, skip-acquire, retry-without-refetch), `src/health.ts` (per-scraper liveness), `src/admin/**` (Ingest Keys island + Scrapers view + Status section + Discovery badges).
- **D1:** new `ingest_keys` and `ingest_candidates` tables (+ migrations); `pushed`/`origin` columns on `discovery_log`.
- **Docs:** ARCHITECTURE (the scraper intake arm + the scraper-owned-not-feeds rule), SCHEMAS (`ingest_keys`, `ingest_candidates`, `discovery_log` columns), SELF_HOSTING (run the scraper, mint a key, capture a session), plus TOOLS unchanged (no new MCP tool).
- **CI/CD:** `ci.yml` path filters move under the workspace; a new scraper release workflow; GHCR package + GitHub Releases.
- **Security surface:** a non-Access, key-authenticated route under `/admin/*` — must be an explicit allowlisted exemption, rate-limited, and constant-time-compared, or it widens the admin attack surface.
