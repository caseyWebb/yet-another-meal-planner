## Why

`/oauth/init` establishes the Kroger account-linking tenant from an **unauthenticated** `?tenant` query param (`src/oauth.ts:91`), on a route served by the open `defaultHandler` (`src/index.ts:67` — only `/mcp` is bearer-gated). Anyone who knows the Worker host and a member's username can run `/oauth/init?tenant=<victim>`, complete Kroger consent with their **own** Kroger account, and the callback stores the attacker's refresh token under `kroger:refresh:<victim>` — so the victim's `place_order` cart writes land in the attacker's Kroger cart (GitHub issue #45, High). PKCE + `state` only prove the callback matches an init *we* started; they prove nothing about *who* started it. The `TRANSITIONAL` comment at `src/oauth.ts:84-86` already promised the fix — an agent-minted single-use nonce — that was never built.

## What Changes

- **New MCP tool `kroger_login_url`** (zero params): callable only on the authenticated `/mcp` surface. Reads `tenantId` from the grant props (`src/index.ts:37`), **never** from input. Mints a single-use, short-TTL nonce in KV (`kroger:authnonce:<nonce>` → `{ tenant, exp }`) and returns the link `https://<worker-host>/oauth/init?nonce=<nonce>` for the user to click.
- **`/oauth/init` takes `?nonce`, not `?tenant`** — **BREAKING** for the link format. It redeems the nonce → tenant in KV, deletes it (single-use, redeemed at our endpoint before the browser ever reaches Kroger), then proceeds exactly as today (PKCE verifier + `state`, store `{ verifier, tenant }` under the state key, 302 to Kroger). A missing/expired/unknown nonce returns 400. The `?tenant` path is **removed entirely** — no fallback, so the hole is fully closed.
- **`/oauth/callback` is unchanged** — it already binds the refresh token via the stored `state` record; the tenant now traces back to an authenticated mint.
- **Operator bootstrap via Access-gated `/admin`**: at first-time setup the operator may have no `/mcp` session yet, so an `/admin` action (already behind Cloudflare Access — `docs/SELF_HOSTING.md:128`) mints the same nonce/link for the operator, and lets the operator generate one for any member.
- **Docs + persona ripple (same pass)**: `docs/TOOLS.md` (new tool contract + `reauth_required` guidance at line 830), `AGENT_INSTRUCTIONS.md:371` (re-auth instruction), `docs/SELF_HOSTING.md:146,177` (operator + member consent steps).

## Capabilities

### New Capabilities
<!-- none — this strengthens existing auth + admin capabilities rather than introducing a new one -->

### Modified Capabilities
- `kroger-user-auth`: the initiating tenant SHALL be established from an authenticated context (an MCP-grant-minted single-use nonce, or the Access-gated admin surface), never from unauthenticated request input; adds the `kroger_login_url` tool and the nonce-redemption requirement at `/oauth/init`; a forged/unauthenticated-tenant init is rejected.
- `operator-admin`: the Access-gated admin surface SHALL be able to mint a Kroger consent link (nonce) for the operator or any member, covering the bootstrap case where no `/mcp` session exists yet.

## Impact

- **Code**: `src/oauth.ts` (init redeems nonce; remove `?tenant`), a new tool in `src/tools.ts` (or the relevant tool module) backed by `src/kroger-user.ts` / KV, `src/admin.ts` (+ `admin/` Elm SPA) for the operator link action.
- **Routes/contract**: `/oauth/init` query contract changes (`?tenant` → `?nonce`); new authenticated tool surface.
- **Docs/specs**: `docs/TOOLS.md`, `docs/SELF_HOSTING.md`, `AGENT_INSTRUCTIONS.md`, `openspec/specs/kroger-user-auth/spec.md`, `openspec/specs/operator-admin/spec.md`.
- **Migration**: no data migration — existing stored refresh tokens (`kroger:refresh:<tenant>`) keep working; only the *re-/initial-auth entry path* changes. Old `/oauth/init?tenant=…` links stop working by design.
- **Out of scope**: the connector setup flow (plugin → "Authenticate" → `/authorize` invite code → grant `tenantId`) is a separate, earlier authentication and is untouched.
