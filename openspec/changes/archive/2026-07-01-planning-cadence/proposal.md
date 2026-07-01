## Why

`propose_meal_plan` has no notion of how far out a caller actually plans. It hardcodes a 7-day weather fetch (`fetchWeatherForecast(resolveZip(prefs), 7)` in `src/meal-plan-proposal-tool.ts`) regardless of how many nights it's filling, and Level 1 (`sampleWeek` in `src/night-vibe-schedule.ts`) samples the night-vibe palette via `weightedSampleWithoutReplacement` — a vibe can appear **at most once** per plan, full stop. That ceiling is invisible at the default ~5-night week, but it silently breaks as soon as a caller plans further out: a household that shops every two weeks and wants 14 nights planned still gets each vibe capped at one occurrence, so a weekly-period vibe like "simple pasta night" (`cadence_days: 7`) can show up once in a 14-day plan and then the remaining nights have to be filled from whatever's left in the palette, even though cooking pasta twice in two weeks is exactly the cadence the caller declared.

The underlying gap is that "how far out do you plan" isn't captured anywhere. `default_cooking_nights` (a count) exists, but a count alone doesn't say whether those nights are spread over 3 days, a week, or two weeks — and that spread is exactly what both the weather horizon and the repeatability math need to know.

## What Changes

- **NEW** a `planning_cadence_days` profile field capturing how far out the caller plans/shops (asked during onboarding as a few-days / weekly / two-weeks choice). Read by `propose_meal_plan`, written through the existing profile write path.
- **NEW** the planning **window** = `planning_cadence_days`, driving three things: (a) the weather forecast horizon passed to `fetchWeatherForecast` (replacing the hardcoded `7`); (b) how many night-vibe slots the palette is sampled for — `default_cooking_nights` stays the count of cooking nights **within** that window, so a longer window doesn't imply cooking more often, just planning further ahead; (c) how many times a single vibe may recur in one plan.
- **NEW** **period-aware repeatability** in `sampleWeek`: a vibe may now be sampled up to `max(1, floor(window / vibe_period))` times per plan — a weekly-period vibe (`cadence_days: 7`) can legitimately fill two slots in a 14-day window — replacing today's implicit "once per plan" ceiling from weighted sampling **without** replacement. This is a bounded-**multiplicity** weighted sampling scheme: each vibe gets an occurrence cap derived from its own period relative to the window, determinism (seed), pinned/overdue precedence, and rollover semantics are preserved, and recurrences are spread across the window rather than landing adjacent where the sampling mechanism allows it.
- **UNCHANGED** recipe-level repetition: `assembleProposal`'s cross-slot `DiversifyState` (`usedSlugs`) already guarantees no single recipe repeats in a plan, so two "pasta night" slots still resolve to two different pasta recipes.
- **OUT OF SCOPE** the "weather beyond the reliable forecast horizon" behavior (what a 14-day window does with days 8–14, where forecasts are unreliable) is fully specified by the sibling change `weather-bucket-planning`; this change only plumbs the horizon parameter through to `fetchWeatherForecast`, it does not change how far-out days are treated once fetched.

## Capabilities

### New Capabilities

- `planning-cadence`: the `planning_cadence_days` profile field (identity, write path, onboarding capture), the derived planning **window** and its three consumers (weather horizon, in-window night count via `default_cooking_nights`, and vibe-recurrence caps), and the period-aware bounded-multiplicity sampling algorithm in `sampleWeek` that replaces at-most-once vibe placement.

### Modified Capabilities

<!-- None. This is authored as a new capability so it stays archival-order-independent of the
     still-unarchived propose-meal-plan-tool, night-vibe-archetype-derivation, and
     holistic-use-it-up changes, mirroring how holistic-use-it-up itself was scoped against
     meal-plan-proposal. It does not restate meal-plan-proposal's or night-vibe-palette's existing
     requirements (the hard gate, MMR + caps diversity, statelessness, cadence-as-debt scheduling
     all still hold) — it adds the window concept and changes the sampling multiplicity rule
     sampleWeek implements. -->

## Impact

- **Profile field:** `planning_cadence_days` (integer days) — the D1 placement (a new `profile` column vs. a preferences JSON field) is an open implementation question for the apply phase; `docs/SCHEMAS.md` documents whichever is chosen, and a new `migrations/d1/NNNN_planning_cadence.sql` is added **only if** a column is the right call.
- **`src/night-vibe-schedule.ts`:** `sampleWeek` (and the sampling primitive it uses internally) changes from at-most-once weighted sampling without replacement to bounded-multiplicity weighted sampling, keyed off each vibe's period and the window. `computeWeights`, `debtCurve`, `weatherMultiplier`, pinned/overdue precedence, and rollover are unchanged in spirit; `sampleWeek`'s signature gains the window (or the caller derives per-vibe caps and passes them in — an implementation choice for the apply phase).
- **`src/meal-plan-proposal-tool.ts`:** resolve `planning_cadence_days` from preferences, derive the window, pass it as the weather horizon (replacing the hardcoded `7`) and thread it into the `sampleWeek` call instead of (or alongside) the raw night count.
- **Docs (lockstep):** `docs/SCHEMAS.md` (the new profile field), `docs/TOOLS.md` (`propose_meal_plan` — the window concept, its effect on nights sampled and weather horizon), `docs/ARCHITECTURE.md` (the planning window and period-aware repeatability as part of the two-level planner description).
- **`AGENT_INSTRUCTIONS.md`:** the `configure-grocery-profile` onboarding flow gains a planning-cadence question (a few days / weekly / two weeks) alongside the existing cooking-nights capture.
- **Reuses (no new tables beyond the possible profile column):** `default_cooking_nights`, the night-vibe palette's `cadence_days` per-vibe period, `fetchWeatherForecast`'s existing `days` parameter (already accepts an arbitrary horizon, clamped 1–16).
