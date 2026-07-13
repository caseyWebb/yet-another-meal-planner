## Why

Yamp needs an Instacart fulfillment option, but the feasibility spike invalidated the product plan's assumed member OAuth, preferred-retailer cart flush, and purchase telemetry. The available Developer Platform contract is instead an operator-authenticated shopping-list link that hands the member to Instacart Marketplace, so the integration must ship as an honest handoff rather than pretend to control a cart or order.

## What Changes

- Add an optional, deployment-configured Instacart adapter that calls `POST /idp/v1/products/products_link` with an operator API key as a Bearer token and returns the Marketplace handoff URL.
- Map the tenant's current derived to-buy lines into Instacart shopping-list line items. Use `line_item_measurements` when a positive package count can be represented with a supported unit; never send the deprecated top-level line-item `quantity`/`unit` fields, fabricate recipe measurements, or send Kroger product identifiers.
- Cache generated URLs by tenant and a canonical content hash, reuse unexpired links while the list is unchanged, and generate a new link only after content changes or expiry.
- Expose one shared operation through a new MCP tool and a session-gated `/api/grocery/instacart` endpoint. Both return structured unavailable/upstream failure states and make no external request when the API key is absent.
- Add the approved, branded `Shop on Instacart` CTA to the grocery launcher only when the adapter is configured. The URL opens Instacart Marketplace, where the member chooses a retailer, reviews matches, adds products, and checks out.
- If nearby-retailer lookup is retained, expose it as postal-code-based informational discovery only; it must not become a saved preference or an input to `products_link`, and the UI must not promise retailer targeting, price, availability, delivery timing, or cart state.
- Explicitly keep a successful handoff read-only with respect to grocery lifecycle and spend: no `active → in_cart`, `sent_in`, order send/snapshot, spend event, or assertion that anything was carted or purchased.
- Correct stale product specifications and living architecture/tool/schema/self-hosting/contributing documentation to the API-key Marketplace-handoff model, including secret/config setup, deploy-merge behavior, and the external production-key approval gate.
- Add operation, transport, cache-isolation/expiry, degradation, and member-app coverage without a live Instacart dependency in the default suites; retain an optional credential-gated development-server smoke test when a development key is available.

## Capabilities

### New Capabilities

- `instacart-adapter`: Operator configuration, shopping-list payload mapping, tenant-scoped content-hash URL caching, optional nearby-retailer information, structured degradation, shared transports, and the Marketplace handoff boundary.

### Modified Capabilities

- `member-app-core`: Replace the non-interactive coming-later Instacart Store tab with the shared projection's secret-free configured/not-configured availability, without member account or retailer controls.
- `store-adapter-projection`: Add secret-free Instacart availability and the configured-only `marketplace_handoff` launcher entry to the one shared adapter projection.
- `member-app-grocery`: Add the configured-only branded launcher CTA and thin Instacart handoff endpoint without changing the Kroger order preview/commit flow.
- `order-placement`: Define that an Instacart Marketplace handoff is not an order/cart flush and causes no grocery lifecycle, send-record, or spend transition.

## Impact

- Worker operations, D1 access through `src/db.ts`, a new D1 migration for tenant-scoped URL cache rows, environment typing, MCP registration, and the member grocery API route.
- Grocery launcher UI and its app Playwright fixtures/coverage; shared UI assets must follow Instacart's production CTA requirements.
- `docs/ARCHITECTURE.md`, `docs/TOOLS.md`, `docs/SCHEMAS.md`, `docs/SELF_HOSTING.md`, `CONTRIBUTING.md`, `.dev.vars.example`, `packages/worker/wrangler.jsonc`, and deploy-merge regression coverage.
- Repository acceptance requires a documented, fail-closed operator production-enable checklist; requesting/receiving Instacart approval and configuring an approved production key are post-merge deployment work. No approval is claimed by this change. No member OAuth route, callback, token store, account-link UI, retailer preference, or new `run_worker_first` path is introduced.
