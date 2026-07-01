## Context

The discovery sweep (`src/discovery-sweep.ts`) turns feed/email candidates into imported recipes through one pipeline: **acquire → classify → describe/embed → dedup → match → confirm → import**. Only the first step, `acquireRecipeContent` (`src/recipe-acquire.ts` → `fetchWithBrowserHeaders`), fails on paid, bot-walled sources — it runs from the Cloudflare edge and every walled fetch returns `unreachable`. Everything after acquire is source-agnostic and already reused across the sweep, `parse_recipe`, and the operator feed-probe. Crucially, the sweep's `DiscoveryDeps.acquireContent` is **already an injectable seam**, and `SweepCandidate` is a plain struct — the architecture was built with the exact hook this feature needs.

The operator subscribes to (and pays for) these sources and wants their recipes in the existing meal-planning system. The legal posture the operator has chosen: automated access to gated content runs **on the operator's own machine with the operator's own session**, never on the cloud Worker — no different in kind from saving a page and sending it to a friend, just durable. The Worker only ever receives already-parsed **functional facts** (ingredients/steps/times/source), not the publisher's prose or images.

The admin surface for this feature is already designed (handoff mockup: `IngestScreen.jsx`/`ScrapersView`, `ingest-data.jsx`, `ConfigScreen.jsx`→`IngestKeys`, `discovery-data.jsx`, `DiscoveryScreen.jsx`, `StatusScreen.jsx`), so this design treats those screens as the contract for the admin work.

## Goals / Non-Goals

**Goals:**
- Ingest walled-source recipes through the **existing** sweep with no special-casing past the acquire seam — pushed candidates are taste-matched and governed exactly like feed candidates.
- Keep all walled fetching off the cloud, on the operator's network, behind their own session.
- A shared, drift-proof contract (parse spine + wire types) between the two runtimes (workerd Worker, Node scraper).
- First-class observability of a component the operator can't see (a home box behind NAT): per-machine liveness, contract skew, throughput, recent pushes.

**Non-Goals:**
- No new MCP tool (the tool surface is unchanged; this is an operator/infra feature).
- No synchronous classify/import on the ingest request (that reintroduces the subrequest/CPU budget problems the sweep exists to avoid).
- No per-site extraction logic in the Worker (that fragility lives entirely in the scraper).
- No login automation / bot-detection defeat as a default capability (session-replay + render only; see Risks).
- No force-attribution or "personal recipe box" — the operator confirmed this is a firehose through the same pipeline.

## Decisions

### 1. The scraper is a remote `acquire` arm; pushed candidates skip only the fetch

A pushed candidate carries its pre-parsed content and enters the sweep with `acquireContent` returning that content instead of fetching. `SweepCandidate` gains an optional attached-content field; the fresh-intake loop still triages/classifies/matches it normally. This maximizes reuse (dedup, rate cap, classify cap, attribution, `discovery_log`, retry, the admin Discovery view) and means the pipeline literally cannot distinguish a pushed candidate from a feed candidate after acquire.

*Alternatives considered:* (a) **Synchronous import at POST time** — rejected: needs `env.AI` on the request path and fresh index/embeddings, exactly what the cron owns. (b) **A parallel pushed-content pipeline** — rejected: duplicates the whole back half and its governance.

### 2. Wire contract = a subset of `parse_recipe`'s output, in a shared workerd-pure package

The payload item is `{ title, ingredients[], instructions[], source, summary?, servings?, time_total?, time_active? }` — what the sweep's `RecipeContent` already needs plus identity. The recipe-parse spine (`jsonld.ts` + `normalizeRecipe`) and the ingest wire types/validators move to `packages/contract`, **workerd-pure** so the Worker keeps using them and the scraper imports the same code. The scraper may stack Playwright/cheerio on top, but the shared shape can't drift.

*Alternatives considered:* (a) **Post raw HTML, parse in the Worker** — rejected: walled pages often bury/omit JSON-LD and per-site DOM fragility would land in the Worker. (b) **Post fully-classified `create_recipe` frontmatter** — rejected: classification is an `env.AI`/vocab step that belongs on the Worker; the scraper would need a model and duplicate the vocab. (c) **protobuf/gRPC** — rejected: workerd is an awkward gRPC *server*, the payload is a small fire-and-forget enqueue, and a shared TS package gives the type safety without the machinery.

