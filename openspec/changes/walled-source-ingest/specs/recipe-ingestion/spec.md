## ADDED Requirements

### Requirement: Ingest endpoint accepts an authenticated batch of pre-parsed recipes

The Worker SHALL expose `POST /admin/api/ingest` accepting a JSON **batch envelope** from a home-network scraper: `{ source, scraper_version, contract_version, recipes: [...] }`, where `source` is the human-readable paid-source name the batch came from (required), `scraper_version` and `contract_version` are the machine's reported build and targeted recipe-contract version, and each `recipes[]` element is the **wire-contract recipe shape** — `{ title, ingredients: string[], instructions: string[], source }` (a canonical recipe URL) plus optional `summary`, `servings`, `time_total`, `time_active`. The endpoint SHALL validate the envelope and each item against the shared contract, and SHALL respond with a summary `{ received, accepted, deduped, rejected, results: [...] }` where each per-item result names its disposition (`accepted` | `deduped` | `rejected`) and, on rejection, a reason. The endpoint SHALL be batch-first (an array of items) and SHALL NOT run the classify/describe/embed/match pipeline synchronously — accepted items are persisted for the background sweep.

The endpoint SHALL reject a batch with a missing/blank `source` as `bad_key`-adjacent (`rejected`, reason names the missing source), and SHALL reject an individual item that fails the contract shape (e.g. missing `source` URL, empty `ingredients`/`instructions`) as `rejected` with the offending field, without failing the whole batch when other items are valid.

The batch envelope SHALL carry no more than a bounded number of items (`MAX_BATCH_ITEMS`, a shared-contract constant), because the endpoint persists one item per D1 write inside a single Worker invocation and an unbounded batch would exhaust the per-invocation subrequest budget mid-loop. An over-cap batch SHALL be rejected wholesale as `bad_payload` (`400`, nothing persisted) rather than processed partway; a scraper with more than a batch's worth of candidates SHALL split them into cap-sized batches (which arrival dedup makes safe to push independently).

#### Scenario: A valid batch is accepted and summarized

- **WHEN** a scraper POSTs `/admin/api/ingest` with a valid key and a batch of well-formed recipe items
- **THEN** the Worker validates each item, persists the non-duplicates for the sweep, and responds with `{ received, accepted, deduped, rejected, results }` counts

#### Scenario: A malformed item is rejected without failing the batch

- **WHEN** a batch contains one item missing `source` (or with empty `ingredients`/`instructions`) alongside valid items
- **THEN** that item's result is `rejected` with the offending field named, the valid items are still accepted, and the batch response reflects both

#### Scenario: A batch with no source is rejected

- **WHEN** a batch arrives with a valid key but a missing or blank `source`
- **THEN** the batch is rejected (nothing persisted) and the response names the missing `source`

#### Scenario: An over-cap batch is rejected wholesale

- **WHEN** a batch arrives with a valid key but more than `MAX_BATCH_ITEMS` recipes
- **THEN** the endpoint rejects it as `bad_payload` (`400`) and persists nothing, rather than importing a prefix and failing on the rest

### Requirement: Ingest keys authenticate the endpoint as a carve-out from the Access gate

The `POST /admin/api/ingest` route SHALL be authenticated by a bearer **ingest key** — NOT by Cloudflare Access — as an explicit, allowlisted exemption to the `/admin*` Access gate, because a headless scraper carries no Access JWT. The Worker SHALL authenticate by hashing the presented bearer token (SHA-256) and looking the digest up against the stored key hashes — the plaintext secret is never compared byte-by-byte, so the lookup exposes no per-secret timing signal and the reversible secret is never stored. It SHALL reject a missing/unknown/revoked key with `401` (`bad_key`), and SHALL run no persistence for an unauthenticated request. The exemption SHALL apply to **only** `/admin/api/ingest`; every other `/admin*` path SHALL remain Access-gated unchanged. On a successful authentication the Worker SHALL record the key's `last_used` and the batch's reported `scraper_version` / `contract_version`, and SHALL bound abusive request volume (rate limit) on this open, key-authed route.

#### Scenario: A revoked or unknown key is rejected

