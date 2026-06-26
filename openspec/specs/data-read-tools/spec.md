# data-read-tools Specification

## Purpose

Defines the repo-data-backed read tools exposed by the MCP server (`list_recipes`, `read_recipe`, `read_pantry`, `read_preferences`, `read_taste`, `read_diet_principles`): their return shapes, `list_recipes` filter semantics, `read_pantry` partial-filter scope, per-tool error cases, and empty-data resilience. Consumes `_indexes/recipes.json` from the data-indexing capability.
## Requirements
### Requirement: list_recipes reads the index and filters in-worker

The system SHALL provide `list_recipes(filters)` that reads the shared `_indexes/recipes.json` in a single call, **joins each entry with the caller's per-tenant overlay** (`favorite`, `status` from the D1 overlay; effective `status` defaults to `draft` when the caller has no overlay row), **the caller's cooking-log-derived `last_cooked`** (max cook date for the slug from that tenant's `cooking_log`), **and the caller's owned-equipment list** (`owned` from `kitchen.toml`, empty when absent), unions the caller's personal (unshared) recipes, and applies filters in the Worker, returning `{ recipes: [{ slug, title, frontmatter }] }` where `frontmatter` reflects the merged objective content + the caller's subjective fields. If the shared `_indexes/recipes.json` is missing or malformed, the tool SHALL return a structured `index_unavailable` error.

#### Scenario: Active recipes returned by default, per caller overlay

- **WHEN** `list_recipes({})` is invoked with no `status` filter
- **THEN** only recipes whose **effective status for the caller** is `active` are returned, each with shared content merged with the caller's `favorite`/`last_cooked`

#### Scenario: Status reflects the caller, not the corpus

- **WHEN** two tenants invoke `list_recipes({ status: "active" })` and they have dispositioned a shared recipe differently
- **THEN** each tenant's result reflects their own overlay status for that recipe, not a shared/global status

#### Scenario: Personal recipes included

- **WHEN** the caller has personal (unshared) recipes and invokes `list_recipes({})`
- **THEN** the results include the caller's personal recipes alongside shared corpus recipes

#### Scenario: Index missing or malformed

- **WHEN** the shared `_indexes/recipes.json` cannot be read or parsed
- **THEN** the tool returns a structured `index_unavailable` error rather than an empty list or a throw

### Requirement: list_recipes filter semantics

The system SHALL apply `list_recipes` filters with these semantics: array filters (`dietary`, `season`) match when the recipe contains **ALL** listed values (AND); the `course` filter is a **scalar** that matches by **containment** — a recipe passes when its (array-normalized) `course` includes the requested value, so `{ course: "side" }` returns mains-that-are-also-sides as well as pure sides; `status` defaults to `active` and `status: "all"` disables status filtering; `exclude_cooked_within_days` is a caller-supplied number that excludes recipes cooked within that many days; and `not_cooked_since` (a date) admits recipes whose `last_cooked` is `null`. The system SHALL NOT provide a `tags` array filter — keyword/name matching against tags is handled by the `query` text filter (see "list_recipes free-text query filter"). The `course` value is a free string matched literally against the normalized index values; there is no controlled set.

The system SHALL additionally apply a **makeability gate** by default: a recipe whose `requires_equipment` is not a subset of the caller's `owned` (see the kitchen-equipment "Deterministic makeability rule") SHALL be excluded. When the caller's `owned` is empty (or `kitchen.toml` is absent) the gate SHALL be a no-op (every recipe passes). A `include_unmakeable: true` filter SHALL disable the exclusion and instead return unmakeable recipes annotated with `missing_equipment` (the required slugs not in `owned`), so the named-dish enumeration path can surface a named recipe flagged rather than silently dropped. The gate SHALL be ANDed with the other filters and SHALL be a pure function of the recipe's indexed `requires_equipment` and the caller's `owned`.

The return shape SHALL stay flat: `course` rides each entry's `frontmatter`; the tool SHALL NOT return a grouped or course-bucketed envelope. Callers that want mains and sides together issue one call (e.g. `list_recipes({ status: "active" })`) and bucket by `course` themselves.

#### Scenario: Array filter matches all values

- **WHEN** `list_recipes({ dietary: ["gluten-free", "dairy-free"] })` is invoked
- **THEN** only recipes whose `dietary` includes both `gluten-free` AND `dairy-free` are returned

#### Scenario: Course filter matches by containment

- **WHEN** `list_recipes({ course: "side" })` is invoked
- **THEN** every recipe whose normalized `course` array includes `side` is returned — including a dual-use recipe whose `course` is `[main, side]` — and recipes without `side` in their `course` are excluded

#### Scenario: Course filter value is open, not validated

- **WHEN** `list_recipes({ course: "sauce" })` is invoked and some recipes carry `course: [sauce]`
- **THEN** those recipes are returned; the filter does not reject `sauce` as off-vocabulary

#### Scenario: Status opt-out returns every status

- **WHEN** `list_recipes({ status: "all" })` is invoked
- **THEN** recipes of every status (`active`, `draft`, `rejected`, `archived`) are returned

#### Scenario: Never-cooked recipe passes not_cooked_since

- **WHEN** `list_recipes({ not_cooked_since: "2026-01-01" })` is invoked and a recipe has `last_cooked: null`
- **THEN** that recipe is included in the results

#### Scenario: Recently cooked recipe excluded by window

- **WHEN** `list_recipes({ exclude_cooked_within_days: 14 })` is invoked and a recipe was cooked 3 days ago
- **THEN** that recipe is excluded from the results

#### Scenario: A tags filter is not honored

- **WHEN** `list_recipes({ tags: ["chicken"] })` is invoked (an unknown filter)
- **THEN** the `tags` key is ignored (no tag-based narrowing) and the result is the same as if no `tags` were supplied

#### Scenario: Unmakeable recipe is excluded by default

- **WHEN** `list_recipes({})` is invoked, a recipe requires `["pressure-cooker"]`, and the caller's `owned` is `["blender"]`
- **THEN** that recipe is excluded from the results

#### Scenario: Empty inventory disables the gate

- **WHEN** `list_recipes({})` is invoked and the caller has no `kitchen.toml` (or empty `owned`)
- **THEN** the makeability gate excludes nothing and recipes are returned as if no equipment filter applied

#### Scenario: include_unmakeable surfaces flagged recipes

- **WHEN** `list_recipes({ include_unmakeable: true })` is invoked, a recipe requires `["pressure-cooker"]`, and the caller's `owned` is `["blender"]`
- **THEN** that recipe is returned annotated with `missing_equipment: ["pressure-cooker"]` rather than excluded

### Requirement: list_recipes free-text query filter

The system SHALL support an optional `query` string filter on `list_recipes` that is the single text-search path over a recipe's `title` and `tags`. The query SHALL be tokenized on whitespace and a fixed set of stopwords (`and`, `or`, `with`, `the`, `a`, `an`, `of`, `in`, `on`, `for`, `&`) SHALL be removed before matching. A recipe matches when **every** remaining token appears, as a case-insensitive substring, in the recipe's `title` or any of its `tags` (token-AND). The `query` filter SHALL be ANDed with the other filters and SHALL be a pure function of the index entry (no I/O). When `query` is absent, empty, or reduces to zero tokens after stopword removal, `list_recipes` SHALL apply no text narrowing. The filter SHALL NOT rank, score, or fuzzy-match — it is a deterministic membership test so that a named dish present in the corpus (in title or tags) cannot be silently omitted.

#### Scenario: Natural phrase returns all genuine matches via title or tags

- **WHEN** `list_recipes({ query: "chicken and rice" })` is invoked and the corpus contains "Chicken and Rice" (tag "rice" absent — "rice" only in the title), plus "Arroz Caldo" and "Galinhada Mineira" (both tagged `chicken` and `rice`)
- **THEN** all three are returned: the connective `and` is dropped as a stopword (so `{chicken, rice}` remain), "Chicken and Rice" matches via its title, and the other two match via tags

#### Scenario: Stopword-only query applies no narrowing

- **WHEN** `list_recipes({ query: "and the" })` is invoked
- **THEN** the query reduces to zero tokens and no text narrowing is applied (same as an absent `query`)

#### Scenario: All content tokens must be present (AND)

- **WHEN** `list_recipes({ query: "chicken rice" })` is invoked
- **THEN** a recipe with neither `chicken` nor `rice` in its title or tags is excluded, and a recipe whose title or tags contain both is included

#### Scenario: Title-only keyword is findable

- **WHEN** `list_recipes({ query: "rice" })` is invoked and a recipe titled "Chicken and Rice" has no `rice` tag
- **THEN** that recipe is included because `query` searches the title, not only tags

#### Scenario: Query composes with structured filters

- **WHEN** `list_recipes({ query: "chicken", status: "active", protein: "chicken" })` is invoked
- **THEN** only active chicken-protein recipes whose title or tags contain `chicken` are returned

### Requirement: read_recipe returns frontmatter and body

The system SHALL provide `read_recipe(slug)` returning `{ slug, frontmatter, body }`, where `frontmatter` is the shared objective frontmatter **merged with the caller's overlay fields** (`favorite`, `status`, defaulting `status` to `draft` when absent) **and the caller's cooking-log-derived `last_cooked`** and `body` is the markdown after the frontmatter fence. The slug MAY resolve to a shared corpus recipe or one of the caller's personal recipes. The return SHALL NOT include a `last_modified` field. A slug unknown to both the shared corpus and the caller's personal recipes SHALL return a structured `not_found` error.

#### Scenario: Existing recipe read with caller's subjective fields

- **WHEN** `read_recipe("american-chop-suey")` is invoked by a tenant who favorited it and cooked it last week
- **THEN** it returns the slug, the shared frontmatter merged with that tenant's `favorite: true` and `last_cooked`, and the markdown body, with no `last_modified` field

#### Scenario: Unknown slug

- **WHEN** `read_recipe("does-not-exist")` is invoked and the slug is in neither the shared corpus nor the caller's personal recipes
- **THEN** it returns a structured `not_found` error naming the slug

### Requirement: read_pantry with partial filter support

The system SHALL provide `read_pantry(filter)` returning `{ items: [...] }`, supporting the `category` and `prepared_only` filters deterministically. The `stale_only` filter SHALL return a structured `unsupported` error, because freshness is an LLM-judged, prompt-resolved concern (it depends on storage, whether a package was opened, and visual inspection — none of which is in the repo) rather than a function the tool can compute. There is no shelf-life table backing it: the previously-reserved `ingredients.toml` has been removed, superseded by the curated `storage_guidance/` tree, which informs put-away advice rather than gating staleness.

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

`read_user_profile()` SHALL return the caller's full profile assembled from the D1 profile tables — `initialized`, `missing`, and all profile fields — in one batched set of queries. The structured fields (`preferences`, `kitchen`, `staples`, `overlay`, `ready_to_eat`, `stockup`) are reconstructed from typed rows/columns (preferences from the `profile` row + `brand_prefs`); the markdown fields (`taste`, `diet_principles`) are returned as strings from the `profile` row. The Worker SHALL NOT parse TOML on the profile read path, and SHALL NOT read a `profile:<username>` KV bundle. The returned object shape is unchanged from the caller's perspective.

#### Scenario: Profile read assembles structured JSON from D1

- **WHEN** `read_user_profile()` is called for an initialized tenant
- **THEN** the profile is assembled from the D1 tables and returned in the existing shape, with no TOML parse and no KV bundle read

#### Scenario: Matcher and weather read preferences from D1

- **WHEN** the matcher reads `brands` or the weather resolver reads `stores`/`location_zip`
- **THEN** the values come from the D1 `brand_prefs` and `profile` rows, not a parsed TOML string

### Requirement: Config and narrative read tools

The system SHALL provide `read_preferences()` returning the caller's `preferences` object assembled from D1 (the `profile` row + `brand_prefs` rows), and `not_found` when no profile/preferences row exists; `read_taste()` returning the caller's taste markdown from the `profile` row; and `read_diet_principles()` returning the caller's diet-principles markdown from the `profile` row. No profile read path parses TOML or reads a KV bundle.

#### Scenario: Preferences returned from D1

- **WHEN** `read_preferences()` is invoked
- **THEN** it returns the caller's `preferences` object assembled from the D1 `profile` row and `brand_prefs` rows, with no TOML parse

#### Scenario: Narrative fields returned as text

- **WHEN** `read_taste()` or `read_diet_principles()` is invoked
- **THEN** it returns the caller's markdown content as text from the `profile` row

### Requirement: Empty-data resilience

Read tools SHALL return clean empty results for sources that currently hold no data (files that are entirely comments, empty catalogs, or absent optional sections) rather than erroring. A TOML file with no `items` SHALL yield `{ items: [] }`.

#### Scenario: Empty pantry yields empty items

- **WHEN** `read_pantry({})` is invoked against a `pantry.toml` that contains only comments
- **THEN** it returns `{ items: [] }` without error

### Requirement: Group signal is readable on shared recipes

The system SHALL expose the cross-tenant group signal for a shared recipe — how many other tenants have **favorited** it (a count) and non-private notes (attributed) — to inform surfacing of recipes the caller has not tried. This read SHALL aggregate across tenants at read time and SHALL exclude private notes authored by others. The favorite count replaces the prior averaged star rating; it is a single indexed aggregate (`COUNT` of favorites), not an average over a 1–5 scale.

#### Scenario: Aggregated group favorite count available

- **WHEN** several tenants have favorited a recipe and the caller requests group signal for it
- **THEN** the caller receives the count of other-tenant favorites and the attributed non-private notes from the group

#### Scenario: Others' private notes excluded

- **WHEN** another tenant has a private note on a recipe
- **THEN** that private note is not included in the group signal returned to the caller

### Requirement: list_recipes surfaces the favorite boolean

`list_recipes` SHALL surface the caller's `favorite` boolean on each returned entry, merged from the caller's overlay at read time. The prior `rating` value SHALL no longer be merged or returned. (This change adds no dedicated `favorite` query filter to `list_recipes`; semantic retrieval and the favorite re-rank consume the boolean, and a member browses favorites through that path.)

#### Scenario: Favorite rides each entry, rating is gone

- **WHEN** `list_recipes` returns recipes the caller has favorited and not favorited
- **THEN** each entry's merged view carries `favorite: true`/`false` and carries no `rating` field

### Requirement: list_recipes surfaces the recipe description

`list_recipes` SHALL surface each recipe's `description` on the returned entry (projected as a `recipes` column), so the compact craving-aligned brief is available to the caller without a separate `read_recipe` call.

#### Scenario: Description rides the index entry

- **WHEN** `list_recipes` returns a recipe that has a `description`
- **THEN** the entry's frontmatter carries that `description`

### Requirement: profile_status reports initialization from a single subtree listing

The system SHALL provide a per-tenant `profile_status` read tool that reports whether the caller has completed grocery-profile setup, derived from a **single** listing of the caller's `users/<username>/` subtree (via the prefixed GitHub client's `listDir`). It SHALL take no parameters, never write, and address only the caller's own subtree.

