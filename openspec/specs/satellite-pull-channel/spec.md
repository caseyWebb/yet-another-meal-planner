# satellite-pull-channel Specification

## Purpose
TBD - created by archiving change satellite-pull-channel. Update Purpose after archive.
## Requirements
### Requirement: The satellite pulls Worker-decided work; the Worker never pushes it

Work the Worker decides for a satellite (which stores to scan, which list to fill) SHALL be delivered by the satellite **pulling** it over a satellite-initiated outbound request, NOT by the Worker pushing it. The Worker SHALL expose only request/response endpoints for the channel and SHALL NEVER initiate a connection toward a satellite, SHALL NOT use a websocket or any Worker-initiated long-lived connection, and SHALL NOT place a stateful Worker or Durable Object on the channel's data path. This inherits the `satellite` capability's strictly-outbound-only requirement; a home box behind NAT SHALL require no inbound port for the pull channel to function.

#### Scenario: Queued work is delivered by a pull, not a push

- **WHEN** the Worker has work queued for a satellite
- **THEN** the work is delivered only when the satellite makes its outbound claim request; the Worker opens no connection toward the satellite and pushes nothing

#### Scenario: No inbound port is required for the pull channel

- **WHEN** a satellite runs on a home network behind NAT with no port forwarding
- **THEN** it can claim work and report results normally, because every channel interaction is an outbound request it initiates

### Requirement: Pull-channel routes are new key-authed paths added alongside the retained ingest endpoint

The pull channel SHALL be served by **new** paths under `/satellite/*` — a claim route (`POST /satellite/tasks/claim`) and a results route (`POST /satellite/results`) — added alongside `POST /admin/api/ingest`, which SHALL remain unchanged and SHALL NOT be moved or aliased away. Both `/satellite/*` routes SHALL be authenticated by the **same ingest-key** bearer mechanism the `recipe-ingestion` capability defines (the presented token hashed with SHA-256 and looked up against stored key hashes; a missing/unknown/revoked key rejected `401` with nothing persisted), and SHALL be subject to the same abusive-volume rate limit as the ingest route. Because `/satellite/*` is **not** an `/admin*` path, the Cloudflare Access gate (scoped to `/admin*`) SHALL NOT apply to it; the ingest-key auth is its sole gate. The claim route SHALL use `POST` (not `GET`) because claiming mutates queue state (it leases work).

#### Scenario: A satellite claims and reports over the new paths with its ingest key

- **WHEN** a satellite calls `POST /satellite/tasks/claim` or `POST /satellite/results` with a valid ingest key
- **THEN** the Worker authenticates it by the key hash and serves the request, while `POST /admin/api/ingest` continues to work unchanged for recipe-scrape pushes

#### Scenario: An unknown or revoked key is rejected on the pull channel

- **WHEN** a request to a `/satellite/*` route presents no bearer token, an unknown token, or a revoked key's token
- **THEN** the Worker responds `401` and neither claims nor persists anything

#### Scenario: The pull channel is not behind the Access gate

- **WHEN** a satellite calls a `/satellite/*` route carrying only its ingest key and no Cloudflare Access assertion
- **THEN** the request is served by the ingest-key auth, because `/satellite/*` is outside `/admin*` and the Access gate never applies to it

### Requirement: Tasks are a capability-tagged discriminated union with an open extension point

A pulled task SHALL be a **task envelope** carrying an opaque task `id`, a `kind` discriminant, its `scope` (`operator` | `tenant`), and a per-kind `payload`. The task `kind` SHALL be a **closed, extensible enumeration** with **no concrete kind defined by this capability** — it is the seam a later capability (e.g. sale-scan, order-fill) extends, exactly as the `satellite` capability's observation union is extended. The channel SHALL treat `payload` as opaque, interpreted only by the later capability that owns a `kind`. A consumer that handles only the currently-defined kinds SHALL continue to validate and process claim batches unchanged when a new `kind` is added later. The task envelope SHALL carry no derived conclusion — it instructs the satellite what to observe or prepare, never a judgment (sensor-not-judge, inherited from the `satellite` capability).

#### Scenario: A task envelope is a capability-tagged discriminated union

- **WHEN** the Worker returns a claimed task
- **THEN** it is an envelope `{ id, kind, scope, payload }` whose `kind` is the discriminant and whose `payload` the channel does not interpret

