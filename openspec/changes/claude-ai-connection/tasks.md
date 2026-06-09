## 1. Pre-flight (Cloudflare)

- [x] 1.1 Confirm the only-owner Access policy's identity provider (Google / GitHub / email OTP) is usable from a phone with no cached desktop session — **verified: logged in from phone, connector authorized**
- [x] 1.2 Confirm no path collision between the Kroger `/oauth/*` Access Bypass and Access's own Managed-OAuth endpoints (e.g. `/cdn-cgi/access/*`, `/.well-known/oauth-authorization-server`). **Verified (code side):** Worker owns only `/`, `/oauth/init`, `/oauth/callback` (prefix `/oauth/` with trailing slash, index.ts:48) and `/mcp`; Access uses `/cdn-cgi/access/*` (access.ts:28) and `/.well-known/oauth-*` — disjoint namespaces. **Dashboard caveat:** ensure the Access Bypass policy is scoped to `/oauth` and does not also bypass `/.well-known/*` (Access must serve those for Claude.ai's OAuth discovery).

- [x] 1.3 In the Access app's **Advanced settings → Allowed redirect URIs**, add `https://claude.ai/api/mcp/auth_callback` (or `https://claude.ai/api/mcp/*`). Required even with DCR: the authorize endpoint validates the redirect URI against this app-level allowlist, and without it the flow is rejected pre-login with `invalid_request: Redirect URI not allowed by application configuration`. **Diagnosed live** (2026-06-09); documented in `worker/README.md`.

## 2. Connect Claude.ai

- [x] 2.1 Add a custom MCP connector in Claude.ai pointed at `https://groceries-mcp.caseywebb.xyz/mcp`
- [x] 2.2 Complete the Cloudflare Access Managed-OAuth authorization prompt; confirm the connector reaches a connected state and the grocery-mcp tools enumerate
- [ ] 2.3 Add the GitHub MCP connector
- [ ] 2.4 Create the "Grocery Agent" project and paste `CLAUDE.md` into project instructions

## 3. Smoke-verify from the phone — reads

- [ ] 3.1 In a fresh Grocery Agent conversation, ask "what's in my pantry?" and confirm real pantry contents return
- [ ] 3.2 Ask "show me chicken recipes" and confirm matching recipes return

## 4. Smoke-verify from the phone — writes (closes task 8.2)

- [ ] 4.1 Say "I ran out of olive oil"; confirm `update_pantry` + `commit_changes` succeed through Access and a real commit appears in the repo
- [ ] 4.2 Say "rate the salmon thing 4 stars"; confirm `update_recipe` commits the rating change
- [ ] 4.3 Verify both commits in the repo history (the authorized write loop is proven; task 8.2 closed)

## 5. Managed-OAuth fallback (only if 2.2 fails because Access rejects Claude.ai's OAuth client)

- [ ] 5.1 Confirm the failure is specifically Access Managed OAuth rejecting Claude.ai's DCR / redirect URI / token (not an IdP login or post-connect tool error)
- [ ] 5.2 Switch the Worker to serve OAuth via `workers-oauth-provider`, preserving only-owner authorization
- [ ] 5.3 Re-run tasks 2.1–2.4 and section 3–4 against the Worker-served OAuth endpoints

## 6. Capture fixes and close out

- [ ] 6.1 Record any `CLAUDE.md` / `docs/TOOLS.md` / tool-description fixes surfaced by the live test and commit them
- [ ] 6.2 Confirm done-when: a useful phone conversation in the Grocery Agent project including at least one successful authorized write that landed a real commit
