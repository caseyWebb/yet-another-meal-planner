## Context

The grocery-agent plugin bundles **skills + the `grocery-mcp` connector**; the connector URL is baked into `.mcp.json` at build time via `scripts/build-plugin.mjs --mcp-url` because claude.ai does not honor a plugin `userConfig` variable (the full `userConfig.worker_url` + `${user_config.worker_url}` mechanism was built and live-tested 2026-06-11 — no prompt appeared, the token reached the connector literally). The operator publishes a marketplace (`caseyWebb/groceries-agent`) carrying their baked URL; their group installs and pull-updates from it.

A self-hoster can't use that published bundle — it points at the operator's Worker, which isn't open for signups. Their current options are both unsatisfying: **fork** the code repo to publish their own marketplace (fork upkeep + a GitHub account), or **install the operator's plugin for the skills, disable its connector, and add their own** (the "A.2" path — fiddly, and it auto-advances their skills from an upstream they don't control).

claude.ai also supports **uploading a custom plugin file** ("built one yourself or received from a colleague"). A 2026-06-10 probe verified skills load from an uploaded zip, but that probe was skills-only — it never included or tested a bundled `.mcp.json` connector. The established way operators run anything is the **reusable-workflow pattern** (`data-deploy` / `data-onboard` / `data-revoke` / `data-build-*`): thin callers in the private data repo invoke `workflow_call` workflows upstream, web-UI driven, no local tooling, no cross-repo secret.

## Goals / Non-Goals

**Goals:**
- A **no-fork** way for a self-hoster to get a baked, single-file plugin whose connector is *their* Worker.
- Keep it **web-UI driven** — preserve the SELF_HOSTING promise that the only local command is one `openssl` line.
- Encode a **Worker-first update ordering** so a self-hoster's skills never outrun the tools their Worker serves.
- Leave the operator's **marketplace deployment untouched** (still hardcoded to their Worker, still pull-updating for their group).

**Non-Goals:**
- Pull-based auto-update for self-hosters — that remains the fork + own-marketplace path.
- Any change to `scripts/build-plugin.mjs` or the committed `plugin/grocery-agent/` bundle.
- Serving a marketplace from a *private* data repo (private repos can't be added as a marketplace by accountless friends).

## Decisions

1. **Reusable `data-build-plugin.yml` + thin caller** (vs. a local build or committing the bundle). Web-only, no local tooling, no write token, ephemeral output. *Alternatives:* local `npm run build:plugin` breaks the no-local-tooling promise; committing the built bundle into the data repo bloats it with generated files and needs a write token.

2. **Output as a GitHub Actions artifact by default**, optionally a release asset for a durable link. Artifacts need no extra permissions; releases give stable URLs but need `contents:write` and are still private. Either way the operator downloads the file and **forwards it to friends** — accountless friends can't access the private repo, so a stable URL doesn't help them.

3. **Build from upstream `code_ref` (default `main`), not from a fork.** Keeps the emitted version `0.1.<commit-count>` monotonic so re-uploads clear claude.ai's per-name **version high-water-mark**; avoids fork drift.

4. **Zip layout = contents at the archive root** (`.claude-plugin/`, `.mcp.json`, `skills/`) — the confirmed-accepted upload format. Emit both `.zip` and `.plugin` until the accepted extension is pinned by the spike.

5. **Worker-first update ordering as a documented + speced contract.** Skills name MCP tools; deploying the Worker first makes new tools available before skills that reference them ship. The reverse — or upstream auto-sync — opens a "tool not found" window.

6. **Retire A.2.** It is the only option where a self-hoster's skills auto-advance from a source they don't control, decoupled from their deploys — the exact failure mode decision 5 forbids. The CI-bundle path supersedes it.

## Risks / Trade-offs

- **Uploaded bundle may not register its bundled connector** (claude.ai could, on principle, refuse to auto-wire a network connector from an arbitrary uploaded file) → **SPIKE first (task 1); RED ⇒ abandon the change.** This is the single gate; nothing else is built until it's GREEN.
- **Accepted upload extension ambiguous (`.zip` vs `.plugin`)** → emit both during the spike; pin whichever installs.
- **Re-upload blocked by the version high-water-mark** → build from upstream so the commit-count climbs; the spike also checks whether the upload path even applies the high-water-mark or just replaces the file.
- **Artifact retention / login-to-download** → offer a release asset for durability; the friend handoff is file-forwarding regardless.
- **Name collision** if a self-hoster is *also* a member of the operator's group (both named `grocery-agent`) → edge case; add a rename build flag only if it actually bites.

## Migration Plan

Additive and reversible by omission. The spike runs first; the workflow, caller, and docs land **only if it is GREEN**. A RED spike abandons the change with nothing shipped. The operator's existing marketplace path is unaffected at every step.

## Open Questions

- Does the upload path apply the version high-water-mark, or just replace the file on re-upload? (Resolve during/after the spike.)
- Default deliverable: artifact (simplest) vs. release asset (durable link)? Leaning artifact, with release as an opt-in.