#### Scenario: A new task kind does not break the channel

- **WHEN** a later capability adds a new task `kind`
- **THEN** the claim/result contract and the queue accept it without a breaking change, and the channel keeps treating the payload as opaque

### Requirement: Results return as correlated observations reusing the raw-observation intake

A satellite SHALL report the outcome of a claimed task via `POST /satellite/results` carrying the `task_id`, a terminal `status` (`done` | `failed`), an optional failure `reason`, and — on success — an array of **observation items** in the `satellite` capability's observation discriminated union. The observations SHALL enter the **same raw-observation layer** as `POST /admin/api/ingest` — the same per-item validation, plausibility bounds, and arrival dedup — via shared intake logic (not a re-implementation); the Worker SHALL re-derive every conclusion from the reported observations and SHALL NOT trust any conclusion asserted by the satellite. A results report SHALL be correlated to its task by `task_id`; a `task_id` the Worker does not recognize SHALL yield a structured `not_found` with nothing persisted.

#### Scenario: A success report lands observations through the shared intake

- **WHEN** a satellite reports `{ task_id, status: "done", observations: [...] }` for a task it claimed
- **THEN** the observations pass through the same raw-observation validation and arrival-dedup as an ingest push, and the Worker re-derives conclusions rather than trusting any the satellite asserted

#### Scenario: An unrecognized task id is rejected

- **WHEN** a results report names a `task_id` that does not exist
- **THEN** the Worker responds with a structured `not_found` and persists nothing

### Requirement: The task queue has a claim/lease lifecycle in D1

The channel SHALL persist pending and in-flight work in a D1 task queue whose rows move through a lifecycle: `pending` → `claimed` → `done` (success) or `failed` (terminal). A claim SHALL lease a bounded batch of claimable rows to the claiming key, stamping the claiming key as owner, the claim time, and a lease expiry. A `claimed` row whose lease has expired SHALL be treated as claimable again. The queue and every read/write against it SHALL go through the Worker's `src/db.ts` prepared-statement helpers (structured errors, never a direct `env.DB` touch, never a throw). A claim SHALL never hand back more than its requested/needed bound, so a single claim stays within one Worker invocation's budget.

#### Scenario: A task advances from pending to done

- **WHEN** a task is enqueued, claimed by a satellite, and its successful result reported
- **THEN** the row moves `pending` → `claimed` → `done`, and it is not handed out again

#### Scenario: An expired lease makes a task claimable again

- **WHEN** a task was claimed but its lease expired before any result was reported
- **THEN** a subsequent claim treats the row as claimable and may re-lease it

### Requirement: Claiming is atomic and a dropped satellite degrades gracefully

A claim SHALL be **atomic** so two concurrent claims cannot both acquire the same row: the losing claim SHALL observe the row as already claimed (with a fresh lease) and skip it. When a satellite drops after claiming — reporting nothing — the Worker SHALL take **no** action toward the satellite (that would require an inbound connection, which is forbidden); the task's lease SHALL simply expire and the work SHALL remain in the queue for the next claim, the same "goes stale, no cascade" degradation as a stale flyer cache. The channel SHALL NOT require a Worker-initiated sweeper to recover dropped work; reclaim SHALL be driven lazily by the next claim.

#### Scenario: Two concurrent claims do not double-acquire a task

- **WHEN** two claim requests arrive that would both select the same pending task
- **THEN** exactly one acquires it (the row transitions to `claimed` atomically) and the other does not receive that task

#### Scenario: A dropped satellite leaves its work to be re-claimed

- **WHEN** a satellite claims work and then goes offline without reporting
- **THEN** the Worker initiates nothing toward it, the lease expires, and the work is re-claimed on a later poll — with no cascade beyond that task waiting

### Requirement: Correctness rests on idempotent results, not on the lease

