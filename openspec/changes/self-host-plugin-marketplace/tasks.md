## 1. Code repo — plugin builder (`scripts/build-plugin.mjs`)

- [x] 1.1 Switch `resolveVersion()` to compute `0.1.<count>` from the **data repo's** commit count at the workflow root (not the `_code/` code checkout); thread it so the deploy's build stamps it — done via a new `--version` flag the deploy passes; `resolveVersion()` remains the local fallback
- [x] 1.2 Remove `publishedVersion()` and `floorVersion()` and their use in `main()` (no committed code-repo bundle to floor against)
- [x] 1.3 Remove the committed-bundle placeholder/non-URL guard (`writingCommittedBundle` + the "REFUSING to write" path) and the `committedBundle` plumbing; keep `isHttpUrl`/the placeholder warning for throwaway builds
- [x] 1.4 Update the file's header comment and `package.json` `build:plugin*` scripts so they no longer target a committed `plugin/grocery-agent` in the code repo

## 2. Code repo — workflows

- [x] 2.1 In `.github/workflows/data-deploy.yml`, add a post-deploy "Build & publish plugin" step: build the bundle with the operator's `--mcp-url` and version (1.1), then commit `.claude-plugin/marketplace.json` + `plugin/grocery-agent/` to the data repo (reuse the existing `contents: write`; mirror the pin step's graceful "couldn't push" warning). Also set `fetch-depth: 0` on the data-repo checkout so the version count is real
- [x] 2.2 Pass the operator's connector URL into the deploy build (derive from `worker_host`/`WORKER_HOST`, consistent with how the badge step receives the host)
- [x] 2.3 Delete `.github/workflows/data-build-plugin.yml`
- [x] 2.4 Expand `ci.yml`'s `trigger-deploy` path filter to include `AGENT_INSTRUCTIONS.md` and `scripts/build-plugin.mjs`; replace the committed-bundle drift check with a `--check` build

## 3. Code repo — remove the committed bundle

- [x] 3.1 `git rm -r plugin/` and `.claude-plugin/marketplace.json` from the code repo
- [x] 3.2 Ensure `.wrangler/` is in the code repo `.gitignore` (already present)
- [x] 3.3 Confirm the root dev `.mcp.json` (Inspector connector) is retained and nothing in `src/` references the removed `plugin/` path

## 4. Code repo — tests

- [x] 4.1 Update `tests/build-plugin.test.mjs`: drop `floorVersion`/`publishedVersion`/placeholder-guard cases; reword the `isHttpUrl`/`resolveVersion` cases for the new model
- [x] 4.2 Run `aubr test:tooling` (65 pass), `aubr typecheck` (clean), and a `--version` smoke build — all green

## 5. Code repo — docs (one-path story)

- [x] 5.1 Rewrite `docs/SELF_HOSTING.md` step 7 + "Onboard a friend" to the single marketplace path; demote upload/paste to fallbacks; fold the Worker-first ordering into the deploy; update the mental model + step 1/4/5
- [x] 5.2 Update `README.md`, `CONTRIBUTING.md`, `CLAUDE.md` (and `docs/ARCHITECTURE.md`) references to the code-repo committed `plugin/`, the marketplace location, the build workflow, and the data-repo visibility
- [x] 5.3 Document the public-data-repo marketplace + the no-secrets rationale + the pre-public security gate

## 6. Template repo (`caseyWebb/groceries-agent-data-template`, branch `claude/self-hosted-plugin-story-da8ldw`)

- [x] 6.1 Add `.wrangler/` to `.gitignore`
- [x] 6.2 Add `.claude-plugin/marketplace.json` (→ `./plugin/grocery-agent`); README documents that `plugin/` materializes on first deploy
- [x] 6.3 Remove `.github/workflows/build-plugin.yml`
- [x] 6.4 Update the template `README.md` (public-by-default, no-secrets rationale, marketplace-add onboarding) and make `deploy.yml` pass `worker_host: ${{ vars.WORKER_HOST }}` so the deploy can publish

## 7. Live data repo (`caseyWebb/groceries-agent-data`, branch `claude/self-hosted-plugin-story-da8ldw`) — security gate

- [x] 7.1 `git rm` `.wrangler/cache/wrangler-account.json`, add `.wrangler/` to `.gitignore`, and add `.claude-plugin/marketplace.json`
- [ ] 7.2 **(OPERATOR)** History scan done — findings: (a) `.wrangler/cache/wrangler-account.json` is in history since `ca01f9c` (CF account id + proton email); (b) the retired `onboard.yml` took `invite_code` as a workflow input, so codes may sit in old **Actions run logs** (not git). Remaining: purge `.wrangler/` from history (file-only filter-repo, preserves commit count) **and** rotate any such invites via `/admin`. Destructive/force-push + admin action — operator's call
- [ ] 7.3 **(OPERATOR)** Set `ACCESS_ALLOWED_EMAILS` (Worker var) to the operator email(s) — your call on which identities
- [x] 7.4 Confirmed `wrangler.jsonc` carries only non-secret identifiers (KV/D1 ids, `ACCESS_AUD`, team domain); recorded as a conscious accept in design.md + SELF_HOSTING

## 8. Cutover & verification — **(OPERATOR)**

- [ ] 8.1 Merge the code-repo branch so the updated `data-deploy.yml` is live, then run the data repo's **Deploy** to produce the first published marketplace bundle (Worker-first; bundle committed)
- [ ] 8.2 Verify the data repo now has `.claude-plugin/marketplace.json` + `plugin/grocery-agent/` with the operator's URL in `.mcp.json` and a version `> 0.1.126` (or confirm a re-add is a fresh install — Risk #1; `git rev-list --count HEAD` on the data repo is already ≫ 126)
- [ ] 8.3 Flip `caseyWebb/groceries-agent-data` to **Public** (only after 7.2/7.3)
- [ ] 8.4 In claude.ai, `/plugin marketplace add caseyWebb/groceries-agent-data`, install, complete the invite-code flow, confirm tools + skills load; confirm a re-publish auto-updates
- [ ] 8.5 Notify friends to re-add the new marketplace

## 9. OpenSpec validation & PR

- [x] 9.1 `openspec validate "self-host-plugin-marketplace" --strict` passes
- [ ] 9.2 **(ON REQUEST)** Open the PR(s) using the template; check every consideration box; ensure `plugin/` removal + docs lockstep are reflected
