# newsletter-discovery Specification

## Purpose
TBD - created by archiving change add-newsletter-email-discovery. Update Purpose after archive.
## Requirements
### Requirement: Inbound email is received by a Worker email handler

The Worker SHALL expose an `email()` handler (alongside its existing `fetch` handler in the same Worker) that processes messages delivered by Cloudflare Email Routing for the configured newsletter address (`groceries-agent@<domain>`). The newsletter domain SHALL be a dedicated spare zone added to Cloudflare with Email Routing enabled — never the in-use ProtonMail zone — so enabling Routing's MX records breaks no live mail. The handler SHALL NOT poll a mailbox (no IMAP, no cron); intake is push-only.

#### Scenario: A delivered newsletter reaches the handler

- **WHEN** Cloudflare Email Routing delivers a message addressed to `groceries-agent@<domain>` to the Worker
- **THEN** the Worker's `email()` handler is invoked with that message and processes it without any scheduled trigger

### Requirement: Messages are authenticated and gated against the allowlist

The handler SHALL accept a message only when it is both authenticated and from an allowed source. The shared allowlist is a union of two entry kinds: trusted **senders** (newsletter `From` addresses) and trusted **members** (friend-group personal addresses). A message SHALL be accepted when any of the following holds:
- its `From` matches a trusted **sender** AND DKIM passes for that sender (auto-forward rule, original signature survived), or
- its `From` matches a trusted **member** AND DKIM aligns to that member's domain (manual forward, re-signed by the member's provider), or
- it is SPF-aligned to a known member's forwarding relay (auto-forward rule whose original DKIM broke in the hop).

A message that satisfies none of these SHALL NOT be written to the inbox. Instead of a silent drop, the handler SHALL reject it in-session (`setReject`, an SMTP 550) with a human-readable reason so the sender receives a bounce — a known-but-unaligned address (its `From` is allowlisted but DKIM did not align) SHALL get a detailed reason; an unknown sender SHALL get a terse one. (`setReject` is backscatter-safe: a synchronous SMTP rejection, not a new outbound email.) Authentication results SHALL be taken from Cloudflare's reported DKIM/SPF/DMARC verdicts, not inferred from header text.

#### Scenario: A failed message bounces with a reason instead of vanishing

- **WHEN** a message is not accepted by the gate (e.g. an allowlisted address whose DKIM did not align)
- **THEN** the handler rejects it in-session with a reason and writes nothing to the inbox, so the sender receives a bounce explaining why

#### Scenario: Auto-forwarded newsletter with surviving DKIM is accepted

- **WHEN** a message arrives with `From` equal to an allowlisted sender and a passing DKIM signature for that sender
- **THEN** the handler proceeds to capture its body

#### Scenario: Manually forwarded message from a trusted member is accepted

- **WHEN** a message arrives with `From` equal to an allowlisted member and DKIM aligned to that member's domain
- **THEN** the handler proceeds to capture its body

#### Scenario: Unallowlisted or unauthenticated mail is dropped

- **WHEN** a message's `From` is not in the allowlist and it is not SPF-aligned to a known member relay
- **THEN** the handler writes nothing and surfaces no error

### Requirement: Both forwarding forms are supported, including nested forward wrappers

The handler SHALL capture the body from both an auto-forwarded message (original newsletter body delivered ~intact) and a manually forwarded message (original body nested inside a forward wrapper). Body capture SHALL operate on whatever content survives in the message parts (text/plain preferred; HTML converted to readable text as fallback) and SHALL NOT fail when the original content is nested one or more wrapper levels deep.

#### Scenario: Manual forward wrapper does not defeat capture

- **WHEN** the handler processes a manually forwarded message whose original newsletter HTML is nested inside a forward wrapper
- **THEN** it still captures the body content from the nested message

### Requirement: Email body is captured as readable text for LLM parsing

The handler SHALL capture the email's body as plain text and store it for the agent to parse. The handler SHALL NOT attempt to extract, filter, or unwrap individual recipe URLs — that is the LLM's job at read time. When the message has a `text/plain` part, it SHALL be preferred; when only HTML is available, the handler SHALL convert it to readable plain text by expanding `<a href="URL">TEXT</a>` anchors to `TEXT (URL)` form (preserving URLs for the LLM to find) and stripping remaining markup. The stored body SHALL be truncated at a reasonable maximum (≤ 10,000 characters) so TOML storage stays manageable. This design lets the LLM see all recipes in an email (newsletters commonly feature multiple), rather than relying on heuristic URL filtering that tends to grab unsubscribe or social chrome links instead.

