# Design — satellite-sale-scan

## Context

Two bare seams landed on `main` and this change is their first concrete filler:

- **The observation union** (`satellite`, change 1) is a discriminated union keyed by item `kind`; today only `recipe` exists. The satellite reports **only independently-checkable facts** and carries **no wire field for a derived value the Worker cares about** — every conclusion is re-derived by the Worker. Change 1 even wrote the forward-looking scenario: *"a future capability needs a Worker-relevant derived quantity (e.g. a saving) → the contract carries only the raw measurements it is derived from, and the Worker computes the derived quantity itself."* `sale` realizes it.
- **The task union** (`satellite-pull-channel`, change 2) is a `TaskEnvelope { id, kind, scope, payload }` with **no concrete kind**, an operator/tenant scope, an atomic-claim/lease D1 queue (`satellite_tasks`), idempotent enqueue per `dedup_key`, result-side arrival dedup as the correctness mechanism, and two auth scopes derived from the claiming key's tenant binding. Operator-scope work is "public-derived, cross-tenant, the same posture as the Kroger flyer cache."

Grounding read from production (`CLOUDFLARE_API_TOKEN` present):
- The rollup lives in `KROGER_KV` as `flyer:{locationId}` → `{ sweep_id, as_of, items: FlyerItem[] }` (verified `flyer:03500493` → `{"sweep_id":"1782972605791","as_of":1782973505310,"items":[]}`). Kroger-only, **no store prefix**. `flyer:cursor` / `flyer:plan` are the sweep's internal state.
- `flyer_terms` is `(term TEXT PRIMARY KEY)` — a flat global set ("fruit", "berries", "ground beef", …). `stores` is `(slug, name, domain, extra)` and is **empty in production**. A tenant's preferred store lives in `profile.stores` (JSON) as `preferred_location` (+ a `primary` slug menu-gen reads as `preferences[stores].primary == "kroger"`).
- `satellite_tasks` exists (change 2, migration `0037`) with the CHECK `((scope='operator' AND tenant IS NULL) OR (scope='tenant' AND tenant IS NOT NULL))` and the partial-unique `dedup_key WHERE status IN ('pending','claimed')` idempotency index. The satellite package does **not** yet consume the pull channel (change 2 was Worker-side only).
- `HEALTH_JOBS` in `src/health.ts` is a hardcoded const the `/health` endpoint + admin Status card enumerate.

## Goals / Non-goals

**Goals.** Let the satellite scan walled loyalty/in-store sale prices and feed them into menu-gen the same way Kroger flyer sales flow, exercising changes 1–2 end-to-end: raw `sale` observations → Worker re-derivation → the store-namespaced rollup → a store-aware read. Everything deterministic stays in the Worker; the satellite is a sensor.

**Non-goals.** Order-fill (change 4): no cart, no `order-status`, no tenant-scope task. Sensor-audit/quarantine (change 5): no sampling, no quarantine surface — only the raw `sale` validation + provenance that a later audit would sample. No new store-specific term set (reuse `flyer_terms`). No built-in named-retailer sale adapter (ToS-hostile → operator-authored).

## Decision 1 — the `sale` observation shape (raw facts, never a saving)

```
{ kind: "sale",
  store, locationId,             // provenance + rollup key (raw strings the satellite observed)
  productId,                     // provenance / dedup identity within a store (spot-checkable)
  description,                   // human product label
  size?,                         // optional pack size string ("12 oz"); parsed by the existing unit-price code
  regular, promo,               // RAW prices as observed on the shelf/loyalty page
  brand?, categories?, url? }    // optional; url is the product page for spot-checkability
```

