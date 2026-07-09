## MODIFIED Requirements

### Requirement: Pending-proposals queue with member confirmation

Reconcile output SHALL land in a per-member **pending-proposals queue** (a D1 table), each proposal carrying a kind, payload, a human-readable rationale, the evidence signals, and a status. A member SHALL confirm proposals from **either surface** (a chat tool or the web app): **accept** applies the proposal's kind-specific effect; **reject** records the rejection as itself a revealed signal (so the same proposal is not re-surfaced). The queue's **producer SHALL be pluggable** — the consumer path (surface + confirmation) SHALL be identical regardless of which synthesis tier produced the proposal.

For the profile kinds (`add_vibe`, `adjust_cadence`, `prune_vibe`) the payload is the proposed profile diff and accept SHALL apply it to the member's profile/palette. The queue SHALL also carry **corpus-curation kinds** addressed to the **operator tenant** — `merge_recipes` (the `recipe-dedup` capability) — whose payload is review evidence rather than a diff: accepting one SHALL record the decision **without applying any profile or corpus write** (the curation act itself is agent-guided through the corpus write tools), while reject SHALL suppress the proposal permanently exactly as for profile kinds. A corpus-curation proposal SHALL only ever be enqueued for the operator tenant, never a member's queue.

#### Scenario: Accepting applies the diff

- **WHEN** a profile-kind proposal is accepted
- **THEN** its diff is applied to the member's profile/palette and the proposal is marked accepted

#### Scenario: Rejecting is itself a signal

- **WHEN** a proposal is rejected
- **THEN** it is recorded as a rejection signal and is not re-proposed on the next reconcile

#### Scenario: Both surfaces see one queue

- **WHEN** either the web app or the chat surface reads the queue
- **THEN** it sees the same pending proposals irrespective of which tier produced them

#### Scenario: Accepting a corpus-curation proposal applies no diff

- **WHEN** the operator accepts a `merge_recipes` proposal
- **THEN** the proposal is marked accepted and the apply path writes nothing to any profile or the corpus — the merge itself was performed through the agent-guided flow before confirmation
