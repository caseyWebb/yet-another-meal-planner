## 1. Gating spike — connector-on-upload (GATE RESOLVED: **GREEN**, 2026-06-11)

- [x] 1.1 Build a baked test bundle with the operator's real Worker URL and confirm the layout (`.claude-plugin/`, `.mcp.json`, `skills/` at archive root). *(`dist/grocery-agent-fixed.zip`, baked to `https://groceries-mcp.caseywebb.xyz/mcp`.)*
- [x] 1.2 Upload the bundle to claude.ai — it validates and installs; the bundled `.mcp.json` connector is accepted (Anthropic docs confirm uploaded plugins support bundled MCP). **First two attempts failed "plugin validation failed"** — root cause was NOT `.mcp.json` or the missing version, but **angle brackets `<URL>`/`<pasted text>` in the `import-recipe` SKILL.md description** (claude.ai upload validator rejects `<>`; claude-code#63081). `.plugin` extension uploaded fine.
- [x] 1.3 Confirmed working by Casey ("fixed.plugin works"). *(Connector registration + a live tool call after the invite-code flow can be re-confirmed during task 5.2.)*
- [x] 1.4 Extension: `.plugin` installs (the "only .zip" report #40414 didn't bite). Version high-water-mark on the upload path: not separately measured.
- [x] 1.5 **DECISION GATE → GREEN.** `.mcp.json` is honored on upload; the blocker was a fixable description bug. Proceed to task 2.

### 1b. Prerequisite build fixes (landed 2026-06-11, alongside this spike)

- [x] 1b.1 Fix the bracket bug at source: `import-recipe` description in `AGENT_INSTRUCTIONS.md` no longer uses `<…>`.
- [x] 1b.2 Build guard: `validateParsed` rejects any skill `description` containing `<`/`>` or exceeding 1024 chars (with tests) so an unuploadable bundle can't ship.
- [x] 1b.3 Rebuild the committed marketplace bundle so it picks up the **existing** `0.1.<commit-count>` version scheme (already on `main` via 44ba3a2/7a0e360; `0.1.150` → this rebuild `0.1.156`) — a strictly-greater version is what carries the bracket-fixed `import-recipe` skill to installed members. *(No version-scheme change here — the earlier "versionless regression" was a stale local checkout that lacked those two commits.)*

## 2. Reusable build workflow (code repo)

- [x] 2.1 Add `.github/workflows/data-build-plugin.yml` (`on: workflow_call`): inputs `mcp_url` (required) + `code_ref` (default `main`); checkout the code repo at `code_ref` (`fetch-depth: 0` so `resolveVersion()` sees real commit count), set up Node, run `build-plugin.mjs --mcp-url <mcp_url> --out dist/bundle`. *(No `npm ci` — build-plugin is dependency-free.)*
- [x] 2.2 Publish the bundle via `actions/upload-artifact@v4` with **`include-hidden-files: true`** (else `.claude-plugin/` + `.mcp.json` are dropped) — downloading the artifact yields a `.zip` with contents at root, exactly claude.ai's upload layout. No secrets.
- [x] 2.3 Emit a run summary with the baked connector URL and "download → upload to claude.ai" instructions.

## 3. Thin caller (data-template submodule) — drafted; lands via cross-repo commit + ref bump

- [x] 3.1 Add a `build-plugin.yml` caller (`workflow_dispatch`, `mcp_url` defaulting to `https://${{ vars.WORKER_HOST }}/mcp`; `uses: caseyWebb/groceries-agent/.github/workflows/data-build-plugin.yml@main`). *Drafted at `docs/data-template/.github/workflows/build-plugin.yml`.*
- [x] 3.2 Update the data-template README (new caller row + the upload handoff). *Drafted in the submodule working tree.* **Cross-repo landing pending:** commit 3.1+3.2 in the `groceries-agent-data-template` repo, then `git submodule update --remote && git add docs/data-template` to bump the pinned ref here. (Submodule edits are NOT part of this repo's commit.)

## 4. Docs reshape (SELF_HOSTING + PROJECT)

- [x] 4.1 `docs/SELF_HOSTING.md` step 8: rewritten to **Option 1 (CI bundle, recommended)** / Option 2 (fork+marketplace) / Option 3 (project paste); **A.2 removed**. Added `build-plugin.yml` to the callers table; reconciled the top callout + mental-model row.
- [x] 4.2 `docs/SELF_HOSTING.md` "Onboard a friend": handoff now leads with sending the built `.zip` (Option 1).
- [x] 4.3 `docs/SELF_HOSTING.md` "Taking upstream updates": added the **Worker-first** ordering contract + the skills-and-tools-are-one-contract rationale.
- [x] 4.4 `docs/PROJECT.md` + `CLAUDE.md`: noted the fork-free CI-bundle path and the auto-incrementing version; added `data-build-plugin.yml` to the workflow list.

## 5. Validate + verify

- [x] 5.1 `openspec validate self-host-plugin-build --strict` — valid. Tooling suite 73/73, typecheck clean, drift guard in sync, workflow YAML parses.
- [ ] 5.2 **Post-ship:** run the data-repo `Build plugin` caller end-to-end — artifact builds + downloads; confirm the downloaded `.zip` installs in claude.ai and the connector + skills work (and re-confirm a live tool call after `/authorize`). *(If the GH-wrapped download zip is ever rejected, switch the workflow to a release asset — design decision 2.)*
- [x] 5.3 Operator's marketplace bundle: only the intended version + bracket changes (`plugin.json` +version, `import-recipe` description); `.mcp.json` and `marketplace.json` untouched.
