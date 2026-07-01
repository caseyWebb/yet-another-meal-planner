## Why

`propose_meal_plan`'s Level-1 week shaping treats weather as a single **flattened, graded** signal: `weatherVibes = [...new Set(forecast.flatMap(d => d.meal_vibes))]` unions every forecast day's `meal_vibes` tags into one bag, and `weatherMultiplier` turns each night vibe's `weather_affinity`/`weather_antipathy` match count into a continuous multiplier applied uniformly to every slot. Two structural problems follow directly from that shape:

- **Proportion is destroyed.** One hot, dry day anywhere in the window flags `grill-friendly` at full strength for the *entire* week's sampling — a plan for a week that's mostly rainy still gets grill pressure on every slot, because the union can't tell "one day out of seven" from "every day."
- **Vibes get mispaired.** A continuous multiplier is a leaky abstraction: `weatherBoost` is a small per-match bump applied to *any* vibe with a matching affinity tag, so a vibe like "cozy soup night" that happens to declare an affinity overlapping a `comfort` tag can pick up a nonsensical boost on a day whose actual driver was rain, not cold — there's no structural barrier stopping a graded score from leaking a small, wrong signal onto an unrelated vibe.

Both are consequences of using a *continuous score over a flattened set* where the domain is actually **a handful of mutually exclusive daily weather characters** (it's either a grill day, a cold-comfort day, a wet day, or nothing distinctive — never several at once for the same day) and **a discrete question of which of those characters a given vibe belongs to**. This change replaces the flatten + graded-multiplier approach with discrete weather buckets and integer slot quotas.

## What Changes

- **NEW** a small, mutually-exclusive **weather category** set (proposed: `grill`, `cold-comfort`, `wet`, `mild`) derived **per forecast day** (not unioned across the window) by collapsing that day's `meal_vibes`/`condition` to exactly one category via a priority rule; `mild` is the no-strong-signal default.
- **NEW** night vibes carry discrete **bucket membership** — a subset of the non-`mild` categories a vibe belongs to — instead of (or reframing) the graded `weather_affinity` list. Membership defaults to **bucketless** (belongs to no category), which makes a vibe a **universal filler**: eligible for every category's quota and for `mild`/flex slots. A vibe that *is* bucketed (e.g. `grill`) becomes structurally ineligible for a conflicting bucket's quota (e.g. `wet`) — not merely de-weighted.
- **NEW** `sampleWeek`'s allocation step changes from a graded per-vibe multiplier to **quota-based allocation**: histogram the planning window's days by category, convert to integer slot quotas (largest-remainder rounding), then fill each category's quota from that category's member vibes plus bucketless vibes, ranked by the existing cadence-debt sampler. A quota with no eligible member degrades to a flex slot rather than going unfilled. `mild`-day quota is always flex (sampled from the whole palette by debt).
- **NEW** the archetype-derivation naming pass (`nameCluster`) additionally emits a discrete bucket label (or "neutral") for a newly derived night vibe, so derived vibes — today weather-blind — get bucket membership at creation time via the same model call already being made.
- **UNCHANGED** pinned/overdue force-placement semantics: pinned vibes stay sticky; an overdue vibe is force-placed regardless of bucket. The one refinement is that an overdue vibe whose bucket has **no matching day** in this window's forecast (its category's quota is zero) rolls over rather than being force-placed into a mismatched slot, with the existing `forceDueAt` overdue tier remaining the eventual escape hatch once it is *really* overdue (a grill vibe still gets forced in the end, just not opportunistically mismatched against the forecast).
- **UNCHANGED** determinism: allocation, rounding, and within-quota ranking are all pure functions of the forecast, palette, debt map, and seed — no new randomness beyond the existing seeded sampler.

## Capabilities

### New Capabilities

- `weather-bucket-planning`: discrete weather-category derivation from the forecast (one category per day, `mild` default), discrete bucket membership on night vibes (authored override + archetype-derivation classification), and quota-based slot allocation in `sampleWeek` that mirrors the forecast's weather mix across the planning window — replacing the flattened-union + graded-multiplier weather signal.

### Modified Capabilities

<!-- None. This changes how `propose-meal-plan-tool`'s Level-1 shaping consumes weather and how
     `night-vibe-archetype-derivation`'s naming pass classifies a derived vibe, but neither
     capability's own stated requirements (the two-level plan shape, cadence-debt sampling,
     pinned/overdue force-placement, statelessness/determinism; the archetype clustering +
     naming + dedup contract) change — only the weather input those requirements consume.
     Authored as a new capability, archival-order-independent of both, mirroring how
     `holistic-use-it-up` layered onto `meal-plan-proposal` without modifying it. -->

## Impact

- **`src/weather.ts`:** a new pure function collapses a day's `meal_vibes`/`condition` into one of the discrete weather categories (priority-ordered; `mild` default). `deriveVibes` and `WeatherDay.meal_vibes`/`condition` are unchanged — the category collapse is a new derivation layered on top, not a replacement of the existing per-day fields.
- **`src/night-vibe-schedule.ts`:** `sampleWeek` gains the quota-allocation step (day histogram → integer quotas → per-category fill from members ∪ bucketless, ranked by the existing debt sampler; a quota with no eligible member degrades to flex; `mild` is always flex). `NightVibeSpec` gains discrete bucket membership. Whether `weatherMultiplier`/`weatherBoost`/`weatherPenalty` are fully replaced by quotas or retained as a secondary within-bucket signal is an open question (below), not decided here.
- **`src/night-vibe-db.ts` + `migrations/d1/0025_night_vibes.sql`:** the `night_vibes.weather_affinity` column (JSON array today) is reframed as discrete bucket membership — see Open Questions for the reuse-vs-new-column decision; a migration is needed only if a new column is chosen.
- **`src/night-vibe-naming.ts`:** `nameCluster` additionally returns a bucket classification (one of the categories, or a neutral/bucketless marker) alongside the existing vibe phrase, reusing the same model call rather than adding a second one.
- **`src/meal-plan-proposal-tool.ts`:** replaces the `weatherVibes` flatten (`[...new Set(forecast.flatMap(...))]`) with per-day category derivation and the planning window sizing described below, passed into `sampleWeek`.
- **Docs (lockstep):** `docs/TOOLS.md` (`propose_meal_plan`'s weather description — quota mirroring, not a graded boost), `docs/SCHEMAS.md` (`night_vibes` — the bucket field's shape, reuse-vs-new), `docs/ARCHITECTURE.md` (the Level-1 shaping paragraph — replace the flatten/graded description with discrete buckets + quota allocation). `AGENT_INSTRUCTIONS.md`'s "fold weather in here, silently" guidance (the `search_recipes`-path skill instruction) is a separate, LLM-side weather use and is unaffected by this tool-internal change; no persona edit is required.

## Dependency

This change depends on the sibling `planning-cadence` change for the multi-day **planning window** (`planning_cadence_days`) and the **bounded-multiplicity debt sampler** that quota-fill reuses to rank a category's eligible vibes. The two ship in one PR, `planning-cadence` sequenced first; this proposal assumes `planning_cadence_days` exists and does not re-specify `planning-cadence`'s own requirements.
