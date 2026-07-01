## 1. Monorepo + shared contract (Phase 0)

- [x] 1.1 Introduce `aube`/npm workspaces in the root `package.json` (+ lockfile) with a `packages/*` layout; keep `aube ci`/`aubr` working and the session-start hook shims intact.
- [x] 1.2 Create `packages/contract` as a **runtime-agnostic** package (workerd + Node; no Node-only or workerd-only deps); add its typecheck wiring.
- [x] 1.3 Move the recipe-parse spine (the pure `findRecipe`/`normalizeRecipe` layer + `text.ts`) into `packages/contract`; keep the workerd-only `extractJsonLd` (HTMLRewriter) in the Worker; re-point the Worker via re-export shims (`jsonld.ts`/`text.ts`) with no behavior change; tests green.
- [x] 1.4 Define the ingest **wire contract** in `packages/contract`: the batch envelope `{ source, scraper_version, contract_version, recipes[] }`, the recipe item shape, a `CONTRACT_VERSION` constant, and a shared validator + the result/error taxonomy (`accepted | deduped | rejected`, `bad_payload`/`bad_key`). Locked by `test/contract-ingest.test.ts`.
- [x] 1.5 Full move: the Worker relocated to `packages/worker` (src/test/tests/scripts/migrations/admin/vault/persona + wrangler/tsconfig/vitest/playwright/.dev.vars.example); `ci.yml` paths + deploy-trigger filter updated; **data-repo `deploy.yml` patch handed off in `deploy-handoff.md`** (out-of-scope repo).

## 2. Worker ingest endpoint + keys (Phase 1)

- [x] 2.1 Migration `0025_ingest_keys.sql` (id, label, key_hash, key_prefix, created_at, last_used_at, status, last_scraper_version, last_contract_version).
- [x] 2.2 Migration `0026_ingest_candidates.sql` (id, url UNIQUE, title, content JSON, origin, key_id, received_at) — the pushed-content inbox.
- [x] 2.3 Migration `0027_discovery_log_pushed.sql` — add `pushed` + `origin` columns to `discovery_log`.
- [x] 2.4 `src/ingest-db.ts` (through `src/db.ts`): key mint (hash + prefix, secret returned once), revoke, hash lookup-by-secret, `last_used`/version stamp, list; pushed-candidate insert (INSERT OR IGNORE) + read + url-set + delete. (The per-scraper/per-source **liveness rollup** travels with the admin UI in group 4.)
- [x] 2.5 `src/ingest.ts`: the `POST /admin/api/ingest` handler — key auth, envelope + per-item validation (`parseIngestEnvelope`/`parseRecipeItem`), arrival dedup (corpus/rejections/**settled**-log/in-flight inbox, with the walled-park supersede exception), persist accepted candidates, `{ received, accepted, deduped, rejected, results }` response; best-effort per-key KV rate limit. Tested in `test/ingest.test.ts`.
- [x] 2.6 `src/index.ts`: route `POST /admin/api/ingest` to `handleIngest` **before** the `/admin` dispatch — an explicit key-authed exemption from the Access gate (exact path only; every other `/admin*` stays Access-gated).

## 3. Sweep push-intake arm (Phase 1)

- [x] 3.1 Extended `SweepCandidate` with optional `content`/`pushed`/`origin`; `buildDiscoveryDeps.loadCandidates` reads `ingest_candidates` as a third source and emits pushed candidates (bypassing the feed `seen` set; cleaning up a raced-already-in-corpus row).
- [x] 3.2 `acquireContent` returns the attached content for a pushed candidate (no fetch); triage/classify/dedup/match/import run unchanged; the fetch cap does not gate a pushed candidate.
- [x] 3.3 `pushed`/`origin` recorded on the `discovery_log` row (threaded via `logBase` → `recordDiscoveryLog`).
- [x] 3.4 Retry semantics: a pushed candidate's inbox row is deleted on any terminal outcome; a transient `failed` keeps the row (retried next tick from stored content) and writes **no** `discovery_log` row; a contract-invalid classification parks terminally (`error`) and deletes the row.
- [x] 3.5 "Walled sources are scraper-owned, not feeds": arrival dedup + the sweep dedup use the **settled** set (not parks), so a push supersedes a prior `unreachable` park; `loadSettledUrls` added.
- [x] 3.6 Unit tests for the push arm (`test/discovery-sweep-push.test.ts`): skip-acquire, taste-match parity, fetch-cap exemption, retry-without-refetch/keep-row.

## 4. Worker liveness/health (Phase 2)

- [x] 4.1 Liveness rollup `readScraperLiveness` (`src/ingest-db.ts`): per-scraper + per-source `fresh`/`stale`/`never` (health-posture vocabulary) + contract-skew + 24h/7d counts + the 24h throughput funnel (arrival from `ingest_pushes`, downstream from pushed `discovery_log` outcomes) + recent-pushes log, from the key roster + a new `ingest_pushes` history table (migration `0028`, recorded per POST, retention-pruned on the sweep). Feeds the admin Status + Discovery › Scrapers views (group 6). Tested in `test/ingest.test.ts`.

## 5. Admin — Config › Ingest Keys (Phase 2)

- [x] 5.1 Typed routes on the `AdminApp` chain (`src/admin/app.tsx`): `GET /api/ingest/keys` (returns the liveness rollup's per-scraper rows — no secret), `POST /api/ingest/keys` (mint → secret once), `POST /api/ingest/keys/:id/revoke`. Access-gated (distinct from the exact-path key-authed `/admin/api/ingest`).
- [x] 5.2 `src/admin/client/ingest-keys.tsx` island + the Config › Ingest Keys group/page (`pages/config.tsx`): roster table (label+prefix, source chips, created, last-used, status), Mint dialog + shown-once secret banner, per-row Revoke behind a destructive-confirm `<dialog>`, empty state. Modeled on the Members island (ActionState union, `Banner` variant).

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
