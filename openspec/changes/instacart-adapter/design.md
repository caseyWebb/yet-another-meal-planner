## Context

The original Band 3 product slice assumed Instacart member OAuth, a preferred retailer, and a cart-flush sibling of `place_order`. The required feasibility spike against the current Instacart Developer Platform documentation found a different contract:

- Public API calls use an operator-issued API key in `Authorization: Bearer …`; there is no member OAuth/callback/account link in this integration.
- `POST /idp/v1/products/products_link` creates a shopping-list page and returns `products_link_url`. The member then chooses a retailer, reviews product matches, adds products, and checks out in Instacart Marketplace.
- The endpoint does not accept a retailer target and does not expose cart reads/writes, prices, availability, delivery ETA, or checkout state.
- Current line items use `line_item_measurements`; top-level line-item `quantity` and `unit` are deprecated. Instacart recommends caching and reusing a URL until the list content changes.
- `GET /idp/v1/retailers` can list retailer organizations near a postal code, but those results cannot target the shopping-list link.
- Production keys require Instacart review, including a compliant branded CTA and demo.

Primary references are Instacart's [API overview](https://docs.instacart.com/developer_platform_api/api/overview/), [shopping-list endpoint](https://docs.instacart.com/developer_platform_api/api/products/create_shopping_list_page), [shopping-list flow](https://docs.instacart.com/developer_platform_api/guide/concepts/shopping_list), [nearby-retailers endpoint](https://docs.instacart.com/developer_platform_api/api/retailers/get_nearby_retailers/), [CTA design](https://docs.instacart.com/developer_platform_api/guide/concepts/design/cta_design/), and [pre-launch checklist](https://docs.instacart.com/developer_platform_api/guide/concepts/launch_activities/pre-launch_checklist).

Yamp already has the deterministic derived to-buy operation used by `read_to_buy`, `place_order`, and satellite list issuance. It also has the one-operation/multiple-transports pattern: an MCP tool and a member `/api` route call the same `src/` operation with tenant context and injected dependencies. Grocery lifecycle, send records, and spend materialization are guarded shared operations; the Instacart handoff must deliberately never enter them.

## Goals / Non-Goals

**Goals:**

- Offer a useful Instacart Marketplace handoff from the same current derived to-buy set every fulfillment surface sees.
- Keep the adapter optional, tenant-isolated, cache-efficient, testable without live credentials, and honest about what the API did.
- Share all mapping, caching, external-call, and result behavior between the MCP and member-app transports.
- Meet the current Instacart request and customer-facing CTA contracts and document the external production-approval gate.
- Correct the product/living documentation so later changes do not rebuild the invalid OAuth/retailer/cart assumptions.

**Non-Goals:**

- Member Instacart OAuth, callback routes, account state, or per-member access/refresh tokens.
- A preferred retailer, per-trip retailer override, retailer-targeted shopping link, or retailer/store persistence.
- Product resolution, SKU/UPC selection, brand or health filters, prices, promotions, inventory, delivery ETA, cart mutation/readback, checkout, order status, or purchase confirmation.
- Any grocery-list transition, send record, spend snapshot/event, pantry write, or claim that a handoff carted or purchased an item.
- Nearby-retailer UI/API in this first slice. If added later, it is informational discovery only and cannot alter the handoff payload or guarantees.
- Affiliate/conversion tracking.

## Decisions

### 1. Model Instacart as a Marketplace-link adapter, not an order adapter

Add `createInstacartHandoff(env, tenant, deps?)` under `packages/worker/src/` and expose it through MCP `create_instacart_handoff` and session-gated `POST /api/grocery/instacart`. The operation returns a discriminated result:

- `{ status: "ready", url, expires_at, reused, item_count, destination: "instacart_marketplace" }`
- `{ status: "empty", item_count: 0 }`
- `{ status: "unavailable", code: "not_configured" }`
- `{ status: "error", code: "invalid_request" | "unauthorized" | "forbidden" | "rate_limited" | "upstream_unavailable" | "invalid_response", retryable }`

The tool and endpoint are thin adapters: they resolve tenant/session context, call this operation, and serialize the same shape. The operation never calls `advanceGroceryRows`, send-record writers, spend writers, Kroger resolution, or pantry operations. A handoff is an outbound navigation artifact, not evidence that the member selected products.

