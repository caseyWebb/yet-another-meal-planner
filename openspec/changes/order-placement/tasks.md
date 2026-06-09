## 1. Kroger user-context auth (authorization_code + PKCE)

- [x] 1.1 Implement a Kroger user-auth client: build the authorize URL with PKCE `code_challenge` + `state`; exchange `code` + verifier for access + refresh tokens
- [x] 1.2 Implement refresh with single-use rotation: write the new refresh token to KV **before** using the new access token; cache the access token in isolate memory, re-mint on expiry
- [x] 1.3 Map a Kroger-rejected refresh to structured `{ error: "reauth_required" }`; other failures to `upstream_unavailable`
- [x] 1.4 KV namespace for the refresh token: create it and bind it in `wrangler.jsonc`; read on cold start, rewrite on each refresh <!-- binding + read/rewrite code done; the `wrangler kv namespace create` is infra §8.1 -->

## 2. OAuth routes + Access carve-out

- [x] 2.1 Add an `/oauth/*` route group in the Worker: `/oauth/init` (redirect to Kroger with PKCE+state) and `/oauth/callback` (verify `state`, exchange code, store refresh token)
- [x] 2.2 Ensure `/oauth/*` is reachable without an Access JWT in-Worker (no JWT enforcement on those paths); keep `/mcp` and all else gated
- [x] 2.3 Add the Cloudflare Access **bypass** policy for `/oauth/*` on the gated hostname — **infra (dashboard)** <!-- done: path-scoped Bypass app on groceries-mcp.caseywebb.xyz/oauth/* -->
- [x] 2.4 Register the redirect URI (`https://grocery-mcp.<domain>/oauth/callback`) with the Kroger app; set `authorization_code` client ID/secret via `wrangler secret put` — **infra** <!-- done: redirect URI https://groceries-mcp.caseywebb.xyz/oauth/callback registered; creds reuse the client_credentials app via fallback (no separate secrets) -->

## 3. Cart write

- [x] 3.1 Implement the `PUT /v1/cart/add` subroutine using a user-context access token; structured errors per convention
- [x] 3.2 Confirm the required cart scope (e.g. `cart.basic:write`) and request it in the authorize step <!-- requested in CART_SCOPE; live confirmation rides §8.3 -->

## 4. `place_order` tool

- [x] 4.1 Compute the to-buy set: `grocery_list ∪ menu-needs − pantry-has` (dedup)
- [x] 4.2 Resolve each item via the Change 05 matcher with cache revalidation; collect `ambiguous`/`unavailable` into one batch checkpoint and do not auto-add them
- [x] 4.3 For the resolved set: commit SKU-cache appends to `skus/kroger.toml` via the Change 06 engine, then `PUT /v1/cart/add`; advance those list items to `in_cart`
- [x] 4.4 Return honest partial status (cart vs. commit independently); never report a populated cart on cart-write failure
- [x] 4.5 Register `place_order` on the MCP server with its Zod schema

## 5. Lifecycle orchestration

- [x] 5.1 "I placed the order" → advance `in_cart` items to `ordered` (via `update_grocery_list`) <!-- agent behavior; documented in CLAUDE.md Order placement flow -->
- [x] 5.2 "I picked up the groceries" → `received`: remove items from the list and restock `pantry.toml` for `grocery`-kind items only <!-- agent behavior; CLAUDE.md -->
- [x] 5.3 Stale-cart reminder at the start of a new order when prior `in_cart` items were never confirmed `ordered` <!-- agent behavior; CLAUDE.md -->
- [x] 5.4 Partial-stock prompt: surface the plan's required amount (aggregated from `for_recipes`) and ask before adding; default buy = 1 package <!-- `partials` surfaced by computeToBuy; prompt behavior in CLAUDE.md -->

## 6. Docs

- [x] 6.1 `docs/TOOLS.md`: replace the `place_order` stub with full semantics (resolution, checkpoint, cart write, SKU cache, partial-failure, lifecycle)
- [x] 6.2 `CLAUDE.md`: order-placement orchestration, user-asserted transitions, stale-cart reminder, partial prompt
- [x] 6.3 `worker/README.md`: Kroger OAuth + KV setup, the one-time `/oauth/init`, the `/oauth/*` Access carve-out

## 7. Tests

- [x] 7.1 Auth rotation tests (mocked Kroger): write-before-use ordering; rejected refresh → `reauth_required`; `state` mismatch rejected
- [x] 7.2 Cart-write tests (mocked): success, scope/upstream failure → structured error
- [x] 7.3 `place_order` tests: to-buy dedup; ambiguous/unavailable batching; partial-failure reporting (cart fails but cache committed, and vice versa)

## 8. Deploy + verify

- [x] 8.1 Create KV namespace + Access bypass; deploy via CD — **infra** <!-- KV id aee060bb… bound; /oauth/* bypass added; CD deployed (commit fdd14aa, scope fix 6e2d33d) -->
- [x] 8.2 Run the one-time `/oauth/init` authorization to seed the refresh token — **infra (user)** <!-- done: kroger:refresh_token present in prod KV -->
- [x] 8.3 `place_order` end-to-end against the live cart; confirm items added, SKU cache appended, list advanced to `in_cart` — **infra (user)** <!-- done: whole milk (SKU 0001111040601) → cart.written; skus/kroger.toml commit 837e1b9; grocery_list.toml in_cart commit 1a3b590 -->
