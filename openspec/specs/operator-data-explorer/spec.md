# operator-data-explorer Specification

## Purpose
TBD - created by archiving change add-operator-data-explorer. Update Purpose after archive.
## Requirements
### Requirement: Read-only data explorer gated by Cloudflare Access

The Worker SHALL expose a read-only **data explorer** as a top-level **Data** area of the operator admin panel — client-routed UI under `/admin/data/*` and JSON endpoints under `/admin/api/data/*` — that lets the operator inspect the contents of D1 and the R2 corpus. Every `/admin/api/data/*` endpoint SHALL be read-only: it SHALL perform only reads (`SELECT` against D1, `get`/`list` against R2) and SHALL NOT create, update, or delete any D1 row or R2 object. The data explorer SHALL be gated by the **same** Cloudflare Access gate as the rest of `/admin*` (no separate auth surface), inheriting its opt-in rule: when the Access configuration (`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`) is unset, `/admin/api/data/*` SHALL respond `404` along with the rest of the admin surface.

#### Scenario: Data endpoints never mutate

- **WHEN** any `/admin/api/data/*` endpoint is called
- **THEN** the Worker performs only reads, and no D1 row or R2 object is created, updated, or deleted

#### Scenario: Disabled together with the admin surface

- **WHEN** `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is unset
- **THEN** every `/admin/api/data/*` endpoint responds `404`, exposing no data

#### Scenario: Reachable under a valid Access session

- **WHEN** a request to `/admin/api/data/*` carries a valid, audience-matched Access assertion (and passes any configured email allowlist)
- **THEN** the Worker returns the requested read

### Requirement: The data explorer is cross-tenant with no redaction

The data explorer SHALL be **cross-tenant** — the operator MAY inspect every member's rows, not only one tenant's — and SHALL NOT redact any field on the basis of tenant privacy. A member's `private` recipe/store notes SHALL be visible to the operator, and any cross-tenant aggregate SHALL identify the tenants it summarizes by id (named, not anonymized). The data explorer's scope SHALL be D1 domain data and the R2 corpus **only**; it SHALL NOT surface secrets or credentials held in other tiers (e.g. KV-held Kroger/OAuth tokens).

#### Scenario: Private notes are shown to the operator

- **WHEN** a member has a recipe or store note marked `private`
- **THEN** that member's data view shows the note without redaction

#### Scenario: Cross-tenant aggregates name tenants

- **WHEN** the recipe view reports who has favorited or rejected a recipe
- **THEN** each disposition is attributed to a named tenant id, not anonymized

#### Scenario: Out-of-scope tiers are not exposed

- **WHEN** the operator browses any data-explorer view
- **THEN** no KV-held token or credential is exposed — the surface reads only D1 domain data and the R2 corpus

### Requirement: Recipe view joins all tiers into one projection status

The Recipe view (`GET /admin/api/data/recipes/<slug>`) SHALL assemble a single per-slug record **across tiers**: the R2 `recipes/<slug>.md` source text, the D1 `recipes` projection row (if any), the `recipe_derived` row (the AI description and whether an embedding is present), any `reconcile_errors` entry for the slug, and the cross-tenant `overlay` dispositions and `recipe_notes` for the slug. In addition to the raw source text, the record SHALL include the recipe **body** — the source with its YAML frontmatter fence removed (via the Worker's `parseMarkdown`), or the whole source text when it has no parseable frontmatter — computed from the already-fetched source with no additional R2 or D1 read, so a client can render the body without reparsing the frontmatter fence. The view SHALL derive a single **projection status** describing the slug's place in the index pipeline, distinguishing at least: **indexed** (R2 source present and a `recipes` row present), **skipped** (R2 source present, no `recipes` row, carrying the `reconcile_errors` reason), **pending** (R2 source present, no `recipes` row, and no reconcile entry yet), and **orphaned** (a `recipes` row present with no R2 source). The recipe listing (`GET /admin/api/data/recipes`) SHALL return each slug with its title and projection status.

#### Scenario: Indexed recipe shows its projection and derived description

- **WHEN** a slug has both an R2 source and a `recipes` row
- **THEN** the view reports status **indexed** and includes the projection row and any `recipe_derived` description

#### Scenario: Skipped recipe carries the reconcile reason

- **WHEN** a slug has an R2 source but no `recipes` row and a `reconcile_errors` entry exists for it
- **THEN** the view reports status **skipped** and includes that reconcile reason

#### Scenario: Orphaned projection is observable

- **WHEN** a `recipes` row exists for a slug with no corresponding R2 source object
- **THEN** the view reports status **orphaned**

#### Scenario: Cross-tenant disposition is attributed

- **WHEN** one or more members have favorited or rejected the slug
- **THEN** the view lists each named tenant's disposition and any of their notes on the recipe

#### Scenario: Recipe body is provided frontmatter-stripped

- **WHEN** a recipe's R2 source begins with a YAML frontmatter fence
- **THEN** the record includes a `body` field holding the source with that fence removed, alongside the unchanged raw `source` field

#### Scenario: Body falls back to the whole source without frontmatter

- **WHEN** a recipe's R2 source has no parseable YAML frontmatter fence
- **THEN** the `body` field holds the entire source text

### Requirement: Shared-corpus view browses the shared lookup tables and guidance markdown

The data explorer SHALL browse the store-related shared-corpus data — `stores`, `store_notes`, and `sku_cache` — through the Stores explorer's per-store assembly (identity, cached SKUs, grouped notes; see "Stores explorer lists the shared registry and assembles a per-store detail"), and SHALL browse the authored `guidance/**` R2 markdown tree via the Guidance explorer (a listing endpoint over the R2 prefix and an object endpoint returning a guidance object's markdown text; see "Guidance explorer browses the R2 tree with a breadcrumb"). `sku_cache` MAY be large; the Stores explorer's per-store SKU read SHALL be scoped to one store's `location_id` rather than returning the whole table unbounded. The `aliases`, `flyer_terms`, and `feeds` lookup tables are shared config, not per-store or per-recipe data, and are edited through the Config area's shared-corpus editors, not the data explorer.

#### Scenario: Store data is browsed through the Stores explorer

- **WHEN** the operator opens a store's detail view
- **THEN** its cached SKUs and notes are returned scoped to that store, not as an unbounded flat table dump

#### Scenario: Guidance markdown is rendered

- **WHEN** the operator opens a `guidance/**` object
- **THEN** the view returns its markdown text for display, browsed from the R2 corpus

#### Scenario: Store SKU reads are scoped per store

- **WHEN** the operator opens a store's detail view
- **THEN** the SKU read is bounded to that store's `location_id`, never the whole `sku_cache` table unbounded

### Requirement: Data reads route through the data-access layer with structured errors

Every data-explorer read SHALL go through the Worker's D1 access layer (`src/db.ts`) and R2 corpus store (`src/corpus-store.ts`) — it SHALL NOT reference `env.DB` directly — and SHALL reuse the existing canonical readers (`src/profile-db.ts`, `src/session-db.ts`, `src/recipe-index.ts`, `src/corpus-store.ts`) where they already assemble the same data, adding new queries only for the cross-tenant aggregates and the bare lookup tables. A storage failure SHALL surface as a structured error (`storage_error` for D1, `upstream_unavailable` for R2), never an unhandled throw, consistent with the rest of the admin API.

#### Scenario: Reuse the canonical readers

- **WHEN** the member view assembles a member's per-tenant state
- **THEN** it uses the same profile/session readers the MCP tools use, not a parallel hand-rolled query path

#### Scenario: A storage failure is structured

- **WHEN** a D1 read fails during a data-explorer request
- **THEN** the endpoint returns a structured `storage_error` rather than an unhandled 500

### Requirement: The admin renders authored corpus markdown as formatted HTML

The operator panel's Data area SHALL render authored corpus markdown to formatted HTML in the browser (client-side) for display: the recipe **body** in the Recipe view, and a `guidance/**` object in the Shared-corpus view. Rendering SHALL be safe for untrusted authored content — raw HTML embedded in the markdown SHALL NOT be emitted, and link and image URLs SHALL be restricted to `http(s)`, root-relative, and fragment URLs, with any other scheme (e.g. `javascript:`) neutralized — matching the hardening the `/cookbook` surface applies to the same recipe bodies. When markdown cannot be parsed, the view SHALL fall back to displaying the raw markdown text rather than an empty pane. The Recipe view SHALL retain its raw inspector sections — the raw `source` text and the D1 projection row — in addition to the rendered body.

#### Scenario: Recipe body is rendered

- **WHEN** the operator opens a recipe whose source has a body
- **THEN** the view shows the body rendered as formatted HTML (headings, lists, emphasis), in addition to the raw `source` dump

#### Scenario: Guidance object is rendered

- **WHEN** the operator opens a `guidance/**` markdown object
- **THEN** the view shows its content rendered as formatted HTML

#### Scenario: Untrusted content is neutralized

- **WHEN** a rendered markdown body contains raw HTML or a link with a `javascript:` URL
- **THEN** the raw HTML is omitted from the output and the link URL is neutralized, so no script executes

#### Scenario: Unparseable markdown falls back to raw text

- **WHEN** the markdown for a recipe body or guidance object fails to parse
- **THEN** the view displays the raw markdown text rather than nothing

#### Scenario: Raw inspector sections are retained

- **WHEN** the operator opens a recipe in the Recipe view
- **THEN** the raw `source` text and the D1 projection JSON remain visible alongside the rendered body

### Requirement: Data area sub-nav is Recipes, Stores, and Guidance

The Data area's UI SHALL present exactly three sub-nav destinations — **Recipes**, **Stores**, and **Guidance** — each its own purpose-built explorer, in place of a generic per-table inspector. The sub-nav SHALL hide while an individual record (a recipe, a store, or a guidance file) is open, so the detail view owns the full width; navigating back to a list SHALL restore the sub-nav. A cross-area deep link to a specific recipe (e.g. from the Members area's cooking-log/meal-plan/notes cross-links) SHALL land on the Recipes tab with that recipe's detail already open.

#### Scenario: Sub-nav offers exactly three destinations

- **WHEN** the operator opens the Data area
- **THEN** the sub-nav shows Recipes, Stores, and Guidance, and no other tab

#### Scenario: Sub-nav hides behind an open detail

- **WHEN** the operator opens a recipe, store, or guidance file's detail view
- **THEN** the sub-nav is hidden and the detail view uses the full width; navigating back restores the sub-nav

#### Scenario: A cross-area recipe link opens directly to detail

- **WHEN** the operator follows a recipe link from another area (e.g. a member's cooking log)
- **THEN** the Data area opens with the Recipes tab selected and that recipe's detail already shown

### Requirement: Recipes explorer supports keyword and hybrid semantic search

The Recipes explorer (`GET /admin/api/data/recipes` and its SSR page) SHALL support a **Keyword** mode and a **Hybrid** mode, selected by the operator via a segmented toggle, over the same cross-tier recipe listing the existing recipe view assembles (title, slug, projection status). Keyword mode SHALL match a query's tokens against the recipe's indexed metadata (at least title, slug, protein, cuisine, course, tags, `ingredients_key`); a recipe matching all query tokens SHALL be included, one matching none SHALL be excluded, and matches SHALL NOT report a relevance score. Hybrid mode SHALL additionally rank by semantic similarity: the query SHALL be embedded once (a single Workers AI call reusing the Worker's existing query-embedding helper) and blended with the keyword coverage into a single relevance score per hit, using the recipe's stored `recipe_derived.embedding` — no per-request re-embedding of any recipe. Each hybrid hit SHALL carry its blended relevance score and a flag indicating whether it was surfaced via the semantic term without a full keyword match ("surfaced semantically"). A recipe with no stored embedding yet (not yet reconciled) SHALL be excluded from Hybrid mode's semantic ranking but SHALL remain findable via Keyword mode. An empty query SHALL return the full corpus unranked in either mode. The blend weights and the semantic-surfaced relevance floor are tunable constants and are NOT part of this contract.

#### Scenario: Keyword mode matches all query tokens

- **WHEN** the operator searches "miso salmon" in Keyword mode
- **THEN** only recipes whose indexed metadata contains both tokens are returned, with no relevance score

#### Scenario: Hybrid mode returns a relevance score

- **WHEN** the operator searches a query in Hybrid mode
- **THEN** each returned recipe carries a relevance score blending keyword coverage and cosine similarity to the embedded query

#### Scenario: A semantically-surfaced recipe is flagged

- **WHEN** a Hybrid-mode hit clears the relevance floor via semantic similarity without matching the query's literal keywords
- **THEN** that hit is flagged as surfaced semantically, distinguishing it from a literal keyword match

#### Scenario: An unembedded recipe is excluded only from Hybrid ranking

- **WHEN** a recipe's `recipe_derived` embedding has not yet been reconciled
- **THEN** it is absent from Hybrid mode's results but still findable in Keyword mode

#### Scenario: Hybrid mode makes exactly one embed call per search

- **WHEN** the operator runs a Hybrid search
- **THEN** the Worker makes exactly one Workers AI call to embed the query, and no recipe is re-embedded

#### Scenario: Empty query returns the unranked corpus

- **WHEN** the search box is empty
- **THEN** the explorer returns every recipe in the corpus/index, in either mode, without a relevance score

### Requirement: Recipes explorer list shows facets, projection status, and relevance

The Recipes list SHALL be paginated with an **operator-configurable page size**, defaulting to **50**, and SHALL show, per recipe: the title, slug, a projection-status badge (indexed/skipped/pending/orphaned, per the existing status derivation), and facet chips for at least protein, cuisine, and total time when present. In Hybrid mode with a non-empty query, each row SHALL additionally show a relevance indicator proportional to its score. Selecting a row SHALL open that recipe's detail view.

#### Scenario: List row shows facets and status

- **WHEN** the Recipes list renders a row for an indexed recipe with a protein and cuisine facet
- **THEN** the row shows the recipe's title, slug, projection-status badge, and its protein/cuisine/time facet chips

#### Scenario: Hybrid results show a relevance indicator

- **WHEN** the operator runs a non-empty Hybrid search
- **THEN** each result row shows a relevance indicator sized to its score

#### Scenario: Page size defaults to 50

- **WHEN** the operator opens the Recipes list with no page-size preference set
- **THEN** the list paginates at 50 recipes per page

#### Scenario: Operator changes the page size

- **WHEN** the operator selects a different page size
- **THEN** the list re-paginates at the chosen size and the current filter/search state is preserved

### Requirement: Recipe detail assembles every pipeline stage with a raw-markdown panel

The Recipe detail view SHALL present, for one slug, in addition to the cross-tier record the existing recipe view assembles (source, projection, `recipe_derived`, reconcile reason, dispositions, notes): a **pipeline-state strip** showing the index/description/embedding stages and whether each has completed; the AI-derived description (or a pending-generation notice when absent); the rendered recipe body; the attributed notes; a pretty (key/value) render of the R2 frontmatter and the D1 index row; and a **collapsible** raw-markdown panel showing the exact R2 source text. The raw-markdown panel SHALL be omitted (not merely empty) when the projection status is `orphaned` (no R2 source exists to show).

#### Scenario: Pipeline strip shows stage completion

- **WHEN** the operator opens a recipe whose description has been generated but whose embedding has not yet been reconciled
- **THEN** the pipeline strip shows the index and description stages complete and the embedding stage pending

#### Scenario: Raw markdown is collapsible

- **WHEN** the operator opens an indexed recipe's detail view
- **THEN** the raw R2 markdown is available in a collapsed panel that expands on request, separate from the rendered body

#### Scenario: Orphaned recipe omits the raw-markdown panel

- **WHEN** the operator opens a recipe whose projection status is orphaned
- **THEN** the raw-markdown panel is omitted, since no R2 source exists to display

### Requirement: Stores explorer lists the shared registry and assembles a per-store detail

The Stores explorer SHALL list every store in the shared `stores` registry, each row showing at least the store's name, slug, and chain. Selecting a row SHALL open a store detail view assembled as a single per-slug record: **identity** (chain, label, domain, address, `location_id`), the store's cached Kroger SKUs (`sku_cache` rows matching the store's `location_id`) when the store has one, and the store's `store_notes` grouped by the tag convention (`layout` / `location` / `stock` / `general`, keyed off each note's first tag, defaulting to `general`). A store with no `location_id` (a non-Kroger chain) SHALL show an explanatory empty state in place of a SKU table rather than an empty table.

#### Scenario: Store list shows identity basics

- **WHEN** the operator opens the Stores explorer
- **THEN** every registered store is listed with at least its name, slug, and chain

#### Scenario: Store detail assembles identity, SKUs, and grouped notes

- **WHEN** the operator opens a Kroger-chain store's detail view
- **THEN** it shows the store's identity fields, its cached SKUs for that store's `location_id`, and its notes grouped into layout/location/stock/general sections

#### Scenario: Non-Kroger store shows an explanatory SKU empty state

- **WHEN** the operator opens a store with no `location_id`
- **THEN** the SKU section shows an explanatory empty state ("not a Kroger location") rather than an empty table

### Requirement: Guidance explorer browses the R2 tree with a breadcrumb

The Guidance explorer SHALL present the `guidance/**` R2 tree as a breadcrumb-navigable folder/file browser, reusing the existing guidance-listing and guidance-object reads: activating a folder row SHALL descend into it (updating the breadcrumb), activating a file row SHALL open its rendered markdown, and activating a breadcrumb segment SHALL navigate back to that level. The root breadcrumb segment SHALL always be reachable to return to the top of the tree.

#### Scenario: Folder navigation updates the breadcrumb

- **WHEN** the operator opens a guidance subfolder
- **THEN** the breadcrumb grows to include that folder and its contents (subfolders and files) are listed

#### Scenario: Opening a file renders its markdown

- **WHEN** the operator opens a guidance markdown file
- **THEN** its content renders as formatted HTML, with the breadcrumb showing the file's full path

#### Scenario: Breadcrumb segment navigates back

- **WHEN** the operator activates an ancestor segment in the breadcrumb
- **THEN** the browser returns to that folder's listing

