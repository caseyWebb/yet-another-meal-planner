## MODIFIED Requirements

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

## ADDED Requirements

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
