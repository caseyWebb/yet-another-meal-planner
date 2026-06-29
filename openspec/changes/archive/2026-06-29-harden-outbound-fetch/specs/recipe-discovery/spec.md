## MODIFIED Requirements

### Requirement: parse_recipe returns structured errors on bad input

`parse_recipe` SHALL return a structured error rather than throwing or returning partial data when it cannot produce a usable recipe: `{ error: "unreachable" }` when the page cannot be fetched, `{ error: "no_jsonld" }` when no JSON-LD is present, `{ error: "not_a_recipe" }` when JSON-LD exists but contains no `Recipe`, and `{ error: "incomplete", missing: [...] }` when a `Recipe` is found but yields no ingredients or no instructions. A URL that the outbound-fetch guard refuses — a non-`http(s)` scheme, embedded credentials, a private/loopback/link-local host, or a redirect hop to such a target — SHALL surface as `{ error: "unreachable" }` with no upstream status, exactly as a dead host does, so the LLM-driven tool cannot be used to probe internal reachability.

#### Scenario: Page without JSON-LD

- **WHEN** `parse_recipe` is called on a page that has no `<script type="application/ld+json">`
- **THEN** it returns `{ error: "no_jsonld" }`

#### Scenario: Recipe missing instructions

- **WHEN** a parsed `Recipe` has ingredients but no instruction steps
- **THEN** it returns `{ error: "incomplete", missing: ["instructions"] }`

#### Scenario: A guard-blocked URL is unreachable, not a probe

- **WHEN** `parse_recipe` is called with a URL whose scheme/host the guard refuses (e.g. `http://169.254.169.254/`), or a public URL that redirects to such a target
- **THEN** it returns `{ error: "unreachable" }` with no HTTP status, indistinguishable from a dead public host

### Requirement: Discovery feeds are writable via update_feeds

The system SHALL provide an `update_feeds` tool that adds RSS/Atom discovery feeds to the **shared** D1 `feeds` table — not a per-tenant `users/<id>/` path — so a member can wire up discovery sources during onboarding. It SHALL be **add-only with dedup by canonicalized feed `url`** (existing rows untouched), mirroring the add-only `update_discovery_sources`, and SHALL accept per feed a required `url` and optional `name`, `weight` (default 1), and `tags`. A feed `url` that is not a public `http`/`https` URL — a non-http scheme, embedded credentials, or a private/loopback/link-local host — SHALL be rejected with `validation_failed` and SHALL NOT be stored (the same write-time guard the operator feed editor applies, since both write through one helper). It SHALL return `{ added }` and SHALL make no D1 write when no new feed is added. Because feeds are a shared, top-level concern, any member trusted with the MCP MAY widen the group feed set, consistent with `update_discovery_sources`.

#### Scenario: New feed is added to the shared feeds table

- **WHEN** `update_feeds` is called with a feed `url` not already present
- **THEN** the feed is inserted into the D1 `feeds` table, and the tool returns `{ added }`

#### Scenario: Duplicate feed is a no-op

- **WHEN** `update_feeds` is called with a `url` that canonicalizes to one already in the D1 `feeds` table
- **THEN** no duplicate is written, no D1 write is made, and the result reports nothing added

#### Scenario: Feed write targets the shared D1 table, not a tenant subtree

- **WHEN** any member calls `update_feeds`
- **THEN** the write targets the shared D1 `feeds` table and no per-tenant feed config is created

#### Scenario: A non-public feed URL is rejected at write

- **WHEN** `update_feeds` is called with a feed `url` whose scheme is not `http(s)`, that carries userinfo, or whose host is a private/loopback/link-local literal
- **THEN** the tool returns `validation_failed` and no feed row is written
