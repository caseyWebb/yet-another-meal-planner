## Why

The self-hoster plugin story is three awkward paths — upload a CI-built `.zip`, fork the code repo for a marketplace, or paste `AGENT_INSTRUCTIONS.md` — because the marketplace lives in the **code** repo with the maintainer's connector URL baked in, and the lightweight repo that should host each operator's *own* marketplace (their data repo) is private. Now that the data repo carries nothing secret (corpus in R2, member data in D1, invites minted only in the Access-gated `/admin` panel, the sole Actions secret encrypted), it can be public — and because claude.ai adds a public git marketplace with **no member auth**, an operator's own data repo can *be* their marketplace. That collapses three paths into one (`/plugin marketplace add <you>/groceries-agent-data`) and gives every self-hoster pull-based auto-updates with no fork.

## What Changes

- **BREAKING (self-host distribution):** The plugin marketplace moves from the code repo to each operator's **public data repo**. Operators and friends install via `/plugin marketplace add <operator>/groceries-agent-data` + invite code, and receive updates by pull — no fork, no file forwarding, no GitHub account for friends.
- The reusable **deploy** workflow gains a tail: after deploying the Worker, it builds the bundle with the operator's connector URL and commits `plugin/` + `.claude-plugin/marketplace.json` back to the data repo. **Worker-first-then-skills ordering becomes structural**, not documented discipline.
- **Retire the uploadable-bundle path:** drop the reusable `data-build-plugin.yml` and the template's `build-plugin.yml` caller. The public repo's GitHub *Download ZIP* remains a no-account file fallback; `AGENT_INSTRUCTIONS.md` remains the build **source** and a documented last-ditch project-paste fallback.
- **Code repo stops shipping a committed plugin:** remove `plugin/` and `.claude-plugin/marketplace.json` from the code repo. It keeps the builder (`scripts/build-plugin.mjs`) and the reusable deploy workflow. Drop the build's "refuse placeholder URL" guard and the code-repo version-floor machinery (`publishedVersion` / `floorVersion`) — there is no committed code-repo bundle to floor against.
- **Plugin version** derives from the **data repo's own commit count** (monotonic per operator — every publish is a commit), so claude.ai's strictly-greater auto-update gate is always satisfied and the squash-merge floor problem disappears.
- **Auto-deploy trigger:** `ci.yml` also fires the data-repo deploy on changes to `AGENT_INSTRUCTIONS.md` and `scripts/build-plugin.mjs`, so a persona-only change republishes skills (safe — deploy always redeploys the Worker before publishing skills).
- **Template:** add `.wrangler/` to `.gitignore`, ship `.claude-plugin/marketplace.json`, document **create-as-Public** as the default (with the "nothing here is secret" rationale), drop `build-plugin.yml`.
- **Security gate before any repo goes public:** remove the committed `.wrangler/cache/wrangler-account.json` from the live data repo (it leaks the Cloudflare account id and the operator's email in the account name), add `.wrangler/` to `.gitignore`, scan git history for pre-`/admin` invite codes / creds, and set `ACCESS_ALLOWED_EMAILS` as defense-in-depth.

## Capabilities

### New Capabilities

<!-- None — this change reshapes existing capabilities rather than introducing new ones. -->

### Modified Capabilities

- `agent-plugin-distribution`: the marketplace is the self-hoster's **own public data repo** (not the code repo); the uploadable-bundle requirement is retired in favor of the public-marketplace path; the "skills not sourced from an *upstream* marketplace" rule is now satisfied (the marketplace is theirs, advanced by their own deploy); Worker-first ordering is **structurally enforced** by publishing as the deploy's tail; the plugin version is monotonic per operator (data-repo commit count).
- `repo-structure`: the data repo flips from **private** to **public-capable** and additionally hosts the marketplace bundle (`plugin/` + `.claude-plugin/marketplace.json`); the code repo no longer commits `plugin/`; the gitignore requirement gains `.wrangler/`; members still need no GitHub account (strengthened — adding a public marketplace needs no auth).
- `build-automation`: the plugin build folds into the reusable **deploy** workflow and publishes by **committing to the data-repo marketplace** (operator URL baked), replacing the standalone artifact-producing `data-build-plugin.yml`.

## Impact

- **Code repo (`caseyWebb/groceries-agent`):** remove `plugin/` + `.claude-plugin/marketplace.json`; edit `scripts/build-plugin.mjs` (drop placeholder guard + version floor; switch the version source); fold build+commit into `.github/workflows/data-deploy.yml`; delete `.github/workflows/data-build-plugin.yml`; expand `ci.yml` trigger paths; update `docs/SELF_HOSTING.md`, `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`; adjust build-tooling tests under `tests/`.
- **Template (`caseyWebb/groceries-agent-data-template`):** `.gitignore` (+`.wrangler/`); add `.claude-plugin/marketplace.json`; drop `build-plugin.yml`; README documents public-by-default with the no-secrets rationale.
- **Live data repo (`caseyWebb/groceries-agent-data`):** delete `.wrangler/cache/wrangler-account.json`; `.gitignore` (+`.wrangler/`); history scan; set `ACCESS_ALLOWED_EMAILS`; flip to Public.
- **Members:** install path changes to `/plugin marketplace add …`; existing installs re-add once. No Worker runtime / MCP tool changes; no D1 schema changes.
