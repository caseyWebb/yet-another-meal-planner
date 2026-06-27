## ADDED Requirements

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

## REMOVED Requirements

### Requirement: list_recipes reads the index and filters in-worker

**Reason**: `list_recipes` is merged into the unified `search_recipes` tool; its membership behavior is now the vibe-absent mode of `search_recipes`.
**Migration**: Replace `list_recipes(filters)` with `search_recipes({ specs: [{ label, facets: filters }] })` and read `results[0].recipes`.

### Requirement: list_recipes filter semantics

**Reason**: The filter semantics are unchanged but now apply to a spec's `facets` under `search_recipes`, and the return shape moves from flat `{ recipes }` to the grouped `{ results: [{ label, recipes }] }` envelope.
**Migration**: Move filters under `specs[].facets`; read each group from `results[i].recipes`.

### Requirement: list_recipes free-text query filter

**Reason**: The `query` text filter is unchanged but is now a facet on a `search_recipes` spec; named-dish lookup uses a vibe-less query spec.
**Migration**: Pass `query` inside `specs[].facets` with no `vibe`.

### Requirement: list_recipes surfaces the favorite boolean

**Reason**: Superseded by "search_recipes surfaces the favorite boolean"; behavior is identical under the renamed tool.
**Migration**: None — each returned entry still carries `favorite`.

### Requirement: list_recipes surfaces the recipe description

**Reason**: Superseded by "search_recipes surfaces the recipe description"; behavior is identical under the renamed tool.
**Migration**: None — each returned entry still carries `description`.
