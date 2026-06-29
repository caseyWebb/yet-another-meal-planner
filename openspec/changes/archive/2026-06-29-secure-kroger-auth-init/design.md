## Context

Kroger account linking is a one-time, browser-driven OAuth `authorization_code` + PKCE flow under `/oauth/*` (`src/oauth.ts`). That route group is served by the open `defaultHandler` (`src/index.ts:67`) — only `/mcp` is bearer-gated by the `OAuthProvider` (`apiRoute: "/mcp"`). Today `/oauth/init` reads the initiating tenant straight from `?tenant` (`src/oauth.ts:91`) and the callback stores the resulting Kroger refresh token under `kroger:refresh:<tenant>`. Because nothing proves the caller owns that tenant, anyone can run the flow *for* a victim with their own Kroger account and capture the victim's cart writes (GitHub #45). PKCE + `state` only protect flow integrity (CSRF/replay), not initiator identity.

The authenticated identity we *do* have is the MCP grant: `/mcp` requests carry `props.tenantId` derived from the invite-code `/authorize` flow (`src/index.ts:37`). The operator additionally has the Cloudflare-Access-gated `/admin` surface (`operator-admin` spec). Kroger linking always happens *after* a member is connected (or, for the operator, while Access-authenticated), so there is no chicken-and-egg: the proof exists before the Kroger step.

## Goals / Non-Goals

**Goals:**
- The initiating tenant of a Kroger flow is established from an authenticated context, never from unauthenticated request input.
- Preserve the browser-driven Kroger consent UX (click a link → Kroger consent → done).
- Keep `/oauth/callback` and the stored-token model (`kroger:refresh:<tenant>`, rotation) unchanged.
- Cover operator bootstrap (no `/mcp` session yet) via the Access-gated admin surface.
- Keep contract docs, persona, and specs in lockstep (repo no-drift rule).

**Non-Goals:**
- The connector setup flow (plugin → "Authenticate" → `/authorize` invite code → grant `tenantId`). Untouched.
- Changing Kroger scopes, the refresh-token rotation, or the read-side `client_credentials` client.
- Migrating existing stored refresh tokens (they keep working; only the entry path changes).

## Decisions

### Decision: Carry an authenticated nonce through the browser hop, rather than gate `/oauth/init`

Two tokens, two jobs, two birthplaces:

| token | proves | minted at |
|-------|--------|-----------|
| `state` (exists) | this callback matches an init **we** started (CSRF/replay) | `/oauth/init` — correct |
| `nonce` (new) | an **authenticated** session for tenant X authorized this linking | where auth exists: the MCP grant, or Access-gated `/admin` |

A `kroger_login_url` MCP tool (zero params) reads `tenantId` from the resolved grant, mints `kroger:authnonce:<nonce> → { tenant, exp }` in KV, and returns `https://<origin>/oauth/init?nonce=<nonce>`. `/oauth/init` redeems the nonce → tenant, **deletes it** (single-use, consumed at our endpoint before the browser ever reaches Kroger), then proceeds exactly as today (PKCE verifier + `state`, store `{ verifier, tenant }` under the state key, 302 to Kroger). The `?tenant` path is removed entirely.

**Alternatives considered:**
- *Bearer-gate `/oauth/init`.* Rejected: `/init` is a plain browser GET and the Kroger→`/callback` hop is a browser redirect — neither can carry the connector bearer. The proof must be minted *before* the browser hop and carried in.
- *Mint the nonce at `/oauth/init` itself.* Rejected: `/init` has no trusted identity, so a nonce minted there could only bind to the same untrusted input — it would just rename `?tenant=`.
- *Callback refuses to overwrite an existing `kroger:refresh:<t>`.* Rejected as the fix (kept implicitly subsumed): it's TOCTOU-vulnerable on first auth and breaks legitimate re-auth. With the nonce, every init is authenticated, so overwrite is safe and re-auth "just works."

### Decision: Redeem (consume) the nonce at `/oauth/init`, not at `/oauth/callback`

The tenant rides the existing `state` record through the callback (as today), so the nonce's life ends at the click. This keeps the leaked-nonce window to a single redemption and keeps the callback path untouched. Kroger never sees the nonce.

### Decision: Operator bootstrap reuses the same nonce from `/admin`

The first operator may link Kroger before any `/mcp` session exists. The Access-gated `/admin` surface (already cross-tenant, `operator-admin` spec) mints the *same* nonce bound to a chosen allowlisted tenant and returns the `/oauth/init?nonce=…` link — one nonce mechanism, two authenticated front doors. Not exposed as an MCP tool.

### Decision: Nonce shape and storage

Random high-entropy value (reuse the `base64url(getRandomValues)` helpers in `oauth.ts`), stored in the existing Kroger KV namespace under `kroger:authnonce:<nonce>` with a short `expirationTtl` (~600s, matching `PKCE_TTL_SECONDS`). Value carries `{ tenant }`. Single-use via `delete` on redemption. Never logged.

## Risks / Trade-offs

- **Leaked nonce before redemption** → single-use + short TTL bound the window to one click within ~10 min; the nonce is returned only to the authenticated caller and never logged.
- **Old `/oauth/init?tenant=…` links break (BREAKING)** → intended; the hole closes only by removing the param. Docs/persona updated the same pass so the agent hands out the new link, and `reauth_required` guidance points at the tool, not the old URL.
- **Operator confusion during bootstrap** → the `/admin` mint action + updated `SELF_HOSTING.md` give the operator a first-run path that needs no `/mcp` session.
- **Two mint sites drifting** → both call one shared nonce-mint/redeem helper (not two implementations), so the tool and the admin action stay identical.

## Migration Plan

1. Ship the nonce mint/redeem helper + `kroger_login_url` tool + `/oauth/init` nonce redemption (remove `?tenant`).
2. Add the `/admin` mint action (Worker endpoint + Elm SPA control).
3. Update `docs/TOOLS.md`, `AGENT_INSTRUCTIONS.md`, `docs/SELF_HOSTING.md`, and the two specs in the same change.
4. No data migration: existing `kroger:refresh:<tenant>` entries are untouched; only the re-/initial-auth entry path changes. Rollback is reverting the change — stored tokens remain valid throughout.
