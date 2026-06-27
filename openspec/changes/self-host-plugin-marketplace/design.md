## Context

Today the plugin marketplace lives in the **code** repo (`caseyWebb/groceries-agent`): `.claude-plugin/marketplace.json` → `./plugin/grocery-agent`, with the maintainer's connector URL baked in (`https://groceries-mcp.caseywebb.xyz/mcp`, v0.1.126). Self-hosters can't ride it (wrong URL, not open for signups), so SELF_HOSTING step 7 offers three paths: upload a CI-built `.zip` (`data-build-plugin.yml`), fork the code repo for their own marketplace, or paste `AGENT_INSTRUCTIONS.md`. The data repo — the natural per-operator marketplace host — is private, which is the only thing forcing the fork.

Two facts unlock the simplification: (1) the data repo now carries nothing secret (corpus in R2, member data in D1, invites in the Access-gated `/admin` panel, the lone Actions secret encrypted), so it can be public; (2) claude.ai adds a public git marketplace with **no member authentication** and auto-updates when the plugin's `version` string increases. So the operator's own public data repo can *be* the marketplace.

This change spans three repos. OpenSpec artifacts live here (code repo); implementation touches the code repo, the template (`caseyWebb/groceries-agent-data-template`), and the live data repo (`caseyWebb/groceries-agent-data`) — all on branch `claude/self-hosted-plugin-story-da8ldw`.

## Goals / Non-Goals

**Goals:**
- One install path for everyone: `/plugin marketplace add <operator>/groceries-agent-data` + invite code, with pull-based auto-updates and no fork.
- Make the data repo's marketplace publish a structural tail of the deploy, so skills can never outrun the Worker.
- Remove the code repo's committed, URL-baked bundle and the machinery that guarded it.
- Close the one concrete leak (`.wrangler/cache/wrangler-account.json`) and make `.wrangler/` ignored everywhere, so going public is safe and stays safe.

**Non-Goals:**
- No Worker runtime, MCP tool, or D1 schema changes.
- Not changing the persona content or the skill-generation model (library skills, prerequisite lines) — only *where* the bundle is built and published.
- Not removing `AGENT_INSTRUCTIONS.md` — it stays the build source and a documented last-ditch project-paste fallback.
- Not building a custom marketplace-hosting mechanism — we use claude.ai's native git-marketplace support as-is.

## Decisions

### D1 — The data repo is the marketplace; the code repo stops shipping a bundle
`.claude-plugin/marketplace.json` (→ `./plugin/grocery-agent`) and the generated `plugin/` bundle are committed into the **operator's data repo** by the deploy. The code repo deletes its committed `plugin/` and `.claude-plugin/marketplace.json` and keeps only the builder (`scripts/build-plugin.mjs`) and reusable workflows.
- *Consequence:* the build's "REFUSING to write the placeholder connector URL" guard and the `publishedVersion`/`floorVersion` machinery exist only to protect the *code-repo committed bundle* — with no such bundle they're dead weight and are removed. The builder still validates and still refuses to emit a non-URL into a real publish (the deploy always passes a real `--mcp-url`).
- *Alternative considered:* keep the code-repo bundle as a "reference/demo." Rejected — it bakes the maintainer's URL, isn't installable by anyone else, and is exactly the confusion this change removes.

### D2 — Publish folds into the deploy, after the Worker step
`data-deploy.yml` gains a tail after the existing Deploy step: build the bundle with the operator's URL, then commit `.claude-plugin/marketplace.json` + `plugin/` back to the data repo (reusing the deploy's existing `contents: write`, the same mechanism that pins KV/D1 ids).
- *Why:* the Worker-first-then-skills rule (skills call tools by name) becomes **structural** — the build literally cannot run before the deploy step. Today it's prose discipline in SELF_HOSTING.
- *Alternative considered:* a separate `publish-plugin.yml`. Rejected — ordering reverts to discipline, and two workflows is more surface. The `concurrency: group: deploy` already serializes runs, avoiding commit races.
- *Graceful degradation:* if the caller withholds `contents: write` (the "manual pin" posture), the publish can't push — it warns and leaves the built bundle in the run, mirroring the existing pin/badge steps. The deploy still succeeds.

### D3 — Version = the data repo's own commit count (`0.1.<count>`)
`resolveVersion()` computes `0.1.<git rev-list --count HEAD>` against the **data repo** (the workflow root), not the code checkout under `_code/`. Every publish is a commit, so the count strictly increases per operator — exactly what claude.ai's strictly-greater auto-update gate needs.
- *Why this is robust:* purging a file from history (the `.wrangler` cleanup, D6) rewrites trees but keeps the commit *count*, so the cleanup doesn't regress the version. New operators starting near `0.1.1` are fine — they have no prior installs to undercut.
- *Compute-before-commit:* the version is read before the publish commit, so the committed bundle carries `<count_before>`; the commit makes it `<count_after>`; the next publish reads the now-higher count. Strictly increasing across publishes — correct.
- *Alternatives considered:* (a) keep code-repo commit count + floor against the data repo's last-published `plugin.json` — works but re-introduces the floor logic we're deleting; (b) a wall-clock `0.1.<YYYYMMDDHHMM>` — monotonic and rewrite-proof, but bumps on every re-run even with no content change. Commit-count is the simplest monotonic signal tied to actual publishes.

