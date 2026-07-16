# satellite-source-audit Specification

## Purpose
TBD - created by archiving change satellite-source-audit. Update Purpose after archive.
## Requirements
### Requirement: Every rejected observation is recorded in a durable rejection ledger

The Worker SHALL record each **rejected** satellite observation in a durable **rejection ledger**
(a D1 table accessed only through the throw-free `src/db.ts` helpers). A ledger entry SHALL carry
the observation `kind` (`recipe` | `sale` | `order`), the `source` it was attributed to, the
`origin` of the rejection (`worker` when the Worker's intake rejected it, `local` when the satellite
dropped it before the wire), a human-readable `reason`, an optional `provenance` pointer (the
offending url / product id / item id, or a local sample), a `count`, the owning `tenant` (NULL for
operator-global observations), and a `rejected_at` timestamp. Every arm of the shared intake
(`recipe`, `sale`, `order`) SHALL append a ledger entry on a Worker-side reject, so the reject
reasons that otherwise live only in the synchronous response body become durable. The ledger SHALL
be an append-with-rolling-window log, pruned by age on the scheduled reap alongside the other
retention prunes — never a wholesale-replace table. An **accepted** or **deduped** observation SHALL
NOT be recorded in the ledger.

#### Scenario: A Worker-side reject is durably recorded

- **WHEN** the intake rejects an observation (a bad payload, a failed plausibility bound, a
  store/location mismatch, an unissued order id)
- **THEN** it appends a ledger entry with `origin: worker`, the observation's `kind`/`source`, the
  reject `reason`, and a provenance pointer, so the operator can later see why it was rejected

#### Scenario: Accepted observations leave no ledger entry

- **WHEN** an observation is accepted or deduped on arrival
- **THEN** no ledger entry is written for it, and the ledger reflects only rejections

#### Scenario: The ledger is pruned on a rolling window

- **WHEN** the scheduled reap runs
- **THEN** ledger entries older than the retention window are deleted, bounding the table, while
  entries within the window are retained as the operator's rejection rear-view mirror

### Requirement: The satellite reports a compact local-reject summary on its delivery envelopes

A satellite SHALL report the items it rejected **locally** (an emit that failed the shared-contract
validation, or that smuggled a derived-judgment field) as a compact **local-reject summary** — an
**additive, OPTIONAL** field on each of its three delivery envelopes (the capability-tagged push
batch, the pull-channel results report, and the order-receipt post). The summary SHALL be a list of
per-category rollups `{ category, count, sample? }` — NOT the full rejected bodies — where `category`
is one of a closed set: **`contract_invalid`** (the emit failed the shared contract's shape/plausibility
parse) and **`judgment_smuggled`** (the emit carried a derived judgment field a sensor must never
report). Because the field is additive and optional, the wire `contract_version` SHALL remain `"v2"`:
a satellite that omits it SHALL be unaffected, and a Worker that receives it SHALL record each entry
in the rejection ledger with `origin: local`, attributing it to the envelope's own `source`. A
whole-task or whole-fill failure (the adapter returning a structured error) SHALL NOT be reported as
a local-item reject — it continues to ride the existing failure `reason` on the results/receipt path.

#### Scenario: A broken adapter's local drops become visible

- **WHEN** an adapter emits malformed items that the satellite drops locally before the wire
- **THEN** the satellite includes a `{ category: "contract_invalid", count, sample }` entry on its
  next delivery envelope, and the Worker records it in the ledger with `origin: local`, so a
  locally-dropped flood the Worker would otherwise never see is surfaced

#### Scenario: A judgment-smuggling adapter is categorized distinctly

- **WHEN** an adapter emits an observation carrying a derived-judgment field (e.g. a `savings` on a
  sale, or an `in_cart` on an order)
- **THEN** the satellite drops it locally and reports it under `category: "judgment_smuggled"`,
  distinct from a contract-shape failure, so the operator can tell a rotted scrape from a
  sensor-not-judge violation

#### Scenario: The optional field keeps the contract at v2

- **WHEN** a satellite build that does not emit the local-reject summary delivers an envelope
- **THEN** the Worker validates and processes it unchanged at `contract_version: "v2"`, because the
  field is additive and optional

### Requirement: A per-source reliability signal is computed on read

The Worker SHALL expose a **reliability signal** per **`{ kind, source }`** source — recipe keyed by
the feed/site URL, sale and order keyed by the store slug — computed **on read** from the rejection
ledger and a per-source accepted count. The signal SHALL surface, per source: an **acceptance rate**
and its inverse **validation/plausibility-fail rate** (deduped observations excluded from the
denominator as a benign re-report), and a **staleness** measure (time since the source's last
accepted observation). The accepted count that forms the denominator SHALL be recorded uniformly for
all three intake arms, so a sale or order source — whose accepted observations otherwise leave no
per-source count — has a denominator equal to a recipe source's. The signal SHALL be surfaced to the
operator on the admin Satellites page beside the recency it already shows.

