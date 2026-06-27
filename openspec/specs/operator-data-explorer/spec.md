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

The Recipe view (`GET /admin/api/data/recipes/<slug>`) SHALL assemble a single per-slug record **across tiers**: the R2 `recipes/<slug>.md` source text, the D1 `recipes` projection row (if any), the `recipe_derived` row (the AI description and whether an embedding is present), any `reconcile_errors` entry for the slug, and the cross-tenant `overlay` dispositions and `recipe_notes` for the slug. The view SHALL derive a single **projection status** describing the slug's place in the index pipeline, distinguishing at least: **indexed** (R2 source present and a `recipes` row present), **skipped** (R2 source present, no `recipes` row, carrying the `reconcile_errors` reason), **pending** (R2 source present, no `recipes` row, and no reconcile entry yet), and **orphaned** (a `recipes` row present with no R2 source). The recipe listing (`GET /admin/api/data/recipes`) SHALL return each slug with its title and projection status.

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

### Requirement: Member view aggregates a member's full per-tenant state

The Member view (`GET /admin/api/data/members/<id>`) SHALL return one member's complete per-tenant state assembled from D1: the `profile` (with `brand_prefs`, `kitchen_equipment`, `staples`, `stockup`, `ready_to_eat`), the session state (`pantry`, `meal_plan`, `grocery_list`), the `overlay` dispositions, the `cooking_log`, and the member's authored `recipe_notes` / `store_notes` (keyed by `author`). The endpoint SHALL resolve the member id against the tenant allowlist the same way the rest of the admin surface does, returning a structured `not_found`-class error for an id that is not a member. The member ids offered for selection SHALL come from the existing tenant listing.

#### Scenario: Full per-tenant assembly

- **WHEN** the operator opens an allowlisted member's data view
- **THEN** it shows that member's profile, session state (pantry / meal plan / grocery list), overlay dispositions, cooking log, and authored notes

#### Scenario: Unknown member is rejected

- **WHEN** the requested member id is not on the allowlist
- **THEN** the endpoint returns a structured `not_found`-class error and no data

### Requirement: Shared-corpus view browses the shared lookup tables and guidance markdown

The Shared-corpus view SHALL expose the objective shared lookup tables read-only — `aliases`, `flyer_terms`, `feeds`, `stores`, `store_notes`, and `sku_cache` — via `GET /admin/api/data/corpus/<table>` returning that table's rows, and SHALL browse the authored `guidance/**` R2 markdown tree via a listing endpoint over the R2 prefix and an object endpoint returning a guidance object's markdown text. `sku_cache` MAY be large; its endpoint SHALL bound the rows it returns by default rather than returning the whole table unbounded.

#### Scenario: Lookup table rows

- **WHEN** the operator opens the shared-corpus view for `aliases`
- **THEN** the endpoint returns the alias rows

#### Scenario: Guidance markdown is rendered

- **WHEN** the operator opens a `guidance/**` object
- **THEN** the view returns its markdown text for display, browsed from the R2 corpus

#### Scenario: sku_cache is bounded by default

- **WHEN** the operator opens the `sku_cache` table
- **THEN** the endpoint returns at most a bounded default number of rows, not the whole table unbounded

### Requirement: Discovery and System views browse the pipeline and operational tables

The data explorer SHALL expose read-only views over the discovery pipeline and the operational tables. The Discovery view SHALL return the rows of `discovery_candidates`, `discovery_senders`, `discovery_members`, and `discovery_rejections`. The System view SHALL return the full `reconcile_errors` table, the `bug_reports` table, and the `schema_meta` table. Each endpoint SHALL run a **fixed** query over the named table — there SHALL be no operator-supplied SQL.

#### Scenario: Discovery pipeline rows

- **WHEN** the operator opens the Discovery view
- **THEN** the endpoints return the `discovery_candidates`, `discovery_senders`, `discovery_members`, and `discovery_rejections` rows

#### Scenario: Operational rows

- **WHEN** the operator opens the System view
- **THEN** the endpoints return the `reconcile_errors`, `bug_reports`, and `schema_meta` rows

#### Scenario: No operator-supplied SQL

- **WHEN** any data endpoint is called
- **THEN** it runs a fixed query for the named entity/table and accepts no operator-supplied SQL string

### Requirement: Data reads route through the data-access layer with structured errors

Every data-explorer read SHALL go through the Worker's D1 access layer (`src/db.ts`) and R2 corpus store (`src/corpus-store.ts`) — it SHALL NOT reference `env.DB` directly — and SHALL reuse the existing canonical readers (`src/profile-db.ts`, `src/session-db.ts`, `src/recipe-index.ts`, `src/corpus-store.ts`) where they already assemble the same data, adding new queries only for the cross-tenant aggregates and the bare lookup tables. A storage failure SHALL surface as a structured error (`storage_error` for D1, `upstream_unavailable` for R2), never an unhandled throw, consistent with the rest of the admin API.

#### Scenario: Reuse the canonical readers

- **WHEN** the member view assembles a member's per-tenant state
- **THEN** it uses the same profile/session readers the MCP tools use, not a parallel hand-rolled query path

#### Scenario: A storage failure is structured

- **WHEN** a D1 read fails during a data-explorer request
- **THEN** the endpoint returns a structured `storage_error` rather than an unhandled 500

