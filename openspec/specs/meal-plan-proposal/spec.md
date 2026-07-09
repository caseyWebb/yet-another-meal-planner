# meal-plan-proposal Specification

## Purpose
TBD - created by archiving change propose-meal-plan-tool. Update Purpose after archive.
## Requirements
### Requirement: Two-level meal-plan proposal

The system SHALL provide a synchronous, stateless `propose_meal_plan` tool that builds a proposed week in two levels: **(1) shape** — sample N night-vibe slots for the requested number of nights, weighted by weather and cadence-debt (the `night-vibe-palette` capability); **(2) fill** — for each slot's query vector, retrieve facet-gated candidates and select a recipe. The tool SHALL return a **structured** proposal (not prose): per slot a chosen `main` (slug, title, description, score) with its corpus `sides`, the perishables it uses, and legibility `flags`; plus week-level `variety` diagnostics and the `diagnostics` (seed, λ, pool sizes) needed to reproduce or re-roll it. The tool SHALL be **stateless** — it holds no proposal between calls and makes no implicit writes; committing a plan remains the caller's separate action.

#### Scenario: A request returns a shaped-and-filled week

- **WHEN** a caller requests a 4-night plan
- **THEN** the tool returns 4 slots, each with a chosen main and its composed sides, plus week-level variety diagnostics, in one call

#### Scenario: Proposing writes nothing

- **WHEN** `propose_meal_plan` runs
- **THEN** it mutates no `meal_plan` or `grocery_list` state — proposing is read-only, and persisting the plan is a separate caller action

### Requirement: Diversified selection, not top-K

Within a slot's retrieved candidates the system SHALL select by **diversity**, not raw cosine rank: a Maximal Marginal Relevance pass (a tunable `λ` trading relevance against similarity to already-selected picks) layered with **facet-spread constraints** (a per-protein cap and cuisine spread across the week). Relevance SHALL be the existing blended score (cosine + nearest-favorite + freshness + pantry overlap); the diversity term SHALL use recipe→recipe cosine over the stored embeddings. Selection SHALL be **deterministic given a seed** — identical inputs and seed yield the identical week; a different seed yields a different valid week. Diversity SHALL operate **only over survivors of the hard gate** — it SHALL NOT admit a recipe the diet / reject / makeability gate excluded, and SHALL NOT override those gates.

#### Scenario: λ = 1 reduces to top-K

- **WHEN** selection runs with `λ = 1`
- **THEN** it returns the top picks by blended score with no diversity penalty applied

#### Scenario: Lowering λ increases variety within the gate

- **WHEN** `λ` is lowered
- **THEN** near-duplicate high-cosine recipes are spread apart and the week's protein/cuisine variety increases, with no gated-out recipe ever appearing

#### Scenario: Seed determinism and re-roll

- **WHEN** the same seed and inputs are supplied twice
- **THEN** the identical week is returned; and when only the seed changes, a different but still gate-valid, still-diverse week is returned

### Requirement: Deterministic plate composition

For each chosen main the system SHALL compose the plate deterministically: corpus sides via the main's `pairs_with` (curated) then retrieval on its `side_search_terms` with `course: side` (the `recipe-sides` mechanics); a **perishable-waste** flag when a main uses less than a purchase unit of a perishable that no other slot shares; and a **meal-prep** flag on `meal_preppable` mains. The tool SHALL NOT invent an **open-world** side (a trivial preparation with no corpus recipe) — when no corpus side fits, it SHALL flag the slot as side-unfilled rather than fabricating one, leaving open-world sides and freeform iteration to the calling surface.

#### Scenario: Curated pairings fill sides first

- **WHEN** a chosen main has `pairs_with` entries
- **THEN** those corpus sides fill the slot's sides before any side retrieval runs

#### Scenario: Single-use perishable is flagged

- **WHEN** a main uses a perishable below a purchase unit that no other proposed main uses
- **THEN** the slot carries a waste flag naming that item

#### Scenario: No corpus side is not fabricated

- **WHEN** no corpus side complements a main
- **THEN** the slot is flagged side-unfilled and no fabricated open-world side is returned

### Requirement: Stateless iteration and re-roll