It SHALL return `{ initialized: boolean, missing: string[] }`:

- `initialized` SHALL be `true` if and only if the caller's `preferences.toml` is present (the unconditional first onboarding area), and `false` otherwise.
- `missing` SHALL list the onboarding-area keys whose backing file is absent, using the fixed mapping: `store`→`preferences.toml`, `taste`→`taste.md`, `diet`→`diet_principles.md`, `equipment`→`kitchen.toml`, `pantry`→`pantry.toml`, `ready-to-eat`→`ready_to_eat.toml`, `stockup`→`stockup.toml`, `corpus`→`overlay.toml`.

When the subtree does not exist yet (the GitHub Contents API returns 404 for a brand-new member), the tool SHALL treat it as an empty subtree and return `{ initialized: false, missing: <all area keys> }` rather than erroring. Any other upstream failure SHALL surface as a structured `upstream_unavailable` error (the standard tool-boundary mapping), so the caller can treat an indeterminate result as non-gating.

#### Scenario: Brand-new member with no subtree

- **WHEN** `profile_status` is called for a member whose `users/<username>/` subtree does not exist (404)
- **THEN** it returns `{ initialized: false, missing: [...all area keys...] }` without erroring

#### Scenario: Set-up member reports initialized

- **WHEN** `profile_status` is called for a member whose subtree contains `preferences.toml`
- **THEN** it returns `initialized: true`, with `missing` listing only the onboarding areas whose files are still absent

