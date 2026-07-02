## MODIFIED Requirements

### Requirement: Config area hosts an Ingest Keys editor

The admin **Config** area SHALL host an **Ingest Keys** editor (an island that mutates via `/admin/api/*`) for managing the home-network satellite ingest keys (`recipe-ingestion`). It SHALL list keys in a table — satellite label + key prefix, the key's **tenant binding** (a muted "operator-global" when unbound, else the bound member id), configured/observed sources, created, last-used (a muted "never" when unused), and status (`active`/`revoked`) — and provide a **Mint key** action that takes a label and an **optional tenant binding** and reveals the new secret **once** in a callout with a copy control and a "shown once — you won't see it again" warning, mirroring the invite-code flow (the row persists showing only the prefix; the secret is not stored). The Mint action's tenant-binding control SHALL default to **operator-global** (no binding) and SHALL offer the allowlisted members as bind targets; a binding SHALL be validated against the allowlist server-side (a non-allowlisted target mints nothing). Each active key SHALL have a **Revoke** action behind a destructive confirm. An empty roster SHALL render an explanatory empty state.

#### Scenario: Minting reveals the secret once

- **WHEN** the operator mints an ingest key with a label
- **THEN** the editor shows the full secret once in a copyable callout with a shown-once warning, and thereafter the row shows only the prefix

#### Scenario: Minting an operator-global key by default

- **WHEN** the operator mints an ingest key without choosing a tenant binding
- **THEN** the key is minted operator-global and the row shows a muted "operator-global" binding

#### Scenario: Minting a tenant-bound key

- **WHEN** the operator mints an ingest key and selects an allowlisted member as the binding
- **THEN** the key is minted bound to that member and the row shows that member as its tenant binding

#### Scenario: Revoke is confirmed and immediate

- **WHEN** the operator revokes a key and confirms the destructive dialog
- **THEN** the key's status becomes `revoked` and it can no longer authenticate a push or a pull-channel request

#### Scenario: Empty roster shows guidance

- **WHEN** no ingest keys exist
- **THEN** the editor shows an empty state explaining what a satellite is and how to mint the first key
