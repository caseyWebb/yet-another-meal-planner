## 1. Migration and schema substrate

- [ ] 1.1 Add `packages/worker/migrations/d1/0059_recipe_imports.sql`: `recipe_imports(recipe, tenant, member NOT NULL, via, imported_at, PRIMARY KEY (recipe, tenant))` + `idx_recipe_imports_tenant`; `ALTER TABLE discovery_matches ADD COLUMN member TEXT` with `UPDATE discovery_matches SET member = tenant WHERE member IS NULL` backfill; `ALTER TABLE operator_config ADD COLUMN deployment_profile TEXT CHECK (deployment_profile IN ('self-hosted','saas'))` and `ADD COLUMN curated_source_url TEXT`; `ALTER TABLE profile ADD COLUMN curated_hide INTEGER`. (0058 belongs to member-identity-split; do not reuse 0018/0045/0047-style duplicate numbers.)
- [ ] 1.2 Extend the migration-chain test to cover 0059 (fresh apply + re-apply idempotence + discovery_matches backfill correctness under the founding-member invariant).
- [ ] 1.3 Enroll `recipe_imports` in `TENANT_TABLES` (`src/admin.ts`) so household-purge deletes the household's grant rows; member-revoke must NOT touch `recipe_imports` (the household keeps its recipes). Tests: purge clears the tenant's grants (and out-of-lens visibility follows); member-revoke leaves them; the curated tenant's rows are unreachable by both (it is never a real tenant).

## 2. Deployment-profile channel and flip guards

- [ ] 2.1 Extend `src/operator-config.ts` with `deployment_profile`/`curated_source_url` (sparse NULL-over-default idiom; compiled defaults: `self-hosted`, the product curated-feed URL) and replace the whoami stub in `src/deployment.ts` with `loadDeploymentProfile(env)` — the single accessor; every profile-conditioned path (lens, trending guard, curated sweep, whoami, admin) reads it.
- [ ] 2.2 Implement the flip guards on the config write path: self-hosted→SaaS needs the explicit `confirm` (validate-plus-confirm idiom, `validateOperatorConfig` precedent); SaaS→self-hosted refused (structured error, no write) unless ≤1 household owns a non-empty non-curated cookbook (D1 count over `recipe_imports`).
- [ ] 2.3 Add the Access-gated admin API operation + `packages/admin-app` Config-area card (profile display + flip with confirm dialog + refusal rendering + curated-source URL edit/clear), per `src/admin/CLAUDE.md` modeling standards.
- [ ] 2.4 Worker tests: accessor default (NULL → self-hosted), flip-guard acceptance/refusal matrix, curated-source default/override/clear.

## 3. The lens module (one enforcement point)

- [ ] 3.1 Create `src/visibility.ts`: viewer types (`member`/`anonymous`), the reserved curated-tenant constant (outside the username/handle space; refused by every tenant-creation path), the single SQL fragment builder, `visibleSlugs(env, viewer)` and `isVisible(env, viewer, slug)`, and the named friend-relation seam provider (self-hosted: computed all-to-all arm, no enumeration; SaaS: the empty relation until `households-friends-and-people-page` supplies the `friendships` subquery — document the seam contract at the provider).
- [ ] 3.2 Make `loadRecipeIndex` viewer-scoped (required viewer argument — no default, so no consumer compiles without choosing a lens position) and thread viewers through the whole-index consumers: `search_recipes` (both modes), propose pools (`meal-plan-proposal-tool.ts`), trending/picked-for-you (`cookbook-rows.ts`), member `/api` cookbook index/search, anonymous cookbook index/search.
- [ ] 3.3 Lens-bind the point reads: `readRecipeDetail` (tools `read_recipe`, widget `display_recipe`, `/api` detail), `read_recipe_notes` (+ notes `/api`), similar-recipes (member + anonymous), `readNewForMe` — out-of-lens ⇒ the byte-identical `not_found`/404 with no body read.
- [ ] 3.4 Worker tests per enumerated consumer: out-of-lens invisibility in every mode; self-hosted full-corpus equivalence (post-attachment) against pre-change fixtures; 404/`not_found` indistinguishability (shape + no R2 read) for `read_recipe`, notes, and `/cookbook/<slug>`; overlay reject composing inside the lens.

## 4. Anonymous cookbook and recipe_site_url

