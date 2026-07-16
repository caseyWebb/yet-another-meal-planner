# data-read-tools Specification

## Purpose

Defines the read tools exposed by the MCP server (`search_recipes`, `read_recipe`, `read_pantry`, `read_user_profile`): their return shapes, `search_recipes` membership-mode and filter semantics, `read_pantry` partial-filter scope, per-tool error cases, and empty-data resilience. All profile data (preferences, taste, diet principles, kitchen equipment, staples, stockup, ready-to-eat) is assembled by `read_user_profile()` from D1 in one batched call.
## Requirements
### Requirement: read_recipe returns frontmatter and body

The system SHALL provide `read_recipe(slug)` returning `{ slug, frontmatter, body }`, where `frontmatter` is the shared objective frontmatter **merged with the caller's overlay fields** (`favorite`) **and the caller's cooking-log-derived `last_cooked`** and `body` is the markdown after the frontmatter fence. The slug SHALL resolve only within the caller's visibility lens, checked through the shared lens enforcement point before any body read: a slug outside the caller's lens SHALL return the same structured `not_found` error an unknown slug returns — indistinguishably, so the tool cannot be used as a slug-probing oracle. The return SHALL NOT include a `last_modified` field and SHALL NOT include a `status` field (the disposition model is favorites/rejections, not status).

#### Scenario: Existing recipe read with caller's subjective fields

- **WHEN** `read_recipe("american-chop-suey")` is invoked by a member whose household's lens contains it, who favorited it and cooked it last week
- **THEN** it returns the slug, the shared frontmatter merged with that caller's `favorite: true` and `last_cooked`, and the markdown body, with no `last_modified` field

#### Scenario: Unknown slug

- **WHEN** `read_recipe("does-not-exist")` is invoked
- **THEN** it returns a structured `not_found` error naming the slug

#### Scenario: Out-of-lens slug is indistinguishable from unknown

- **WHEN** `read_recipe(slug)` is invoked under SaaS for a recipe that exists but is outside the caller's lens
- **THEN** the structured `not_found` error is identical in shape and content to the unknown-slug error, and no body read occurs

### Requirement: read_pantry with partial filter support

The system SHALL provide `read_pantry(filter)` returning `{ items: [...] }`, supporting the
`category`, `location`, and `prepared_only` filters deterministically. `category` filters on
the controlled food taxonomy (`produce | dairy | meat | seafood | grains | bakery | canned |
condiments | oils | spices | baking | frozen | snacks | beverages`); `location` filters on the
kitchen location vocabulary (`fridge | freezer | pantry | spice_rack | counter | cabinet`);
returned items include both fields (either may be absent — NULL reads as
unassigned/uncategorized, never an error). For one deprecation window, a legacy
location-flavored `category` value (`pantry | fridge | freezer | spices`) SHALL be mapped onto
the corresponding `location` filter rather than returning nothing, so agents on a cached
plugin keep working across the vocabulary split. The `stale_only` filter SHALL return a
structured `unsupported` error, because freshness is an LLM-judged, prompt-resolved concern
(it depends on storage, whether a package was opened, and visual inspection — none of which is
in the repo) rather than a function the tool can compute. There is no shelf-life table backing
it: the curated `guidance/ingredient_storage/` tree informs put-away advice rather than gating
staleness.

#### Scenario: Filter by location

- **WHEN** `read_pantry({ location: "freezer" })` is invoked
- **THEN** only pantry items whose `location` is `freezer` are returned

#### Scenario: Filter by food category

- **WHEN** `read_pantry({ category: "produce" })` is invoked
- **THEN** only pantry items whose `category` is `produce` are returned

#### Scenario: A legacy category value maps onto the location filter

- **WHEN** `read_pantry({ category: "freezer" })` is invoked during the deprecation window
- **THEN** it behaves as `read_pantry({ location: "freezer" })` — items kept in the freezer are
  returned even though `freezer` is no longer a category value

#### Scenario: Prepared-only filter

