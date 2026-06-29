## 1. Nonce mint/redeem core

- [x] 1.1 Add a single shared nonce helper (e.g. in `src/kroger-user.ts` or a small new module): `mintAuthNonce(kv, tenant)` writes `kroger:authnonce:<nonce> → { tenant }` with a short `expirationTtl` (~600s, matching `PKCE_TTL_SECONDS`) using the existing `base64url(crypto.getRandomValues(...))` helpers, and returns the nonce; `redeemAuthNonce(kv, nonce)` reads, deletes (single-use), and returns the bound tenant or null. Never log the nonce.
- [x] 1.2 Unit-test mint/redeem: happy path, second redemption returns null (single-use), and an unknown nonce returns null.

## 2. /oauth/init redeems the nonce (remove ?tenant)

- [x] 2.1 In `src/oauth.ts`, change `/oauth/init` to read `?nonce`, call `redeemAuthNonce`, and use the redeemed tenant; remove the `?tenant` read and the TRANSITIONAL comment. Missing/unknown/expired nonce → `400`, no redirect, no flow.
- [x] 2.2 Keep the rest of init unchanged (PKCE verifier + `state`, store `{ verifier, tenant }` under the state key, 302 to Kroger) and leave `/oauth/callback` untouched.
- [x] 2.3 Update/extend `oauth` unit tests: init with a valid nonce redirects and binds the redeemed tenant; init with no/invalid/expired nonce is rejected; a nonce cannot be reused; the forged-callback test still passes.

## 3. kroger_login_url MCP tool

- [x] 3.1 Register a zero-param `kroger_login_url` tool on the authenticated `/mcp` server (in `src/tools.ts` / the relevant tool module). Derive the tenant from the resolved grant (the `Tenant` already passed to `buildServer`), NOT from any argument; mint a nonce and return `{ url: "<origin>/oauth/init?nonce=<nonce>" }` using the request origin already threaded into `buildServer`.
- [x] 3.2 Add a tool test: the returned URL embeds a freshly minted nonce bound to the caller's tenant, and the tool accepts no tenant input.

## 4. Operator admin mint action

- [x] 4.1 Add an Access-gated endpoint under `/admin/api/*` (in `src/admin.ts`) that mints the same nonce for a chosen allowlisted tenant (resolved via the same allowlist check the rest of `/admin*` uses) and returns the `/oauth/init?nonce=…` URL; 404 when Access is unconfigured; reject a non-allowlisted tenant; not exposed as an MCP tool; never log the nonce.
- [x] 4.2 Add an admin SPA control (in `admin/`) to request and display the consent link for a selected member, modeled per `admin/CLAUDE.md` (RemoteData for the request). Rebuild the bundle with the build script (not hand-edited).
- [x] 4.3 Add an admin-endpoint test: minting for an allowlisted member returns a link; a non-member is rejected; the route 404s when Access is unconfigured.

## 5. Docs, persona, and spec lockstep

- [x] 5.1 `docs/TOOLS.md`: document the `kroger_login_url` tool contract (no params → `{ url }`); fix the `reauth_required` guidance (around line 830) to point at the tool/link instead of `/oauth/init?tenant=<id>`.
- [x] 5.2 `AGENT_INSTRUCTIONS.md` (~line 371): change the `reauth_required` instruction from "re-run `/oauth/init?tenant=<me>`" to "call `kroger_login_url` and give me the link".
- [x] 5.3 `docs/SELF_HOSTING.md` (~lines 146, 177): update operator first-run Kroger consent to the `/admin` mint action, and member consent to the agent-provided link; drop the `?tenant=` URLs.
- [x] 5.4 Confirm the change's delta specs match the shipped behavior (`openspec validate "secure-kroger-auth-init"`).

## 6. Verify

- [x] 6.1 `aubr typecheck` and `aubr test` (plus `aubr build:admin --check` if the SPA changed) pass.
- [ ] 6.2 Manually confirm end-to-end: agent calls `kroger_login_url` → click link → Kroger consent → callback stores token under the caller's tenant; and that there is no longer any path to bind a token via an unauthenticated tenant claim.
