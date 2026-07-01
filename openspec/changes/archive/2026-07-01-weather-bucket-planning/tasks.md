## 1. Discrete day→category derivation (`src/weather.ts`)

- [x] 1.1 Define the weather category taxonomy (finalize the proposed `grill` / `cold-comfort` / `wet` / `mild` set or revise per Open Questions) and a pure `deriveWeatherCategory(day)` (or equivalent) that collapses a `WeatherDay`'s `meal_vibes`/`condition` into exactly one category via a priority-ordered rule, defaulting to `mild`. Keep `deriveVibes`/`WeatherDay` unchanged — this is a new derivation layered on top.
- [x] 1.2 Unit tests: each category's triggering condition, the `mild` default, priority ordering when multiple signals are present on one day, and that categorization of one day never depends on any other day.

## 2. Discrete bucket membership on night vibes

- [x] 2.1 Decide reuse-vs-new field for bucket membership on `NightVibeSpec` (`src/night-vibe-schedule.ts`) and the `night_vibes` D1 row (`src/night-vibe-db.ts`, migration `0025_night_vibes.sql`) — reframe `weather_affinity` in place, or add a new column. Write the migration if a new column is chosen; if reusing, decide how existing rows' graded-affinity values are interpreted (or reset) as bucket membership. **Reused `weather_affinity`, no migration** (arbiter-baked): `resolveBucketMembership` interprets each stored string through the same tag→category map a forecast day resolves through, so legacy tags and new category names both resolve transparently.
- [x] 2.2 Update `src/night-vibe-db.ts` encode/decode (`decodeVibe`, `upsertNightVibe`) and any tool surface that reads/writes `weather_affinity` for the chosen shape. No changes needed — the column is still a JSON `string[]`; only the *interpretation* (in `src/night-vibe-schedule.ts`) changed, not the storage shape or the D1/tool encode-decode path.
- [x] 2.3 Unit tests: bucket membership round-trips through D1 encode/decode; default (absent) decodes to bucketless; a bucketed vibe decodes to the correct category subset. Covered via `resolveBucketMembership` unit tests (`test/night-vibe-schedule.test.ts`); the D1 encode/decode path itself is untouched (still a plain string array), so its existing coverage stands.

## 3. Quota allocation in `sampleWeek` (`src/night-vibe-schedule.ts`)

- [x] 3.1 Replace (or augment, per the Open Question) the `weatherVibes` flatten + `weatherMultiplier` call in `src/meal-plan-proposal-tool.ts` with per-day category derivation over the bounded weather window (task 5), producing a day→category histogram.
- [x] 3.2 Implement histogram→integer-quota conversion (largest-remainder rounding, deterministic tie-break) summing to the window's slot count.
- [x] 3.3 Implement per-category quota-fill: eligible pool = category members ∪ bucketless vibes, ranked by the existing (or sibling-change bounded-multiplicity) cadence-debt sampler; a quota with no eligible member degrades to the flex pool.
- [x] 3.4 Implement the `mild`/flex pool fill: whole palette ranked by cadence-debt, used both for `mild`-day quota and for degraded/leftover quota slots.
- [x] 3.5 Preserve pinned/overdue force-placement ordering; add the bucket-aware rollover rule (an overdue vibe whose category's quota is zero this window rolls over instead of force-placing into a mismatched slot, except at the existing overdue escape-hatch tier where it still forces). Added a new `forceRegardlessAt` param (default `3`, above `forceDueAt`'s `1.5`) as the escape-hatch tier.
- [x] 3.6 Decide and implement whether `weatherMultiplier` is retired or kept as a secondary within-quota ranking signal (Open Question); if kept, scope it so it cannot leak a boost across categories. **Retired from the allocation path** (arbiter-baked): `computeWeights` no longer applies it; the standalone `weatherMultiplier` function is kept (unused internally) only in case an external caller still references it.
- [x] 3.7 Unit tests (`test/night-vibe-schedule.test.ts`): quota proportion mirrors a mixed forecast (not full-strength from one day); a bucketed vibe never fills a conflicting category's quota; a bucketless vibe fills any quota; a quota with no eligible member degrades to flex without an empty slot; mild-day quota samples the whole palette; pinned stays sticky; overdue with zero-quota category rolls over; overdue past the escape-hatch tier still forces; determinism given a fixed seed.

## 4. Archetype-derivation bucket classification (`src/night-vibe-naming.ts`, `src/night-vibe-derive.ts`, `src/night-vibe-suggest.ts`)

- [x] 4.1 Extend `nameCluster`'s generation call (or its prompt/response parsing) to also emit a discrete bucket label (one category, or neutral) alongside the vibe phrase, without a second model call.
- [x] 4.2 Thread the classified bucket through `DerivedArchetype` (`src/night-vibe-derive.ts`) and the `add_vibe` proposal payload (`src/night-vibe-suggest.ts`) so a confirmed proposal writes bucket membership into the palette.
- [x] 4.3 Default to bucketless when the classification is neutral, missing, or the generation call fails (fail-soft, matching the existing naming contract).
- [x] 4.4 Unit tests (`test/night-vibe-naming.test.ts`, `test/night-vibe-derive.test.ts`): a successful classification is threaded through; a neutral/failed classification defaults to bucketless; existing naming behavior (the vibe phrase itself) is unaffected.

## 5. Weather window bound

- [x] 5.1 Compute the histogrammed window as `min(planning_cadence_days, reliability_cap)` (the sibling `planning-cadence` change's window; a ~10-day reliability cap here) in `src/meal-plan-proposal-tool.ts`; days beyond the cap are treated as `mild` and their slots flex. **Placement deviation:** implemented as `RELIABILITY_CAP`/`histogramCategories` inside `src/night-vibe-schedule.ts` (not `meal-plan-proposal-tool.ts`) so `sampleWeek` owns its own reliability bound regardless of caller — `meal-plan-proposal-tool.ts` passes the full per-day category array unbounded, and `sampleWeek`/`histogramCategories` cap it internally.
- [x] 5.2 Unit tests: a window longer than the cap treats excess days as `mild`; a window within the cap categorizes every day from its own forecast.

## 6. Docs (lockstep)

- [x] 6.1 `docs/TOOLS.md` — `propose_meal_plan`'s weather description: quota-based mirroring of the forecast mix, not a graded per-vibe boost.
- [x] 6.2 `docs/SCHEMAS.md` — `night_vibes`: document the bucket-membership field's shape (reused or new column) in place of/alongside `weather_affinity`.
- [x] 6.3 `docs/ARCHITECTURE.md` — the Level-1 shaping paragraph: replace the flatten/graded-multiplier description with discrete buckets + quota allocation, and note the archetype-derivation naming pass now also classifies a bucket.

## 7. Verify

- [x] 7.1 `aubr typecheck` + `aubr test` green.
- [x] 7.2 `openspec validate "weather-bucket-planning"` passes.
