# storage-guidance — delta

## MODIFIED Requirements

### Requirement: Read-only access tools, no write path

The system SHALL expose `guidance/ingredient_storage/` through the unified guidance read tool `read_guidance` (defined by the `cooking-techniques` capability): `read_guidance("ingredient_storage")` with no `slugs` lists the class slugs each with an optional one-line description, and `read_guidance("ingredient_storage", slugs)` returns the named entries' content. The storage corpus SHALL be read-only from the agent surface **because no agent guidance write path exists at all** — guidance content is operator-curated via the admin surface — so a member session can never alter ingredient-storage content by construction, with no allowlist needed.

#### Scenario: List then read on demand

- **WHEN** the agent calls `read_guidance("ingredient_storage")` and then `read_guidance("ingredient_storage", ["tender-herbs", "_ethylene"])`
- **THEN** the first call returns class slugs (with descriptions) and the second returns the content of exactly the named entries

#### Scenario: No agent write path exists

- **WHEN** the member MCP tool surface is enumerated
- **THEN** no guidance write tool appears in any domain, and the storage corpus is mutable only through operator curation
