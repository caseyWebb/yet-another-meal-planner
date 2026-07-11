## RENAMED Requirements

- FROM: `### Requirement: The candidate pool is course-gated to mains by default`
- TO: `### Requirement: The candidate pool is course-gated per meal`

## MODIFIED Requirements

### Requirement: Two-level meal-plan proposal

The system SHALL provide a synchronous, stateless `propose_meal_plan` tool that builds a proposed week in two levels: **(1) shape** — run **per meal**: the palette partitions by `meal`, and `sampleWeek` samples each meal's slots from that meal's vibes with that meal's count, weighted by cadence-debt as today (weather quotas apply to the dinner pass only — the `weather-bucket-planning` capability); **(2) fill** — for each slot's query vector, retrieve facet-gated candidates and select a recipe in **one** shared compose pass across all meals (one `assembleProposal`: cross-slot MMR/diversify, facet-spread, at-risk set-cover), still making at most one batched embedding call per request.

Per-meal counts SHALL come from a **`meals?: { breakfast?, lunch?, dinner? }`** parameter (each an integer 0–14, **per-window, not week-scaled**; the planning window continues to bound recurrence caps, not counts), with a per-meal default chain: explicit `meals` → the stored `cadence[meal]` → the read-time derivation (`dinner`: `default_cooking_nights ?? 5`; `breakfast`/`lunch`: 0). **`nights?`** SHALL be retained for one deprecation window as an alias for `meals.dinner = N`, ignored without error when `meals` is supplied (a docs/TOOLS.md Deprecations row). `lock`, `exclude`, `nudges`, `freeform`, `seed`, `slots[]`, `new_for_me`, and `boost_ingredients` are retained unchanged (D8/D20: the member-surface cuts are control removals only, never tool params); string `lock`s and `new_for_me` force-placements are **dinner** slots (a lock is "cook this this week" intent — dinner-shaped by construction; per-meal pinning is available via `slots[].recipe` or an `ephemeral_vibes[].meal` entry plus a pin).

The tool SHALL return a **structured** proposal (not prose): a **flat** `plan[]` in which each slot carries its **`meal`**, ordered breakfast → lunch → dinner and position-stable within each meal; per slot a chosen `main` (slug, title, description, score) with its corpus `sides`, the perishables it uses, and legibility `flags`; plus week-level `variety` diagnostics and the `diagnostics` (seed, λ, pool sizes) needed to reproduce or re-roll it — extended with `diagnostics.meals: { <meal>: { requested, filled, empty } }` and `diagnostics.attendance: { effective, ignored }`, with `diagnostics.nights` kept as the dinner alias for the deprecation window. The tool SHALL be **stateless** — it holds no proposal between calls and makes no implicit writes; committing a plan remains the caller's separate action.

#### Scenario: A request returns a shaped-and-filled multi-meal week

- **WHEN** a caller requests `meals: { breakfast: 2, dinner: 4 }`
- **THEN** the tool returns 2 breakfast slots sampled from the breakfast palette and 4 dinner slots from the dinner palette, each slot carrying its `meal`, ordered breakfast → lunch → dinner, with `diagnostics.meals` reporting per-meal requested/filled/empty — in one call

#### Scenario: Counts default from the cadence map

- **WHEN** a caller supplies no `meals` and no `nights` and their stored cadence is `{ breakfast: 0, lunch: 2, dinner: 5 }`
- **THEN** the proposal shapes 0 breakfast, 2 lunch, and 5 dinner slots

#### Scenario: The nights alias is window-scoped

- **WHEN** a caller supplies `nights: 4` and no `meals` during the deprecation window
- **THEN** the request behaves exactly as `meals: { dinner: 4 }`; and when both are supplied, `nights` is ignored without error

#### Scenario: Proposing writes nothing

- **WHEN** `propose_meal_plan` runs
- **THEN** it mutates no `meal_plan` or `grocery_list` state — proposing is read-only, and persisting the plan is a separate caller action

