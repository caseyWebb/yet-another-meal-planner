# guided-onboarding Specification

## Purpose
TBD - created by archiving change package-agent-as-plugin. Update Purpose after archive.
## Requirements
### Requirement: Guided first-run setup skill

The system SHALL provide a `setup` skill that handles a member's grocery profile **idempotently** across exactly three areas — **store location (ZIP)**, **hard diet gates** (restrictions and allergies, from explicit statements), and **rough cooking rhythm** (per-meal cadence and planning horizon): on an empty profile it walks first-time setup conversationally (rather than requiring a wall of typed input); on an existing profile it reads back what it already knows (via `read_user_profile()`) and edits only what the member names. It SHALL persist each area via the existing write tools — `update_preferences` (store, cadence) and `update_diet_principles` (hard gates). The skill itself SHALL NOT define an MCP tool — it composes tools owned by other capabilities. Like every workflow skill, it SHALL load `yamp-core` via its prerequisite line.

Everything beyond the three areas — kitchen equipment, starting pantry, staples, taste nuance, and rhythm detail — SHALL NOT be interrogated at setup: it is learned ambiently through use (per `ambient-preference-learning`) or entered on the member web app. The skill SHALL close a fresh setup by offering the natural next step (a first meal plan), handing off to the `plan` flow on acceptance.

#### Scenario: New member is guided through minimal setup

- **WHEN** a member with no existing profile begins onboarding
- **THEN** the skill asks for store ZIP, any hard dietary restrictions/allergies, and a rough cooking rhythm conversationally, writes each through the corresponding write tool, and then offers a first meal plan — with no equipment, pantry, staples, watchlist, or taste interrogation

#### Scenario: Diet gates come from explicit statements

- **WHEN** the member states "no pork, and I'm allergic to shellfish" during setup
- **THEN** the skill records both as hard gates via `update_diet_principles`, without a confirmation ceremony and without inferring any further restrictions

#### Scenario: Onboarding composes tools rather than defining its own

- **WHEN** the setup skill persists captured setup
- **THEN** it does so through write tools owned by other capabilities (`update_preferences`, `update_diet_principles`) and defines no MCP tool of its own

### Requirement: Onboarding triggers on an empty profile or explicit request

The setup skill SHALL be loadable both by explicit invocation and by a **deterministic initialization gate** in the `yamp-core` persona tier (which every workflow loads once per session). Before the first substantive action in a session, the agent SHALL call `read_user_profile`; when it reports `initialized: false`, the agent SHALL run `setup` before fulfilling the original request, then resume that request. The gate SHALL pass `missing` through to setup so already-completed areas can be skipped. The setup flow SHALL NOT force the member to provide everything at once.

The gate SHALL be **fail-open**: if `read_user_profile` returns an error (an indeterminate result), the agent SHALL proceed with the request normally — a transient failure SHALL NOT be treated as "not initialized." The gate SHALL be **skipped** when the active flow is itself `setup` (no self-loop) or `report-bug` (a new member must be able to report a bug without first completing setup).

#### Scenario: Uninitialized member is routed through setup first

- **WHEN** a member whose `read_user_profile` reports `initialized: false` makes a substantive request (e.g. "make me a menu")
- **THEN** the agent runs `setup` before fulfilling it, then resumes the original request

#### Scenario: Initialized member proceeds directly

- **WHEN** `read_user_profile` reports `initialized: true`
- **THEN** the gate passes and the agent fulfills the request without re-running setup

#### Scenario: Gate fails open on an indeterminate status

- **WHEN** `read_user_profile` returns an error rather than a clear initialized state
- **THEN** the agent proceeds with the request normally rather than forcing setup

#### Scenario: Bug reporting is not gated

- **WHEN** a brand-new (uninitialized) member invokes `report-bug`
- **THEN** the gate is skipped and the bug report proceeds without forcing setup first

#### Scenario: Setup does not gate itself

- **WHEN** the active flow is `setup`
- **THEN** the initialization gate is skipped so setup does not re-trigger itself

### Requirement: Incremental, resumable capture

