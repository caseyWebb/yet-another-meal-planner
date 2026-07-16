# recipe-discovery — delta

## MODIFIED Requirements

### Requirement: A discovery URL can be rejected group-wide

The system SHALL record **shared, group-wide** suppressions of discovery source URLs in a `discovery_rejections` table keyed by the canonical URL (query/fragment/trailing-slash-stripped canonicalization, so a tracker-wrapped and a bare link suppress as one). The background discovery sweep SHALL consult it: a rejected URL (and its tracker-wrapped variants) SHALL be excluded from intake so the sweep never re-imports it. Suppression SHALL be written from the **operator admin Discovery surface** — there is no member `reject_discovery` MCP tool. Rejection SHALL be idempotent on the canonical URL and SHALL NOT, by itself, modify recipe content or any tenant's overlay. Rejection is reserved for suppressing a **source** that is not corpus-worthy for the group (a feed/site producing junk, broken, non-recipe, or duplicate results); a member who dislikes an **already-imported** recipe hides it for themselves with `set_recipe_disposition(slug, "hide")` (per-tenant), never a group-wide suppression.

#### Scenario: A rejected source stops being imported

- **WHEN** the operator suppresses a source URL from the admin Discovery surface and the sweep later runs
- **THEN** that URL (and its tracker-wrapped variants) is excluded from sweep intake and is not re-imported for the group

#### Scenario: Rejection writes no recipe or overlay

- **WHEN** a discovery suppression is recorded
- **THEN** only the shared `discovery_rejections` table is written; no recipe content and no tenant overlay changes

#### Scenario: Personal dislike of an imported recipe is a per-tenant hide

- **WHEN** a member wants to stop seeing an already-imported recipe that others may still want
- **THEN** the agent calls `set_recipe_disposition(slug, "hide")` for that member; group-wide source suppression is an operator admin action

## REMOVED Requirements

### Requirement: create_recipe persists a recipe with a solo commit

**Reason**: The member surface's import verb is the fused `import_recipe` (`recipe-import` delta), which wraps this requirement's create operation; the operation itself — slug derivation and `slug_exists` refusal, dedup-to-grant on a duplicate `source` with idempotent `recipe_imports` attribution (`via 'agent'`, resolved member), no `status` stamping, lens visibility at creation, and the synchronous description/facet seed — persists unchanged behind `import_recipe` and the discovery sweep. A standalone create tool taking agent-assembled frontmatter is exactly the judgment-field failure surface the fusion removes.
**Migration**: Members: `import_recipe(url | text)`. The sweep and any internal caller keep invoking the shared create operation directly. The operation-level guarantees are restated on `import_recipe`'s requirement and the `data-write-tools` write-path requirements.

### Requirement: parse_recipe parses JSON-LD and returns data without writing

**Reason**: Fused into `import_recipe`'s URL path — the JSON-LD extraction (including `@graph`, top-level arrays, `HowToStep`/`HowToSection` flattening) persists as the parse stage of the import pipeline; the agent no longer receives raw parse output to clean and re-submit.
**Migration**: `import_recipe(url)` runs the same extractor internally; the structured parse-failure taxonomy survives on `import_recipe` (`recipe-import` delta). The sweep's acquisition path is untouched.

### Requirement: parse_recipe returns structured errors on bad input

**Reason**: The parse-failure contract moves with the parse stage into `import_recipe` — `unreachable` / `no_jsonld` / `not_a_recipe` / `incomplete`, with the outbound-fetch guard's refusals surfacing as `unreachable` with no upstream status (no internal-reachability probe).
**Migration**: `import_recipe(url)` returns the identical structured errors (`recipe-import` delta); `outbound-fetch-safety`'s guard requirement applies to the import fetch unchanged.

### Requirement: Discovery feeds are writable via update_feeds

**Reason**: Discovery-source configuration leaves the member chat surface in the cull; the operator admin's feed editor is the writer (it already exists and shares the same write helper, including the public-URL write-time guard).
**Migration**: Feed additions go through the admin Config/Discovery surface over the same shared helper — add-only, deduped by canonicalized `url`, `validation_failed` on a non-public URL, no stored row on rejection. The `feeds` table, the sweep's polling, and `outbound-fetch-safety`'s write-time validation are unchanged.
