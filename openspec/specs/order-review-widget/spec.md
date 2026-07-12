# order-review-widget Specification

## Purpose
TBD - created by archiving change order-review-rework. Update Purpose after archive.
## Requirements
### Requirement: OrderReviewData is a versioned stateless preview

The system SHALL define independently versioned `OrderReviewData`, `OrderReviewStage`, search, model-context, brand-save receipt, and outcome contracts in `@yamp/contract`. The shared preview operation, member endpoint, `display_order_review`, and MCP boot read SHALL use the same operation. The preview SHALL contain current grocery/store/stale-cart facts, matched and decision lines, quote facts, left-offs/underived data, transient totals, `grocery_snapshot_version`, and opaque `preview_fingerprint`. The stage SHALL be plain JSON and SHALL carry choices but no trusted prices or credentials. A spawning payload SHALL be render-only and no final send SHALL trust it as current.

#### Scenario: Member and MCP empty-stage previews agree
- **WHEN** both hosts preview the same household without intervening state or external-result changes
- **THEN** they receive equivalent review facts and the same preview fingerprint from the shared operation

#### Scenario: Preview/search writes nothing
- **WHEN** review is previewed, re-previewed, broadened, or manually searched
- **THEN** no grocery, preference, cache, send, spend, or cart state changes

### Requirement: One plumbing-agnostic Order Review component serves both hosts

`@yamp/ui` SHALL own one Order Review controller/component and selectors, extending shared Grocery line/quote/capability seams. It SHALL accept `OrderReviewData` and an `OrderReviewHostAdapter` and SHALL NOT import TanStack Query, Hono, or ext-apps plumbing. The member modal and MCP widget SHALL mount it with thin adapters; shared behavior SHALL be tested once at controller/component level plus adapter-specific transport tests.

#### Scenario: Both capable hosts render the same review behavior
- **WHEN** identical preview data is mounted with fully capable member and MCP adapters
- **THEN** both expose the same matched lines, assumed quantities, skip/options/swaps, decisions, broader/manual recovery, save-brand control, gate, totals, and send result presentation

### Requirement: Staged review interactions remain local but model-visible

Skip/Add back, assumed-quantity changes, product choices, broader/manual selections, Undo, cleared-cart acknowledgement, and impulse additions SHALL mutate only the controller's complete local stage until final send. In MCP, every such interaction SHALL immediately publish the FULL current `OrderReviewModelContext` containing preview, complete stage, save receipts and action summary via `ui/update-model-context`, never an event delta and never debounced; it SHALL not call a write tool or send `ui/message`. Preview/search bridge reads MAY refresh server facts before that publication.

#### Scenario: Quantity stage updates full model context without writing
- **WHEN** an MCP member changes one assumed quantity
- **THEN** D1/cart remain unchanged and the widget immediately publishes the complete current review/stage, including every other line and disposition, without a message

#### Scenario: Reopening discards the stage
- **WHEN** either host closes and later reopens Order Review
- **THEN** it performs a fresh empty-stage preview and none of the prior local choices reappear as persistent state

### Requirement: Persistent interactions follow D18

Save preferred brand SHALL call the app-callable narrow family write, adopt its authoritative response, and immediately publish full current model context without a model turn. Final send SHALL call app-callable `place_order`, adopt the authoritative discriminated result/current preview, immediately publish the full outcome context, and send exactly one `ui/message` only when a model turn is warranted at that send boundary. Resolved `isError`, conflict, `review_changed`, and failed-send results SHALL never be announced as success.

#### Scenario: Save brand writes and mirrors without message
- **WHEN** the save switch succeeds in MCP
- **THEN** the widget calls the narrow write under the member grant, adopts the returned family/preview, and publishes full context without `ui/message`

#### Scenario: Successful send writes, mirrors, and announces
- **WHEN** final send returns `sent`
- **THEN** the widget publishes the full authoritative outcome and then sends one completion message naming carted and left-off lines