The setup skill SHALL capture setup in small batches and persist each batch as it is gathered, so that an interrupted or abandoned setup leaves the already-provided information saved rather than lost. Each setup area SHALL be independently resumable: the skill SHALL check the area's own backing data (via `read_user_profile()`) and SHALL skip (or merely read back) an area that is already populated rather than re-interrogating it — e.g. it SHALL NOT re-walk the diet gates when `diet_principles` is already set in D1. This per-area idempotency is the single code path behind both first-run setup and returning-member review.

For a brand-new member, `read_user_profile()` returns `{ initialized: false, missing: [...all areas...] }`. The `missing` array signals which areas are empty and not yet set up. The skill SHALL use `missing` to determine which areas to walk and SHALL NOT treat an empty area as a tool failure nor trip the `report-bug` reflex.

#### Scenario: Interrupted setup keeps partial data

- **WHEN** a member provides some setup information and then stops partway through
- **THEN** the information already gathered has been written to D1 and is not lost

#### Scenario: Re-running skips already-populated areas

- **WHEN** the skill runs again after some areas were completed
- **THEN** it reads back the populated areas via `read_user_profile()` and asks only about the empty ones, without re-interrogating or overwriting settled areas

#### Scenario: New-member profile reads show empty areas, not errors

- **WHEN** the opening readback calls `read_user_profile()` for a brand-new member
- **THEN** the `missing` array indicates all unset areas and the skill treats each as an empty area to set up — it does not surface a tool failure or file a bug report

### Requirement: Store location captured before pricing-dependent steps

The onboarding skill SHALL capture the member's store location as the first setup area and persist it to the D1 `profile` row via `update_preferences`, because Kroger pricing and ordering hard-fail until a `preferred_location` is resolvable. It SHALL ask only for a ZIP (the location resolver requires only a 5-digit code) and SHALL NOT prompt for brand defaults at onboarding (those emerge during ordering). `update_preferences` writes the preferences fields passed in, merging them into the existing D1 row, so subsequent `update_preferences` calls for other fields do not clobber the already-written store ZIP.

#### Scenario: ZIP unblocks pricing

- **WHEN** a new member provides their ZIP during onboarding
- **THEN** the skill writes `preferred_location` via `update_preferences` so that a subsequent `kroger_prices` / `place_order` can resolve a location rather than erroring

#### Scenario: A later preferences write preserves the store ZIP

- **WHEN** the skill captures `default_cooking_nights` in a later area after the store ZIP was already written
- **THEN** the ZIP is preserved in D1 — `update_preferences` merges fields rather than replacing the whole row

#### Scenario: Brand defaults are not interrogated at onboarding

- **WHEN** the store area runs
- **THEN** the skill asks for a ZIP only and does not require the member to rank brands

### Requirement: A new member's corpus is available without activation

After taste/diet/equipment capture, the onboarding skill SHALL treat the whole shared corpus as immediately available to the new member (subject only to their makeability gate and any rejections they make later). It SHALL NOT require or perform a per-recipe activation step.

#### Scenario: First menu request works with no activation

- **WHEN** a freshly-onboarded member (who activated nothing) makes a menu request
- **THEN** the planner considers the whole non-rejected shared corpus, ranked by their taste/diet profile and retrieval, with no empty-active-set dead end

### Requirement: Hosted recipe site is the browse-everything surface

Rather than dumping the shared corpus into chat, the setup skill SHALL point the member at the **member web app** (where they sign in with their invite-code-backed session) to browse the full cookbook and manage everything setup no longer interrogates — pantry, staples, taste, and profile detail. The skill SHALL NOT present a build-time-baked URL and SHALL NOT describe the collection in machinery terms; recipes are framed as coming from sources the household trusts. When the member app is unavailable or the member cannot use it, the skill SHALL surface the corpus another way (e.g. `search_recipes`) rather than presenting a broken link.

#### Scenario: Setup points at the member app for browsing

- **WHEN** the member wants to see everything available during or after setup
- **THEN** the skill points them at the member web app's cookbook rather than listing the corpus in chat

#### Scenario: Unavailable app is surfaced gracefully

- **WHEN** the member web app cannot be reached or used
- **THEN** the skill surfaces the corpus another way (e.g. `search_recipes`) rather than presenting a broken link