- [ ] 4.1 Apply the anonymous viewer in `src/cookbook.ts`/`cookbook-search.ts`/`cookbook-similar.ts`: index, `?q=`, `/cookbook/search` JSON, and Similar Recipes over the anonymous lens (SaaS: curated-only; self-hosted: full attached corpus); out-of-lens slug pages 404 indistinguishably.
- [ ] 4.2 Extend `recipe_site_url` with the optional `slug` param: public link for anonymously-visible slugs, member `/recipe/<slug>` link for caller-visible-only slugs (`scope` field), `not_found` for out-of-lens; no-arg behavior unchanged.
- [ ] 4.3 Tests: anonymous SaaS surface is curated-only across all three cookbook routes; self-hosted byte-parity with today; `recipe_site_url` matrix.

## 5. Import paths record attribution at creation

- [ ] 5.1 `create_recipe`: write the caller household's grant (`via 'agent'`, resolved member) beside the R2 put on fresh creates; dedup-to-grant on `already_exists` (idempotent `INSERT OR IGNORE`, error code and `{ slug, source }` data preserved, message reworded); `slug_exists` refusal unchanged.
- [ ] 5.2 Sweep: one write path mints `discovery_matches` (now with `member`) and the household `recipe_imports` grant (`via 'feed:<url>'`/`'satellite'` per discovery-log origin) in the same batch (`recordMatches`/`recordDiscoveryMatches`).
- [ ] 5.3 `list_new_for_me`/`readNewForMe`: filter matches by the resolved member (attribution per-member, visibility per-household).
- [ ] 5.4 Tests: grant-at-creation on both paths, dedup-to-grant idempotence, N-households-N-grants, new-for-me member filtering, curated/friend visibility events never surfacing in new-for-me.

## 6. Curated tier