There is **no `savings` / `savings_pct` on the wire** — that is the whole point of the sensor-not-judge line. The Worker re-derives it with the *existing* single source of truth: `isOnSale` (`promo > 0 && promo < regular` — a real discount, excluding Kroger's `promo == regular` non-sale echo), `savings = round((regular - promo) * 100) / 100`, and the caller's `min_savings_pct` **deal floor applied at read** (`filterByMinSavings`), never stored. A `sale` observation and a Kroger scan of the same product therefore derive an identical `FlyerItem`; downstream cannot tell them apart except by provenance. This is deliberately the same `{ regular, promo }` shape a `KrogerCandidate` price carries, so the rollup layer is reused verbatim.

**Why `productId` not `sku`.** The `FlyerItem` field is `sku` (Kroger's productId). The wire field is named `productId` to be store-neutral (a loyalty site's item id), mapped to `FlyerItem.sku` at intake — the merge/dedup identity within a store.

## Decision 2 — the `sale-scan` task (operator-scope, `{ store, locationId, terms }`)

`kind: "sale-scan"`, `scope: "operator"`, `payload: { store, locationId, terms: string[] }`. Operator-scope because store-wide sale prices are **public-derived, not tenant-private** — the exact carve-out change 2 reserved for the flyer cache. Never tenant-scope: there is no per-tenant sale data, so no `tenant` column value, and the `satellite_tasks` CHECK constraint makes an operator-scope row with a tenant unwritable. A `sale-scan` task instructs the satellite *what to observe* (this store, this location, these broad terms) and carries **no judgment** — sensor-not-judge, inherited.

**One task per `(store, locationId)`, carrying all terms.** The satellite does one authenticated browser session per store and scans every term in it; reporting one `sale` batch = the store's full current sale set, so intake **replaces** that store's rollup on arrival (Decision 4) with no cross-task clobbering and no scan-generation bookkeeping. `dedup_key = "sale-scan:{store}:{locationId}"` keys the change-2 idempotent enqueue: while a store's task is non-terminal a re-run does not stack a second in-flight row; once terminal it is enqueuable afresh next refresh. (If a single store's sale set ever exceeds the shared `MAX_BATCH_ITEMS = 200` observation cap, the producer shards by term-bucket with a generation marker — noted as a deferred refinement, not built; production Kroger rollups hold 0–tens of items.)

## Decision 3 — the producer: a `scheduled()` sibling, not the flyer-warm tick

A **new** `runSaleScanPlanJob` in the one `scheduled()` handler (a `Promise.allSettled` entry beside `runWarmJob`), **not** folded into `runWarmTick`. Justification:

- **Different work, different budget.** The flyer warm *scans in-Worker* against the Kroger API — its whole design is a cursor sweep bounded by the free-tier 50-external-subrequest cap. The sale-scan producer only **enqueues** D1 rows (the satellite scans); it spends **zero** external subrequests. Folding enqueue-only work into the subrequest-bounded sweep would muddy that budget model and its tests.
- **Enqueue-only, refresh-gated.** Mirroring the flyer refresh model, a KV `sale-scan:cursor` (`{ last_refresh_at }`) gates the producer to run a fresh cycle only when due (default aligned to the flyer daily cadence, `operator_config`-tunable); between cycles it is a cheap no-op. When due, it builds the plan — distinct **non-Kroger** `(store, locationId)` from the union of tenants' `profile.stores` primary/preferred × the `flyer_terms` set (analogous to `buildPlan`) — and enqueues one operator-scope task per pair (idempotent). Kroger stores are excluded (the Worker scans those itself).
- **Bounded queue.** Because enqueue recurs, the producer prunes terminal (`done`/`failed`) `sale-scan` rows older than a small age each cycle, so the recurring queue stays bounded (change 2 added no pruning; a recurring producer needs it). Through `src/db.ts`.
- **Health.** It writes a `sale-scan-plan` `job_health` row (added to `HEALTH_JOBS`), so `/health`, `/health.svg`, and the admin Status card surface it like every other job.

**Empty today, by construction.** `stores` is empty in production and no tenant has a non-Kroger primary, so the producer's plan is currently empty → a clean no-op, exactly as the flyer warm no-ops on empty `flyer_terms`. The capability is built; data arrives when an operator registers a non-Kroger store, a tenant sets it primary, and an operator mints a satellite key. The acceptance fixture (tasks §11) seeds a `target` store to exercise the whole loop.

## Decision 4 — store-namespaced rollup + convergence (no data migration)

`rollupKey(store, locationId) = "flyer:{store}:{locationId}"`. The Kroger warm writes `flyer:kroger:{locationId}`; the sale intake writes `flyer:{store}:{locationId}` (e.g. `flyer:target:03500493`). **Both use the same `FlyerItem` shape, `mergeFlyerItems`, and `isOnSale`** — so Kroger and satellite sales converge at one raw rollup layer and `store_flyer` reads them uniformly. Key grammar note: rollup keys always carry a `locationId` segment, so they never collide with the Kroger sweep's `flyer:cursor` / `flyer:plan` (which the Kroger warm keeps as its internal state; the sale producer uses its own `sale-scan:cursor`).

