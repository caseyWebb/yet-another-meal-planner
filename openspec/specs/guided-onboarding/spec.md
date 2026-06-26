# guided-onboarding Specification

## Purpose
TBD - created by archiving change package-agent-as-plugin. Update Purpose after archive.
## Requirements
### Requirement: Guided first-run setup skill

The system SHALL provide a `configure-grocery-profile` skill that handles a member's grocery profile — **store location (ZIP)**, taste, cooking preferences, diet principles, **kitchen equipment**, a **starter recipe corpus**, starting pantry, an optional **bulk-buy watchlist**, an optional **staples list**, and **ready-to-eat (heat-and-eat) acceptance** — **idempotently**: on an empty profile it walks first-time setup conversationally (rather than requiring a wall of typed input); on an existing profile it reads back what it already knows (via `read_user_profile()`) and edits only what the member names. It SHALL persist each piece via write tools — `update_preferences`, `update_taste`, `update_diet_principles`, `update_kitchen`, `update_pantry`, `add_draft_ready_to_eat`, `update_stockup` (bulk-buy watchlist), `update_feeds` (discovery feeds), and `update_staples` (staples list). The skill itself SHALL NOT define an MCP tool — it composes existing and newly-added tools owned by other capabilities. Like every workflow skill, it SHALL load `grocery-core` via its prerequisite line.

The ready-to-eat setup area SHALL ask which kinds of heat-and-eat items the member accepts and for which meals, and SHALL persist named acceptances to the member's ready-to-eat catalog in D1 as `active` items (via `add_draft_ready_to_eat` with `status: active`). A member with no opinion on ready-to-eat SHALL be able to skip the area, leaving the catalog empty.

The kitchen-equipment setup area SHALL walk the `EQUIPMENT_VOCAB` as a short, finite checklist (e.g. "do you have any of these: pressure cooker, sous vide, blender, …?") and SHALL persist the member's owned equipment to the D1 `kitchen_equipment` table via `update_kitchen`. It SHALL seed only the gating `owned` list, not the free-text `notes` region (oven count and pan sizes surface naturally during the `cook` flow). A member SHALL be able to skip the area, leaving `owned` empty — which makes the makeability gate a no-op, degrading gracefully to unfiltered behavior. The equipment area SHALL run before the starter-corpus area so the makeability gate is seeded for corpus curation.

The staples setup area SHALL ask the member which items they never want to run out of, noting that the list is curated — only things they want the agent to remind them about. For each named item, it SHALL ask if it is perishable (short shelf life once opened / stored). It SHALL persist the list to the D1 `staples` table via `update_staples`. The area is skippable; an absent staples list degrades to no-prompting behavior.

#### Scenario: New member is guided through setup

- **WHEN** a member with no existing profile begins onboarding
- **THEN** the skill prompts for store ZIP, taste, diet principles, equipment, a starter corpus, pantry, an optional watchlist, an optional staples list, and ready-to-eat acceptance conversationally and writes each through the corresponding write tool

#### Scenario: Ready-to-eat acceptances seed the per-tenant catalog

- **WHEN** the member names heat-and-eat items they accept during onboarding
- **THEN** the skill writes them as `active` items to that member's D1 ready-to-eat catalog via `add_draft_ready_to_eat`, tagged by meal, affecting no other member

#### Scenario: Equipment checklist seeds the kitchen inventory

- **WHEN** the member confirms they own a pressure cooker and a blender during the equipment checklist
- **THEN** the skill writes `owned = ["pressure-cooker", "blender"]` to that member's D1 kitchen inventory via `update_kitchen`

#### Scenario: Skipped equipment leaves the gate inert

- **WHEN** the member skips the kitchen-equipment area
- **THEN** `owned` is left empty in D1 and the makeability gate suppresses no recipes for that member

#### Scenario: Staples seeded at onboarding

- **WHEN** the member names "olive oil, salt, eggs (perishable)" during the staples setup area
- **THEN** the skill writes `[{ name: "olive oil" }, { name: "salt" }, { name: "eggs", perishable: true }]` to the member's D1 staples table via `update_staples`

#### Scenario: Skipped staples area leaves staples empty

- **WHEN** the member skips the staples setup area
- **THEN** no staples rows are written to D1 and all staples-driven prompting behaviors remain suppressed

#### Scenario: Onboarding composes tools rather than defining its own

