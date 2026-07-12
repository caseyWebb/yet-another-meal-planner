## ADDED Requirements

### Requirement: Checked state is orthogonal, versioned, and canonical-keyed

Each `grocery_list` row SHALL add nullable ISO `checked_at`, integer `row_version`, and `updated_at`. Every operation that changes any field on a grocery row SHALL advance its `row_version` and `updated_at`. `checked_at` SHALL be orthogonal to `status`; checking or unchecking SHALL NOT write `in_cart`, `ordered`, `ordered_at`, or `sent_in`. The shared checked operation SHALL address the canonical row key, accept the desired boolean plus the rendered `expected_row_version` and aggregate `snapshot_version`, and update only check/concurrency fields on an existing row.

#### Scenario: Checking does not change cart status
- **WHEN** an active row is checked
- **THEN** `checked_at` is stamped and its row version advances while `status` remains `active` and `sent_in` remains unchanged

#### Scenario: Repeated desired state is idempotent
- **WHEN** the same checked=true request is delivered more than once
- **THEN** the row remains checked and every delivery reports success without creating another row or cart transition

#### Scenario: A note edit invalidates an older check guard
- **WHEN** a row's note changes after the caller rendered its row version
- **THEN** the note write advances the version and an opposing stale checked-state write cannot overwrite it silently

#### Scenario: Opposing stale state conflicts
- **WHEN** a stale uncheck targets a row that another member changed after the caller's `expected_row_version`
- **THEN** the Worker does not overwrite the newer value and returns `conflict` with a fresh snapshot

### Requirement: Checking a virtual plan line atomically materializes it

When checked=true targets an origin-plan line with no stored row, the checked operation SHALL atomically materialize a `source:"menu"` row under that exact canonical key with its human display, kind/domain, derived recipe attribution and quantity provenance, and stamp `checked_at`. Unchecking a virtual line with no row SHALL be an idempotent no-op. A materialized checked row SHALL remain after its originating recipe leaves the plan until unchecked, swept by shop completion, or explicitly removed.

#### Scenario: Virtual line is durable across devices
- **WHEN** a member checks a virtual plan need
- **THEN** one canonical stored row exists with `source:"menu"` and `checked_at`, and another member's next read sees the same checked line

#### Scenario: Atomic write cannot strand an unchecked pin
- **WHEN** virtual materialization/check fails
- **THEN** neither the new row nor the check is committed

### Requirement: Derived to-buy algebra subtracts checked rows

The shared algebra SHALL compute `shopping = (active stored rows UNION plan needs) MINUS pantry coverage MINUS active substitution suppressions`, then partition it into `to_buy` where `checked_at` is null and `checked` where it is non-null. The Grocery snapshot SHALL render both partitions as one shopping list; `read_to_buy`, order preview, `place_order`, and sidebar count SHALL use only `to_buy`. Check marks SHALL be swept only by the future manual-shop/walk shop-commit operation, never by an online order flush or satellite advance.

#### Scenario: Checked plan need cannot be ordered
- **WHEN** a plan-derived line is checked and the to-buy view and order preview are read
- **THEN** it appears under checked/shopping state but not in `to_buy` or the order preview

#### Scenario: Uncheck restores buy intent
- **WHEN** that row is unchecked while still active and not pantry-covered
- **THEN** the next derived view includes it in `to_buy`

#### Scenario: Online sends leave other checks alone
- **WHEN** `place_order` advances unchecked to-buy lines to `in_cart`
- **THEN** unrelated checked rows remain active and checked

### Requirement: Grocery snapshots expose row and aggregate freshness

Raw stored-row reads SHALL return `checked_at`, `row_version`, and `updated_at`. The shared grocery snapshot and `read_to_buy` SHALL return an opaque `snapshot_version` derived from the canonical state they render. Every shared grocery mutation SHALL return the authoritative post-write snapshot; a request whose aggregate version is stale SHALL either perform only the explicitly specified safe row merge or return a structured conflict without a partial write.

#### Scenario: Mutation returns post-write truth
- **WHEN** a checked, pantry, substitution, relist, or mark-placed mutation succeeds
- **THEN** its response includes the complete current snapshot and its new `snapshot_version`

### Requirement: Accepted grocery substitutions persist independently of host state

The system SHALL persist an accepted cross-ingredient substitution keyed by tenant and original canonical key, carrying the replacement key, the original stable recipe-attribution signature, concurrency metadata, and whether the operation created the replacement row. Accept SHALL atomically materialize/upsert the replacement and suppress the original from shopping/to-buy; Undo SHALL remove suppression and SHALL remove the replacement only if it was created by that decision and has not since been independently edited. A changed recipe-attribution signature SHALL invalidate suppression. Keep original and section collapse SHALL remain pure view state.

#### Scenario: Virtual substitution survives widget reopen
- **WHEN** a member swaps a replacement for a virtual plan line and later reopens the widget
- **THEN** boot re-hydration shows the replacement and continues to suppress the original from to-buy

#### Scenario: Undo preserves independently edited replacement
- **WHEN** a replacement created by a substitution is subsequently edited and the member undoes the substitution
- **THEN** the original returns but the edited replacement is not deleted

### Requirement: Pantry buy-anyway overrides coverage explicitly

The pantry freshness classifier SHALL use one shared category threshold table consumed internally by `read_to_buy` and the Grocery snapshot. The public `read_pantry(stale_only)` contract remains structured `unsupported`, because its broader freshness claim requires conversational storage/open-package/inspection context. A Grocery covered line SHALL carry `covered` or `worth_a_look`. Still good SHALL use the shared pantry-verify write. Buy anyway SHALL atomically materialize the canonical line as `source:"pantry_low"` and persist a coverage override so pantry subtraction does not immediately hide it; Undo SHALL clear the override and safely remove only an untouched row created by the decision.

#### Scenario: Still good refreshes all consumers
- **WHEN** a worth-a-look pantry line is marked Still good
- **THEN** its verification date updates and the shared classifier removes the stale nudge from grocery and pantry reads

#### Scenario: Buy anyway appears in to-buy
- **WHEN** a covered ingredient is promoted with Buy anyway
- **THEN** it appears in `to_buy` as a pantry-low explicit row despite the pantry entry
