## ADDED Requirements

### Requirement: GroceryListData is the authoritative dual-host snapshot

The system SHALL define independently versioned `GroceryListData` in `@yamp/contract`, carrying `contract_version`, opaque `snapshot_version`, `as_of`, the complete active/checked shopping lines, `to_buy` keys, pantry-covered lines and decisions, grouped in-cart sends and persisted send totals, underived recipes, location/flyer freshness, and header counts. `GET /api/grocery/view`, `display_grocery_list`, and the MCP boot read SHALL call the same shared snapshot operation. The spawning tool result SHALL be render-only; no persistent write SHALL trust it as current.

#### Scenario: Member and MCP reads agree
- **WHEN** the member endpoint and MCP boot read run for the same household without intervening writes
- **THEN** they return the same authoritative grocery state and `snapshot_version` from the shared operation

#### Scenario: A source-table change changes freshness
- **WHEN** a grocery row, plan need, pantry coverage/verification, substitution decision, or send membership changes
- **THEN** the canonical snapshot changes and so does its opaque `snapshot_version`

### Requirement: One plumbing-agnostic Grocery component serves both hosts

`@yamp/ui` SHALL own one Grocery component/controller and deterministic group selectors. It SHALL receive data and a `GroceryHostAdapter` through props and SHALL NOT import member-query, Hono, or ext-apps plumbing. The member grocery route and MCP widget SHALL mount that same component/controller with thin host adapters; behavior SHALL be covered once at the controller/component layer plus adapter-specific tests.

#### Scenario: Both hosts expose the same controls
- **WHEN** identical `GroceryListData` is mounted in the member and MCP hosts with full capabilities
- **THEN** both render the same Department/Recipe modes, row actions, pantry actions, substitution actions, and in-cart actions

### Requirement: The MCP Grocery widget follows D18 and D19

The MCP adapter SHALL render the spawning payload for first paint, check the grocery contract floor/ceiling, probe host capabilities, and re-hydrate via the app-callable snapshot read before enabling writes. Every persistent action SHALL call its deterministic Worker tool under the grant, replace local state with the returned authoritative snapshot, and immediately publish the FULL `GroceryModelContext` via `ui/update-model-context`, never an event delta and never debounced. The context outcome SHALL preserve the operation's returned outcome and classify the action accurately, rather than synthesizing success from the requested intent. Check/add/remove/pantry/swap/relist SHALL not request a model turn; successful Mark order placed SHALL additionally send one `ui/message` carrying that same actual outcome. A failed or resolved-`isError` tool call SHALL send neither success context nor a completion message.

#### Scenario: Boot re-hydrate gates mutations
- **WHEN** a cached widget opens from old structured content
- **THEN** it may paint that content but keeps mutations disabled until the bridge read returns the current snapshot

#### Scenario: A check publishes full current context
- **WHEN** a member checks a line in an interactive MCP widget
- **THEN** the widget calls the checked-state tool, adopts its returned snapshot, and immediately sends the complete current grocery context without sending a message

#### Scenario: Mark placed writes, mirrors, and announces
- **WHEN** Mark order placed succeeds for a send group
- **THEN** the widget performs the batch tool call, publishes the returned full snapshot and exact operation outcome, and then sends one completion message carrying that same placed-send outcome

#### Scenario: Replay reports the operation's completed outcome
- **WHEN** a completed whole-send assertion is replayed and the operation reports the prior completion without advancing rows
- **THEN** both model context and the completion message report that returned outcome rather than claiming a new placement

#### Scenario: Non-placement actions publish their exact outcomes
- **WHEN** add, remove, pantry, substitution, check, or relist succeeds with an operation-specific outcome
- **THEN** the full model context classifies that action correctly and carries the returned outcome without sending a completion message

#### Scenario: Failure is never announced as success
- **WHEN** a bridge tool resolves with `isError` or a structured conflict
- **THEN** the widget updates no success context, sends no completion message, and surfaces the current/conflict state

### Requirement: Capability and contract degradation is safe

An unknown-newer `contract_version`, failed boot read, or host without `serverTools` plus model-context support SHALL render the data-only card read-only. A sendMessage-only host SHALL offer explicit delegation for the requested action; a host with neither capability SHALL disable controls and retain the text fallback. Widget payloads SHALL contain no credential, session id, or signed URL.

#### Scenario: Unknown-newer payload degrades
- **WHEN** the widget receives a grocery payload above its supported contract ceiling
- **THEN** it renders readable list content with every persistent control disabled and does not crash

#### Scenario: Payload contains data only
- **WHEN** `display_grocery_list` returns structured content
- **THEN** it contains grocery display/state data but no authentication material

### Requirement: display_grocery_list serves a self-contained MCP App resource

The Worker SHALL expose `display_grocery_list()` returning `_meta.ui.resourceUri = "ui://grocery/list"`, `structuredContent` conforming to `GroceryListData`, and equivalent plain-text `content`. `resources/read` SHALL serve a self-contained CSP-compatible widget bundle with a marker that prevents SPA-fallback confusion. The `ui://` resource SHALL NOT add a Worker-owned HTTP route or `run_worker_first` entry.

#### Scenario: A capable host receives the widget
- **WHEN** `display_grocery_list` succeeds on a host that renders MCP Apps
- **THEN** the host mounts `ui://grocery/list` from the structured result and the visible facts match the plain-text fallback

#### Scenario: The resource is not an SPA shell
- **WHEN** MCP `resources/read` requests `ui://grocery/list`
- **THEN** it returns the marked self-contained Grocery widget HTML rather than the member SPA fallback

### Requirement: The shared layout is truthful and ordered

The shared Grocery component SHALL render compact `To buy`, `Checked`, and `In carts` header stats; Department/Recipe grouping; active and checked lines; add/underived content; one collapsible in-cart group per send between the list and pantry coverage; and the pantry/substitution sections. A send group SHALL show its store/date, read-only lines, persisted send estimated total, positive flyer savings, Mark order placed, and per-line Back to list. Sends older than 72 hours SHALL show a quiet awaiting-confirmation nudge. Unlinked `in_cart` rows SHALL show no persisted prices and no send-wide assertion. Pre-send flyer hints SHALL never be labeled as a persisted estimated total, and send prices SHALL be described as send-time quotes rather than final fulfillment prices.

#### Scenario: Two sends remain distinct
- **WHEN** two unplaced sends coexist
- **THEN** the component renders two oldest-first in-cart groups with each send's own membership, metadata, totals, and action

#### Scenario: Aging does not auto-count spend
- **WHEN** an unplaced send is older than 72 hours
- **THEN** it shows the awaiting-confirmation nudge but remains unplaced and contributes no materialized spend

#### Scenario: Quote sources are not mixed
- **WHEN** active lines have flyer hints and an in-cart send has a persisted snapshot
- **THEN** line hints are labeled current/pre-send while only the send group renders the persisted sent estimate and savings
