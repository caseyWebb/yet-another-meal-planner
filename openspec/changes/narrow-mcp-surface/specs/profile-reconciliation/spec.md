# profile-reconciliation — delta

## MODIFIED Requirements

### Requirement: Pending-proposals queue with member confirmation

Reconcile output SHALL land in a per-member **pending-proposals queue** (a D1 table), each proposal carrying a kind, payload (the proposed profile diff), a human-readable rationale, the evidence signals, and a status. A member SHALL confirm proposals from the **member web app's reconciliation queue**: **accept** applies the diff to profile config; **reject** records the rejection as itself a revealed signal (so the same proposal is not re-surfaced). The `list_proposals` / `confirm_proposal` MCP tools SHALL register on the **operator plane only** (`mcp-tool-gating`) — the operator's chat keeps them for reviewing corpus-curation `merge_recipes` proposals until an admin merge-review screen exists; a member connector does not see them. The queue's **producer SHALL be pluggable** — the consumer path (surface + confirmation) SHALL be identical regardless of which synthesis tier produced the proposal. In addition to the member-resolved statuses, a proposal MAY be resolved as **`superseded`** — a system resolution set only by the derivation convergence sweep, and only on `pending` rows, when the proposal is a near-duplicate of a palette vibe, of a rejected proposal, or of an earlier pending representative. Superseded proposals SHALL be excluded from member-facing pending reads, SHALL answer a confirm attempt with the same structured conflict as any already-resolved proposal, and SHALL be distinct from `rejected`: a member dismissal is a revealed signal only the member can produce, and no system pass may set or alter it.

#### Scenario: Accepting applies the diff

- **WHEN** a proposal is accepted from the member app's queue
- **THEN** its diff is applied to the member's profile/palette and the proposal is marked accepted

#### Scenario: Rejecting is itself a signal

- **WHEN** a proposal is rejected
- **THEN** it is recorded as a rejection signal and is not re-proposed on the next reconcile

#### Scenario: The operator chat keeps merge review

- **WHEN** the operator's MCP session lists proposals
- **THEN** `list_proposals` / `confirm_proposal` are available (including `merge_recipes` review), while a member connector's tool list carries neither

#### Scenario: A superseded proposal leaves the member surfaces

- **WHEN** the convergence sweep marks a pending proposal superseded
- **THEN** it no longer appears in the web app's queue (or the operator's `list_proposals`), and a confirm against its id answers a structured conflict naming its status
