## Context

Change 1 (`generalize-scraper-to-satellite`) renamed the home-network component to the **satellite**, generalized its wire contract to a capability-tagged, observations-only discriminated union (`CONTRACT_VERSION = "v2"`), and wrote the **sensor-not-judge** trust discipline into the living spec as capability-agnostic requirements — including the hard **outbound-only** constraint (the satellite calls out; the Worker never dials in; no inbound listener, no websocket, no stateful Worker / Durable Object on the data path). It deliberately kept the `ingest_*` DB names and the `POST /admin/api/ingest` path, and recorded that a later pull channel SHOULD **add** `/satellite/*` routes rather than move the existing one.

The satellite's two future jobs — **sale-scan** (read loyalty/in-store prices behind a store login) and **order-fill** (fill a cart on a store the Worker has no session for) — differ from recipe-scrape in a structural way: the satellite does not *discover* this work, the **Worker decides it**. Which stores/terms to scan is derived operator-wide (the flyer warm's `buildPlan` already does exactly this: the union of tenants' `preferred_location` labels → resolved `locationId`s × the `flyer_terms` table). Which list to fill is a specific tenant's resolved order. Under outbound-only, the Worker cannot hand this down as a push. This change builds the **pull channel** that lets the satellite fetch it — the channel only, not the two capabilities that fill and drain it.

