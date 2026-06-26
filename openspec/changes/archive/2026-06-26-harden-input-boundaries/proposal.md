## Why

Six issues from the 2026-06-24 automated review (#49, #56, #57, #59, #60, #68) share one root cause: a boundary that accepts malformed, degenerate, or un-normalized input and lets it flow downstream instead of guarding it. Each is small, independent, and low-risk — cheap to land as one defensive-hardening pass rather than six separate PRs. They span the two determinism-boundary parsers (`unit-price.ts`), the only real-cart write (`place_order`), the OAuth `/authorize` entry, the tenant directory enumeration, and the plugin build.

Stale siblings from the same review are deliberately **excluded**: #63 (the `validate.ts` date-literal check it cites no longer exists) and the recipe half of #66 (the overlay's `status`/`rating` were retired) were overtaken by the KV→D1 migration and the overlay simplification. The SSRF/fetch-hardening cluster (#53, #54, #55, #67) is real design work and is left for its own focused change.

## What Changes

- **#59 — `parseSize` finite-positive guard.** Return `null` when the computed quantity is not a finite positive number (`"0 x 1 oz"`, `"1/0"`, a `0`/`Infinity` multiplier), so degenerate sizes route to `incomparable` instead of producing a non-finite or zero `unit_price` that can sort first and mis-pick the "cheapest".
- **#60 — `parsePrice` robustness.** Stop silently mis-parsing ambiguous strings: reject (return `null`) inputs with multiple decimal points or a comma after the last dot, and handle a leading sign, rather than emitting a 1000×-wrong or sign-dropped number from string inputs to `compare_unit_price`.
- **#49 — `place_order` quantity bounds.** Constrain `quantities` and `menu_needs[].quantity` to positive integers within a sane upper bound (`z.number().int().positive().max(99)`), or reject with a structured `validation_failed`, so a fractional/oversized package count can never reach the real Kroger cart.
- **#56 — `GET /authorize` malformed → 400.** Wrap `parseAuthRequest` in try/catch on the GET path (the POST path already does this) and render the existing "malformed authorization request" page with HTTP 400 instead of a generic 500.
- **#57 — tenant directory enumeration normalizes ids.** `TenantStore.list()` SHALL return canonical (lowercase-normalized) ids, matching `get()`, so cross-tenant group-aggregation tools never derive a GitHub path / KV key from stored casing.
- **#68 — build-plugin rejects path traversal.** Reject any `<!-- resource -->` path containing a `..` segment (or one whose resolved destination escapes the flow's `skills/<name>/` tree), so a malformed `AGENT_INSTRUCTIONS.md` edit cannot clobber a file outside the bundle.

## Capabilities

### Modified Capabilities
- `ingredient-matching`: the `compare_unit_price` deterministic-comparison contract makes explicit that degenerate sizes (zero/negative/non-finite quantity) and ambiguous price strings route to `incomparable`/`null` rather than mis-ranking.
- `order-placement`: the quantity-prompting requirement gains a write-time validation guarantee — package counts are positive integers within bounds, or the order is rejected.
- `multi-tenancy`: malformed `/authorize` GET requests render a 400 error page (no 500); the tenant directory's enumeration returns canonical ids at every boundary, not just `get()`.
- `agent-plugin-distribution`: the generated-skills build rejects resource paths that escape the bundle tree.

## Impact

- **Worker (`src/`):** `unit-price.ts` (`parseSize` finite-positive guard; `parsePrice` defensive parse); `order-tools.ts` (`quantities` + `menuNeedShape.quantity` schemas) and/or `order.ts` `computeToBuy` (reject path); `authorize.ts` (GET try/catch → 400); `tenant.ts` (`list()` normalizes ids).
- **Build (`scripts/build-plugin.mjs`):** resource-path validation rejects `..` segments / out-of-tree destinations.
- **Tests:** `test/unit-price.test.ts`, `test/order*.test.ts`, `test/authorize*` (or equivalent), `test/tenant*`, and the build-tooling tests (`tests/*.mjs`) gain cases for each guard.
- **Docs:** `docs/TOOLS.md` — note the `place_order` quantity constraint if the param contract is user-visible. No `docs/SCHEMAS.md` change (no stored-shape change). No new dependencies, secrets, or external calls.