- **WHEN** the onboarding skill persists captured setup
- **THEN** it does so through write tools owned by other capabilities (the existing `update_*` / `add_draft_ready_to_eat` / `commit_changes` plus `update_stockup`, `update_feeds`, and `update_staples`) and defines no MCP tool of its own

### Requirement: Onboarding triggers on an empty profile or explicit request

The onboarding skill SHALL be loadable both by explicit invocation and by a **deterministic initialization gate** in the `grocery-core` persona tier (which every workflow loads once per session). Before the first substantive action in a session, the agent SHALL call `profile_status`; when it reports `initialized: false`, the agent SHALL run `configure-grocery-profile` before fulfilling the original request, then resume that request. The gate SHALL pass `missing` through to onboarding so already-completed areas can be skipped. The onboarding flow SHALL NOT force the member to provide everything at once.

The gate SHALL be **fail-open**: if `profile_status` returns an error (an indeterminate result), the agent SHALL proceed with the request normally — a transient failure SHALL NOT be treated as "not initialized." The gate SHALL be **skipped** when the active flow is itself `configure-grocery-profile` (no self-loop) or `report-grocery-agent-bug` (a new member must be able to report a bug without first completing setup).

#### Scenario: Uninitialized member is routed through onboarding first

- **WHEN** a member whose `profile_status` reports `initialized: false` makes a substantive request (e.g. "make me a menu")
- **THEN** the agent runs `configure-grocery-profile` before fulfilling it, then resumes the original request

#### Scenario: Initialized member proceeds directly

- **WHEN** `profile_status` reports `initialized: true`
- **THEN** the gate passes and the agent fulfills the request without re-running onboarding

#### Scenario: Gate fails open on an indeterminate status

- **WHEN** `profile_status` returns an error rather than a clear initialized state
- **THEN** the agent proceeds with the request normally rather than forcing onboarding

#### Scenario: Bug reporting is not gated

- **WHEN** a brand-new (uninitialized) member invokes `report-grocery-agent-bug`
- **THEN** the gate is skipped and the bug report proceeds without forcing setup first

#### Scenario: Onboarding does not gate itself

- **WHEN** the active flow is `configure-grocery-profile`
- **THEN** the initialization gate is skipped so onboarding does not re-trigger itself

### Requirement: Incremental, resumable capture

The onboarding skill SHALL capture setup in small batches and persist each batch as it is gathered, so that an interrupted or abandoned setup leaves the already-provided information saved rather than lost. Each setup area SHALL be independently resumable: the skill SHALL check the area's own backing data (via `read_user_profile()`) and SHALL skip (or merely read back) an area that is already populated rather than re-interrogating it — e.g. it SHALL NOT re-walk taste when the `taste` field is already set in D1, and SHALL NOT re-promote a starter corpus when the caller's overlay already holds rows. This per-area idempotency is the single code path behind both first-run setup and returning-member review.

For a brand-new member, `read_user_profile()` returns `{ initialized: false, missing: [...all areas...] }`. The `missing` array signals which areas are empty and not yet set up. The skill SHALL use `missing` to determine which areas to walk and SHALL NOT treat an empty area as a tool failure nor trip the `report-grocery-agent-bug` reflex.

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

Rather than dumping the entire shared corpus into chat, the onboarding skill SHALL point the member at the hosted recipe site to browse the full collection and pick anything to activate. It SHALL obtain the site URL at runtime by calling `recipe_site_url` (never a build-time-baked URL). When that tool reports `enabled: false`, the skill SHALL tell the member their operator needs to enable GitHub Pages on the data repo (a setup step, not a failure); when it reports `insufficient_permission`, the skill SHALL flag that the GitHub App needs `Pages: read`.

#### Scenario: Skill points at the resolved site for the full corpus

- **WHEN** the member wants to see everything available, not just the curated set
- **THEN** the skill calls `recipe_site_url`, and on `enabled: true` gives the member the returned link to browse

#### Scenario: Not-enabled is surfaced as a setup step

- **WHEN** `recipe_site_url` returns `enabled: false` (or `insufficient_permission`)
- **THEN** the skill tells the member their operator needs to enable GitHub Pages (or grant the App `Pages: read`), rather than presenting a broken link

### Requirement: Thorough first-run inventory

On first-run setup the inventory area SHALL encourage a thorough, open-ended, room-by-room walk of the kitchen — fridge, freezer, pantry staples, and explicitly the **spice drawer/rack** (the `spices` pantry category) — and SHALL suggest using voice/dictation to make the walk easier. The "keep it light, the pantry self-corrects" guidance SHALL apply to the returning-member branch, not to first-run. Captured items SHALL persist via `update_pantry`.

