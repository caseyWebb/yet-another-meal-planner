## Why

On Cloudflare Workers' **free tier**, a Worker invocation may issue at most **50 external subrequests**. `kroger_flyer` synthesizes its sale list by fanning out one Kroger search per term (broad `flyer_terms` + per-tenant stockup) across two pages — so as the term set grows, a *single* flyer call blows past the cap, and even when it fits it costs multi-second latency on the user's hot path and hammers the public Kroger API. A synchronous tool call gets exactly one invocation's 50-subrequest budget and can't spread the work out. Moving the fetch to a **background job** relocates the cap to where it stops binding: a scheduled sweep has unlimited invocations over time, each with its own budget, while the agent's hot path becomes a single KV read.

## What Changes

- **NEW** A scheduled cron job warms a per-**location** flyer cache in KV. One cron trigger, short cadence, a cursor-driven sweep that does a bounded batch of Kroger scans per tick (staying under the 50-subrequest and free-tier CPU caps), advances a cursor, and **no-ops** once the sweep is complete until the next refresh window. The sweep plan (which locations × which broad terms) is built **once** per sweep from the live tenant directory + `flyer_terms.toml` and persisted in KV, so per-tick external budget is spent only on Kroger scans.
- **Per-location cache, shared across tenants.** Sales are store-specific, so the cache is keyed by `locationId`. **Multiple Krogers are handled by construction**: two tenants at different stores resolve to different `locationId`s and get independent rollups; two tenants at the *same* store share one rollup (higher hit rate). The warm scope is the *union* of all tenants' `preferred_location`s. A newly-joined store self-heals on the next sweep (the plan is rebuilt from the live directory — no redeploy).
- **BREAKING** `kroger_flyer` becomes a **pure cache reader**: `kroger_flyer(min_savings_pct?) → { items, as_of }`. It reads the per-location rollup, applies `min_savings_pct` at read time, and returns an `as_of` timestamp so the caller knows the flyer's age. The `terms` (ad-hoc) and `against_stockup` parameters are **removed** — the live fan-out is gone. An empty/cold cache returns an empty list (never errors), matching today's absent-`flyer_terms` behavior.
- The precise / per-tenant concerns that leave `kroger_flyer` (`against_stockup`, ad-hoc substitute-candidate scanning) move into the place-groceries skill flow under the **separate** "split the double-duty tool" change. This change is independent of and does not block on that one.
- `flyer_terms.toml` stays user-curated but is now consumed by the **warm job** rather than the live tool. Its missing-config graceful-degradation guarantee carries over to the warmed cache.

## Capabilities

### New Capabilities
- `flyer-cache-warming`: A scheduled cron sweep that materializes a per-location synthesized-flyer rollup into KV — single trigger, cursor-driven batching that respects the free-tier per-invocation caps, idle no-op between refresh windows, plan persisted in KV, per-location keying shared across same-store tenants, graceful cold-cache behavior, and one structured log line per sweep.

### Modified Capabilities
- `kroger-integration`: The `kroger_flyer synthesized sale scan` requirement changes from a live two-source fan-out to a pure read of the warmed per-location cache (`min_savings_pct` applied at read, `as_of` returned, `terms` / `against_stockup` removed, empty-cache graceful). The `flyer_terms.toml curated config` requirement is updated to note it now feeds the warm job.

## Impact

- **Code**: `wrangler.jsonc` (add a single `triggers.crons` schedule); `src/index.ts` (add a `scheduled()` handler to the default export alongside `fetch`/`email`); a new `src/flyer-warm.ts` (plan build, KV cursor, chunked sweep, rollup write, structured log); `src/tools.ts` (`kroger_flyer` → cache read + read-time `min_savings_pct` + `as_of`; remove `terms`/`against_stockup`); `src/matching.ts` if `FlyerItem`/`as_of` shaping needs it.
- **State**: new keys in the existing `KROGER_KV` namespace under a `flyer:` prefix (per-location rollups, the sweep cursor, and the persisted sweep plan) — no new binding. Stays within free-tier KV limits (rollup-not-per-term keeps writes well under 1000/day).
- **Docs (same pass — repo no-drift rule)**: `docs/TOOLS.md` (tool contract change), `docs/ARCHITECTURE.md` (new scheduled cold-path actor framed as a `capture` step; the first deliberately shared cross-tenant *data-plane* cache, blessed as public-derived non-tenant data), `docs/SCHEMAS.md` (`flyer_terms.toml` now consumed by the warm job; the KV flyer-cache value shape), `docs/SELF_HOSTING.md` (operators: the cron exists, free-tier posture). A short ADR for the scheduled-capture pattern is optional.
- **Multi-tenancy**: introduces a per-location cache shared across tenants; this is consistent with the tenant-isolation requirement because store-wide sale prices are derived from public data, not tenant-private state.
- **Non-goals**: per-tenant stockup warming (deferred); live fallback / ad-hoc terms; any paid-tier feature; splitting `kroger_flyer`'s double duty (separate change). Deployment stays operator-run from the private data repo.
