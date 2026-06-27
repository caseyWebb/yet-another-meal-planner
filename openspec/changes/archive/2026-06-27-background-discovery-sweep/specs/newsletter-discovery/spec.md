## REMOVED Requirements

### Requirement: read_discovery_inbox returns inbox emails for LLM parsing

**Reason**: The discovery inbox is no longer read by the agent at plan time. The background discovery sweep drains the `discovery_candidates` table itself — scanning each body for recipe links/inline recipes, classifying, taste-matching, and auto-importing (see the `discovery-sweep` capability). `read_discovery_inbox` is retired from the agent tool surface.

**Migration**: The `email()` handler and the `discovery_candidates` table are unchanged — emails are still received, gated, captured, deduped, and pruned exactly as before; only the consumer changes from `read_discovery_inbox` to the sweep. The agent sees imported results via the new-for-me read at plan time.

## MODIFIED Requirements

### Requirement: Email bodies are appended to a shared discoveries inbox

Accepted emails SHALL be inserted into the shared D1 `discovery_candidates` table (not a per-tenant file). Each inbox record SHALL carry `from` (stored as `source`), `subject`, `received_at` (stored as `discovered_at`), and `body` (the captured plain-text body). The table is the background discovery sweep's **push intake** — written by the `email()` handler, drained by the sweep — not an agent-read inbox.

#### Scenario: Accepted message lands as an inbox record

- **WHEN** the handler accepts a message
- **THEN** a record with `source`, `subject`, `discovered_at`, and `body` is inserted into the D1 `discovery_candidates` table

#### Scenario: The sweep is the consumer of the inbox

- **WHEN** the background discovery sweep runs and the `discovery_candidates` table has rows
- **THEN** the sweep reads those rows as candidates for classification/matching/import, and no agent tool reads the inbox

### Requirement: Walled sources degrade to manual paste at import time

Discovery via email is unblockable at the inbox, but auto-import still hits bot walls / paywalls on linked pages. The sweep SHALL import from an email whose **body carries the recipe inline** (classifying directly from the captured body, no page fetch). When a candidate is reachable only behind a wall (a link whose page the sweep cannot fetch and no inline recipe), the sweep SHALL NOT fabricate a fetch and SHALL NOT auto-import it — it has no member to prompt for a paste. The user-initiated manual import path (`parse_recipe`/`create_recipe`, with its paste fallback for a URL the member hands the agent) is unchanged and remains the way a walled link-only recipe is brought in.

#### Scenario: Inline-recipe email is auto-imported

- **WHEN** an accepted email's body contains the full recipe text
- **THEN** the sweep classifies and imports it from the body without fetching any page

#### Scenario: Walled link-only candidate is not auto-imported

- **WHEN** a candidate is reachable only behind a bot wall/paywall and carries no inline recipe
- **THEN** the sweep does not auto-import it (no member is present to paste); the member may still import it via the manual `create_recipe` paste path
