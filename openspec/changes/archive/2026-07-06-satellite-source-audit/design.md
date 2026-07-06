# Design — satellite-source-audit

## Context

This is **change 5**, the final change of the satellite spine. Changes 1–4 built "the Worker
re-derives every conclusion" and "irreversible actions stay human-gated." The founding credo
(archived `generalize-scraper-to-satellite/design.md:94`) additionally promised the Worker
"samples claims against ground truth" and "quarantines bad sources through the pipeline," and the
living `satellite/spec.md` "The Worker trusts a satellite's validated outputs, never its process"
requirement already carries the standing SHALL that a source repeatedly failing validation be
"quarantinable through the pipeline (its pushes surfaced and rejectable) … so the operator can
revoke the source." The only lever that exists is `revokeIngestKey` (whole-machine), and reject
*reasons* live only in the sync HTTP response body (`intakeObservations`' per-item `results`) and
then evaporate.

This change **realizes the quarantine clause** — a rejection ledger, a per-source reliability
signal, and a reversible per-source quarantine — and **deliberately DROPS the "sample against
ground truth" clause** (Decision C, below).

Change 3 (`satellite-sale-scan`) and change 4 (`satellite-order-cart-fill`) both explicitly
reserved this arm for a later change: `sale-intake.ts:38` comments that a claim's retained
provenance is "precisely what change 5's sensor-audit would sample"; sale-scan's proposal §40 and
order-cart-fill's proposal §22 both list "the sensor-audit / source-quarantine arm" (and
order-fill's "admin observability over `order_lists`") as out-of-scope-for-a-later-change.

## Model identity: none

This path is entirely deterministic. The ledger records rows; the reliability rollup computes
rates and staleness from integer counts and timestamps; the quarantine flag is an operator toggle
enforced by an exact `{kind, source}` match at intake; the threshold that surfaces a quarantine
*recommendation* is a fixed numeric rule. No model id (name or string) appears in the contract,
the Worker code, the spec, the docs, or the admin surface. No `env.AI` call is added. Consistent
with the repo convention, the (nonexistent) judgment is described by role, never by model — but
there is no judgment here to describe: the satellite is a sensor and this change is its health
gauge, not a classifier.

## Production spike (read-only, Cloudflare D1 query API)

`CLOUDFLARE_API_TOKEN` was present, so — per CLAUDE.md ("planning resolves its own unknowns") —
the open questions were settled against production before finalizing this plan. Read-only queries
against the operator's D1 (`grocery-mcp`, db `72599f36-…`) on 2026-07-06:

| table | rows | finding |
| --- | --- | --- |
| `ingest_pushes` | **0** | no satellite has ever pushed; the recipe denominator table is empty |
| `ingest_keys` | **0** | no satellite provisioned (no operator-global, no tenant-bound) |
| `ingest_candidates` | 0 | no pushed recipe candidates in flight |
| `satellite_tasks` | **0** | the pull channel (sale-scan) has never carried a task |
| `order_lists` | **0** | order-fill has never issued a list |
| `stores` | **0** | no API-less store registered → the sale-scan producer no-ops |
| `flyer_terms` | 36 | the shared broad-terms set exists (Kroger flyer path is live) |
| `reconcile_errors` | 0 | the precedent table exists and is empty (clean corpus) |
| `discovery_log` | 239 | first-party recipe discovery IS active (Worker-polled feeds/email) |
| `satellite_rejections` | — | **does not exist** (this change creates it) |

**Consequences for this plan:**

- The **entire satellite spine is built-but-dormant** on this instance — identical to the change-3
  and change-4 spikes. So the ledger, the accept-tally, and the quarantine table all start
  **empty**; there is zero in-flight data to converge and no migration/backfill risk. The
  B-denominator and quarantine mechanisms carry no live-data hazard here.
- Because the product is self-hosted and multi-operator, **other** operators' instances are not
  queryable from here; an operator who *has* provisioned a satellite gets the ledger populated from
  their first reject after deploy — nothing to migrate, the tables converge organically.
- **Acceptance fixture (tasks §10).** Since production has no satellite data, the change is a clean
  no-op on deploy and cannot be verified against live rows alone. The fixture seeds a satellite key
  + a source and drives (a) a Worker-side reject, (b) a local-reject summary, and (c) a quarantine
  toggle, then reads the ledger + the Satellites quality column back — the observed rows are the
  fixture, per the CLAUDE.md "observed defect rows become the acceptance fixture" discipline (here,
  observed *seeded* rows, since there is no production defect to reproduce).

## Decisions

### A. The ledger is the substrate — one append-per-reject table, pruned on a rolling window

A new D1 table `satellite_rejections`, accessed only through a new `src/satellite-audit-db.ts`
that goes through `src/db.ts` (so every D1 failure maps to a structured `storage_error` and tools
stay throw-free). One row per rejected observation:

```
satellite_rejections(
  id           TEXT PRIMARY KEY,     -- uuid
  tenant       TEXT,                 -- the carrying ingest key's tenant binding: NULL for an operator-global key, else the bound tenant. Key off the KEY, not the kind: sale is always operator-global, order always tenant-bound, but recipe MAY be either.
  key_id       TEXT,                 -- the ingest key that carried it (NULL for a synthesized origin)
  kind         TEXT NOT NULL,        -- recipe | sale | order
  source       TEXT NOT NULL,        -- recipe: the feed/site URL; sale/order: the store slug
  origin       TEXT NOT NULL,        -- worker | local
  reason       TEXT NOT NULL,        -- the reject reason (worker) or the reason-category (local)
  provenance   TEXT,                 -- nullable: the offending url / productId / item_id / a local sample
  count        INTEGER NOT NULL DEFAULT 1,  -- 1 for a worker reject; N for a local-summary entry
  rejected_at  INTEGER NOT NULL      -- epoch ms
)
```

- **This is a rolling log, not a wholesale-replace table.** Unlike `reconcile_errors` (DELETE +
  re-insert every reconcile pass, because it always reflects the *latest* projection), a rejection
  is a point-in-time event: we append and **prune by age**, mirroring `pruneIngestPushes` /
  `pruneStaleOrderLists` / `pruneTerminalTasks`. `pruneSatelliteRejections(env, beforeMs)` joins
  the `scheduled()` phase-1 reap in `index.ts` beside `pruneStaleOrderLists`. Retention ~ the
  operator's `logRetentionDays` (the same knob that prunes `ingest_pushes`).
- **`count` deviates from the task's sketch** (which listed no count): a Worker-side reject is one
  row with `count = 1`; a satellite-reported local reject arrives pre-aggregated as
  `{ reason_category, count, sample }`, so it lands as **one** row carrying its `count` and the
  `sample` in `provenance`. This keeps the ledger one-row-per-reject-*event* without exploding a
  local aggregate of, say, 40 malformed items into 40 rows.
- **Fed from two sources:**
  1. **Worker-side rejects** — every `results.push({ disposition: "rejected", … })` site across the
     three arms of `intakeObservations` also appends a ledger row (`origin: worker`, `reason` = the
     existing per-item reason string, `provenance` = the item's url/productId/item_id). The reject
     reasons that today only ride the HTTP response become durable.
  2. **Satellite-reported local rejects** (`origin: local`) — see Decision D.
- **Surfaced two ways:** an agent-readable read (`read_satellite_rejections`, Decision F) and the
  admin Satellites page (Decision E).

### B. The reliability signal — a compute-on-read per-`{kind, source}` rollup

A per-source health rollup computed on read (volume is a household's satellites — tiny), exposing:

- **acceptance rate** = accepted / (accepted + rejected) over the window,
- **validation/plausibility-fail rate** = rejected / (accepted + rejected) — the inverse; dedups
  are excluded from both denominators as a benign re-report, not a health signal,
- **staleness** = now − last-accepted-at for the source.

The "source" key is the composite `{ kind, source-string }` the task specifies: recipe → the
`ingest_pushes.source` / batch `source` (the feed/site URL); sale/order → the store slug. This
rollup is folded into the existing `readSatelliteLiveness` reader (which already computes per-source
*recency*) as a new **quality** dimension beside it, so there is one reader and one place — the
admin Satellites page (Decision E). A source whose fail-rate crosses a fixed threshold over a
minimum sample surfaces a **quarantine recommendation** (Decision E) — it never auto-quarantines.

#### Resolved: B's denominator (the accepted count for sale/order)

**The problem.** Rates need a per-source *accepted* count. The recipe push path already records
`ingest_pushes(key_id, source, received, accepted, deduped, rejected)` per batch — that IS the
recipe denominator. But the pull-channel (`/satellite/results`, sale-scan) and the direct
order-receipt (`/satellite/order/receipt`) paths do **not** record into `ingest_pushes`, so sale
and order sources have **no** accepted-count trail (an accepted sale lands in the KV flyer rollup;
an accepted order advances `grocery_list` — neither leaves a per-source historical count).

**Resolution — carry a uniform accept-tally alongside the ledger, written at the one intake choke
point; leave `ingest_pushes` untouched.** A tiny per-`{tenant, kind, source}` counter table
`satellite_source_stats(tenant, kind, source, accepted, deduped, last_accepted_at)` is bumped from
inside `intakeObservations` for **all three** arms — the single shared function every path already
funnels through, and which already computes `{received, accepted, deduped, rejected}` for each
call. B then computes rates from **one uniform denominator** (this counter) joined to the ledger's
per-`{kind, source}` reject rows.

*Why this over the alternative (extend `ingest_pushes` to all three paths):*

- **One write site, so the three paths cannot diverge** — the same reason `intakeObservations` is a
  shared choke point in the first place. Threading a second `recordIngestPush`-style call into the
  pull-results and order-receipt *handlers* would scatter the accounting across three call sites.
- **Zero blast radius on a working view.** `ingest_pushes` currently drives the Satellites *funnel*
  (whose downstream is recipe-only `discovery_log`) and the *recent-pushes* table. Writing sale/order
  rows into it — or adding a `kind` column and re-keying that funnel — disrupts a shipped, tested
  view (its "handed to sweep" step is recipe-specific). Leaving `ingest_pushes` as the recipe push
  log and giving the audit its own counter avoids that entirely.
- **The audit owns its accounting end-to-end.** The ledger (rejects) + `satellite_source_stats`
  (accepts) are the source-audit's own substrate; it depends on `ingest_pushes` only as an *optional*
  cross-check for recipe, not as a load-bearing denominator.
- **Accepted cost:** the recipe accepted-count is now tallied in two places — `ingest_pushes`
  (per-batch rows, for the recency view) and `satellite_source_stats` (a rolled-up counter, for the
  quality view). This is a single small integer per source, not duplicated *data* in any meaningful
  sense (different grain, different consumer), and it buys a **single uniform denominator** so B's
  rate math never forks per kind. Noted for the architect as the one trade-off of this choice.

`satellite_source_stats` prunes/ages the same way. It is **day-bucketed** (`{tenant, kind, source, day}`,
`day` = epoch-day) so B computes a **WINDOWED** rate: accepts are summed over the day buckets within a
recent window W (defaulting to `logRetentionDays`) and rejects are counted over that same window
(`rejected_at ≥ now − W`), keeping the two sides comparable — a windowed-rejects / all-time-accepts
rate is biased DOWN, so a source healthy for months then broken would never trip the quarantine
recommendation. The buckets prune on the same window (`pruneSourceStats`, phase-1 reap). Both the
ledger and the tally are in the one `0039` migration.

### C. DROP ground-truth sampling (the deliberate omission)

The credo promised the Worker "samples claims against ground truth." **This change does not build
that, by decision.** The structural rationale (stated so it is on the record, not silently skipped):

- The satellite's entire *reason to exist* is to reach sources the Worker **cannot** reach — an
  API-less store's loyalty prices behind the operator's session, a walled recipe site. For those
  sources there is **no independent oracle** the Worker could sample against: if the Worker could
  fetch the store's price itself to check the satellite's claim, it would not need the satellite.
  A "verify a store claim against ground truth" check would therefore be **theater / a half-truth** —
  it could only re-fetch through the *same* satellite path, checking the sensor against itself.
- So we **trust the satellite's honesty** (it runs on the operator's own network, under the
  operator's own session — it is not an adversary) and audit only its **operational health**:
  breakage, not lies. The failure modes we catch are a DOM change, a rotted adapter, an expired
  session flooding malformed or empty data — all of which show up as a spike in the fail-rate or a
  flood of local rejects, *without* needing a ground truth.
- The blast radius is **per-household**: the ledger and quarantine entries are tenant/household-
  scoped, and the admin panel is the single operator's. This is the operator's own health tool, not
  a cross-tenant security boundary — which is the right altitude for a self-hosted friend-group
  product, and another reason an adversarial ground-truth check would be over-engineering.

Note the living `satellite/spec.md` never encoded the sampling clause as a SHALL — only the archived
credo did — so dropping it requires **no** spec REMOVAL; it is simply not realized, and the new
capability spec states the fallible-only threat model positively so the omission is deliberate and
legible.

### D. Local-reject reporting — an additive, optional envelope field

The loudest breakage never reaches a Worker-side-only ledger: `validateSaleEmit` /
`validateOrderEmit` (and the recipe adapter's contract check) reject a malformed or
judgment-smuggling item **locally**, dropping it before the wire (`ScanOutcome.rejected` today is
logged and discarded). So the satellite reports a compact **local-reject summary** on each of its
three delivery envelopes, and the Worker records it into the ledger with `origin: local`.

- **Shape (defined once in `packages/contract`):**
  `local_rejects?: { category: LocalRejectCategory; count: number; sample?: string }[]`.
  It is an **additive, OPTIONAL** field on the push batch envelope, the pull-channel results
  envelope, and the order-receipt envelope. Additive + optional ⇒ the contract stays
  `contract_version: "v2"`; a satellite build that omits it is unaffected, and a Worker that
  receives it from a newer satellite reads it, while an older Worker ignores an unknown field. The
  field's **source is implied by the envelope's existing context** — the push batch's `source`, the
  claimed task's store, or the order-list's store — so the summary itself carries no source string.

- **Resolved: granularity + the reason categories.** Confirmed **per `{ category, count, sample }`,
  not every malformed body** — enough to diagnose "the adapter broke" without shipping noise (the raw
  malformed bodies could also carry session/PII fragments, so shipping them is a leak risk). The
  categories are exactly the two branches of `validateSaleEmit` / `validateOrderEmit` (and the recipe
  adapter's equivalent), so they map 1:1 to code that already exists:
  - **`contract_invalid`** — the emitted item failed the shared-contract parse
    (`parseSaleObservation` / `parseOrderObservation` / `parseRecipeItem`): a missing/mistyped field,
    an out-of-shape body. This is the **"DOM changed / adapter rotted"** signal — a scrape that used
    to yield clean fields now yields garbage.
  - **`judgment_smuggled`** — the adapter emitted a derived JUDGMENT field the sensor must never
    report (`JUDGMENT_KEYS`: `savings`/`on_sale`/… for sale; `status`/`in_cart`/… for order). This
    is the **"adapter is trying to be a judge"** signal — a sensor-not-judge violation.

  `sample` is **one** redacted example (the first reason string, truncated to a bound) per category,
  never the full set. A whole-task failure (an adapter's `{ error }` — session expired, source
  unreachable) is **not** a local-item reject; it continues to ride the existing `reason` on the
  `failed` results/receipt path and is out of this summary's scope.

- **Worker handling.** Each `local_rejects` entry becomes one ledger row: `origin: local`,
  `kind` = the envelope's kind, `source` = the envelope's implied source, `reason` = the category,
  `count` = the reported count, `provenance` = the sample. Local rejects **do not** decrement the
  accept-tally (they were never accepted); they raise the source's fail-rate exactly as a
  Worker-side reject does, which is the point — a locally-dropped flood is now visible.

### E. Quarantine — a reversible, per-source, operator-confirmed Worker-side reject

The lever that realizes the standing spec SHALL. Because the Worker is strictly outbound-only (it
can never dial the satellite to stop it at the source), enforcement is **Worker-side at intake**.

- **Model.** A `satellite_quarantine(tenant, kind, source, quarantined_at, note)` row marks a
  `{kind, source}` (with `tenant` = the source's ingest-key binding — NULL for an operator-global
  key, else the bound tenant; keyed off the key, not the kind — sale is operator-global, order is
  tenant-bound, recipe MAY be either) as quarantined. At the top of each arm of
  `intakeObservations`, after resolving the item's `{kind, source}`, a quarantined source's items
  are **rejected before acceptance** and appended to the ledger with `origin: worker,
  reason: "quarantined"`. The observation is dropped; nothing lands in the corpus / flyer rollup /
  grocery list.
- **Operator-confirmed, never auto-disable.** When a source crosses the fail-rate threshold
  (Decision B) the Satellites page surfaces a **recommendation** ("target-store: 38% of the last N
  observations failed validation — quarantine this source?"); the operator **toggles** it. This
  mirrors the spine's "irreversible actions stay human-gated" philosophy — auto-quarantining on a
  threshold would let a transient upstream blip silently sever a source. It is **reversible**:
  un-toggling clears the flag and the next observation flows again.
- **Complements, does not replace, `revokeIngestKey`.** Revoking a key kills a whole machine (all
  its sources) irreversibly-ish (re-mint required). Quarantine is the scalpel: one source of one
  machine, reversibly. A machine emitting garbage from *one* rotted adapter can have that adapter's
  source quarantined while its healthy sources keep flowing.
- **Admin surface (`/admin/**`).** The Satellites page gains: a **quality column** per source
  (acceptance/fail rate + staleness, with the recommendation chip when over threshold), a
  **per-source rejection detail** (the recent ledger rows for that source — reason + provenance +
  origin badge), and a **quarantine toggle** (an island mutation hitting a new typed
  `/admin/api/satellites/quarantine` route that calls the `src/satellite-audit-db.ts` setter). Per
  `src/admin/CLAUDE.md` this is a real `/admin/**` change → it routes its visual design through the
  companion **Claude Design** project and ships Playwright coverage (tasks §7).

### F. The agent-readable read — mirror the `reconcile_errors` precedent

`read_satellite_rejections` is a `read_*`-style MCP tool over the ledger, modeled exactly on
`read_reconcile_errors` (`tools.ts:508`, backed by `readReconcileErrors` → a bounded
`SELECT … ORDER BY …`). It returns `{ rejections: [{ kind, source, origin, reason, provenance,
count, rejected_at }], quarantined: [{ kind, source, quarantined_at }] }` (bounded, most-recent
first, optionally filterable by source). The tool *description* owns the field semantics and the
guarantee that it reflects only *rejected* observations (accepted ones never appear); a skill owns
*when* to reach for it (a member says "my satellite's recipes aren't showing up" → read it and relay
the specific defect, e.g. "seriouseats: 12 items failed as `contract_invalid` in the last day — the
adapter likely broke"). This satisfies the tool/skill ownership test: a skill-less agent can use it
safely from its description alone.

## Risks / Trade-offs

- **A second accounting mechanism (the accept-tally) beside `ingest_pushes`.** *Mitigation:* it is
  written at the one `intakeObservations` choke point (not scattered), it is a tiny counter, and it
  buys a uniform denominator + zero disruption to the shipped recency view. The small recipe
  double-count is called out above (Decision B) for the architect to override if they'd rather
  extend `ingest_pushes` with a `kind` column instead.
- **The accept-tally is day-bucketed, so B's rate is windowed, not lifetime.** *Mitigation:* both sides
  of the rate share one window W (= `logRetentionDays`) — accepts summed over in-window day buckets,
  rejects counted over the same window — so the fail-rate reflects RECENT health and a long-healthy
  source that breaks now trips the recommendation (a lifetime accept denominator diluted it below
  threshold). Buckets prune on that window beside the ledger; a source with no in-window activity simply
  drops out of the rollup.
- **The ledger could grow under a flapping source.** *Mitigation:* it is append-with-rolling-prune
  (same idiom as `ingest_pushes`), local rejects land pre-aggregated (one row per `{source,
  category}` per envelope, not per item), and volume is a household's satellites. The prune joins the
  existing phase-1 reap.
- **Quarantine as a footgun (an operator quarantines a source and forgets).** *Mitigation:* it is
  reversible and always visible on the Satellites page (a quarantined source shows its state + when);
  it is never auto-applied, so there is no silent severing.
- **Dropping ground-truth sampling could read as "we don't check the sensor."** *Mitigation:*
  Decision C states the structural reason (there is no oracle for an API-less source), and the audit
  *does* check the sensor — for health, which is the only thing checkable without an oracle. Stated
  as a positive requirement (fallible-only) in the new spec so it is a deliberate posture, not a gap.
- **Additive wire field drift.** *Mitigation:* `local_rejects` is optional on all three envelopes,
  defined once in `packages/contract`, and locked by a contract unit test proving an omitting
  satellite and a receiving Worker both stay on `"v2"`. `satellite-version` is bumped since the
  contract + satellite packages are touched.

## Open questions for the architect

1. **B's denominator (Decision B)** — confirmed choice: a dedicated `satellite_source_stats` counter
   (accept the tiny recipe double-count) vs. adding a `kind` column to `ingest_pushes` and re-keying
   its funnel. Recommendation: the dedicated counter (zero blast radius on the shipped view).
2. **Quarantine tenancy keying (Decision E)** — modeled as `{tenant, kind, source}` with `tenant`
   following the capability's scope (NULL for recipe/sale, the tenant for order). If the architect
   prefers to keep it purely operator-level (the admin panel is operator-only anyway), collapse
   `tenant` to always-NULL. Recommendation: keep the nullable column for symmetry with `ingest_keys`.
3. **Whether to also MODIFY `satellite-pull-channel` / `satellite-order-cart-fill` specs** for the
   additive `local_rejects` field, or let the new capability spec own it (the taken approach — see
   the spec-delta note). The field is additive/optional so the existing envelope requirements do not
   become false; only the `satellite` push-wire requirement is lightly MODIFIED to record it.