Alternative: extend `place_order` with an adapter flag. Rejected because that operation's contract resolves Kroger SKUs, writes a cart, advances rows to `in_cart`, and snapshots a send; sharing its name/result would make the Marketplace URL look like an equivalent flush when it is not.

### 2. Derive the payload from the existing to-buy operation

Call the shared derived to-buy operation and map `to_buy` only. This preserves `active list ∪ plan-derived needs − pantry`, canonical deduplication, in-flight suppression, and explicit `underived` reporting without creating another list algebra. An empty `to_buy` returns `status: "empty"` before hashing or external I/O. The result should carry `underived` so both surfaces can warn that the list may be incomplete.

Each line maps to:

```json
{
  "name": "generic human search term",
  "display_text": "human-facing line label",
  "line_item_measurements": [{ "quantity": 2, "unit": "package" }]
}
```

The current to-buy line's positive numeric package count maps to one `package` measurement; values that are absent/invalid must already have become the existing honest default (`quantity: 1`, `assumed_quantity: true`). Never infer cups/ounces from recipe text, never send deprecated top-level `quantity`/`unit`, and never reuse Kroger SKU/product identifiers, UPCs, prices, filters, or aisle data. `name` remains a generic match term without quantity or brand wording; `display_text` uses the resolved human label. The request sets `link_type: "shopping_list"`, a stable title such as `Yamp grocery list`, `expires_in: 30`, and no retailer parameter (none exists).

Alternative: use recipe ingredient strings/measurements. Rejected because the derived projection is presence-only and the current list quantity is a package count; inventing recipe measurements would violate the deterministic boundary and could misstate quantities.

### 3. Cache by tenant plus an exact canonical-payload hash

Add a D1 migration for:

```text
instacart_links(
  tenant TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  url TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant, content_hash)
)
```

All SQL lives behind `src/db.ts` interfaces. The hash input is a versioned canonical JSON representation of every upstream request field that affects the page, with line items sorted by canonical ingredient key and object keys serialized deterministically. The tenant is deliberately not inside the hash but is always part of the primary key/query, preventing cross-tenant URL disclosure even when two households have identical lists.

On a hit whose `expires_at` is later than a small safety window (for example now + 5 minutes), return it with `reused: true` and make no Instacart call. On a miss/expired hit, call Instacart, validate that `products_link_url` is HTTPS on `instacart.com` or a subdomain, and upsert the row with an expiry matching the request's 30-day lifetime. Expired rows may be removed opportunistically; correctness never depends on cleanup. Concurrent identical misses may create more than one upstream page, but the final upsert converges and each caller receives a valid URL.

Alternative: KV. Rejected because these links are tenant domain data with an explicit cache contract, D1 provides strong tenant-keyed reads/upserts and testability, and no new binding or deploy provisioning is needed.

### 4. Configuration is operator-owned and fail-closed

Add secret `INSTACART_API_KEY` and non-secret `INSTACART_API_ENV=development|production` to `Env`. Both must be present and valid for the adapter to be configured. The environment selects one of two compile-time origins:

- development: `https://connect.dev.instacart.tools`
- production: `https://connect.instacart.com`

No arbitrary origin is accepted. Missing/invalid configuration returns `not_configured` before hashing, D1 writes, or fetch. The member launcher gets adapter availability from the existing deployment/profile aggregate (a boolean/environment-safe status, never the key) and renders no CTA when unavailable. The API key is set with `wrangler secret`, never committed or returned.

The existing deploy merge already preserves operator `vars` and out-of-band Wrangler secrets; this change introduces no binding type, so there is no new code-level binding allowlist entry. Tests must nevertheless pin that `INSTACART_API_ENV` survives the operator-owned vars merge and that no maintainer key/default is propagated. `.dev.vars.example`, self-hosting, contributing, Wrangler comments, and environment docs must distinguish development from production and state that switching to production is allowed only after Instacart activates the reviewed production key.

Alternative: infer environment from key format. Rejected because key formats are not a stable environment contract and an accidental development/production cross-call should fail closed.

### 5. Map upstream failures into stable, non-secret errors