The tool SHALL support iteration by re-invocation with constraints rather than server-held state: `lock` (pin chosen recipes as vibe-less locked slots), `exclude` (swap specified recipes out of every pool, alternate list, and pin), `nudges` (`max_time_total`, `variety` strength, a week-level `proteins` soft-boost list, and a `freeform` phrase), a `seed`, and per-slot **`slots` constraints** keyed by vibe id: `protein`/`cuisine` facet pins and an explicitly nullable `max_time_total` threaded into that slot's candidate gate with precedence **slot pin > global `nudges.max_time_total` > the vibe's own facets** (a `null` per-slot time cap lifts the vibe's own cap for that night); a `vibe` phrase overriding that slot's query vector (gate and vibe identity unchanged); and a `recipe` pin filling that slot with the named recipe while **keeping the slot's vibe identity and provenance** — resolved under the same rules as `lock` (case-insensitive, embedded, non-rejected, not excluded; an unresolvable pin is returned as an explicit empty slot, never silently dropped), admitted into the week's diversify state so the remaining slots diversify away from it, and marked on the returned slot. A `slots` constraint whose vibe id is not sampled this week SHALL be inert (no error) so a replayed client session survives palette edits. Given a `seed`, re-invocation SHALL be reproducible; changing only the `seed` SHALL yield a different valid week. Discovery seeds (`list_new_for_me`) and at-risk pantry items SHALL be accepted as soft-priority inputs so accepted discoveries and use-it-up needs can claim slots before the palette fills the rest.

#### Scenario: Locked slots survive a re-roll

- **WHEN** a caller re-invokes with two slots `lock`ed and a new `seed`
- **THEN** the locked slots are preserved and the remaining slots are re-selected diversely against them

#### Scenario: At-risk pantry items bias without gating

- **WHEN** a caller passes at-risk pantry items as boost inputs
- **THEN** slots that use those items are favored, with no gated-out recipe admitted

#### Scenario: A per-slot facet pin narrows one night's gate

- **WHEN** a caller pins `protein: "fish"` on one sampled vibe's slot
- **THEN** that slot's candidate pool contains only fish recipes that also clear the vibe's other facets and the hard gate, and every other slot's pool is unaffected

#### Scenario: A null per-slot time cap lifts the vibe's own cap

- **WHEN** a vibe carries `max_time_total: 30` in its facets and the caller pins `max_time_total: null` on its slot
- **THEN** that slot's pool is not time-gated for this request, while the vibe's stored facets are unchanged

#### Scenario: A recipe pin keeps the slot's vibe identity

- **WHEN** a caller pins a resolvable recipe onto a sampled vibe's slot
- **THEN** the slot returns that recipe as its main with its `vibe_id` and reason intact and an explicit pinned marker, and the rest of the week's selection diversifies away from the pinned recipe

#### Scenario: A constraint for an unsampled vibe is inert

- **WHEN** the `slots` array names a vibe id that this week's shape did not sample (or that no longer exists in the palette)
- **THEN** the constraint has no effect and the request succeeds

### Requirement: Off-hot-path composition and legibility

The proposal SHALL be a hot-path composition over cron-captured vectors (recipe embeddings, the caller's favorites, the taste and night-vibe vectors): cosine, MMR, and set math only. The tool SHALL make **at most one** embedding call per request — a single batched call covering only the `nudges.freeform` phrase and any `slots[].vibe` override phrases not served by the query-embedding cache; a request supplying no such text SHALL make **no** AI call. The freeform phrase and the `nudges.proteins` list SHALL enter ranking as **bounded additive terms** subordinate to the primary vibe relevance — they reorder gate survivors and SHALL NOT admit a recipe the hard gate excluded. A `slots[].vibe` override SHALL replace only that slot's query vector — its facet gate and vibe identity are unchanged, the returned slot is marked overridden, and a not-yet-embedded palette vibe with an override SHALL become fillable in the same request rather than returning an empty slot. Each chosen main SHALL carry a `why[]` explaining its selection (e.g. nearest-liked favorite, uses an at-risk perishable, weather fit — including, for a slot placed by a non-`mild` weather-category quota, that category, which SHALL also be returned structurally on the slot — a matched freeform ask, a requested protein, novel/never-cooked, a caller pin). An empty or too-thin slot (no makeable candidate) SHALL be surfaced as an explicit empty slot with a reason, never silently dropped.

#### Scenario: No freeform or override text means no AI call

- **WHEN** a request supplies no `nudges.freeform` and no `slots[].vibe` phrase
- **THEN** the tool issues no Workers AI request and composes entirely from stored vectors

#### Scenario: An unfillable slot is surfaced, not dropped

- **WHEN** a slot has no makeable candidate
- **THEN** it is returned as an explicit empty slot with a reason, and the rest of the week is still proposed

#### Scenario: Freeform steers without gating

- **WHEN** a caller supplies `nudges.freeform: "more soup, lighter dinners"`
- **THEN** gate-surviving candidates closer to the phrase rank higher across every slot, no gated-out recipe appears, and a main materially matched by the phrase says so in its `why[]`

#### Scenario: A vibe override fills a fresh, unembedded vibe

- **WHEN** a palette vibe has no cron-captured vector yet and the caller supplies its phrase as that slot's `vibe` override
- **THEN** the phrase is embedded at request time and the slot fills normally instead of returning an explicit empty slot

### Requirement: Alternates are returned per slot from the ranked pool

Each vibe slot SHALL return swap material derived from its **already-computed ranked pool** with no additional retrieval or model call: `alternates` — the top remaining pool candidates (bounded, compact lite rows: slug, title, protein, cuisine, time_total), excluding the week's already-used recipes and the slot's own main; `alt_similar` — the remaining candidate nearest by cosine to the chosen main; and `alt_different` — the highest-ranked remaining candidate of a different cuisine than the main (each `null` when none qualifies). Alternates SHALL be gate survivors by construction — a rejected, gated-out, or excluded recipe SHALL never appear. An **empty** vibe slot SHALL still return its pool's alternates (the escape hatch for an over-constrained night); a vibe-less locked slot, having no pool, SHALL return none. Alternates SHALL be deterministic for a given request.

#### Scenario: The swap menu is powered without a second retrieval

- **WHEN** a proposal returns a filled vibe slot
- **THEN** the slot carries bounded alternates plus nearest-similar and different-cuisine picks drawn from that slot's ranked pool, none of which duplicate a recipe already used elsewhere in the week

#### Scenario: An over-constrained empty slot still offers alternates

- **WHEN** a slot returns no main because the variety caps blocked every pool candidate
- **THEN** the slot's alternates still list its remaining gate-surviving pool candidates so the caller can pick one explicitly

#### Scenario: Alternates never surface a rejected recipe

- **WHEN** a recipe is rejected by the caller or dropped by the facet/makeability gate
- **THEN** it appears in no slot's `alternates`, `alt_similar`, or `alt_different`

### Requirement: Request-time query embeddings are hash-cached

Request-time query-text embeddings (the propose freeform/override phrases and `search_recipes` ranked-mode vibes) SHALL be served through a shared content-addressed cache: keyed by a cryptographic hash over the embedding model id plus the normalized text (lowercased, trimmed, inner whitespace collapsed), stored in the ephemeral-infra KV namespace with a bounded TTL, holding the full-precision vector exactly as the model returned it. Cache misses within one request SHALL be embedded in a **single batched** Workers AI call and written back best-effort. The cache SHALL fail open — a KV read or write failure, or a malformed cached value, degrades to a plain embed and never fails the request. Because the key binds the model id, changing the embedding model SHALL orphan old entries rather than serve mismatched vectors. Scheduled reconciles that already hash-gate their embeddings in D1 SHALL NOT route through this cache.

#### Scenario: A repeated phrase costs no second embed

- **WHEN** the same freeform phrase (modulo case and whitespace) is submitted twice within the TTL
- **THEN** the second request reads the vector from the cache and makes no Workers AI call for it, and both requests rank with the byte-identical vector

#### Scenario: A cache failure degrades, never breaks

- **WHEN** the KV namespace errors on read or returns a malformed value
- **THEN** the text is embedded directly and the request succeeds

#### Scenario: The ranked search path shares the cache

- **WHEN** `search_recipes` runs a ranked spec whose vibe phrase was recently embedded (by either surface)
- **THEN** its query vector is a cache hit and the embed batch covers only uncached phrases

### Requirement: The candidate pool is course-gated to mains by default

Each vibe slot's candidate pool SHALL admit only **meal candidates** by default: recipes whose effective `course` includes `main`, or whose effective `course` is **empty** (a not-yet-classified recipe is unknown, not known-non-main — the gate SHALL fail open so an unclassified corpus is never silently hidden). The default SHALL be suppressed when the slot's effective facet set carries an **explicit `course`** (a vibe authored with `facets.course`, e.g. a breakfast-for-dinner vibe), in which case that explicit course facet gates alone with its existing exact-containment semantics. The gate SHALL apply to what the system volunteers, not what the caller demands: `lock`ed recipes and `slots[].recipe` pins SHALL resolve exactly as today, regardless of course. Slot alternates (`alternates`, `alt_similar`, `alt_different`) SHALL be meal candidates by construction (drawn from the gated pool). A pool the gate empties SHALL follow the existing empty-slot contract — an explicit empty slot with a reason, never silently dropped.

#### Scenario: A component sub-recipe never fills a slot by default

- **WHEN** a corpus recipe's effective `course` is `["side"]`, `["component"]`, or any set not containing `main` (e.g. a fresh pasta dough) and a proposal is requested with no explicit course facet on the sampled vibes
- **THEN** that recipe appears in no slot's main, `alternates`, `alt_similar`, or `alt_different`

#### Scenario: An unclassified recipe passes the gate (fail-open)

- **WHEN** a recipe's effective `course` is empty because it has not yet been classified
- **THEN** the default course gate admits it to the pool (the other gates still apply), so a not-yet-converged corpus still proposes

#### Scenario: A vibe's explicit course facet suppresses the default

- **WHEN** a sampled vibe's stored facets carry `course: "breakfast"`
- **THEN** that slot's pool gates on `course: "breakfast"` by containment exactly as today, and the default main-gate does not additionally apply to that slot

#### Scenario: A caller's explicit lock or pin is honored regardless of course

- **WHEN** a caller `lock`s or pins (`slots[].recipe`) a recipe whose effective `course` does not contain `main`
- **THEN** the recipe fills its slot under the existing lock/pin resolution rules — the course gate never vetoes an explicit caller choice

#### Scenario: A gate-emptied pool surfaces as an explicit empty slot

- **WHEN** every recipe a vibe's facet gate and retrieval would admit is excluded by the default course gate
- **THEN** the slot is returned as an explicit empty slot with a reason (with no alternates, since no gate survivor exists), the rest of the week is still proposed, and the caller's escape hatches are a `slots[].recipe` pin or authoring the vibe with an explicit `course` facet

### Requirement: A Claude-authored ephemeral vibe set shapes the week

`propose_meal_plan` SHALL accept an optional **ephemeral vibe set** — an ordered set of `{ vibe, facets }` entries authored by the caller for a single request, carrying no cadence history and not persisted to the palette. When the set is present, it SHALL shape the week: its entries become the slot vibes the engine fills and composes, replacing the saved-palette cadence-debt sampling for that request; each entry's `vibe` phrase is embedded and ranked exactly as a `slots[].vibe` override, and its `facets` gate that slot. When the set is absent, `sampleWeek` SHALL shape the week from the saved palette by cadence-debt as today. The ephemeral set is the same primitive as a saved night vibe (a vibe phrase + optional facets); the only difference is lifespan. This makes the agent surface (which authors the set from interpreted intent) and the bare/web-app surface (which lets the palette shape the week) a single spectrum over one engine, one MMR pass, and one composition — the agent no longer hand-composes.

The ephemeral set SHALL respect the existing embedding budget: its phrases join the single batched embedding call that already covers `nudges.freeform` and `slots[].vibe` overrides (the `Off-hot-path composition and legibility` requirement), so a request whose ephemeral phrases are all cache-served makes no additional AI call, and a request supplying no ephemeral set and no override/freeform text makes no AI call at all. The ephemeral set SHALL NOT bypass the hard gate (diet / reject / makeability) or the diversify pass — it supplies slot intent, not selection.

The `new_for_me` force-placement tier (defined for the palette path in `weather-bucket-planning`) SHALL be **inert when an ephemeral vibe set drives the week**: because the authored entries — not the cadence sampler — are the week's slots, the caller SHALL place accepted new-for-me discoveries explicitly, by authoring an ephemeral entry that describes a discovery or by pinning it with `lock`. On the palette path (no ephemeral set) `new_for_me` SHALL force-place accepted discoveries as `weather-bucket-planning` specifies.

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

#### Scenario: New-for-me force-placement is inert under an ephemeral set

- **WHEN** `propose_meal_plan` is called with both an ephemeral vibe set and a `new_for_me` list
- **THEN** the ephemeral entries shape the week and the `new_for_me` seeds force-place nothing — the caller places accepted discoveries by authoring them into the ephemeral set or by locking them — whereas on the palette path (no ephemeral set) the same `new_for_me` list force-places them

