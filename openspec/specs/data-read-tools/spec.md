# data-read-tools Specification

## Purpose

Defines the read tools exposed by the MCP server (`search_recipes`, `read_recipe`, `read_pantry`, `read_user_profile`): their return shapes, `search_recipes` membership-mode and filter semantics, `read_pantry` partial-filter scope, per-tool error cases, and empty-data resilience. All profile data (preferences, taste, diet principles, kitchen equipment, staples, stockup, ready-to-eat) is assembled by `read_user_profile()` from D1 in one batched call.
## Requirements
### Requirement: read_recipe returns frontmatter and body

The system SHALL provide `read_recipe(slug)` returning `{ slug, frontmatter, body }`, where `frontmatter` is the shared objective frontmatter **merged with the caller's overlay fields** (`favorite`) **and the caller's cooking-log-derived `last_cooked`** and `body` is the markdown after the frontmatter fence. The slug MAY resolve to a shared corpus recipe or one of the caller's personal recipes. The return SHALL NOT include a `last_modified` field and SHALL NOT include a `status` field (the disposition model is favorites/rejections, not status). A slug unknown to both the shared corpus and the caller's personal recipes SHALL return a structured `not_found` error.

#### Scenario: Existing recipe read with caller's subjective fields

- **WHEN** `read_recipe("american-chop-suey")` is invoked by a tenant who favorited it and cooked it last week
- **THEN** it returns the slug, the shared frontmatter merged with that tenant's `favorite: true` and `last_cooked`, and the markdown body, with no `last_modified` field

#### Scenario: Unknown slug

- **WHEN** `read_recipe("does-not-exist")` is invoked and the slug is in neither the shared corpus nor the caller's personal recipes
- **THEN** it returns a structured `not_found` error naming the slug

### Requirement: read_pantry with partial filter support

The system SHALL provide `read_pantry(filter)` returning `{ items: [...] }`, supporting the `category` and `prepared_only` filters deterministically. The `stale_only` filter SHALL return a structured `unsupported` error, because freshness is an LLM-judged, prompt-resolved concern (it depends on storage, whether a package was opened, and visual inspection — none of which is in the repo) rather than a function the tool can compute. There is no shelf-life table backing it: the previously-reserved `ingredients.toml` has been removed, superseded by the curated `guidance/ingredient_storage/` tree, which informs put-away advice rather than gating staleness.

#### Scenario: Filter by category

- **WHEN** `read_pantry({ category: "freezer" })` is invoked
- **THEN** only pantry items in the `freezer` category are returned

#### Scenario: Prepared-only filter

- **WHEN** `read_pantry({ prepared_only: true })` is invoked
- **THEN** only items with a non-null `prepared_from` are returned

#### Scenario: Staleness not supported by the tool

- **WHEN** `read_pantry({ stale_only: true })` is invoked
- **THEN** the tool returns a structured `unsupported` error explaining that freshness is judged conversationally, not computed by the tool

### Requirement: Unified profile read assembles from D1

`read_user_profile()` SHALL return the caller's full profile assembled from the D1 profile tables — `initialized`, `missing`, and all profile fields — in one batched set of queries. The structured fields (`preferences`, `kitchen`, `overlay`, `ready_to_eat`, `stockup`) are reconstructed from typed rows/columns (preferences from the `profile` row + `brand_prefs`); `staples` is returned as a bare `StaplesItem[]` array (not `{ items: [...] }`) from the D1 `staples` table; the markdown fields (`taste`, `diet_principles`) are returned as strings from the `profile` row. The Worker SHALL NOT parse TOML on the profile read path, and SHALL NOT read a KV bundle. The `kitchen` field returns `{ owned: [...], notes: {...} }` from the D1 `kitchen_equipment` table and profile notes.

#### Scenario: Profile read assembles structured JSON from D1

- **WHEN** `read_user_profile()` is called for an initialized tenant
- **THEN** the profile is assembled from the D1 tables and returned in the existing shape, with no TOML parse and no KV bundle read

#### Scenario: Matcher and weather read preferences from D1

- **WHEN** the matcher reads `brands` or the weather resolver reads `stores`/`location_zip`
- **THEN** the values come from the D1 `brand_prefs` and `profile` rows, not a parsed TOML string

### Requirement: Empty-data resilience

Read tools SHALL return clean empty results for sources that currently hold no data (empty D1 tables, empty catalogs, or absent optional sections) rather than erroring. A D1 pantry table with no rows SHALL yield `{ items: [] }`.

#### Scenario: Empty pantry yields empty items

