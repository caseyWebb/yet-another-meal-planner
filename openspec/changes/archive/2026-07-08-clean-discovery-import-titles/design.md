# Design — clean-discovery-import-titles

## Context

The naming contract is already spec'd — `openspec/specs/recipe-import/spec.md` "Clean titles and
globally-unique slugs" (SEO suffixes, marketing qualifiers, editorial framing removed; foreign
dish names preserved over their gloss; slugs globally unique) — but only two of the three import
paths honor it:

- **ReciMe one-time import**: cleaned by the naming pass (done, archived).
- **In-chat agent import** (`parse_recipe` → `create_recipe`): Claude cleans conversationally.
- **Discovery sweep (unattended)**: never cleaned. `discovery-sweep.ts` `acquireContent` returns
  `result.recipe.title || candidate.title` (the page's JSON-LD title, verbatim); `classify()`
  passes it to `classifyRecipe`, whose `CLASSIFIED_FIELDS` deliberately excludes `title` —
  `toFrontmatter` pipeline-sets `fm.title = input.title` untouched. `importRecipe` then calls
  `buildNewRecipe` (`discovery.ts`), which derives the slug via the purely mechanical
  `slugify(title)`. Nothing in the leg can clean anything.

Issue #219 is the observed defect: "A Better Beer Can Chicken" imported verbatim on 2026-07-01,
slug `a-better-beer-can-chicken`.

Two legs of fix, per the repo's convergence discipline ("production data converges through the
pipeline, never through manual surgery"):

1. import-time cleaning in the discovery leg, before slug derivation;
2. a bounded re-audit pass that converges the existing flowery titles organically — with the
   issue-#219 row as the acceptance fixture — while **existing slugs stay immutable** (Decision 4).

## Model identity

The title-clean judgment is performed by **the sweep's existing classifier role** (the small
`env.AI` model behind `classifyRecipe` / `CLASSIFY_MODEL`) — at import it is literally one more
output key on the call the sweep already makes; the re-audit pass makes one small call of the same
shape per backlog recipe. No new model contract, no model name in specs/docs (described by role),
and a **deterministic word-subset guard** (Decision 2) bounds what any model output can do: it can
only *remove* words from a title, never invent identity.

## Production spike (read-only, `wrangler d1 execute DB --remote`, 2026-07-08)

`CLOUDFLARE_API_TOKEN` present; queries against the operator's D1 (`grocery-mcp`, binding `DB`
per `packages/worker/wrangler.jsonc`).

| query | finding |
| --- | --- |
| `SELECT COUNT(*) FROM recipes` | **205** projected recipes — the re-audit backlog size |
| `json_extract(extra,'$.discovery_source')` breakdown | **92 discovery-origin** (73 `discovery-sweep`, 19 named feeds e.g. `Budget Bytes RSS`, `Korean Bapsang RSS`); 113 non-discovery (ReciMe-era, already named by the cleaning pass) |
| the defect row | `slug = a-better-beer-can-chicken`, `title = "A Better Beer Can Chicken"`, `discovered_at = 2026-07-01`, `discovery_source = discovery-sweep`, `source_url = bonappetit.com/recipe/better-beer-can-chicken` |

**The flowery-title list** (manual review of all 205 titles against the recipe-import cleaning
rules). Expected rewrites, with the clean title the re-audit should converge to:

| slug (immutable) | current title | expected clean title |
| --- | --- | --- |
| `a-better-beer-can-chicken` | A Better Beer Can Chicken | **Beer Can Chicken** (the #219 fixture) |
| `30-minute-thai-red-curry-basil-beef-noodles` | 30 Minute Thai Red Curry Basil Beef Noodles | Thai Red Curry Basil Beef Noodles |
| `asian-noodle-salad-recipe` | Asian Noodle Salad Recipe | Asian Noodle Salad |
| `cherry-cake-recipe` | Cherry Cake Recipe | Cherry Cake |
| `chinese-soup-recipe-30-minutes` | Chinese Soup Recipe (30 Minutes) | Chinese Soup |
| `classic-chiffon-cake` | Classic Chiffon Cake | Chiffon Cake |
| `classic-mignonette-sauce` | Classic Mignonette Sauce | Mignonette Sauce |
| `easy-coconut-shrimp` | Easy Coconut Shrimp | Coconut Shrimp |
| `easy-slow-cooker-bbq-pulled-beef` | Easy slow cooker BBQ pulled beef | Slow Cooker BBQ Pulled Beef |
| `homemade-baked-beans-recipe` | Homemade Baked Beans Recipe | Baked Beans |
| `homemade-bbq-sauce-recipe` | Homemade BBQ Sauce Recipe | BBQ Sauce |
| `homemade-cherry-crisp` | Homemade Cherry Crisp | Cherry Crisp |
| `homemade-pasta-dough` | Homemade Pasta Dough | Pasta Dough |
| `italian-chicken-cutlets-recipe` | Italian Chicken Cutlets Recipe | Italian Chicken Cutlets |
| `offelle-di-parona-recipe-italian-butter-cookies-from-lombardy` | Offelle di Parona Recipe (Italian Butter Cookies from Lombardy) | Offelle di Parona (Italian Butter Cookies) *(gloss may stay; "Recipe" and "from Lombardy" framing go)* |
| `our-go-to-side-salad` | Our Go-To Side Salad | Side Salad |
| `pasta-alla-caponata-recipe-sicilian-eggplant-pasta-salad` | Pasta alla Caponata Recipe (Sicilian Eggplant Pasta Salad) | Pasta alla Caponata (Sicilian Eggplant Pasta Salad) |
| `shiso-drink-natural-pink-lemonade` | Shiso Drink (Natural Pink Lemonade!) | Shiso Drink |
| `summer-dinner-recipe-fresh-strawberry-chicken-salad` | Summer Dinner Recipe: Fresh Strawberry Chicken Salad | Strawberry Chicken Salad |
| `super-soft-and-tender-lemon-yogurt-loaf` | Super Soft and Tender Lemon Yogurt Loaf | Lemon Yogurt Loaf |
| `thai-tea-lime-pie-inspired-by-cha-ma-nao` | Thai Tea Lime Pie (Inspired By Cha Ma Nao) | Thai Tea Lime Pie |
| `trenette-al-pesto-recipe-with-potatoes-and-green-beans` | Trenette al Pesto Recipe with Potatoes and Green Beans | Trenette al Pesto with Potatoes and Green Beans |
| `tropical-granola-recipe` | Tropical Granola Recipe | Tropical Granola |
| `vegetarian-crab-cake-recipe` | Vegetarian Crab Cake Recipe | Vegetarian Crab Cake |
| `vegetarian-chili` *(non-discovery)* | Homemade Vegetarian Chili | Vegetarian Chili |

Borderline rows the guard/instructions deliberately leave to the model's conservative default
("when unsure, keep"): `copycat-trader-joe-s-strawberry-doodle-cookies` (the brand reference is
arguably identity), `the-bakehouse-texas-big-buttermilk-biscuits-jammers` (brand framing),
`how-to-boil-corn-on-the-cob` (a technique page; "Corn on the Cob" is subset-safe if the model
takes it). **Not defects, must NOT be rewritten**: identity-bearing qualifiers ("Vegan Meatballs",
"Crispy Tofu With Peanut Sauce") and informative foreign-name glosses ("Jatjuk (Pine Nut
Porridge)", "Kkakdugi (Cubed Radish Kimchi)", "Zaru Udon (Cold Udon with Dipping Sauce)") — the
glossed-title style is pervasive in the ReciMe-named corpus (e.g. "Sundubu Jjigae (Korean Soft
Tofu Stew)" over the clean slug `sundubu-jjigae`) and stays; only the **slug basis** drops the
gloss (Decision 3).

**Sizing**: 205-row backlog, ~25 expected rewrites (≈12%). At 10 audits/tick on the `*/5 * * * *`
cron the backlog drains in ≈21 ticks (< 2 hours), then the pass is a one-`SELECT` no-op forever
(born-stamped new writes never enter it).

## Decisions

### 1. Cleaning rides the classify call (LLM), guarded deterministically — not a rule list

Two candidate mechanisms were weighed:

- **Deterministic rules** (strip trailing " Recipe", leading "The Best/Easy/Homemade/Classic…"):
  cheap, unit-testable, zero model variance — but they structurally cannot satisfy the existing
  contract, which requires resolving **editorial framing** to the underlying dish name. The
  observed defects are dominated by open-ended framing a rule list cannot enumerate: "A Better X",
  "Our Go-To X", "Summer Dinner Recipe: X", "Super Soft and Tender X", "X (Inspired By Y)". A rule
  list would fix the "Recipe"-suffix rows and fossilize the rest.
- **Classify ride-along** (chosen): the discovery import already makes exactly one `classifyRecipe`
  call per import, with the title and full content in the prompt and a contract-validator +
  corrective-retry loop as backstop. Emitting a cleaned `title` is one more JSON key on that call —
  **zero marginal `env.AI` cost** — and is the capture→retrieve→narrow pattern: the judgment is
  captured once at import into persistent data. Few-shot exemplars anchor it (one exemplar gets a
  flowery input title with the clean output; the others keep clean-in→same-out so the model learns
  *not* to rewrite already-clean titles).

The LLM's known failure mode (rewriting dish identity) is closed **deterministically**, not by
prompt hope — Decision 2. `title` is added to `CLASSIFIED_FIELDS`' prompt contract but **NOT** to
`DERIVED_FACET_FIELDS`: the facet-derivation consumers (`seedRecipeFacets`, the whole-corpus
facet cron via `extractFacets`) read only the facet keys, so the classifier's title never
overrides an authored title through the facet path. Only two consumers act on it: the discovery
import leg (this change) and the re-audit pass (Decision 4).

### 2. The word-subset guard: cleaning can only remove words, and fails open

`cleanedTitleOrFallback(raw, cleaned)` (pure, in `discovery-classify.ts`, unit-tested): accept the
model's cleaned title only if

- it is a non-empty string, and
- its word multiset is a **subset** of the raw title's, compared lowercased on alphanumeric word
  boundaries (so "Easy slow cooker BBQ pulled beef" → "Slow Cooker BBQ Pulled Beef" passes:
  re-casing is free, removal is allowed, **insertion of any new word is rejected**).

On rejection (or a missing/empty `title` key) the pipeline **falls back to the raw title** — the
import proceeds exactly as today. Consequences, accepted deliberately:

- cleaning can never park an import (no new failure class; the classify validator does not gain a
  title clause);
- the model cannot invent a new identity ("Beer Can Chicken" ⊆ "A Better Beer Can Chicken" ✓;
  a hallucinated "Roast Chicken" ✗ → raw title kept);
- conservative misses are possible (a singular/plural normalization like "Crab Cake" → "Crab
  Cakes" is rejected; the recipe-import contract's rare resolve-headline-to-a-dish-name-not-
  present-in-the-headline case falls back to the raw title). These keep today's behavior, which
  is the correct failure direction for an unattended pass.

The same guard is applied at both call sites (import-time and the re-audit), so the whole change
is safe-by-construction against model drift.

### 3. Slug basis: the cleaned title minus its parenthetical gloss, in `buildNewRecipe`

`buildNewRecipe` derives the slug from `slugify(stripParenthetical(title))`, falling back to the
full title when the strip empties it. Rationale: the ReciMe-named corpus already models this —
glossed title, clean slug ("Sundubu Jjigae (Korean Soft Tofu Stew)" / `sundubu-jjigae`) — while
the discovery leg fossilized glosses into slugs (`jatjuk-pine-nut-porridge`,
`kkakdugi-cubed-radish-kimchi`). Placing the strip in `buildNewRecipe` (not the sweep) gives
`create_recipe` the same naming funnel; an explicit `slug` param still overrides (unchanged).
`slugify` itself stays purely mechanical. `create_recipe`'s tool description + `docs/TOOLS.md`
note the nuance, same pass.

### 4. Collision handling: the sweep disambiguates deterministically; `create_recipe` still errors

Cleaning maps a larger title space onto a smaller slug space, so `slug_exists` collisions become
likelier (a future "The Best Strawberry Icebox Cake" cleans onto the existing
`strawberry-icebox-cake`). Semantics differ by path:

- **Sweep**: by the time import runs, the candidate has already survived URL dedup **and**
  semantic dedup (`dedupThreshold` cosine vs the whole corpus + this tick's imports), so a
  residual collision is a **same-name-different-dish**. Parking it (today's behavior — the
  `importRecipe` throw becomes a terminal `error` log row) would silently drop a wanted recipe.
  The sweep's `importRecipe` catches `slug_exists` and retries with a bounded numeric suffix
  (`<slug>-2` … `<slug>-9`; then park — a 9-deep pileup means something is wrong). Deterministic,
  no model. Titles may legitimately duplicate; slugs stay unique. The R2 `getFile` existence check
  in `buildNewRecipe` plus sequential imports within a tick make the check race-free.
- **`create_recipe`**: keeps the structured `slug_exists` error — there a conversational agent
  should decide (reuse the existing recipe, pick a better name), not get a silent `-2`.
- **Projection duplicate-slug guard** (`recipe-projection.ts` `seenSlugs`) is unaffected: it
  guards two R2 *paths* deriving the same slug; this change never writes a second file for an
  existing slug.

### 5. Convergence: a bounded, one-shot-stamped title re-audit (the `audited_at` pattern)

The existing corpus converges through a new scheduled pass, `runTitleAuditJob`
(`src/title-audit.ts`, logic/deps split like every other job), modeled on the
normalization-decision-reaudit passes:

- **Stamp table** (migration `0044_title_audit.sql`): `title_audit(slug TEXT PRIMARY KEY,
  audited_at INTEGER NOT NULL, outcome TEXT NOT NULL /* 'kept' | 'cleaned' */, before_title TEXT,
  after_title TEXT)`. A **sibling** table keyed by slug (like `recipe_facets`/`recipe_derived`)
  because the `recipes` table is a replace-all projection and cannot carry a durable stamp.
  `before/after` is the audit trail. Access via `src/db.ts` helpers only.
- **Backlog** = projected slugs with no `title_audit` row (`SELECT slug, title FROM recipes WHERE
  slug NOT IN (SELECT slug FROM title_audit) ORDER BY slug LIMIT ?`). Recipes currently failing
  projection (in `reconcile_errors`) are naturally deferred until they index — correct: the audit
  must not touch a file that fails the contract.
- **Per recipe**: read the R2 file, run the title-clean judgment (one small `env.AI` call — the
  clean-title instruction with the title + a compact content excerpt as grounding), apply the
  Decision-2 guard. Guard-accepted and different → rewrite **only** `frontmatter.title` via the
  established `parseMarkdown` → mutate → `serializeMarkdown` round-trip (the `update_recipe`
  funnel), `validateFile`, `store.put`, stamp `outcome='cleaned'`. Same or guard-rejected → stamp
  `outcome='kept'` (a poison row can never loop: any *successful* model call resolves to a stamp).
  Only a transient infrastructure error (env.AI/D1/R2) leaves the row unstamped for the next tick.
- **Budget**: `TITLE_AUDIT_MAX_PER_TICK = 10` (a code constant, riding the internal `env.AI`
  budget like the alias audit; no external subrequests). Wired into `scheduled()` **phase 1**
  beside the other audit passes — deliberately before the phase-2 projection, so a rewrite is
  re-indexed the same tick.
- **Born-stamping**: both import paths (`create_recipe` and the sweep's `importRecipe`) stamp
  `title_audit` best-effort at create (`outcome='kept'` — their titles are clean at birth now).
  A failed born-stamp is harmless: the pass later re-checks a clean title and stamps `kept`.
- **Health**: writes `job_health`/`job_runs` as `title-audit` (summary: `{audited, cleaned, kept,
  remaining}`), added to `HEALTH_JOBS` — the `/health` endpoint and the admin Jobs/Health screens
  consume the registry generically, so **no admin-app change** ships with this.
- **Downstream refresh is organic, no extra wiring**: the recipe-derived describe pass's
  `content_hash` domain includes the title (`recipe-embeddings.ts`), so a rewritten title
  regenerates the description and then the embedding on the following phase-3 pass; the facet
  gate hash (`facetGateHash(body, overrides)`) does **not** include the title, so no spurious
  reclassification.

### 6. Slugs are immutable ids — the reference inventory

The re-audit never renames a slug or moves an R2 object, because the slug is the recipe's id and
is referenced (all soft joins, no FK cascade) by:

- **R2**: the object path itself, `recipes/<slug>.md`, plus `pairs_with` slug arrays in *other*
  recipes' frontmatter (a rename would orphan referrers and drop them from the index via the
  projection's dangling-`pairs_with` check);
- **D1, per-tenant**: `overlay (tenant, recipe)` — favorites/rejections; `cooking_log.recipe`;
  `meal_plan` slot recipes + `grocery_list.for_recipes` (JSON slug arrays, session state);
  `recipe_notes.recipe`;
- **D1, shared/derived**: `recipes.slug` (PK, rebuilt each tick), `recipe_derived.slug`,
  `recipe_facets.slug`, `discovery_matches.recipe` (new-for-me attribution),
  `discovery_log.slug`, `reconcile_errors.slug`, and this change's `title_audit.slug`;
- **Surfaces**: `/cookbook/<slug>` URLs and member-app recipe routes/links.

New imports get clean slugs going forward; the ~25 existing flowery slugs are permanent ids whose
display name (title) is what members actually see everywhere that matters (the index, the
cookbook, the app, menu proposals). Consistent with the recipe-import precedent, where slug
stability after the one-time naming pass was absolute.

### 7. Acceptance fixture (post-deploy verification, read-only)

Per the "observed defect rows become the acceptance fixture" discipline:

1. `SELECT title FROM recipes WHERE slug='a-better-beer-can-chicken'` → **"Beer Can Chicken"**
   (within ~2 hours of deploy; slug unchanged, `discovered_at`/attribution untouched).
2. `SELECT outcome, before_title, after_title FROM title_audit WHERE
   slug='a-better-beer-can-chicken'` → `cleaned` / "A Better Beer Can Chicken" / "Beer Can
   Chicken".
3. `SELECT COUNT(*) FROM title_audit` reaches 205 and `job_health['title-audit']` shows
   `remaining: 0` (quiesced); spot-check the Decision-0 spike table's other rows (e.g.
   `super-soft-and-tender-lemon-yogurt-loaf` → "Lemon Yogurt Loaf").
4. Negative checks: glossed foreign titles (`jatjuk-pine-nut-porridge`, `kkakdugi-…`) and
   identity-qualified titles (`vegan-meatballs`) stamped `kept`, text unchanged.
5. The next flowery **discovery import** (whenever one occurs) lands with a clean title and clean
   slug; until then the unit fixtures ("A Better Beer Can Chicken" → title "Beer Can Chicken",
   slug `beer-can-chicken`) cover the import leg.

## Risks / Trade-offs

- **Model under-cleaning** (leaves a flowery title): acceptable — `outcome='kept'` rows are
  auditable in `title_audit`, and a later change can re-open a backlog by policy if the miss rate
  matters. The corrective-retry loop is deliberately NOT extended to title quality (no validator
  clause), keeping the fail-open property.
- **Model over-cleaning within the guard** (drops an identity-bearing word — "Vegan Meatballs" →
  "Meatballs" passes the subset test): mitigated by explicit prompt instruction + a few-shot
  exemplar keeping an identity qualifier; residual risk is bounded to word *removal* and is
  visible in `title_audit.before/after` for operator review. Judged acceptable for a corpus this
  size; the alternative (a human-review queue) is disproportionate to ~25 rows.
- **Duplicate display titles** post-collision-suffix (two recipes both titled "Strawberry Icebox
  Cake" as `…` and `…-2`): the description/facets differentiate them everywhere titles are
  listed; semantic dedup makes true same-dish duplicates rare by construction.
- **Title churn on re-import parity**: the sweep's log rows keep the **raw** candidate title
  (provenance), so operator-facing discovery history still matches what the feed said; only the
  authored corpus gets the clean name.
- **Serialize round-trip on the re-audit rewrite** may normalize YAML formatting of untouched
  keys: same funnel `update_recipe` already uses on every edit — established, contract-validated
  (`validateFile` before `put`).

## Open questions

None — the production spike settled backlog size, fixture rows, and the discovery-source
breakdown; the mechanism/guard/slug decisions above are ratified direction made concrete.
