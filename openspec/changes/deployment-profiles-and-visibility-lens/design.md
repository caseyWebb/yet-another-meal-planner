## Context

Band 5 opened with `member-identity-split`: both the MCP handler and the `/api` session middleware now resolve `(tenantId, memberId)` through one shared resolver before anything runs; a `members` table exists with the founding-member invariant (founding member id = tenant id); migration `0058` is owned by that change. This change is the band's second step and treats that contract as landed.

Current corpus reality (verified in code during planning):

- The D1 `recipes` table is a reconcile-owned projection of the R2 corpus (`recipes/<slug>.md`), read through `src/recipe-index.ts` (`loadRecipeIndex` for whole-index reads; `recipeMeta`/`recipeVector`/`recipeSourceMap` point reads). Every full-corpus consumer funnels through `loadRecipeIndex`; the point-read consumers are `readRecipeDetail` (tools + `/api` + widget) and `readNewForMe`.
- No visibility structure exists: `search_recipes`, the propose pools, trending/picked-for-you (`src/cookbook-rows.ts`), the member cookbook `/api` reads, and the anonymous `/cookbook` site all render the full index. The only per-caller gates are the overlay `reject` filter and the notes `private=0 OR author=?` filter.
- The deployment-profile accessor is a stub: `member-app-core`'s whoami requirement returns `"self-hosted"` and "claims no configuration channel" until the channel ships — shipping it is this change.
- Deployment-global config precedent: `discovery_config` and `operator_config` are `id=1` D1 singletons with sparse NULL-over-defaults, `load…`/`save…` helpers, and an admin Config surface; `operator_config` demonstrates the validate-plus-`confirm` footgun-floor guard.
- The deploy merge (`packages/worker/scripts/merge-wrangler-config.mjs`) copies `vars` from the operator's config only and silently drops code-repo `vars` — verified against the source and its test.
- The operator's household is `env.OWNER_TENANT_ID` (operator-owned var); `src/dup-scan.ts` is the precedent for an operator-addressed job that is a recorded no-op when the var is unset.
- `discovery_matches(recipe, tenant, score, matched_at)` has no member column (member-identity-split explicitly declined domain-table member keys); `create_recipe` dedups by canonical source URL and throws `already_exists` with `{ slug, source }`.
- The Worker has no GitHub App code path (`src/corpus-store.ts` header: "no GitHub App, installation token, or GitHub API call on this path") — the `multi-tenancy` GitHub-token requirement and the `shared-corpus` private-recipe escape hatch are pure GitHub-era vestige.

**Design authorization**: no Claude Design export exists for design requests #10 (household curated-hide setting) and #11 (cookbook cold-start states). The user has authorized a local design for design requests #10 and #11 for this change (the `offline-stores-and-store-walk` / `grocery-list-page-and-widget` precedent), under the constraint: stay as close to the current design export as possible, mimic existing styles, and use existing shared UI primitives. The request prompts in `product-specs/design-requests.md` are the briefs; Decision 9 below encodes them, and tasks carry Playwright/screenshot obligations.

**Ratification order**: DECISIONS.md's ratifications block wins — D13-amendment (household curated hide ships) supersedes D13's "household-level hide defaults to no" reading; D26/D29/D30-final are context only here.

## Goals / Non-Goals

**Goals:**

- One lens predicate, one enforcement point, both profiles, including the anonymous bottom position — no per-surface visibility reimplementation, no slug-probing oracle.
- Zero member-visible change for self-hosted deployments, and zero data surgery: the flag defaults to self-hosted; implicit edges are computed, never materialized; the legacy reconcile converges production organically.
- Provenance captured once, at creation, on every import path, so the unattached-recipe class never regrows.
- The friendship input isolated as one seam that `households-friends-and-people-page` fills in without touching any consumer.
- The curated tier as ordinary provenance rows on a reserved tenant — no special-cased read path beyond one lens clause and one household setting.

**Non-Goals:**

- Friend edges, People page, requests/invites/blocks, member-move, signup fork (next changes in the band).
- Note visibility tiers (D30-final; `note-visibility-tiers`).
- Re-keying overlay/cook-log/taste/vibes by member; satellite trust rework (D14, band 6).
- Any new HTTP route, binding, cron expression, or dependency.
- A materialized visible-set (per-viewer rows, caches, or flags) — the predicate is computed per read.

## Decisions

### 1. Profile-flag channel: `operator_config.deployment_profile` (D1 config), not a wrangler var