**Migration path — convergence through the pipeline, not surgery.** The rollup is an **ephemeral cache regenerated every sweep**, so there is nothing to migrate: the key-shape change converges organically. To eliminate a cold read-gap between deploy and the first namespaced sweep, the **Kroger read path** (`kroger_flyer` / `store_flyer` for a Kroger store) reads `flyer:kroger:{locationId}` and **falls back to the legacy `flyer:{locationId}`** when the namespaced key is absent. The first Kroger sweep after deploy writes the namespaced key and the fallback stops mattering; the orphaned legacy keys are harmless stale cache entries (a one-line best-effort delete in the warm may reap them, or they simply age out). This is the repo's "production data converges through the pipeline, never through manual surgery" principle applied to a cache — the observed pre-deploy `flyer:{locationId}` rows are the fixture the fallback is verified against.

**Satellite rollup replacement + staleness.** A satellite `sale` batch for a claimed `sale-scan` task is that store's full current sale set, so intake **replaces** the rollup for the **task's** `(store, locationId)` (`{ store, location_id, as_of: now, items }`) rather than accumulating across cycles — a re-scan supersedes the prior scan, and a partial cannot clobber (one task = one store). The `(store, locationId)` is the task's, not the observation's (Decision 6), so a sensor cannot redirect the write; an empty/all-rejected `done` replaces to empty (clears stale sales) rather than leaving the last scan indefinitely. Unlike Kroger (a daily cron re-scan bounds staleness), a satellite that goes offline would leave its last rollup indefinitely; so `store_flyer` applies a **read-time staleness ceiling** to a scanned store's rollup (default ~7 days, `operator_config`-tunable): past it, the rollup reads as empty (`items: []`, `as_of` still surfaced) rather than steering menu-gen on stale sales. Not trusting a stale observation indefinitely is itself sensor discipline.

## Decision 5 — the read tool: `store_flyer` supersedes, `kroger_flyer` retained

`store_flyer` is the store-aware read: it resolves the caller's **primary fulfillment store** (slug + location from `profile.stores`), reads that store's `flyer:{store}:{locationId}` rollup, applies the `min_savings_pct` floor at read and the staleness ceiling, and returns the **same `{ items, as_of }`** shape — Kroger or satellite-scanned, indistinguishable to the reader. `kroger_flyer` is **retained unchanged in contract**, now reading `flyer:kroger:{locationId}` (legacy fallback), so the entire existing Kroger flow (persona call sites, the menu-gen Kroger gate) is byte-for-byte preserved.

Justification for two tools rather than a rename: (1) it satisfies the explicit "keep backward-compat for the Kroger path" verbatim — zero risk to the shipped Kroger flow; (2) the rollup internals are already store-agnostic, so `store_flyer` is a thin generalization, not a rewrite; (3) it avoids a persona-wide tool rename. `store_flyer` becomes the tool the general menu-gen pre-pass calls (for any primary store with a warmed flyer); `kroger_flyer` remains the retained Kroger specialization. Convergence of the persona onto a single `store_flyer` for Kroger too is a later cleanup, out of scope. *(Alternative considered: rename `kroger_flyer` → `store_flyer` with `kroger_flyer` as a pure delegating alias. Rejected for this change to keep the Kroger path literally untouched; the architect may prefer it.)*

`store_flyer` is defined in the new capability (it is the read side of the sale-scan loop and reads satellite data); `kroger_flyer` stays owned by `kroger-integration`, modified only for the key namespacing.

## Decision 6 — the sale intake arm (dispatch by `kind`, **task-scoped** write identity)

Change 2's `intakeObservations` is recipe-only (dedup on canonical URL → insert `ingest_candidates`). It becomes a **dispatcher by observation `kind`**, preserving the shared raw-observation contract the pull-channel spec requires (per-item validation, plausibility bounds, arrival dedup, Worker re-derivation, no re-implementation):

