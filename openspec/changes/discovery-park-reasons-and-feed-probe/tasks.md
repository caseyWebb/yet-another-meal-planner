## 1. Shared acquisition helper + specific park reasons

- [ ] 1.1 Extract a shared `acquireRecipeContent(url, fetchImpl?)` helper (in `src/discovery-sweep.ts` or a small shared module) that runs fetch → `extractJsonLd` → `findRecipe` → `normalizeRecipe` and returns a discriminated result: `{ ok: true, content: RecipeContent } | { ok: false, reason: "unreachable" | "no_jsonld" | "not_a_recipe" | "incomplete", status?: number }`.
- [ ] 1.2 Rewrite the real `DiscoveryDeps.acquireContent` wiring to call the helper and return its discriminated result (widen the `DiscoveryDeps.acquireContent` return type from `RecipeContent | null`).
- [ ] 1.3 Update the sweep's `[2] acquire content` step (`runDiscoverySweep`) to log `detail: { reason, ...(status ? { status } : {}) }` from the helper result instead of the hard-coded `{ reason: "unreachable" }`.
- [ ] 1.4 Add a unit test asserting the sweep parks `no_jsonld` / `not_a_recipe` / `incomplete` / `unreachable` correctly for fixture pages (stub fetch), and a test asserting `acquireRecipeContent` and `parse_recipe` agree on the same fixtures (no taxonomy drift).
- [ ] 1.5 Update existing `discovery-sweep.test.ts` cases that assert the old `acquireContent`-returns-`null` / `reason: "unreachable"` behavior to the discriminated shape.

## 2. Edge feed-probe endpoint

- [ ] 2.1 Add `POST /admin/api/discovery/test-feed { url }` to `routeAdminApi` (`src/admin.ts`): fetch the feed via `fetchWithBrowserHeaders`, run `parseFeed`, sample the first `k` items (named constant) through `acquireRecipeContent`, return `{ feed: { status, parsed, itemCount }, sample: [{ url, outcome }] }`. Reject non-POST with `405`.
- [ ] 2.2 Add `POST /admin/api/discovery/reprobe-parked` to `routeAdminApi`: select a capped batch of `discovery_log` rows where `outcome='error'` and `detail.reason='unreachable'`, re-run `acquireRecipeContent`, `UPDATE` each row's `detail` in place (preserving status), skip rows already specific. Go through the `src/db.ts` storage layer (no raw `env.DB`). Reject non-POST with `405`.
- [ ] 2.3 Add unit/route tests for both endpoints: probe verdict shape over stubbed fetch (walled-feed and non-recipe-feed cases), Access-gated 404 when unconfigured, `405` on wrong method, and the re-probe's bounded + idempotent behavior.

## 3. Feeds editor test action (Elm)

- [ ] 3.1 Add an optional per-row action hook to `Config.TableEditor`'s `EditorConfig` (a label + the endpoint + a verdict decoder), supplied only by `feedsConfig` so the other four editors are untouched.
- [ ] 3.2 Model the test state per `admin/CLAUDE.md`: a row-keyed `WebData FeedVerdict` (or single `Maybe (RowKey, WebData FeedVerdict)`) separate from the add/remove `ActionState` — no `Bool`/`Maybe String`. A successful test does NOT refetch the rows.
- [ ] 3.3 Render the test button on each feed row and on the add form, and render the verdict (feed reachable + item count; K/M sampled pages parsed, with walled/not-a-recipe called out).
- [ ] 3.4 Wire the HTTP call to `POST /admin/api/discovery/test-feed`, decode the verdict, and handle the four RemoteData states.
- [ ] 3.5 `aubr build:admin` and confirm the Feeds sub-view compiles and renders the action.

## 4. Docs + verification

- [ ] 4.1 Update `docs/SCHEMAS.md` for the tightened `discovery_log.detail.reason` vocabulary (specific reasons, optional `status`).
- [ ] 4.2 Update `docs/ARCHITECTURE.md` discovery-sweep / admin sections to note the shared acquisition helper and the two operator probe endpoints.
- [ ] 4.3 Run `aubr typecheck`, `aubr test`, and `aubr build:admin`; run the new tests green.
- [ ] 4.4 `openspec validate "discovery-park-reasons-and-feed-probe" --strict` passes.
