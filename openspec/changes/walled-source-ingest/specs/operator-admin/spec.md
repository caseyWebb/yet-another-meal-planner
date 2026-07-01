## MODIFIED Requirements

### Requirement: Operator admin surface gated by Cloudflare Access

The Worker SHALL serve an operator admin surface under `/admin` (a static UI) and `/admin/api/*` (its operations), gated by **Cloudflare Access** scoped to that path — not by the Worker's MCP OAuth provider and not by a shared application secret. The Worker SHALL verify the `Cf-Access-Jwt-Assertion` header on every `/admin*` request: the JWT signature against the team's Access JWKS, and its `aud` against the configured application audience. A request lacking a valid, audience-matched assertion SHALL be rejected (`403`) and SHALL reach no admin operation.

**The single exception is `POST /admin/api/ingest`** (see `recipe-ingestion`): this one route SHALL be an explicit, allowlisted exemption from the Access gate, authenticated instead by a bearer **ingest key**, because a headless home-network scraper carries no Access JWT. The exemption SHALL be scoped to that exact path and method; every other `/admin*` path SHALL remain Access-gated. A request presenting an ingest key to any other `/admin*` path SHALL be rejected `403` by the Access gate (the ingest key is not admin credentials).

When `ACCESS_ALLOWED_EMAILS` (a comma-separated allowlist of operator addresses) is configured, the Worker SHALL additionally require the verified `email` claim to match one of the listed addresses, compared case-insensitively and trimmed; a verified assertion whose `email` claim is absent or not on the list SHALL be rejected (`403`). When `ACCESS_ALLOWED_EMAILS` is unset, any assertion that passes signature/`aud`/issuer verification SHALL be admitted (the prior behavior, unchanged). `ACCESS_ALLOWED_EMAILS` is an optional, non-secret var; the allowlisted addresses SHALL NOT be exposed by any open surface.

The admin surface SHALL be **opt-in**: when the Access configuration (`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`) is unset, `/admin*` SHALL respond `404`, exposing nothing — **except** `POST /admin/api/ingest`, whose availability is gated on ingest keys existing, not on Access configuration. Any local-development bypass of the gate SHALL be confined to **loopback** request hosts (`localhost` / `127.0.0.1` / `::1`): in a deployed (non-loopback) context the admin surface SHALL NOT be served without a verified assertion even if a bypass flag is set, so an unconfigured deployment can never expose the surface. When a loopback bypass engages, the Worker SHALL emit a warning log.

The Access gate SHALL apply to the admin surface **only**; the MCP surface SHALL continue to use the Worker's own OAuth provider, preserving the rule that the MCP-surface identity does not rely on Cloudflare Access.

#### Scenario: Valid Access session reaches the admin surface

- **WHEN** a request to `/admin` or `/admin/api/*` carries a `Cf-Access-Jwt-Assertion` that verifies against the team JWKS with the configured audience, and `ACCESS_ALLOWED_EMAILS` is unset
- **THEN** the Worker serves the admin UI or runs the requested admin operation

#### Scenario: Missing or invalid assertion is rejected

- **WHEN** a request to `/admin*` (other than the ingest route) arrives with no `Cf-Access-Jwt-Assertion`, a bad signature, or a non-matching `aud`
- **THEN** the Worker responds `403` and runs no admin operation

#### Scenario: The ingest route is key-authed, not Access-gated

- **WHEN** a scraper POSTs `/admin/api/ingest` with a valid ingest key and no Access assertion
- **THEN** the Worker authenticates it by the key and runs the ingest operation, bypassing the Access gate for this one route only

#### Scenario: An ingest key cannot open the rest of the admin surface

- **WHEN** a request presents an ingest key (and no Access assertion) to any `/admin*` path other than `POST /admin/api/ingest`
- **THEN** the Access gate rejects it `403`

#### Scenario: Email on the allowlist is admitted

- **WHEN** `ACCESS_ALLOWED_EMAILS` is configured and a request carries a valid, audience-matched assertion whose `email` claim matches a listed address (case-insensitively)
- **THEN** the Worker serves the admin UI or runs the requested admin operation

