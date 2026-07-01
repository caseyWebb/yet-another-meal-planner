## ADDED Requirements

### Requirement: The scraper runs off-cloud on the operator's network

The walled-source scraper SHALL run as a component on the operator's own network (packaged as a container), NOT in the Worker and NOT on any cloud the Worker deploys to. A running scraper is one **machine** that holds exactly **one** ingest key and MAY be configured with **many** sources; it SHALL authenticate to each configured paid source with the operator's own subscription session, extract recipes, and POST them to `POST /admin/api/ingest` using its key. The scraper SHALL be the sole intake path for a walled source — such a source SHALL NOT also be registered as a Worker-polled `feed`.

#### Scenario: One machine, one key, many sources

- **WHEN** an operator runs one scraper container configured with several paid sources
- **THEN** all of those sources push under that machine's single ingest key, and the version/liveness of the machine is reported as one binary

#### Scenario: The scraper does not run in the cloud

- **WHEN** the feature is deployed
- **THEN** no automated walled-source fetching runs in the Worker or its cloud; the Worker only ever receives already-parsed content over `/admin/api/ingest`

### Requirement: Source adapters are a plugin model over a shared SDK

Each source SHALL be handled by an **adapter** exposing three responsibilities — `authenticate` (establish/refresh the session), `discover` (yield new recipe URLs), and `extract` (turn an authenticated page into the wire-contract recipe shape). Base adapters SHALL ship in the image; the scraper SHALL additionally load operator-authored adapters from a mounted directory at runtime without an image rebuild. Every adapter SHALL receive an injected **SDK** of shared primitives — including the **same** workerd-pure recipe-parse used by the Worker — so an adapter's `extract` reuses the shared JSON-LD/normalize parse and only overrides extraction when a source lacks usable structured data. Adapters SHALL emit only the wire-contract shape; the scraper SHALL validate an adapter's output against the shared contract before pushing.

#### Scenario: A config-only source needs no code

- **WHEN** a source exposes a sitemap/feed and authenticated pages carrying schema.org JSON-LD
- **THEN** the operator adds a source entry pointing at the generic adapter with no custom code, and extraction uses the shared parse

#### Scenario: An operator adapter loads from the mounted directory

- **WHEN** the operator drops a custom adapter module into the mounted adapters directory and references it from config
- **THEN** the scraper loads it at runtime (no image rebuild) and hands it the shared SDK

#### Scenario: Adapter output is validated before push

- **WHEN** an adapter returns content that does not satisfy the wire contract
- **THEN** the scraper rejects that item locally and does not push it

### Requirement: The fetch runtime is tiered, plain-HTTP by default

The scraper SHALL provide the fetch mechanism as a tier the adapter (or per-source config) selects: **plain HTTP** (session-cookie replay + HTML/JSON-LD parse) as the default, escalating to a **headless browser** (Playwright/Chromium over CDP) only for sources that declare they need rendered DOM or a browser-only session. The recurring scrape SHALL NOT launch a browser for a source whose tier is plain HTTP. When multiple sources need the browser tier, the scraper SHALL reuse a single browser process with a per-source context.

#### Scenario: A plain-HTTP source never launches a browser

- **WHEN** a source's declared fetch tier is plain HTTP
- **THEN** its recurring scrape replays the session cookies over HTTP and no browser is launched for it

#### Scenario: A browser-tier source uses a reused browser context

- **WHEN** one or more sources declare the browser tier
- **THEN** the scraper drives them through a single browser process with a per-source context loaded from that source's session

### Requirement: Session capture is decoupled from the daemon and expiry is surfaced

Session establishment SHALL be decoupled from the recurring daemon: the operator SHALL capture a session either on a machine with a display (a `login` verb that opens a headful browser) or by importing cookies from their own browser, producing a persisted session file on the mounted volume that the daemon consumes read-only. The recurring daemon SHALL default to headless and browserless. When an adapter detects that a source's session has expired (a login redirect / paywall interstitial), the scraper SHALL surface an **`auth_expired`** signal for that source (via its push/heartbeat to the Worker) so the operator liveness view distinguishes an expired session from a dead machine or a broken adapter, prompting a re-capture.

#### Scenario: The daemon consumes a captured session without a browser

- **WHEN** a session file exists on the volume for a plain-HTTP source
- **THEN** the daemon reads it and scrapes without launching a browser or performing an interactive login

#### Scenario: An expired session is surfaced, not silently dropped

- **WHEN** an adapter's authenticated request is bounced to a login/paywall page
- **THEN** the scraper reports `auth_expired` for that source so the operator sees it and re-captures the session

### Requirement: Recipes are stripped to functional facts and pushed in per-source batches

The scraper SHALL extract only the **functional recipe facts** — title, ingredients, instructions, times, and the canonical source URL — and SHALL NOT push publisher prose (headnotes) or images. It SHALL push per **source** in batches (the envelope's `source` names that source), stamping its `scraper_version` and targeted `contract_version`. When a source yields more than the shared-contract batch cap (`MAX_BATCH_ITEMS`) of items — notably a `backfill` over a large archive — the scraper SHALL split them into cap-sized batches and push each independently, marking a batch's URLs seen only after that batch succeeds so a mid-run failure re-tries only the unpushed tail. A push failure (network / non-2xx) SHALL be retried with backoff; the scraper's own already-pushed cursor is an optimization only, since the Worker dedups on arrival — a re-push is safe.

#### Scenario: Only functional facts are pushed

- **WHEN** an adapter extracts a recipe whose page also carries a headnote and photos
- **THEN** the pushed item carries only title/ingredients/instructions/times/source, not the prose or images

#### Scenario: Per-source batches carry machine version

- **WHEN** the scraper pushes recipes gathered from one source
- **THEN** it sends one batch tagged with that `source`, `scraper_version`, and `contract_version`

#### Scenario: A large backfill is split into cap-sized batches

- **WHEN** a `backfill` gathers more than `MAX_BATCH_ITEMS` recipes from one source
- **THEN** the scraper pushes them as several cap-sized batches, marking each batch's URLs seen only after it succeeds, rather than one oversized batch the endpoint would reject

### Requirement: The scraper provides operator CLI verbs and ships as a container

The scraper SHALL provide operator verbs — at minimum `login` (capture a session), `test` (dry-run an adapter against a URL, printing the wire-contract shape it would push and validating it locally), `backfill` (bulk-scrape a source's archive), and `run` (the recurring daemon) — and SHALL be distributed as a container image the operator runs with a mounted config/session volume and the ingest key supplied via the environment.

#### Scenario: Test dry-runs an adapter before going live

- **WHEN** the operator runs the `test` verb against a source and a URL
- **THEN** the scraper extracts that page and prints the wire-contract shape it would push, validating it locally without pushing

#### Scenario: The daemon runs from the container with a mounted volume

- **WHEN** the operator runs the container's `run` verb with the config/session volume mounted and the ingest key in the environment
- **THEN** the scraper polls its configured sources on schedule and pushes batches to the Worker