The lease SHALL be an **optimization** to avoid needless concurrent double-work, NOT the channel's correctness mechanism. Because a claimed task may be run more than once (a lease expiring mid-work, then a re-claim, then a late report from the original claimer), the channel SHALL remain correct under a double-run: the result-side arrival dedup SHALL make repeated landings of the same observations safe, and the lifecycle transition SHALL be idempotent — reporting a terminal outcome for an already-terminal or re-claimed task SHALL be a safe no-op rather than an error or a duplicate effect. A satellite MAY report a task `failed` with a reason; the Worker SHALL count the attempt and return the task to claimable while attempts remain, or mark it terminal `failed` (parked and surfaced to the operator) once a bounded attempt cap is reached, so a poison task cannot loop forever.

#### Scenario: A double-run is safe because results dedup

- **WHEN** a task's lease expires, another satellite re-claims and completes it, and the original claimer later reports the same result
- **THEN** the repeated observations dedup on arrival and the lifecycle transition is a safe no-op, so no duplicate effect occurs

#### Scenario: A repeatedly failing task is parked, not looped

- **WHEN** a task is reported `failed` (or silently dropped) up to its attempt cap
- **THEN** it becomes terminal `failed`, surfaced to the operator, rather than being re-claimed indefinitely

### Requirement: Enqueue is idempotent per logical task key

The queue SHALL be populated by Worker-side producers (defined by later capabilities, not by this capability). Enqueue SHALL be **idempotent per a logical task key**: while a task for a given logical key is non-terminal (`pending` or `claimed`), a producer re-enqueuing the same logical key SHALL NOT create a second in-flight row. Once a task for that logical key reaches a terminal state (`done` or `failed`), the same logical key MAY be enqueued afresh. This capability SHALL define the generic enqueue contract and its idempotency only; it SHALL define no producer and no concrete task kind.

#### Scenario: A re-running producer does not stack duplicate in-flight tasks

- **WHEN** a producer enqueues a task whose logical key already has a non-terminal row
- **THEN** no second in-flight row is created (the in-flight task stands)

#### Scenario: A terminal logical key can be enqueued again

- **WHEN** a producer enqueues a logical key whose prior task has reached `done` or `failed`
- **THEN** a fresh task is enqueued for it (e.g. the next cycle's work)

### Requirement: Two auth scopes are derived from the claiming key's tenant binding

The work a claim returns SHALL be scoped by the claiming ingest key's tenant binding (`recipe-ingestion`). A key with **no** tenant binding (operator-global) SHALL be able to claim **operator-scope** tasks only. A key **bound to a tenant** SHALL be able to claim **operator-scope** tasks **and** that tenant's **tenant-scope** tasks, and SHALL NEVER be handed another tenant's tenant-scope tasks. Operator-scope work SHALL be public-derived and therefore claimable by any active key (bound or not); tenant-scope work SHALL be claimable only by a key bound to that same tenant. The claim SHALL additionally be filtered by the satellite's declared capabilities, so a satellite is handed only task kinds it runs.

#### Scenario: An operator-global key claims only operator-scope work

- **WHEN** an unbound (operator-global) key claims work
- **THEN** it receives only operator-scope tasks and never any tenant-scope task

#### Scenario: A tenant-bound key claims its own tenant's work plus operator-scope work

- **WHEN** a key bound to tenant `casey` claims work
- **THEN** it may receive operator-scope tasks and `casey`'s tenant-scope tasks, and never another tenant's tenant-scope tasks

### Requirement: Task tenancy honors the multi-tenancy invariant

The task queue SHALL honor the multi-tenancy invariant that every per-tenant table carries a `tenant` column: a **tenant-scope** task SHALL carry the owning tenant in its `tenant` column, and its claim eligibility and result attribution SHALL be confined to that tenant. An **operator-scope** task SHALL be **deliberately cross-tenant** (no owning tenant), the same public-derived cross-tenant posture as the Kroger flyer cache — permitted precisely because operator-scope work is store-wide/public-derived, not tenant-private. Downstream logic SHALL NOT serve a tenant-scope task, or its results, into any tenant other than its owner.

#### Scenario: A tenant-scope task carries its tenant and stays isolated

- **WHEN** a tenant-scope task is enqueued and later claimed and reported
- **THEN** its `tenant` column names the owning tenant and neither the task nor its results are served into another tenant

#### Scenario: Operator-scope work is intentionally cross-tenant

- **WHEN** an operator-scope task is enqueued
- **THEN** it carries no owning tenant and is claimable by any active key, consistent with the store-wide/public-derived, cross-tenant posture of the flyer cache