Per 00-overview §Routing (8), the D1-config channel is preferred and the wrangler-var alternative must be verified against the deploy-merge allowlist. Verification kills the var option outright: `mergeWranglerConfig` builds its output additively from an explicit per-key allowlist, and `vars` are taken from the **operator's** data-repo config only — code-repo `vars` are deliberately dropped (cross-tenant safety), so a flag authored in this repo's `wrangler.jsonc` would silently never reach any deployment. A var would also make the flip guards unenforceable (a deploy-time merge cannot query D1 for non-empty households) and would put a consent-sensitive toggle in an unvalidated text file.

Chosen channel: a `deployment_profile TEXT CHECK (deployment_profile IN ('self-hosted','saas'))` column on the existing `operator_config` singleton (plus `curated_source_url TEXT` — Decision 6), following the sparse-override idiom: NULL resolves to `'self-hosted'`, so existing deployments need no write. One accessor — `loadDeploymentProfile(env)` in `src/deployment.ts`, replacing the whoami stub — is the only site that names the source; every profile-conditioned code path (lens, trending guard, curated sweep, whoami, admin) takes the accessor's value. Wire value stays lowercase `"saas"` (the shipped whoami contract); prose uses "SaaS".

**Flip guards** live in the config write path (`saveOperatorConfig` callers), following the `validateOperatorConfig` validate-plus-`confirm` pattern, except the SaaS→self-hosted guard needs a D1 read so it runs in the admin operation, not the pure validator:

- self-hosted→SaaS: allowed with an explicit `confirm`; the confirmation copy states that implicit all-to-all edges disappear and members immediately stop seeing other households' recipes (the operator may bulk-create real friendships once the People change ships).
- SaaS→self-hosted: **refused** (structured error, no write) unless at most **one** household has a non-empty own cookbook. "Non-empty own cookbook" = the tenant owns ≥1 `recipe_imports` row, excluding the reserved curated tenant. This is the consent-inversion guard: flipping to implicit all-to-all would publish every household's cookbook to every other household.

Alternative considered: a new dedicated singleton table. Rejected — `operator_config` already has the load/save/validate/admin plumbing and the flag is exactly an operator knob.

### 2. `recipe_imports` structure and the reserved curated tenant

