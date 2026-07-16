# recipe-discovery Specification

## Purpose
TBD - created by archiving change discovery-and-disposition. Update Purpose after archive.
## Requirements
### Requirement: Recipe parsing is runtime-agnostic with no Node-only dependencies

The discovery tools SHALL parse RSS/Atom feeds and extract HTML/JSON-LD using runtime-agnostic string parsing (regex + `JSON.parse`) that runs identically on `workerd` and in Node, and SHALL NOT depend on Node-only libraries (e.g. `recipe-scraper`, `cheerio`), on Node `Buffer`/`fs` APIs, or on `workerd`-only APIs such as `HTMLRewriter` (which would prevent unit testing in the project's Node test runner). No new XML/HTML parsing dependency is added — this mirrors `parse.ts` hand-rolling the frontmatter split rather than pulling in `gray-matter`.

#### Scenario: Parsing logic is pure and unit-testable in Node

- **WHEN** the feed parser and JSON-LD extractor are exercised by the Node test runner
- **THEN** they parse fixture XML/HTML strings with no reliance on `HTMLRewriter` or any Node-only or workerd-only API, and no new parsing dependency appears in the Worker's `package.json`

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

