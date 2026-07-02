## ADDED Requirements

### Requirement: The satellite runs off-cloud on the operator's network

The **satellite** SHALL run as a component on the operator's own network (packaged as a container), NOT in the Worker and NOT on any cloud the Worker deploys to. A running satellite is one **machine** that holds exactly **one** ingest key and MAY be configured with **many** sources; it SHALL authenticate to each configured source with the operator's own session, observe, and POST to `POST /admin/api/ingest` using its key. For the `recipe-scrape` capability, a satellite SHALL be the sole intake path for a walled source — such a source SHALL NOT also be registered as a Worker-polled `feed`.

#### Scenario: One machine, one key, many sources

- **WHEN** an operator runs one satellite container configured with several sources
- **THEN** all of those sources push under that machine's single ingest key, and the version/liveness of the machine is reported as one binary

#### Scenario: The satellite does not run in the cloud

- **WHEN** the feature is deployed
- **THEN** no automated walled-source fetching runs in the Worker or its cloud; the Worker only ever receives already-observed content over `/admin/api/ingest`

### Requirement: The satellite is strictly outbound-only

The satellite SHALL communicate with the Worker over **outbound** connections only — it initiates every call; the Worker SHALL NEVER dial in to a satellite. The satellite SHALL NOT run an inbound listener the Worker connects to, SHALL NOT use websockets or any Worker-initiated long-lived connection, and SHALL NOT rely on a stateful Worker or Durable Object on the data path. A home box behind NAT SHALL require no inbound port to be opened for the satellite to function.

#### Scenario: The Worker never initiates a connection to the satellite

- **WHEN** the satellite has work to report or (in a later capability) work to fetch
- **THEN** the satellite makes the outbound request; the Worker exposes only request/response endpoints and opens no connection toward the satellite

#### Scenario: No inbound port is required

- **WHEN** a satellite runs on a home network behind NAT with no port forwarding
- **THEN** it operates normally, because it only ever calls out

### Requirement: The satellite declares its capabilities; recipe-scrape is the only capability

A satellite SHALL declare one or more **capabilities** it runs, and every push SHALL carry the `capability` it reports under. The **only** capability defined in this specification is `recipe-scrape` (extract functional recipe facts from an authenticated source). The capability set SHALL be a closed, extensible enumeration so a later capability can be added without redefining the envelope. The Worker SHALL reject a batch whose declared `capability` it does not implement.

#### Scenario: A recipe-scrape batch declares its capability

- **WHEN** a satellite pushes recipes it extracted
- **THEN** the batch declares `capability: "recipe-scrape"` and the Worker processes it

#### Scenario: An unknown capability is rejected

- **WHEN** a batch declares a `capability` the Worker does not implement
- **THEN** the Worker rejects the batch (nothing persisted) rather than guessing how to process it

### Requirement: The push wire contract is capability-tagged with observation items as a discriminated union

The push payload SHALL be a **capability-tagged batch envelope** carrying the reported `capability`, the human-readable `source` provenance, the machine's `satellite_version`, the targeted `contract_version`, and an array of **observation items**. The observation items SHALL be a **discriminated union keyed by an item `kind`** (`kind: "recipe"` for `recipe-scrape`), so a later item kind can be added without breaking a consumer that handles only the existing kinds. The `contract_version` SHALL be `"v2"`. The batch envelope SHALL carry no more than `MAX_BATCH_ITEMS` observation items. The wire contract SHALL be defined once in the shared, runtime-agnostic contract package that both the Worker and the satellite import, so the shape can never drift between the two runtimes.

#### Scenario: A v2 batch is a capability-tagged discriminated union

- **WHEN** a satellite constructs a push
- **THEN** it sends `{ capability, source, satellite_version, contract_version: "v2", observations: [{ kind: "recipe", ... }, ...] }` validated against the shared contract before sending

#### Scenario: A new observation kind does not break existing consumers

- **WHEN** the discriminated union gains a new `kind` in a later capability
- **THEN** a consumer that handles only the prior kinds continues to validate and process batches of those kinds unchanged

### Requirement: The satellite reports only independently-checkable observations, never derived conclusions

The contract SHALL admit **only** independently-checkable facts and SHALL carry **no wire field for a derived value the Worker cares about** — every conclusion SHALL be computed by the Worker from the reported facts, never trusted from the wire. For `recipe-scrape` this means the satellite reports the **functional facts** (title, summary, ingredients, instructions, times, servings, canonical source URL) and SHALL NOT report publisher prose (headnotes) or images, and SHALL NOT report the recipe's derived facets (`ingredients_key`, perishability, course/cuisine/season, meal-prep suitability, description) — those SHALL be **derived on-cron** by the Worker, not accepted from the satellite. The author-provided `summary` is a short recipe summary written by the recipe's author and is a functional fact carried optionally on the wire; it is distinct both from a publisher **headnote** (narrative prose, which SHALL NOT be reported) and from the consumer-facing `description`, which the Worker **derives on-cron** and SHALL NOT trust from the wire. This requirement is capability-agnostic: any future capability SHALL likewise carry only raw measurements, never the Worker-relevant quantity derived from them.

