## Why

The background discovery sweep (`background-discovery-sweep`) ships its tuning knobs — the taste threshold τ, the dedup threshold δ, the triage threshold, the per-tick classify cap, and the per-window import rate cap — as **hardcoded `DEFAULT_CONFIG` constants**, explicitly marked *"placeholders until task 0.3 calibrates them against the live corpus."* Two things follow from that:

1. **The knobs can only be changed by editing code and redeploying** — but the right values are data-dependent (they depend on each member's favorites/taste vectors and the corpus's pairwise cosine distribution) and they **drift** as tastes and the corpus grow. An import flood or drought is exactly the kind of thing an operator needs to correct *without* a redeploy.
2. **Calibration today is a guess.** Setting τ/δ blind is the failure mode the sweep's design warned against. A knob is only calibratable if you can *see what it would do* — at τ=0.55, does Casey match 5 recipes or 500? does δ=0.9 collapse genuine dups or real variety?

This change turns 0.3 from a one-time guess into a standing operator capability: a **calibration console** in the admin panel where the knobs sit next to a live readout of their effect on the real corpus + members, so tuning is data-driven. It also **closes the sweep's other deferred item, 10.3** (the full-pipeline E2E): the console's deep dry-run runs the entire sweep with writes disabled, which *is* the safe end-to-end verification on a deployed Worker — surfaced as a button, not a one-off script.

The leverage is that almost nothing new has to be built: the sweep core is already deps-injected (a no-write dry-run is a deps swap, the core is untouched) and the matchers (`matchMembers`, `findDuplicate`, `bestTasteCosine`) are already pure (the cheap "analyze" reuses them over the existing `recipe_derived` vectors — no AI, no feeds). This is wiring + an Elm page, not new algorithms.

## What Changes

- **The sweep's knobs become tunable data, not constants.** A global `discovery_config` D1 singleton holds a sparse override; the sweep reads it at job start and merges it over `DEFAULT_CONFIG` (which stays the fallback — one source of truth). Knobs are **global** (one set for the group), not per-member.
- **A new top-level Config area in the admin panel** (the fifth area, beside Status / Members / Dev / Logs) with a calibration console: the knob form, two action buttons (**Analyze** and **Dry-run**), and a results panel — the knobs and the projected effect on one screen so you tune from real numbers before saving.
- **Cheap "Analyze" (no AI, no feeds):** δ = pairwise cosine over the corpus `recipe_derived` vectors (how many pairs would collapse as dups at the current δ), and per-member τ = how many corpus recipes each member would match. Instant; reuses the sweep's pure matchers. This is the δ/τ calibration workhorse.
- **Deep "Dry-run" (full pipeline, no writes):** runs `runDiscoverySweep` with a no-write deps implementation (capturing would-be outcomes instead of importing/logging) and returns the per-candidate preview — what would import, dedup, gate, or park at the current knobs. **This subsumes the sweep's deferred 10.3 E2E** — the safe way to exercise the whole pipeline on a deployed Worker without auto-importing.
- **Footgun guards:** the projected effect is shown *before* Save; and the config write enforces hard floors (e.g. τ ≤ 0.2 or δ ≤ 0.7 require an explicit confirm) so a mis-dragged slider can't turn the sweep into a corpus firehose.
- An Access-gated `/admin/api/discovery/{config,analyze,dry-run}` JSON surface backs the console (gated exactly like the rest of `/admin*`).

## Capabilities

### New Capabilities
- `discovery-calibration`: the operator calibration loop for the discovery sweep — the tunable global config store (sparse override merged over the defaults, read by the sweep at job start), the cheap cosine **analyze** (δ pair count + per-member τ match counts over the live corpus/members, no AI/feeds), the deep no-write **dry-run** (the full pipeline preview, which also serves as the sweep's E2E verification), and the footgun floors on config writes.

### Modified Capabilities
- `operator-admin`: a new top-level **Config** area (the fifth, beside Status/Members/Dev/Logs), routed at `/admin/config`, hosting the calibration console; the Access-gated `GET/PUT /admin/api/discovery/config` + `POST /admin/api/discovery/{analyze,dry-run}` endpoints; the top-level-areas requirement grows from four areas to five.

## Impact

- **Depends on `background-discovery-sweep`** (PR #127, not yet merged): this change tunes that change's `DEFAULT_CONFIG`/`runDiscoverySweep`/matchers and modifies the `discovery-sweep` + `operator-admin` specs it introduced. The branch is **stacked on the discovery-sweep branch** and rebases onto `main` once #127 merges; implementation (`/opsx:apply`) should wait for that merge.
- **Worker (`src/`):** a `discovery_config` loader (D1 singleton, merge-over-defaults) that `runDiscoverySweepJob` reads instead of the constant; a no-write `buildDryRunDeps(env)` beside `buildDiscoveryDeps`; a cheap `analyzeThresholds(env, config)` over `loadRecipeEmbeddings` + the member vectors (reusing `findDuplicate`/`bestTasteCosine`); the three `/admin/api/discovery/*` handlers in `src/admin.ts`.
- **D1 (migration):** a `discovery_config` table (single-row sparse config; reconcile-/operator-owned).
- **Admin SPA (`admin/`, Elm):** a new Config routed area with the knob form (`RemoteData` load, a dirty-vs-saved form-state custom type), the analyze/dry-run result views, and the confirm-on-floor-breach guard — modeled per `admin/CLAUDE.md`.
- **Docs (lockstep):** `docs/ARCHITECTURE.md` (the sweep's knobs are tunable; the calibration console + dry-run-as-E2E), `docs/TOOLS.md` (no MCP tool change — calibration is operator/admin, cross-tenant; note that explicitly), `docs/SCHEMAS.md` (the `discovery_config` table).
- **Closes the deferred items of `background-discovery-sweep`:** 0.3 (calibrate from data) via the console, and 10.3 (full E2E) via the deep dry-run.
