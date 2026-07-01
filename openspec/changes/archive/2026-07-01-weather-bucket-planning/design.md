## Context

`propose_meal_plan`'s Level-1 shaping (`sampleWeek` in `src/night-vibe-schedule.ts`) samples the week's night-vibe slots by cadence-debt, then reweights by weather. Weather enters as `weatherVibes` in `src/meal-plan-proposal-tool.ts`:

```ts
const weatherVibes = weather && "forecast" in weather
  ? [...new Set(weather.forecast.flatMap((d) => d.meal_vibes))]
  : [];
```

— a **union** of every forecast day's `meal_vibes` tags (from `deriveVibes(highF, precip)` in `src/weather.ts`: `soup`, `comfort`, `grill-friendly`, `light`, `no-grill`) across the whole fetched window, with no record of *how many* days carried each tag. That flat set feeds `weatherMultiplier(vibe, weatherVibes)`, which computes `(1 + weatherBoost·favorMatches) · (weatherPenalty if any antipathy match)` — a continuous per-vibe multiplier applied identically to every slot regardless of which day that slot lands on.

Both mechanisms were deliberately explored and rejected in favor of something more graded (an embedding-affinity score), and that direction was explicitly rejected too: a continuous score always leaks a small, nonsensical pairing (a "grill" boost bleeding onto a "cozy soup" vibe merely because both matched some overlapping tag). The flatten also destroys **proportion** — a single hot day anywhere in a fetched 7-day window pins `grill-friendly` into the union at full strength, identically to a week that's hot every day.

## Goals / Non-Goals

**Goals:**
- Replace the flattened union + graded multiplier with **discrete, mutually-exclusive weather categories** derived **per day**, so the week's *mix* of weather (not just its presence anywhere) drives allocation.
- Make bucket membership **structural set membership**, not a score: a vibe belongs to a category or it doesn't, and a bucketless vibe is a **universal filler** eligible everywhere non-bucketed slots need filling.
- Allocate slots by **quota** (mirroring the forecast's day-category histogram), reusing the existing cadence-debt ranking to pick *which* member fills each quota slot.
- Give archetype-derived vibes bucket membership at creation time (today they get none), reusing the existing naming model call.
- Preserve determinism, the pinned/overdue force-placement contract, and the "never an empty slot for lack of a weather match" guarantee.

**Non-Goals:**
- Finalizing the category taxonomy, the day→category priority rule, or the quota rounding/tie-break — recorded as Open Questions.
- Deciding whether `weatherMultiplier` is fully retired or kept as a secondary within-quota signal — Open Question.
- Re-deriving `deriveVibes` or the underlying Open-Meteo fetch/condition mapping — the category collapse is a new layer on top of the existing per-day `meal_vibes`/`condition`, not a replacement.
- Building the `planning-cadence` window or its bounded-multiplicity debt sampler — this change consumes both from the sibling change.
- Retrofitting existing palettes' `weather_affinity` data (a data-migration concern, not a schema concern) beyond what the reuse-vs-new decision implies.

## Decisions

### D1 — Weather buckets are derived per day, then histogrammed over the window — not unioned

Each forecast day collapses to **exactly one** discrete category (never several) via a priority rule over that day's `meal_vibes`/`condition` (e.g. a day with `no-grill` + high precip is `wet`, not both `wet` and `cold-comfort`; the exact priority order is an Open Question). `mild` is the default when no category's signal is strong enough. The window's **allocation input** is then the **histogram** of day→category counts, not a set union — this is what restores proportion: a week with one hot day among six mild ones produces a `grill` quota of roughly 1/7 of the slots, not a `grill` boost applied to every slot.

*Alternative — keep a per-day union but weight by day-count:* rejected; still couples a graded weight to vibe selection instead of a hard quota, reintroducing the leaky-pairing problem D2 exists to avoid.

### D2 — Bucket membership is discrete set membership; bucketless is a universal filler

A night vibe's weather relationship becomes **membership in a subset of the non-`mild` categories** (0 or more), not a graded affinity list scored against a tag union. Default is **bucketless** (member of no category). Bucketless vibes are eligible for **every** category's quota and for `mild`/flex slots — they're the palette's flexible majority. A vibe that *is* bucketed (say, `{grill}`) is **structurally incapable** of filling a `wet` or `cold-comfort` quota slot: not merely low-scored, but absent from that quota's eligible pool entirely. That structural impossibility — as opposed to a graded score that's merely small — is the change's central claim: it's the only way to guarantee a "cozy soup" vibe can never be selected to fill a `grill` quota no matter how the multiplier constants are tuned.

*Alternative — keep affinity as a graded list but clamp it to 0/1 per tag:* rejected; still a per-tag score summed across possibly-conflicting tags on one vibe, not a clean "which single bucket(s) do you belong to" question, and doesn't remove the multiplier arithmetic that caused the original leak.

### D3 — Allocation is quota-fill, reusing the existing debt sampler within each quota

`sampleWeek`'s weather step changes from "compute a per-vibe multiplier, feed it into one flat weighted sample" to:

1. Histogram the planning window's days by category (bounded by the reliable-forecast cap, D5).
2. Convert the histogram to integer **slot quotas** summing to the window's slot count, via largest-remainder rounding with a deterministic tie-break (exact rule: Open Question).
3. For each non-`mild` category with quota > 0, fill it from that category's **member vibes ∪ bucketless vibes**, ranked by the existing cadence-debt sampler (the sibling `planning-cadence` change makes this a bounded-multiplicity sampler, so a single vibe can't fill an entire quota alone if that's undesirable — the exact bound is that change's concern).
4. A category whose quota has **no eligible member** (an all-bucketed-elsewhere palette) **degrades to flex** — its slots join the `mild`/flex pool rather than going unfilled. This preserves the existing "never an empty slot for lack of a weather match" guarantee.
5. `mild`-day quota is always flex: filled from the **whole palette** by debt, exactly as today's debt-only sampling would (categories are additive on top of, not a replacement for, cadence-debt ranking).