Use injected `fetch` and a bounded request timeout. Send only `Accept`, `Content-Type`, and `Authorization: Bearer <key>`. Map 400, 401, 403, 429, and 5xx/network/invalid-body cases into the operation's closed codes, retaining a safe retryability bit but never reflecting the Bearer token, raw response body, or upstream URL query into logs/tool content. Do not automatically retry non-idempotent page creation; URL caching prevents normal duplicate work, while a caller can retry an explicitly retryable failure.

Alternative: generic `internal_error`. Rejected because callers need to distinguish operator configuration/approval problems from transient upstream failures without seeing secrets.

### 6. The member surface is a compliant external handoff

Add a `Shop on Instacart` action to the grocery launcher's configured-adapter projection. Activating it calls `POST /api/grocery/instacart`, then opens the returned URL as an external navigation. The button follows Instacart's current approved CTA theme contract (46px height, 29.5px radius, 22px unmodified full-color logo, exact approved text/colors) using a locally committed official logo asset with provenance/license noted. Copy says the member will choose a retailer and review/add items on Instacart; it does not say “sent to cart,” show a preferred retailer, or mention price/ETA/delivery speed.

The CTA stays online-only and is disabled while generating a link. `not_configured` is normally unreachable because the launcher hides it, but remains handled for configuration races. `ready` opens the link; `empty`, `underived`, and structured errors render honest states. Returning a URL does not move rows to the in-cart group or display order-success/savings UI.

Alternative: reuse the Kroger order-review dialog. Rejected because its candidate, price, cart-write, reauth, and in-cart result semantics do not exist for Instacart.

### 7. Nearby retailers are omitted from v1

Do not call `GET /idp/v1/retailers`, add a postal-code endpoint, store a retailer, or render a retailer picker. Instacart Marketplace performs retailer selection after handoff. A future change may add nearby organizations as informational context only; it must retain a visible statement that availability is not guaranteed and must not affect hashing, link generation, preference state, or CTA claims.

Alternative: preserve the mock's retailer picker using nearby-retailer results. Rejected because `products_link` cannot target that choice, so the control would imply a guarantee the integration cannot fulfill.

## Risks / Trade-offs

- **[Marketplace matches can differ from yamp's intent]** → Send generic names plus honest package measurements, make review explicit, expose `underived`, and never claim products were selected.
- **[No price/cart/order feedback]** → Keep lifecycle and telemetry untouched and word every result as a handoff.
- **[Upstream link lifetime or API contract changes]** → Version the hash domain, set explicit expiry, validate responses, and cover request shape with fixtures; live smoke remains credential-gated.
- **[Two callers race on a cold content hash]** → Accept occasional duplicate page creation; D1 upsert converges without blocking on a distributed lock.
- **[Production approval delays availability]** → Ship disabled-by-default, document the development demo path and external approval gate, and expose structured configuration state.
- **[Instacart branding requirements evolve]** → Keep the CTA isolated with exact visual coverage and cite the official source in implementation/docs so it is easy to audit.
- **[A stored handoff URL is sensitive browsing context]** → Scope every read/write by tenant, never show it in cross-tenant admin/telemetry logs, and expire it with the upstream page.

## Migration Plan

1. Land the D1 cache migration, operation/transports, docs, disabled CTA, and explicit operator production-enable checklist. With no configuration, behavior is unchanged and the route/tool return `not_configured`; this fail-closed state plus the documented checklist is the repository acceptance boundary.
2. After merge, an operator with a development key may configure `INSTACART_API_ENV=development` locally/staging, run the opt-in live smoke, and record the compliant CTA/landing-page demo for Instacart. This optional deployment work does not block completing or archiving the repository change.
3. After merge, the operator requests Instacart production approval. Only if Instacart later activates a production key does the operator complete the checklist, set the production secret and `INSTACART_API_ENV=production`, deploy, and verify one generated Marketplace URL. The repository change does not claim these external steps occurred.
4. Rollback is configuration-first: remove either setting to hide the CTA and make the operation fail closed. Code rollback may leave the additive cache table/rows harmlessly in place.

## Open Questions

- None blocking implementation. Affiliate tracking and informational nearby-retailer discovery require separate proposals if desired.
