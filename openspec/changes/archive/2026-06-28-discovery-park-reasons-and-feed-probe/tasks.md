## 1. Shared acquisition helper + specific park reasons

- [x] 1.1 Extract a shared `acquireRecipeContent(url, fetchImpl?)` helper (`src/recipe-acquire.ts`) that runs fetch → `extractJsonLd` → `findRecipe` → `normalizeRecipe` and returns a discriminated result: `{ ok: true, recipe } | { ok: false, reason: "unreachable" | "no_jsonld" | "not_a_recipe" | "incomplete", status?, missing? }`. `parse_recipe` now wraps it too (single source of the taxonomy).
- [x] 1.2 Rewrite the real `DiscoveryDeps.acquireContent` wiring to call the helper and return its discriminated result (widened the return type to `AcquireOutcome`).
- [x] 1.3 Update the sweep's `[2] acquire content` step (`runDiscoverySweep`) to log `detail: { reason, ...(status ? { status } : {}) }` from the helper result instead of the hard-coded `{ reason: "unreachable" }`.
- [x] 1.4 Added `test/recipe-acquire.test.ts` covering the node-runnable reachability taxonomy (unreachable + HTTP status); the JSON-LD legs stay in `jsonld.test.ts` + the live test (HTMLRewriter is workerd-only). Added sweep tests asserting `not_a_recipe` parks (not catch-all) and the status is recorded. No-drift is structural: one shared helper.
- [x] 1.5 Updated `discovery-sweep.test.ts` + `discovery-calibration.test.ts` fakes from the old `RecipeContent | null` to the discriminated `AcquireOutcome` shape.

## 2. Edge feed-probe endpoint

- [x] 2.1 Added `POST /admin/api/discovery/test-feed { url }` to `routeAdminApi` (delegates to `probeFeed` in new `src/discovery-probe.ts`): fetch the feed, `parseFeed`, sample the first `PROBE_SAMPLE_SIZE` items through `acquireRecipeContent`, return `{ feed: { reachable, status?, parsed, itemCount }, sample: [{ url, outcome, status? }] }`. `405` on non-POST, `validation_failed` on missing url.
- [x] 2.2 Added `POST /admin/api/discovery/reprobe-parked` (delegates to `reprobeParked`): `readLegacyUnreachable` selects a capped batch via `json_extract(detail,'$.reason')='unreachable'` (already-specific rows excluded), re-runs `acquireRecipeContent`, and `updateDiscoveryDetail` rewrites `detail` in place (preserving status). All through `src/db.ts`. `405` on non-POST.
- [x] 2.3 Added `test/admin-feed-probe.test.ts` (8 tests): walled-feed verdict, unreachable feed, missing-url validation, Access-gated 404, `405` on GET, re-probe keeps-unreachable + skips-specific + idempotent. (Parse-level `not_a_recipe` sampling is HTMLRewriter/workerd-only → live test.)

## 3. Feeds editor test action (Elm)

- [x] 3.1 Added an optional `testUrlColumn : Maybe String` hook to `EditorConfig` (the probe endpoint is fixed; the column names the URL to probe). Only `feedsConfig` supplies `Just "url"`; the other four pass `Nothing`, so no Test button shows for them.
- [x] 3.2 Modeled the test state as `test : Maybe ( TestTarget, WebData FeedVerdict )` — separate from the add/remove `ActionState`, no `Bool`/`Maybe String`. A test never touches `action` and a result does NOT refetch rows. Added Elm tests asserting both. (`TestTarget = TestRow String | TestDraft`.)
- [x] 3.3 Render a Test button on each feed row and on the add form, plus a `viewVerdict` panel (feed reachable + item count; K/M sampled pages parsed; per-entry outcome with HTTP status).
- [x] 3.4 Wired `postTest` → `POST /admin/api/discovery/test-feed`, decoded `FeedVerdict`, handled all four RemoteData states in `viewTest`.
- [x] 3.5 `aubr build:admin` compiles (17 modules), `--check` clean, `aubr test:admin` 135 Elm tests green. Added a `.form-actions` flex rule to `admin/index.html`.

## 4. Docs + verification

- [x] 4.1 Updated `docs/SCHEMAS.md` `discovery_log` section: `detail.reason` specific-reason vocabulary + optional `status`, the re-probe note, and refreshed example rows. (TOOLS.md unaffected — no MCP tool surface change.)
- [x] 4.2 Updated `docs/ARCHITECTURE.md` discovery-sweep bullets: the shared `acquireRecipeContent` helper in Classify, the specific park reason in the outcome-log bullet, and a new Operator feed-probe bullet (both endpoints).
- [x] 4.3 `aubr typecheck` clean; `aubr test` 888 pass / 9 skip; `aubr test:tooling` 80 pass; `aubr test:admin` 135 pass; `aubr build:admin --check` up to date.
- [x] 4.4 `openspec validate "discovery-park-reasons-and-feed-probe" --strict` passes.
