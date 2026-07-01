## Context

`propose_meal_plan` (`src/meal-plan-proposal-tool.ts`) resolves how many nights to plan from `nights ?? preferences.default_cooking_nights ?? DEFAULT_NIGHTS`, fetches weather with a hardcoded 7-day horizon (`fetchWeatherForecast(resolveZip(prefs), 7)`), and samples the night-vibe palette via Level 1 (`sampleWeek` in `src/night-vibe-schedule.ts`). `sampleWeek` places pinned vibes, then overdue vibes (debt ≥ `forceDueAt`), then fills the rest via `weightedSampleWithoutReplacement` — an exact Efraimidis–Spirakis weighted sample **without replacement**, so every non-forced vibe can land at most one slot regardless of how many slots there are. Forced (pinned/overdue) vibes are placed via a simple loop with no repeat guard either, but in practice each vibe id appears once in the palette and the loop doesn't re-visit it, so today's behavior is uniformly "each vibe id, at most once per plan," independent of period.

That ceiling is unobservable at the current default window (~5 nights, no explicit window concept) because nobody plans a period long enough to expect legitimate repeats. It becomes wrong once a window concept exists: a caller who plans two weeks out with a weekly-period "pasta night" vibe (`cadence_days: 7`) should see that vibe twice, not once — the whole point of a period shorter than the window is that it recurs within it. Recipe-level repetition is a separate, already-solved concern: `assembleProposal` threads one `DiversifyState` with `usedSlugs` across the week (see the `meal-plan-proposal` capability), so even if "pasta night" is sampled twice, the two slots resolve to two different pasta recipes.

Nothing today captures "how far out does this caller plan/shop." `default_cooking_nights` is a count, not a horizon — 5 cooking nights could mean "5 out of 7 days" or "5 out of 14," and the tool has no way to distinguish them. Onboarding (`configure-grocery-profile` in `AGENT_INSTRUCTIONS.md`) asks about cooking nights but never about the planning horizon itself.

## Goals / Non-Goals

**Goals:**
- Introduce `planning_cadence_days` as a first-class, onboarding-captured profile field naming how far out the caller plans/shops.
- Derive a single planning **window** from it and use that window everywhere a horizon or a repeat cap is needed: the weather forecast horizon, and the vibe-recurrence cap.
- Keep `default_cooking_nights` as the count of cooking nights **within** the window — decoupling "how far ahead" from "how often."
- Replace `sampleWeek`'s at-most-once sampling with **bounded-multiplicity** weighted sampling: a vibe's occurrence cap is `max(1, floor(window / vibe_period))`, so a weekly vibe can legitimately fill two slots of a 14-day plan.
- Preserve everything `sampleWeek` already guarantees: determinism given a seed, pinned/overdue precedence over the weighted pool, and rollover of vibes that don't fit.
- Spread a recurring vibe's multiple occurrences across the window rather than clustering them adjacently, where the sampling mechanism allows it.

**Non-Goals:**
- Weather behavior beyond the reliable forecast horizon (what to do with days 8–14 of a 14-day window, where forecast confidence drops). That is fully owned by the sibling change `weather-bucket-planning`; this change only plumbs the window through as the `days` argument to `fetchWeatherForecast` (which already accepts and clamps an arbitrary horizon).
- Recipe-level dedup — already guaranteed by the existing cross-slot `DiversifyState`/`usedSlugs` mechanism in `assembleProposal`; this change does not touch it.
- Changing `default_cooking_nights`' meaning or its own onboarding capture beyond noting that it now applies within a window rather than within an implicit week.
- Deciding the exact cadence-question wording, the enum-vs-free-integer input shape, or the precise cadence→days mapping (see Open Questions) — those are resolved during the apply phase, not baked here.
- A pool-size (`POOL_K`) change — the interaction between a longer window and per-slot candidate recall is flagged as an open question, not resolved here.

## Decisions

### D1 — `planning_cadence_days` is a new, explicit profile field, not inferred from `default_cooking_nights`

The window can't be safely derived from the existing cooking-nights count (a count says nothing about spread), so it needs its own field. It is asked directly at onboarding as a coarse choice ("a few days / weekly / two weeks" → roughly 3/7/14) rather than a raw day count, matching how the rest of onboarding favors a small set of natural-language choices over asking for exact numbers (see `freezer_capacity_estimate`'s `tight | moderate | spacious` enum for precedent). Whether the stored value is a small controlled enum or a free integer, and the exact mapping, is deferred (Open Questions) — the requirement below is written at the "an integer number of days is available to the planner" level so it doesn't prejudge that shape.

*Alternative — derive the window from `default_cooking_nights` by assuming a fixed nights-per-week ratio:* rejected; conflates two independent knobs (how far ahead vs. how often) and gives no honest signal for the two-week-shopper case the change exists to serve.

### D2 — The window is a single derived value with three consumers, not three separate fields

`planning_cadence_days` is stored once; `propose_meal_plan` derives the **window** from it and applies that same number to (a) the weather forecast horizon (replacing the hardcoded `7` in `src/meal-plan-proposal-tool.ts`), (b) the number of night-vibe slots to shape via `sampleWeek` (still gated by `default_cooking_nights` as the in-window count — the window does not by itself increase how many nights get cooked), and (c) the per-vibe recurrence cap in the new sampling scheme (D3). Keeping one source of truth avoids the three consumers drifting out of sync.

*Alternative — separate "weather horizon" and "repeatability window" fields:* rejected as needless surface area; both are the same "how far out am I actually planning" question the caller already answered once.

### D3 — Bounded-multiplicity weighted sampling replaces at-most-once sampling

