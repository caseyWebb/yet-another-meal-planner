## MODIFIED Requirements

### Requirement: The order UI renders dispositions and honest partial results

The grocery route SHALL launch the shared Order Review component/controller over a fresh empty-stage preview. The review SHALL render the mock's hierarchy: Kroger/store heading; Going to cart, transient Estimated total, and positive Flyer savings tiles; the stale-cart explanation and required “I've cleared the old Kroger cart” acknowledgement; matched lines; decision cards; and a sticky send summary. A line SHALL offer a quantity stepper only when quantity was assumed, a fixed quantity chip when user-specified, Skip/Add back, same-identity alternatives, and at most one featured staged swap. Decision cards SHALL expose same-identity brand choice and narrow Save preferred brand, or unavailable recovery through broader/manual catalog search with divergence and fulfillment notes. Undecided lines SHALL remain left off.

Every skip, quantity, candidate, broader/manual selection, Undo, and impulse addition SHALL remain local stage until final send; closing/reopening SHALL discard it and call a fresh preview. Saving a brand SHALL perform the narrow persistent write immediately. Final send SHALL require the current fingerprint and cleared-cart gate and SHALL never be offline-queued. A changed review SHALL replace the visible preview and require reconfirmation.

The confirmed screen SHALL appear only for `cart.written:true` and SHALL report independently: items sent to Kroger (not purchased), moved to In cart, exact learned mappings, authoritative saved brands, left-off lines that stayed to-buy, and the persisted send-record total/savings when available. Cart failure SHALL remain a review/error state and expose re-link on `reauth_required`. The only post-send navigation SHALL be **Back to grocery**; there SHALL be no Back to review. Reopening starts from current to-buy, whose sent rows are already excluded.

#### Scenario: Assumed and specified quantities render differently
- **WHEN** one preview line has assumed quantity and another has a user-specified package count
- **THEN** only the assumed line has a stepper and the specified line renders a fixed quantity chip

#### Scenario: Brand save is narrow and immediate
- **WHEN** a member chooses a same-identity candidate and enables Save preferred brand
- **THEN** the app calls the family-scoped save operation, adopts its authoritative result, and leaves all other review choices staged

#### Scenario: Unavailable line can be recovered without silent substitution
- **WHEN** broader or manual search returns candidates for an unavailable line
- **THEN** the app shows divergence/modality facts, requires an explicit selection, and leaves an unresolved line off the send

#### Scenario: Changed preview requires another confirmation
- **WHEN** final send returns `review_changed`
- **THEN** the app renders the refreshed preview/divergences, performs no success navigation, and requires the member to press Send again

#### Scenario: Failed cart is never confirmed
- **WHEN** commit returns `cart.written:false` with `reauth_required`
- **THEN** the app does not claim items moved or learned, keeps them to-buy, and offers Kroger re-link

#### Scenario: Sent review cannot be replayed
- **WHEN** a successful confirmation is closed with Back to grocery and Order review is opened again
- **THEN** a fresh empty-stage preview is fetched and the prior sent/staged set cannot be sent again from retained UI state

### Requirement: Grocery-power UI coverage runs without Kroger credentials

The app Playwright suite SHALL cover the shared Grocery and Order Review surfaces without Kroger credentials. Order Review SHALL use endpoint fixtures typed against the shared contracts for native-tier matched lines, assumed/specified quantity, stale-cart gate, choose-one/save, broader/manual recovery, impulse staging, preview divergence, honest cart/cache/send partial failures, and successful persisted-result confirmation. No product code SHALL add test-only Kroger behavior; matcher/order injected dependencies remain the unit seam.

#### Scenario: Review interactions use typed fixtures
- **WHEN** the app suite exercises review, search, save, changed-preview, failure, and success flows
- **THEN** requests and responses conform to the shared contracts and no external Kroger call occurs

#### Scenario: Visual coverage captures review and confirmation
- **WHEN** the Order Review Playwright scenarios run
- **THEN** reviewed screenshots cover the primary review, decision recovery, and honest confirmation states in the shared component
