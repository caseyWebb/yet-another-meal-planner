## ADDED Requirements

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

The Recipes list SHALL be paginated and SHALL show, per recipe: the title, slug, a projection-status badge (indexed/skipped/pending/orphaned, per the existing status derivation), and facet chips for at least protein, cuisine, and total time when present. In Hybrid mode with a non-empty query, each row SHALL additionally show a relevance indicator proportional to its score. Selecting a row SHALL open that recipe's detail view.

#### Scenario: List row shows facets and status

- **WHEN** the Recipes list renders a row for an indexed recipe with a protein and cuisine facet
- **THEN** the row shows the recipe's title, slug, projection-status badge, and its protein/cuisine/time facet chips

#### Scenario: Hybrid results show a relevance indicator

- **WHEN** the operator runs a non-empty Hybrid search
- **THEN** each result row shows a relevance indicator sized to its score

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

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: Member view aggregates a member's full per-tenant state

**Reason**: The Members area (`operator-admin`'s member-roster and member-detail requirements, `/admin/members/<id>` and its section sub-routes) now owns member presentation entirely, reusing the same `memberDetail` read this requirement described. The Data area no longer duplicates a `/admin/data/members/<id>` route to the same data.

**Migration**: An operator inspecting a member's profile, pantry, meal plan, grocery list, overlay dispositions, cooking log, or authored notes uses the Members area (`/admin/members/<id>`, with each section as its own sub-route) instead of the Data area. No data or read function is removed — `memberDetail` in `src/admin-data.ts` is unchanged and is the same function the Members area calls; only the Data-area route and its listing/detail pages are dropped.

### Requirement: Discovery and System views browse the pipeline and operational tables

**Reason**: The Discovery pipeline tables (`discovery_candidates`, `discovery_senders`, `discovery_members`, `discovery_rejections`) are now owned by `operator-admin`'s top-level Discovery area (`/admin/discovery` and its log/config surfaces), which reads and (for the operator-only mutations) writes them through its own dedicated routes — the Data area's flat, read-only `discovery` table dump is redundant with that richer surface. The System tables (`reconcile_errors`, `bug_reports`, `schema_meta`) have no redesigned home; per the redesign's own design intent they are deliberately deferred (a reference empty state, not a working explorer) pending a future holistic redesign, rather than kept as a live but unstyled generic-table view.

**Migration**: An operator inspecting discovery-pipeline rows uses the Discovery area's log and calibration surfaces (`/admin/discovery`, `/admin/logs/discovery`) instead of `/admin/data/discovery`. There is currently no admin-panel replacement for browsing `reconcile_errors`/`bug_reports`/`schema_meta`; these remain inspectable via direct D1 access (`wrangler d1 execute DB --command "…"`, or `--remote` against a deployed database) until a future change gives System a redesigned home. No data is deleted or made unreadable outside the panel — only the Data area's routes to these tables are removed.
