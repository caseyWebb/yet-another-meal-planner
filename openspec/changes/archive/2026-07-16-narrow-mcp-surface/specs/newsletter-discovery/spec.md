# newsletter-discovery — delta

## MODIFIED Requirements

### Requirement: Walled sources degrade to manual paste at import time

Discovery via email is unblockable at the inbox, but auto-import still hits bot walls / paywalls on linked pages. The sweep SHALL import from an email whose **body carries the recipe inline** (classifying directly from the captured body, no page fetch). When a candidate is reachable only behind a wall (a link whose page the sweep cannot fetch and no inline recipe), the sweep SHALL NOT fabricate a fetch and SHALL NOT auto-import it — it has no member to prompt for a paste. The user-initiated manual import path — `import_recipe`, whose `text` form is the paste fallback for a URL the member hands the agent — remains the way a walled link-only recipe is brought in.

#### Scenario: Inline-recipe email is auto-imported

- **WHEN** an accepted email's body contains the full recipe text
- **THEN** the sweep classifies and imports it from the body without fetching any page

#### Scenario: Walled link-only candidate is not auto-imported

- **WHEN** a candidate is reachable only behind a bot wall/paywall and carries no inline recipe
- **THEN** the sweep does not auto-import it (no member is present to paste); the member may still import it via `import_recipe({ text })`

### Requirement: Discovery allowlist writes normalize and dedupe addresses

The Worker SHALL accept additions to the shared inbound-newsletter allowlist (the `discovery_senders` / `discovery_members` D1 tables) through the shared allowlist write operation, surfaced by the **operator admin Discovery/Config surface** — there is no member `update_discovery_sources` MCP tool. On write the operation SHALL normalize each address (trim + lowercase), drop any entry without an `@`, and dedupe against existing rows, leaving existing entries untouched and returning the count of newly added entries per kind.

#### Scenario: Addresses are normalized and deduped on write

- **WHEN** the admin surface adds `members`/`senders` entries, some duplicating existing rows and some lacking an `@`
- **THEN** each address is trimmed and lowercased, entries without an `@` are dropped, duplicates are ignored, and the write returns the count of newly added entries

#### Scenario: Allowlist widening has no member chat tool

- **WHEN** the member MCP tool surface is enumerated
- **THEN** no discovery-source allowlist tool appears; intake widening is an operator admin action
