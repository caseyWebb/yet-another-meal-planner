## 1. Wire contract → v2 (shared package)

- [ ] 1.1 In `packages/contract/src/ingest.ts`, bump `CONTRACT_VERSION` to `"v2"` and add the capability enum (`CAPABILITIES = ["recipe-scrape"]`, `type Capability`) as the clean extension point (no scan/order members).
- [ ] 1.2 Restructure the wire types to the capability-tagged, observations-only shape: a `RecipeObservationSchema` (`kind: "recipe"` + the v1 `RecipeItem` functional fields), an `ObservationItemSchema` = `z.discriminatedUnion("kind", [RecipeObservationSchema])`, and the v2 `SatelliteBatchSchema` (`{ capability, source, satellite_version, contract_version, observations }`). Keep `MAX_BATCH_ITEMS`.
- [ ] 1.3 Keep a **lenient** envelope that accepts BOTH v1 (`{ source, scraper_version, contract_version, recipes[] }`) and v2, plus a normalizer that maps a v1 batch to the recipe-scrape capability (`satellite_version := scraper_version`, `observations := recipes.map(kind:"recipe")`). Keep per-item validation so one bad item never sinks the batch.
- [ ] 1.4 Update `packages/contract/src/index.ts` exports (add v2 symbols; retain v1 types needed by the compat path) and the shared result/error taxonomy (`accepted|deduped|rejected`, `bad_payload|bad_key`) unchanged.
- [ ] 1.5 Update `packages/worker/test/contract-ingest.test.ts` to lock BOTH shapes: a v2 recipe batch round-trips; a v1 batch normalizes to the same intake; an unknown `capability` and an unknown item `kind` are rejected.

## 2. Worker: accept v2, keep DB/endpoint names

- [ ] 2.1 `packages/worker/src/ingest.ts`: parse via the dual-shape lenient envelope, normalize inward to one recipe-intake path (dedup/persist unchanged); reject an unimplemented `capability` as `bad_payload`. The endpoint path `POST /admin/api/ingest`, `INGEST_API_KEY`, and the `ingest_*` tables/columns are **unchanged**.
- [ ] 2.2 `packages/worker/src/ingest-db.ts`: rename the liveness API surface to satellite vocabulary (`readScraperLiveness` → `readSatelliteLiveness`, `ScraperLiveness`/`ScraperRollup`/`activeScrapers` → satellite names) while keeping the `ingest_keys.last_scraper_version` **column** and all SQL unchanged; stamp whichever version field the batch reported (`satellite_version` or v1 `scraper_version`) into `last_scraper_version`; skew is reported against `CONTRACT_VERSION = "v2"`.
- [ ] 2.3 `packages/worker/src/index.ts`: update the route comment only (path unchanged; still dispatched before the `/admin` Access gate as the exact-path key-authed exemption).
- [ ] 2.4 Update `packages/worker/test/ingest.test.ts` for the renamed liveness API and the v1/v2 accept + skew behavior.

## 3. Rename the package `scraper` → `satellite`

- [ ] 3.1 Move `packages/scraper/` → `packages/satellite/` (git mv the whole tree: `src/` {adapter, cli, config, cursor, fetch, index, jsonld, push, scheduler, session, strip, adapters/jsonld}, `test/` (all 9 specs), `README.md`, `Dockerfile`, `docker-compose.example.yml`, `vitest.config.ts`, `tsconfig.json`).
- [ ] 3.2 `packages/satellite/package.json`: name `@grocery-agent/scraper` → `@grocery-agent/satellite`, description, and `bin` `grocery-scraper` → `grocery-satellite`. Keep the `@grocery-agent/contract` `workspace:*` dep.
- [ ] 3.3 Rename `packages/satellite/scraper.example.toml` → `satellite.example.toml`; update its inline comments and any `scraper.toml` references in code/config loading and the README.
- [ ] 3.4 Update in-package identifiers/comments/CLI help/README prose `scraper` → `satellite` (keep `INGEST_API_KEY`, `/admin/api/ingest`, and the wire `source` semantics). The version the satellite reports is now `satellite_version` under `contract_version: "v2"` with `capability: "recipe-scrape"`.
- [ ] 3.5 Root `package.json`: update the description and the `test` script filter `@grocery-agent/scraper` → `@grocery-agent/satellite`; regenerate `aube-lock.yaml` for the renamed workspace (`pnpm-workspace.yaml` glob `packages/*` unchanged).