- `kind: "recipe"` → the existing path, unchanged.
- `kind: "sale"` → per-item validate + plausibility (Decision 7); drop non-sales (`!isOnSale`) exactly as the Kroger scan does; build `FlyerItem`s **re-deriving `savings`** via the shared helper; **replace** the task's store rollup with the freshly-observed set stamped `as_of: now`. Idempotent: a late/double report of the same scan replaces to the same rows (arrival dedup by `productId` within the batch). Per-item dispositions (`accepted`/`rejected`/`deduped`) echo `productId`/`url` in the `ItemResult.source` slot.

**The write identity is the CLAIMED TASK's, never the observation's.** A `sale` observation carries `store`/`locationId` for **provenance**, but the rollup `(store, locationId)` the arm **writes** is **authoritative from the claimed `sale-scan` task's payload** (Worker-created by the producer, which excludes Kroger). This closes a cross-tenant integrity hole: trusting the observation's `store`/`locationId` would let any ingest key (a plain `POST /admin/api/ingest` with `capability: "sale-scan"`, or a misbehaving operator adapter) overwrite `flyer:kroger:{victim}` — the first-party flyer every tenant at that location reads. The arm therefore enforces, all together:

1. **Task-threaded key.** `handleSatelliteResults` passes the claimed task's `payload.store` + `payload.locationId` into the sale intake (`options.saleTask`) as the authoritative rollup key; the arm writes `flyer:{taskStore}:{taskLocation}`. A `sale` observation whose own `store`/`locationId` **disagree** with the task's is **rejected per-item** (a satellite reporting another store under this task cannot redirect the write).
2. **Pull-channel-only.** A `sale` observation is valid ONLY as a claimed `sale-scan` task's result. The push path (`intakeObservations` called from `/admin/api/ingest`) passes **no** `saleTask`, so `sale` items are **rejected** there (recipe items unaffected) — sale-scan is Worker-directed **pull**, recipe-scrape is the self-directed **push**. A plain push carrying `sale` items writes **no** rollup and returns per-item `rejected`.
3. **The `kroger` namespace is never sensor-writable.** After normalizing (trim + lowercase) the resolved task store, the arm **rejects** if it equals `KROGER_STORE` (`flyer:kroger:*` is Worker-owned). The guard is applied **after** lowercasing so `"Kroger"` cannot slip a bare `=== "kroger"` check. The producer already excludes Kroger, so a legit task never has store `kroger`; this catches bugs/forgery (defense in depth).
4. **A `done` always converges the task's store — including "no sales today".** A `sale-scan` `done` report converges that store's rollup even when `observations` is empty **or** every item fails validation (a healthy "found nothing" scan must clear stale sales, per Decision 4), by seeding the task's store bucket up front and REPLACING with the surviving (possibly empty) set. A `failed` report does **not** converge (only `done` does). When a `done` carried items but **zero** survived validation, the Worker surfaces an operator-visible signal ("reported N items, 0 survived validation") rather than passing a silent zeroing off as a clean success.

`/satellite/results` runs a claimed task's observations through this shared intake; a `sale-scan` task's `sale` observations flow through the new arm — the pull-channel contract treats the payload/results opaquely and is **unmodified**, but the results handler now threads the claimed task's `(store, locationId)` into the sale intake (the only capability-specific coupling, in the handler, not the channel).

## Decision 7 — sensor validation for `sale` (equal-or-stricter, no privileged path)

Three layers, mirroring recipe and honoring "trust validated outputs, never the process":

1. **Structural** (shared contract zod, self-validated by the satellite before push): `store`/`locationId`/`productId`/`description` non-empty; `regular` a positive number; `promo` a non-negative number; `size` an optional string; `brand`/`categories`/`url` optional (`url` an http(s) URL when present). No `savings` field exists to set.
2. **Plausibility** (Worker-side, equal-or-stricter than the first-party Kroger path): a sale is kept only when `0 < promo < regular` (the same `isOnSale` gate Kroger data passes); `regular`/`promo` within a sane absolute ceiling (reject a fat-fingered `$99999`); the **markdown ceiling** `savings_pct ≤ 95%` (a >95%-off "deal" is a scan/parse error, not a sale); `size` parses via the existing unit-price parser or is null. A failing item is **rejected per-item** (its disposition + reason), never sinking the batch — the recipe intake's per-item discipline.
3. **Provenance**: `productId` (+ optional product `url`) is retained on the `FlyerItem` so a claim is spot-checkable against the store's own page. This is precisely what change 5's sensor-audit would **sample** — flagged here, not built.