Pinned and overdue force-placement are evaluated **before** quota-fill, as today, and consume from whichever quota (or flex) their vibe would belong to; an overdue vibe whose bucket's quota is **zero** for this window (its category doesn't appear in the forecast at all) rolls over rather than forcing a mismatched placement — with the existing `forceDueAt` tier remaining the eventual override once debt climbs high enough that force-placement should happen regardless of forecast match (see the `sampleWeek` module comment's "grill in the garage" framing).

*Alternative — run quotas as a filter *inside* the existing single weighted sample rather than a separate per-category fill:* considered, but a single filtered sample can't guarantee a category's proportional share without itself re-deriving the quota math, so it collapses to the same algorithm with an extra indirection.

### D4 — Coupling source: authored override + archetype-derivation classification, no embeddings

Two producers populate bucket membership, both discrete:
- **Authored override** — reframing `weather_affinity` (see the schema question below) as the explicit bucket set a member or the palette-editing surface assigns directly.
- **Archetype-derivation classification** — `nameCluster` (`src/night-vibe-naming.ts`) is extended to also emit a bucket label (one of the categories, or a neutral/bucketless marker) for a newly derived vibe, in the **same** model call already being made to name the cluster (cheap — no second call). This is the only fix for today's gap where derived vibes get **no** weather metadata at all (`night-vibe-suggest.ts` / `night-vibe-derive.ts` construct candidates with no affinity field).

Both are discrete outputs feeding the same structural membership set — there is no embedding-similarity or graded-score path into bucket membership, consistent with the explicit rejection of the graded-affinity approach.

*Alternative — derive bucket membership from the vibe's embedding vector at reconcile time (cosine to a category centroid):* this is the graded/embedding-affinity approach and was explicitly rejected for this change; noted here only to record that it was considered and rejected, not left ambiguous.

### D5 — Weather window bounds at the lesser of the planning window and forecast reliability

The set of days histogrammed for allocation is `min(planning_cadence_days, ~10)` — the sibling change's planning window, capped at a forecast-reliability horizon beyond which a forecast is more noise than signal. Days beyond that cap are treated as `mild`/neutral rather than fetched-and-guessed, and their slots fall to flex. This keeps the allocation honest about forecast decay instead of pretending a 14-day-out forecast carries the same category confidence as tomorrow's.

## Open Questions

- **Category taxonomy + day→category priority.** This proposal suggests `grill` / `cold-comfort` / `wet` / `mild`, and that a day collapses to one category via a priority order over `meal_vibes`/`condition` (e.g. precipitation-driven `wet` vs. temperature-driven `cold-comfort` when both signals are present on the same day). The exact category set and priority order are not finalized.
- **Quota rounding + tie-break.** Largest-remainder rounding is proposed to keep quotas summing exactly to the slot count, but the deterministic tie-break rule (e.g. category-name order, or a seeded draw) is unresolved.
- **Whether `weatherMultiplier` is fully replaced or kept as a secondary within-quota signal.** Quotas decide *how many* slots a category gets; whether the existing graded multiplier still nudges *which* member fills a quota slot (on top of debt) or is retired entirely once quotas exist is undecided. If kept, it must not reintroduce leaky cross-bucket pairing — it would need to operate only within a slot's already-determined category.
- **Debt-pause for an out-of-context weather vibe.** Whether a bucketed vibe whose category never appears for several consecutive weeks should have its cadence-debt clock paused (so it doesn't silently become maximally overdue and force-place at the first mismatched opportunity) is deferred.

## Risks / Trade-offs

- **Small planning windows produce noisy histograms.** A short window (a handful of days) can round to a lopsided quota split (e.g. all slots to one category) even from a fairly mixed forecast; the largest-remainder rounding and the flex-degrade path (D3.4) bound the damage but don't eliminate the noise — real-corpus tuning will need to confirm this behaves reasonably at small `planning_cadence_days` values.
- **A palette with no bucketed vibes at all degrades to today's behavior.** If every vibe is bucketless, every quota degrades to flex and allocation is pure cadence-debt sampling — an acceptable, honest fallback, not a bug, but worth calling out since it means this change's benefit is proportional to how many vibes end up bucketed.
- **Migration/back-compat for `weather_affinity`.** Reframing an existing JSON-array column's semantics (favor-tags → bucket membership) risks stale data meaning something different post-change if a value happens to collide with a new category name; the schema decision (reuse vs. new column) should account for this rather than silently reinterpreting old rows.
- **Archetype classification quality is model-dependent.** The bucket label `nameCluster` emits is only as good as the small model's classification from cluster descriptions; a wrong classification silently mis-buckets a derived vibe (fails soft into bucketless in the worst case, matching the existing fail-soft naming contract, not a new risk class).
