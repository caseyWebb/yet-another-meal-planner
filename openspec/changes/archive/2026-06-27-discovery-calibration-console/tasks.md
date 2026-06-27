# Tasks

> Dependency: `background-discovery-sweep` (PR #127) is **merged to main** — its
> `DEFAULT_CONFIG` / `runDiscoverySweep` (deps-injected) / pure matchers / `recipe_derived`
> vectors / admin Logs area are all present, so this change can rebase onto main and apply.
> This change closes that change's two deferred items: **0.3** (group 9 here) and **10.3**
> (the deep dry-run, group 4).

## 1. Schema
- [x] 1.1 Migration `migrations/d1/NNNN_discovery_config.sql`: a single-row `discovery_config` table holding the operator's sparse knob overrides (τ, triage, δ, classify cap, rate cap — all nullable; absent = use the default). Operator/reconcile-owned; local D1 apply.

## 2. Tunable config (sweep reads it)
- [x] 2.1 `src/discovery-sweep.ts` (or a sibling `discovery-config.ts`): `loadDiscoveryConfig(env)` reads the `discovery_config` row through `src/db.ts` and merges the set knobs over `DEFAULT_CONFIG` (unset → default; empty/absent → exactly the defaults). Type/range-validate on read (defensive).
- [x] 2.2 `runDiscoverySweepJob` reads `loadDiscoveryConfig(env)` instead of the `DEFAULT_CONFIG` parameter default; the `scheduled()` wiring passes it through. Backward-compatible: no config row → unchanged behavior. Unit-test the merge (sparse override, empty → defaults).

## 3. Cheap analyze (no AI, no feeds)
- [x] 3.1 `analyzeThresholds(env, config)`: δ = pairwise `cosineSimilarity` over `loadRecipeEmbeddings` (count pairs ≥ δ + a sample of the top cosines), τ = per member (`loadMembers`-style favorites+taste vectors) count of corpus recipes with `bestTasteCosine` ≥ τ (+ cold-start flag). Reuses the sweep's pure matchers; **no `env.AI`/feed calls**. Bound the pairwise work for a large corpus and report when bounded.
- [x] 3.2 Unit-test with in-memory vectors: δ pair counting, per-member τ counts, the cold-start (no favorites/taste) flag, and that no AI dep is invoked.

## 4. Deep dry-run (no writes) — discharges discovery-sweep 10.3
- [x] 4.1 `buildDryRunDeps(env)` mirrors `buildDiscoveryDeps` but `importRecipe`/`recordMatches`/`recordLog` capture would-be outcomes in memory and write **nothing** (no R2/D1). Run `runDiscoverySweep` verbatim; return the captured per-candidate outcomes.
- [x] 4.2 Unit-test that a dry-run over a fake intake produces the same outcomes a real run would AND touches no write dep (assert importRecipe/recordMatches/recordLog never persist).

## 5. Footgun guard (config write)
- [x] 5.1 A `validateDiscoveryConfig(patch, { confirm })` (server-side) enforcing hard floors (τ ≤ floor, δ ≤ floor, rate cap ≥ ceiling → rejected unless `confirm`) + range checks (thresholds in [0,1], caps positive ints). Returns a structured error (never throws). Unit-test the floor + range cases.

## 6. Admin endpoints (`src/admin.ts`)
- [x] 6.1 `GET /admin/api/discovery/config` (the merged knobs), `PUT …/config` (write overrides via 5.1's guard), `POST …/analyze` (3.1), `POST …/dry-run` (4.1) — dispatched in `routeAdminApi` so they inherit `requireAccess` (404 when unconfigured); structured-error serialization like the rest.
- [x] 6.2 Tests (mirror `admin-logs.test.ts` / `admin-tools.test.ts`): each endpoint gated, the PUT floor-guard, analyze/dry-run shape, dry-run writes nothing.

## 7. Admin Config area (`admin/src/**`)
- [x] 7.1 `Route` gains a `Config` variant (`/admin/config`); a new `admin/src/Config.elm` page: the knob form (`RemoteData` load + a dirty-vs-saved form-state custom type), Analyze/Dry-run buttons + result views, and the confirm-on-floor-breach step. Wire into `Main.elm` + the nav.
- [x] 7.2 SPA-shell deep-link for `/admin/config` (existing fallthrough; add a test). Elm unit tests (route round-trip, form-state, floor-confirm gating).
- [x] 7.3 Rebuild + commit `admin/dist/` via `aubr build:admin` (`--check` to confirm no drift; needs `package.elm-lang.org`).

## 8. Docs (lockstep)
- [x] 8.1 `docs/ARCHITECTURE.md`: the sweep's knobs are tunable (the `discovery_config` store, merged over defaults, read at job start); the calibration console (analyze + dry-run); the dry-run as the sweep's E2E.
- [x] 8.2 `docs/SCHEMAS.md`: the `discovery_config` table.
- [x] 8.3 `docs/TOOLS.md`: note that calibration is an operator/admin (cross-tenant) surface with **no MCP tool** added (the tool contract is unchanged).

## 9. Verify + close the parent's deferred items
- [x] 9.1 `aubr typecheck`, `aubr test`, `aubr test:tooling`, `openspec validate discovery-calibration-console --strict` green.
- [ ] 9.2 0.3 — calibrate τ/δ/rate-cap against the live corpus using the Analyze console; record the chosen values.
- [ ] 9.3 10.3 — run the deep dry-run on the deployed Worker as the full-pipeline E2E; confirm import/dedup/gate/park outcomes look right, then let the live sweep proceed.
