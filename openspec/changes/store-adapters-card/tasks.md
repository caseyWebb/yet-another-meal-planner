## 1. Shared adapter projection

- [ ] 1.1 Add workerd-pure store-adapter wire types with stable adapter, launcher-mode, and disabled-reason discriminants, including nullable Satellite freshness and exact Kroger display identity.
- [ ] 1.2 Implement the named `loadStoreAdapterProjection` operation over `readPreferences`, Kroger refresh-token presence, and existing shared-store readers; filter Offline rows to grocery domain, tolerate legacy Kroger preferences, resolve missing selected slugs honestly, and produce deterministic launcher ordering without direct `env.DB` or external calls.
- [ ] 1.3 Add focused operation/shape tests for linked/unlinked Kroger, legacy/exact location preferences, selected Offline and missing-slug states, satellite-marked preference degradation, non-grocery filtering, Instacart exclusion, secret-free payloads, and deterministic ordering.

## 2. Kroger member operations and endpoints

- [ ] 2.1 Extend the public Kroger client with a bounded `locationsNearZip` read that requests at most ten locations and normalizes exact id/name/address/ZIP while preserving provider nearest-first order; add client tests for normalization, empty results, request bounds, rate/upstream handling, and no user OAuth dependency.
- [ ] 2.2 Add an explicit per-tenant user-token cache eviction operation in `kroger-user.ts`, covering access-token and in-flight refresh state, and test tenant isolation plus eviction after cached access exists.
- [ ] 2.3 Add session-gated `GET /api/profile/store-adapters`, `GET /api/profile/kroger-locations?zip=`, and `DELETE /api/profile/kroger-connection` routes as thin adapters over named operations, retaining `GET /api/profile/kroger-login-url`; validate exact five-digit ZIPs, map structured errors, delete the refresh token, evict isolate state, and keep every route under the existing `/api*` Worker-first prefix.
- [ ] 2.4 Extend member API tests for session gating, projection parity, multi-location/zero-result/invalid/upstream search, idempotent disconnect, cached-state eviction, preferred-location preservation, and cross-tenant isolation; update the typed route export/client generation as required.

## 3. Preferences Store card

- [ ] 3.1 Add the non-persisted `['store-adapters']` query hook and shared app-side wire imports; explicitly keep adapter/location/login responses out of the persisted query allowlist and mutation registry.
- [ ] 3.2 Replace the flat preferred-store/ZIP block in `_app.profile.tsx` with accessible Kroger / Instacart / Satellites / Offline tabs sourced only from the projection, retaining the rest of the Planning, Dietary, and Preferred Brands cards unchanged.
- [ ] 3.3 Implement the online-only Kroger controls: connect/reconnect from the existing login-URL endpoint, direct disconnect with adapter invalidation, and a submit/Enter ZIP modal showing up to ten provider-ordered exact results with structured empty/error states.
- [ ] 3.4 On Kroger result selection, use the existing preferences ETag/rebase flow to atomically write exact location id/name/address/ZIP, `primary='kroger'`, and `fulfillment:null`; remove the standalone ZIP preference control and close without writing when no result is selected.
- [ ] 3.5 Render Satellite as a read-only `freshness_unavailable` summary with Satellites/authoring links and no helper secret, render Offline from existing grocery store identities with conditional standing selection but no CRUD/map editor, and render Instacart as a non-interactive coming-later placeholder.
- [ ] 3.6 Add the Store-card/modal/tab responsive and focus styles using existing shared UI primitives, including disabled offline hints and keyboard/focus return behavior.

## 4. Grocery launcher and invalidation

- [ ] 4.1 Replace the Grocery page's raw-profile Kroger gate with a launcher that consumes only projection entries, dispatches by launcher `mode`, preserves the manual-shop fallback outside the projection, and renders disabled reasons without issuing unavailable fulfillment requests.
- [ ] 4.2 Wire successful preferred-store changes and disconnect to invalidate the adapter/enriched-placement queries, close and discard any open Order Review preview/dispositions, and preserve store-agnostic to-buy membership and grocery lifecycle rows; prove a subsequent preview uses the new exact location.
- [ ] 4.3 Render the deterministic degraded Satellite launcher entry as disabled, exclude Instacart entirely, and bind Offline/Kroger modes only to their actually shipped sibling flow with an honest disabled state when that serial Band-3 surface is not yet present.
- [ ] 4.4 Add app-level tests that no adapter query or operation is persisted/dehydrated, no class (a) selection or disconnect is queued offline, and reconnect never auto-fires an adapter action.

## 5. Member UI verification

- [ ] 5.1 Extend the app Playwright seed and Profile/Grocery page objects first for shared Offline stores, Kroger adapter state, tab/modal actions, and launcher assertions; keep external Kroger calls behind typed route fixtures rather than production fakes.
- [ ] 5.2 Extend Profile Playwright coverage for all four tabs, exact selection from multiple ZIP results, modal cancel/empty/error behavior, legacy-location rendering, connect/disconnect, offline-disabled writes, Satellite degraded copy/links, Offline registry reuse, missing selected slug, and the absence of aisle-map/Instacart actions.
- [ ] 5.3 Extend Grocery Playwright coverage to prove Profile/launcher parity from one projection, actionable Kroger disabled reasons, enabled Kroger launch, disabled Satellite state, no Instacart entry, Offline selected-store identity, and store-change/disconnect preview invalidation without list mutation.
- [ ] 5.4 Run the app Playwright suite (`aubr test:app`), review its per-area screenshots at desktop and tall/mobile breakpoints, and iterate until the changed Profile and Grocery surfaces are visually correct and stable.

## 6. Contracts, docs, and persona

- [ ] 6.1 Update `docs/SCHEMAS.md` with additive `preferences.stores.preferred_location_name` / `preferred_location_address` fields, exact-id semantics, legacy tolerance, and the secret-free adapter projection wire shape; confirm explicitly that no D1 migration is needed.
- [ ] 6.2 Update `docs/ARCHITECTURE.md` with the one-operation adapter/launcher model, Kroger search/credential boundaries, Offline registry reuse, closed Satellite degradation, Instacart deferral, invalidation boundary, and explicit online/class-(a) classifications.
- [ ] 6.3 Audit `docs/TOOLS.md` and the store tool descriptions against D6; if the serial offline-walk change has not already landed the required wording, change generic non-Kroger terminology to "Offline adapter" without changing tool behavior or shapes.
- [ ] 6.4 Update `AGENT_INSTRUCTIONS.md` for Appendix C Band 3: ready-to-eat is always offered and never auto-added, receive/"I placed the order" choreography routes through the shared operations, and existing generic stores use "Offline store" naming; avoid placing deterministic API guarantees in the persona.
- [ ] 6.5 Run `aubr build:plugin --check` and inspect the generated-bundle check without hand-editing generated plugin output.

## 7. Final verification

- [ ] 7.1 Run targeted Worker tests for the projection, Kroger client/user cache, preferences, and member API plus `aubr typecheck`; fix all failures without weakening the contracts.
- [ ] 7.2 Run `aubr test:app` and the relevant tooling/plugin checks again after documentation/persona changes, then run `mise exec -- openspec validate store-adapters-card` and verify every task/spec/doc obligation is represented before review.