#### Scenario: Verified assertion off the allowlist is rejected

- **WHEN** `ACCESS_ALLOWED_EMAILS` is configured and a request carries a valid, audience-matched assertion whose `email` claim is absent or not on the list
- **THEN** the Worker responds `403` and runs no admin operation

#### Scenario: Admin surface disabled when unconfigured

- **WHEN** `ACCESS_TEAM_DOMAIN` or `ACCESS_AUD` is unset
- **THEN** `/admin*` responds `404`, exposing no admin UI or operation (other than the ingest route's own key-gated availability)

#### Scenario: Dev bypass serves the panel only on loopback

- **WHEN** the Access vars are unset, the dev bypass flag is set, and the request host is loopback (`localhost` / `127.0.0.1` / `::1`)
- **THEN** the Worker serves the admin surface and emits a warning log

#### Scenario: Dev bypass cannot open a deployed surface

- **WHEN** the Access vars are unset and the dev bypass flag is set, but the request host is not loopback (a deployed context)
- **THEN** `/admin*` responds `404` and the admin surface is not served

#### Scenario: The MCP surface is not gated by Access

- **WHEN** the Access application is configured for `/admin*`
- **THEN** `/mcp`, `/authorize`, and `/oauth/*` remain reachable through the Worker's own OAuth provider, unaffected by the Access gate

### Requirement: Discovery candidate progression track

The candidate-card progression track SHALL render the `discovery-sweep` pipeline's 7 stages, in order — **triage** (cheap taste pre-filter), **acquire** (fetch + parse), **classify** (env.AI classification), **describe** (description generation + embed), **dedup** (near-duplicate cosine), **match** (taste cosine + dietary gate + LLM confirm), **import** (assemble, validate, write) — as a connected horizontal sequence. Each stage prior to the candidate's halt point SHALL render as passed (a check mark). The halt-point stage SHALL render distinctly by outcome kind: an imported candidate's final stage (`import`) renders as passed, not halted; a rejection (`no_match`, `dietary_gated`, `rejected_source`, `duplicate`) renders its halt stage with a stop indicator; a park or infrastructure failure (`error`, `failed`) renders its halt stage with a failure indicator; a rate-cap deferral (`deferred`) renders its halt stage with a hold indicator. Every stage after the halt point SHALL render as not-yet-reached.

For a **pushed** candidate (one that arrived via `/admin/api/ingest`, carrying `pushed`/`origin` on its log row), the **acquire** stage SHALL render as **arrived-via-push** — a distinct satisfied-by-push state (with an inbox glyph), NOT a fetch check — in both the mini track and the expanded stage list, and the candidate card SHALL carry a `scraper: <origin>` provenance badge. A pushed candidate therefore never halts at `acquire`; its earliest possible halt is `classify`.

The halt stage for a candidate SHALL be derived from its stored `outcome` and `detail` (no schema change): `imported` halts at `import` (passed); `no_match` halts at `triage` when `detail.stage` is `"triage"`, otherwise at `match`; `dietary_gated` halts at `match`; `rejected_source` halts at `triage`; `duplicate` halts at `dedup`; `deferred` halts at `import` (held, not failed); `error` halts at `acquire` when `detail.reason` is one of the acquisition-park taxonomy (`unreachable`, `no_jsonld`, `not_a_recipe`, `incomplete`), at `classify` when `detail.reason` describes a classification failure, or at `import` when `detail.reason` describes an import-time failure; `failed` (an infrastructure failure) renders at `acquire` as a labeled approximation, since the pipeline's catch-all failure handler does not record which stage was active.

#### Scenario: A triage rejection shows no stages passed

- **WHEN** a candidate's outcome is `no_match` with `detail.stage` `"triage"`
- **THEN** the track shows `triage` as the halt point with zero prior stages passed

#### Scenario: A match-stage rejection shows triage and acquire through describe as passed

- **WHEN** a candidate's outcome is `dietary_gated`
- **THEN** the track shows `triage`, `acquire`, `classify`, `describe`, and `dedup` as passed, and `match` as the halt point

#### Scenario: An acquire-park shows only triage as passed

- **WHEN** a candidate's outcome is `error` with `detail.reason` `"unreachable"`
- **THEN** the track shows `triage` as passed and `acquire` as the halt point with a failure indicator

#### Scenario: A pushed candidate shows acquire as arrived-via-push

- **WHEN** a candidate has `pushed` set on its log row
- **THEN** its `acquire` stage renders as arrived-via-push (satisfied, not a fetch), the card carries a `scraper: <origin>` badge, and its earliest halt is `classify`

#### Scenario: A deferred candidate shows a hold, not a failure, at import

- **WHEN** a candidate's outcome is `deferred`
- **THEN** the track shows every stage through `match` as passed and `import` as a held (not failed) halt point

## ADDED Requirements

### Requirement: Config area hosts an Ingest Keys editor

The admin **Config** area SHALL host an **Ingest Keys** editor (an island that mutates via `/admin/api/*`) for managing the home-scraper ingest keys (`recipe-ingestion`). It SHALL list keys in a table — scraper label + key prefix, configured/observed sources, created, last-used (a muted "never" when unused), and status (`active`/`revoked`) — and provide a **Mint key** action that takes a label and reveals the new secret **once** in a callout with a copy control and a "shown once — you won't see it again" warning, mirroring the invite-code flow (the row persists showing only the prefix; the secret is not stored). Each active key SHALL have a **Revoke** action behind a destructive confirm. An empty roster SHALL render an explanatory empty state.

#### Scenario: Minting reveals the secret once

- **WHEN** the operator mints an ingest key with a label
- **THEN** the editor shows the full secret once in a copyable callout with a shown-once warning, and thereafter the row shows only the prefix

#### Scenario: Revoke is confirmed and immediate

- **WHEN** the operator revokes a key and confirms the destructive dialog
- **THEN** the key's status becomes `revoked` and it can no longer authenticate a push

#### Scenario: Empty roster shows guidance

- **WHEN** no ingest keys exist
- **THEN** the editor shows an empty state explaining what a scraper is and how to mint the first key

### Requirement: Discovery area has a Scrapers liveness sub-tab

The admin **Discovery** area SHALL present **Candidates | Scrapers** sub-tabs. The **Scrapers** sub-tab SHALL be a read-only (pure SSR) view showing: a **liveness** section with one card per active scraper (machine) carrying its overall health badge in the `/health` posture language (`fresh`/`stale`/`never`), its last-push relative time, its reported scraper + contract version with a **skew** chip when the machine's contract is behind the Worker's, and a per-source breakdown (each source's own health dot, last push, and 24h count); a **throughput funnel** (Received → Accepted → Deduped on arrival → handed to sweep, then the downstream pipeline outcomes Imported / No-match / Duplicate / Parked, reusing the Discovery outcome vocabulary); and a **recent-pushes** log (when · scraper · source · batch count · result, where result is `accepted` / `partially-deduped` / `rejected-bad-payload` / `rejected-bad-key`). The **Candidates** sub-tab SHALL additionally show a compact **ingest strip** ("N scrapers · X fresh · Y pushed today →") that turns to a warning tone on any stale scraper or version skew and links to the Scrapers sub-tab.

#### Scenario: A machine's liveness and skew are visible

- **WHEN** the operator opens Discovery › Scrapers
- **THEN** each active scraper shows its health, last-push time, per-source breakdown, and a skew chip when its contract version is behind the Worker's

#### Scenario: The candidates ingest strip warns on staleness

- **WHEN** any scraper is stale or on a behind contract version
- **THEN** the Candidates sub-tab's ingest strip renders in a warning tone and links to the Scrapers sub-tab

### Requirement: Status area shows ingest scrapers

The admin **Status** homepage SHALL include an **Ingest scrapers** section listing, per active scraper, its health glyph, configured-sources count, last-push relative time, 24h push count, and a contract-skew warning when behind — so the service-health home reflects whether the home-network scrapers are alive without opening the Discovery area.

#### Scenario: A stale scraper is visible from Status

- **WHEN** a scraper has not pushed within the fresh window
- **THEN** the Status page's Ingest scrapers section shows it with a stale glyph and its last-push time