#### Scenario: Changed review is not success
- **WHEN** final send returns `review_changed`
- **THEN** the widget adopts/publishes the refreshed review, sends no success message, and requires explicit reconfirmation

### Requirement: D19 boot re-preview gates writes

The MCP adapter SHALL render frozen spawning structured content for first paint, check the contract floor/ceiling, probe host capabilities, and call the app-callable empty-stage preview at boot before enabling search, save, or send. A failed boot read, unknown-newer contract, or missing server-tool plus model-context support SHALL remain read-only. A sendMessage-only host SHALL offer explicit delegation for the complete requested action; a host with neither SHALL retain text fallback. Payloads SHALL contain no token, cookie, session id, signed URL, or other authentication material.

#### Scenario: Cached conversation re-previews before interaction
- **WHEN** a cached Order Review card reopens from its original structured content
- **THEN** it may paint the old card but disables controls until current empty-stage preview succeeds

#### Scenario: Unknown-newer contract degrades safely
- **WHEN** the payload version exceeds the widget ceiling
- **THEN** readable review facts render with all persistent/staged controls disabled and no bridge write

### Requirement: display_order_review serves a self-contained MCP App

The Worker SHALL expose `display_order_review()` returning `_meta.ui.resourceUri = "ui://order/review"`, conforming `structuredContent`, and equivalent plain-text content. `resources/read` SHALL serve a marked self-contained CSP-compatible widget bundle. App-callable tools SHALL expose boot re-preview, broader/manual search, narrow brand save, and final `place_order` over the same shared operations. The resource SHALL require no Worker-owned HTTP route or `run_worker_first` entry.

#### Scenario: Widget and text facts agree
- **WHEN** `display_order_review` succeeds in an MCP Apps host
- **THEN** the visible review facts match the plain-text fallback and the host mounts `ui://order/review`

#### Scenario: Resource is not the member SPA
- **WHEN** `resources/read` requests the order review URI
- **THEN** it returns the marked self-contained widget HTML rather than an SPA fallback

### Requirement: Narrow preferred-brand save preserves the family ladder

The app-callable brand-save operation SHALL accept only a server-issued same-identity family key/selected brand plus expected family fingerprint. Atomically, it SHALL remove case-insensitive duplicates of that brand from lower tiers, append it to the existing first tier or create `[[brand]]`, set `any_brand:false`, and preserve first-tier peers, remaining lower tiers, every other family, and unrelated profile fields. An identical desired state SHALL merge idempotently; a stale differing family SHALL conflict with current family state. Broader/manual candidates SHALL not expose this write.

#### Scenario: Selected brand joins existing tier 1
- **WHEN** tiers are `[["A"],["B","C"]]` with any-brand true and the member saves C
- **THEN** the family becomes `[["A","C"],["B"]]` with any-brand false and every other family is unchanged

#### Scenario: New family is created narrowly
- **WHEN** no family exists and the member saves Brand A from a same-identity decision
- **THEN** exactly that family becomes `{tiers:[["Brand A"]], any_brand:false}`

#### Scenario: Stale family edit conflicts
- **WHEN** another host changes the family after the rendered fingerprint
- **THEN** a non-identical save writes nothing and returns the current family for refresh

### Requirement: Confirmation is honest and closes to Grocery

The shared confirmed state SHALL report independently the cart send, in-cart advance, persisted D16 summary, exact learned mappings, authoritative save receipts/verification, and left-off lines. It SHALL not say checkout completed. It SHALL expose only Back to grocery, clear stage on close, and latch send while in flight/after success. A failed cart SHALL not render confirmation.

#### Scenario: Confirmation names what did and did not happen
- **WHEN** nine lines are carted, two remain unresolved, one brand save succeeded, and two cache mappings changed
- **THEN** confirmation reports those exact facts separately and says the two left-off lines stayed to-buy

#### Scenario: Back to grocery cannot double-add
- **WHEN** the member leaves a successful confirmation and later launches review again
- **THEN** the controller has no old stage/result and the fresh derived preview excludes the send-linked in-cart lines
