## Why

The marketplace plugin bakes the operator's connector URL into `.mcp.json`, and claude.ai can't override it at install time (no `userConfig` support — verified 2026-06-11). So a self-hoster today must either **fork** the code repo to publish their own marketplace, or install the operator's plugin and **hand-wire their own connector** beside the disabled bundled one — an awkward, error-prone path. There's a missing middle: let CI build the self-hoster their *own* baked bundle, which they download and upload to claude.ai — no fork, no public marketplace. As a bonus, the upload path's lack of auto-sync is a **safety property**: it stops a self-hoster's skills from advancing ahead of a Worker they haven't redeployed — skills call MCP tools by name, so the two are one contract split across two artifacts.

## What Changes

- **New reusable `data-build-plugin.yml` workflow** (`on: workflow_call`) in the public code repo, plus a thin `build-plugin.yml` caller in the operator's private data repo. It runs `scripts/build-plugin.mjs --mcp-url <operator URL>`, zips the bundle in claude.ai's accepted upload layout (contents at archive root), and publishes it as a downloadable artifact. No secrets (build-only); runs in the caller's context, billed to the operator — same posture as `data-deploy` / `data-onboard`.
- **New self-hoster distribution path (no fork):** build → download → upload the bundle to claude.ai. The bundled connector carries the self-hoster's *own* Worker URL; their friends can install the same file with no GitHub account.
- **GATING SPIKE (task 1, abandon-on-RED):** verify that an *uploaded* (non-marketplace) bundle registers its `.mcp.json` connector and triggers the OAuth `/authorize` flow. The 2026-06-11 probe verified skills-load-from-upload but never included or tested a connector. A RED result kills this change (uploaded bundles would deliver skills only, no better than pasting the instructions).
- **Update-workflow contract — Worker first, then plugin.** Self-hoster updates redeploy the Worker (from `@main` / their pinned ref) *before* rebuilding and redistributing the plugin, so skills never reference tools not yet deployed.
- **Retire the "ride the upstream marketplace for skills, disable its connector" self-hoster option (A.2)** from `SELF_HOSTING.md` — it auto-advances a self-hoster's skills from upstream, independent of their own deploys (the exact skew the coupling rule forbids). The CI-bundle path supersedes it.

This change does **not** alter the operator's published marketplace bundle: it stays hardcoded to their Worker and keeps pull-based updates for their own group.

## Capabilities

### New Capabilities
<!-- none — this extends existing capabilities -->

### Modified Capabilities
- `agent-plugin-distribution`: add a fork-free, operator-baked, upload-installed distribution path for self-hosters; add the Worker-before-plugin update-ordering contract; retire the upstream-marketplace-for-skills option.
- `build-automation`: add a reusable, secret-free `data-build-plugin` workflow that builds an operator-baked plugin bundle as a downloadable artifact, callable from a data repo.

## Impact

- **Code repo:** new `.github/workflows/data-build-plugin.yml` (reusable). The committed marketplace bundle (`plugin/grocery-agent/`) and `marketplace.json` are untouched — the operator's published plugin stays hardcoded to their Worker.
- **Data-template (submodule):** new thin `build-plugin.yml` caller + README update; bumped separately as a vendored submodule.
- **Docs:** `docs/SELF_HOSTING.md` (new path, Worker-first update ordering, cut A.2) and `docs/PROJECT.md` (distribution-paths note).
- **Build tooling:** none — reuses `scripts/build-plugin.mjs --mcp-url` unchanged; output goes to a `dist/` artifact, never the committed bundle (existing placeholder guard still applies).
- **Risk:** the whole change is gated on the connector-on-upload spike. RED ⇒ abandon before any workflow code lands.