### Requirement: The candidate pool is course-gated per meal

Each vibe slot's candidate pool SHALL be course-gated **by the slot's meal**. Dinner and lunch slots keep the existing default gate: recipes whose effective `course` includes `main`, or whose effective `course` is **empty** (a not-yet-classified recipe is unknown, not known-non-main — the gate SHALL fail open so an unclassified corpus is never silently hidden). **Breakfast slots SHALL gate on effective `course` includes `breakfast`, or empty (the same fail-open)** — keeping breakfast pools from filling with dinner mains. The default SHALL be suppressed when the slot's effective facet set carries an **explicit `course`** (a vibe authored with `facets.course`, e.g. a breakfast-for-dinner vibe), in which case that explicit course facet gates alone with its existing exact-containment semantics. The gate SHALL apply to what the system volunteers, not what the caller demands: `lock`ed recipes and `slots[].recipe` pins SHALL resolve exactly as today, regardless of course. Slot alternates (`alternates`, `alt_similar`, `alt_different`) SHALL be gate survivors by construction (drawn from the gated pool). A pool the gate empties SHALL follow the existing empty-slot contract — an explicit empty slot with a reason, never silently dropped.

#### Scenario: A component sub-recipe never fills a dinner slot by default

- **WHEN** a corpus recipe's effective `course` is `["side"]`, `["component"]`, or any set not containing `main` (e.g. a fresh pasta dough) and a proposal is requested with no explicit course facet on the sampled dinner vibes
- **THEN** that recipe appears in no dinner slot's main, `alternates`, `alt_similar`, or `alt_different`

#### Scenario: A breakfast slot gates on breakfast

- **WHEN** a breakfast slot's pool is built and the corpus contains dinner mains (`course: ["main"]`), a classified breakfast dish (`course` including `breakfast`), and an unclassified recipe (empty `course`)
- **THEN** the pool admits the breakfast dish and the unclassified recipe (fail-open) and excludes the dinner mains

#### Scenario: An unclassified recipe passes the gate (fail-open)

- **WHEN** a recipe's effective `course` is empty because it has not yet been classified
- **THEN** the default course gate admits it to the pool for any meal (the other gates still apply), so a not-yet-converged corpus still proposes

#### Scenario: A vibe's explicit course facet suppresses the default

- **WHEN** a sampled vibe's stored facets carry `course: "breakfast"`
- **THEN** that slot's pool gates on `course: "breakfast"` by containment exactly as today, and the meal-default gate does not additionally apply to that slot

#### Scenario: A caller's explicit lock or pin is honored regardless of course

- **WHEN** a caller `lock`s or pins (`slots[].recipe`) a recipe whose effective `course` does not contain the slot's meal-default course
- **THEN** the recipe fills its slot under the existing lock/pin resolution rules — the course gate never vetoes an explicit caller choice

#### Scenario: A gate-emptied pool surfaces as an explicit empty slot

- **WHEN** every recipe a vibe's facet gate and retrieval would admit is excluded by the meal's course gate
- **THEN** the slot is returned as an explicit empty slot with a reason (with no alternates, since no gate survivor exists), the rest of the week is still proposed, and the caller's escape hatches are a `slots[].recipe` pin or authoring the vibe with an explicit `course` facet

### Requirement: A Claude-authored ephemeral vibe set shapes the week

`propose_meal_plan` SHALL accept an optional **ephemeral vibe set** — an ordered set of `{ vibe, facets, meal? }` entries authored by the caller for a single request, carrying no cadence history and not persisted to the palette. Each entry's **`meal`** defaults to `'dinner'`; the set therefore authors slots *with meals*. When the set is present, it SHALL shape the week: its entries become the slot vibes the engine fills and composes, replacing the saved-palette cadence-debt sampling for that request; each entry's `vibe` phrase is embedded and ranked exactly as a `slots[].vibe` override, its `facets` gate that slot, and its `meal` selects the slot's meal (and meal-default course gate). When the set is absent, `sampleWeek` SHALL shape the week from the saved palette by per-meal cadence-debt sampling. The ephemeral set is the same primitive as a saved meal vibe (a vibe phrase + optional facets + a meal); the only difference is lifespan. This makes the agent surface (which authors the set from interpreted intent) and the bare/web-app surface (which lets the palette shape the week) a single spectrum over one engine, one MMR pass, and one composition — the agent no longer hand-composes.

