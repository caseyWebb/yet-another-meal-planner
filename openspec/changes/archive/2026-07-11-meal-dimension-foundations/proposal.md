## Why

The product is dinner-centric: plan rows have no meal field, cadence is a single `default_cooking_nights`, vibes are "night vibes", and the cooking log has no meal column (stories/02). The member-app redesign promotes meal type (`breakfast | lunch | dinner`, plus `project` plan rows) to a first-class axis across five surfaces, and band 1 must land the foundations — schema, tool contracts, and the propose engine — with **no UI**, so the band-2 page redesigns compose over real data. Three operator ratifications bind the shape: **D26-final** (per-slot plan-row identity — client-mintable ULID row ids with a planner-no-duplicates invariant), **D29-final** (attendance-aware household-blend propose contract; vibes household-shared and member-assignable), and **D21** (tool renames and retired preference keys ship with a one-deprecation-window shim). The D8 value migration (retired `lunch_strategy` / `ready_to_eat_default_action` → seeded meal-vibe suggestions) is re-homed into this change from band 2's `profile-planning-and-vibes-ui`: the pass that retires the write path must start the value convergence, the seeds need no UI (they ride the shipped proposal queue), and the deprecation-window column drop is gated on that convergence.

The design was produced by an adversarial judge-panel process (three competing designs, three judges, DECISIONS-verified) and is transcribed in `design.md`; production D1 was spiked read-only and its live rows are the acceptance fixtures F1–F5.

## What Changes

