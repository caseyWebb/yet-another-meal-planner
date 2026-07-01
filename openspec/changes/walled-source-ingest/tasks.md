## 1. Monorepo + shared contract (Phase 0)

- [ ] 1.1 Introduce `aube`/npm workspaces in the root `package.json` (+ lockfile) with a `packages/*` layout; keep `aube ci`/`aubr` working and the session-start hook shims intact.
- [ ] 1.2 Create `packages/contract` as a **workerd-pure** package (no Node-only deps); add its typecheck/test wiring.
- [ ] 1.3 Move the recipe-parse spine (`jsonld.ts` extraction + `normalizeRecipe`) into `packages/contract`; re-point the Worker (`recipe-acquire.ts`, `parse_recipe`, sweep) at it with no behavior change; keep tests green.
- [ ] 1.4 Define the ingest **wire contract** in `packages/contract`: the batch envelope `{ source, scraper_version, contract_version, recipes[] }`, the recipe item shape, a `CONTRACT_VERSION` constant, and a shared validator + the result/error taxonomy (`accepted | deduped | rejected`, `bad_payload`/`bad_key`).
- [ ] 1.5 Resolve the Worker's package home (relocate to `packages/worker` vs keep at root) per the design's open question; update paths/imports accordingly.

## 2. Worker ingest endpoint + keys (Phase 1)

- [ ] 2.1 Migration: `ingest_keys` table (id, label, key_hash, key_prefix, created_at, last_used_at, status, last_scraper_version, last_contract_version).
- [ ] 2.2 Migration: `ingest_candidates` table (id, canonical_url, content JSON, origin, key_id, received_at, status) — the pushed-content inbox.
- [ ] 2.3 Migration: add `pushed` + `origin` columns to `discovery_log`.
- [ ] 2.4 `src/ingest-db.ts` (through `src/db.ts`): key mint (hash + prefix, secret returned once), revoke, constant-time lookup-by-secret, `last_used`/version update; pushed-candidate insert + read + delete; the derived per-scraper/per-source liveness rollup (fresh/stale/never + skew).
- [ ] 2.5 `src/ingest.ts`: the `POST /admin/api/ingest` handler — key auth, envelope+item validation against the shared contract, arrival dedup (corpus/rejections/evaluated-log/in-flight inbox, with the walled-park supersede exception), persist accepted candidates, and the `{ received, accepted, deduped, rejected, results }` response; rate-limit the route.
- [ ] 2.6 `src/index.ts` / admin app: route `POST /admin/api/ingest` as an **explicit key-authed exemption** from the Access gate (exact path+method only; all other `/admin*` stay Access-gated; an ingest key on any other admin path → 403).

## 3. Sweep push-intake arm (Phase 1)

- [ ] 3.1 Extend `SweepCandidate` with optional attached pre-parsed content; make `buildDiscoveryDeps.loadCandidates` read `ingest_candidates` as a third source and emit pushed candidates.
- [ ] 3.2 Make `acquireContent` return the attached content for a pushed candidate (no fetch); ensure triage/classify/dedup/match/import run unchanged.
- [ ] 3.3 Record `pushed`/`origin` on the `discovery_log` row for pushed candidates (via `discovery-db.ts`).
- [ ] 3.4 Pushed-candidate retry semantics: a transient classify/infra failure re-runs classification from stored content (no re-fetch); a contract-invalid classification parks terminally; delete the `ingest_candidates` row once terminal/imported.
- [ ] 3.5 Enforce "walled sources are scraper-owned, not feeds" (guard/validation so a walled push URL supersedes a prior `unreachable` park and is not re-dropped as evaluated).
- [ ] 3.6 Unit tests for the push arm (in-memory deps): skip-acquire, taste-match parity with feeds, supersede-walled-park, retry-without-refetch.

## 4. Worker liveness/health (Phase 2)

- [ ] 4.1 `src/health.ts`: per-scraper `fresh`/`stale`/`never` derivation + contract-skew, from the key roster + push activity; expose to the Access-gated admin readers (no secret leakage).

## 5. Admin — Config › Ingest Keys (Phase 2)

