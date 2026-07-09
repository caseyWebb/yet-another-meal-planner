## MODIFIED Requirements

### Requirement: Reconciliation queue with member confirmation

The app SHALL render the member's pending reconciliation proposals and resolve them through the
same confirm semantics as `confirm_proposal`: accept applies the proposal's diff and records
`accepted`; dismiss records `rejected` and the proposal never re-surfaces. Actions SHALL be
kind-specific (`add_vibe`, `adjust_cadence`, `prune_vibe`, `merge_recipes`) — no synthetic
actions without a backing operation. A `merge_recipes` proposal (corpus curation, present only
in the operator's own queue) SHALL render its pair honestly — a title naming both recipes from
the payload, the rationale, and a note that the merge itself is performed with the agent in
chat — and SHALL offer **Dismiss only** (backed by confirm-reject): the app has no merge
operation, so it SHALL NOT render an accept/merge button for this kind. Confirming an
already-resolved proposal SHALL return a structured conflict and change nothing. The queue
SHALL render large backlogs sanely (production shows dozens of pending proposals).

#### Scenario: Accepting an add_vibe proposal updates the palette

- **WHEN** a member accepts a pending `add_vibe` proposal
- **THEN** the vibe is upserted into the palette, the proposal is recorded `accepted`, and it
  leaves the queue permanently

#### Scenario: Dismissal is durable

- **WHEN** a member dismisses a proposal
- **THEN** it is recorded `rejected` and is never re-enqueued or re-surfaced (stable id
  idempotency)

#### Scenario: A merge_recipes proposal renders without a synthetic accept

- **WHEN** the operator's queue contains a pending `merge_recipes` proposal
- **THEN** the row names both recipes and shows the rationale, points the merge itself at the
  chat surface, and offers only Dismiss — no accept/merge button is rendered for it