#### Scenario: First-run inventory walks the spice drawer

- **WHEN** a new member does their starting inventory
- **THEN** the skill prompts a room-by-room walk that explicitly includes the spice drawer and suggests voice/dictation, writing items via `update_pantry`

#### Scenario: Returning inventory stays light

- **WHEN** a returning member with a populated pantry revisits inventory
- **THEN** the skill keeps it light and relies on normal-use self-correction rather than re-walking the whole kitchen

### Requirement: Bulk-buy watchlist seeding

The onboarding skill SHALL offer an optional area to seed the member's bulk-buy watchlist, capturing the items they buy in bulk plus a `typical_purchase` and a `freezer_capacity_estimate`, persisted to the D1 `stockup` table via `update_stockup`. It SHALL NOT prompt for the `buy_at_or_below` / `baseline_price` thresholds — those are advisory-only (no Worker logic gates on them; "is this a good price" is the agent reasoning over the live flyer), so a member who does not know exact numbers is never blocked. The area SHALL be skippable, leaving the watchlist empty.

#### Scenario: Watchlist seeded without numeric thresholds

- **WHEN** a member names items they like to buy in bulk during onboarding
- **THEN** the skill writes those items (with `typical_purchase` and `freezer_capacity_estimate`) to the D1 stockup table via `update_stockup`, without requiring `buy_at_or_below` or `baseline_price`

#### Scenario: Skipped watchlist stays empty

- **WHEN** the member skips the bulk-buy area
- **THEN** no stockup rows are written to D1 and sale-checking simply has no watchlist to filter against

### Requirement: Sparse-corpus onboarding seeds discovery sources

When the shared corpus is empty or too sparse to bootstrap a starter set (e.g. the first member of a new group), the onboarding skill SHALL ask the member for import sources and specific recipes to add, and wire them up: newsletter senders / forwarders via `update_discovery_sources`, RSS feeds via `update_feeds`, and named recipe URLs via `import_recipe` (then `create_recipe`). It SHALL frame discovery-source setup as a group-wide action (these write shared config).

#### Scenario: First member seeds feeds and senders

- **WHEN** onboarding finds the shared corpus too sparse to curate a starter set and the member names a newsletter and an RSS feed
- **THEN** the skill adds the sender via `update_discovery_sources` and the feed via `update_feeds`, and imports any specific recipe URLs the member names

### Requirement: Inventory and heat-and-eat acceptance cross-record ready-to-eat items

Ready-to-eat items are tracked in two places by design — the per-tenant D1 ready-to-eat catalog holds them as **options** (meal-tagged, no stock field) and the D1 pantry table holds their **on-hand stock** (freezer/fridge). The onboarding skill SHALL keep these in sync at capture time so that neither view goes stale:

- During the inventory walk, when the member names heat-and-eat items physically on hand (frozen dinners, breakfast burritos, etc.), the skill SHALL record their on-hand stock via `update_pantry` AND SHALL **offer** to add them to the ready-to-eat catalog via `add_draft_ready_to_eat` (`status: active`) so they become suggestible options — offering rather than silently adding (consistent with the persona's don't-auto-add stance).
- During the heat-and-eat acceptance area, when the member indicates they currently have some of an accepted item on hand, the skill SHALL also record that on-hand stock via `update_pantry`, so the menu-gen restock cross-reference (favorites vs pantry on-hand) does not immediately read a just-named item as out.

The skill SHALL use a consistent item `name` across both writes so the name-based favorites↔pantry restock cross-reference matches. No new MCP tool is required — this is wiring the existing `update_pantry` and `add_draft_ready_to_eat` together.

#### Scenario: Inventory surfaces a heat-and-eat item

- **WHEN** during the inventory walk the member names frozen dinners they have in the freezer
- **THEN** the skill records them as pantry stock via `update_pantry` and offers to also add them to the ready-to-eat catalog via `add_draft_ready_to_eat` so they can be suggested later

#### Scenario: Accepted heat-and-eat item with on-hand stock is recorded in pantry

- **WHEN** in the heat-and-eat acceptance area the member says they currently keep some of an item on hand
- **THEN** the skill catalogs the item (`add_draft_ready_to_eat`, `status: active`) and also records its on-hand stock via `update_pantry` under the same name, so restock logic does not read it as out