#### Scenario: Partially set-up member lists the gaps

- **WHEN** `profile_status` is called for a member who has `preferences.toml` but no `taste.md` or `stockup.toml`
- **THEN** it returns `initialized: true` and `missing` includes `taste` and `stockup`

#### Scenario: Transient upstream failure is a structured error, not a false "not initialized"

- **WHEN** the subtree listing fails for a reason other than a 404 (e.g. a 5xx from GitHub)
- **THEN** the tool returns a structured `upstream_unavailable` error rather than reporting `initialized: false`

### Requirement: recipe_site_url resolves the hosted browse URL at runtime

The system SHALL provide a `recipe_site_url` read tool that resolves the URL of the hosted recipe site (the static browse view of the shared corpus) from the data repo's **GitHub Pages** configuration, via the existing GitHub App installation token — so the agent can point a member at the full corpus without any build-time-baked URL. It SHALL return `{ url, enabled }`: `enabled: true` with the published `html_url` (honoring a configured custom domain) when Pages is enabled, and `enabled: false` with `url: null` when it is not (the GitHub Pages API returns 404). When the GitHub App lacks the `Pages: read` permission (403), the tool SHALL return a structured `insufficient_permission` error naming the missing permission, rather than throwing. The tool reads the **shared** data repo (Pages is a repo-level property), takes no parameters, and never writes.