**Production spike (read-only, `wrangler d1 execute grocery-mcp --remote`):**
- `ingest_keys` = **0**, `ingest_candidates` = **0**, `ingest_pushes` = **0** — no satellite key is provisioned; the additive `tenant` column and the new queue carry zero in-flight-data risk.
- `ingest_keys` schema today is exactly migration 0029 (`id, label, key_hash, key_prefix, created_at, last_used_at, status, last_scraper_version, last_contract_version`) — **no** tenant association exists, confirming an additive `ALTER TABLE … ADD COLUMN tenant TEXT` is the right extension.
- `flyer_terms` is `(term TEXT PRIMARY KEY)` (36 rows); `stores` is `(slug, name, domain, extra)`. `buildPlan` (in `src/flyer-warm.ts`) crosses `preferred_location → locationId` with those terms into `ScanUnit { locationId, term }` — the exact shape a future operator-scope scan-plan producer will enqueue. (Recorded for the design's analogy; **not** specified here.)

## Goals / Non-Goals

**Goals:**
- Let the satellite **pull** Worker-decided work over a satellite-initiated outbound request, holding the outbound-only line with no Worker push.
- One channel, capability-agnostic, that serves **both** future capabilities — an operator/cross-tenant scope (sale-scan plan) and a per-tenant scope (order-list).
- A D1 task queue with a claim/lease lifecycle that survives a polling, connectionless client: no double-run under normal operation, graceful degradation when a satellite drops.
- Extend the ingest key to carry an **optional** tenant binding **without breaking** the existing operator-global recipe-scrape keys.
- Keep the task/result payloads a clean discriminated union with the extension point open, mirroring change 1's observation union.

**Non-Goals:**
- No `sale-scan` or `order-fill` capability: no scan-plan producer, no order-list resolver, no `sale`/`order-status` observation kind, no scan/order/cart business logic. The task-`kind` union has **zero** concrete arms here.
- No change to the recipe-scrape push path (`/admin/api/ingest` is untouched and unmoved).
- No inbound path of any kind; no websocket / Durable Object / stateful Worker (that would violate the `satellite` capability's outbound-only requirement).
- No manual production data surgery — the queue converges organically.

## Decisions

### 1. Pull, not push — and why a POST claim, not a GET

The satellite is outbound-only, so the Worker cannot initiate. The satellite therefore **claims** work: it makes an outbound request, the Worker returns a leased batch, the satellite does the work locally and reports back. This is the only shape consistent with the `satellite` capability's outbound-only requirement; a pull channel is precisely what that requirement's "(in a later capability) work to fetch" scenario anticipated.

The claim is a **`POST`, not a `GET`**, because claiming **mutates** state (it leases tasks, stamping owner + expiry). A `GET` that leased rows would violate HTTP safe-method semantics and be unsafe to cache/retry. The prompt sketched a "GET to fetch a task list"; the deliberate refinement to `POST /satellite/tasks/claim` keeps the fetch honest about its side effect while preserving the pull model in full — it is still a satellite-initiated outbound request; the outbound-only invariant is about *who initiates the connection*, not the HTTP verb.

### 2. Endpoint shape: one unified claim + one unified result, under `/satellite/*`

```
POST /satellite/tasks/claim   { capabilities: string[], max?: number }  → { tasks: TaskEnvelope[] }
POST /satellite/results       { task_id, status: "done"|"failed", reason?, observations?: ObservationItem[] }  → { task, results? }
```

- **`/admin/api/ingest` is unchanged and unmoved** — recipe-scrape stays a push (the satellite discovers recipes on its own schedule; there is no task to claim for it). The pull channel is additive, exactly as change 1's decision 3 prescribed ("add new `/satellite/*` paths … never move the existing one").
- **`/satellite/*` is outside `/admin*`**, so the Cloudflare Access gate — which is scoped to `/admin*` — never applies to it. Auth is the **same ingest-key** bearer mechanism (SHA-256 hash lookup, rate-limited) `recipe-ingestion` already defines; the key is the satellite's single credential across both its push (`/admin/api/ingest`) and pull (`/satellite/*`) surfaces. This means the `operator-admin` "Access gate" requirement and the `recipe-ingestion` "carve-out" requirement need **no** modification: they scope the carve-out to `/admin/api/ingest` among `/admin*` paths, and `/satellite/*` is simply not an `/admin*` path.
- **One unified claim over split `/satellite/scan-plan` + `/satellite/order-list`:** the split would leak the not-yet-specified capabilities into the channel's endpoint surface (this change is channel-only) and force a new route per future capability. A single claim endpoint returning a capability-tagged discriminated union — with the **scope** derived from the key and the **kind** filtered by the satellite's declared `capabilities` — keeps the channel capability-agnostic and mirrors change 1's "one intake path that fans on `kind`" decision. Adding `sale-scan`/`order-fill` later adds task *kinds* and *producers*, not endpoints.
- **`/satellite/results` reuses the ingest intake.** Its `observations[]` go through the **same** raw-observation persistence, per-item validation, and arrival-dedup as `/admin/api/ingest` (a shared helper, not a re-implementation), then it transitions the task's lifecycle. Keeping it on a distinct `/satellite/*` path (rather than bolting an optional `task_id` onto `/admin/api/ingest`) leaves the recipe push path exactly as-is and makes the lifecycle transition explicit to the pull channel.

### 3. The key's tenant-association model (two scopes, one mechanism)

An ingest key gains an **optional** `tenant` column (nullable; additive):

| key binding            | may claim operator-scope work | may claim tenant-scope work |
|------------------------|-------------------------------|-----------------------------|
| `tenant = NULL` (operator-global) | yes | none |
| `tenant = <id>`        | yes | only `<id>`'s |

- **Existing recipe-scrape keys are unbroken.** They stay `tenant = NULL` (operator-global) — the additive column defaults to NULL, so every already-minted key keeps its current meaning and its push path is untouched. Recipe-scrape does not use the pull channel at all.
- **Operator-scope work is claimable by any active key** (including a tenant-bound one). The sale-scan plan is **public-derived** (store-wide sale prices, keyed by `locationId`, exactly like the flyer cache is the one deliberately cross-tenant cache), so it is not tenant-private and a tenant-bound satellite reporting a store's prices is fine. This matches the roadmap's "sale-scan is operator/cross-tenant."
- **Tenant-scope work is claimable only by a key bound to that tenant** — the order-list is that tenant's own resolved shopping list, and a tenant-run satellite holds only that tenant's store sessions. A key never sees another tenant's tenant-scope work. This is the per-tenant scope.

The binding is set **at mint** (operator chooses operator-global or a specific allowlisted tenant) and is immutable for the key's life (re-mint to change it), keeping the model simple and the key's authority legible. The tenant selected at mint is resolved against the same allowlist the rest of `/admin*` uses.

### 4. The D1 queue and the claim/lease lifecycle

New table (sketch — the migration owns exact DDL):

```sql
CREATE TABLE satellite_tasks (
  id                TEXT PRIMARY KEY,                 -- opaque task id
  kind              TEXT NOT NULL,                    -- discriminated-union discriminant (no concrete kinds yet)
  scope             TEXT NOT NULL,                    -- 'operator' | 'tenant'
  tenant            TEXT,                             -- NULL for operator-scope; the tenant id for tenant-scope
  dedup_key         TEXT NOT NULL,                    -- logical identity for idempotent enqueue
  payload           TEXT NOT NULL,                    -- JSON task body (opaque to the channel)
  status            TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'claimed' | 'done' | 'failed'
  claimed_by        TEXT,                             -- ingest key id holding the lease
  claimed_at        INTEGER,                          -- epoch ms
  lease_expires_at  INTEGER,                          -- epoch ms; a claimed row past this is re-claimable
  attempts          INTEGER NOT NULL DEFAULT 0,
  max_attempts      INTEGER NOT NULL DEFAULT 3,
  last_error        TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);
CREATE INDEX satellite_tasks_claimable ON satellite_tasks (status, scope, tenant, kind, created_at);
-- idempotent enqueue: at most one non-terminal row per logical key
CREATE UNIQUE INDEX satellite_tasks_dedup ON satellite_tasks (dedup_key) WHERE status IN ('pending', 'claimed');
```

**Lifecycle:** `pending → claimed → done` (success) or `→ failed` (terminal after `max_attempts`). A claim also picks up a `claimed` row whose `lease_expires_at` is in the past (an expired lease is treated as re-claimable).

**Claim (atomic).** D1 is SQLite (single-writer, statements serialized), so the claim is one conditional `UPDATE … RETURNING`:

```sql
UPDATE satellite_tasks
   SET status='claimed', claimed_by=?, claimed_at=?, lease_expires_at=?, attempts=attempts+1, updated_at=?
 WHERE id IN (
   SELECT id FROM satellite_tasks
    WHERE (status='pending' OR (status='claimed' AND lease_expires_at < ?))
      AND kind IN (<declared capabilities>)
      AND ( scope='operator' OR (scope='tenant' AND tenant = <key tenant>) )
    ORDER BY created_at
    LIMIT ?
 )
RETURNING *;
```

Because the whole statement is atomic, two concurrent polls cannot both grab the same row — the second sees it already `claimed` (with a fresh lease) and skips it. The `RETURNING` gives the claimer exactly the rows it leased.

**Graceful degradation.** If the satellite drops (never reports), the lease simply expires and the next poll re-claims the task. The Worker performs **no** recovery action toward the satellite (that would require dialing in — forbidden). A dropped satellite leaves its work pending, healed on the next poll — the same "just goes stale, no cascade" posture as a stale flyer. No cron sweeper is required; reclaim is lazy, driven by the next claim.

### 5. Claim/idempotency correctness rests on result-side dedup, not the lock

The lease prevents *needless* double-work, but it is **not** the correctness mechanism — there is no long-lived connection to hold a lock, and a lease can expire mid-work. Correctness comes from the **result side being idempotent**, inherited straight from change 1:

- Results are **observations** that enter the raw-observation layer, which **dedups on arrival**. So if task T is claimed by satellite A, A's lease expires, B re-claims and runs T, and A *then* finally reports — both result POSTs dedup to the same landed observations. A double-run is **safe**, exactly as change 1 states ("the already-pushed cursor is an optimization only, since the Worker dedups on arrival — a re-push is safe").
- The lifecycle transition is idempotent: reporting `done` for an already-`done` (or re-claimed) task is a no-op-safe terminal write; an unknown `task_id` is a structured `not_found` with nothing persisted.

So the lease is an **optimization** (avoid running the same task twice concurrently), and the raw-observation dedup is the **guarantee**. This is the sensor-not-judge discipline doing double duty: because the Worker re-derives from deduped raw observations, the channel does not need distributed locking.

**Failure & poison-task cap.** A satellite MAY report `{ status: "failed", reason }` (e.g. its session expired, the source was unreachable). The Worker increments `attempts`; below `max_attempts` the task returns to `pending`/re-claimable, at or above it the task is terminal `failed` (parked and surfaced to the operator), so a poison task cannot loop forever — mirroring the discovery-retry attempt cap. A silent drop (no report) is the lease-expiry path and counts an attempt on the next claim.

### 6. Idempotent enqueue (producers are later capabilities)

The queue is populated by Worker-side **producers** defined by the later capabilities (a scan-plan cron; an order-list resolver) — **not** here. This change defines only the generic enqueue contract: an enqueue is **idempotent per `dedup_key`** while work is in flight — the partial-unique index admits at most one non-terminal row per logical key, so a producer that re-runs (a fresh scan sweep, a re-resolved order) does not stack duplicate in-flight tasks. Once a task reaches a terminal state, the same `dedup_key` may be enqueued afresh (next sweep's scan of the same unit). No producer, and no concrete `kind`, is specified in this change.

### 7. Task tenancy honors the multi-tenancy invariant

The multi-tenancy contract requires every per-tenant D1 table to carry a `tenant` column. `satellite_tasks` carries one: tenant-scope rows set it to the owning tenant; operator-scope rows set it `NULL`. Operator-scope work is **deliberately cross-tenant** — the same blessed posture as the Kroger flyer cache (public-derived, keyed by `locationId`, the one deliberately cross-tenant cache). A tenant-scope task is claimable and its results attributable only within its tenant. This reuses the multi-tenancy invariant rather than changing it, so `multi-tenancy` needs no delta. The key's tenant *binding* is an extension of `recipe-ingestion`'s key model (ingest keys are a `recipe-ingestion` concern, authenticated separately from the OAuth bearer that `multi-tenancy` governs), so that is where the binding is specified.

### 8. The task/result contract mirrors change 1's observation union

```ts
// Task envelope — a discriminated union keyed by `kind`. NO concrete arm here;
// sale-scan / order-fill add arms later, exactly as the observation union does.
export type TaskEnvelope = {
  id: string;
  kind: string;          // the discriminant; closed extensible set, empty today
  scope: "operator" | "tenant";
  // payload fields are per-kind, added by the later capabilities
};

// Claim request carries the satellite's declared capabilities (per the `satellite`
// capability's capability-declaration model) so the Worker hands back only runnable kinds.
export type ClaimRequest  = { capabilities: string[]; max?: number };
export type ClaimResponse = { tasks: TaskEnvelope[] };

// Results reuse the change-1 observation union, correlated by task id.
export type ResultRequest = {
  task_id: string;
  status: "done" | "failed";
  reason?: string;                 // on failure
  observations?: ObservationItem[]; // the change-1 discriminated union (recipe today; sale/order later)
};
```

A consumer that handles only today's (zero) kinds keeps validating batches unchanged when a `kind` is added later — the same forward-compat guarantee change 1's observation union carries. The channel treats `payload` as opaque; only the later capability that owns a `kind` interprets it.

## Model identity

No model id (name or string) appears anywhere in this change — not in the contract, the spec, the queue, the docs, or the roadmap notes. Any derivation over pulled results is described by role ("the Worker re-derives", "the on-cron classifier"), never by model identity, consistent with the repo convention and change 1's own model-identity note.

## Risks / Trade-offs

- **A GET-shaped mental model vs a POST claim.** The prompt sketched a GET; a claim mutates, so it is a POST. *Mitigation:* documented rationale (decision 1); the pull model and outbound-only are fully preserved — only the verb reflects the side effect.
- **Speculative abstraction (a channel with zero task kinds).** The union has no concrete arms today. *Mitigation:* the cost is one `kind` discriminant + an opaque `payload`; the queue/lifecycle/scoping are all independently useful and testable with a synthetic kind, and the seam is the whole point (changes 3/4 plug in without re-litigating the channel). This mirrors change 1 shipping the observation union with a single arm.
- **Lease tuning (too short re-runs live work; too long stalls a dropped task).** *Mitigation:* correctness does not depend on the lease (decision 5 — result-side dedup guarantees safety); the lease only trades needless double-work against reclaim latency, so it can be tuned freely without risking correctness.
- **A GET/POST on an open, key-authed route is abuse surface.** *Mitigation:* the same rate limit `recipe-ingestion` already applies to the key-authed ingest route covers `/satellite/*`; an unknown/revoked key is `401` and claims/returns nothing.
- **Empty-claim churn (a satellite polling with no work queued).** *Mitigation:* a claim with no matching rows is a single cheap indexed read returning `{ tasks: [] }` — the "idle no-op" posture the flyer warm already embraces; the satellite backs off between polls.
- **A key's immutable binding.** Re-mint to rebind. *Mitigation:* keeps the key's authority legible and avoids a rebind path that could silently widen a key's reach; minting is cheap and already shown-once.