## 4. Admin panel labels + routes

- [ ] 4.1 Rename `packages/worker/src/admin/pages/scrapers.tsx` → `pages/satellites.tsx`; update the page/component names, the Discovery sub-nav labels (`Candidates | Scrapers` → `Candidates | Satellites`), and the route `/admin/discovery/scrapers` → `/admin/discovery/satellites` (operator-facing route, no external client — safe to rename).
- [ ] 4.2 `packages/worker/src/admin/app.tsx`: update imports (`ScrapersPage`, `readScraperLiveness`), the route registration, the mint-key validation copy ("a satellite label"), and the props threading.
- [ ] 4.3 `packages/worker/src/admin/pages/discovery.tsx`: the `satellite: <origin>` badge, the ingest strip copy (`N satellites · X fresh · Y pushed today`), and the sub-nav.
- [ ] 4.4 `packages/worker/src/admin/pages/config.tsx`: the Config › Ingest Keys blurb ("One key per home-network satellite …") and the group label.
- [ ] 4.5 `packages/worker/src/admin/pages/status.tsx`: the "Ingest satellites" section label.
- [ ] 4.6 `packages/worker/src/admin/client/ingest-keys.tsx`: the island copy (empty state "what a satellite is", column headers).
- [ ] 4.7 Optional: rename the `.dc-ingest-strip` CSS class only if it carries "scraper" — otherwise leave styling classes untouched (cosmetic, no benefit).

## 5. Admin Playwright coverage (ships with the admin change)

- [ ] 5.1 `packages/worker/admin/visual/pages/discovery.page.ts`: `ScrapersPage` → `SatellitesPage`, the `scrapers()` accessor → `satellites()`, the `path` `/admin/discovery/scrapers` → `/admin/discovery/satellites`, and the `area` `discovery-scrapers` → `discovery-satellites`.
- [ ] 5.2 `packages/worker/admin/visual/registry.ts` and `admin/visual/specs/smoke.spec.ts`: update the sub-surface name/refs and the smoke test.
- [ ] 5.3 Run `aubr test:admin` (web sessions: `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) and surface the per-area screenshots for review.

## 6. CI + release rename

- [ ] 6.1 Update `ci.yml` workspace typecheck/test filters and deploy-trigger path filters: `packages/scraper/**` → `packages/satellite/**`; keep the contract-fans-to-both-sides rule.
- [ ] 6.2 Rename the tagged-release workflow trigger `scraper-v*` → `satellite-v*` and the GHCR image name to the satellite image; keep `GITHUB_TOKEN`-only auth and independence from the Worker deploy. Note in docs that old `scraper-v*` tags/images remain valid.

## 7. Docs in lockstep

- [ ] 7.1 `docs/ARCHITECTURE.md`: retitle "The walled-source ingest arm" to the satellite arm; update the prose to "satellite", the v2 capability-tagged/observations-only contract, and the sensor-not-judge / raw-observation-convergence principle; keep the endpoint/table names. Update the parser note.
- [ ] 7.2 `docs/SCHEMAS.md`: update the `ingest_keys`/`ingest_candidates`/`ingest_pushes` prose to "satellite" and document the v2 wire shape (capability + discriminated-union observations); the table/column names (incl. `last_scraper_version`) are **unchanged** — state that explicitly.
- [ ] 7.3 `docs/SELF_HOSTING.md`: rename the "Walled-source scraper" section to the satellite; update the CLI verbs (`satellite login`/`test`), the container/compose references, `satellite.example.toml`, and the Config › Ingest Keys / Discovery › Satellites naming.
- [ ] 7.4 `docs/TOOLS.md`: confirm no change (no MCP tool touched); adjust only incidental "scraper" prose if present.

## 8. Verification

- [ ] 8.1 `aubr typecheck` + `aubr test` + `aubr test:tooling` green across the renamed workspace; the satellite package tests green under the new name.
- [ ] 8.2 `openspec validate "generalize-scraper-to-satellite" --strict` passes; run `/code-review` on the diff before opening a PR.
- [ ] 8.3 Grep the tree for residual `scraper`/`Scraper` outside intentional keeps (the `ingest_*` DB names, `last_scraper_version`, `INGEST_API_KEY`, `/admin/api/ingest`, archived openspec changes) and the v1 compat path's `scraper_version`; confirm each remaining hit is deliberate.