#### Scenario: Returns the published URL when Pages is enabled

- **WHEN** `recipe_site_url` is called and the data repo has GitHub Pages enabled
- **THEN** it returns `{ url: <published html_url>, enabled: true }`, reflecting a custom domain when one is configured

#### Scenario: Reports not-enabled instead of failing

- **WHEN** `recipe_site_url` is called and the data repo has no GitHub Pages site (404)
- **THEN** it returns `{ url: null, enabled: false }`, so the agent can tell the member their operator needs to enable Pages

#### Scenario: Missing Pages permission is a structured error

- **WHEN** `recipe_site_url` is called but the GitHub App lacks the `Pages: read` permission (403)
- **THEN** the tool returns a structured `insufficient_permission` error naming the missing permission, not an unhandled throw

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

### Requirement: read_staples returns the caller's staples list

The system SHALL provide `read_staples()` that reads the caller's `users/<username>/staples.toml` and returns `{ items: [{ name, perishable? }] }`. When `staples.toml` is absent or empty the tool SHALL return `{ items: [] }` rather than an error, matching the graceful-degradation contract for optional per-tenant files.

#### Scenario: Returns items with perishable flag

- **WHEN** the caller's `staples.toml` contains `[{ name: "olive oil" }, { name: "eggs", perishable: true }]`
- **THEN** `read_staples()` returns `{ items: [{ name: "olive oil" }, { name: "eggs", perishable: true }] }`

#### Scenario: Missing file returns empty list

- **WHEN** the caller has no `staples.toml`
- **THEN** `read_staples()` returns `{ items: [] }` and does not error
