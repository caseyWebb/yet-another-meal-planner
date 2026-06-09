## Why

Changes 04–06b deployed the full grocery-mcp Worker behind a Cloudflare Access gate and verified every tool live — but only from **Claude Code** (CLI), which authenticates with its own cached OAuth token. The system has never been exercised from **Claude.ai web / phone**, which connects with a *different* OAuth client (its own dynamic client registration and redirect URI) against the same Access authorization server. Until a real Claude.ai connection completes an authorized read *and* write end-to-end, the architecture is unproven from the surface it was actually built for. This change is that proof. It also closes the write-tools change's explicitly deferred task 8.2 (authenticated `commit_changes` end-to-end, which MCP Inspector can't drive).

## What Changes

- **Connect the deployed Worker to Claude.ai as a custom connector** (URL only; authorization via Cloudflare Access Managed OAuth). Add the GitHub MCP connector. Create the "Grocery Agent" project with `CLAUDE.md` as project instructions. These are Claude.ai account-config steps, not repo artifacts.
- **Smoke-verify from the phone in two halves.** READ flows ("what's in my pantry?", "show me chicken recipes") prove the connector + Access OAuth accept Claude.ai's OAuth client. The WRITE flow ("I ran out of olive oil" → `update_pantry`; "rate the salmon thing 4 stars" → `update_recipe`) proves the full **authorized** write loop and lands a real git commit through Access. A read-only pass does **not** close this change — the write proof is required (this is deferred task 8.2).
- **Decide the Managed-OAuth fallback in advance.** Cloudflare Access Managed OAuth is open beta. If Access rejects Claude.ai's DCR / redirect-URI / token flow and the connector won't authorize, the fallback is to serve OAuth from the Worker itself via `workers-oauth-provider`. This change documents the trigger condition and approach as a pre-made decision; it does **not** implement the fallback.
- **A slot for fixes the live test surfaces.** Claude.ai surfaces and reasons over tools differently than Claude Code did; any `CLAUDE.md` or `docs/TOOLS.md` / tool-description adjustments discovered during testing land here. This is the only category that produces repo artifacts.

## Capabilities

### New Capabilities
- `claude-ai-connector`: the contract that the deployed MCP endpoint is connectable as a Claude.ai custom connector — a real external client completing Access Managed OAuth (via its own dynamic client registration), reaching the tool list, performing authorized reads, and performing an authorized write that commits to the repo end-to-end. Includes the open-beta Managed-OAuth fallback to `workers-oauth-provider` as a conditional requirement.

### Modified Capabilities
<!-- None. The Access-gate behaviors (gating, only-owner authorization, /oauth carve-out) already exist in the mcp-server spec; this change layers the client-facing connection contract on top without changing those requirements. -->

## Impact

- **Claude.ai account config (not repo):** a custom MCP connector pointed at `https://groceries-mcp.caseywebb.xyz/mcp`; the GitHub MCP connector; a "Grocery Agent" project with `CLAUDE.md` pasted as instructions.
- **Cloudflare Access:** the only-owner identity policy must permit a fresh phone login (whatever IdP the policy uses — Google / GitHub / email OTP); Claude Code reused a desktop browser session, the phone has none. Confirm no path collision between the Kroger `/oauth/*` Access bypass and Access's own Managed-OAuth endpoints.
- **Worker (`worker/`):** no code changes expected on the happy path. Only touched if the Managed-OAuth fallback fires (`workers-oauth-provider`) or a tool-description fix is needed.
- **Docs:** `CLAUDE.md` and/or `docs/TOOLS.md` only if the live test surfaces a fix.
- **Closes:** deferred task 8.2 from the archived `git-write-tools` change (authenticated `commit_changes` end-to-end).
- **Dependencies:** Changes 04, 05, 06, 06b — all archived.