Migration `0059_recipe_imports.sql` (0058 is `member-identity-split`'s; 0018/0045/0047 duplicate-number mistakes are not repeated):

```sql
CREATE TABLE IF NOT EXISTS recipe_imports (
  recipe      TEXT NOT NULL,  -- recipe slug (joins recipes.slug)
  tenant      TEXT NOT NULL,  -- owning household; or the reserved curated tenant
  member      TEXT NOT NULL,  -- importing member; founding member (= tenant id) for
                              -- reconciled/backfilled rows and the curated tenant
  via         TEXT NOT NULL,  -- 'agent' | 'feed:<url>' | 'satellite' | 'curated'
  imported_at TEXT NOT NULL,  -- YYYY-MM-DD
  PRIMARY KEY (recipe, tenant)
);
CREATE INDEX IF NOT EXISTS idx_recipe_imports_tenant ON recipe_imports(tenant);

ALTER TABLE discovery_matches ADD COLUMN member TEXT;
UPDATE discovery_matches SET member = tenant WHERE member IS NULL;

ALTER TABLE operator_config ADD COLUMN deployment_profile TEXT
  CHECK (deployment_profile IN ('self-hosted','saas'));
ALTER TABLE operator_config ADD COLUMN curated_source_url TEXT;

ALTER TABLE profile ADD COLUMN curated_hide INTEGER;  -- NULL/0 = show curated tier
```

- PK `(recipe, tenant)` enforces D12's "one provenance row per (recipe, household)"; a household's second import of the same recipe is `INSERT OR IGNORE` (first provenance wins — provenance records how the recipe first arrived for that household).
- `member` is NOT NULL with no NULL-owner sentinel anywhere (D12): human-triggered imports stamp the resolved context member; reconciled legacy grants and curated grants stamp the founding-member value (= tenant id), which is always a real members-table row for real tenants.
- **Reserved curated tenant**: the constant `~curated` (module constant beside the lens). `~` is outside the canonical tenant-username space (lowercase usernames) and outside the product handle grammar `[a-z0-9_]{3,20}`, so no signup or onboarding path can ever claim it; it gets no `tenants`-registry row, no allowlist entry, no members row, and can never resolve a session or token. It exists only as a value in `recipe_imports.tenant`/`member`. Rejected alternative: a plain name like `curated` — claimable in principle, and a directory/roster contaminant.
- `discovery_matches.member` backfill `member = tenant` is exact under the founding-member invariant (every pre-split match was made for the household's only member). The sweep stamps real members going forward; per-member taste vectors remain tenant-keyed today, so the stamped member is the founding member until a later change splits taste by member — attribution semantics are unchanged for existing deployments.

### 3. The lens: one predicate, one module, three viewer positions

New `src/visibility.ts` owns the predicate. Viewer type: `{ kind: "member", tenant, member } | { kind: "anonymous" }`. Derivation pipelines (projection, embed, facet classify, dup-scan) are corpus-wide by design (D2 compute-once) and are **not** lens consumers.

Predicate (SQL sketch; `:curated` = the reserved tenant constant):

```sql
-- visible(viewer, r) for a member viewer, as an EXISTS fragment over recipes r
EXISTS (
  SELECT 1 FROM recipe_imports i
  WHERE i.recipe = r.slug
    AND (
      CASE WHEN :profile = 'self-hosted'
        THEN i.tenant <> :curated                      -- implicit all-to-all: any
                                                       -- household's import grants
        ELSE i.tenant = :tenant                        -- own import
          OR i.tenant IN (SELECT f FROM <friend-seam(:tenant)>)   -- friend import
          OR (i.tenant = :curated AND NOT :curatedHide)           -- curated floor
      END
    )
)
-- anonymous viewer (the bottom lens position):
--   self-hosted: EXISTS (SELECT 1 FROM recipe_imports i WHERE i.recipe = r.slug
--                        AND i.tenant <> :curated)
--   saas:        EXISTS (... AND i.tenant = :curated)
```

- **Implementation shape**: `visibleSlugs(env, viewer)` computes the visible slug set in one indexed query; `loadRecipeIndex(env, viewer)` applies it so every whole-index consumer (search, cookbook, propose, trending, picked-for-you, member `/api` index) inherits the lens by construction; the point reads (`readRecipeDetail`, `readNewForMe`, notes, similar, `recipe_site_url`) call `isVisible(env, viewer, slug)` (the same fragment as a point query). Both entry points build the SQL through one private fragment builder — the single enforcement point is the module, and the spec forbids any consumer resolving visibility another way. At friend-group scale the whole-index read already loads every row (`loadRecipeIndex` precedent), so a set-membership join adds one indexed query, not a scaling risk.
- **The friend seam**: `<friend-seam(:tenant)>` is produced by one named provider function in `src/visibility.ts`. In this change it returns the **empty relation** under SaaS (no `friendships` table exists yet) and is bypassed entirely under self-hosted (the all-to-all arm above needs no enumeration). `households-friends-and-people-page` replaces the provider body with the real `friendships` subquery — one seam, zero consumer edits. The provider's contract (symmetric, accepted-only edges, keyed by tenant) is stated in the spec delta so the later change slots in without reinterpretation.
- **Curated exclusion under self-hosted**: the curated tier is a SaaS-only floor (D9). The self-hosted arm excludes curated rows so a deployment that flips SaaS→(guard-permitting)→self-hosted doesn't smear previously-curated rows into "today's corpus" claims; in practice self-hosted deployments never have curated rows because the curated sweep only runs under SaaS.
- **404 indistinguishability**: `readRecipeDetail`, `read_recipe_notes`, the member detail `/api` read, and `/cookbook/<slug>` resolve visibility **before** existence is disclosed: out-of-lens and nonexistent slugs produce the byte-identical `not_found`/404 (same status, body, and timing class — the visibility check is one indexed query either way).
- **Overlay interplay**: the lens composes before the overlay — `reject` still hides within the visible set; `favorite` on a recipe that later leaves the lens (unfriend, curated-hide) simply has nothing to attach to until visibility returns (rows are never deleted by visibility events; the lens is live, D30's principle).

### 4. Sweep imports: match row and grant minted together (D13)

D13 says "the `discovery_matches` row IS the grant" while D12 makes `recipe_imports` the canonical grant relation and has the legacy reconcile mint grants **from** attribution rows. Read together: every confirmed match begets exactly one household grant, and the two must not be able to drift. Two candidate mechanics:

- (a) The lens predicate unions `discovery_matches` in as a second grant source. Rejected: two grant relations inside the one predicate contradicts D12's "canonical structure" and makes the legacy reconcile's attribution-derived grants redundant-yet-specified; every future import kind would grow the predicate.
- (b) **Chosen**: one grant relation. The sweep's `recordMatches` step becomes one write path that upserts the `discovery_matches` row (now with `member`) and `INSERT OR IGNORE`s the household's `recipe_imports` row (`via = 'feed:<canonical feed url>'`, or `'satellite'` when the discovery-log origin is a satellite push) in the same batch — attribution and visibility literally cannot drift because one function writes both. The legacy reconcile (Decision 5) doubles as the drift guard: any match row missing its grant is healed on the next tick.

`list_new_for_me` keeps its attribution semantics and adds the member filter (`m.member = :member`) — per-member attribution, per-household visibility, two reads of the same rows. With every household single-member today, behavior is unchanged in production.

### 5. Legacy-attachment reconcile: a bounded, idempotent `scheduled()` phase

A new job (`lens-reconcile`, `src/lens-reconcile.ts`) runs in the phase after the discovery sweep:

1. Enumerate corpus slugs (the `recipes` projection) with zero `recipe_imports` rows — bounded per tick (cap ~200, the sibling-job idiom).
2. For each: if `discovery_matches` rows exist → one grant per attributed tenant, `via` resolved from the `discovery_log` origin for that slug (`feed:<url>`; `satellite` for pushed origins; `agent` when no origin resolves), `member` = the match row's member, `imported_at` = the match date (else the recipe's `discovered_at`, else today). Otherwise → one grant to the operator's household (`normalizeTenantId(env.OWNER_TENANT_ID)`, the `dup-scan` idiom), `via = 'agent'`, founding member.
3. No `OWNER_TENANT_ID` configured → attribution-derived grants still run; the operator-fallback step records a skipped-run summary and no-ops (the dup-scan precedent), so configuring the operator later converges the remainder. Under self-hosted the lens is not yet corpus-complete until the reconcile converges — the rollout note in the Migration Plan covers the one-deploy window.
4. Idempotent by construction: `INSERT OR IGNORE` on the PK; a converged corpus plans zero writes. `job_health`/`job_runs` + usage-trends point like sibling jobs. The job is permanent — it is the guard that keeps the unattached class extinct (AGENTS.md: production data converges through reconciles/guards, never manual surgery).

**Acceptance fixture**: production attached/unattached counts. Remote D1 reads were permission-denied this session, so the counts are captured by an operator-gated pre-merge task (tasks §10) with exact read-only queries; expectations derived from code: every projected slug gains ≥1 import row within ⌈unattached/cap⌉ ticks; `COUNT(recipes) - COUNT(DISTINCT recipe_imports.recipe) = 0` at convergence; grants-per-slug ≥ distinct `discovery_matches` tenants per slug.

### 6. Curated set mechanics and governance (closes story 01 §5 q5)

- **Distribution (decided by D13)**: never a committed seed in this repo. `operator_config.curated_source_url` holds a pinned public feed URL; the compiled default points at the product-maintained curated feed (a public data-repo URL published by the yamp project — the same channel the marketplace uses); NULL-over-default idiom means operators inherit updates without action.
- **Governance (the open halves, resolved)**: the **product maintainers** (this repo's maintainers) own the default curated source's content — selection, hygiene, and removals — exactly as they own the plugin skills; it is versioned in the product's public data repo, not authored per-deployment. **Update cadence** is pull-based: each SaaS deployment's sweep polls the curated source on the existing sweep cadence under the existing per-tick feed-rotation and volume-governance bounds, so curated intake can never starve member feeds. **Operator-adjustable**: the admin Config area exposes the URL (repoint to fork the experience, clear/disable to opt out entirely); the control and the profile flag live on the same card.
- **Pipeline**: under SaaS only, the sweep treats the curated source as a feed whose imports skip taste matching and member attribution — no `discovery_matches` rows are written (so curated landings can never flood "Just Added", which reads member matches) — and land `recipe_imports(recipe, '~curated', '~curated', 'curated', <date>)`. Dedup is the ordinary source-URL/semantic dedup: a recipe a household already imported gains a curated grant row alongside (distinct tenants, both rows live), and vice versa.
- **Hides**: household-level `profile.curated_hide` is one lens clause (Decision 3); per-member `toggle_reject` already works on any visible row. The member control ships per design request #10 (Decision 9); the write rides the existing preferences merge-patch path (class (a) whole-document, per D15 — it is a preferences-document field, not a new writer).

### 7. Trending under the lens: one implementation, profile-parameterized guard (D31)

`readTrending` gains the viewer and the profile:

- **Aggregation set**: under self-hosted — all tenants (today's read, and exactly the friend lens over implicit all-to-all). Under SaaS — the caller's household plus its friend households (the same seam; empty today), with results further restricted to lens-visible recipes.
- **Guard**: self-hosted keeps `cooks >= 2 OR distinct cooking tenants >= 2` **verbatim** (the solo-operator degenerate case stays alive); SaaS requires the contributing set to span ≥2 distinct non-caller households — never "cooked by 1 friend". One guard function parameterized by the profile; the stricter rule is never applied deployment-wide.
- **Copy/badge**: the promoted panel's reserved "Popular with Friends" reason ships — rendered under SaaS with household-counted copy ("cooked by N friend households"); under self-hosted the existing "Trending" label and counts chip stand (D9: it equals deployment-wide trending, no relabel needed). Counts only, never identities (D31); per-recipe provenance ("from @handle's household") remains a People-change concern.
- Picked-for-you and the group-signal favorites count are lens-scoped the same way: candidates/aggregates within the viewer's lens households. Under self-hosted both equal today's reads.

### 8. Tool-contract edges

- **`create_recipe` dedup-to-grant**: the duplicate-source path keeps the `already_exists` code and `{ slug, source }` data (stale-plugin agents keep working) but first mints the caller household's grant (`via='agent'`, resolved member) and words the message as "already in the corpus — now in your household's cookbook (slug: …)". The fresh-create path writes the grant row beside the R2 put. `slug_exists` (name collision, different source) stays a refusal; slug-existence disclosure is accepted the way handle-existence is under D24 — D11's oracle ban is scoped to content reads (`read_recipe`, `/cookbook/<slug>`), which stay indistinguishable. `parse_recipe`'s `existing_slug` hint behaves the same and the subsequent import turns it into a grant.
- **`recipe_site_url(slug?)`**: no-arg behavior unchanged (`<origin>/cookbook`). With `slug`: anonymously-visible → `{ url: "<origin>/cookbook/<slug>", enabled: true, scope: "public" }`; visible to the caller but not anonymously → the member app detail link (`<origin>/recipe/<slug>`, `scope: "member"`); outside the caller's lens → `not_found` (indistinguishable from nonexistent).
- **Tool descriptions own the lens guarantees** (the ownership test): `search_recipes`/`read_recipe`/`list_new_for_me`/`create_recipe`/`recipe_site_url` descriptions state visibility semantics; skills stay choreography-only. **Appendix C binding decision**: band 5's listed persona lines (household members + nicknames at session start; note-tier phrasing) bind to `households-friends-and-people-page` and `note-visibility-tiers` respectively — NOT this change. This change carries only the persona edit its own contract changes force: the corpus-tier "for everyone / changes it for everyone" phrasing is neutralized to lens-truthful wording that is correct under both profiles, plus `aubr build:plugin --check`.

### 9. Local UI design (design requests #10 and #11 — authorized; see Context)

**#10 — Curated-hide setting (Profile → Preferences).** A "Curated collection" card on the Preferences tab, SaaS profile only (whoami's `profile` gates render): title, one explanation sentence ("A starter set of recipes we maintain. They're marked in your cookbook; turn this off to hide them for your whole household."), a single toggle (default on = curated shown), the household-scope hint styled like the tab's other household-wide settings ("Applies to everyone in your household"), and reversibility copy on the off state ("They'll reappear if you turn this back on — nothing is deleted."), no confirm dialog. Existing primitives only: the Preferences card/toggle/hint components already on that tab.

**#11 — Cookbook cold-start (SaaS).** Two new page states, using the existing empty-state and card styles:

- *Curated-floor state* (zero own recipes, curated visible): an onboarding panel above the curated list with three compact action cards — (1) "Add friends" → People page (the destination may pre-date the People change as the nav stub that page's change fills; the card text stays truthful: friends' recipes flow into your cookbook), (2) "Import with the agent" → the Connect-to-Claude modal when not yet connected, else copy about pasting a URL in a Claude chat, (3) "Start from the curated set" → anchor-scroll to the list, noting hearts/plans work immediately. Curated rows carry a visible "Curated" provenance badge on RecipeRow (a promo-badge-slot variant beside the facet chips). The Recommended panel and the filter bar are hidden in this state.
- *True-zero state* (curated hidden or empty, zero rows): the same three cards carry the page with the fuller empty-illustration treatment consistent with the "No favorites yet" style; no list, no filter bar, no Recommended panel.
- *Dismissal*: the panel disappears permanently once the household has ≥1 own (non-curated) import — a derived condition — or on explicit dismiss, persisted household-level (a preferences-document field riding the same class (a) path as Decision 6; unlisted-write default online-only per D15).

Both surfaces ship Playwright coverage through the real seeded API (`aubr test:app`): the two cold-start states, the badge, the dismiss persistence, and the Preferences card in both profiles (SaaS renders, self-hosted absent). The admin profile/curated-source card ships `admin/visual/` coverage (`aubr test:admin`).

### 10. Spec-surface placement notes

- The cookbook cold-start and provenance-badge requirements land in `member-app-core` (it owns the cookbook page contract) even though CHANGES.md's delta line doesn't name it — CHANGES.md rule 8 delegates slicing, and the alternative (bending them into `member-app-differentiators`) would misfile page states under a signals spec. The whoami accessor clause modifies the requirement `member-app-core` already holds.
- `discovery-sweep` (not just `recipe-discovery`) is deltaed: the grant-minting write path, the member key on matches, and curated-source consumption are sweep contract.
- `operator-admin` is deltaed for the Config-area profile card — a serial-surface note: `member-identity-split` also deltas `operator-admin` (different requirements; this change lands after it).
- `group-insights` gets a stance clause, not a rework: it is an operator surface, deliberately deployment-wide and counts-only, outside the member lens.

## Risks / Trade-offs

- **[Lens bypass regression]** A future read path could query `recipes` directly and skip the lens. → The spec makes the module the single enforcement point with an enumerated consumer list; `loadRecipeIndex` requires a viewer argument (no default), so a new consumer cannot compile without choosing a lens position; tests assert out-of-lens invisibility per consumer.
- **[D13 "match row IS the grant" drift]** Choosing one grant relation (Decision 4b) re-interprets D13's letter. → One write path mints both rows atomically; the reconcile heals any gap each tick; the report to the orchestrator flags the interpretation explicitly rather than silently resolving it.
- **[Self-hosted window before reconcile convergence]** Right after deploy, a legacy recipe with no import row is invisible until the reconcile attaches it (bounded per tick). → Migration Plan orders the migration + first reconcile ticks before member-visible impact matters; the per-tick cap is sized (~200) so typical corpora converge in a few 5-minute ticks; the pre-merge fixture task captures the unattached count so the window is known, and the cap may be raised in the same PR if the count demands it.
- **[Guard refusal deadlock]** SaaS→self-hosted refusal depends on `recipe_imports` counts; a deployment mid-reconcile could miscount. → The guard counts own-cookbook grants (excluding curated), which only grow; refusal is the safe direction (it can only over-refuse, never over-permit).
- **[Curated source abuse/quality]** A bad curated feed lands junk deployment-wide. → The source is product-maintained and pull-bounded by the sweep's existing volume governance; operators can repoint or disable; `reject_discovery` and curated-hide give group- and household-level brakes; per-member `toggle_reject` remains.
- **[Timing oracle on 404s]** Distinguishing "exists but hidden" via response timing. → Both paths run the same visibility point query before any body read; no R2 read happens for out-of-lens slugs.
- **[Anonymous SaaS SEO/regression]** Flipping to SaaS shrinks the public site to the curated tier — an intentional but dramatic change. → The flip-guard confirm copy states it; the anonymous position is spec-pinned so it is a decision, not an accident.

## Migration Plan

1. Land migration 0059 with the code in one deploy: the lens reads and the reconcile ship together; the accessor defaults self-hosted, so day-one behavior is today's (modulo the convergence window above).
2. The reconcile converges legacy attachment organically over ticks; `job_runs` counts are the observable; the operator-gated fixture task verifies production counts pre-merge and at convergence.
3. Only after convergence (and only if desired) does an operator flip to SaaS via the admin card, through the confirm + guards.
4. Rollback: revert the deploy — the flag column and `recipe_imports` rows are inert to old code (additive migration; no old read depends on them). No data rollback needed.

## Open Questions

None. The open halves this change was handed are resolved above: the profile-flag channel (Decision 1), the curated governance halves of story 01 §5 q5 (Decision 6), the D13 grant mechanics (Decision 4), the operator-fallback behavior without `OWNER_TENANT_ID` (Decision 5), slug-existence disclosure on `create_recipe` (Decision 8), the Appendix C persona binding (Decision 8), and the cold-start dismissal persistence (Decision 9).