- **WHEN** `read_pantry({})` is invoked against a pantry that contains no rows
- **THEN** it returns `{ items: [] }` without error

### Requirement: Group signal is readable on shared recipes

The system SHALL expose the cross-tenant group signal for a shared recipe — how many other tenants have **favorited** it (a count) and non-private notes (attributed) — to inform surfacing of recipes the caller has not tried. This read SHALL aggregate across tenants at read time and SHALL exclude private notes authored by others. The favorite count replaces the prior averaged star rating; it is a single indexed aggregate (`COUNT` of favorites), not an average over a 1–5 scale.

#### Scenario: Aggregated group favorite count available

- **WHEN** several tenants have favorited a recipe and the caller requests group signal for it
- **THEN** the caller receives the count of other-tenant favorites and the attributed non-private notes from the group

#### Scenario: Others' private notes excluded

- **WHEN** another tenant has a private note on a recipe
- **THEN** that private note is not included in the group signal returned to the caller

### Requirement: profile_status reports initialization from D1

The system SHALL provide a per-tenant `profile_status` read tool that reports whether the caller has completed grocery-profile setup, derived from the D1 `profile` row and related tables. It SHALL take no parameters, never write, and address only the caller's own profile.

It SHALL return `{ initialized: boolean, missing: string[] }` — this is also the shape included in `read_user_profile()` results:

- `initialized` SHALL be `true` if and only if the caller's `preferences` record is present in D1 (the unconditional first onboarding area), and `false` otherwise.
- `missing` SHALL list the onboarding-area keys whose D1 data is absent, using the fixed mapping: `store` (preferences row), `taste`, `diet`, `equipment` (kitchen_equipment rows), `pantry` (pantry rows), `ready-to-eat`, `stockup`, `corpus` (overlay rows).

When the profile does not exist yet (a brand-new member with no D1 rows), the tool SHALL return `{ initialized: false, missing: <all area keys> }` rather than erroring. Any other upstream failure SHALL surface as a structured `upstream_unavailable` error (the standard tool-boundary mapping), so the caller can treat an indeterminate result as non-gating.

#### Scenario: Brand-new member with no D1 profile

- **WHEN** `profile_status` is called for a member with no D1 profile rows
- **THEN** it returns `{ initialized: false, missing: [...all area keys...] }` without erroring

#### Scenario: Set-up member reports initialized

- **WHEN** `profile_status` is called for a member whose D1 profile row exists
- **THEN** it returns `initialized: true`, with `missing` listing only the onboarding areas whose D1 data is still absent

#### Scenario: Partially set-up member lists the gaps

- **WHEN** `profile_status` is called for a member who has a preferences row but no taste or stockup data
- **THEN** it returns `initialized: true` and `missing` includes `taste` and `stockup`

#### Scenario: Transient upstream failure is a structured error, not a false "not initialized"

- **WHEN** the D1 query fails for a transient reason (e.g. a 5xx)
- **THEN** the tool returns a structured `upstream_unavailable` error rather than reporting `initialized: false`

### Requirement: recipe_site_url resolves the hosted browse URL at runtime

The system SHALL provide a `recipe_site_url` read tool that resolves the URL of the hosted cookbook (the browse view of the shared corpus), served by the grocery-mcp Worker itself at `<origin>/cookbook` — so the agent can point a member at the full corpus without any build-time-baked URL. It SHALL return `{ url, enabled }`: `enabled: true` with `<origin>/cookbook` when the request origin is resolvable, and `enabled: false` with `url: null` when it is not. The tool takes no parameters and never writes.

#### Scenario: Returns the cookbook URL

- **WHEN** `recipe_site_url` is called and the request origin is resolvable
- **THEN** it returns `{ url: "<origin>/cookbook", enabled: true }`

#### Scenario: Reports not-enabled instead of failing

- **WHEN** `recipe_site_url` is called and the request origin is not resolvable
- **THEN** it returns `{ url: null, enabled: false }`, so the agent can surface the corpus another way rather than presenting a broken link

### Requirement: get_weather_forecast returns a daily forecast with meal_vibes hints