#### Scenario: Fail-rate is derived, not stored

- **WHEN** the operator views a source's reliability
- **THEN** its fail-rate is computed on read from the ledger's rejects over the source's accepted +
  rejected count, rather than read from a stored rate that could drift

#### Scenario: Sale and order sources have a denominator

- **WHEN** a sale-scan or order-fill source's reliability is computed
- **THEN** its acceptance rate uses a per-source accepted count recorded uniformly across all three
  intake paths, so it is comparable to a recipe source's rather than undefined

### Requirement: A repeatedly-failing source is quarantinable per-source, reversibly and human-confirmed

The Worker SHALL provide a **per-source quarantine** — a reversible flag on a `{ kind, source }` that
causes the source's future observations to be **rejected at intake** (dropped before they reach the
corpus, the flyer rollup, or the grocery list) and recorded in the ledger with `origin: worker,
reason: quarantined`. Quarantine SHALL be **operator-confirmed, never automatic**: when a source
crosses a fixed fail-rate threshold over a minimum sample, the admin surface SHALL present a
**recommendation** to quarantine it, and the operator SHALL toggle it — the Worker SHALL NOT
auto-quarantine on the threshold. Quarantine SHALL be **reversible**: clearing the flag SHALL let the
source's next observation flow again. It SHALL **complement**, not replace, whole-machine key
revocation (`revokeIngestKey`): quarantine SHALL scope to a single source of a machine while the
machine's other sources continue. Enforcement SHALL be Worker-side, consistent with the satellite
being strictly outbound-only (the Worker cannot stop the satellite at its source).

#### Scenario: A quarantined source's observations are rejected at intake

- **WHEN** a source is quarantined and the satellite next reports an observation for it
- **THEN** the Worker rejects that observation at intake, writes a ledger entry with
  `origin: worker, reason: quarantined`, and persists nothing downstream — while the same machine's
  non-quarantined sources continue to be accepted

#### Scenario: Quarantine is recommended, not auto-applied

- **WHEN** a source's fail-rate crosses the threshold over a sufficient sample
- **THEN** the admin surface recommends quarantining it and the operator decides, and the source is
  not disabled until the operator toggles it

#### Scenario: Quarantine is reversible

- **WHEN** the operator clears a source's quarantine flag
- **THEN** the source's next observation is validated and accepted normally, with no residual block

### Requirement: The audit checks operational health only, not store-claim ground truth

The source audit SHALL check a satellite's **operational health** — breakage such as a changed DOM,
a rotted adapter, or an expired session flooding malformed or empty data — and SHALL NOT attempt to
verify a satellite's store claims against an independent **ground truth**. This is by design: the
satellite exists to observe sources the Worker **cannot** independently reach (an API-less store's
loyalty prices, a walled recipe site), so there is no oracle the Worker could sample against, and a
ground-truth check would only re-check the sensor against itself. The Worker SHALL therefore trust
the satellite's honesty (it runs on the operator's own network under the operator's own session) and
treat the audit as an **operator health tool** with per-household blast radius, not a cross-tenant
security boundary.

#### Scenario: No ground-truth sampling of store claims

- **WHEN** a satellite reports a sale price the Worker has no API to independently observe
- **THEN** the Worker validates the observation's plausibility and records its health, but does not
  attempt to confirm the reported price against an external ground truth, because none is reachable

#### Scenario: Breakage is caught without an oracle

- **WHEN** a source's adapter breaks and floods malformed or judgment-smuggling data
- **THEN** the audit surfaces it through the ledger, the rising fail-rate, and the quarantine
  recommendation — none of which require a ground truth — so the operator can act

### Requirement: The rejection ledger and quarantine state are readable by the operator

The rejection ledger and the current quarantine state SHALL be readable from the **operator admin surface** — the recent rejections (`kind`, `source`, `origin`, `reason`, `provenance`, `count`, `rejected_at`) and the currently quarantined sources, bounded and most-recent-first. The read SHALL reflect only **rejected** observations — an accepted observation SHALL never appear — so the operator can explain why a satellite's contributions are not landing and relay the specific defect. The visibility rule is unchanged: recipe and sale rejections/quarantines are operator-global, while `order`-kind rows remain private to their member and are surfaced only to that member's surfaces, never listed to another member.

#### Scenario: The operator diagnoses why contributions are not landing

- **WHEN** a member reports that recipes (or sales) from their satellite are not showing up
- **THEN** the operator reads the ledger in the admin surface and relays the specific per-source defect (e.g. "that source had 12 `contract_invalid` rejects in the last day — its adapter likely broke"), rather than guessing

#### Scenario: Accepted observations never appear

- **WHEN** a satellite's recent observations all validated cleanly
- **THEN** the ledger shows no entries for it — an empty rejection list means everything landed

