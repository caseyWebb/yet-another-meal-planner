## RENAMED Requirements

- FROM: `### Requirement: Discovery area has a Scrapers liveness sub-tab`
- TO: `### Requirement: Discovery area has a Satellites liveness sub-tab`

- FROM: `### Requirement: Status area shows ingest scrapers`
- TO: `### Requirement: Status area shows ingest satellites`

## MODIFIED Requirements

### Requirement: Discovery candidate progression track

The candidate-card progression track SHALL render the `discovery-sweep` pipeline's 7 stages, in order — **triage** (cheap taste pre-filter), **acquire** (fetch + parse), **classify** (env.AI classification), **describe** (description generation + embed), **dedup** (near-duplicate cosine), **match** (taste cosine + dietary gate + LLM confirm), **import** (assemble, validate, write) — as a connected horizontal sequence. Each stage prior to the candidate's halt point SHALL render as passed (a check mark). The halt-point stage SHALL render distinctly by outcome kind: an imported candidate's final stage (`import`) renders as passed, not halted; a rejection (`no_match`, `dietary_gated`, `rejected_source`, `duplicate`) renders its halt stage with a stop indicator; a park or infrastructure failure (`error`, `failed`) renders its halt stage with a failure indicator; a rate-cap deferral (`deferred`) renders its halt stage with a hold indicator. Every stage after the halt point SHALL render as not-yet-reached.

For a **pushed** candidate (one that arrived via `/admin/api/ingest`, carrying `pushed`/`origin` on its log row), the **acquire** stage SHALL render as **arrived-via-push** — a distinct satisfied-by-push state (with an inbox glyph), NOT a fetch check — in both the mini track and the expanded stage list, and the candidate card SHALL carry a `satellite: <origin>` provenance badge. A pushed candidate therefore never halts at `acquire`; its earliest possible halt is `classify`.

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
- **THEN** its `acquire` stage renders as arrived-via-push (satisfied, not a fetch), the card carries a `satellite: <origin>` badge, and its earliest halt is `classify`

#### Scenario: A deferred candidate shows a hold, not a failure, at import

- **WHEN** a candidate's outcome is `deferred`
- **THEN** the track shows every stage through `match` as passed and `import` as a held (not failed) halt point

### Requirement: Config area hosts an Ingest Keys editor

The admin **Config** area SHALL host an **Ingest Keys** editor (an island that mutates via `/admin/api/*`) for managing the home-network satellite ingest keys (`recipe-ingestion`). It SHALL list keys in a table — satellite label + key prefix, configured/observed sources, created, last-used (a muted "never" when unused), and status (`active`/`revoked`) — and provide a **Mint key** action that takes a label and reveals the new secret **once** in a callout with a copy control and a "shown once — you won't see it again" warning, mirroring the invite-code flow (the row persists showing only the prefix; the secret is not stored). Each active key SHALL have a **Revoke** action behind a destructive confirm. An empty roster SHALL render an explanatory empty state.

#### Scenario: Minting reveals the secret once

- **WHEN** the operator mints an ingest key with a label
- **THEN** the editor shows the full secret once in a copyable callout with a shown-once warning, and thereafter the row shows only the prefix

#### Scenario: Revoke is confirmed and immediate

- **WHEN** the operator revokes a key and confirms the destructive dialog
- **THEN** the key's status becomes `revoked` and it can no longer authenticate a push

#### Scenario: Empty roster shows guidance

- **WHEN** no ingest keys exist
- **THEN** the editor shows an empty state explaining what a satellite is and how to mint the first key

### Requirement: Discovery area has a Satellites liveness sub-tab

The admin **Discovery** area SHALL present **Candidates | Satellites** sub-tabs. The **Satellites** sub-tab SHALL be a read-only (pure SSR) view showing: a **liveness** section with one card per active satellite (machine) carrying its overall health badge in the `/health` posture language (`fresh`/`stale`/`never`), its last-push relative time, its reported satellite + contract version with a **skew** chip when the machine's contract is behind the Worker's, and a per-source breakdown (each source's own health dot, last push, and 24h count); a **throughput funnel** (Received → Accepted → Deduped on arrival → handed to sweep, then the downstream pipeline outcomes Imported / No-match / Duplicate / Parked, reusing the Discovery outcome vocabulary); and a **recent-pushes** log (when · satellite · source · batch count · result, where result is `accepted` / `partially-deduped` / `rejected-bad-payload` / `rejected-bad-key`). The **Candidates** sub-tab SHALL additionally show a compact **ingest strip** ("N satellites · X fresh · Y pushed today →") that turns to a warning tone on any stale satellite or version skew and links to the Satellites sub-tab.

#### Scenario: A machine's liveness and skew are visible

- **WHEN** the operator opens Discovery › Satellites
- **THEN** each active satellite shows its health, last-push time, per-source breakdown, and a skew chip when its contract version is behind the Worker's

#### Scenario: The candidates ingest strip warns on staleness

- **WHEN** any satellite is stale or on a behind contract version
- **THEN** the Candidates sub-tab's ingest strip renders in a warning tone and links to the Satellites sub-tab

### Requirement: Status area shows ingest satellites

The admin **Status** homepage SHALL include an **Ingest satellites** section listing, per active satellite, its health glyph, configured-sources count, last-push relative time, 24h push count, and a contract-skew warning when behind — so the service-health home reflects whether the home-network satellites are alive without opening the Discovery area.

#### Scenario: A stale satellite is visible from Status

- **WHEN** a satellite has not pushed within the fresh window
- **THEN** the Status page's Ingest satellites section shows it with a stale glyph and its last-push time
