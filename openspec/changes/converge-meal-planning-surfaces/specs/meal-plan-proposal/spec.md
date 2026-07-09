## ADDED Requirements

### Requirement: A Claude-authored ephemeral vibe set shapes the week

`propose_meal_plan` SHALL accept an optional **ephemeral vibe set** — an ordered set of `{ vibe, facets }` entries authored by the caller for a single request, carrying no cadence history and not persisted to the palette. When the set is present, it SHALL shape the week: its entries become the slot vibes the engine fills and composes, replacing the saved-palette cadence-debt sampling for that request; each entry's `vibe` phrase is embedded and ranked exactly as a `slots[].vibe` override, and its `facets` gate that slot. When the set is absent, `sampleWeek` SHALL shape the week from the saved palette by cadence-debt as today. The ephemeral set is the same primitive as a saved night vibe (a vibe phrase + optional facets); the only difference is lifespan. This makes the agent surface (which authors the set from interpreted intent) and the bare/web-app surface (which lets the palette shape the week) a single spectrum over one engine, one MMR pass, and one composition — the agent no longer hand-composes.

The ephemeral set SHALL respect the existing embedding budget: its phrases join the single batched embedding call that already covers `nudges.freeform` and `slots[].vibe` overrides (the `Off-hot-path composition and legibility` requirement), so a request whose ephemeral phrases are all cache-served makes no additional AI call, and a request supplying no ephemeral set and no override/freeform text makes no AI call at all. The ephemeral set SHALL NOT bypass the hard gate (diet / reject / makeability) or the diversify pass — it supplies slot intent, not selection.

#### Scenario: An authored ephemeral vibe set shapes the week

- **WHEN** `propose_meal_plan` is called with an ephemeral vibe set of three entries and no saved-palette dependence
- **THEN** the engine fills and composes three slots from those entries (embedding + ranking + facet-gating each like a slot override), and the saved palette's cadence-debt sampling does not drive slot selection for that request

#### Scenario: Absent ephemeral set falls back to the palette

- **WHEN** `propose_meal_plan` is called with no ephemeral vibe set
- **THEN** `sampleWeek` shapes the week from the saved night-vibe palette by cadence-debt, exactly as before

#### Scenario: The ephemeral set honors the single-embedding budget

- **WHEN** an ephemeral vibe set is supplied whose phrases are not all cache-served
- **THEN** the engine embeds them in the one batched call it already makes for freeform/override phrases, and a request whose ephemeral phrases are entirely cache-served triggers no additional AI call

#### Scenario: The ephemeral set does not bypass the hard gate

- **WHEN** an ephemeral entry's vibe would rank a recipe the diet / reject / makeability gate excludes
- **THEN** that recipe is not admitted — the ephemeral set supplies slot intent, and selection still runs through the hard gate and the MMR diversify
