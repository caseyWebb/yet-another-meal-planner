# satellite-source-audit — delta

## ADDED Requirements

### Requirement: The rejection ledger and quarantine state are readable by the operator

The rejection ledger and the current quarantine state SHALL be readable from the **operator admin surface** — the recent rejections (`kind`, `source`, `origin`, `reason`, `provenance`, `count`, `rejected_at`) and the currently quarantined sources, bounded and most-recent-first. The read SHALL reflect only **rejected** observations — an accepted observation SHALL never appear — so the operator can explain why a satellite's contributions are not landing and relay the specific defect. The visibility rule is unchanged: recipe and sale rejections/quarantines are operator-global, while `order`-kind rows remain private to their member and are surfaced only to that member's surfaces, never listed to another member.

#### Scenario: The operator diagnoses why contributions are not landing

- **WHEN** a member reports that recipes (or sales) from their satellite are not showing up
- **THEN** the operator reads the ledger in the admin surface and relays the specific per-source defect (e.g. "that source had 12 `contract_invalid` rejects in the last day — its adapter likely broke"), rather than guessing

#### Scenario: Accepted observations never appear

- **WHEN** a satellite's recent observations all validated cleanly
- **THEN** the ledger shows no entries for it — an empty rejection list means everything landed

## REMOVED Requirements

### Requirement: The rejection ledger and quarantine state are readable by the agent

**Reason**: Satellite health diagnosis is operator work; the agent-facing `read_satellite_rejections` tool leaves the member surface in the cull (as does `read_reconcile_errors`, the precedent it was modeled on). The ledger, quarantine mechanics, and per-member privacy of `order`-kind rows are unchanged.
**Migration**: The operator admin surface reads the same ledger (this delta's ADDED requirement). Hard removal, no dispatch alias.
