## Context

Three categories of hardcoded constants can be made runtime-configurable without a redeploy:

1. **Operator-wide knobs** — ranking weights and flyer behavior — shared across all members. A new `operator_config` D1 singleton holds them, mirroring the `discovery_config` pattern.
2. **Discovery processing limits** — adjacent to the existing sweep calibration knobs. Extended into `discovery_config` rather than a second table, keeping the Calibration tab's API coherent.
3. **Per-member retrospective preferences** — personal rhythm choices. A new `retrospective_prefs` JSON column on `profile`, consistent with how `rotation` is stored.

`resurfaceAfterDays` and `noveltyBoost` are already per-tenant via `profile.rotation` (and editable via `update_preferences`). The operator_config sets the group-wide default that `rotation` overrides.

## Decisions

### 1. Two new tables, one extended table; no KV

- **`operator_config`** — singleton (id = 1) for ranking weights and flyer knobs. Sparse nullable columns; absent = compiled default. Same pattern as `discovery_config`.
- **`discovery_config` extended** — processing limits (`fetch_max_per_tick`, `max_candidates_per_tick`, `retry_max_attempts`, `log_retention_days`) added as nullable columns here instead of `operator_config`. This keeps the Calibration admin endpoint (GET/PUT `discovery/config`) as a single source and the Calibration tab as the single reader/writer. No floor-guard needed on these (they're pacing knobs, not safety thresholds).
- **`profile.retrospective_prefs`** — new nullable TEXT (JSON) column alongside `profile.rotation`, parsed the same way. Holds `{ stale_after_days, revealed_months, revealed_min_cooks }`.
- D1 for all of these — same tier as `feeds`/`flyer_terms` (operational config). KV is reserved for ephemeral infra.

### 2. Operator config as the base default for ranking; tenant rotation overrides

Precedence: **compiled constants → operator_config → tenant rotation**.

`resolveRankParams(prefs, operatorDefaults)` gains a second parameter. The caller loads `operator_config` once and passes it as `operatorDefaults`; `rotation` in the tenant's prefs then overrides on top. If no `operator_config` row exists, the compiled `DEFAULT_RANK_PARAMS` is the base (backward-compatible). If a tenant has no `rotation` override, they get the operator default.

This applies to: `favoriteWeight`, `noveltyBoost`, `pantryWeight`, `perishWeight`, `keyWeight`, `overlapCap`, `resurfaceAfterDays`.

Tools that call `resolveRankParams` (currently: semantic search in `tools.ts`) load `operator_config` once per tool call and pass it through. No per-request caching needed — D1 single-row reads are fast.

### 3. Flyer config passed through at cron time

`runWarmJob` already accepts optional `batchUnits` and `refreshMs` in its config param. The `scheduled()` handler in `index.ts` loads `operator_config` and passes the relevant fields. `MIN_FLYER_DISCOUNT` is replaced by a read from `operator_config` at the `kroger_flyer` tool call site (same timing as any other tool-call-time config read).

### 4. Discovery processing limits folded into discovery_config

`loadDiscoveryConfig` / `saveDiscoveryConfig` in `discovery-calibration.ts` are extended to include the four new columns. The Calibration admin endpoint responds with the full merged config (thresholds + processing limits). The `discovery-sweep.ts` already has `DEFAULT_CONFIG`; the new limits are added there as additional fields. No floor-guard for these — they're pacing knobs with sensible defaults, not safety thresholds where a floor is safety-critical.

### 5. Retrospective constants threaded as a config param

`retrospective()` gains an optional fifth parameter `RetroConfig` (`{ staleAfterDays, revealedMonths, revealedMinCooks, underusedCap }`), defaulting to the current constants. `cooking-tools.ts`'s `runRetrospective` loads the caller's `retrospective_prefs` from D1 via `profile-db.ts` and passes them through. No MCP tool change — the tool's public surface is unchanged.

### 6. Admin UI: two new tabs, Calibration extended in-place

The Config subnav gains **Ranking** and **Flyer** tabs (new `Config/Ranking.elm` and `Config/Flyer.elm` modules). Both are simple GET/PUT knob forms — no analyze/dry-run workflow. The Calibration tab gains a "Processing limits" section rendered after the existing knobs form, reading from the same endpoint (already returns the full `discovery_config` row).

The Elm route gains `ConfigRanking` and `ConfigFlyer` variants; `Config.elm` adds them as `Section` variants alongside `CalibrationS` and `EditorS`.

### 7. Admin API for operator-config

`GET /admin/api/operator-config` — returns effective config (DB row merged over compiled defaults).
`PUT /admin/api/operator-config` — validates types and ranges (positive numbers, fractions in [0,1] where applicable), upserts row, returns merged effective config. No floor-confirmation dance (these aren't safety thresholds). Dispatched alongside the existing discovery endpoints in `routeAdminApi`.

## Open Questions

- **`UNDERUSED_CAP`** (`15`): technically per-user but it's a UI pagination concern rather than a personal preference. Leave hardcoded for now; not added to `profile`.
- **Future per-user ranking UI**: the agent's `update_preferences` tool already supports `rotation.resurface_after_days` and `rotation.novelty_boost`. The operator_config just sets the base that tenant rotation overrides.
