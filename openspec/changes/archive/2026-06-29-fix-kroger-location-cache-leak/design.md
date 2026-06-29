## Context

The Kroger read client (`src/kroger.ts`) caches two things in a module-level singleton (`moduleCache: KrogerCache = { token, locationId }`) that lives for the isolate's lifetime: the `client_credentials` access token and the resolved `locationId`. Cloudflare reuses an isolate across requests **and tenants**. The token is intentionally app-level (no tenant context — ARCHITECTURE.md:92), but `locationId` is per-tenant store context. `createKrogerClient(env)` on the tool path (`src/tools.ts:166`) passes no `cache`, so it uses the singleton, and `resolveLocationId` (`kroger.ts:198`) returns `cache.locationId` unconditionally without comparing the incoming label. First store to resolve in an isolate pins it for every later tenant there → wrong prices, availability, fulfillment, aisle data, and `place_order` SKUs against the wrong store.

The `locationId` cache provides no value to any caller:
- **Tool path** already memoizes the resolved location per request in `locationPromise` (`tools.ts:186-201`), so `resolveLocationId` runs at most once per request — the isolate cache is never the thing that saves a call.
- **Flyer warm** (`flyer-warm.ts:393-415`) keeps a private cache solely to **null** `locationId` before each call, so it can resolve many stores in one sweep — it actively disables the cache.
- **Common case** short-circuits: a pre-resolved `locationId` label (no whitespace) returns directly (`kroger.ts:203-206`) with no Locations API call, so there is nothing to cache.

## Goals / Non-Goals

**Goals:**
- Make the cross-tenant `locationId` leak structurally impossible.
- Keep the app-level `client_credentials` token cached in isolate memory (unchanged).
- Remove the flyer-warm reset workaround that the single-slot cache forced into existence.

**Non-Goals:**
- Changing token caching, rate-limit backoff, or the concurrency cap.
- Adding a per-label location `Map` or any new cache mechanism — the conclusion is to remove location caching, not relocate it.
- Touching the per-tenant `authorization_code` cart-write path or the shared flyer KV cache.

## Decisions

**Decision: Delete `locationId` from the isolate cache rather than key it by label.**
`KrogerCache` narrows from `{ token, locationId }` to `{ token }`. `resolveLocationId` reads/writes no isolate location state — it short-circuits a pre-resolved label or does the one Locations lookup and returns. `moduleCache` keeps only the token.
- *Why over a `Map<label, locationId>`:* the Map would correctly key the cache, but the cache earns nothing (per Context: the tool path memoizes per request; flyer-warm disables it; the hot path short-circuits). Removing state is simpler than correcting state, and it eliminates the bug by construction — there is no per-tenant isolate state left to leak. It also dissolves the flyer-warm workaround instead of leaving it in place.
- *Why over a per-request private cache (issue's option A):* a per-request `{ token: null, locationId: null }` fixes the leak but either re-mints the token every request (the token is meant to be shared isolate-wide) or still requires splitting the token to module scope — more plumbing than deleting the field, and it leaves the dead single-slot design and the flyer-warm workaround in place.

**Decision: `createKrogerClient(env)` on the tool path stays unchanged.**
Once `locationId` is gone, the only isolate-shared state is the token, which is supposed to be shared. The call is safe as written; `locationPromise` remains the request-scoped location cache.

**Decision: Flyer warm calls the client directly.**
With no `locationId` slot to reset, `buildWarmDeps` drops the private `KrogerCache` and the null-before-each-call `resolveLocationId` wrapper. It may use the default module cache like the tool path (token shared, no location state).

## Risks / Trade-offs

- **[Repeated ZIP-label resolution costs an extra Locations round-trip]** → In practice negligible: stored labels are pre-resolved `locationId`s that short-circuit with no API call; the ZIP path is the rare fallback, and it was already called at most once per request (tool path) or once per store per sweep (flyer warm). No hot loop re-resolves the same label.
- **[Spec/doc drift]** → The `kroger-integration` "Location resolution" requirement is updated in the same pass (delta spec), and `docs/ARCHITECTURE.md` is checked for any wording that implies a cached location. The token-reuse requirement is untouched.
- **[A future caller assumes isolate-level location caching]** → The updated requirement states explicitly that no resolved location is cached in isolate memory, so the contract documents the absence.