- [ ] 5.1 `/admin/api/*` typed routes for key mint (secret once) / list / revoke, calling `src/ingest-db.ts`.
- [ ] 5.2 The Ingest Keys **island** under Config (per `ConfigScreen.jsx`→`IngestKeys`): roster table, Mint dialog + shown-once secret callout with copy, per-row Revoke behind a destructive confirm, empty state. Add "Ingest Keys" to the Config groups.

## 6. Admin — Discovery › Scrapers + Status (Phase 2)

- [ ] 6.1 SSR reader for the Scrapers view + Status section (liveness cards, throughput funnel, recent-pushes log) backed by the health/ingest rollups.
- [ ] 6.2 Discovery area: **Candidates | Scrapers** sub-tabs (per `DiscoveryScreen.jsx`); the `ScrapersView` (per `IngestScreen.jsx`/`ingest-data.jsx`); the Candidates **ingest strip** (warns on stale/skew).
- [ ] 6.3 Discovery candidate cards: `scraper: <origin>` provenance badge for pushed rows and the `acquire` stage rendered **arrived-via-push** in both the mini track and expanded stage list; fix the candidate card shell to `div role="button"` (no nested button).
- [ ] 6.4 Status homepage: **Ingest scrapers** section (per `StatusScreen.jsx`).

## 7. Scraper package (Phase 3)

- [ ] 7.1 `packages/scraper` (Node + Playwright) skeleton: config loader (TOML sources + non-secret settings), scheduler, dedup cursor, `packages/contract` import.
- [ ] 7.2 Adapter plugin model: the `{ authenticate, discover, extract }` interface, the injected SDK (shared parse + fetch tiers + session helpers), base-adapter loading + mounted operator-adapter loading; validate adapter output against the shared contract before push.
- [ ] 7.3 Tiered fetch runtime: plain-HTTP + cookie-replay default; Playwright/CDP browser tier (one process, per-source contexts) for sources that declare it; per-source override.
- [ ] 7.4 Session capture: `login` (headful) + cookie-import producing a `storageState` file on the mounted volume; daemon consumes it read-only; `auth_expired` detection surfaced in the push/heartbeat.
- [ ] 7.5 Batch-and-push: per-source batches to `/admin/api/ingest` with `scraper_version`/`contract_version`; strip to functional facts; push-failure backoff.
- [ ] 7.6 Operator CLI verbs: `login`, `test` (dry-run an adapter + print/validate the wire shape), `backfill`, `run`; Dockerfile (with the noVNC login fallback mode) + sample `docker-compose.yml`.
- [ ] 7.7 Base adapters for the initial paid sources built on session-replay only (no login automation / no bot-detection defeat), with fixture-based unit tests (no live sites in CI).

## 8. CI + distribution (Phase 3)

- [ ] 8.1 Make CI workspace-aware: typecheck + test the worker, contract, and scraper packages; scope the Worker deploy-trigger path filters to the Worker package; fan a `packages/contract` change to both sides.
- [ ] 8.2 Scraper release workflow: on a `scraper-v*` tag, build the image, push to GHCR, and cut a GitHub Release using `GITHUB_TOKEN` (no new secret), independent of the Worker deploy; embed build + contract version in the image.

## 9. Docs (in lockstep)

- [ ] 9.1 ARCHITECTURE.md: the scraper as the push intake arm on the sweep + the "walled sources are scraper-owned, not feeds" rule + the `/admin/api/ingest` Access carve-out.
- [ ] 9.2 SCHEMAS.md: `ingest_keys`, `ingest_candidates`, and the `discovery_log` `pushed`/`origin` columns.
- [ ] 9.3 SELF_HOSTING.md: run the scraper container, mint a key, capture/refresh a session (laptop `login` / cookie-import / noVNC), configure sources.
- [ ] 9.4 Confirm TOOLS.md needs no change (no new MCP tool); note the ingest surface where appropriate.

## 10. Verification

- [ ] 10.1 `aubr typecheck` + `aubr test` + `aubr test:tooling` green across the workspace; scraper package tests green.
- [ ] 10.2 End-to-end (local `wrangler dev` + local D1): mint a key, POST a batch to `/admin/api/ingest`, confirm arrival dedup, a sweep tick imports a pushed candidate skipping acquire, and the admin Scrapers/Status views + Discovery badges render.
- [ ] 10.3 `openspec validate "walled-source-ingest" --strict` passes; run `/code-review` on the diff before opening a PR.