### D4 — Retire the uploadable-artifact path
Delete the reusable `data-build-plugin.yml` and the template's `build-plugin.yml` caller. Because adding a public marketplace needs no GitHub auth, the artifact's only reason (no-GitHub friends) is gone — they add the marketplace directly. The no-GitHub *file* fallback survives implicitly (the bundle is publicly fetchable from the repo) and `AGENT_INSTRUCTIONS.md` remains a project-paste fallback.
- *Alternative considered:* keep the artifact workflow as belt-and-suspenders. Rejected for simplicity; the capability isn't lost.

### D5 — `ci.yml` auto-dispatch also fires on persona/builder changes
The maintainer's code→data auto-deploy trigger adds `AGENT_INSTRUCTIONS.md` and `scripts/build-plugin.mjs` to its watched paths, so a persona-only change republishes skills. Safe precisely because the deploy is Worker-first (D2): it redeploys the (unchanged) Worker, then publishes the new skills.
- *Self-hoster note:* unchanged for them — they take upstream updates by running their own deploy at their pinned `code_ref`.

### D6 — Pre-public security gate is part of this change, not a follow-up
Removing `.wrangler/cache/wrangler-account.json` (leaks the CF account id + the operator's `proton.me` email in the account name), adding `.wrangler/` to `.gitignore` (data repo + template + code repo), scanning history, and setting `ACCESS_ALLOWED_EMAILS` are first-class tasks that **gate** the visibility flip. The deploy never committed `.wrangler/` (its `git add` is path-scoped); the file came from local `wrangler` use, which is why the template gitignore fix is the systemic part.

## Risks / Trade-offs

- **claude.ai per-name version high-water mark** → Casey's existing installs sit on the code-repo marketplace at `0.1.126`. If claude.ai gates updates by plugin *name* (`grocery-agent`) across marketplaces, the new data-repo bundle must exceed `0.1.126` to update in place. *Mitigation:* his data repo's commit count is plausibly already > 126 (≈20 branches of history); confirm at implementation and, if short, apply a one-time floor. A *re-add* of the new marketplace is likely treated as a fresh install regardless. New operators are unaffected (no prior installs).
- **Existing installs break when the code-repo marketplace is removed** → anyone on `caseyWebb/groceries-agent` loses the source. *Mitigation:* documented one-time re-add to the data-repo marketplace; it's just Casey + friends.
- **Marketplace points at a not-yet-built `./plugin/grocery-agent`** before the first deploy → adding the marketplace pre-deploy would 404. *Mitigation:* onboarding happens after the first deploy; the template ships `marketplace.json` but the bundle materializes on first publish — document the ordering.
- **History rewrite for the `.wrangler` purge** → could in theory perturb the commit count. *Mitigation:* a file-only purge (filter-repo/BFG path) preserves commit count (D3); do the cleanup *before* the first marketplace publish so there's no prior data-repo-count version to undercut.
- **Public Access identifiers (`ACCESS_AUD`, team domain)** → naming the Access app slightly lowers obscurity. *Mitigation:* security rests on JWT signature + the email allowlist, so set `ACCESS_ALLOWED_EMAILS` (D6); these are non-secret by design.

## Migration Plan

1. **Code repo** (this branch): remove `plugin/` + `.claude-plugin/marketplace.json`; update `build-plugin.mjs` (version source → data repo, drop placeholder guard + floor); fold build+commit into `data-deploy.yml`; delete `data-build-plugin.yml`; expand `ci.yml` triggers; rewrite the SELF_HOSTING/README/CONTRIBUTING/CLAUDE docs to the one-path story; fix `tests/`.
2. **Template repo**: add `.wrangler/` to `.gitignore`; add `.claude-plugin/marketplace.json`; remove `build-plugin.yml`; README documents public-by-default + the no-secrets rationale.
3. **Live data repo**: `git rm` the `.wrangler/cache/wrangler-account.json`, add `.wrangler/` ignore, scan + clean history, set `ACCESS_ALLOWED_EMAILS`, run a deploy to produce the first published bundle, **then** flip to Public.
4. **Cutover**: re-add `caseyWebb/groceries-agent-data` as the marketplace in claude.ai; confirm auto-update picks up the data-repo version. Notify friends to re-add.
5. **Rollback**: the code-repo bundle deletion is revertible from git; until friends re-add, the old code-repo marketplace can be restored from history. No data is at risk (corpus in R2, state in D1).

## Open Questions

- Does claude.ai dedupe/gate the plugin `version` by plugin **name**, by **marketplace source**, or by both? Determines whether Casey needs a one-time version floor above `0.1.126` (Risk #1). Resolve by checking his data-repo commit count and testing a re-add.
- Should the code repo's root `.mcp.json` (the dev/Inspector connector, maintainer URL) stay? Leaning yes — it's local-dev only, not part of distribution.
- Confirm `/plugin marketplace add` + install is available in the claude.ai **web** surface the friend group uses (the spec already claims web + Desktop Chat tab support).
