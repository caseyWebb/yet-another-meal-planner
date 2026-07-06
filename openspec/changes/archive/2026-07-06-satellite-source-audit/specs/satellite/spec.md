## MODIFIED Requirements

### Requirement: The Worker trusts a satellite's validated outputs, never its process

The Worker SHALL trust a satellite's **outputs only after validation** — a lenient envelope plus per-item validation, plausibility bounds appropriate to the observation kind, and provenance pointers — and SHALL NEVER trust the satellite's **process**. Every conclusion the system acts on (is this a duplicate? does it match a taste? is it a deal? what is the confidence?) SHALL be **re-derived by the Worker**; a satellite's own opinion SHALL NOT be load-bearing. A satellite whose observations repeatedly fail validation or plausibility SHALL be **quarantinable through the pipeline** without special-casing: every Worker-side reject is recorded in a durable rejection ledger, each source carries a computed reliability signal (acceptance/validation-fail rate and staleness), and a repeatedly-failing source SHALL be **quarantinable per-source** — a **reversible, operator-confirmed** Worker-side reject flag that drops the source's future observations at intake (logged to the ledger) while the machine's other sources continue. This per-source quarantine SHALL **complement**, not replace, whole-machine key revocation, giving the operator a scalpel where they previously had only the whole-machine lever. The audit SHALL check operational **health** (breakage), trusting the satellite's honesty rather than sampling its store claims against a ground truth the Worker cannot reach.

#### Scenario: Every conclusion is re-derived, not accepted

- **WHEN** a satellite observation is processed downstream
- **THEN** the Worker re-derives every conclusion it acts on (dedup, match, deal, confidence) rather than accepting one asserted by the satellite

#### Scenario: A bad source is quarantined through the pipeline

- **WHEN** a satellite's observations for a source repeatedly fail validation or plausibility bounds
- **THEN** those rejects are recorded in the rejection ledger and surfaced through the source's reliability signal, and the operator can **quarantine that source** (a reversible per-source Worker-side reject) or revoke the whole machine's key — with no privileged bypass and without special-casing

#### Scenario: A quarantined source is rejected at intake, its siblings unaffected

- **WHEN** a source is quarantined and the satellite next reports an observation for it
- **THEN** the Worker rejects that observation at intake and records it in the ledger, while the same machine's non-quarantined sources continue to be accepted

### Requirement: The push wire contract is capability-tagged with observation items as a discriminated union

The push payload SHALL be a **capability-tagged batch envelope** carrying the reported `capability`, the human-readable `source` provenance, the machine's `satellite_version`, the targeted `contract_version`, and an array of **observation items**. The observation items SHALL be a **discriminated union keyed by an item `kind`**: `kind: "recipe"` for `recipe-scrape` (functional recipe facts), `kind: "sale"` for `sale-scan` (raw store/product/`{ regular, promo }` price facts), and `kind: "order"` for `order-fill` (a per-item cart-fill disposition — `carted`/`substituted`/`unavailable`, with the matched or substitute store product — keyed to the canonical ingredient id the pull-list carried), so a later item kind can be added without breaking a consumer that handles only the existing kinds. An `order` observation is delivered over the order-receipt endpoint rather than the capability-tagged push batch, so the batch envelope's `capability` enumeration is unchanged by it (as `sale` is delivered over the pull channel, not the push path). The envelope MAY additionally carry an **optional, additive** `local_rejects` operational-health summary (the items the satellite dropped locally before the wire, rolled up per reason-category), which SHALL keep the `contract_version` at `"v2"` — a satellite that omits it is unaffected, and a Worker that does not read it processes the batch unchanged. The `contract_version` SHALL be `"v2"`. The batch envelope SHALL carry no more than `MAX_BATCH_ITEMS` observation items. The wire contract SHALL be defined once in the shared, runtime-agnostic contract package that both the Worker and the satellite import, so the shape can never drift between the two runtimes.

#### Scenario: A v2 batch is a capability-tagged discriminated union

- **WHEN** a satellite constructs a push
- **THEN** it sends `{ capability, source, satellite_version, contract_version: "v2", observations: [{ kind: "recipe", ... }, ...] }` validated against the shared contract before sending

#### Scenario: A sale observation is a defined member of the union

- **WHEN** a satellite reports a `sale` observation
- **THEN** it is a `{ kind: "sale", store, locationId, productId, description, regular, promo, ... }` member of the same discriminated union, validated against the shared contract, and a consumer that handles only `recipe` continues to validate and process `recipe` batches unchanged

#### Scenario: An order observation is a defined member of the union

- **WHEN** a satellite reports an `order` observation on the receipt endpoint
- **THEN** it is a `{ kind: "order", item_id, disposition, product? }` member of the same discriminated union, validated against the shared contract, and a consumer that handles only `recipe`/`sale` is unaffected

#### Scenario: A new observation kind does not break existing consumers

- **WHEN** the discriminated union gains a new `kind` in a later capability
- **THEN** a consumer that handles only the prior kinds continues to validate and process batches of those kinds unchanged

#### Scenario: The optional local-reject summary keeps the contract at v2

- **WHEN** a satellite attaches an optional `local_rejects` summary to a batch (or omits it)
- **THEN** the Worker validates and processes the batch unchanged at `contract_version: "v2"`, because the field is additive and optional
