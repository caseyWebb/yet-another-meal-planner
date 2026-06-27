## Context

`background-discovery-sweep` (PR #127) runs the autonomous sweep with `DEFAULT_CONFIG` constants (`src/discovery-sweep.ts`): `tasteThreshold` τ, `triageThreshold`, `dedupThreshold` δ, `classifyMaxPerTick`, `rateCap`. Their comment says *"placeholders until task 0.3 calibrates them against the live corpus."* The sweep core is already deps-injected (`runDiscoverySweep(deps, config)`), the matchers are already pure (`matchMembers`, `findDuplicate`, `bestTasteCosine`, `dietaryOk`), the corpus vectors already live in `recipe_derived`, and the admin is already a client-routed Elm SPA with an Access-gated `/admin/api/*`. This change composes those into an operator calibration console; it builds almost no new machinery.

It also absorbs the two deferred tasks of the parent change: **0.3** (calibrate τ/δ/rate-cap from data) and **10.3** (full-pipeline E2E on a deployed Worker).

## Goals / Non-Goals

**Goals:**
- Make the sweep's knobs **tunable without a redeploy**, stored as data, read at job start.
- Give the operator a **data-driven calibration loop**: edit a knob → see its projected effect on the real corpus + members → save.
- Provide a **safe full-pipeline dry-run** (writes nothing) that doubles as the sweep's E2E verification.
- Guard against **footgun misconfiguration** (a slider that turns the sweep into a firehose).

**Non-Goals:**
- **Per-member knobs** — v1 is global (one τ/δ/etc. for the group). The per-member match-count readout will reveal whether per-member τ is ever warranted; deferred.
- **An MCP tool** — calibration is operator/cross-tenant (it scores *all* members to set a *global* knob), which doesn't fit the per-tenant MCP model. It lives on the admin surface. (A per-member `preview_my_discoveries` MCP tool is a separate possible future thing, noted, not built.)
- **Changing the sweep's matching/dedup algorithms** — this only exposes + previews the existing ones.
- **Auto-tuning** — the console informs a human's choice; it does not pick thresholds itself.

## Decisions

1. **Knobs are a global D1 singleton, sparse-override-merged over `DEFAULT_CONFIG`.** A `discovery_config` table holds one row of operator-set values; `runDiscoverySweepJob` loads it and merges over the compiled defaults (any unset knob falls back). *Why D1, not KV:* it's operational config, not ephemeral infra — the same tier as `feeds`/`flyer_terms` (the repo reserves KV for ephemeral infra only). *Why sparse override, not a full row:* keeps `DEFAULT_CONFIG` the single source of truth for "what a sane default is" — the store only records *deltas* an operator chose. *Why global:* the sweep imports into a shared corpus on a group-wide basis; one knob set matches that. The sweep reading config is backward-compatible — an empty/absent config row reads as pure defaults (so this lands safely even before any operator touches it).

2. **The cheap "Analyze" reuses the pure matchers over existing vectors — no AI, no feeds.** δ analysis = pairwise `cosineSimilarity` over the corpus `recipe_derived` vectors (count pairs ≥ δ → would-be dup collapses; plus a small histogram of the top cosines so the operator sees the gap between "genuine dup" and "genuine variety"). τ analysis = for each member, `bestTasteCosine` of every corpus recipe against that member's favorites+taste vector, counted at the current τ (and a sanity number: do the member's own favorites self-score high?). Both are pure arithmetic over data already loaded through the Worker for search — instant, free, and the workhorse for setting δ/τ. *Alternative — only a deep dry-run:* rejected as the primary calibration tool; it costs AI and only reflects whatever candidates the feeds happen to carry, whereas δ/τ are properties of the corpus+members and want a direct, complete readout.

