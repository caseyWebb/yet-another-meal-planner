## Context

The grocery-mcp Worker is deployed at `https://groceries-mcp.caseywebb.xyz/mcp`, behind a Cloudflare Access gate configured with Managed OAuth (Access is the OAuth authorization server; the Worker holds no MCP-facing OAuth code). Every tool has been verified live — but exclusively from **Claude Code** (CLI). Claude Code's `.mcp.json` points at the endpoint over HTTP with no auth header; it reached the gated endpoint by completing an Access Managed-OAuth flow once and caching the token in its local credential store.

The untested surface is **Claude.ai web / phone**. Claude.ai connects as an MCP client with its *own* OAuth client: its own dynamic client registration (DCR), its own redirect URI (a `claude.ai` callback), and server-side token storage at Anthropic. Both clients hit the same Access authorization server, but with different client identities. Claude Code passing proves the Access app *can* do Managed OAuth; it does not prove Access accepts Claude.ai's DCR-registered client. This change exercises that path and closes deferred task 8.2 (authenticated `commit_changes` end-to-end), which MCP Inspector could not drive.

## Goals / Non-Goals

**Goals:**
- Connect the deployed Worker to Claude.ai as a custom connector and reach a connected, tool-enumerated state from the phone.
- Verify an authorized **read** and an authorized **write** (a real git commit through Access) from a Claude.ai conversation — the write is the load-bearing proof (task 8.2).
- Have the Managed-OAuth fallback (`workers-oauth-provider`) pre-decided with a clear trigger, so a beta failure is a known branch, not an ad-hoc scramble.
- Capture any `CLAUDE.md` / `docs/TOOLS.md` / tool-description fixes the live test reveals.

**Non-Goals:**
- Implementing the `workers-oauth-provider` fallback now (only documenting its trigger and approach).
- Any new tool or Worker feature on the happy path — this is verification, not a build.
- Menu generation, sequencing, discovery, or other later-change behavior.
- Re-architecting the Access gate or the Kroger `/oauth/*` flow.

## Decisions

### Verify reads AND writes, not reads alone
A read-only smoke test would feel like success while leaving 8.2 open. Reads on public-ish data prove only that the connector authorized and tool calls route. The authorized **write** is what proves the full loop: Claude.ai → Access OAuth → Worker → GitHub commit. The change is not "done" until a pantry update or rating lands a real commit. *Alternative considered:* declare success on connection + reads — rejected because it doesn't exercise the GitHub-write leg behind the gate, which is the whole point of 8.2.

### Pre-decide the Managed-OAuth fallback rather than discover it live
Access Managed OAuth is open beta. The dependency that can fail is narrow and specific: Access must accept Claude.ai's DCR registration, redirect URI, and token issuance. If it doesn't, the connector simply won't authorize. Rather than debug Cloudflare from a phone, the fallback is decided now: move OAuth into the Worker via `workers-oauth-provider` (OAuth endpoints served by the Worker, only-owner authorization preserved). *Alternative considered:* custom OAuth code hand-rolled in the Worker — rejected; `workers-oauth-provider` is the supported path and was already named as the contingency in the roadmap and Change 06 design note.

### Trigger condition for the fallback
Fire the fallback only when the connector **cannot reach a connected state** specifically because Access rejects Claude.ai's OAuth client (DCR / redirect URI / token rejection observable in the Access logs or the connector error). Do **not** fire it for unrelated failures — an identity-provider/login problem, a tool error after a successful connection, or a transient network failure are different branches and must not be misattributed to Managed OAuth.

### Keep the change lean and config-first
The bulk of the work lives in Claude.ai account settings and the Cloudflare dashboard, not the repo. Only the fallback (if triggered) and tool-description fixes touch code/docs. The spec captures the externally-observable connection contract so the milestone is testable; tasks capture the click-path and the verification script.

## Risks / Trade-offs

- **Managed OAuth ↔ Claude.ai DCR mismatch (open beta)** → Pre-decided fallback to `workers-oauth-provider`; trigger condition scoped narrowly so it isn't confused with other failures.
- **Phone can't pass the Access login** (the only-owner policy's IdP — Google / GitHub / email OTP — must be usable on a fresh mobile session with no cached desktop login) → Confirm the configured IdP works from the phone before blaming the connector; this is an Access-config branch, not an OAuth-protocol branch.
- **`/oauth/*` path collision** — the Kroger callback owns an Access Bypass on `/oauth/*`; Access Managed OAuth uses its own endpoints (typically under `/cdn-cgi/access/*`) → Confirm no overlap at verify time; a collision would break Kroger auth or Access auth in non-obvious ways.
- **Claude.ai surfaces tools differently than Claude Code** → Expect to discover tool-description or `CLAUDE.md` wording fixes; that discovery is an intended output, not a failure. Capture and commit them.
- **Verification mutates real repo data** (a pantry write, a recipe rating) → Acceptable and intended; the olive-oil/rating edits are real and harmless, and exercising the write is the point.

## Migration Plan

1. In Cloudflare, confirm the only-owner Access policy's IdP is usable from a phone; confirm no `/oauth/*` ↔ Managed-OAuth endpoint collision.
2. In Claude.ai, add the custom connector (URL only) and complete the Access OAuth prompt; add the GitHub MCP connector; create the "Grocery Agent" project with `CLAUDE.md` as instructions.
3. From the phone, run the read smoke flows, then the write flows; confirm a real commit lands.
4. If the connector won't authorize due to Managed-OAuth rejecting Claude.ai's client, switch to the `workers-oauth-provider` fallback and re-run step 2–3.
5. Commit any `CLAUDE.md` / `docs/TOOLS.md` fixes surfaced. Rollback for fixes is ordinary git revert; the connection itself has no rollback beyond removing the connector.

## Open Questions

- Which identity provider backs the only-owner Access policy, and is it confirmed usable from the phone? (Resolve before testing.)
- Does Claude.ai's connector require any specific MCP capability/scope that Access Managed OAuth does not advertise? (Unknown until the first connect attempt; informs whether the fallback is needed.)