- [ ] 6.1 Sweep consumption of `curated_source_url` under SaaS only: existing intake bounds (rotation, volume, dedup, rejections), no taste matching, no `discovery_matches`, grants on the curated tenant (`via 'curated'`); self-hosted never polls it.
- [ ] 6.2 `profile.curated_hide` in `profile-db.ts` + the preferences read/patch paths (`read_user_profile`, `update_preferences`, `/api` preferences) as a household-scoped field; lens clause honors it; anonymous position unaffected.
- [ ] 6.3 Member Preferences "Curated collection" card (design request #10 brief in design.md Decision 9): SaaS-only render via whoami `profile`, toggle + household-scope hint + reversibility copy, existing primitives.
- [ ] 6.4 Tests: curated grants land correctly; curated-hide suppresses the tier for one household only and is reversible; curated rows can be `toggle_reject`ed per member; curated tenant refused by signup/onboarding/token paths.

## 7. Trending guard and the promoted panel (D31)

- [ ] 7.1 Parameterize `readTrending` by profile + viewer: self-hosted keeps the `cooks >= 2 OR tenants >= 2` guard verbatim over all households; SaaS aggregates over the caller's lens households with the ≥2-distinct-non-caller-households guard; results lens-restricted.
- [ ] 7.2 Lens-scope `readPickedForYou` candidates and the group-signal favorites/notes aggregate (lens households only).
- [ ] 7.3 Promoted panel: profile-conditioned cook-signal label ("Trending" self-hosted / "Popular with Friends" SaaS) + household-counted chip copy under SaaS; hidden in cold-start states.
- [ ] 7.4 Tests: guard matrix per profile (incl. the solo-operator degenerate case and the 1-friend-household empty set), label/copy conditioning, no identity exposure.

## 8. Cookbook cold-start onboarding (design request #11)

- [ ] 8.1 Add `provenance` (`own | friend | curated`) to the cookbook index/search hit shape and render the "Curated" RecipeRow badge (shared `packages/ui` promo-badge-slot treatment).
- [ ] 8.2 Implement the two cold-start states (curated-floor panel with the three action cards; true-zero variant with the fuller empty treatment), Recommended panel + filter bar hidden in both; SaaS-only via whoami `profile`.
- [ ] 8.3 Dismissal: derived retirement on first non-curated own import + explicit dismiss persisted household-level through the existing preferences path.
- [ ] 8.4 App Playwright coverage through the real seeded API (`aubr test:app`): both cold-start states, the badge, dismiss persistence, the Preferences curated-hide card (SaaS renders / self-hosted absent), and the browse lens (out-of-lens rows absent).

## 9. Legacy-attachment reconcile (the scheduled() surface)

- [ ] 9.1 Implement `src/lens-reconcile.ts`: bounded per-tick attachment of zero-grant corpus rows — attribution-derived grants (via from discovery-log origin, member from the match row, dated from match/`discovered_at`) else operator-household fallback (`OWNER_TENANT_ID`, dup-scan no-op idiom when unset); `INSERT OR IGNORE` idempotence; heals match-rows-missing-grants; `job_health`/`job_runs` + usage-trends point.
- [ ] 9.2 Wire the job into `scheduled()` in `src/index.ts` after the discovery sweep phase (this change is the only one touching `scheduled()` right now).
- [ ] 9.3 Tests: attribution-derived vs fallback attachment, unset-operator skip + later convergence, converged-corpus zero-work tick, re-run idempotence, bounded batch draining.

## 10. Production acceptance fixture (operator-gated, pre-merge)

- [ ] 10.1 OPERATOR-GATED: capture the production attached/unattached counts as the reconcile's acceptance fixture (read-only; requires production D1 access, which was permission-denied during planning). Queries: `SELECT COUNT(*) FROM recipes;` `SELECT COUNT(DISTINCT recipe) FROM recipe_imports;` (post-deploy) `SELECT COUNT(*) FROM recipes r WHERE NOT EXISTS (SELECT 1 FROM recipe_imports i WHERE i.recipe = r.slug);` `SELECT COUNT(*), COUNT(DISTINCT recipe) FROM discovery_matches;` `SELECT COUNT(DISTINCT recipe) FROM discovery_matches m WHERE NOT EXISTS (SELECT 1 FROM recipe_imports i WHERE i.recipe = m.recipe AND i.tenant = m.tenant);` Record pre-deploy counts, expected grants (≥ distinct match tenants per slug; remainder → operator household), and verify convergence to zero unattached within ⌈unattached/cap⌉ ticks via `job_runs`; raise the per-tick cap in this PR if the captured count demands it.

## 11. Docs, persona, and contract lockstep

- [ ] 11.1 `docs/TOOLS.md`: lens notes on every corpus read (`search_recipes`, `read_recipe`/`display_recipe`, `read_recipe_notes`, `list_new_for_me`, propose reads), `create_recipe` dedup-to-grant, `recipe_site_url(slug?)`, `update_preferences`/`read_user_profile` curated-hide field.
- [ ] 11.2 `docs/SCHEMAS.md`: `recipe_imports`, `discovery_matches.member`, `operator_config.deployment_profile`/`curated_source_url`, `profile.curated_hide`, the reserved curated tenant.
- [ ] 11.3 `docs/ARCHITECTURE.md`: the full multi-tenant identity rewrite (deferred here by member-identity-split — tenant = household, member attribution, the lens, deployment profiles, the curated tier) + the cron-phase list gains the lens reconcile.
- [ ] 11.4 `docs/SELF_HOSTING.md`: the deployment profile (default self-hosted, admin flip + guards, what SaaS changes) and the curated source knob.
- [ ] 11.5 `packages/worker/AGENT_INSTRUCTIONS.md`: neutralize the corpus-tier "for everyone / changes it for everyone / leaves it for everyone else" phrasing to lens-truthful wording valid under both profiles (lens guarantees stay in tool descriptions per the ownership test; band 5's other Appendix C persona lines belong to the later People/notes changes); run `aubr build:plugin --check`.
- [ ] 11.6 Update all twelve deltaed living specs at archive time per the delta files; verify no doc narrates "used to/now" history.

## 12. Verification

- [ ] 12.1 `aubr typecheck` and `aubr test` (worker suites incl. migration chain, lens consumers, sweep, reconcile, config guards) green.
- [ ] 12.2 `aubr test:app` (cookbook cold-start, badge, preferences card, lens browse) and `aubr test:admin` (Config profile card) green.
- [ ] 12.3 Self-hosted parity check: with the flag unset and attachment converged, assert fixture-level equivalence of search/browse/cookbook/trending outputs against pre-change expectations (the D9 zero-change promise).
- [ ] 12.4 `openspec validate deployment-profiles-and-visibility-lens --strict` passes; PR uses the template with every consideration checked.