- **Migration `migrations/d1/NNNN_meal_dimension.sql`** (next free number at implementation time — band-1 siblings land first): rebuild `meal_plan` with `(tenant, id)` PK (SQL-minted 32-hex ids for the 3 existing rows; new mints are ULIDs), `meal` column (closed set, default `dinner`); nullable `cooking_log.meal`; `night_vibes.meal` (default `dinner`) + `members` (JSON, NULL = everyone) — **no table renames**; `profile.cadence` JSON map backfilled from `default_cooking_nights` (column wins over `custom`, precedence not merge). No unique index on recipe; no column drops; zero re-embeds (the vibe hash covers text only).
- **`update_meal_plan` / `read_meal_plan`**: id-keyed row ops with the D26-final contract — `add` resolution order (id replay → explicit `duplicate: true` → slug-global coalesce with >1-match `candidates` conflict), `remove` split idempotency (by id idempotent, by slug fan-out), `set` unique-or-candidates; project rows reject dates/sides at the op layer; `read_meal_plan` returns a flat, meal-ordered array with `id` as the row address and class (b) replay key.
- **`log_cooked`**: `meal` param (omitted = NULL "unknown"), `plan_row_id` param, deterministic clear order (row id → exact `(recipe, meal, date)` → earliest-due excluding projects), clears at most one row, vibe attribution meal-scoped and read from the row actually cleared, route dedupe identity `(date, meal, type, recipe|name)`.
- **`meal_vibe` tool family** (D21): `list/add/update/remove/suggest_meal_vibes` canonical; `*_night_vibe` names stay as dispatch aliases (identical behavior) for one window. Vibes gain `meal` and `members`; `update_meal_vibe` gains explicit-null field clearing.
- **`update_preferences` / `read_user_profile`**: defined `cadence` key (per-key merge-patch, 0–7); `default_cooking_nights` write alias → `cadence.dinner` with a `warnings` entry (the repo-wide `warnings` convention's first non-sibling use — the convention itself is introduced by `brand-tier-model`); retired keys accepted-and-dropped with warnings; profile export gains `cadence`, keeps `default_cooking_nights` as a derived mirror for one window, drops `lunch_strategy`/`ready_to_eat_default_action` now.
- **`propose_meal_plan` / `display_meal_plan`**: `meals` per-meal counts map (`nights` = window-scoped dinner alias), per-meal palette partition + sampling, vibe-meal binding with explicit empty slots, meal-aware course gate (breakfast), engine-side no-duplicates invariant, `attendance: {away}|{only}` with the D29-final roster seam / union hard floor / uniform blend / fail-opens, `ephemeral_vibes[].meal`, per-meal diagnostics. `ProposeCardData` reshaped (data only, no widget work).
- **Suggest-vibes cron**: `nameCluster` emits three lines (phrase / weather bucket / meal; meal fail-closed `dinner`; bucket discarded for non-dinner); `(meal, phrase-space)` dedupe; new idempotent `runPrefRetirementSeedJob` (scheduled() phase 5) enqueues the D8 seed suggestions and NULLs both retired columns in one batch (columns-NULL is the convergence predicate). The live `POST /api/vibes/suggest` route becomes a pinned `{ error: "gone" }` 410 stub for one window; the member-app health-gated trigger requirement is deleted.
- **Docs/persona lockstep**: TOOLS.md (all deltas + Deprecations rows + warnings paragraph), SCHEMAS.md, ARCHITECTURE.md (class (b) sentence both clauses; menu-gen paragraph; health-gate sentence deleted); persona meal-plan/onboarding/log/terminology edits + `aubr build:plugin --check` + the Appendix-C grep gate.
- **Flagged extras** (same pass, outside the 12 deltas): `member-app-offline` one-clause replay-key statement; `product-specs/stories/02-meal-dimension.md` Q2–Q4 resolved with strikethroughs; `product-specs/CHANGES.md` band-ledger edit re-homing the pref-retirement pass.

**Tool-vs-skill boundary audit** (CONTRIBUTING test, checklist item): fan-out semantics, `duplicate: true` meaning, the clear order, warnings semantics, attendance fail-open, and empty-meal `empty_reason` all live in tool descriptions; skills own only choreography.

## Capabilities

### Renamed Capabilities

- `night-vibe-palette` → **`meal-vibe-palette`** (old requirements REMOVED, re-landed ADDED under the new name; archive keeps history). No D1 table rename — SCHEMAS.md states "meal vibes — stored in the `night_vibes` table."
- `night-vibe-archetype-derivation` → **`meal-vibe-archetype-derivation`** (same mechanism).

### Modified Capabilities

- `planning-cadence`: `default_cooking_nights` → per-meal `cadence` map (0–7 weekly counts, per-key merge-patch); migration mapping, read fallback, alias-with-warning; window bounds recurrence caps (not counts) per meal; `occurrenceCap` explicitly meal-orthogonal.
- `weather-bucket-planning`: one new requirement — allocation is **dinner-only** (Q4); breakfast/lunch slots never carry `weather_category` or consume quotas; stored non-dinner affinities preserved-but-inert.
- `meal-plan-proposal`: `meals` map + alias; per-meal shape; vibe-meal binding/empty-meal slots; meal-aware course gate; engine no-duplicates; the D29-final attendance block; `ephemeral_vibes[].meal`; per-meal diagnostics.
- `meal-planning`: row identity `(tenant, id)`; the full op contract; project rows; migration mint (F1).
- `menu-generation`: per-meal counts from cadence; vibe-meal binding + empty-meal nudge; commit threads `meal` + row ids; `log_cooked` passes `meal`; attendance settable conversationally.
- `cooking-history`: `cooking_log.meal`; `log_cooked` `meal` + `plan_row_id`; deterministic clear order; dedupe identity; meal-scoped attribution.
- `meal-plan-widget`: `ProposeCardData` slots gain `meal`; request carries `meals` + `attendance`; iteration control list re-enumerated per D8/D20 (tool params retained). Data shape only, NO UI.
- `member-app-propose`: commit maps slots to id-minted add ops (never `duplicate`); per-meal inputs; attendance cross-reference (web control deferred, Design-project routed).
- `member-app-core`: plan ops keyed by row id; health-gated vibe-suggest trigger requirement deleted → 410 stub-for-one-window; profile-page `lunch_strategy` clause deleted (band-2 `profile-planning-and-vibes-ui` remains the D25(2) coupling obligation).
- `profile-reconciliation`: `add_vibe` proposals gain `meal`; `runPrefRetirementSeedJob` registered as a named producer with the enqueue+NULL convergence requirement (F5); night→meal terminology.
- `member-app-offline` (flagged extra): one-clause key statement — plan ops keyed by the client-minted plan-row id.

## Impact

- **New**: `packages/worker/src/ids.ts` (ULID mint + id regex), `migrations/d1/NNNN_meal_dimension.sql`, `runPrefRetirementSeedJob`, roster/blend/participation pure functions.
- **Changed**: `meal-plan.ts`, `session-db.ts`, `cooking-write.ts`, `night-vibe-db.ts`, `night-vibe-dedupe.ts`, `preferences.ts`, propose engine (`sampleWeek`/pool/assembly), `night-vibe-suggest.ts` (`nameCluster`), `tools.ts`, `src/api/vibes.ts` (410 stub) + `src/api` propose/plan surfaces, `scheduled()` wiring, `@yamp/contract` `ProposeCardData`, worker route tests + app-suite throttled-suggest coverage (assert the 410 stub).
- **Docs**: `docs/TOOLS.md` (incl. the Deprecations section + `warnings` convention), `docs/SCHEMAS.md`, `docs/ARCHITECTURE.md`; `packages/worker/AGENT_INSTRUCTIONS.md` (plugin rebuild).
- **Product-specs**: `stories/02-meal-dimension.md` (Q2–Q4 resolutions), `CHANGES.md` (band-ledger re-home).
- **Deploy skew**: accepted and bounded — migrations apply `--remote` before the Worker swaps; the old upsert's `ON CONFLICT(tenant, recipe)` makes plan *writes* fail as structured `storage_error` for seconds; reads, vibes, propose, attribution, and the crons keep working (no table renames). Post-deploy: F1–F4 `--remote` acceptance queries; F5 after the first cron tick, re-checked after the second.
- **Deprecation window**: opens at this deploy (Worker W₁ + plugin P₁); closes when a subsequent plugin publish P₂ has occurred AND ≥30 days have elapsed. The cleanup change `remove-meal-dimension-shims` is created at this change's archive time, table-driven off TOOLS.md's Deprecations section.
- **Flag (deploy-config, out of scope)**: `wrangler.jsonc`'s `database_name: "yamp"` does not match the real production D1 name (`grocery-mcp`; binding is by `database_id`, so migrations land correctly). Reported to the deploy-repo owner in the PR description.

## Depends On

- Band-1 siblings implement serially first: `brand-tier-model` (introduces the `warnings` return field + the TOOLS.md deprecation convention this change extends), `pantry-disposition-foundations` (shares `scheduled()`), `spend-capture-on-order-commit` (shares the `update_preferences`/`read_user_profile` TOOLS/SCHEMAS sections). This change implements **last in band 1**.
- Serial-surface collisions ahead: `meal-plan-widget`/`member-app-propose` shared with band-2 `plan-your-week-widget`; `meal-planning` shared with band-2 `meal-plan-page`.
