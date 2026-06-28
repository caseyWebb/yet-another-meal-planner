# Tasks

## 1. Schema migrations

- [x] 1.1 `migrations/d1/0020_operator_config.sql` — new `operator_config` singleton table with ranking weight columns (`favorite_weight`, `novelty_boost`, `pantry_weight`, `perish_weight`, `key_weight`, `overlap_cap`) and flyer columns (`min_flyer_discount`, `flyer_refresh_hours`, `flyer_batch_units`); all nullable; `id INTEGER PRIMARY KEY CHECK (id = 1)`.
- [x] 1.2 `migrations/d1/0021_discovery_config_limits.sql` — `ALTER TABLE discovery_config ADD COLUMN` for `fetch_max_per_tick INTEGER`, `max_candidates_per_tick INTEGER`, `retry_max_attempts INTEGER`, `log_retention_days INTEGER`; all nullable.
- [x] 1.3 `migrations/d1/0022_profile_retro_prefs.sql` — `ALTER TABLE profile ADD COLUMN retrospective_prefs TEXT` (JSON: `{ stale_after_days, revealed_months, revealed_min_cooks }`).

## 2. `src/operator-config.ts` (NEW)

- [x] 2.1 Define `OperatorConfig` type and `DEFAULT_OPERATOR_CONFIG` with the compiled defaults. `loadOperatorConfig(env): Promise<OperatorConfig>` — reads the singleton row from D1 via `src/db.ts`, merges over defaults (absent/null columns → compiled defaults). `saveOperatorConfig(env, patch)` — upserts id=1 row with the non-null fields from patch.
- [x] 2.2 `validateOperatorConfig(patch)` — type and range checks (fractions in [0,1]: `favorite_weight`, `novelty_boost`, `pantry_weight`, `perish_weight`, `min_flyer_discount`; positive integers: `overlap_cap`, `flyer_refresh_hours`, `flyer_batch_units`). Returns a structured error or null (never throws). No floor-confirmation needed.

## 3. Wire ranking weights into `resolveRankParams`

- [x] 3.1 `src/semantic-search.ts`: extend `resolveRankParams(prefs, operatorDefaults?)` — second param `Partial<RankParams>` defaults to `DEFAULT_RANK_PARAMS`. Precedence: compiled → operatorDefaults → tenant rotation. Update the function signature and implementation; all call sites that pass only `prefs` continue to work (operatorDefaults defaults to the compiled constants).
- [x] 3.2 `src/tools.ts`: at the semantic-search tool call site, load `operator_config` once and pass `resolveRankParams(prefs, operatorConfig)`.

## 4. Wire flyer config

- [x] 4.1 `src/index.ts`: in `scheduled()`, load `operator_config` before/alongside `discovery_config` (can be parallel). Pass `flyer_batch_units` and `flyer_refresh_hours` from operator_config into `runWarmJob`'s config param.
- [x] 4.2 `src/tools.ts`: in the `kroger_flyer` tool, load `operator_config` and use `min_flyer_discount` as the default (replacing the `MIN_FLYER_DISCOUNT` import). Keep the per-call `min_savings_pct` override as the override tier above it.

## 5. Wire discovery processing limits into `discovery_config`

- [x] 5.1 `src/discovery-calibration.ts`: extend `DiscoveryConfig` type and `DEFAULT_CONFIG` with the four new fields (`fetchMaxPerTick`, `maxCandidatesPerTick`, `retryMaxAttempts`, `logRetentionDays`). Update `loadDiscoveryConfig` / `saveDiscoveryConfig` to read/write the new columns. Update `parsePatchFromBody` in `src/admin.ts` to accept the new fields on PUT.
- [x] 5.2 `src/discovery-sweep.ts`: replace the four hardcoded constants (`fetchMaxPerTick`, `maxCandidatesPerTick`, `retryMaxAttempts`, `LOG_RETENTION_DAYS`) with reads from the `config` param (already threaded in). Add the four fields to `DEFAULT_CONFIG`.

## 6. Wire retrospective prefs into `retrospective()`

- [x] 6.1 `src/profile-db.ts`: add `retrospective_prefs: string | null` to `ProfileRow`; parse it in `assembleProfile` alongside `rotation`; expose it on `AssembledProfile` / `Preferences` as `retrospective` (parsed object or null). Add to `PROFILE_SELECT` and the `UPDATABLE_COLUMNS` allowlist.
- [x] 6.2 `src/retrospective.ts`: add `RetroConfig` interface (`{ staleAfterDays, revealedMonths, revealedMinCooks }`); `retrospective()` gains an optional fifth parameter `config: RetroConfig` defaulting to the current constants. Replace module-level constant reads with the config param.
- [x] 6.3 `src/cooking-tools.ts`: `runRetrospective` passes the caller's `retrospective` prefs from the loaded profile through to `retrospective()`. Load the profile alongside other per-call data.

## 7. Admin API endpoint

- [x] 7.1 `src/admin.ts`: add `GET /admin/api/operator-config` and `PUT /admin/api/operator-config` to `routeAdminApi` (alongside the existing `discovery/config` block). GET returns `{ config: OperatorConfig }`. PUT validates via `validateOperatorConfig`, upserts, returns merged effective config.

## 8. Admin UI (Elm)

- [x] 8.1 `admin/src/Route.elm`: add `ConfigRanking` and `ConfigFlyer` to `ConfigRoute`; update `configRouteParser` and `configRouteHref`.
- [x] 8.2 `admin/src/Config.elm`: add `RankingS Config.Ranking.Model` and `FlyerS Config.Flyer.Model` to `Section`; add `RankingMsg` / `FlyerMsg` to `Msg`; wire init/update/view; add "Ranking" and "Flyer" pills to the `tabs` list.
- [x] 8.3 `admin/src/Config/Ranking.elm` (NEW): `RemoteData`-backed knob form for `GET/PUT /admin/api/operator-config`. Fields: Favorite weight, Novelty boost, Pantry weight, Perish weight, Key weight (all float 0–2), Overlap cap (int 1–10). Clean/Dirty form state. Save button disabled when clean.
- [x] 8.4 `admin/src/Config/Flyer.elm` (NEW): knob form for the same endpoint. Fields: Min discount % (shown as percent, stored as fraction 0–1), Refresh interval hours (int 1–168), Batch units (int 1–50).
- [x] 8.5 `admin/src/Config/Calibration.elm`: extend `Config` type and `Draft` with the four processing-limit fields; add a "Processing limits" `fieldset` section to `viewKnobForm` after the existing knobs (Fetch max/tick, Max candidates/tick, Retry max attempts, Log retention days); update `configDecoder`, `encodeDraft`, `parseDraft`, `configToDraft`, `defaultConfig`.
- [x] 8.6 Run `aubr build:admin` and commit the rebuilt `admin/dist/`.

## 9. Docs (lockstep)

- [x] 9.1 `docs/SCHEMAS.md`: document the `operator_config` table (columns, defaults, singleton pattern); the four new `discovery_config` columns; the `profile.retrospective_prefs` column.
- [x] 9.2 `docs/ARCHITECTURE.md`: document the operator-config loading pattern (compile defaults → operator_config override → tenant rotation override for ranking; compile defaults → operator_config for flyer; discovery_config for sweep knobs + processing limits).

## 10. Verify

- [x] 10.1 `aubr typecheck` clean.
- [x] 10.2 `aubr test` green (existing tests pass; no new unit tests required beyond typecheck — the wiring is straightforward merge-over-defaults).
