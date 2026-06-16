## ADDED Requirements

### Requirement: Discovery feeds are writable via update_feeds

The system SHALL provide an `update_feeds` tool that adds RSS/Atom discovery feeds to the **shared** `feeds.toml` at the data-repo root — written through the shared GitHub client, not a per-tenant `users/<id>/` path — so a member can wire up discovery sources during onboarding without hand-editing the data repo. It SHALL be **add-only with dedup by canonicalized feed `url`** (existing feeds untouched), mirroring the add-only `update_discovery_sources`, and SHALL accept per feed a required `url` and optional `name`, `weight` (default 1), and `tags`. It SHALL return `{ added, commit_sha }` and SHALL make no commit when no new feed is added. Because feeds are a shared, top-level concern, any member trusted with the MCP MAY widen the group feed set, consistent with `update_discovery_sources`.

#### Scenario: New feed is added to the shared feeds.toml

- **WHEN** `update_feeds` is called with a feed `url` not already present
- **THEN** the feed is appended to the data-repo-root `feeds.toml` via the shared client, and the tool returns `{ added, commit_sha }`

#### Scenario: Duplicate feed is a no-op

- **WHEN** `update_feeds` is called with a `url` that canonicalizes to one already in `feeds.toml`
- **THEN** no duplicate is written, no commit is made, and the result reports nothing added

#### Scenario: Feed write targets the shared root, not a tenant subtree

- **WHEN** any member calls `update_feeds`
- **THEN** the write targets the shared `feeds.toml` at the data-repo root and no `users/<id>/feeds.toml` is created