- **WHEN** a request to `/admin/api/ingest` presents no bearer token, an unknown token, or a revoked key's token
- **THEN** the Worker responds `401` and persists nothing

#### Scenario: The exemption is scoped to the ingest route only

- **WHEN** a request carrying an ingest key (but no Access assertion) targets any `/admin*` path other than `/admin/api/ingest`
- **THEN** the Access gate rejects it `403` — the ingest key is not admin-surface credentials

#### Scenario: A successful auth records liveness

- **WHEN** a valid key authenticates a batch reporting its `scraper_version` and `contract_version`
- **THEN** the Worker updates that key's `last_used` and the reported versions used for the admin liveness/skew view

### Requirement: Ingest keys are minted once, stored hashed, and revocable

The Worker SHALL support minting an ingest key bound to a scraper **label** (one key per machine): minting SHALL return the full secret **exactly once** and SHALL persist only a **hash** of the secret plus a short non-secret **prefix** (for display), the label, and the created timestamp — never the plaintext secret. Revoking a key SHALL take effect immediately (the next push with that key is rejected `401`). The stored roster SHALL surface, per key: label, prefix, created, `last_used`, status (`active` | `revoked`), and the last-reported scraper/contract version and per-source push activity used by the admin views.

#### Scenario: Minting reveals the secret once and stores only a hash

- **WHEN** the operator mints an ingest key for a label
- **THEN** the response carries the full secret once, and the stored row holds only the hash + prefix + label + created (no plaintext)

#### Scenario: Revocation is immediate

- **WHEN** the operator revokes a key and a scraper subsequently pushes with that key
- **THEN** the push is rejected `401` and nothing is persisted

### Requirement: Accepted candidates are deduped on arrival and persisted for the sweep

On accepting a batch item, the Worker SHALL dedup its **canonical** source URL (tracker query strings / fragments / trailing slashes stripped) against the corpus `source_url` set, `discovery_rejections`, the `discovery_log` evaluated set, and the not-yet-swept pushed-candidate inbox — persisting a new **pushed candidate** (its pre-parsed content, canonical source URL, the batch `source` as `origin`, and the minting key's id) only when it is not already known. A re-push of an already-known URL SHALL count as `deduped` and persist nothing (idempotent). As the **one exception** to the evaluated-set check, a URL whose only prior `discovery_log` outcome is a transient/walled acquisition park (`error` with an acquisition reason, e.g. `unreachable` / `no_jsonld`) SHALL be admitted and SHALL supersede that park — because the scraper has now supplied the content the Worker's own fetch could never reach.

#### Scenario: An already-imported URL is deduped on arrival

- **WHEN** a pushed item's canonical URL already matches a corpus `source_url`
- **THEN** the item is counted `deduped`, no pushed candidate is persisted, and it never reaches the sweep

#### Scenario: A push supersedes a prior walled park

- **WHEN** a pushed item's URL previously parked in `discovery_log` as `error`/`unreachable` (the Worker's own fetch was walled)
- **THEN** the item is accepted, a pushed candidate is persisted, and it supersedes the walled park rather than being dropped as already-evaluated

### Requirement: Per-scraper liveness and contract skew are derived for the operator views

The Worker SHALL derive, from the key roster and the push history, the operator-facing liveness signals: per scraper (machine) and per source a `last_push`, 24h/7d push counts, and a **health** state in the `/health` posture vocabulary — `fresh` (a push within the fresh window), `stale` (overdue), or `never` (minted, never pushed) — plus a **contract-version skew** flag when a machine's reported `contract_version` is behind the Worker's current contract version. These SHALL be exposed to the Access-gated admin surface only; they SHALL NOT leak any key secret.

#### Scenario: A silent scraper reads as stale

- **WHEN** a scraper's most recent push is older than the fresh window
- **THEN** its derived health is `stale` (and `never` if it has never pushed), surfaced to the admin liveness view

#### Scenario: An out-of-date scraper is flagged for skew

- **WHEN** a scraper reports a `contract_version` older than the Worker's current contract version
- **THEN** its liveness record carries a skew flag naming the Worker's current version
