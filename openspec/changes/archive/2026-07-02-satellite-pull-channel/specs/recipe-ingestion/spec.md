## MODIFIED Requirements

### Requirement: Ingest keys are minted once, stored hashed, and revocable

The Worker SHALL support minting an ingest key bound to a satellite **label** (one key per machine): minting SHALL return the full secret **exactly once** and SHALL persist only a **hash** of the secret plus a short non-secret **prefix** (for display), the label, and the created timestamp — never the plaintext secret. Revoking a key SHALL take effect immediately (the next push or pull-channel request with that key is rejected `401`). The stored roster SHALL surface, per key: label, prefix, created, `last_used`, status (`active` | `revoked`), the last-reported satellite/contract version and per-source push activity used by the admin views, and the key's **tenant binding** (below).

Minting SHALL accept an **optional tenant binding**. A key minted with **no** binding is **operator-global** (the default; every existing key is operator-global, unaffected by this addition) and authenticates the recipe-scrape push path exactly as before. A key minted **bound to a tenant** carries that tenant on the stored row (an additive, nullable `tenant` column on `ingest_keys`; existing rows read as operator-global). The bound tenant SHALL be resolved against the operator allowlist at mint time; a binding to a non-allowlisted tenant SHALL be rejected and mint nothing. The binding SHALL be **immutable** for the key's life (re-mint to change it). The binding governs the pull channel's auth scope (see the `satellite-pull-channel` capability): an operator-global key may claim only operator-scope work; a tenant-bound key may additionally claim its own tenant's tenant-scope work. The binding SHALL NOT change the recipe-scrape push behavior, which remains operator-global regardless of binding.

#### Scenario: Minting reveals the secret once and stores only a hash

- **WHEN** the operator mints an ingest key for a label
- **THEN** the response carries the full secret once, and the stored row holds only the hash + prefix + label + created (no plaintext)

#### Scenario: Revocation is immediate

- **WHEN** the operator revokes a key and a satellite subsequently pushes or claims with that key
- **THEN** the request is rejected `401` and nothing is persisted or claimed

#### Scenario: A key minted without a binding is operator-global

- **WHEN** the operator mints an ingest key with no tenant binding
- **THEN** the key is stored operator-global (tenant unset) and authenticates the recipe-scrape push path unchanged

#### Scenario: A key minted bound to a tenant carries the binding

- **WHEN** the operator mints an ingest key bound to allowlisted tenant `casey`
- **THEN** the stored row carries `casey` as its tenant binding, and the key may claim `casey`'s tenant-scope pull-channel work (and operator-scope work)

#### Scenario: Binding to a non-allowlisted tenant is rejected

- **WHEN** the operator attempts to mint a key bound to a tenant not on the allowlist
- **THEN** the mint is rejected and no key is created