- **WHEN** `read_pantry({ prepared_only: true })` is invoked
- **THEN** only items with a non-null `prepared_from` are returned

#### Scenario: Staleness not supported by the tool

- **WHEN** `read_pantry({ stale_only: true })` is invoked
- **THEN** the tool returns a structured `unsupported` error explaining that freshness is
  judged conversationally, not computed by the tool

### Requirement: Unified profile read assembles from D1

`read_user_profile()` SHALL return the caller's full profile assembled from the D1 profile tables — `initialized`, `missing`, and all profile fields — in one batched set of queries. The structured fields (`preferences`, `kitchen`, `overlay`, `stockup`) are reconstructed from typed rows/columns (preferences from the `profile` row + `brand_prefs`); each `preferences.brands` entry SHALL be assembled as the canonical brand-tier object `{ tiers: string[][], any_brand: boolean }` with **both fields always present** — never a bare array; `staples` is returned as a bare `StaplesItem[]` array (not `{ items: [...] }`) from the D1 `staples` table; the markdown fields (`taste`, `diet_principles`) are returned as strings from the `profile` row. The payload SHALL NOT include a `ready_to_eat` field — the ready-to-eat concept is removed from the agent surface, and the retained D1 `ready_to_eat` table is not read on this path. The payload SHALL additionally include the **night-vibe palette** — the caller's saved vibes plus each vibe's derived **cadence status** (`due | overdue | soon | ok`, computed from the vibe's `cadence_days` and its `last_satisfied` query, the `night-vibe-palette` capability) — so the agent reads the member's revealed-preference rhythm at session start as the basis for shaping a plan. The Worker SHALL NOT parse TOML on the profile read path, and SHALL NOT read a KV bundle. The `kitchen` field returns `{ owned: [...], notes: {...} }` from the D1 `kitchen_equipment` table and profile notes.

#### Scenario: Profile read assembles structured JSON from D1

- **WHEN** `read_user_profile()` is called for a set-up member
- **THEN** it returns `initialized`, `missing`, the structured fields from typed D1 rows, the markdown fields as strings, and the night-vibe palette with each vibe's cadence status — in one batched set of queries, parsing no TOML and reading no KV bundle

#### Scenario: The payload carries no ready_to_eat field

- **WHEN** `read_user_profile()` is called for a member who has historical rows in the D1 `ready_to_eat` table
- **THEN** the payload contains no `ready_to_eat` key at all — the table is not queried on this path and no empty-array placeholder is emitted

#### Scenario: Brand preferences read as canonical tier objects

