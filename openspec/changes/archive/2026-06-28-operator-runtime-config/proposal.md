## Why

A scan of the codebase found ~40 magic constants that operators would reasonably want to tune without a redeploy. Today, changing the minimum flyer discount threshold, recipe recycle cadence, or ranking sensitivity requires a code change. The discovery calibration console (merged earlier) proved the pattern: store overrides in D1, load them at runtime, merge over compiled defaults. This change applies that pattern to the remaining tunable surface.

Two categories of config emerged:

- **Operator-wide knobs** — shared across all members: ranking weights, flyer behavior, discovery processing limits. These go into a new `operator_config` D1 singleton (mirrors `discovery_config`) with a lightweight GET/PUT admin API and two new Config tabs.
- **Per-member preferences** — personal rhythm choices (recipe recycle cadence, retrospective windows) that belong to the user's profile, not the operator. These move into the `profile` table with no UI yet; the user-facing surface is future work.

## What Changes

### New `operator_config` D1 table (singleton, id = 1)

All columns nullable; absent = use the compiled default. Groups:

**Ranking weights** (read by `src/semantic-search.ts`):
- `favorite_weight REAL` — default 0.15 — how strongly taste history pulls
- `novelty_boost REAL` — default 0.1 — preference magnitude for never-cooked recipes
- `pantry_weight REAL` — default 0.12 — pantry ingredient overlap bonus
- `perish_weight REAL` — default 1.0 — per-item weight for perishable ingredient hits
- `key_weight REAL` — default 0.4 — per-item weight for key ingredient hits
- `overlap_cap INTEGER` — default 2 — saturation ceiling for ingredient overlap term

**Flyer behavior** (read by `src/flyer-warm.ts` and `src/tools.ts`):
- `min_flyer_discount REAL` — default 0.05 — minimum markdown fraction to count as flyer-worthy
- `flyer_refresh_hours INTEGER` — default 24 — minimum hours between Kroger re-scans
- `flyer_batch_units INTEGER` — default 12 — (location, term) pairs processed per cron tick

**Discovery processing limits** (read by `src/discovery-sweep.ts` alongside `discovery_config`):
- `fetch_max_per_tick INTEGER` — default 16 — max external page fetches per tick
- `max_candidates_per_tick INTEGER` — default 150 — triage cost ceiling per tick
- `retry_max_attempts INTEGER` — default 5 — max retries before terminal failure
- `log_retention_days INTEGER` — default 60 — discovery log retention window

### `profile` table additions (per-member preferences)

New nullable columns on the existing `profile` table:

- `resurface_after_days INTEGER` — default 30 — days before a cooked recipe fully rotates back
- `retro_stale_after_days INTEGER` — default 30 — days since cook before recipe counts as neglected
- `retro_revealed_months INTEGER` — default 12 — trailing window for revealed-favorite detection
- `retro_revealed_min_cooks INTEGER` — default 3 — cooks within window to count as revealed fav

No user-facing write tool or admin UI for these yet — the columns land in D1 and the code reads them, but editing is future work.

### New admin API endpoints

- `GET /admin/api/operator-config` — returns current effective config (DB row merged over defaults)
- `PUT /admin/api/operator-config` — upserts the config row; validates types and ranges; returns merged effective config

### Admin UI — two new Config tabs

**Ranking tab** — simple knob form (no analyze/dry-run needed), save confirms immediately:
- Favorite weight, Novelty boost, Pantry weight, Perish weight, Key weight, Overlap cap

**Flyer tab** — simple knob form:
- Min discount %, Refresh interval (hours), Batch units per tick

**Calibration tab extended** — adds a second section "Processing limits" below the existing knobs form:
- Fetch max/tick, Max candidates/tick, Retry max attempts, Log retention days

The four new processing-limit fields are simpler than the threshold knobs (no floor-confirmation dance needed), but they live on the Calibration tab because they're operationally adjacent to the discovery sweep.

## Capabilities

### New Capabilities

- `operator-runtime-config`: the `operator_config` D1 singleton, its admin API (GET/PUT), the Ranking and Flyer Config tabs, and the processing-limits section of the Calibration tab

### Modified Capabilities

- `discovery-calibration`: Calibration tab gains a "Processing limits" section; `discovery_config` is unchanged; the admin handler wires up the new `operator-config` endpoints alongside the existing `discovery/config` ones
- `flyer-cache-warming`: `runWarmJob` reads `flyer_batch_units` and `flyer_refresh_hours` from `operator_config` instead of compiled defaults; `MIN_FLYER_DISCOUNT` is replaced by the `operator_config` value at the tool call site
- `meal-planning` / `recipe-search`: `semantic-search.ts` `DEFAULT_RANKING_PARAMS` loads from `operator_config` at the tool call site (merged over compiled defaults)
- `retrospective`: `STALE_AFTER_DAYS`, `REVEALED_MONTHS`, `REVEALED_MIN_COOKS` become per-tenant reads from `profile`; `resurfaceAfterDays` in `semantic-search.ts` likewise reads from the calling tenant's profile row

## Impact

- `migrations/d1/0020_operator_config.sql` — new `operator_config` table
- `migrations/d1/0020_profile_rhythm_prefs.sql` — four new nullable columns on `profile`
- `src/operator-config.ts` — NEW: `loadOperatorConfig()`, `saveOperatorConfig()`, typed defaults, D1 helpers
- `src/admin.ts` — wire GET/PUT `/admin/api/operator-config`
- `src/semantic-search.ts` — `DEFAULT_RANKING_PARAMS` becomes a function/lazy load from `operator_config`; `resurfaceAfterDays` read from tenant profile
- `src/flyer-warm.ts` — `runWarmJob` reads `flyer_batch_units`/`flyer_refresh_hours` from `operator_config`
- `src/tools.ts` — flyer tool reads `min_flyer_discount` from `operator_config` instead of the `MIN_FLYER_DISCOUNT` constant
- `src/discovery-sweep.ts` — `DEFAULT_CONFIG` loading merges in `fetch_max_per_tick`, `max_candidates_per_tick`, `retry_max_attempts`, `log_retention_days` from `operator_config`
- `src/retrospective.ts` — constants become per-tenant reads from profile
- `src/db.ts` — helpers for `operator_config` and the new `profile` columns
- `admin/src/Config.elm` — add `Ranking` and `Flyer` `Section` variants; add tabs; new sub-modules `Config.Ranking` and `Config.Flyer`
- `admin/src/Config/Calibration.elm` — extend with processing-limits section
- `admin/src/Route.elm` — add `ConfigRanking` and `ConfigFlyer` to `ConfigRoute`
- `docs/SCHEMAS.md` — document `operator_config` table and the four new `profile` columns
- `docs/ARCHITECTURE.md` — note the operator-config loading pattern for ranking/flyer/discovery