### 3. Auth = per-machine ingest keys, as the HTTP analog of the sender/member allowlist

The email path already has the trust model: `discovery_senders`/`discovery_members` gate untrusted mail by DKIM. An ingest key is the HTTP analog — an **operator-issued ingestion credential** (same posture as the cron/admin surface), one per machine, that establishes trust. Because the key establishes trust, `source` is just trusted provenance data the Worker records, not an allowlist. Keys are stored **hashed + a display prefix**, compared constant-time, minted-once, revocable.

*Alternatives considered:* (a) **OAuth tenant token** — rejected: OAuth is for interactive Claude.ai consent, not a headless box; the scraper isn't a tenant. (b) **Per-source keys** — rejected: a machine is one binary with one version; per-source keys fragment liveness and versioning. Source travels in the payload, so per-`(machine, source)` liveness still works with one key.

### 4. Endpoint at `POST /admin/api/ingest` as a key-authed Access carve-out

Per the design handoff, the route lives under `/admin/api/` but is authenticated by the ingest key, **not** Cloudflare Access (a headless scraper has no Access JWT). This is a deliberate, **single-path exemption**: the admin app middleware must exempt exactly `POST /admin/api/ingest` and apply key-auth there, leaving every other `/admin*` path Access-gated. This is the sharpest edge in the change (a non-Access route under `/admin*`) and is treated as security-critical: allowlist the exact path+method, constant-time key compare, rate-limit, and never let an ingest key reach any other admin operation.

*Alternative considered:* a top-level `POST /ingest` outside `/admin`. Cleaner isolation from the Access gate, but the handoff deliberately co-locates it with the admin surface that manages the keys and observes it; honored, with the exemption made explicit and narrow in the spec.

### 5. Two new tables; `discovery_log` gains provenance; arrival dedup supersedes walled parks

- `ingest_keys` — the key roster (hash, prefix, label, created, last_used, status, last-reported scraper/contract version).
- `ingest_candidates` — the pushed-content inbox (pre-parsed content, canonical source URL, `origin`, minting key id, received_at), mirroring the email `discovery_candidates` inbox: async arrival, drained by the sweep's `loadCandidates`.
- `discovery_log` gains `pushed` + `origin` columns so the Discovery view badges pushed candidates and renders `acquire` as arrived-via-push.

Arrival dedup reuses the sweep's dedup sets (corpus `source_url`, `discovery_rejections`, evaluated log, in-flight inbox), with **one exception**: a URL whose only prior outcome is a walled acquisition park is admitted and supersedes it — otherwise the Worker's own earlier `unreachable` park would suppress the real push forever. The corollary is a rule, not just code: **a walled source must not also be a Worker `feed`** (it would double-discover and park).

### 6. Scraper internals: adapter plugin model + tiered fetch + decoupled session capture

- **Adapters** are `{ authenticate, discover, extract }`. Base adapters ship in the image; operator adapters load from a mounted dir at runtime; all receive an injected SDK including the shared parse, so most sources are config-only (sitemap + JSON-LD) and custom `extract` is the exception.
- **Fetch is tiered**: plain HTTP + cookie replay by default; a Playwright/Chromium (CDP, not WebDriver) tier only for sources that declare they need rendered DOM, reusing one browser process with per-source contexts. The recurring daemon stays headless/browserless for plain-HTTP sources.
- **Session capture is decoupled** from the daemon (the Docker reality): capture on a machine with a display (`login`, headful) or by cookie-import, producing a `storageState` file on the mounted volume the daemon reads read-only. Expiry surfaces as `auth_expired` in the push/heartbeat so the admin liveness view distinguishes dead-box vs expired-session vs broken-adapter — the #1 operational failure mode made visible. noVNC-in-container login is the fallback for NAS-only operators and for IP/device-bound sessions (same egress IP).
- **Strip to functional facts** at extraction — both the corpus shape and the legal posture.

### 7. Distribution: container to GHCR + GitHub Release on `scraper-v*`, workspace-aware CI