The system SHALL provide a `get_weather_forecast(days?)` read tool that resolves the caller's location and returns a daily weather forecast for planning purposes. Location resolution SHALL follow this order: (1) `preferences.location_zip`; (2) a 5-digit ZIP parsed from `preferences.preferred_location` via the `"Kroger - <zip>"` convention. If neither yields a ZIP, the tool SHALL return `{ error: "no_location" }` rather than throwing, so the agent can ask the user once and store the result. On a successful location resolve, the tool SHALL call Open-Meteo (geocoding + forecast APIs) and return `{ location: string, forecast: Array<{ date, high_f, low_f, precipitation_chance, condition, meal_vibes }> }`. A network failure or non-200 response from Open-Meteo SHALL return `{ error: "forecast_unavailable" }`. The `meal_vibes` array SHALL be derived deterministically in the Worker from thresholds (not delegated to the LLM): `no-grill` and `comfort` when precipitation_chance ≥ 60; `soup` when high_f < 55; `grill-friendly` when high_f ≥ 80 and precipitation_chance < 30; `light` when high_f ≥ 85. The `days` parameter defaults to 7 and is clamped to 1–16. The tool SHALL be read-only and have no side effects.

#### Scenario: Returns forecast with meal_vibes for a normally-onboarded member

- **WHEN** `get_weather_forecast()` is called and `preferences.preferred_location` is `"Kroger - 76104"`
- **THEN** the tool parses ZIP `76104`, calls Open-Meteo, and returns a 7-day forecast array where each entry carries `meal_vibes` derived from that day's temperature and precipitation data

#### Scenario: location_zip takes precedence over preferred_location parsing

- **WHEN** both `preferences.location_zip = "10001"` and `preferences.preferred_location = "Kroger - 76104"` are set
- **THEN** the tool uses `10001` for the geocoding lookup, not `76104`

#### Scenario: No location returns a structured error

- **WHEN** `get_weather_forecast()` is called and neither `location_zip` nor a parseable ZIP in `preferred_location` exists
- **THEN** the tool returns `{ error: "no_location" }`, not a throw

#### Scenario: Open-Meteo failure returns a structured error

- **WHEN** the Open-Meteo API returns a non-200 response or times out
- **THEN** the tool returns `{ error: "forecast_unavailable" }`, not a throw

#### Scenario: meal_vibes is empty on mild, dry days

- **WHEN** the forecast for a day has high_f = 72 and precipitation_chance = 15
- **THEN** that day's `meal_vibes` is `[]` — no strong signal, no hints applied

### Requirement: search_recipes reads the index and filters in-worker

The system SHALL provide `search_recipes({ specs })` that takes a non-empty array of search specs and returns `{ results: [{ label, recipes }] }` — one result group per input spec, in input order, each group's `label` echoed back verbatim. For every spec the tool SHALL read the shared D1 `recipes` index, **join each entry with the caller's per-tenant overlay** (`favorite` / `reject`), **the caller's cooking-log-derived `last_cooked`**, **and the caller's owned-equipment list**, union the caller's personal (unshared) recipes, and apply the spec's `facets` in the Worker, producing recipes shaped `{ slug, title, frontmatter }` where `frontmatter` reflects the merged objective content plus the caller's subjective marks. By default — with no overlay row — a recipe is **neutral (available)**; the default result for an unfiltered spec is the whole corpus **minus the caller's rejects**. There is no `status` field and no effective-`draft` default.

A spec carries `{ label, facets?, vibe?, k?, boost_ingredients? }`. The `vibe` is **optional** and selects the mode:
- **vibe ABSENT (membership)** — the group SHALL be **every** recipe that survives the facet gate, in index order with no ranking, **including recipes that have no embedding yet** (e.g. just-imported, not yet reconciled), and SHALL NOT be capped by `k`. `boost_ingredients` SHALL be ignored. This is the path a named-dish or browse lookup uses, so a freshly-imported recipe is never silently dropped.
- **vibe PRESENT (ranked)** — the surviving rows are ranked (see the semantic-recipe-search capability), which drops unembedded survivors and returns the top-`k`.

If the index is missing or malformed, the tool SHALL return a structured `index_unavailable` error.

#### Scenario: The whole corpus minus rejects is returned by default

- **WHEN** `search_recipes({ specs: [{ label: "all" }] })` is invoked
- **THEN** `results[0].recipes` contains every shared recipe the caller has not rejected (no per-member activation required), each merged with the caller's `favorite`/`last_cooked`

#### Scenario: Rejected recipes are excluded

- **WHEN** the caller has rejected a recipe and invokes a vibe-less spec
- **THEN** that recipe is absent from the result; another member who has not rejected it still sees it

#### Scenario: Personal recipes included

- **WHEN** the caller has personal (unshared) recipes and invokes a vibe-less spec
- **THEN** the results include the caller's personal recipes alongside non-rejected shared corpus recipes

#### Scenario: Membership mode returns unembedded recipes and ignores k

- **WHEN** a vibe-less spec is invoked, a matching recipe has no embedding yet, and `k` is set to 5 while 30 recipes match
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