- **WHEN** `read_user_profile()` (or the member API's preferences read) runs for a member with `brand_prefs` rows
- **THEN** each `preferences.brands` entry is `{ tiers, any_brand }` with both fields present — a don't-care family reads `{ tiers: [], any_brand: true }`, and no entry is ever a bare array

#### Scenario: Matcher and weather read preferences from D1

- **WHEN** the matcher or weather path needs preferences
- **THEN** it reads them from the D1 profile tables, not a KV bundle

#### Scenario: The palette rides the profile read

- **WHEN** a member with saved night vibes calls `read_user_profile()`
- **THEN** the payload includes those vibes and each vibe's cadence status, without a separate `list_night_vibes` call

### Requirement: Empty-data resilience

Read tools SHALL return clean empty results for sources that currently hold no data (empty D1 tables, empty catalogs, or absent optional sections) rather than erroring. A D1 pantry table with no rows SHALL yield `{ items: [] }`.

#### Scenario: Empty pantry yields empty items

- **WHEN** `read_pantry({})` is invoked against a pantry that contains no rows
- **THEN** it returns `{ items: [] }` without error

### Requirement: Group signal is readable on shared recipes

The system SHALL expose the group signal for a visible recipe — how many other households **within the caller's lens** have favorited it (a count) and the notes the caller may see under the note-tier rules (attributed, with author handles and tiers) — to inform surfacing of recipes the caller has not tried. The favorites half SHALL aggregate at read time over the caller's lens households only (own household plus friend households; every household under self-hosted — today's behavior), as a single indexed aggregate (`COUNT` of favorites), not an average over a 1–5 scale. The notes half SHALL follow the `recipe-notes` tier rules exactly: `friends` notes from the caller's own and friend households, `public` notes from **any** household (a public note on a lens-visible recipe is visible even when its author's household is outside the caller's lens — e.g. a public note on a curated recipe), the caller's own notes at every tier, and never another member's `private` note. Signal SHALL be reachable only for recipes inside the caller's lens.

#### Scenario: Aggregated group favorite count available within the lens

- **WHEN** several households in the caller's lens have favorited a visible recipe and the caller requests group signal for it
- **THEN** the caller receives the count of those other households' favorites and the tier-admitted attributed notes

#### Scenario: Non-lens households never contribute favorites

- **WHEN** a household outside a SaaS caller's lens has favorited a recipe the caller can see (e.g. a curated recipe)
- **THEN** that household's favorite is absent from the caller's group-signal count

#### Scenario: A public note crosses lens households

- **WHEN** a household outside a SaaS caller's lens holds a `public` note on a curated recipe the caller can see
- **THEN** that note appears in the caller's group signal (handle-attributed, `tier: "public"`), while the same household's `friends` notes on that recipe do not

#### Scenario: Others' private notes excluded

- **WHEN** another member has a `private` note on a recipe
- **THEN** that note is not included in the group signal returned to the caller

### Requirement: profile_status reports initialization from D1

`profile_status()` SHALL return `{ initialized: boolean, missing: string[] }` — this is also the shape included in `read_user_profile()` results:

- `initialized` SHALL be `true` if and only if the caller's `preferences` record is present in D1 (the unconditional first onboarding area), and `false` otherwise.
- `missing` SHALL list the onboarding-area keys whose D1 data is absent, using the fixed mapping: `store` (preferences row), `taste`, `diet`, `equipment` (kitchen_equipment rows), `pantry` (pantry rows), `stockup`, `corpus` (overlay rows), and `vibes` (night_vibes rows — an empty palette is an onboarding gap that `suggest_night_vibes` fills). There SHALL be no `ready-to-eat` key in the mapping — ready-to-eat is not an onboarding area.

#### Scenario: Brand-new member with no D1 profile

- **WHEN** `profile_status()` is called for a member with no `preferences` record
- **THEN** `initialized` is `false` and `missing` lists every onboarding area, including `vibes` and never `ready-to-eat`

#### Scenario: Set-up member with an empty palette lists the vibes gap

- **WHEN** a member has preferences, taste, and equipment set but no night vibes
- **THEN** `initialized` is `true` and `missing` includes `vibes` (and any other empty areas)

#### Scenario: Fully set-up member reports no gaps

- **WHEN** a member has every onboarding area populated, including a non-empty palette
- **THEN** `initialized` is `true` and `missing` is empty

### Requirement: search_recipes reads the index and filters in-worker

The system SHALL provide `search_recipes({ specs })` that takes a non-empty array of search specs and returns `{ results: [{ label, recipes }] }` — one result group per input spec, in input order, each group's `label` echoed back verbatim. For every spec the tool SHALL read the shared D1 `recipes` index **through the caller's visibility lens** (the shared enforcement point — the membership universe is the lens-visible corpus), **join each entry with the caller's per-tenant overlay** (`favorite` / `reject`), **the caller's cooking-log-derived `last_cooked`**, **and the caller's owned-equipment list**, and apply the spec's `facets` in the Worker, producing recipes shaped `{ slug, title, frontmatter }` where `frontmatter` reflects the merged objective content plus the caller's subjective marks. By default — with no overlay row — a visible recipe is **neutral (available)**; the default result for an unfiltered spec is the caller's lens-visible corpus **minus the caller's rejects** (under self-hosted this equals the whole attached corpus minus rejects — today's behavior). A recipe outside the caller's lens SHALL never appear in any group in either mode. There is no `status` field and no effective-`draft` default.

A spec carries `{ label, facets?, vibe?, k?, boost_ingredients? }`. The `vibe` is **optional** and selects the mode:
- **vibe ABSENT (membership)** — the group SHALL be **every** lens-visible recipe that survives the facet gate, in index order with no ranking, **including recipes that have no embedding yet** (e.g. just-imported, not yet reconciled), and SHALL NOT be capped by `k`. `boost_ingredients` SHALL be ignored. This is the path a named-dish or browse lookup uses, so a freshly-imported recipe is never silently dropped.
- **vibe PRESENT (ranked)** — the surviving rows are ranked (see the semantic-recipe-search capability), which drops unembedded survivors and returns the top-`k`.

If the index is missing or malformed, the tool SHALL return a structured `index_unavailable` error.

#### Scenario: The lens-visible corpus minus rejects is returned by default

- **WHEN** `search_recipes({ specs: [{ label: "all" }] })` is invoked
- **THEN** `results[0].recipes` contains every recipe in the caller's lens that the caller has not rejected, each merged with the caller's `favorite`/`last_cooked` — and under self-hosted this is the whole attached corpus minus rejects, exactly as before

#### Scenario: Rejected recipes are excluded

- **WHEN** the caller has rejected a visible recipe and invokes a vibe-less spec
- **THEN** that recipe is absent from the result; another member who has not rejected it still sees it

#### Scenario: An out-of-lens recipe is absent from every group

- **WHEN** a SaaS caller's specs would match a recipe held only by a non-friend household
- **THEN** that recipe appears in no group, in membership or ranked mode, and its absence is indistinguishable from nonexistence

#### Scenario: Membership mode returns unembedded recipes and ignores k

- **WHEN** a vibe-less spec is invoked, a matching visible recipe has no embedding yet, and `k` is set to 5 while 30 visible recipes match
- **THEN** all 30 surviving recipes are returned (including the unembedded one), unranked and uncapped by `k`

#### Scenario: Grouped return, one group per spec

- **WHEN** `search_recipes({ specs: [{ label: "a" }, { label: "b", facets: { course: "side" } }] })` is invoked
- **THEN** `results` has two entries, `results[0].label === "a"` and `results[1].label === "b"`, each carrying its own `recipes` array

#### Scenario: Index missing or malformed

- **WHEN** the D1 `recipes` index cannot be read
- **THEN** the tool returns a structured `index_unavailable` error rather than an empty list or a throw

### Requirement: search_recipes filter semantics

The system SHALL apply each spec's `facets` with these semantics: array facets (`dietary`, `season`) match when the recipe contains **ALL** listed values (AND); the `course` facet is a **scalar** that matches by **containment** — a recipe passes when its (array-normalized) `course` includes the requested value, so `{ course: "side" }` returns mains-that-are-also-sides as well as pure sides; `exclude_cooked_within_days` is a caller-supplied number that excludes recipes cooked within that many days; and `not_cooked_since` (a date) admits recipes whose `last_cooked` is `null`. The system SHALL NOT provide a `tags` array facet — keyword/name matching against tags is handled by the `query` text filter (see "search_recipes free-text query filter"). The `course` value is a free string matched literally against the normalized index values; there is no controlled set.

The system SHALL additionally apply a **makeability gate** by default: a recipe whose `requires_equipment` is not a subset of the caller's `owned` (see the kitchen-equipment "Deterministic makeability rule") SHALL be excluded. When the caller's `owned` is empty (or the D1 kitchen inventory is absent) the gate SHALL be a no-op (every recipe passes). An `include_unmakeable: true` facet SHALL disable the exclusion and instead return unmakeable recipes annotated with `missing_equipment` (the required slugs not in `owned`), so the named-dish enumeration path can surface a named recipe flagged rather than silently dropped. The gate SHALL be ANDed with the other facets and SHALL be a pure function of the recipe's indexed `requires_equipment` and the caller's `owned`. The facet gate is identical across the membership (vibe-absent) and ranked (vibe-present) modes; in ranked mode the rank only reorders within the gated survivors and can never admit a recipe a facet rejected.

The return shape SHALL be the grouped `{ results: [{ label, recipes }] }` envelope; `course` rides each entry's `frontmatter` and the tool SHALL NOT course-bucket within a group. Callers that want mains and sides together issue one vibe-less spec and bucket by `course` themselves.

#### Scenario: Array filter matches all values

- **WHEN** a spec carries `facets: { dietary: ["gluten-free", "dairy-free"] }`
- **THEN** only recipes whose `dietary` includes both `gluten-free` AND `dairy-free` are returned in that group

#### Scenario: Course filter matches by containment

- **WHEN** a spec carries `facets: { course: "side" }`
- **THEN** every recipe whose normalized `course` array includes `side` is returned — including a dual-use recipe whose `course` is `[main, side]` — and recipes without `side` in their `course` are excluded

#### Scenario: Course filter value is open, not validated

- **WHEN** a spec carries `facets: { course: "sauce" }` and some recipes carry `course: [sauce]`
- **THEN** those recipes are returned; the filter does not reject `sauce` as off-vocabulary

#### Scenario: Never-cooked recipe passes not_cooked_since

- **WHEN** a spec carries `facets: { not_cooked_since: "2026-01-01" }` and a recipe has `last_cooked: null`
- **THEN** that recipe is included in the results

#### Scenario: Recently cooked recipe excluded by window

- **WHEN** a spec carries `facets: { exclude_cooked_within_days: 14 }` and a recipe was cooked 3 days ago
- **THEN** that recipe is excluded from the results

#### Scenario: A tags filter is not honored

- **WHEN** a spec carries `facets: { tags: ["chicken"] }` (an unknown facet)
- **THEN** the `tags` key is ignored (no tag-based narrowing) and the result is the same as if no `tags` were supplied

#### Scenario: Unmakeable recipe is excluded by default

- **WHEN** a spec has empty facets, a recipe requires `["pressure-cooker"]`, and the caller's `owned` is `["blender"]`
- **THEN** that recipe is excluded from the results

#### Scenario: Empty inventory disables the gate

- **WHEN** a spec has empty facets and the caller has no kitchen inventory in D1 (or empty `owned`)
- **THEN** the makeability gate excludes nothing and recipes are returned as if no equipment filter applied

#### Scenario: include_unmakeable surfaces flagged recipes

- **WHEN** a spec carries `facets: { include_unmakeable: true }`, a recipe requires `["pressure-cooker"]`, and the caller's `owned` is `["blender"]`
- **THEN** that recipe is returned annotated with `missing_equipment: ["pressure-cooker"]` rather than excluded

### Requirement: search_recipes free-text query filter

The system SHALL support an optional `query` string facet that is the single text-search path over a recipe's `title` and `tags`. The query SHALL be tokenized on whitespace and a fixed set of stopwords (`and`, `or`, `with`, `the`, `a`, `an`, `of`, `in`, `on`, `for`, `&`) SHALL be removed before matching. A recipe matches when **every** remaining token appears, as a case-insensitive substring, in the recipe's `title` or any of its `tags` (token-AND). The `query` filter SHALL be ANDed with the other facets and SHALL be a pure function of the index entry (no I/O). When `query` is absent, empty, or reduces to zero tokens after stopword removal, it SHALL apply no text narrowing. The filter SHALL NOT rank, score, or fuzzy-match — it is a deterministic membership test so that a named dish present in the corpus (in title or tags) cannot be silently omitted. Named-dish enumeration SHALL therefore use a **vibe-less** `query` spec (so the result is the complete membership set, unranked, including any just-imported match), typically with `include_unmakeable: true` so a named recipe is flagged rather than dropped.

#### Scenario: Natural phrase returns all genuine matches via title or tags

- **WHEN** a spec carries `facets: { query: "chicken and rice" }` and the corpus contains "Chicken and Rice" (tag "rice" absent — "rice" only in the title), plus "Arroz Caldo" and "Galinhada Mineira" (both tagged `chicken` and `rice`)
- **THEN** all three are returned: the connective `and` is dropped as a stopword (so `{chicken, rice}` remain), "Chicken and Rice" matches via its title, and the other two match via tags

#### Scenario: Stopword-only query applies no narrowing

- **WHEN** a spec carries `facets: { query: "and the" }`
- **THEN** the query reduces to zero tokens and no text narrowing is applied (same as an absent `query`)

#### Scenario: All content tokens must be present (AND)

- **WHEN** a spec carries `facets: { query: "chicken rice" }`
- **THEN** a recipe with neither `chicken` nor `rice` in its title or tags is excluded, and a recipe whose title or tags contain both is included

#### Scenario: Title-only keyword is findable

- **WHEN** a spec carries `facets: { query: "rice" }` and a recipe titled "Chicken and Rice" has no `rice` tag
- **THEN** that recipe is included because `query` searches the title, not only tags

#### Scenario: Query composes with structured filters

- **WHEN** a spec carries `facets: { query: "chicken", protein: "chicken" }`
- **THEN** only chicken-protein recipes whose title or tags contain `chicken` are returned

### Requirement: search_recipes surfaces the favorite boolean

`search_recipes` SHALL surface the caller's `favorite` boolean on each returned entry, merged from the caller's overlay. It SHALL NOT surface a `status` or `rating` field. (Rejected recipes are excluded from the result entirely rather than surfaced with a flag.)

#### Scenario: Favorite rides each entry; status and rating are gone

- **WHEN** `search_recipes` returns recipes the caller has and has not favorited
- **THEN** each entry's merged view carries `favorite: true`/`false` and carries no `status` and no `rating`

### Requirement: search_recipes surfaces the recipe description

`search_recipes` SHALL surface each recipe's `description` on the returned entry (projected as a `recipes` column), so the compact craving-aligned brief is available to the caller without a separate `read_recipe` call.

#### Scenario: Description rides the index entry

- **WHEN** `search_recipes` returns a recipe that has a `description`
- **THEN** the entry's frontmatter carries that `description`

### Requirement: read_user_profile carries a server-computed attention block

`read_user_profile()` SHALL include an `attention` object computed deterministically in the Worker from existing per-tenant data: `retrospective_due` (boolean — true when the caller's cooking log is non-empty AND `profile.last_retrospective_at` is NULL or older than the due threshold, 42 days), `unverified_perishables` (number — pantry rows in the perishable categories `produce | dairy | seafood | meat` whose `last_verified_at` is NULL or older than the 7-day staleness threshold, the member app's needs-verification rule), and `stale_areas` (string[] — the existing onboarding-area `missing` derivation). The computation SHALL make no AI call and no write; it rides the profile assembly's existing batched reads plus bounded aggregate queries. The `retrospective` tool and the member retrospective endpoints SHALL stamp `profile.last_retrospective_at` (today's date) on each read — the `last_planned_at` watermark precedent — without any other mutation. The member API's profile read (the same assembly) SHALL carry the same block.

#### Scenario: A neglected retrospective surfaces as due

- **WHEN** a member with cooking history has never read a retrospective (watermark NULL) and calls `read_user_profile`
- **THEN** `attention.retrospective_due` is `true`

#### Scenario: Reading the retrospective resets the nudge

- **WHEN** the member's `retrospective` tool runs and `read_user_profile` is called the next day
- **THEN** `last_retrospective_at` was stamped and `attention.retrospective_due` is `false`

#### Scenario: Long-unverified perishables are counted, not listed

- **WHEN** three produce/dairy pantry rows have `last_verified_at` older than 7 days
- **THEN** `attention.unverified_perishables` is `3`, computed with no AI call and no write

#### Scenario: An empty profile degrades cleanly

- **WHEN** a brand-new tenant with no pantry, no cooking log, and no watermark calls `read_user_profile`
- **THEN** `attention` is `{ retrospective_due: false, unverified_perishables: 0, stale_areas: [...] }` with `stale_areas` equal to the onboarding `missing` areas, and nothing errors

