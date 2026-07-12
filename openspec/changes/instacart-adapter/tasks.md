## 1. Correct the product contract and document the spike

- [ ] 1.1 Rewrite the stale Instacart scope in `product-specs/CHANGES.md`, `product-specs/stories/04-store-adapters-and-fulfillment.md`, `product-specs/pages/09-profile-taste-and-preferences.md`, and `product-specs/00-overview.md`: operator API-key Marketplace handoff; no member OAuth/account link, saved/overridden retailer, cart flush/read, price/ETA, callback, or lifecycle/spend assertion; nearby-retailer lookup omitted (or explicitly informational only).
- [ ] 1.2 Add/update the durable official-doc spike under `docs/spikes/` with source links and access dates covering Bearer API-key auth, development/production origins, `products_link`, current `line_item_measurements`, URL reuse/expiry, the Marketplace retailer/cart/checkout flow, nearby-retailer limitations, CTA requirements, and production approval.
- [ ] 1.3 Update `docs/ARCHITECTURE.md` to describe the adapter model and one-operation/two-transports flow, explicitly separating the Instacart link handoff from Kroger/satellite/order lifecycle and spend capture.

## 2. Configuration and tenant-scoped cache

- [ ] 2.1 Add optional `INSTACART_API_KEY` (secret) and `INSTACART_API_ENV` (`development | production`) to `packages/worker/src/env.ts`, with a fail-closed config helper that selects only the two fixed official origins and exposes a secret-free availability projection.
- [ ] 2.2 Add a numbered D1 migration for `instacart_links(tenant, content_hash, url, expires_at, created_at)` with primary key `(tenant, content_hash)` and any expiry index justified by the cleanup query.
- [ ] 2.3 Add cache readers/upserts/expiry cleanup through `packages/worker/src/db.ts` (no direct `env.DB` access from the adapter), requiring tenant on every statement.
- [ ] 2.4 Add unit tests for missing/invalid config, fixed-origin selection, cache hit/miss/expiry, equal-content tenant isolation, and concurrent/upsert convergence.

## 3. Shared Instacart handoff operation

- [ ] 3.1 Implement the canonical payload builder over the existing derived to-buy operation: map every to-buy line once to generic `name`, human `display_text`, and positive `line_item_measurements: [{ quantity, unit: "package" }]`; return `empty` before I/O and carry `underived` gaps.
- [ ] 3.2 Implement a versioned deterministic payload hash (canonical line order and object serialization) covering every upstream request field, and reuse an unexpired tenant-scoped URL with a safety window.
- [ ] 3.3 Implement the injected Instacart client for `POST /idp/v1/products/products_link` with bounded timeout, API-key Bearer auth, `link_type: "shopping_list"`, explicit 30-day expiry, HTTPS Instacart-host URL validation, and closed safe mappings for 400/401/403/429/network/5xx/invalid responses; do not auto-retry creation.
- [ ] 3.4 Implement `createInstacartHandoff` and its discriminated result contract, with no imports/calls to grocery advancement, send/spend writers, Kroger product resolution, or pantry writes.
- [ ] 3.5 Add operation/client tests pinning the exact current request JSON (including absence of deprecated `quantity`/`unit`, retailer, SKU/product/UPC, price, filters, and aisle fields), content-change refresh, URL validation, structured errors/retryability, secret redaction, zero-I/O empty/unconfigured paths, and unchanged grocery/send/spend state after success/reuse/failure.

## 4. MCP and member API transports

- [ ] 4.1 Register MCP tool `create_instacart_handoff` as a thin tenant-scoped wrapper over the shared operation; add an explicit tool description that this creates/reuses a Marketplace page only and never carts, orders, advances rows, or records spend.
- [ ] 4.2 Add session-gated, online-only `POST /api/grocery/instacart` under the existing grocery sub-app, returning the same exported result type and never entering offline replay; no new top-level HTTP route or `run_worker_first` entry is required.
- [ ] 4.3 Add MCP/API contract tests proving both transports share one operation/result, enforce tenant/session isolation, degrade as `not_configured`, and do not leak the key or raw upstream errors.
- [ ] 4.4 Update `docs/TOOLS.md` for the new MCP contract and `docs/SCHEMAS.md` for the cache table/result payload, keeping all stated negative guarantees explicit.

## 5. Member grocery launcher

- [ ] 5.1 Extend the existing configured-adapter/launcher projection with secret-free Instacart availability; do not add account, retailer preference, retailer override, nearby-retailer, price, availability, or ETA state.
- [ ] 5.2 Obtain and commit the appropriate official full-color Instacart logo asset with source/license provenance, then implement the exact approved `Shop on Instacart` CTA (46px height, 29.5px radius, 22px unmodified logo, approved theme/colors) in the member grocery launcher.
- [ ] 5.3 Wire the CTA to the new endpoint and external navigation, with honest loading, empty, underived/incomplete, configuration-race, unauthorized/forbidden, rate-limit, and transient-upstream states; keep it separate from Kroger order review and never render cart/in-cart/order/savings success from a URL.
- [ ] 5.4 Extend the app Playwright page objects/specs and per-area screenshots for configured/unconfigured projection, CTA visual/copy contract, ready navigation, empty/underived, and structured error states using result-typed fixtures and zero live Instacart calls.

## 6. Operator setup, deploy safety, and production gate

- [ ] 6.1 Update `.dev.vars.example`, `CONTRIBUTING.md`, `docs/SELF_HOSTING.md`, and the relevant `packages/worker/wrangler.jsonc` comments with development-key setup, `wrangler secret` handling, environment selection, and disabled-by-default behavior; never commit a key.
- [ ] 6.2 Extend deploy-merge tests to prove operator-owned `INSTACART_API_ENV` survives, code-repo/maintainer vars and secrets do not propagate, and no new binding-type allowlist change is needed.
- [ ] 6.3 Add a credential-gated `.live.test.ts` smoke against the official development origin that verifies only a valid Instacart Marketplace URL and is excluded from default tests.
- [ ] 6.4 Document an explicit post-merge operator production-enable checklist (compliant CTA demo, generated test landing-page URL, production-key request/activation, secret configuration, production verification) and verify the repository stays fail-closed without approved credentials; mark this repository task complete when the checklist and guard are shipped, without claiming third-party approval occurred.

## 7. Verification

- [ ] 7.1 Run targeted Worker unit/contract tests for config, payload mapping, cache isolation/expiry, transport parity, error mapping, and negative lifecycle/send/spend guarantees.
- [ ] 7.2 Run `aubr typecheck`, `aubr test`, and `aubr test:tooling`.
- [ ] 7.3 Run `aubr test:app`, review the generated grocery/launcher screenshots, and fix any visual or interaction regression.
- [ ] 7.4 Run `mise exec -- openspec validate instacart-adapter` and resolve every validation error before review.