`sampleWeek`'s Level 1 shape-the-week step keeps its existing precedence order (pinned → overdue/forced → weighted pool) and its existing weight computation (`computeWeights` — debt curve × weather multiplier, unchanged). What changes is the **pool-fill step**: instead of `weightedSampleWithoutReplacement`, which treats each vibe id as a single ticket removed from the drum after one win, each non-forced vibe's ticket is now eligible to be drawn up to `max(1, floor(window / vibe_period))` times before it is removed from the pool — a weekly-period vibe (period 7) in a 14-day window gets a cap of 2; a monthly-period vibe (period 30) in the same window still caps at 1 (`floor(14/30) = 0`, floored up to the `max(1, …)` minimum so every vibe remains eligible at least once). Sampling proceeds draw-by-draw (still seeded, still deterministic) and a vibe's ticket is discarded once its cap is reached, rather than after its first win. Where the palette has enough distinct vibes that recurrences aren't forced adjacent by exhaustion, recurrence spacing is achieved by making a just-placed occurrence temporarily less likely to be drawn again immediately (the specific spacing mechanism — e.g., a short per-draw cooldown vs. a post-hoc reshuffle — is an implementation/Open Question, not fixed here).

Forced (pinned/overdue) placement is unaffected in cardinality — a palette shouldn't declare the same vibe pinned or overdue twice — but the precedence rule now reads as "forced vibes are placed first, up to their own cap of 1 (pinned/overdue placement is a single force-place per vibe id, not itself repeated), then the weighted pool fills the rest with the new bounded-multiplicity draw." Rollover (a forced vibe that doesn't fit) is unchanged: it still rolls to next time and its debt keeps climbing.

*Alternative — sample without replacement over an "expanded" pool where each vibe appears `cap` times as a distinct ticket:* considered equivalent in spirit but rejected as the primary framing because it complicates the Efraimidis–Spirakis key computation's determinism story (duplicate ids need a further deterministic tiebreak) and makes "cap reached, remove" a less direct fit than tracking a per-vibe remaining-count as sampling proceeds.

### D4 — Recipe-level dedup is explicitly out of scope, by design

Two slots landing on the same vibe id resolve to two different recipes because `assembleProposal` already threads `usedSlugs` across every slot in the plan, vibe-agnostic. This change adds no new dedup logic at the recipe level — it only changes how many times a *vibe* (not a recipe) may be drawn.

### D5 — Weather horizon plumbing only; reliability semantics deferred

`fetchWeatherForecast(location, days)` already clamps `days` to `[1, 16]`, so passing the window straight through (`fetchWeatherForecast(resolveZip(prefs), window)`) is a mechanical change — no new weather-side logic. What the caller does with days beyond the reliable forecast window (treat as neutral, fall back to seasonal norms, etc.) is entirely the `weather-bucket-planning` change's concern; this change's `sampleWeek` interaction with weather (`weatherMultiplier`, `deriveVibes`) is otherwise untouched.

## Open Questions

- **Exact cadence→days mapping and input shape.** Whether `planning_cadence_days` is a small controlled enum (`few_days | weekly | two_weeks` mapping to fixed day counts) or a free integer the agent sets after a natural-language exchange, and the precise day values each bucket maps to (3? 4? for "a few days"; is "two weeks" exactly 14 or a caller-adjustable number?).
- **How recurrences are spaced within the plan.** The bounded-multiplicity draw (D3) says a vibe *can* recur up to its cap; it doesn't yet fix the mechanism that discourages two occurrences from landing on adjacent nights (a cooldown window, a minimum-gap constraint, a post-hoc local swap, or accepting adjacency as a rare, harmless edge case).
- **Interaction of a long window with pool size / `POOL_K`.** `buildPool` currently ranks a fixed `POOL_K = 24` candidates per vibe before diversify-selection narrows them. A 14-day window with several vibes recurring could mean more total slots pulling from the same per-vibe pool than today's ~5-night case ever exercised — whether `POOL_K` needs to scale with expected occurrences-per-vibe, or stays fixed, is unresolved.
- **Where `planning_cadence_days` lives in D1** — a new `profile` scalar column (mirroring `default_cooking_nights`), a `preferences` top-level scalar surfaced through the existing merge-patch (no migration), or a key inside the open `custom` JSON bag. The proposal defers this to the apply phase's exploration of `src/profile-db.ts`'s existing column/JSON conventions.

## Risks / Trade-offs

- **Under-specified spacing could cluster a recurring vibe adjacently** (e.g., pasta night twice in three days at the start of a 14-day plan) if the sampling mechanism doesn't actively discourage it — mitigated by treating spacing as an explicit Open Question rather than an assumed side effect, so the apply phase must decide and test it rather than discovering it as a bug.
- **A long window with a sparse palette** (few distinct vibes) could still produce heavy repetition even with caps working correctly, simply because there isn't enough palette variety to fill 14 nights — this is a palette-content problem, not a sampling bug, and stays out of scope.
- **Weather horizon plumbed but not yet reliability-aware.** Until `weather-bucket-planning` lands, passing a full 14-day window straight to `fetchWeatherForecast` and using its raw output for `weatherMultiplier` could let low-confidence far-out forecasts sway sampling as if they were as reliable as tomorrow's. This is called out as an explicit sequencing dependency, not silently accepted — the sibling change should land before (or atomically with) this one reaching a caller-visible 14-day default.
- **Cross-tenant safety:** `planning_cadence_days` is a per-tenant profile field read the same way `default_cooking_nights` is today; no new cross-tenant surface.
