## 1. Profile field: `planning_cadence_days`

- [ ] 1.1 Explore `src/profile-db.ts`'s existing scalar-column vs. preferences-JSON vs. `custom`-bag conventions (see `default_cooking_nights` as the precedent for a plain scalar column) and settle where `planning_cadence_days` belongs; resolve the Open Question on enum-vs-free-integer input shape at the same time.
- [ ] 1.2 If a new `profile` column is the right call, add `migrations/d1/NNNN_planning_cadence.sql` and wire it into `PROFILE_SELECT` / `ProfileRow` / `assemblePreferences` / `SCALAR_PROFILE_COLUMNS` in `src/profile-db.ts`, following `default_cooking_nights`'s existing pattern. If it belongs in `preferences` JSON or `custom` instead, wire it through the existing merge-patch path with no migration.
- [ ] 1.3 Ensure `update_preferences` validation (`src/validate.ts` or wherever the merge-patch shape is validated) accepts and type-checks the new field.

## 2. Window derivation + weather horizon plumbing

- [ ] 2.1 In `src/meal-plan-proposal-tool.ts`, derive the planning window from `planning_cadence_days` (with a sensible default when unset) and replace the hardcoded `fetchWeatherForecast(resolveZip(prefs), 7)` horizon with the derived window, clamped to whatever `fetchWeatherForecast` itself supports.
- [ ] 2.2 Confirm `default_cooking_nights` continues to resolve the in-window night count (unchanged resolution order: explicit `nights` param → `default_cooking_nights` → `DEFAULT_NIGHTS`), independent of the window's size.

## 3. Period-aware repeatability in `sampleWeek`

- [ ] 3.1 Design the bounded-multiplicity sampling primitive in `src/night-vibe-schedule.ts` that replaces `weightedSampleWithoutReplacement` for the pool-fill step: each non-forced vibe's occurrence cap is `max(1, floor(window / vibe_period))`; sampling proceeds seeded and deterministic until the remaining slots are filled or the pool is exhausted of eligible (under-cap) tickets.
- [ ] 3.2 Preserve existing precedence: pinned placement, then overdue/forced placement (with the existing `minSampledSlots` reserve for weather), then the new bounded-multiplicity weighted-pool fill. Preserve rollover for vibes that don't fit.
- [ ] 3.3 Resolve the Open Question on recurrence spacing (cooldown vs. post-hoc reshuffle vs. accepted-adjacency) and implement it so a recurring vibe's occurrences are spread across the window where the palette and window size allow it.
- [ ] 3.4 Thread the window into `sampleWeek`'s signature (or a wrapper) so it has what it needs to compute per-vibe caps; update `SampledWeek`/diagnostics if the occurrence count per vibe is worth surfacing.
- [ ] 3.5 Unit tests in `test/night-vibe-schedule.test.ts` (or equivalent): a weekly vibe recurs up to twice in a 14-day window; a monthly vibe stays capped at once; a window ≤ a vibe's period preserves today's at-most-once behavior; determinism given a fixed seed; pinned/overdue precedence still holds; over-subscription still rolls over; recurrence spacing behaves per the resolved Open Question.

## 4. Recipe-level dedup regression coverage

- [ ] 4.1 Add/confirm a test in `test/meal-plan-proposal.test.ts` (or `diversify.test.ts`) that a vibe sampled into two slots resolves to two distinct recipes via the existing `usedSlugs` cross-slot mechanism — a regression guard, not new logic.

## 5. Docs (lockstep)

- [ ] 5.1 `docs/SCHEMAS.md` — document `planning_cadence_days` in whichever location Task 1 settles on (profile column table, or the `preferences` JSON example block).
- [ ] 5.2 `docs/TOOLS.md` — `propose_meal_plan`: describe the planning window, its effect on the weather horizon and on vibe-recurrence caps, referencing `planning_cadence_days`.
- [ ] 5.3 `docs/ARCHITECTURE.md` — describe the planning window and period-aware repeatability as part of the two-level planner (Level 1 shape) description.
- [ ] 5.4 `AGENT_INSTRUCTIONS.md` — extend `configure-grocery-profile` onboarding to ask the planning-cadence question (a few days / weekly / two weeks) alongside the existing cooking-nights capture, and persist it via the settled write path.

## 6. Verify

- [ ] 6.1 `aubr typecheck` + `aubr test` green.
- [ ] 6.2 `openspec validate "planning-cadence"` passes.