#### Scenario: Only functional facts cross the recipe-scrape wire

- **WHEN** a satellite extracts a recipe whose page also carries a headnote and photos
- **THEN** the pushed item carries only title/summary/ingredients/instructions/times/servings/source, not the headnote prose, the images, or any derived facet

#### Scenario: Facets are derived, not trusted from the wire

- **WHEN** a recipe observation is accepted
- **THEN** its facets are derived by the Worker's on-cron derivation, and no facet value supplied on the wire (if any were present) is trusted

#### Scenario: No wire field for a derived conclusion

- **WHEN** a future capability needs a Worker-relevant derived quantity (e.g. a saving)
- **THEN** the contract carries only the raw measurements it is derived from, and the Worker computes the derived quantity itself

### Requirement: Trusted and untrusted sources converge at a raw-observation layer

Satellite-fed data SHALL enter the **same raw-observation layer** as first-party sources (e.g. the Kroger API for flyer prices), and SHALL be subject to the **same** Worker-side derivation and **equal-or-stricter** validation. A satellite SHALL be given **no privileged path**: there SHALL be no field a satellite can set that a first-party source could not, and no derivation a satellite's data may skip. Downstream logic SHALL NOT be able to distinguish a satellite-fed observation from a first-party one after it lands in the raw layer, except by its recorded provenance.

#### Scenario: Satellite data is validated at least as strictly as first-party data

- **WHEN** a satellite observation and a first-party observation of the same kind arrive
- **THEN** both pass through the same raw-layer validation and derivation, with the satellite's held to equal-or-stricter checks — never looser

#### Scenario: No privileged satellite field or skipped derivation

- **WHEN** a satellite observation is processed
- **THEN** it can set no field a first-party source could not, and skips no derivation the Worker applies to first-party data

### Requirement: The Worker trusts a satellite's validated outputs, never its process

The Worker SHALL trust a satellite's **outputs only after validation** — a lenient envelope plus per-item validation, plausibility bounds appropriate to the observation kind, and provenance pointers — and SHALL NEVER trust the satellite's **process**. Every conclusion the system acts on (is this a duplicate? does it match a taste? is it a deal? what is the confidence?) SHALL be **re-derived by the Worker**; a satellite's own opinion SHALL NOT be load-bearing. A satellite whose observations repeatedly fail validation or plausibility SHALL be quarantinable through the pipeline (its pushes surfaced and rejectable) without special-casing.

#### Scenario: Every conclusion is re-derived, not accepted

- **WHEN** a satellite observation is processed downstream
- **THEN** the Worker re-derives every conclusion it acts on (dedup, match, deal, confidence) rather than accepting one asserted by the satellite

#### Scenario: A bad source is quarantined through the pipeline

- **WHEN** a satellite's observations repeatedly fail validation or plausibility bounds
- **THEN** they are rejected and surfaced through the existing pipeline/observability, without a privileged bypass, so the operator can revoke the source

### Requirement: Irreversible actions stay human-gated against ground truth

