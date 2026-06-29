## Why

`createKrogerClient(env)` on the tool path (`src/tools.ts`) passes no `cache`, so it falls back to a module-level singleton (`kroger.ts` `moduleCache`) whose `locationId` slot is shared across every request an isolate serves — and Cloudflare reuses isolates across tenants. `resolveLocationId` returns the cached id **without comparing the incoming label**, so the first tenant to resolve a store in an isolate pins that `locationId` for every later tenant landing there, silently serving another store's prices, availability, fulfillment flags, and aisle data — and resolving `place_order` SKUs against the wrong store. This is a high-severity cross-tenant data-integrity leak.

The cache that causes it earns nothing. The tool path already memoizes the resolved location per request (`locationPromise` in `src/tools.ts`), so `resolveLocationId` runs at most once per request regardless of the isolate cache. The background flyer warm deliberately **nulls** the slot before every call to resolve many stores, fighting the cache outright. And the common case never touches it at all: a pre-resolved `locationId` label (no whitespace) short-circuits to a direct return with no Locations API call. The `locationId` cache is pure liability — the right fix is to delete it, not to key it better.

## What Changes

- Remove the `locationId` field from the isolate-level Kroger cache. `resolveLocationId` resolves on every call (short-circuit for a pre-resolved label = no round-trip; a ZIP label = the one Locations lookup it always was) and never reads or writes isolate-shared location state. **BREAKING** (internal): `KrogerCache` narrows from `{ token, locationId }` to `{ token }`.
- The `client_credentials` access token stays cached in isolate memory — it is intentionally app-level and shared (ARCHITECTURE.md), and carries no tenant context.
- Retire the flyer-warm workaround: with no `locationId` slot to reset, `src/flyer-warm.ts` drops its private `KrogerCache` and the null-before-each-call `resolveLocationId` wrapper and calls the client directly.
- The cross-tenant leak becomes structurally impossible: no per-tenant state lives in the isolate to leak.
- Update tests asserting location caching and the `KrogerCache` shape; update `kroger-integration` spec wording (and `docs/ARCHITECTURE.md` if it implies location caching).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `kroger-integration`: the **Location resolution** requirement drops "cache it in isolate memory" and its "Resolved location reused" scenario; location resolution is no longer isolate-cached, and isolate-shared state holds only the app-level access token, so a resolved `locationId` never carries from one tenant's request to another's.

## Impact

- **Code:** `src/kroger.ts` (`KrogerCache` interface, `resolveLocationId`, `moduleCache`), `src/flyer-warm.ts` (remove the private cache + reset wrapper), `src/tools.ts` (no change required — `createKrogerClient(env)` is now safe; `locationPromise` remains the request-scoped cache).
- **Tests:** `test/kroger.test.ts` (`freshCache()` shape, location-caching assertions), `test/kroger.live.test.ts` (cache literal).
- **Docs:** `openspec/specs/kroger-integration/spec.md` via delta; `docs/ARCHITECTURE.md` if its Kroger split wording implies a cached location.
- **Behavior:** no user-visible change on the happy path; eliminates a cross-tenant store-context leak. No data migration; no new dependencies.