No privileged path: a `sale` observation can set no field a Kroger scan couldn't, skips no derivation, and is held to bounds at least as strict. A satellite whose `sale` pushes repeatedly fail plausibility is quarantinable through the existing pull-channel attempt-cap + observability, no special-casing.

## Decision 8 — satellite-side sale-scan (pull client + adapter interface)

This is the **first** capability to consume the change-2 pull channel from the satellite side, so it adds a pull client in addition to a sale adapter. High-level scope (tasks §6 enumerate; this is planning):

- **A pull-loop client** — claim (`POST /satellite/tasks/claim` with `capabilities: ["sale-scan"]`, using the machine's ingest key), dispatch each claimed task to its adapter, report (`POST /satellite/results` with `sale` observations or a `failed` reason). Reuses the existing push transport/backoff idioms; strictly outbound-only.
- **A `SaleScanAdapter` interface** parallel to `SourceAdapter`: `scan(sdk, { store, locationId, terms }) → SaleObservation[]` (or a structured skip). The satellite validates each emit against the shared contract (`parseSaleObservation`) before it will report — an adapter cannot smuggle a non-contract shape onto the wire, and cannot emit a `savings` field (none exists).
- **SDK primitives** — the same tiered fetch (plain-HTTP default, browser tier for a rendered/loyalty session) + captured-session consumption + logger the recipe SDK exposes. There is **no generic sale parse** analogous to JSON-LD recipe parse (loyalty pages have no standard sale schema), so a sale adapter is always site-specific code.
- **No built-in named-retailer adapter** — operator-authored, loaded from the mounted `adapters_dir` (the recipe-adapter plugin model). The satellite `config` gains a way to declare it runs the `sale-scan` capability and which module scans which store.
- **CLI `test` verb** extended to dry-run a sale adapter against a store/location, printing the `sale` observations it would report and validating them locally, before going live.
- **Irreversible actions:** sale-scan is **observe-only** — it commits nothing, so the "irreversible actions stay human-gated" requirement is trivially satisfied (there is no commit). That requirement is exercised for real by change 4 (order-fill), not here.

## Model identity

**No model id appears anywhere in this change.** Sale-scan is entirely deterministic: the satellite adapter does browser scraping (no inference), and the Worker does deterministic re-derivation (`isOnSale`, `savings`, the deal floor, plausibility bounds). There is no LLM call, no prompt, no model selection on this path — so there is no model identifier to hardcode, log, or gate on, and none is introduced. (Menu-gen's *use* of the resulting sales is the LLM's reasoning, unchanged and unmodeled here.)

## Should this be one change or split?

**Recommendation: keep it as one coherent change.** The store-namespacing (Decision 4) is the natural first phase and is the cleanest extraction point *if* the architect wants to de-risk, but its **only** consumer is sale-scan (order-fill does not touch the flyer rollup), so shipping it alone would be a deploy + cache-convergence cycle for zero behavior change — ceremony, not seam-settling. This differs from change 2, whose channel is reused by *both* sale-scan and order-fill and so earned its own change. Here the store-namespacing, the sale intake that writes into it, and the read that serves it are one tight loop; splitting them fragments a single reviewable unit.

Internally the tasks are ordered so the store-namespacing + `store_flyer` (§2–§3) land before the sale producer/consumer (§4–§7) — so if de-risking is later wanted, §2–§3 (plus their docs) is the pre-cut boundary. Implementation stays **serial** on the shared surfaces (`flyer-warm.ts`, the `FlyerItem` layer, the read tool, `scheduled()`, docs).

## Risks

- **Cold read-gap on deploy** — mitigated by the legacy-key fallback (Decision 4); verified against the current production `flyer:{locationId}` rows.
- **Stale satellite rollup from a dead satellite** — mitigated by the read-time staleness ceiling (Decision 4); a dead satellite degrades to empty, not to stale sales.
- **Recurring queue growth** — mitigated by terminal-row pruning in the producer (Decision 3).
- **Batch-cap overflow for a huge store** — accepted (production rollups are tiny); term-bucket sharding is the noted deferred refinement.
- **Persona drift** — the menu-gen store-aware pre-pass is realized in `AGENT_INSTRUCTIONS.md` and validated conversationally (menu-generation's realization convention); the `store_flyer` tool description owns the contract, the persona owns *when* to call it.