The ephemeral set SHALL respect the existing embedding budget: its phrases join the single batched embedding call that already covers `nudges.freeform` and `slots[].vibe` overrides (the `Off-hot-path composition and legibility` requirement), so a request whose ephemeral phrases are all cache-served makes no additional AI call, and a request supplying no ephemeral set and no override/freeform text makes no AI call at all. The ephemeral set SHALL NOT bypass the hard gate (diet / reject / makeability) or the diversify pass — it supplies slot intent, not selection.

The `new_for_me` force-placement tier (defined for the palette path in `weather-bucket-planning`) SHALL be **inert when an ephemeral vibe set drives the week**: because the authored entries — not the cadence sampler — are the week's slots, the caller SHALL place accepted new-for-me discoveries explicitly, by authoring an ephemeral entry that describes a discovery or by pinning it with `lock`. On the palette path (no ephemeral set) `new_for_me` SHALL force-place accepted discoveries as `weather-bucket-planning` specifies.

#### Scenario: An authored ephemeral vibe set shapes a multi-meal week

- **WHEN** `propose_meal_plan` is called with an ephemeral vibe set of three entries, one carrying `meal: "lunch"` and two omitting `meal`
- **THEN** the engine fills and composes one lunch slot and two dinner slots from those entries (embedding + ranking + facet-gating each like a slot override), and the saved palette's cadence-debt sampling does not drive slot selection for that request

#### Scenario: Absent ephemeral set falls back to the palette

- **WHEN** `propose_meal_plan` is called with no ephemeral vibe set
- **THEN** `sampleWeek` shapes the week from the saved meal-vibe palette by per-meal cadence-debt sampling, exactly as before

#### Scenario: The ephemeral set honors the single-embedding budget

- **WHEN** an ephemeral vibe set is supplied whose phrases are not all cache-served
- **THEN** the engine embeds them in the one batched call it already makes for freeform/override phrases, and a request whose ephemeral phrases are entirely cache-served triggers no additional AI call

#### Scenario: The ephemeral set does not bypass the hard gate

- **WHEN** an ephemeral entry's vibe would rank a recipe the diet / reject / makeability gate excludes
- **THEN** that recipe is not admitted — the ephemeral set supplies slot intent, and selection still runs through the hard gate and the MMR diversify

#### Scenario: New-for-me force-placement is inert under an ephemeral set

- **WHEN** `propose_meal_plan` is called with both an ephemeral vibe set and a `new_for_me` list
- **THEN** the ephemeral entries shape the week and the `new_for_me` seeds force-place nothing — the caller places accepted discoveries by authoring them into the ephemeral set or by locking them — whereas on the palette path (no ephemeral set) the same `new_for_me` list force-places them

## ADDED Requirements

### Requirement: Vibe-meal binding surfaces empty meals explicitly

Each meal's slots SHALL be sampled only from that meal's vibes. A meal with a requested count > 0 but **zero vibes of that meal** SHALL yield **explicit empty slots** (`empty_reason: "no_palette_for_meal"`) plus a `notes[]` entry naming the escapes — `add_meal_vibe` with that meal, or an `ephemeral_vibes` entry carrying `meal` — and SHALL NEVER silently fall back into another meal's palette.

#### Scenario: An empty lunch palette yields explicit empty slots

- **WHEN** a caller requests `meals: { lunch: 2, dinner: 4 }` and the palette contains only dinner vibes
- **THEN** the proposal returns 2 explicit empty lunch slots with `empty_reason: "no_palette_for_meal"`, a note naming the escapes, and 4 normally-filled dinner slots — no dinner vibe fills a lunch slot

