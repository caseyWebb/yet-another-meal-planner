## 1. Remove the isolate location cache (`src/kroger.ts`)

- [x] 1.1 Narrow the `KrogerCache` interface from `{ token, locationId }` to `{ token }`; update its doc comment to describe a token-only cache.
- [x] 1.2 Update `moduleCache` to `{ token: null }`.
- [x] 1.3 Rewrite `resolveLocationId` to read/write no isolate location state: keep the no-whitespace pre-resolved-label short-circuit (return directly), keep the ZIP-parse + Locations API lookup, and return the resolved id without caching it. Update the function's comment and the file header comment that mention caching the resolved `locationId`.

## 2. Retire the flyer-warm workaround (`src/flyer-warm.ts`)

- [x] 2.1 Drop the private `krogerCache` in `buildWarmDeps` and construct the client with the default cache (`createKrogerClient(env)`), removing the `KrogerCache` import if now unused.
- [x] 2.2 Replace the `resolveLocationId` wrapper that nulls the cache slot with a direct call to `kroger.resolveLocationId(label)`; remove the now-stale comment explaining the reset.

## 3. Confirm the tool path is correct (`src/tools.ts`)

- [x] 3.1 Verify `createKrogerClient(env)` (line ~166) needs no change — the only isolate-shared state left is the token — and that `locationPromise` remains the request-scoped location cache. No code change expected.

## 4. Tests

- [x] 4.1 Update `test/kroger.test.ts`: change `freshCache()` (and any inline cache literals) to the `{ token }` shape; remove/replace assertions that depend on `locationId` being cached across calls.
- [x] 4.2 Add a test proving location resolution holds no isolate-level state: two resolutions for different labels through one client (sharing the module/token cache) each return their own `locationId` — the second never returns the first's id.
- [x] 4.3 Update the `cache` literal in `test/kroger.live.test.ts` to the `{ token }` shape.

## 5. Specs & docs

- [x] 5.1 Confirm the `kroger-integration` delta (`specs/kroger-integration/spec.md`) matches the implemented behavior; run `openspec validate "fix-kroger-location-cache-leak"`.
- [x] 5.2 Check `docs/ARCHITECTURE.md` (Kroger split, ~line 92) for any wording implying a cached `locationId`; correct it to state only the token is isolate-shared. Update `docs/TOOLS.md`/`docs/SCHEMAS.md` only if they reference location caching (no change expected).

## 6. Verify

- [x] 6.1 Run `aubr typecheck` and `aubr test` (the non-live Worker suite); ensure all pass.
