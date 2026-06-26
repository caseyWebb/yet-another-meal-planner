---
update-when: the flyer cache-warming design is revisited or superseded
---

# ADR 0002 — Scheduled flyer warm: a cron `capture` step + a per-location shared cache

**Status:** Accepted — drafted as the `warm-flyer-cache` OpenSpec change.

## Context

`kroger_flyer` synthesized its sale list on the **hot path**: one Kroger search per term (broad `flyer_terms` + per-tenant precise terms) across two pages. The public Kroger API has no flyer/circular endpoint, so a brute-force term scan is forced. On the Cloudflare Workers **free tier** a single invocation may issue at most **50 external subrequests** (and gets ~10ms CPU), so as the term set grew, one flyer call exceeded the cap — and even within it, the fan-out was multi-second latency on the user's request plus load on the public Kroger tier.

The project already runs a `capture → retrieve → narrow` loop (ADR 0001): derive LLM/expensive knowledge once on a cold path, retrieve it deterministically, narrow with the LLM. The flyer scan is the same shape — except the expensive step is *I/O*, not the LLM — and nothing was capturing it.

## Decision

**Move the flyer fetch off the hot path into a scheduled `capture`, and serve `kroger_flyer` from a per-location cache.** Two boundary-shifting facts are recorded here so they aren't relitigated:

1. **A scheduled actor is legitimate.** The Worker gains a `scheduled()` handler (one cron trigger) that drives a cursor-based sweep (`src/flyer-warm.ts`): each tick processes the next bounded batch of `(location, term)` units and advances a KV cursor, no-opping once complete until a daily refresh re-arms it. A synchronous tool call has **one** invocation's 50-subrequest budget; a background sweep has **unlimited invocations over time**, so the cap relocates to where it stops binding. The total term set is uncapped — more terms mean more ticks, never a bigger invocation. The sweep runs **without an OAuth session**, enumerating the tenant directory and reading each `users/<id>/preferences.toml` directly.

2. **One deliberately cross-tenant data-plane cache.** The rollup is keyed by `locationId` (`flyer:{locationId}` in `KROGER_KV`) and **shared across tenants at the same store** (different Krogers get independent rollups). This is the single shared data-plane cache; everything else stays strictly per-tenant. It is sound because store-wide sale prices are **public-derived, not tenant-private** — no member's state leaks.

Supporting choices: the rollup stores **noise-floor** candidates (real sale + fulfillable, raw `regular`/`promo` kept) and `kroger_flyer` applies the `min_savings_pct` deal floor **at read**, keeping it caller-tunable without a re-fetch; the sweep **plan is built once and persisted** in KV so per-tick GitHub enumeration doesn't eat the external budget; a cold cache reads as **empty** (graceful) and an `as_of` timestamp conveys age (staleness is low-stakes — the order path re-prices live).

## Consequences

- `kroger_flyer` becomes a pure cache read: `kroger_flyer(min_savings_pct?) → { items, as_of }`. The `terms` and `against_stockup` params are **removed** — precise/per-tenant "is this specific thing on sale" moves to the place-groceries flow (a separate change). v1 is the **broad serendipity flyer** only.
- New KV keys under `KROGER_KV`: `flyer:{locationId}`, `flyer:cursor`, `flyer:plan` (no new binding).
- `docs/ARCHITECTURE.md` gains a *flyer warm* section and blesses the shared cache; `docs/TOOLS.md` and `docs/SCHEMAS.md` reflect the contract and cache shapes.
- **Deferred, on a concrete trigger** (not speculatively): per-tenant stockup warming (`flyer:{loc}:{tenant}`), which the place-groceries split change will pick up; a wall-clock-aligned (e.g. Wed promo-flip) refresh instead of the simple 24h-since-last-start gate.