#### Scenario: Plain text part is used when available

- **WHEN** the message contains a `text/plain` part
- **THEN** the handler stores that content as the body (truncated if needed) without any HTML processing

#### Scenario: HTML-only message is converted to readable text

- **WHEN** the message has only an HTML part
- **THEN** the handler converts it to readable text, expanding anchor tags to include their destination URL, and stores the result

### Requirement: Email bodies are appended to a shared discoveries inbox

Accepted emails SHALL be inserted into the shared D1 `discovery_candidates` table (not a per-tenant file). Each inbox record SHALL carry `from` (stored as `source`), `subject`, `received_at` (stored as `discovered_at`), and `body` (the captured plain-text body). The table is the background discovery sweep's **push intake** — written by the `email()` handler, read by the sweep — not an agent-read inbox.

#### Scenario: Accepted message lands as an inbox record

- **WHEN** the handler accepts a message
- **THEN** a record with `source`, `subject`, `discovered_at`, and `body` is inserted into the D1 `discovery_candidates` table

#### Scenario: The sweep is the consumer of the inbox

- **WHEN** the background discovery sweep runs and the `discovery_candidates` table has rows
- **THEN** the sweep reads those rows as candidates for classification/matching/import, and no agent tool reads the inbox

### Requirement: Inbox writes dedup by message identity and prune old entries

At inbox write-time the handler SHALL skip a message whose `(source, subject, discovered_at)` triple matches an existing row — this catches exact re-deliveries without URL-level comparison. Before inserting, the handler SHALL also delete rows older than a configurable retention window (default: 30 days), so the table does not grow indefinitely. A message with an absent or empty `discovered_at` SHALL be retained (cannot be age-pruned).

#### Scenario: Same message forwarded twice is stored once

- **WHEN** two deliveries of the same message arrive (same from, subject, and date)
- **THEN** the second write is skipped and the entry appears exactly once in the inbox

#### Scenario: Old entries are pruned when a new message arrives

- **WHEN** the handler appends a new entry and existing entries are older than the retention window
- **THEN** the old entries are removed before writing

### Requirement: Senders are notified of auth failures only

The handler SHALL `setReject` (bounce) a message that the gate rejects. It SHALL NOT bounce an accepted message for any content-level reason (empty body, duplicate, etc.) — these are silent successes. A processing error SHALL also reject with a generic reason rather than being swallowed.

#### Scenario: Auth failure bounces; duplicate is silent

- **WHEN** an accepted message's `(from, subject, received_at)` is already in the inbox
- **THEN** the handler writes nothing new and does NOT reject (no bounce)

### Requirement: Walled sources degrade to manual paste at import time

Discovery via email is unblockable at the inbox, but auto-import still hits bot walls / paywalls on linked pages. The sweep SHALL import from an email whose **body carries the recipe inline** (classifying directly from the captured body, no page fetch). When a candidate is reachable only behind a wall (a link whose page the sweep cannot fetch and no inline recipe), the sweep SHALL NOT fabricate a fetch and SHALL NOT auto-import it — it has no member to prompt for a paste. The user-initiated manual import path (`parse_recipe`/`create_recipe`, with its paste fallback for a URL the member hands the agent) is unchanged and remains the way a walled link-only recipe is brought in.

#### Scenario: Inline-recipe email is auto-imported

- **WHEN** an accepted email's body contains the full recipe text
- **THEN** the sweep classifies and imports it from the body without fetching any page

#### Scenario: Walled link-only candidate is not auto-imported

- **WHEN** a candidate is reachable only behind a bot wall/paywall and carries no inline recipe
- **THEN** the sweep does not auto-import it (no member is present to paste); the member may still import it via the manual `create_recipe` paste path

### Requirement: Discovery allowlist writes normalize and dedupe addresses

The Worker SHALL accept additions to the shared inbound-newsletter allowlist (the `discovery_senders` / `discovery_members` D1 tables) through `update_discovery_sources`. On write it SHALL normalize each address (trim + lowercase), drop any entry without an `@`, and dedupe against existing rows, leaving existing entries untouched and returning the count of newly added entries per kind.

#### Scenario: Addresses are normalized and deduped on write

- **WHEN** `update_discovery_sources` adds `members`/`senders` entries, some duplicating existing rows and some lacking an `@`
- **THEN** each address is trimmed and lowercased, entries without an `@` are dropped, duplicates are ignored, and the tool returns the count of newly added entries

