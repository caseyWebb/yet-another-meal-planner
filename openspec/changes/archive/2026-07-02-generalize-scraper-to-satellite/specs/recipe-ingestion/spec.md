## RENAMED Requirements

- FROM: `### Requirement: Per-scraper liveness and contract skew are derived for the operator views`
- TO: `### Requirement: Per-satellite liveness and contract skew are derived for the operator views`

## MODIFIED Requirements

### Requirement: Ingest endpoint accepts an authenticated batch of pre-parsed recipes

The Worker SHALL expose `POST /admin/api/ingest` accepting a JSON **batch envelope** from a home-network satellite. The current (`v2`) envelope is capability-tagged: `{ capability, source, satellite_version, contract_version, observations: [...] }`, where `capability` is the reported capability (`"recipe-scrape"` is the only capability the Worker implements), `source` is the human-readable source name the batch came from (required — it is the provenance the admin views group by), `satellite_version` and `contract_version` are the machine's reported build and targeted contract version, and each `observations[]` element is a **discriminated-union observation item** keyed by `kind`. A `recipe-scrape` observation is `{ kind: "recipe", title, ingredients: string[], instructions: string[], source }` (a canonical recipe URL) plus optional `summary`, `servings`, `time_total`, `time_active` — the functional-facts recipe shape.

During the v1→v2 transition the endpoint SHALL **also accept** the prior (`v1`) recipe batch `{ source, scraper_version, contract_version, recipes: [...] }`, normalizing it to the recipe-scrape capability internally (`satellite_version := scraper_version`, `observations := recipes` tagged `kind: "recipe"`) so it flows through the identical intake. The endpoint SHALL reject a batch whose declared `capability` it does not implement as `bad_payload`.

The endpoint SHALL validate the envelope and each item against the shared contract, and SHALL respond with a summary `{ received, accepted, deduped, rejected, results: [...] }` where each per-item result names its disposition (`accepted` | `deduped` | `rejected`) and, on rejection, a reason. The endpoint SHALL be batch-first (an array of items) and SHALL NOT run the classify/describe/embed/match pipeline synchronously — accepted items are persisted for the background sweep.

The endpoint SHALL reject a batch with a missing/blank `source` as `bad_key`-adjacent (`rejected`, reason names the missing source), and SHALL reject an individual item that fails the contract shape (e.g. missing `source` URL, empty `ingredients`/`instructions`, unknown `kind`) as `rejected` with the offending field, without failing the whole batch when other items are valid.

The batch envelope SHALL carry no more than a bounded number of items (`MAX_BATCH_ITEMS`, a shared-contract constant), because the endpoint persists one item per D1 write inside a single Worker invocation and an unbounded batch would exhaust the per-invocation subrequest budget mid-loop. An over-cap batch SHALL be rejected wholesale as `bad_payload` (`400`, nothing persisted) rather than processed partway; a satellite with more than a batch's worth of items SHALL split them into cap-sized batches (which arrival dedup makes safe to push independently).

#### Scenario: A valid v2 batch is accepted and summarized

- **WHEN** a satellite POSTs `/admin/api/ingest` with a valid key and a v2 batch `{ capability: "recipe-scrape", ..., observations: [{ kind: "recipe", ... }] }` of well-formed items
- **THEN** the Worker validates each item, persists the non-duplicates for the sweep, and responds with `{ received, accepted, deduped, rejected, results }` counts

#### Scenario: A v1 recipe batch is still accepted during transition

- **WHEN** a satellite POSTs a v1 batch `{ source, scraper_version, contract_version, recipes: [...] }` with a valid key
- **THEN** the Worker normalizes it to the recipe-scrape capability and processes it identically, so recipe ingestion is unbroken while a producer is behind

#### Scenario: An unknown capability is rejected

- **WHEN** a batch declares a `capability` the Worker does not implement
- **THEN** the batch is rejected `bad_payload` and nothing is persisted

#### Scenario: A malformed item is rejected without failing the batch

- **WHEN** a batch contains one item missing `source` (or with empty `ingredients`/`instructions`, or an unknown `kind`) alongside valid items
- **THEN** that item's result is `rejected` with the offending field named, the valid items are still accepted, and the batch response reflects both

#### Scenario: A batch with no source is rejected

- **WHEN** a batch arrives with a valid key but a missing or blank `source`
- **THEN** the batch is rejected (nothing persisted) and the response names the missing `source`

#### Scenario: An over-cap batch is rejected wholesale

- **WHEN** a batch arrives with a valid key but more than `MAX_BATCH_ITEMS` items
- **THEN** the endpoint rejects it as `bad_payload` (`400`) and persists nothing, rather than importing a prefix and failing on the rest

### Requirement: Per-satellite liveness and contract skew are derived for the operator views

The Worker SHALL derive, from the key roster and the push history, the operator-facing liveness signals: per satellite (machine) and per source a `last_push`, 24h/7d push counts, and a **health** state in the `/health` posture vocabulary — `fresh` (a push within the fresh window), `stale` (overdue), or `never` (minted, never pushed) — plus a **contract-version skew** flag when a machine's reported `contract_version` is behind the Worker's current contract version (`CONTRACT_VERSION = "v2"`). The reported version fields SHALL be recorded from whichever envelope shape the batch used (`satellite_version`, or `scraper_version` from a v1 batch), so a producer reporting `contract_version: "v1"` reads as skewed against the current `"v2"`. These signals SHALL be exposed to the Access-gated admin surface only; they SHALL NOT leak any key secret.

#### Scenario: A silent satellite reads as stale

- **WHEN** a satellite's most recent push is older than the fresh window
- **THEN** its derived health is `stale` (and `never` if it has never pushed), surfaced to the admin liveness view

#### Scenario: An out-of-date satellite is flagged for skew

- **WHEN** a satellite reports a `contract_version` older than the Worker's current contract version (e.g. `"v1"` against `"v2"`)
- **THEN** its liveness record carries a skew flag naming the Worker's current version
