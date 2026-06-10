## 1. Tenant context plumbing (foundation)

- [x] 1.1 Define a `Tenant` type (repo coordinates for shared corpus + per-tenant repo, installation reference, Kroger key) and a `resolveTenant(env, token)` seam returning it or a structured `unauthorized`.
- [x] 1.2 Add `worker/src/tenant.ts`: tenant directory backed by KV (identity → repo coords + installation), with an injectable store for tests.
- [x] 1.3 Rework `env.ts`: drop `GITHUB_OWNER/REPO/REF` + `GITHUB_TOKEN` as the global repo path; add GitHub App credentials (app id, private key) and the shared-corpus coordinates; keep Kroger `client_credentials` global.
- [x] 1.4 Thread `Tenant` through `buildServer`: `buildServer(env)` → `buildServer(env, tenant)`; pass tenant into every tool registration in `tools.ts` and the `*-tools.ts` modules (no behavior change yet beyond plumbing).

## 2. GitHub App installation auth

- [x] 2.1 Implement installation-token minting (App JWT from id+private key → `installation/access_tokens`), with isolate-lifetime caching and expiry handling.
- [x] 2.2 Update `github.ts` / `gh-read.ts` to authenticate per request with an installation token scoped to the target repo (shared corpus or the tenant's repo) instead of the static PAT.
- [x] 2.3 Update `commit.ts` so a commit targets exactly one repo (shared OR per-tenant), authenticated by the scoped installation token; preserve the non-fast-forward retry. *(commit engine is repo-agnostic — bound to one repo by the injected client; non-FF retry preserved.)*
- [x] 2.4 Tests: install-token minting/caching; reads/writes route to the correct repo with a scoped token; no global PAT path remains.

## 3. OAuth provider + allowlist identity

- [ ] 3.1 Integrate `workers-oauth-provider` (KV-backed clients/codes/grants); expose the authorize/token/registration surface Claude.ai's connector expects.
- [ ] 3.2 Implement the identity step as an **operator-issued invite code** (D2, resolved) gated by the curated allowlist: a Worker-hosted authorize page collects the code at the connector's OAuth consent step and maps it → tenant directory entry; the issued token carries the tenant thereafter. No third-party login.
- [ ] 3.3 Replace the Access gate in `index.ts` with per-request bearer → `resolveTenant`; reject unresolved tokens with structured `unauthorized`; delete `access.ts` and remove `ACCESS_*` env.
- [ ] 3.4 Tests: allowlisted identity gets a tenant token; unknown identity denied; valid token resolves to a tenant; missing/invalid token rejected with no tool run; two tenants are isolated (no cross-tenant server state).

## 4. Per-tenant Kroger auth

- [x] 4.1 Re-key the refresh token to `kroger:refresh:<tenant>`; bind PKCE `state` to the initiating tenant in `oauth.ts` so the callback stores under the right key.
- [x] 4.2 Rework `kroger-user.ts`: replace the module-level singleton access-token cache with a per-tenant cache; resolve the cart user-context from the requesting tenant's key.
- [x] 4.3 Tests: per-tenant refresh storage + rotation-before-use; `reauth_required` per tenant; cache cannot serve another tenant's token; shared `client_credentials` reads unaffected.

## 5. Repository topology (Model B)

- [x] 5.0 Separate code from data (D2a): make this repo (`caseyWebb/groceries-agent`, renamed from `groceries`) the **code-only upstream** that self-hosters deploy without forking; extract today's root data into one private data repo. *(Split manifest `scripts/migrate/manifest.mjs` + runbook step 7 in `docs/MIGRATION.md`; the destructive `git rm` of root data is the gated operator step, done last after the data repo verifies.)*
- [x] 5.1 Stage the shared data at the data-repo root (recipes content, `aliases/ingredients/substitutions`, `skus/kroger.toml`, `ready_to_eat/`, `_indexes/`) from today's single repo. *(`build-data-repos.mjs` stages `.migration/data/`; operator creates+pushes the private repo per `docs/MIGRATION.md`.)*
- [x] 5.2 Define the per-user subtree layout `users/<username>/` (pantry/preferences/stockup/grocery_list/taste/diet_principles/cooking_log/meal_plan/feeds, `overlay.toml`, `notes/`, personal recipes). *(Staged under `.migration/data/users/<id>/`; overlay is a single `overlay.toml` keyed by slug.)*
- [x] 5.3 Migrate the operator's existing data: subjective frontmatter (`rating`/`status`) → `users/<id>/overlay.toml`; `last_cooked` dropped (derived from cooking_log); objective content stays at the root. *(`splitRecipeFrontmatter` + tests; verified against real data — 65 recipes, 63 overlay rows, 0 subjective leaks.)*
- [x] 5.4 Carry the index + site pipelines to the data repo via **reusable workflows** (DRY, not vendored): code repo hosts `.github/workflows/data-build-indexes.yml` + `data-build-site.yml` (`on: workflow_call`); a data repo's thin callers reference them, billed to the caller. `build-indexes.mjs`/`build-site.mjs` gained `--root` to build a separate data checkout; `build-site.mjs` is status-agnostic (whole corpus). The `groceries-agent-data-template` GitHub template repo (created) carries the thin callers + stub layout. *(Remaining operator steps: copy CI into the existing `groceries-agent-data`, GitHub Pro + enable Pages — runbook step 6.)*

## 6. Shared corpus + overlay (data model)

- [x] 6.1 `data-indexing`: drop `rating`/`last_cooked`/`status` from the shared `_indexes/recipes.json`; keep objective frontmatter only; update build + validation + tests. *(build-indexes strips subjective fields, makes `status` optional, removes the obsolete last_cooked↔log soft-check; build-indexes/build-site tests updated.)*
- [x] 6.2 `data-read-tools`: join shared index + caller overlay (effective `status` defaults to `draft`) + cooking-log-derived `last_cooked`; update `read_recipe` to merge overlay fields; tests. *(`overlay.ts` + `mergeOverlay` wired into list_recipes/read_recipe, transition-safe fallback to index status; 13 overlay tests. Personal-recipe union DEFERRED — escape hatch, 0 personal recipes today; needs a dir-listing/per-user index.)*
- [x] 6.3 `data-write-tools`: route writes by category (content → shared root; overlay/notes/personal-state → `users/<username>/`); subjective edits write overlay, not content; tests. *(write-tools fully routed: rating/status→overlay, content→shared, personal→user subtree, last_cooked no longer co-written to frontmatter; split + overlay-builder tests. REMAINING: discovery draft-recipe creation → shared root, and order SKU cache → shared (§7.1) — both transition-safe at empty prefix.)*
- [ ] 6.4 Idempotent recipe import/discovery: dedupe by source URL/slug so a recipe already in the shared corpus is reused, not duplicated; tests.

## 7. Shared SKU cache + reference data

- [ ] 7.1 Move the SKU cache to the shared corpus; tag each entry with `locationId`; keep per-hit revalidation against the caller's `preferred_location` (fall through to search on mismatch); tests for cross-tenant hit + per-location revalidation.
- [ ] 7.2 Shared `aliases`/`ingredients`; `substitutions` shared with an optional per-tenant override layer (override wins for that tenant only); tests.

## 8. Recipe notes (must-build)

- [ ] 8.1 Note write tool: append a note to the caller's per-tenant repo (slug, body, optional tags, `private`), recording author (structural) + timestamp; never modify shared content or prior notes; tests.
- [ ] 8.2 Note + group-signal reads: aggregate non-private notes (attributed) and group ratings across tenants at read time; exclude others' private notes; cache in KV if needed; tests.
- [x] 8.3 Reconcile with `cooking-log-and-retrospection` (RESOLVED): `cooking_log.toml` is the per-tenant spine; `last_cooked` is derived from it, NOT an overlay field. Overlay = `{rating, status}` only. Notes are the general spin-capture capability; a cooking-log entry may produce a note. (See design.md Open Questions.)

## 9. Docs

- [x] 9.1 Write `docs/SELF_HOSTING.md`: one-time operator setup (register GitHub App, register Kroger app, create the data repo from the template, set App + Kroger secrets + KV, allowlist), Worker deploy, optional Pages site, Claude.ai connect + Kroger consent. Notes the unverified Kroger Acceptable-Use clause + the 5,000 cart-calls/day ceiling. The per-friend invite-code onboarding is marked PENDING §3 (OAuth provider not yet built). *(Also wrote `docs/MIGRATION.md` and updated `CLAUDE.md` for the code-only/multi-tenant model.)*
- [ ] 9.2 Update `docs/PROJECT.md` (multi-tenant architecture, Model B, three-category data model), `docs/SCHEMAS.md` (overlay + note schemas, location-tagged SKU entries, shared vs per-tenant file placement), `docs/TOOLS.md` (read/write contract changes, note tools, group-signal read).
- [ ] 9.3 Update `AGENT_INSTRUCTIONS.md`: surface group ratings/notes; capture spins as notes (not content edits); per-tenant connect + Kroger consent setup.

## 10. End-to-end verification

- [ ] 10.1 Dogfood as tenant #1 (operator): full menu → order flow against the shared corpus + operator overlay + per-tenant Kroger.
- [ ] 10.2 Onboard one real friend as the first multi-tenant exercise; verify tenant isolation (no cross-tenant data/token bleed) and cross-pollination (group notes/ratings surface); fold lessons back into `SELF_HOSTING.md`.