The scraper ships as a **container image** (Playwright + a persistent session profile + cron = Docker's sweet spot; a single-file binary can't cleanly embed a browser). A scoped `scraper-v*` tag builds the image, pushes to GHCR, and cuts a GitHub Release — in the public code repo, using the built-in `GITHUB_TOKEN` (no new secret), **independent** of the Worker deploy control plane. The image embeds its build + targeted contract version, reported on every push → the admin skew chip. CI becomes workspace-aware; a shared-contract change fans out to both sides.

## Risks / Trade-offs

- **A non-Access route under `/admin*`** → Mitigation: exempt exactly `POST /admin/api/ingest`, constant-time key compare, rate-limit, reject any ingest key on any other admin path; `/health` posture unaffected. Consider a top-level `/ingest` if the carve-out proves fragile.
- **Legal/robustness of walled access** → Mitigation: default to **session-replay + render** (do a logged-in human's fetch), never login-automation or bot-detection defeat; credentials never in the image/config (only an operator-captured session file); strip to functional facts. The fingerprint-matching fetch tier is deliberately out of v1.
- **A silent home box looks healthy** → Mitigation: per-machine `fresh/stale/never` + `auth_expired` in Status and Discovery › Scrapers; a stale/skew scraper warns on the Candidates ingest strip too.
- **Contract drift between runtimes** → Mitigation: one shared workerd-pure package for parse + wire types; contract-version reported and skew-flagged; CI fans a contract change to both sides.
- **Double-discovery (feed + push)** → Mitigation: the "walled sources are scraper-owned, not feeds" rule + arrival-dedup supersede of walled parks.
- **Monorepo restructure churn / heavy scraper deps leaking into the Worker** → Mitigation: workspace isolation; the restructure is staged as Phase 0 and can keep the Worker at its current path initially if a full move is too risky (resolved in tasks).
- **A bulk backfill floods the corpus** → Mitigation: the existing `rateCap`/`classifyMaxPerTick` governor drains pushed candidates over many ticks exactly as it does feeds; nothing new needed.

## Migration Plan

1. **Phase 0 — monorepo + contract package.** Introduce workspaces; extract the parse spine + wire types into `packages/contract` (workerd-pure); the Worker imports from it. No behavior change.
2. **Phase 1 — Worker ingest.** `ingest_keys` + `ingest_candidates` migrations; `pushed`/`origin` on `discovery_log`; the `/admin/api/ingest` endpoint + key auth + arrival dedup; the sweep acquire seam + provenance + retry-without-refetch. Ship behind "no keys minted ⇒ inert."
3. **Phase 2 — admin.** Config › Ingest Keys island; Discovery › Scrapers SSR view + ingest strip + pushed badges/progression; Status scrapers section; per-scraper health in `src/health.ts`.
4. **Phase 3 — scraper package.** Core (scheduler/dedup/batch/push) + SDK + base adapters + tiered fetch + session capture + CLI verbs; container + CI release to GHCR/Releases.
5. **Docs in lockstep** each phase (ARCHITECTURE/SCHEMAS/SELF_HOSTING).

**Rollback:** revoke all ingest keys (endpoint goes inert); the sweep's push arm no-ops with an empty `ingest_candidates`; the scraper is external and simply stopped. The migrations are additive (new tables, new nullable columns) and safe to leave in place.

## Open Questions

- **Worker relocation depth in Phase 0** — full move to `packages/worker/` vs keep the Worker at root and add `packages/{contract,scraper}` only. Leaning to the pragmatic split (Worker stays put initially, contract extracted) to bound blast radius; confirm in apply.
- **Key CRUD home** — the handoff points at `src/operator-config.ts`; a dedicated `src/ingest-db.ts` (through `src/db.ts`) may be cleaner given it's a roster, not a singleton. Decide at apply.
- **Fresh-window default** — the mock uses 6h; confirm the real threshold (and whether it's operator-tunable via `operator_config`).
- **Source identity** — `source` as a free-text label (mock) vs a light per-scraper registered set. Free-text is simpler and matches "trusted key ⇒ source is data"; keep unless the admin views need canonical grouping.
