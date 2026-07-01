## ADDED Requirements

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

The tool SHALL support iteration by re-invocation with constraints rather than server-held state: `lock` (pin chosen slots/recipes), `exclude` (swap specified recipes out), `nudges` (e.g. `max_time`, a protein target, novelty/variety strength), an optional `freeform` string, and a `seed`. Given a `seed`, re-invocation SHALL be reproducible; changing only the `seed` SHALL yield a different valid week. Discovery seeds (`list_new_for_me`) and at-risk pantry items SHALL be accepted as soft-priority inputs so accepted discoveries and use-it-up needs can claim slots before the palette fills the rest.

#### Scenario: Locked slots survive a re-roll

- **WHEN** a caller re-invokes with two slots `lock`ed and a new `seed`
- **THEN** the locked slots are preserved and the remaining slots are re-selected diversely against them

#### Scenario: At-risk pantry items bias without gating

- **WHEN** a caller passes at-risk pantry items as boost inputs
- **THEN** slots that use those items are favored, with no gated-out recipe admitted

### Requirement: Off-hot-path composition and legibility

The proposal SHALL be a hot-path composition over cron-captured vectors (recipe embeddings, the caller's favorites, the taste and night-vibe vectors): cosine, MMR, and set math only. The tool SHALL make **at most one** embedding call, and only when a `freeform` string is supplied (embedded as one additional query vector); a request without freeform text SHALL make **no** AI call. Each chosen main SHALL carry a `why[]` explaining its selection (e.g. nearest-liked favorite, uses an at-risk perishable, weather fit, novel/never-cooked). An empty or too-thin slot (no makeable candidate) SHALL be surfaced as an explicit empty slot with a reason, never silently dropped.

#### Scenario: No freeform text means no AI call

- **WHEN** no `freeform` string is supplied
- **THEN** the tool issues no Workers AI request and composes entirely from stored vectors

#### Scenario: An unfillable slot is surfaced, not dropped

- **WHEN** a slot has no makeable candidate
- **THEN** it is returned as an explicit empty slot with a reason, and the rest of the week is still proposed
