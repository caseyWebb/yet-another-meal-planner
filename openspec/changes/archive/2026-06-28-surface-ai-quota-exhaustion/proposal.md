## Why

The whole-corpus classify pass + the describe/embed reconcile + the discovery sweep all draw on Workers AI, and a one-time corpus backfill exceeds the free tier's **10,000-neuron daily allocation** — at which point every `env.AI` call returns error **4006**. Two problems surfaced in production:

1. **The failure was opaque.** `/health` showed a generic `recipe-embed` job failure; nothing named the actual cause (Workers AI quota exhausted), so an operator can't tell a quota wall from a code bug.
2. **The classify pass mis-handled the transient failure.** It called `upsertEmpty` (advancing the `body_hash` gate with empty facets) on *any* classify failure — including a transient quota error. That (a) blocked those recipes from retrying once quota returned, and (b) blanked their Tier A facets in the live index (the empty classified row winning over the authored frontmatter).

## What Changes

- **The classify pass distinguishes transient from permanent failures.** A transient `storage_error` / AI hiccup (incl. the 4006 quota error) **no longer advances the gate** — the recipe retries next tick and the projection keeps falling back to the authored frontmatter meanwhile. Only a **permanent** contract `validation_failed` parks the recipe (advances the gate with empty facets). On a quota error the tick **stops early** (the rest will fail the same way) and flags `quota_exhausted`.
- **`/health` gains an explicit `ai_quota_exhausted` boolean**, aggregated from the AI jobs' tenant-clean summaries (a `quota_exhausted` flag or a 4006-shaped error string), and it **degrades overall `ok`**.
- **`/health.svg`** renders an explicit `ai  quota exhausted` row (red) when flagged.
- **The admin Status UI** renders a red "Workers AI quota exhausted" banner naming the cause + the remedy (daily reset / Workers Paid).

## Capabilities

### Modified Capabilities
- `background-job-health`: `/health`, `/health.svg`, and the admin Status view surface an explicit Workers AI quota-exhaustion signal, distinct from a generic job failure.
- `recipe-facet-derivation`: the classify pass only parks (advances the gate) on a permanent contract failure; a transient failure leaves the recipe un-gated to retry.

## Impact

- **Code:** `src/health.ts` (`isAiQuotaError`, `ai_quota_exhausted` in the payload + aggregation + SVG row), `src/recipe-classify.ts` (transient/permanent/quota failure handling + the `quota_exhausted` summary flag), `admin/src/Status.elm` (+ regenerated `admin/dist/`).
- **Tests:** `test/health.test.ts`, `test/recipe-classify.test.ts`, `admin/tests/StatusTest.elm`.
- **Docs:** `docs/ARCHITECTURE.md` (background-job-health + the classify pass failure handling).
- **No new bindings, no schema change.** Tenant-clean by construction (a boolean derived from already-tenant-clean job summaries).