No satellite report SHALL, by itself, cause an **irreversible action**. Any irreversible action derived from satellite data SHALL remain gated on a **human verifying the ground truth** (e.g. the store's own UI) before it commits. This requirement is forward-looking — it is realized fully by a later capability that stops short of the irreversible step (an order capability that fills a cart but never completes checkout) — and it SHALL bind every capability: a capability MAY observe and prepare, but the irreversible commit stays with a human.

#### Scenario: A satellite cannot commit an irreversible action alone

- **WHEN** satellite data would drive an irreversible action
- **THEN** the action is not committed by the satellite or automatically by the Worker; it is prepared and left for a human to verify against ground truth and complete

### Requirement: Source adapters are a plugin model over a shared SDK

For the `recipe-scrape` capability, each source SHALL be handled by an **adapter** exposing three responsibilities — `authenticate` (establish/refresh the session), `discover` (yield new recipe URLs), and `extract` (turn an authenticated page into the wire-contract recipe observation). Base adapters SHALL ship in the image; the satellite SHALL additionally load operator-authored adapters from a mounted directory at runtime without an image rebuild. Every adapter SHALL receive an injected **SDK** of shared primitives — including the **same** runtime-agnostic recipe-parse used by the Worker — so an adapter's `extract` reuses the shared JSON-LD/normalize parse and only overrides extraction when a source lacks usable structured data. Adapters SHALL emit only the wire-contract shape; the satellite SHALL validate an adapter's output against the shared contract before pushing.

#### Scenario: A config-only source needs no code

- **WHEN** a source exposes a sitemap/feed and authenticated pages carrying schema.org JSON-LD
- **THEN** the operator adds a source entry pointing at the generic adapter with no custom code, and extraction uses the shared parse

#### Scenario: An operator adapter loads from the mounted directory

- **WHEN** the operator drops a custom adapter module into the mounted adapters directory and references it from config
- **THEN** the satellite loads it at runtime (no image rebuild) and hands it the shared SDK

#### Scenario: Adapter output is validated before push

- **WHEN** an adapter returns content that does not satisfy the wire contract
- **THEN** the satellite rejects that item locally and does not push it

### Requirement: The fetch runtime is tiered, plain-HTTP by default

The satellite SHALL provide the fetch mechanism as a tier the adapter (or per-source config) selects: **plain HTTP** (session-cookie replay + HTML/JSON-LD parse) as the default, escalating to a **headless browser** (Playwright/Chromium over CDP) only for sources that declare they need rendered DOM or a browser-only session. The recurring run SHALL NOT launch a browser for a source whose tier is plain HTTP. When multiple sources need the browser tier, the satellite SHALL reuse a single browser process with a per-source context.

#### Scenario: A plain-HTTP source never launches a browser

- **WHEN** a source's declared fetch tier is plain HTTP
- **THEN** its recurring run replays the session cookies over HTTP and no browser is launched for it

#### Scenario: A browser-tier source uses a reused browser context

- **WHEN** one or more sources declare the browser tier
- **THEN** the satellite drives them through a single browser process with a per-source context loaded from that source's session

### Requirement: Session capture is decoupled from the daemon and expiry is surfaced

Session establishment SHALL be decoupled from the recurring daemon: the operator SHALL capture a session either on a machine with a display (a `login` verb that opens a headful browser) or by importing cookies from their own browser, producing a persisted session file on the mounted volume that the daemon consumes read-only. The recurring daemon SHALL default to headless and browserless. When an adapter detects that a source's session has expired (a login redirect / paywall interstitial), the satellite SHALL surface an **`auth_expired`** signal for that source (via its push/heartbeat to the Worker) so the operator liveness view distinguishes an expired session from a dead machine or a broken adapter, prompting a re-capture.

#### Scenario: The daemon consumes a captured session without a browser

- **WHEN** a session file exists on the volume for a plain-HTTP source
- **THEN** the daemon reads it and runs without launching a browser or performing an interactive login

#### Scenario: An expired session is surfaced, not silently dropped

- **WHEN** an adapter's authenticated request is bounced to a login/paywall page
- **THEN** the satellite reports `auth_expired` for that source so the operator sees it and re-captures the session

### Requirement: Recipe observations are pushed in per-source batches with machine version

The satellite SHALL push per **source** in batches (the envelope's `source` names that source), stamping its `satellite_version` and targeted `contract_version`. When a source yields more than the shared-contract batch cap (`MAX_BATCH_ITEMS`) of items — notably a `backfill` over a large archive — the satellite SHALL split them into cap-sized batches and push each independently, marking a batch's URLs seen only after that batch succeeds so a mid-run failure re-tries only the unpushed tail. A push failure (network / non-2xx) SHALL be retried with backoff; the satellite's own already-pushed cursor is an optimization only, since the Worker dedups on arrival — a re-push is safe.

#### Scenario: Per-source batches carry machine version

- **WHEN** the satellite pushes recipes gathered from one source
- **THEN** it sends one batch tagged with that `source`, `satellite_version`, `contract_version`, and `capability: "recipe-scrape"`

#### Scenario: A large backfill is split into cap-sized batches

- **WHEN** a `backfill` gathers more than `MAX_BATCH_ITEMS` recipes from one source
- **THEN** the satellite pushes them as several cap-sized batches, marking each batch's URLs seen only after it succeeds, rather than one oversized batch the endpoint would reject

### Requirement: The satellite provides operator CLI verbs and ships as a container

The satellite SHALL provide operator verbs — at minimum `login` (capture a session), `test` (dry-run an adapter against a URL, printing the wire-contract shape it would push and validating it locally), `backfill` (bulk-observe a source's archive), and `run` (the recurring daemon) — and SHALL be distributed as a container image the operator runs with a mounted config/session volume and the ingest key supplied via the environment.

#### Scenario: Test dry-runs an adapter before going live

- **WHEN** the operator runs the `test` verb against a source and a URL
- **THEN** the satellite extracts that page and prints the wire-contract shape it would push, validating it locally without pushing

#### Scenario: The daemon runs from the container with a mounted volume

- **WHEN** the operator runs the container's `run` verb with the config/session volume mounted and the ingest key in the environment
- **THEN** the satellite polls its configured sources on schedule and pushes batches to the Worker
