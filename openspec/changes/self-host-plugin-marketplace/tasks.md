## 1. Code repo — plugin builder (`scripts/build-plugin.mjs`)

- [ ] 1.1 Switch `resolveVersion()` to compute `0.1.<count>` from the **data repo's** commit count at the workflow root (not the `_code/` code checkout); thread it so the deploy's build stamps it
- [ ] 1.2 Remove `publishedVersion()` and `floorVersion()` and their use in `main()` (no committed code-repo bundle to floor against)
- [ ] 1.3 Remove the committed-bundle placeholder/non-URL guard (`writingCommittedBundle` + the "REFUSING to write" path) and the `committedBundle` plumbing; keep `isHttpUrl`/the placeholder warning for throwaway builds
- [ ] 1.4 Update the file's header comment and `package.json` `build:plugin*` scripts so they no longer target a committed `plugin/grocery-agent` in the code repo

## 2. Code repo — workflows

- [ ] 2.1 In `.github/workflows/data-deploy.yml`, add a post-deploy "Build & publish plugin" step: build the bundle with the operator's `--mcp-url` and version (1.1), then commit `.claude-plugin/marketplace.json` + `plugin/grocery-agent/` to the data repo (reuse the existing `contents: write`; mirror the pin step's graceful "couldn't push" warning)
- [ ] 2.2 Pass the operator's connector URL into the deploy build (derive from `worker_host`/`WORKER_HOST`, consistent with how the badge step receives the host)
- [ ] 2.3 Delete `.github/workflows/data-build-plugin.yml`
- [ ] 2.4 Expand `ci.yml`'s `trigger-deploy` path filter to include `AGENT_INSTRUCTIONS.md` and `scripts/build-plugin.mjs`

## 3. Code repo — remove the committed bundle

- [ ] 3.1 `git rm -r plugin/` and `.claude-plugin/marketplace.json` from the code repo
- [ ] 3.2 Ensure `.wrangler/` is in the code repo `.gitignore`
- [ ] 3.3 Confirm the root dev `.mcp.json` (Inspector connector) is retained and nothing else references the removed `plugin/` path

## 4. Code repo — tests

- [ ] 4.1 Update `tests/build-plugin.test.mjs`: drop `floorVersion`/`publishedVersion`/placeholder-guard cases; add/adjust version-source and publish-shape coverage
- [ ] 4.2 If the deploy fold-in adds logic to `merge-wrangler-config.mjs` or a helper, cover it; run `aubr test:tooling` and `aubr typecheck` green

## 5. Code repo — docs (one-path story)

- [ ] 5.1 Rewrite `docs/SELF_HOSTING.md` step 7 + "Onboard a friend" to the single path: `/plugin marketplace add <operator>/groceries-agent-data` + invite code; demote upload/paste to fallbacks; remove the three-option framing and the Worker-first prose now enforced structurally
- [ ] 5.2 Update `README.md`, `CONTRIBUTING.md`, and `CLAUDE.md` references to the code-repo committed `plugin/`, the marketplace location, and the build-plugin workflow
- [ ] 5.3 Document the public-data-repo marketplace + the no-secrets rationale; note the pre-public security gate (section 7)

## 6. Template repo (`caseyWebb/groceries-agent-data-template`, branch `claude/self-hosted-plugin-story-da8ldw`)

- [ ] 6.1 Add `.wrangler/` to `.gitignore`
- [ ] 6.2 Add `.claude-plugin/marketplace.json` (→ `./plugin/grocery-agent`); document that `plugin/` materializes on first deploy
- [ ] 6.3 Remove `.github/workflows/build-plugin.yml`
- [ ] 6.4 Update the template `README.md`: create-as-**Public** default, the no-secrets rationale, and the marketplace-add onboarding path

## 7. Live data repo (`caseyWebb/groceries-agent-data`, branch `claude/self-hosted-plugin-story-da8ldw`) — security gate

- [ ] 7.1 `git rm` `.wrangler/cache/wrangler-account.json` and add `.wrangler/` to `.gitignore`
- [ ] 7.2 Scan working tree **and history** for pre-`/admin` invite codes / credentials (e.g. `run_secret_scanning` and/or a `git log -p` sweep of old workflow files); purge from history if found (file-only purge to preserve commit count)
- [ ] 7.3 Set `ACCESS_ALLOWED_EMAILS` (Worker var/secret) to the operator email(s) as defense-in-depth
- [ ] 7.4 Confirm `wrangler.jsonc` (KV/D1 ids, `ACCESS_AUD`, team domain) carries only non-secret identifiers — record the conscious accept

## 8. Cutover & verification

- [ ] 8.1 Merge the code-repo branch so the updated `data-deploy.yml` is live, then run the data repo's **Deploy** to produce the first published marketplace bundle (Worker-first; bundle committed)
- [ ] 8.2 Verify the data repo now has `.claude-plugin/marketplace.json` + `plugin/grocery-agent/` with the operator's URL in `.mcp.json` and a version `> 0.1.126` (or confirm a re-add is a fresh install — Risk #1)
- [ ] 8.3 Flip `caseyWebb/groceries-agent-data` to **Public**
- [ ] 8.4 In claude.ai, `/plugin marketplace add caseyWebb/groceries-agent-data`, install, complete the invite-code flow, and confirm tools + skills load; confirm a re-publish auto-updates
- [ ] 8.5 Notify friends to re-add the new marketplace

## 9. OpenSpec validation

- [ ] 9.1 `openspec validate "self-host-plugin-marketplace" --strict` passes
- [ ] 9.2 Open the PR using the template; check every consideration box; ensure `plugin/` removal + docs lockstep are reflected