### Requirement: The engine never duplicates a recipe within one proposal

The propose engine SHALL emit one recipe **at most once per proposal, across all meals** — the engine half of the D26-final planner-no-duplicates invariant (the op layer's slug-global coalesce is the commit half). Explicit caller pins and locks are exempt, mirroring D26-final's explicit-user-action exception.

#### Scenario: Cross-meal selection never repeats a recipe

- **WHEN** a multi-meal proposal's breakfast and dinner pools both rank the same recipe highly
- **THEN** the composed proposal places it in at most one slot; the other slot resolves to a different candidate

#### Scenario: Explicit pins are exempt

- **WHEN** a caller pins the same recipe onto two slots via `slots[].recipe`
- **THEN** both pins are honored — explicit caller action may duplicate; the engine's own selection never does

### Requirement: Household blend with attendance, caller-neutral (D29-final)

The propose contract SHALL be written household-blend-first, with today's single-profile tenant as the degenerate case. **Hard constraints** (dietary gates, equipment, rejects) SHALL be the **UNION across the household roster** — and the hard floor SHALL NEVER vary with attendance (an absent member's hard constraints still apply; only soft weighting moves). **Soft ranking** SHALL be the household blend of member taste profiles with **uniform weights over the effective eating set**; absent an attendance signal, the blend covers all members equally. The roster SHALL come from one seam — `householdRoster(env, tenant)`, returning `[tenant]` in band 1 (the founding member's id equals the tenant id per D10) — so band 5 changes one function body and zero contract sentences; the blend and union are pure functions (`blendTasteProfiles`, `unionHardConstraints`) fed a singleton array in band 1, producing today's ranking byte-for-byte.

`propose_meal_plan` (and `display_meal_plan`, and the member `POST /api/propose`) SHALL accept **`attendance?: { away?: string[] } | { only?: string[] }`** — exactly one of `away`/`only` (both supplied is `validation_failed`); handles are opaque strings. **Fail-open semantics**: unknown handles are **dropped, never errors**, and echoed in `diagnostics.attendance.ignored`; the effective eating set is `only ∩ roster` or `roster − away`; an **empty effective set fails open to the full roster** (with a diagnostics note) — an attendance mistake can never produce a plan for nobody. An assigned vibe contributes slots and cadence-debt only when its `members` intersect the effective eating set (NULL = everyone; all-unresolvable members fail open to everyone with a diagnostics note — the `meal-vibe-palette` capability). `diagnostics.attendance = { effective, ignored }` SHALL always be returned.

#### Scenario: Band-1 degeneracy is today's ranking, observably

- **WHEN** any propose call runs in a single-member band-1 deployment, with or without an `attendance` param
- **THEN** the effective eating set is the whole (singleton) roster, ranking is byte-for-byte today's, and `diagnostics.attendance` reports `{ effective: [<tenant>], ignored: [...] }`

#### Scenario: Unknown handles are dropped and reported

- **WHEN** a caller passes `attendance: { away: ["the-kids"] }` and no such handle resolves against the roster
- **THEN** the handle is dropped (no error), echoed in `diagnostics.attendance.ignored`, and the plan ranks for the full roster

#### Scenario: An empty effective set fails open

- **WHEN** an `only` list intersected with the roster is empty
- **THEN** the proposal ranks for the full roster with a diagnostics note, never producing a plan for nobody

#### Scenario: The hard floor never moves with attendance

- **WHEN** a member marked `away` has a dietary Avoid or a rejected recipe
- **THEN** the proposal still excludes everything their hard constraints exclude — attendance moves soft weighting only

#### Scenario: Exactly one attendance form is accepted

- **WHEN** a caller supplies both `away` and `only`
- **THEN** the request fails with a structured `validation_failed`, not a silent pick between them