3. **The deep "Dry-run" is a no-write deps swap over the unchanged core — and it IS task 10.3.** `buildDryRunDeps(env)` mirrors `buildDiscoveryDeps` but `importRecipe`/`recordMatches`/`recordLog` capture would-be outcomes in memory instead of writing R2/D1; `runDiscoverySweep` is called verbatim, so the preview exercises the real intake → classify → dedup → match → governor path and returns exactly what *would* happen. Because it writes nothing, it is the safe way to verify the whole pipeline on a deployed Worker — so this change **closes 10.3**. *The core needs zero changes* (it's already deps-injected). The L3 intra-sweep dedup still works (the core pushes the candidate vector regardless of `importRecipe`). Cost is bounded by the same `classifyMaxPerTick` as a real tick; it's operator-triggered and occasional.

4. **A new top-level Config area, organized by function (matching the panel's existing axis).** The admin organizes by function — Status / Members / Dev / Logs — so the knobs go in a new **Config** area (`/admin/config`), not a feature-keyed "Discovery" area, and the just-built Logs/Discovery audit view stays where it is. The console couples the knob form, the Analyze/Dry-run buttons, and the results panel on **one screen** so the projected effect is visible before Save (the calibration loop and the footgun guard are the same UI affordance). *Alternative — a "Discovery" area unifying config+calibrate+log:* more feature-discoverable, but it cuts against the panel's by-function organization and would relocate the freshly-shipped Logs view; deferred.

5. **Footgun floors are enforced server-side, surfaced client-side.** The `PUT /admin/api/discovery/config` handler rejects values past hard floors (τ ≤ 0.2, δ ≤ 0.7, rateCap absurdly high, etc.) unless an explicit `confirm: true` is passed; the Elm form shows the projected effect and requires a confirm step to send a floor-breaching value. Defense at the write boundary (not just the UI) so a direct API call can't bypass it — the same "validate at the boundary" discipline as the tools.

6. **No MCP tool surface.** Calibration reads cross-tenant data to set a global knob, which the per-tenant MCP model can't express, so there is no new MCP tool and `docs/TOOLS.md` records that explicitly (the tool contract is unchanged). The operator drives everything through `/admin`.

## Risks / Trade-offs

- **[Dry-run AI cost / latency]** → bounded by `classifyMaxPerTick` (same as a real tick), operator-triggered, occasional; the cheap Analyze (no AI) is the day-to-day tool.
- **[Analyze pairwise δ is O(n²) over corpus vectors]** → fine at friend-group scale (hundreds–low-thousands); if it ever bites, cap to a sampled subset or only score the top-K nearest per recipe (the same "measured, deferred promotion" stance as the search cosine). Note the cap in the response so it's not silently partial.
- **[Config drift between defaults and the store]** → the store is a *sparse* override and `DEFAULT_CONFIG` is the fallback, so there is exactly one place a default lives; an unset knob is never duplicated.
- **[A dry-run that accidentally writes]** → the whole point is that it writes nothing; `buildDryRunDeps` must make `importRecipe`/`recordMatches`/`recordLog` pure captures, and a unit test must assert no write dep is touched. Treat a write from a dry-run as a blocker.
- **[Misconfiguration]** → the server-side floors + the preview-before-save (Decision 5); plus the sweep's own per-window `rateCap` bounds blast radius even if τ is set loose.

## Migration Plan

1. **Gate on #127 merging.** The branch is stacked on the discovery-sweep branch; rebase onto `main` after #127 lands, then `/opsx:apply`.
2. **Additive schema + backward-compatible read.** Add the `discovery_config` table; make `runDiscoverySweepJob` read it (empty → defaults), so deploying this before any operator edits changes nothing.
3. **Land the endpoints + the Elm Config area; rebuild the admin bundle.** Operator can then Analyze/Dry-run/Save.
4. **Calibrate.** Use Analyze to set δ/τ from the corpus distribution; Dry-run to sanity-check the end-to-end; Save. This is where 0.3 actually gets done — against live data, by a human reading the numbers.

Rollback is a redeploy of the prior Worker; the `discovery_config` row is inert without the loader.

## Open Questions

- **Analyze histogram shape** — exact buckets / how many top-cosine pairs to surface for δ. A presentation detail; settle during implementation against real corpus numbers.
- **Persist dry-run outcomes?** A dry-run could optionally write to a separate `dry_run` log for later review (distinct from the real `discovery_log`), or stay purely in the response. Leaning response-only (ephemeral) for v1.
- **Floor values** — the exact τ/δ floors that trigger the confirm. Pick conservative defaults; tunable.
- **Per-member τ** — explicitly deferred; revisit if the per-member match-count readout shows members needing very different bars.
