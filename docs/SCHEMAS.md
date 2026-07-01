---
update-when: a data file's schema or the validation rules change
---

# SCHEMAS.md — Data File Reference

Concrete schemas with example values for every data file in the repo. Keep this in sync with the actual files — when you add a field, update here first, then update the file. Validation runs in two places: the Worker's scheduled recipe-index reconcile (`src/recipe-projection.ts`, the full validator over the **R2 corpus**) and a *structural subset* in the Worker's `src/validate.ts` (at write time). The reconcile validates the authored recipe corpus; a recipe failing the contract is skipped and recorded in the D1 `reconcile_errors` table (below). The **D1-backed** per-tenant profile (preferences/taste/diet_principles/kitchen/staples/overlay/ready_to_eat/stockup), the **D1-backed** session state (the `pantry`/`meal_plan`/`grocery_list` tables), and the **D1-backed** `cooking_log` are validated **only by the Worker at write time** (`update_preferences`' merge-patch validation for preferences, `log_cooked` for the cooking log), never by the reconcile.

## File placement: shared vs per-tenant (multi-tenant data model)

The data lives in three tiers (see `ARCHITECTURE.md`): the authored markdown corpus in an **R2 bucket** (bound as `CORPUS`), all operational/relational + derived data in **D1**, and ephemeral infra in **KV**. Every artifact below lives in exactly one:

- **Authored markdown (R2 bucket `CORPUS`)** — the human-editable tier (an Obsidian vault synced to the same bucket): `recipes/*.md` (objective frontmatter + body) and the `guidance/**/*.md` umbrella (`guidance/ingredient_storage/` — curated put-away advice, read-only; `guidance/cooking_techniques/` — technique memories, agent-writable via `save_guidance`; `guidance/purchasing/` — buy-side selection advice, also agent-writable). Object keys are repo-relative paths (`recipes/<slug>.md`, `guidance/<domain>/<slug>.md`); read/written through `src/corpus-store.ts`. There is no GitHub App or data repo on the data path.
- **Shared corpus (D1, `migrations/d1/0006_shared_corpus.sql` + `0033_ingredient_identity.sql`)** — objective, single-source, read by everyone: the ingredient identity graph (`ingredient_identity`/`ingredient_alias`/`ingredient_edge` + the `novel_ingredient_terms` queue + `ingredient_normalization_log`), `sku_cache(ingredient, location_id, …)`, `flyer_terms(term)`, `stores(slug, name, domain, extra /*json*/)` (in-store-walk registry — identity columns `slug`/`name`/`domain` are top-level; optional identity fields `label`/`chain`/`address`/`location_id` are stored in the `extra` JSON column; layout lives in store notes), `feeds(url, …)` (RSS discovery feeds), `discovery_candidates(id, url UNIQUE, status, …)` (forwarded-newsletter inbox + group-wide rejection log; `status` values: `pending` | `rejected` — `pending` is the default for unprocessed candidates, `rejected` is set by `reject_discovery`), `discovery_senders`/`discovery_members` (inbound-email allowlist). Written + validated at the Worker write tools; read by query. The recipe index is the derived D1 `recipes` table — there is no `_indexes/recipes.json`.
- **Attributed records (D1 `recipe_notes` / `store_notes`)** — each member's attributed recipe/store notes, stored in D1 tables carrying `author` (the writing tenant, set by the Worker) + a `private` flag. Both tables use `id TEXT PRIMARY KEY` (a generated stable key); `recipe`/`slug` (the recipe or store slug), `author`, `body`, `tags`, `private`, and `created_at` are ordinary columns (not the primary key). `read_recipe_notes` returns own-private + group-shared in one query, joined with the overlay favorites.
- **Per-tenant D1 (the profile)** — each member's grocery **profile** lives in normalized D1 tables (`migrations/d1/0004_profile.sql`): a singleton `profile` row (the markdown fields `taste`/`diet_principles`, the preference scalars `default_cooking_nights`/`planning_cadence_days`/`lunch_strategy`/`ready_to_eat_default_action`, the JSON columns `stores`/`dietary`/`rotation`/`custom`/`kitchen_notes`, `freezer_capacity_estimate`, and `last_planned_at` — the per-tenant planning watermark, migration 0016, stamped by `update_meal_plan` on an add and read by `list_new_for_me`), plus child tables `brand_prefs(tenant, term, ranks)`, `kitchen_equipment(tenant, slug)`, `staples(tenant, name, normalized_name, perishable)`, `overlay(tenant, recipe, favorite, reject)` (the two mutually-exclusive disposition marks; there is no `status` lifecycle or `rating` column), `ready_to_eat(tenant, slug, meal, name, favorite, reject, category, source, brand, notes)`, and `stockup(tenant, name, normalized_name, unit, typical_purchase, notes, baseline_price, buy_at_or_below)`. `idx_overlay_recipe` powers the cross-tenant group-favorites query. Reads assemble the agent-facing objects from these rows (`src/profile-db.ts`); writes mutate rows — no document format on the profile path.
- **Per-tenant D1 (session state)** — each member's working state lives in D1 row tables (`migrations/d1/0005_session_state.sql`): `pantry(tenant, name, normalized_name, quantity, category, prepared_from, added_at, last_verified_at, notes)`, `meal_plan(tenant, recipe, planned_for, sides /*json*/, from_vibe /*night-vibe slot provenance, migration 0026; advisory, never slug-resolved*/)`, `grocery_list(tenant, name, normalized_name, quantity, kind, domain, status, source, for_recipes /*json*/, note, added_at, ordered_at)` — keyed by normalized name (pantry/grocery) or recipe slug (meal plan), with `idx_grocery_status(tenant, status)` and `idx_pantry_category(tenant, category)` backing the read filters. Adds are row upserts (`INSERT … ON CONFLICT DO UPDATE`), removes/status changes are targeted row statements — no whole-array rewrite, strong read-after-write consistency. (The detailed item shapes are below.) The Worker read path has **no** GitHub/KV fallback — a miss returns empty/null.
- **Shared operational D1 (reconcile + bug reports + discovery log)** — group-wide (not per-tenant) operational tables the Worker owns: `reconcile_errors(slug, path, message, recorded_at)` (`migrations/d1/0014_reconcile_errors.sql`) — recipes the index reconcile **skipped**, replaced wholesale each pass; `bug_reports(id, reporter, title, body, created_at, status)` (`migrations/d1/0015_bug_reports.sql`) — agent-filed bug reports, `reporter`/`created_at` attributed server-side; and `discovery_log(id, url, title, source, outcome, slug, detail, created_at)` (`migrations/d1/0016_background_discovery.sql`) — the discovery sweep's per-candidate outcome log, one table serving three roles (operator audit, intake dedup, parked-error surface), retention-pruned. (The detailed shapes are below.)
- **Sweep-/reconcile-owned per-member D1 (discovery sweep)** — group-wide *attribution + taste* tables the discovery sweep owns (`migrations/d1/0016_background_discovery.sql`): `discovery_matches(recipe, tenant, score, matched_at)` — per-member match attribution (the import gate **and** the `list_new_for_me` filter); and `taste_derived(tenant, taste_hash, embedding, updated_at)` — each member's taste-text embedding, content-hash gated like `recipe_derived`. Like `recipe_derived`, these are **siblings of `recipes`** so the index projection's wholesale `recipes` rebuild never owns them. (The detailed shapes are below.)

**Three-category recipe model:** a recipe's *content* (objective frontmatter + body) is shared markdown in the R2 corpus; its *overlay* (`favorite` + `reject`) is per-tenant in the D1 `overlay` table; its *notes* are per-tenant, attributed, append-mostly in the D1 `recipe_notes` table (`id TEXT PRIMARY KEY`, `recipe`, `author`, `body`, `tags`, `private`, `created_at`). `last_cooked` is **not stored** — it's derived per-tenant from the D1 `cooking_log` table (`MAX(date)` per recipe). Read tools merge shared content + the caller's overlay + cooking-log `last_cooked` at read time.

The shared corpus, profile, session state, cooking log, and attributed notes are all **D1 tables** (see the placement list above and `migrations/d1/*.sql`), not repo files. Per-artifact sections below document each artifact's current D1 column shape.

### preferences shape + merge-patch contract

`preferences` is reconstructed from the `profile` row + `brand_prefs` rows into a defined top-level surface plus an open `custom` bag:

```jsonc
{
  "default_cooking_nights": 3,                 // number — cooking nights WITHIN the planning window
  "planning_cadence_days": 7,                  // number — how far out the caller plans/shops (days); drives propose_meal_plan's weather horizon + vibe-recurrence caps
  "lunch_strategy": "leftovers",               // "leftovers" | "buy" | "mixed"
  "ready_to_eat_default_action": "opt-in",     // "opt-in" | "auto-add"
  "stores":  { "primary": "kroger", "preferred_location": "Kroger - 76104", "location_zip": "76104" },
  "brands":  { "olive_oil": ["California Olive Ranch"], "yellow_onion": [] },
  "dietary": { "avoid": [], "limit": ["cilantro"] },
  "custom":  { /* arbitrary agent-added keys */ }
}
```

`update_preferences` takes a `patch` and applies **JSON Merge Patch (RFC 7396)**: a present key sets, `null` deletes, nested objects merge to any depth, arrays replace wholesale. Validation is staged — an unknown top-level patch key is rejected toward `custom` (`validation_failed`), then the merged result's types are validated (`malformed_data` on a bad enum/shape, storing nothing). The whole patch applies in one D1 transaction. The `brands` tri-state maps onto rows: a list value UPSERTs a `brand_prefs` row, `[]` is "don't-care/cheapest", `null` DELETEs the row (back to ambiguous = "ask me"); an absent term leaves its row untouched.

## Recipe frontmatter (recipes/*.md)

YAML frontmatter at the top of each recipe markdown file. Body below is freeform markdown.

```yaml
---
title: Lemon Garlic Roasted Chicken
tags: [chicken, mediterranean, sheet-pan, weeknight]
protein: chicken                # controlled vocab: chicken | beef | pork | lamb | turkey | fish | shellfish | egg | tofu | vegetarian | vegan | mixed
cuisine: mediterranean          # controlled vocab (coarse buckets); see the cuisine list below
course: [main]                  # OPEN-vocab dish type (main | side | dessert | breakfast | …); string or array; classified at import; index-normalized to a lowercased array
# description — NOT a frontmatter field: it is AI-generated from the facets and stored in D1 (recipe_derived); see below
side_search_terms: ["a crisp acidic green salad", "a simple roasted vegetable"]  # mains only; AI-memoized semantic side-retrieval query (meal-plan retrieval)
style: sheet-pan                # sheet-pan | one-pot | grill | braise | stir-fry | etc.
time_total: 50                  # minutes, integer
time_active: 15                 # minutes, integer
servings: 4
difficulty: easy                # easy | medium | hard
dietary: [gluten-free, dairy-free]    # array; can be empty
season: [spring, summer]              # controlled vocab (SEASON_VOCAB in src/vocab.js): spring | summer | fall | winter; [] = year-round. Off-vocab rejected at write+build (like protein/cuisine); read-normalized (case-fold, autumn≡fall) for legacy data
veg_forward: false              # boolean
# --- The next three are per-tenant, not shared-content fields ---
# last_cooked  → derived from each member's D1 cooking_log table (not stored here or in the index)
# favorite     → per-tenant D1 overlay table (tenant, recipe, favorite)
# reject       → per-tenant D1 overlay table (hard gate; absent row = neutral/available)
discovered_at: null             # ISO date (YYYY-MM-DD); set for discovery imports — a QUERYABLE recipes column (below), written by the projection from this frontmatter
discovery_source: null          # string; set for discovery imports (e.g. "discovery-sweep", "serious-eats")
ingredients_key: [chicken thighs, lemon, garlic, oregano, potatoes]
meal_preppable: true            # boolean; good freezer/batch candidate
pairs_with: []                  # array of recipe slugs; plate-companion sides (a PLATING edge)
perishable_ingredients: [cilantro, lemon]  # normalized array; derived at import (the recipe's waste-prone items)
requires_equipment: []          # array of EQUIPMENT_VOCAB slugs; ONLY truly-irreplaceable gear (defaults empty)
source: https://www.seriouseats.com/lemon-garlic-roasted-chicken
---

[recipe instructions in markdown]
```

**Notes:**
- **The descriptive facets are DERIVED on the cron, not authored.** `protein`, `cuisine`, `course`, `season`, `tags`, `ingredients_key`, `perishable_ingredients`, `side_search_terms`, and `meal_preppable` are classified from the body by the **classify pass** (`recipe-facet-derivation`) into the D1 `recipe_facets` table and **merged into `recipes`** by the projection. They are **optional in frontmatter**: absent → the classifier supplies them; present → an authored **override** (Tier B: `protein`/`cuisine`/`course`/`season`/`tags`, vocab-validated, wins over the classifier; `tags` is unioned) or a pre-migration legacy value (Tier A: the rest, classified-wins). The YAML example above shows them for illustration — a new recipe may omit them all (body-only). See *recipe_facets* below.
- **Required-field contract (authored gates + identity).** The contract governs only the **authored** fields — the two hard gates plus identity. It is defined once in `src/recipe-contract.js` (`validateRecipeContract`), imported by the Worker write-time validator (`src/validate.ts`), the index reconcile (`src/recipe-projection.ts`), and the classifier (`src/discovery-classify.ts`); a **hard failure** at write time and a **skip-and-record** at reconcile time. **One function serves both callers:** AUTHORED frontmatter omits the derived keys (relaxed); the CLASSIFIER's output sets every key (fully validated against vocab + the `course`→`side_search_terms` rule), so the classifier's backstop is preserved.
  - **Required (authored), non-empty:** `title`.
  - **Required (authored), value or explicit `null`:** `time_total` (number or `null`), `source` (URL string or `null`).
  - **Required (authored), may be `[]`:** `dietary`, `pairs_with`, `requires_equipment` (an `EQUIPMENT_VOCAB` array). `dietary` + `requires_equipment` are the **hard gates** kept authored — a wrong AI value risks allergen exposure / silently hiding a makeable recipe.
  - **Optional (derived), validated when present:** Tier B `protein`/`cuisine` (vocab value or `null`), `course` (non-empty array), `season` (`SEASON_VOCAB` array), `tags`; Tier A `ingredients_key` (non-empty array), `perishable_ingredients`, `side_search_terms` (non-empty iff `course` includes `main`), `meal_preppable` (boolean). `description` is likewise not authored (see *recipe_derived*).

  Other fields are **free-form** and pass into `extra` unchecked (`veg_forward`, `difficulty`, `style`, `servings`, `time_active`, `discovery_source`). (`discovered_at` is free-form but the projection promotes it to its own queryable `recipes.discovered_at` column.) A compliant **body-only** skeleton:

  ```yaml
  title: …
  source: null            # URL or null
  time_total: null        # number or null
  dietary: []             # hard gate — author it
  requires_equipment: []  # hard gate — author it
  pairs_with: []
  ```
- `favorite`, `reject`, and `last_cooked` are **per-tenant**, not shared content — `favorite`/`reject` live in each member's D1 `overlay` table; `last_cooked` is derived from the D1 `cooking_log` table. The shared D1 `recipes` table carries objective fields only. A shared recipe's frontmatter SHOULD NOT carry them; the reconcile strips them. (`status`/`rating` are likewise *tolerated and ignored*, not forbidden — a lingering value is stripped from the shared index, never validated; `create_recipe` stamps no `status`.) `update_recipe` is objective-only and rejects a `favorite`/`reject` edit toward `toggle_favorite` / `toggle_reject`, which write the caller's D1 overlay row.
- Disposition is **per-tenant and opt-out**: a recipe with no overlay row is **available** to that member by default. A member's feedback either favorites it (`toggle_favorite`) or hides it (`toggle_reject` → a hard gate that drops it from their `search_recipes` results) — the two are mutually exclusive, and one member's disposition never changes another's. There is no `active`/`draft` lifecycle and no per-member curated set.
- `pairs_with`: slugs of other recipes, **required (may be `[]`)**. A *plating* edge — recipes eaten together on one plate (a main's companion **corpus** sides). Each slug MUST resolve to a real recipe (a reconcile skip-and-record otherwise — the dangling-`pairs_with` cross-corpus check); corpus sides are themselves recipes, so they reuse the normal import/grocery-list pipeline. Objective **shared content** (carried in the D1 `recipes` table, written by `update_recipe`) — not a per-tenant overlay field. **Primarily authored by the `recipe-sides` flow** — the standalone "sides for X" flow records the edge when a corpus side is confirmed for a corpus main; the **meal-plan** flow only **backfills** it opportunistically, for a pairing it confirms while composing a menu (both filter side candidates with `course: side`). **Open-world sides** — trivial preparations with no recipe file — are not recorded here (no slug to remember) and ride on the main's meal-plan row instead (the D1 `meal_plan` table's `sides` JSON column).
- `course`: **required, non-empty** — an **open-vocabulary** classification of what kind of dish the recipe is — one or more of `main`, `side`, `dessert`, `breakfast` by convention, but **any** string is allowed (e.g. `sauce`, `baked_good`) with **no controlled set and no code change** to extend it (contrast `protein`/`cuisine`, which ARE controlled). Authored as a string or an array of strings; the projection **normalizes** it to a lowercased, trimmed **array** (so `Main` → `["main"]`). A recipe that plates as more than one course carries multiple values (`course: [main, side]`). An absent or empty `course`, or a non-string/array value, is a Worker write-time / reconcile **hard failure** (rejected on write, skip-and-recorded by the reconcile); the *values* are never checked against a set. Objective **shared content** carried in the D1 `recipes` table, classified at import by `create_recipe` (and editable via `update_recipe`); `search_recipes` filters it by **containment**. (`standalone` is **not** a contract field — whether a main is an already-rounded plate is inferred by the agent at plan time, not persisted; a lingering `standalone` field is ignored, never validated or indexed.)
- `perishable_ingredients`: **required array (may be `[]`)** — a **normalized** list of the recipe's perishable ingredients, feeding the menu-gen waste callout (a partial-unit perishable that no other proposed recipe uses). **Derived at import, not hand-maintained:** the import/create flow classifies it alongside `protein`/`cuisine`. The classification test is *"would the leftover rot before I'd realistically use it?"* — not botany — so shelf-stable staples (olive oil, canned beans) are excluded and a small amount of a fast-spoiling item is included; fuzzy edges (eggs, potatoes) are fine since a wrong call only costs a dismissed nudge. Names use the **same normalization the pantry-verify matcher applies** (`normalizeIngredient`), applied at write time by `create_recipe`/`update_recipe`, so a perishable lines up across recipes for overlap detection. Present-but-not-a-string-array is a write-time / reconcile hard-failure (like a non-boolean `standalone`). Objective **shared content** carried in the D1 `recipes` table — not a per-tenant overlay field, not curated config. Hand-edit only to correct a misclassification.
- `description`: **Worker-derived (not authored frontmatter)** — a **brief AI-written summary** of the dish (~1–2 sentences) in a consistent, craving-aligned register (identity, flavor/texture, when you'd want it) — **not** the scraped marketing copy. It is the single semantic-identity field that powers meal-plan retrieval: the source the recipe **embedding** is derived from, the compact per-candidate row loaded into context, the user-facing "why this dish," and the dedup signal. It is **Worker-DERIVED, not authored**: generated from the recipe's facets (`env.AI`) and stored in D1 (`recipe_derived`, alongside the embedding it feeds), reconciled on the cron and seeded synchronously at import — see ARCHITECTURE and *recipe_derived* below. It is **not** a frontmatter field and **not** in the required-field contract; `read_recipe`/`search_recipes` merge it at read time (absent until the reconcile first generates it).
- `side_search_terms`: **required** — an array of AI-memoized phrases describing the *kind of side that complements this main* ("a crisp acidic green salad", "crusty bread for the sauce"), **non-empty when `course` includes `main`** and `[]` otherwise. Written at import; used as the **semantic side-retrieval query** so the complementarity judgment is captured once and the retrieval is plain similarity (the terms describe the side you want, not the main). Additive — does **not** replace curated `pairs_with` (the deterministic, slug-resolved pairing). Validated at Worker write time and by the reconcile. Objective **shared content**.
- `protein` and `cuisine` are **controlled vocabularies** (coarse buckets — `fish` not `salmon`) so variety reasoning is reliable. Both are **required-present** (the contract above), carrying either an in-vocabulary value or the explicit literal `null`. A value **present** but outside its set is a hard failure **at both write time (the Worker, `src/validate.ts`) and reconcile time (`src/recipe-projection.ts`, skip-and-record)** — `create_recipe`/`update_recipe` reject an off-vocab value with `validation_failed` and write nothing, so it never reaches the corpus. A dish with **no protein focus** — a side, a plain noodle/grain dish, a condiment — carries **`protein: null`** (present and explicit); an omitted field or a `none`/`""` value is rejected, prompting `null`. The allowed sets are defined **once** in the shared `src/vocab.js`, imported by both validators so they cannot drift; extending a vocabulary is a deliberate edit there. Current cuisine set: `american, brazilian, cajun, caribbean, chinese, cuban, filipino, french, german, greek, indian, italian, japanese, korean, mediterranean, mexican, moroccan, peruvian, southwestern, spanish, thai, vietnamese`.
- `requires_equipment`: **required array (may be `[]`)** of `EQUIPMENT_VOCAB` slugs naming gear a dish is genuinely **impossible** without — the "no recipe-preserving workaround exists" test. **`[]` is the overwhelming common case**; tag only truly-irreplaceable equipment, since a wrong tag silently hides a makeable recipe. A controlled vocabulary like `protein`/`cuisine` (an off-vocab slug = hard failure **at both write time and reconcile time**, from the same shared `src/vocab.js`). Objective **shared content** carried in the D1 `recipes` table, written by `create_recipe`/`update_recipe`. Drives the `search_recipes` makeability gate against a member's kitchen `owned` list (the D1 `kitchen_equipment` rows). Current set: `pressure-cooker, sous-vide-circulator, blender, ice-cream-maker`.
- `season`: **required array (may be `[]`)** of `SEASON_VOCAB` tokens — a **controlled vocabulary** like `protein`/`cuisine`/`requires_equipment`, validated at **both write and reconcile time** from the shared `src/vocab.js` (an off-vocab token is a hard failure; `autumn` is rejected in favor of `fall`). `[]` means **year-round**. Drives the retrospective's in-season `underused` surfacing (a non-empty `season` not including the current Northern-hemisphere season is treated as out of season). Read paths normalize legacy values (case-fold + `autumn`→`fall`) so a pre-enforcement value still matches on read; a non-canonical *stored* value must be corrected to the vocabulary before it is re-written or re-projected under the gate. Current set: `spring, summer, fall, winter`.
- `ingredients_key`: **required, non-empty** — the top 5–7 defining ingredients for filtering and the pantry-overlap re-rank. Full ingredient list lives in the body. **Normalized through the alias table on write** (`create_recipe`/`update_recipe`, same matcher as `perishable_ingredients`) so names line up across recipes.
- **The recipe index is the D1 `recipes` table — not a file.** The Worker's scheduled **reconcile** (`src/recipe-projection.ts`) reads the whole R2 corpus, validates every `recipes/*.md` object, then **projects** the shared objective set into the D1 `recipes` table, replacing it wholesale in one transaction (`DELETE` then batched `INSERT`) so a removed recipe loses its row and the table is a deterministic function of the R2 corpus. A recipe that fails validation is **skipped** (left out of the index) and recorded to the D1 `reconcile_errors` table. There is **no** `_indexes/recipes.json`. The Worker reads the index from D1 (`src/recipe-index.ts`, built on `src/db.ts`). A *provisioned-but-empty* table is a valid empty corpus (a vibe-less `search_recipes` spec returns `{ results: [{ label, recipes: [] }] }`); an *unreadable* table (D1 unreachable / unmigrated) surfaces as `index_unavailable`. A fresh database is populated by the first reconcile pass over the R2 corpus (the bootstrap guarantee).

  The `recipes` table holds **objective shared content only** (no per-tenant `favorite`/`reject`/`last_cooked`): scalar columns `slug` (PK), `title`, `protein`, `cuisine`, `time_total`, `discovered_at` (the recipe's `discovered_at` frontmatter, `YYYY-MM-DD`; null when not a dated import), `ingredients_key` (a JSON array as TEXT), `source_url` (the recipe's `source` frontmatter); JSON-array columns `tags`, `course`, `season`, `dietary`, `pairs_with`, `perishable_ingredients`, `requires_equipment`; and an `extra` JSON object carrying any other objective frontmatter (so a new field is lossless without a migration until promoted to a queryable column). `idx_recipes_source_url` makes the discovery idempotency check an indexed lookup, and `idx_recipes_discovered_at` makes `list_new_for_me`'s `WHERE discovered_at > <watermark>` an indexed range scan. `discovered_at` is **promoted out of `extra` to its own column** (migration 0016) precisely so the new-for-me read can filter on it; the projection writes it from each recipe's frontmatter. Schema: `migrations/d1/0002_recipes.sql` (+ `0016_background_discovery.sql` for `discovered_at`).

### Recipe body structural contract

The markdown body below the frontmatter is freeform, with one **hard requirement**: it MUST contain both an `## Ingredients` H2 section and an `## Instructions` H2 section (exact labels, ATX `##` headings). The index reconcile (`src/recipe-projection.ts`) skips a recipe missing either section and records it (with the missing section named) in `reconcile_errors`.

- **Ingredients** is conventionally a `-` bullet list; **Instructions** a numbered list. The Worker cookbook renders the recipe body (markdown → HTML) as-is.
- Additional H2 sections (e.g. `## Notes`) are permitted and render generically — no validator or generator change is needed to add one.
- The contract exists so the reconcile can require the sections and the Worker cookbook (`src/cookbook.ts`) can reliably locate the ingredient list and the step list without guessing.

## recipe_derived (D1 `recipe_derived` table — Worker-derived)

The reconcile-owned home of each recipe's **derived** fields (migration 0013). Not authored, not frontmatter, not projected by the index reconcile — written only by the scheduled **derived** reconcile (`src/recipe-embeddings.ts`) and the import-time seed (`create_recipe`). Keyed by `slug`; the index reconcile's wholesale `recipes` rebuild (`src/recipe-projection.ts`) never touches it (different producer + cadence — the reason it is a sibling table).

- `slug` — recipe id (PK).
- `description` — the AI-generated ~1–2 sentence craving-aligned summary (identity, flavor/texture, when you'd want it). The embed source, the compact candidate row, and the user-facing "why this dish." Generated from the recipe's authored **facets** (title, ingredients_key, course, protein, cuisine, time_total, dietary, season) via `env.AI`; `read_recipe`/`search_recipes` merge it at read time (null until first generated).
- `content_hash` — change-detection hash of those authored facets. The describe pass regenerates the description only when it differs (or is null), so a steady corpus does ~no work.
- `embedding` — JSON array of 768 floats (`@cf/baai/bge-base-en-v1.5`) as TEXT; null until the embed pass fills it.
- `description_hash` — hash of the description the vector was built from; gates re-embed.

## recipe_facets (D1 `recipe_facets` table — Worker-derived)

The **classify pass**'s home for each recipe's **derived descriptive facets** (migration 0018, `recipe-facet-derivation`). Not authored, not frontmatter — written only by the scheduled classify pass (`src/recipe-classify.ts`) and the import-time seed (`create_recipe` → `seedRecipeFacets`). Keyed by `slug`; a **sibling of `recipes`** (like `recipe_derived`/`taste_derived`), so the index projection's wholesale `recipes` rebuild never touches it. The projection **reads** it and writes the **effective** facet (`mergeEffectiveFacets`) into `recipes`, so every reader is unchanged. Holds the classifier's **raw** output; the authored-override merge happens in the projection, not here.

- `slug` — recipe id (PK).
- `body_hash` — change-detection hash over the recipe **body + the authored Tier-B overrides** the classifier conditions on. The classify pass reclassifies only when it differs (or is null), so a steady corpus does ~0 work, and an override edit re-triggers. NULL until first classified.
- `protein`, `cuisine` — the classified coarse bucket (TEXT) or NULL. **Tier B** (an authored frontmatter value overrides at merge).
- `course`, `season`, `tags` — classified JSON-array columns. **Tier B**.
- `ingredients_key`, `perishable_ingredients`, `side_search_terms` — classified JSON-array columns, alias-normalized for the first two. **Tier A** (derived-only; an authored value is a pre-migration legacy fallback).
- `meal_preppable` — classified boolean (0/1), NULL until classified. **Tier A**; currently has no consumer (rides `recipes.extra`).

**Effective-facet merge** (the projection, `src/recipe-facets.ts`): Tier A → classified (authored legacy only as fallback); Tier B → `authored ?? classified`; `tags` → `authored ∪ classified`; Tier C (`dietary`, `requires_equipment`, `time_total`, `pairs_with`) → authored, untouched. A not-yet-classified recipe projects its derived facets as empty (not an error).

## taste_derived (per-member, D1 `taste_derived` table — Worker-derived)

Each member's **taste-text embedding** — the cold-start/taste signal the **discovery sweep**'s matcher scores a candidate against (alongside the member's favorited-recipe vectors). Derived from the member's authored `profile.taste` text via `env.AI` and **content-hash gated**, mirroring `recipe_derived`'s description/embedding gate exactly: it regenerates only when the taste text changes, so a steady profile does ~no work. Refreshed at the **start of each discovery-sweep tick** (a small reconcile pass, `src/taste-vector.ts`) and pruned for a member who clears their taste text or leaves the group. A NULL/absent vector means the member is matched on **favorites alone** (or the cold-start fallback). Keyed by `tenant`. Migration 0016.

```sql
-- D1 taste_derived table — one row per member. PRIMARY KEY (tenant).
tenant     TEXT  -- owning member
taste_hash TEXT  -- hash of the profile.taste text the vector was built from (the regeneration gate)
embedding  TEXT  -- JSON array of EMBED_DIM floats as TEXT; NULL until first derived
updated_at TEXT  -- ISO timestamp of the last (re)embed
```

## night_vibes (per-tenant, D1 `night_vibes` + `night_vibe_derived` tables)

Each member's **night-vibe palette** — the durable, editable "shape of a week" `propose_meal_plan` samples (night-vibe-palette capability, migration 0025). A night vibe is a saved `search_recipes` spec (a `vibe` phrase + optional `facets`) plus lifecycle metadata. Per-tenant PRIVATE profile data (siblings of `staples`/`stockup`), never shared; written by the `add_/update_/remove_night_vibe` tools (`src/night-vibe-db.ts`). The per-vibe embedding lives in the sibling `night_vibe_derived`, hash-gated on the vibe text and reconciled Worker-side (`src/night-vibe-vector.ts`, the `night-vibe-embed` job) exactly like `taste_derived`.

`weather_affinity` is discrete **bucket membership** (`weather-bucket-planning`), not a graded score: `src/night-vibe-schedule.ts`'s `resolveBucketMembership` reads each stored string through the same tag→category map a forecast day resolves through (`src/weather.ts`'s `deriveCategory`), so a row can store either the new category names (`grill | cold-comfort | wet`) or the legacy `deriveVibes` tags (`soup | comfort | grill-friendly | light | no-grill`) and both resolve to the same bucket set — zero data migration. An empty/absent/all-unrecognized array is **bucketless** (a universal filler, eligible for every category's slot quota). `weather_antipathy` is retained on the row for back-compat but is **not consulted** by `propose_meal_plan`'s quota allocation (the hard category exclusion replaces graded penalties).

```sql
-- D1 night_vibes table — PRIMARY KEY (tenant, id).
tenant            TEXT     -- owning member
id                TEXT     -- stable per-tenant vibe id (slug)
vibe              TEXT     -- the craving/query phrase (the slot's retrieval query)
facets            TEXT     -- JSON object: optional hard-gate search facets (NULL = none)
cadence_days      INTEGER  -- target period; NULL = no cadence pressure (occasional/weighted)
pinned            INTEGER  -- 1 = sticky weekly intent (placed when due, exempt from the weather reserve)
base_weight       REAL     -- base sampling weight before debt (NULL → 1)
weather_affinity  TEXT     -- JSON string[]: discrete bucket membership (grill|cold-comfort|wet, or a
                            -- back-compat legacy meal_vibes tag resolving to the same buckets); NULL/[] = bucketless
weather_antipathy TEXT     -- JSON string[]: retained for back-compat; NOT consulted by quota allocation (NULL = [])
season            TEXT     -- JSON string[]: seasonal lean (NULL = [])
created_at        TEXT
updated_at        TEXT

-- D1 night_vibe_derived table — PRIMARY KEY (tenant, id). Worker-derived (hash-gated).
tenant     TEXT
id         TEXT
vibe_hash  TEXT  -- hash of the vibe text the vector was built from (the regeneration gate)
embedding  TEXT  -- JSON array of EMBED_DIM floats; NULL until first derived (→ "not yet indexed")
updated_at TEXT
```

## pending_proposals (per-tenant, D1 `pending_proposals` table)

The **profile-reconciliation** queue (migration 0027, `profile-reconciliation` capability): proposed profile edits that reconcile a member's **stated** palette against their **revealed** cooking behavior. Written by the deterministic `reconcile-signals` cron (`src/reconcile-signals.ts`, producer `signal-cron`) and, optionally, by the operator via `reconcile_enqueue_proposal` (producer `operator`); read/resolved by the member via `list_proposals`/`confirm_proposal` (`src/reconcile-db.ts`). `id` is a **stable hash of `(tenant, kind, target)`** so re-drafting is an idempotent `INSERT OR IGNORE` and a rejected proposal is never re-surfaced.

```sql
-- D1 pending_proposals table. PRIMARY KEY (id). idx_pending_proposals_tenant_status on (tenant, status).
id          TEXT  -- stable hash(tenant|kind|target) — dedup + no-re-propose
tenant      TEXT  -- the member the proposal is for
kind        TEXT  -- add_vibe | adjust_cadence | prune_vibe
target      TEXT  -- the vibe id the proposal acts on
payload     TEXT  -- JSON: the proposed profile diff (applied verbatim on accept)
rationale   TEXT  -- human-readable "why"
evidence    TEXT  -- JSON: the signals that triggered it
status      TEXT  -- pending | accepted | rejected
producer    TEXT  -- signal-cron | edge | operator
created_at  TEXT
resolved_at TEXT  -- when accepted/rejected
```

## overlay (per-tenant, D1 `overlay` table)

Each member's **subjective view** of shared recipes — the overlay merged onto shared content at read time. Keyed by recipe slug. Holds **only** the two mutually-exclusive disposition marks `favorite` (loved) and `reject` (hidden-from-me). Visibility is **opt-out**: an absent row means **neutral (available)** — `favorite: false`, `reject: false`. `last_cooked` is **not** here — it's derived from this member's D1 `cooking_log` table. Stored as rows in the D1 `overlay(tenant, recipe, favorite, reject)` table. There is no `status` lifecycle and no `rating` column. Agent-writable via `toggle_favorite` (favorite) and `toggle_reject` (reject).

```sql
-- D1 overlay table — one row per (tenant, recipe). PRIMARY KEY (tenant, recipe).
-- idx_overlay_recipe on (recipe) backs the group-favorites query.
-- An absent row → neutral (favorite false, reject false). A row exists IFF favorited or rejected.
-- last_cooked is NOT here — it is derived from cooking_log.
tenant   TEXT  -- owning user
recipe   TEXT  -- recipe slug
favorite INTEGER  -- 1 = favorited; NULL = not set
reject   INTEGER  -- 1 = hidden-from-me; NULL = not set
```

Example rows:

| tenant | recipe | favorite | reject |
|--------|--------|----------|--------|
| alice | lemon-garlic-roasted-chicken | 1 | NULL |
| alice | miso-glazed-salmon | NULL | 1 |

**Notes:**
- A row carries `favorite` (`1` = favorited) **or** `reject` (`1` = hidden) — never both (the two are **mutually exclusive**; setting one clears the other). NULL/absent = not set. An empty row is dropped (the slug falls back to neutral/available); clearing a flag with nothing else set DELETEs the row, so there are no lingering `favorite: 0` / `reject: 0` rows.
- Disposition is **per-tenant**: one member's `reject` hides the recipe from them alone, and a favorite is one member's alone. `reject` is a **hard gate** — a rejected recipe is excluded from that member's `search_recipes` results entirely.
- The group-favorites aggregate (`read_recipe_notes`) is a single indexed query (`SELECT tenant, favorite FROM overlay WHERE recipe=?`) scoped to the caller's group, not a per-tenant scan.

## recipe_notes (per-tenant, D1 `recipe_notes` table)

A member's **attributed notes** on one recipe (shared or personal) — the spin-capture mechanism. Stored in the D1 `recipe_notes` table (`id TEXT PRIMARY KEY`); columns: `recipe` (slug), `author` (the writing tenant, set by the Worker), `body`, `tags`, `private`, `created_at`. Append-mostly. Adding a note never modifies shared content; an author MAY edit or delete their **own** notes (`update_recipe_note` / `remove_recipe_note`, addressed by `created_at`, self-scoped) but never another tenant's.

```sql
-- D1 recipe_notes table — one row per note, across all tenants
id          TEXT PRIMARY KEY   -- generated stable key
recipe      TEXT               -- recipe slug
author      TEXT               -- writing tenant (set by the Worker)
body        TEXT               -- required; rows with no body are dropped on read
tags        TEXT               -- JSON array, e.g. ["tweak", "observation"]; default []
private     INTEGER            -- 1 = owner-only; default 0
created_at  TEXT               -- ISO timestamp (required; addressable key for edit/delete)
```

Example rows:

| id | recipe | author | body | tags | private | created_at |
|----|--------|--------|------|------|---------|------------|
| rn_abc | miso-glazed-salmon | alice | Subbed gochujang for the sriracha — better. | ["tweak"] | 0 | 2026-06-09T18:30:00.000Z |
| rn_def | miso-glazed-salmon | alice | Didn't love it cold the next day. | [] | 1 | 2026-06-10T01:05:00.000Z |

**Notes:**
- `body` (required), `created_at` (required), `tags` (optional, default `[]`), `private` (optional, default `false`). A note with no `body` is dropped on read.
- `read_recipe_notes(slug)` aggregates **non-private** notes from every member (attributed) plus the **caller's own** private notes; another member's `private` note is never surfaced. Group favorites (a single indexed query over the D1 `overlay` table, scoped to the group) ride the same read. `created_at` is the addressable key for `update_recipe_note` / `remove_recipe_note`.

## pantry (per-tenant, D1 session state)

Live inventory. Agent-writable. Updated as side effect of menu generation and ad-hoc messages. Stored as rows in the D1 `pantry` table (`PRIMARY KEY (tenant, normalized_name)`; `idx_pantry_category(tenant, category)` backs the `read_pantry` category filter). `notes` is an optional short freeform string. Adds are `INSERT … ON CONFLICT DO UPDATE` (keep `added_at`, refresh `last_verified_at`, overlay the rest); reads/writes are row-level and strongly consistent. Pantry has no `kind`/`domain` — it's kitchen inventory, food by construction — so `normalized_name` is always the canonical ingredient id resolved through the `IngredientContext` funnel (`resolve(name)`: normalize **and** capture), the same key `sku_cache` and recipe `ingredients_key` use, so a pantry "chicken breast" and a grocery/menu need for "2 lb chicken breast" join on the same id. The schema below describes each item object's shape:

```sql
-- D1 pantry table — one row per item. PRIMARY KEY (tenant, normalized_name).
-- idx_pantry_category on (tenant, category).
tenant           TEXT  -- owning user
name             TEXT  -- display name (e.g. "olive oil")
normalized_name  TEXT  -- canonical ingredient id via the IngredientContext funnel (resolve)
quantity         TEXT  -- full | partial | low | "<count>" for countables
category         TEXT  -- pantry | fridge | freezer | spices
prepared_from    TEXT  -- recipe slug if this is cooked/prepared from a recipe; else NULL
added_at         TEXT  -- ISO date when first added
last_verified_at TEXT  -- ISO date; resets when user confirms item is still present
notes            TEXT  -- optional short freeform note
```

Example rows:

| tenant | name | normalized_name | quantity | category | prepared_from | added_at | last_verified_at | notes |
|--------|------|-----------------|----------|----------|---------------|----------|------------------|-------|
| alice | olive oil | olive oil | partial | pantry | NULL | 2025-04-01 | 2025-05-12 | NULL |
| alice | ground beef | ground beef | 3 lb | freezer | NULL | 2025-05-10 | 2025-05-10 | freezer burned, best for stocks or stews |
| alice | cooked rice | cooked rice | partial | fridge | salmon-with-rice | 2025-05-12 | 2025-05-12 | NULL |

**Notes:**
- `quantity` is intentionally loose — "full", "partial", "low" plus optional explicit counts. We don't track precise amounts (whiteboard problem).
- `prepared_from` set for cooked/prepared items — faster perishability profile, identifies which recipe produced it.
- `last_verified_at` resets when the user confirms the item is still there during a pantry confirmation pass.

## kitchen (per-tenant, D1 `kitchen_equipment` + `profile.kitchen_notes`)

What a member owns to cook **with** (equipment, not ingredients). Agent-writable via `update_kitchen`. Stored as `kitchen_equipment(tenant, slug)` rows (the `owned` list) plus the `kitchen_notes` JSON column on the `profile` row. Two structurally-separated regions: `owned` (controlled-vocabulary slugs — the **only** region that gates recipe makeability) and `notes` (freeform context the `cook` skill reasons over for parallelization — **never** gates). No equipment rows means the member's equipment is *unknown*, which makes the makeability gate a no-op (every recipe shows) — unknown is not the same as not-owned.

```sql
-- D1 kitchen_equipment table — one row per owned equipment slug. PRIMARY KEY (tenant, slug).
tenant  TEXT  -- owning user
slug    TEXT  -- EQUIPMENT_VOCAB slug (pressure-cooker | sous-vide-circulator | blender | ice-cream-maker)

-- profile.kitchen_notes (JSON column on the profile row) — freeform cook-reasoning notes.
-- cook reads this; the makeability gate ignores it entirely.
-- Example value: {"ovens": 2, "toaster_oven": true, "free_text": "10-inch cast iron, half-sheet trays"}
```

Example rows:

| tenant | slug |
|--------|------|
| alice | pressure-cooker |
| alice | blender |

**Notes:**
- `owned`: array of `EQUIPMENT_VOCAB` slugs (the same set `requires_equipment` validates against: `pressure-cooker, sous-vide-circulator, blender, ice-cream-maker`). An off-vocab slug is rejected by `update_kitchen` at write time (a structured conflict, no write) — the gate's left operand is kept vocabulary-clean. (D1-backed, so the write-time gate is the sole guard.)
- `[notes]`: freeform table, parse-checked only. Oven count, pan sizes, sheet trays — surfaced to the `cook` flow for parallelization suggestions; **no schema, never gates**. Seeded through normal `cook` use, not at onboarding.
- The makeability rule: a recipe is makeable for a member when its `requires_equipment` is a subset of `owned`. Empty/absent `owned` ⇒ gate no-op. See `search_recipes` and the kitchen-equipment capability.

## grocery list (per-tenant, D1 session state)

The buy list — committed intent for the next order. Ingredient/product-level and **SKU-free**: resolution to a Kroger SKU happens once, at order time, against current availability, so the list never pins a brand/SKU that could go stale between capture and order. Stored as rows in the D1 `grocery_list` table (`PRIMARY KEY (tenant, normalized_name)`; `for_recipes` is a JSON column; `idx_grocery_status(tenant, status)` backs the `read_grocery_list` status filter). Agent-writable side-effect data (NOT user-curated config). Distinct from pantry (observation: what's in the kitchen) and `stockup` (conditional intent: buy IF on sale). Items are keyed by `normalized_name` — re-adding an existing name merges (row upsert) rather than duplicating; the order/cart status transitions (`place_order`, the in-store walk) are row updates. For a **food** row (`kind: grocery` and `domain` absent/`grocery` — the `isFoodItem` guard), that key is the canonical ingredient id via the `IngredientContext` funnel (`resolve(name)`: normalize **and** capture), so "scallions" and "green onions" merge into one row; a **non-food** row (`household`/`other` kind, or a non-grocery `domain` like home-improvement/garden/pharmacy) stays on `normalizeName(name)` (lowercase + whitespace-collapse) and is never resolved or captured, keeping non-food vocabulary out of the ingredient identity graph. The schema below describes each item object's shape:

```sql
-- D1 grocery_list table — one row per item. PRIMARY KEY (tenant, normalized_name).
-- idx_grocery_status on (tenant, status).
tenant           TEXT  -- owning user
name             TEXT  -- order-time search term (display name; required)
normalized_name  TEXT  -- canonical ingredient id (food) via the IngredientContext funnel, else normalizeName(name)
quantity         TEXT  -- loose BUY amount: "1 bottle" | "enough for the week" | count
kind             TEXT  -- grocery | household | other
domain           TEXT  -- which store-TYPE it's bought at (default "grocery"; open vocab)
status           TEXT  -- active | in_cart | ordered (required)
source           TEXT  -- ad_hoc | menu | pantry_low | stockup
for_recipes      TEXT  -- JSON array of recipe slugs needing this item (menu-derived)
note             TEXT  -- one-off brand request, occasion, or NULL
added_at         TEXT  -- ISO date (required)
ordered_at       TEXT  -- ISO date set when status → ordered; else NULL
```

Example rows:

| tenant | name | normalized_name | quantity | kind | domain | status | source | for_recipes | note | added_at | ordered_at |
|--------|------|-----------------|----------|------|--------|--------|--------|-------------|------|----------|------------|
| alice | extra virgin olive oil | olive oil | 1 bottle | grocery | grocery | active | pantry_low | [] | the fancy one this time | 2026-06-09 | NULL |
| alice | 2x4 lumber | 2x4 lumber | 6 | other | home-improvement | active | ad_hoc | [] | NULL | 2026-06-09 | NULL |
| alice | paper towels | paper towels | 1 pack | household | grocery | active | ad_hoc | [] | NULL | 2026-06-09 | NULL |

**Notes:**
- `quantity` is the loose BUY amount (1 package unless told otherwise). Recipe-level needs are NOT stored — they're re-aggregated from `for_recipes` when needed (e.g. the partial-check prompt), keeping the no-portion-math stance.
- `kind` distinguishes non-food items. Only `grocery` items reconcile back into the pantry when an order is received.
- `domain` (free string, default `grocery`; common values `grocery | home-improvement | garden | pharmacy`) is the kind of **store** the item is bought at — **orthogonal to `kind`**: `kind` governs pantry reconcile on receive, `domain` governs which store-type an in-store walk includes the item in. Absent → read as `grocery` (existing items validate unchanged). Open-vocabulary, not a hard enum — a wrong tag only mis-files an item onto the wrong walk. Validated shape-only (a non-string fails) in the Worker write subset; `add_to_grocery_list` / `update_grocery_list` accept it.
- `source` carries provenance for order-time dedup/behavior: `pantry_low`/`stockup` were promoted (don't re-prompt); `menu` aggregates with recipe needs; `ad_hoc` is a one-off.
- `note` holds a **one-off** brand request ("the fancy olive oil this time") — explicitly NOT `preferences` (the D1 profile), which is for standing dispositions.
- Lifecycle: `active → in_cart → received`. The `status` **enum is only `active | in_cart | ordered`** — `received` is not a stored status but the receive *action* (the row is removed and the pantry restocked). `place_order` writes the `active → in_cart` advance; `ordered`/`ordered_at` exist in the schema but no path sets them.

## cooking_log (D1 table)

The durable, append-only **cooking** log (not an eating log), stored as a per-tenant D1 `cooking_log` table. One row per cooking event or at-home convenience meal. **Eating out is never logged**, and **leftovers of an already-logged cook are not re-logged** (one cook that feeds several meals is one row). This is the trend spine `retrospective` reads, and the source `last_cooked` is **derived** from it by query: `last_cooked` for a recipe == `MAX(date)` over the caller's `type='recipe'` rows for that slug. Written via the `log_cooked` tool (not user-curated config). Schema: `migrations/d1/0003_cooking_log.sql`.

```sql
-- D1 cooking_log table. id INTEGER PRIMARY KEY AUTOINCREMENT.
-- idx_cooking_log_tenant_date on (tenant, date); idx_cooking_log_tenant_recipe on (tenant, recipe).
id      INTEGER  -- surrogate PK (stable handle for admin edit/delete)
tenant  TEXT     -- owning user (every read is tenant-scoped)
date    TEXT     -- ISO YYYY-MM-DD
type    TEXT     -- recipe | ready_to_eat | ad_hoc
recipe  TEXT     -- slug; present when type = recipe (soft ref to recipes.slug, no FK)
name    TEXT     -- dish name; present for ready_to_eat | ad_hoc
protein TEXT     -- optional inline dimension for non-recipe entries
cuisine TEXT     -- optional; recipe entries resolve protein/cuisine from `recipes` via a JOIN
satisfied_vibe TEXT -- night-vibe slot provenance (migration 0026): copied from the cleared meal_plan
                    -- row's from_vibe on cook, so last_satisfied(vibe) = MAX(date) WHERE satisfied_vibe = id.
                    -- NULL for an off-plan cook (idx_cooking_log_satisfied_vibe on (tenant, satisfied_vibe))
```

Example rows:

| id | tenant | date | type | recipe | name | protein | cuisine |
|----|--------|------|------|--------|------|---------|---------|
| 1 | alice | 2026-06-20 | recipe | lemon-garlic-roasted-chicken | NULL | NULL | NULL |
| 2 | alice | 2026-06-21 | ready_to_eat | NULL | Kroger breakfast burrito (frozen) | NULL | NULL |
| 3 | alice | 2026-06-22 | ad_hoc | NULL | Scrambled eggs and toast | egg | american |

**Notes:**
- `type = recipe` rows are slug-only — protein/cuisine are resolved from the D1 `recipes` table at read time (`retrospective`'s `cooking_log LEFT JOIN recipes` + COALESCE), never duplicated, so recategorizing a recipe retroactively corrects its history.
- `recipe` is a **soft reference** to `recipes.slug` — there is no FK, so history survives a recipe's removal. `log_cooked` resolves the slug against `recipes` at **write time** (an unknown slug is `not_found`); existing rows are preserved verbatim even after a recipe slug is removed.
- `ready_to_eat` consumption also decrements the item's on-hand stock in the pantry (the `ready_to_eat` catalog stays a pure options list with no stock field) and its accumulating frequency (by `name`) is the favored-item signal for re-order suggestions.
- Cadence ("cooks/week") counts `recipe` + `ad_hoc` only; `ready_to_eat` is the convenience side of the cook-vs-convenience split.
- Append-only in normal use; `id` gives a stable handle for an admin UI to edit/delete a mis-logged row.

## reconcile_errors (D1 table, shared)

The observable record of recipes the index reconcile (`src/recipe-projection.ts`) **skipped** — a recipe that fails the required-field/vocabulary contract, is missing a body `## Ingredients`/`## Instructions` section, duplicates a slug, or carries a dangling `pairs_with` is NOT projected into the `recipes` table and is recorded here, so a malformed human/Obsidian edit is observable instead of silently dropped. **Shared** (not per-tenant — recipe slugs/paths are group content, not tenant data). The table is **replaced wholesale on every reconcile** (`DELETE` + batched `INSERT` in one transaction), so it always reflects the latest pass: a fixed recipe drops out on the next tick. Surfaced via `GET /health`, the agent-readable `read_reconcile_errors` tool, and an ntfy push. Schema: `migrations/d1/0014_reconcile_errors.sql`.

```sql
-- D1 reconcile_errors table — recipes the index reconcile skipped. No PRIMARY KEY
-- (a plain rowid table): a duplicate-slug pair plus a later cross-corpus failure can
-- yield two rows for one slug, so it is replaced wholesale each pass, never upserted.
slug        TEXT  -- the recipe slug that failed to index (basename of the object)  NOT NULL
path        TEXT  -- its corpus object path (recipes/<slug>.md), for the operator/author  NOT NULL
message     TEXT  -- the first (most actionable) validation error, human-readable  NOT NULL
recorded_at TEXT  -- ISO date (YYYY-MM-DD) of the reconcile that recorded it  NOT NULL
```

Example rows:

| slug | path | message | recorded_at |
|------|------|---------|-------------|
| weeknight-chili | recipes/weeknight-chili.md | cuisine "tex-mex" is not in the controlled vocabulary | 2026-06-27 |
| sheet-pan-salmon | recipes/sheet-pan-salmon.md | body is missing the `## Instructions` section | 2026-06-27 |

**Notes:**
- The table reflects the **latest reconcile only** — there is no history; a recipe corrected upstream simply stops appearing on the next pass.
- One slug can yield more than one row (a duplicate-slug collision plus a separate cross-corpus failure), which is why there is no PK and rows are never upserted.

## bug_reports (D1 table, shared)

Agent-filed bug reports. `report_bug` writes a row here (the GitHub App is off the data path). **Shared** operational table (not per-tenant). Attribution — `reporter` (the filing tenant) and `created_at` — is stamped **server-side**, not trusted from the agent. The operator reviews the queue ("open reports, newest first") via `GET /admin/api/bug-reports`. Schema: `migrations/d1/0015_bug_reports.sql`.

```sql
-- D1 bug_reports table. id INTEGER PRIMARY KEY AUTOINCREMENT.
-- idx_bug_reports_status_created on (status, created_at DESC) backs the operator's review queue.
id         INTEGER  -- surrogate PK
reporter   TEXT     -- tenant id who filed it (attributed server-side)  NOT NULL
title      TEXT     -- agent-authored report title  NOT NULL
body       TEXT     -- agent-authored report body  NOT NULL
created_at TEXT     -- ISO timestamp the server stamped at filing  NOT NULL
status     TEXT     -- operator-managed lifecycle; 'open' by default, 'closed' when handled  NOT NULL
```

Example rows:

| id | reporter | title | body | created_at | status |
|----|----------|-------|------|------------|--------|
| 1 | alice | search_recipes ignores the season filter | Asked for summer mains and got a winter braise in the results. | 2026-06-27T14:02:00.000Z | open |

**Notes:**
- `reporter` and `created_at` are set by the Worker — the agent supplies only `title`/`body`. `status` defaults to `open`; the operator closes it through the admin panel.

## discovery_matches (per-member, D1 `discovery_matches` table)

The **discovery sweep**'s per-member match attribution: which member(s) the sweep matched an imported recipe to, and at what taste score. This one record does **double duty** — it is the sweep's **import gate** (a candidate is imported only when ≥1 member matches it, so the shared corpus never floods any one member with the group's combined discovery firehose) **and** the per-member filter behind `list_new_for_me` (a member sees only the discoveries attributed to them). Keyed by `(recipe, tenant)`; written by the sweep on an import (`src/discovery-db.ts` `recordDiscoveryMatches`), read by `readNewForMe`. **Sibling of `recipes`** (like `recipe_derived`/`taste_derived`), so the index projection's wholesale `recipes` rebuild never touches it. Migration 0016.

```sql
-- D1 discovery_matches table — one row per (recipe, member) the sweep matched. PRIMARY KEY (recipe, tenant).
-- idx_discovery_matches_tenant on (tenant) backs the per-member new-for-me read.
recipe     TEXT  -- recipe slug (joins recipes.slug)  NOT NULL
tenant     TEXT  -- the member the sweep matched it to  NOT NULL
score      REAL  -- the taste cosine that cleared the match threshold (provenance / log detail)
matched_at TEXT  -- YYYY-MM-DD the match was recorded
```

Example rows:

| recipe | tenant | score | matched_at |
|--------|--------|-------|------------|
| harissa-roast-chicken | alice | 0.6312 | 2026-06-26 |
| harissa-roast-chicken | bob | 0.5841 | 2026-06-26 |

## discovery_log (D1 table, shared)

The **discovery sweep**'s per-candidate **outcome log** — **one table serving three roles** (design Decision 11), so the audit surface and the operational state aren't three tables:
- the **operator audit log** — recent rows, any outcome (ordered by `created_at`), the admin **Discovery** area's candidate-pipeline view;
- the intake **"already evaluated" dedup set** — any row for a `url` marks it handled, so a re-run never reprocesses a candidate (the log **is** the sweep's progress state — there is no separate cursor);
- the **parked/failed surface** — `WHERE outcome IN ('error', 'failed')`, read by the agent-readable `read_discovery_errors` tool; the `failed` count also flips the `discovery-sweep` health record's `ok`.

**Shared** (not per-tenant — discovery source URLs/outcomes are group content). Each sweep tick **appends** one row per terminal outcome and **prunes** rows older than the retention window (`LOG_RETENTION_DAYS`), so it doesn't grow without bound — a `no_match` aged out of the window may be re-evaluated later, which is acceptable. Schema: `migrations/d1/0016_background_discovery.sql` + `migrations/d1/0018_discovery_retry.sql`.

```sql
-- D1 discovery_log table — one row per candidate outcome (append-only within a tick, retention-pruned).
-- PRIMARY KEY (id). Indexed four ways:
--   idx_discovery_log_url     on (url)              — the dedup "already evaluated" lookup
--   idx_discovery_log_created on (created_at)       — the most-recent-first operator log
--   idx_discovery_log_outcome on (outcome)          — the parked/failed (outcome IN ('error','failed')) subset
--   idx_discovery_log_retry   on (outcome, next_retry_at) — due-retry scan
id             TEXT     -- sweep-provided unique id (PK)
url            TEXT     -- canonical source URL (the dedup key)
title          TEXT     -- candidate title
source         TEXT     -- feed name / sender address (provenance)
outcome        TEXT     -- imported | duplicate | no_match | rejected_source | dietary_gated | error | failed  NOT NULL
slug           TEXT     -- resulting recipe slug (imports only; NULL otherwise)
detail         TEXT     -- JSON: attribution (imports), the matched-duplicate slug, the validation/fetch error, etc.
created_at     TEXT     -- ISO timestamp (most-recent-first ordering)
attempts       INTEGER  -- how many acquisition passes this row has had (0 = non-retryable / legacy; ≥1 = retryable park)
next_retry_at  TEXT     -- ISO timestamp when this row next enters the cron retry stream; NULL = terminal (not retryable)
pushed         INTEGER  -- 1 when the candidate arrived via POST /admin/api/ingest (a scraper push); 0 otherwise  (0031)
origin         TEXT     -- for a pushed row, the batch `source` name (provenance shown in the admin Discovery view)  (0031)
```

A **pushed** row (`pushed = 1`, `origin = "<source>"`) is a walled-source scraper candidate (see `ingest_candidates` below): its `acquire` stage was satisfied from attached content, not a fetch, so the admin Discovery view badges it (`scraper: <origin>`) and renders `acquire` as arrived-via-push. A pushed candidate's **transient** infrastructure failure is NOT written here — its `ingest_candidates` inbox row is the retry state — so only its terminal outcome ever appears in this log.

For a content **park** (`outcome = 'error'`), `detail.reason` is the **specific** acquisition failure — `unreachable` (the fetch threw or returned a non-2xx; the HTTP status is recorded as `detail.status` when it was a non-2xx), `no_jsonld` (page fetched, no JSON-LD), `not_a_recipe` (JSON-LD present but no schema.org `Recipe`), `incomplete` (a `Recipe` with no ingredients/instructions), or a classification-validation message — **not** a catch-all `unreachable`. This is the same taxonomy `parse_recipe` returns and what the operator feed-probe reports, so a walled/dead source is distinguishable from a feed entry that simply isn't a parseable recipe.

For a candidate halted at the **match stage** — `outcome = 'no_match'` with `detail.stage` of `"match"` or `"confirm"`, or `outcome = 'dietary_gated'` — `detail.match_scores` carries the per-member cosine match score computed by `matchMembers` for **every** member evaluated (not only those that cleared the taste threshold): `[{ "tenant": "<id>", "score": <cosine, 0-1> }, ...]`. This is the auditable record of how close each member came, surfaced on the admin Discovery area's candidate card and its expanded `discovery_log` detail. A candidate halted **before** the match stage (e.g. `no_match` with `detail.stage: "triage"`) or resolved to `imported`/`duplicate`/`rejected_source` never computed member scores, so `detail.match_scores` is absent.

The **retry lifecycle** (`attempts` / `next_retry_at`):
- When a retryable park is first written (`outcome = 'error'`, `detail.reason = 'unreachable'`; or `outcome = 'failed'`), `attempts = 1` and `next_retry_at` is set to the first backoff slot.
- Each sweep tick loads due rows (`next_retry_at <= now`) as a bounded retry sub-stream and re-runs the full acquisition pipeline on them in place (`resolveDiscoveryRow` on success/termination; `bumpDiscoveryRetry` on re-failure within cap).
- On successful re-acquisition the row is resolved: `outcome` updates, `next_retry_at` clears (terminal).
- On exhaustion (`attempts >= retryMaxAttempts`) the row terminates to `outcome = 'error'`, `next_retry_at = NULL` — health clears (the `countDiscoveryFailures` query counts `outcome = 'failed'` only).
- Legacy rows (`attempts = 0`) and non-retryable parks (`next_retry_at = NULL`) are never re-admitted by the cron retry stream; an operator can manually retry any `error`/`failed` row via `POST /admin/api/discovery/:id/retry` regardless of attempt count.

Example rows:

| id | url | title | source | outcome | slug | detail | created_at | attempts | next_retry_at |
|----|-----|-------|--------|---------|------|--------|------------|----------|---------------|
| `d1a…` | https://www.seriouseats.com/harissa-roast-chicken | Harissa Roast Chicken | Serious Eats | imported | harissa-roast-chicken | {"attribution":[{"tenant":"alice","score":0.6312}]} | 2026-06-26T09:00:01.000Z | 0 | NULL |
| `d2b…` | https://example.com/roundup | 10 Best Summer Salads | news@example.com | error | NULL | {"reason":"not_a_recipe"} | 2026-06-26T09:00:02.000Z | 0 | NULL |
| `d3c…` | https://www.seriouseats.com/walled | Walled Recipe | Serious Eats | error | NULL | {"reason":"unreachable","status":403} | 2026-06-26T09:00:03.000Z | 1 | 2026-06-26T10:00:03.000Z |
| `d4d…` | https://www.bonappetit.com/recipe/braised-short-ribs | Braised Short Ribs | Bon Appétit | failed | NULL | {"reason":"unexpected: Workers AI embed failed: Too many subrequests"} | 2026-06-26T09:00:04.000Z | 1 | 2026-06-26T10:00:04.000Z |
| `d5e…` | https://www.bonappetit.com/brown-butter-scallops | Brown Butter Scallops | Bon Appétit | dietary_gated | NULL | {"stage":"match","restriction":"shellfish-free","tenant":"priya","match_scores":[{"tenant":"priya","score":0.71},{"tenant":"casey","score":0.42}]} | 2026-06-26T09:00:05.000Z | 0 | NULL |

**Notes:**
- `outcome` is one of `imported` | `duplicate` | `no_match` | `rejected_source` | `dietary_gated` | `error` | `failed`. `error` is a **content park** (an un-importable page — unreachable/walled/invalid), an expected steady state; `failed` is an **infrastructure failure** (a transient env.AI/D1 error), which degrades the `discovery-sweep` health record (`countDiscoveryFailures`) until cleared or terminalized. `read_discovery_errors` returns both; `failed` rows are transient/in-retry until their attempt cap is exhausted (then they terminalize to `error`).
- The dedup set is **every** distinct `url` in the table regardless of outcome, so a `duplicate`/`no_match`/`error`/`failed` candidate is not re-fetched as a fresh candidate — retryable rows re-enter via the explicit retry stream only.
- The full log (every outcome) is served to the operator at `GET /admin/api/logs/discovery` → `{ entries: [...] }` (Access-gated, most-recent-first, bounded), and enriched per-row (furthest pipeline stage, halt point, retry status — no schema change) by `readDiscoveryCandidates`/`deriveHalt` for the **Discovery** admin area (`/admin/discovery`), the candidate-pipeline view. Per-candidate **Retry** and **Delete** actions appear for `error`/`failed` rows.

## meal plan (per-tenant, D1 session state)

The transient, recipe-grain record of **committed cook intent** — what the agent has agreed to cook next. Distinct from the grocery list (the ingredient-grain BUY list): a planned recipe whose ingredients are all in the pantry still belongs here even though nothing is bought. Rows are cleared as they resolve (cooked → removed; abandoned → dropped). Stored as rows in the D1 `meal_plan` table (`PRIMARY KEY (tenant, recipe)`; `sides` is a JSON column). Agent-writable side-effect data (NOT user-curated config). When a recipe is cooked, `log_cooked` removes its row in the **same D1 transaction** as the cooking-log insert.

```sql
-- D1 meal_plan table — one row per planned recipe. PRIMARY KEY (tenant, recipe).
tenant       TEXT  -- owning user
recipe       TEXT  -- recipe slug (required)
planned_for  TEXT  -- ISO date the cook is slated for (optional)
sides        TEXT  -- JSON array of open-world free-text side names (never slug-resolved)
```

Example rows:

| tenant | recipe | planned_for | sides |
|--------|--------|-------------|-------|
| alice | arroz-caldo | 2026-06-10 | ["roasted broccoli"] |
| alice | miso-glazed-salmon | NULL | ["white rice", "cucumber salad"] |

**Notes:**
- The session-start stale-planned reconcile surfaces only **due** rows — `planned_for` on or before today, or unset — and leaves future-dated plans alone.
- `sides` (optional, array of strings) holds **open-world sides** — trivial plate companions ("roasted broccoli", "white rice") with no recipe file — that ride on their main's row. It is advisory free text only: **never slug-resolved**, and the `recipe` slug invariant (and the reconcile/cook flows that key off it) is unaffected. A **corpus** side (a `course: side` recipe with a slug) earns its **own** `[[planned]]` row instead. Its ingredients reach the grocery list as `source = "menu"`, `for_recipes = []`, with a `note` identifying the side.
- Extends the store model: `pantry` = observation, `stockup` = conditional intent, `grocery_list` = committed buy intent, **`meal_plan` = committed cook intent**, **`cooking_log` = realized history**.

## preferences (per-tenant, D1 `profile` row + `brand_prefs`)

User-curated. Agent edits only when explicitly directed, via the `update_preferences` **merge-patch** (the defined-surface + `custom` shape and the RFC-7396 contract are described in the storage overview at the top of this doc). Assembled from the `profile` row (scalars + `stores`/`dietary`/`custom` JSON columns) and the `brand_prefs(tenant, term, ranks)` rows. The example below shows the **assembled object** (what `read_user_profile` returns).

```sql
-- D1 profile table — singleton row per tenant. PRIMARY KEY (tenant).
tenant                      TEXT     -- owning user
taste                       TEXT     -- markdown (see taste section below)
diet_principles             TEXT     -- markdown (see diet_principles section below)
default_cooking_nights      INTEGER  -- default number of cooking nights WITHIN the planning window
planning_cadence_days       INTEGER  -- how far out the caller plans/shops, in days (0028); unset falls back to a 7-day planning window in propose_meal_plan
lunch_strategy              TEXT     -- leftovers | buy | mixed
ready_to_eat_default_action TEXT     -- opt-in | auto-add
stores                      TEXT     -- JSON: {primary, preferred_location, location_zip}
dietary                     TEXT     -- JSON: {avoid[], limit[]}
custom                      TEXT     -- JSON: arbitrary agent-added keys
kitchen_notes               TEXT     -- JSON: freeform cook-reasoning notes (oven count, pan sizes)
freezer_capacity_estimate   TEXT     -- tight | moderate | spacious
rotation                    TEXT     -- JSON: {resurface_after_days?, novelty_boost?}
retrospective_prefs         TEXT     -- JSON: {stale_after_days?, revealed_months?, revealed_min_cooks?}; overrides retrospective defaults per member (0021)
last_planned_at             TEXT     -- YYYY-MM-DD planning watermark (0016): set by update_meal_plan on an add; bounds list_new_for_me

-- D1 brand_prefs table — one row per (tenant, ingredient term). PRIMARY KEY (tenant, term).
tenant  TEXT  -- owning user
term    TEXT  -- normalized ingredient term (e.g. "olive_oil")
ranks   TEXT  -- JSON array: [] = don't-care/cheapest; non-empty = ranked brand list (first available wins)
```

Example rows (`profile`):

| tenant | default_cooking_nights | planning_cadence_days | lunch_strategy | ready_to_eat_default_action | stores | dietary | freezer_capacity_estimate |
|--------|----------------------|----------------------|----------------|----------------------------|--------|---------|--------------------------|
| alice | 3 | 7 | leftovers | opt-in | {"primary":"kroger","preferred_location":"Kroger - 76104","location_zip":"76104"} | {"avoid":[],"limit":["cilantro"]} | moderate |

Example rows (`brand_prefs`):

| tenant | term | ranks |
|--------|------|-------|
| alice | olive_oil | ["California Olive Ranch","Cobram Estate"] |
| alice | butter | ["Kerrygold","Plugra"] |
| alice | yellow_onion | [] |

**`[brands]` is tri-state and drives matching confidence.** The Kroger matching pipeline reads a key's *presence* as the confidence signal: absent → ambiguous (Claude asks); `[]` → "don't care," pick cheapest acceptable without asking; a non-empty list → ranked preference, **list order is rank**. Keys are the canonical id with spaces as underscores (`extra virgin olive oil` → resolve via the ingredient identity graph → `olive oil` → key `olive_oil`). A non-empty list whose brands are all unavailable falls back to ambiguous.

**`[stores].primary` is the fulfillment mode** (in-store-fulfillment). It is either the literal `kroger` (online mode — the agent flushes the grocery list with `place_order`, using `preferred_location` for the Kroger API) **or** a mapped store slug from `stores/` (walk mode — the agent runs the in-store walk for that store instead). The agent picks the flush from the resolved mode and SHALL NOT assume Kroger. Mode is a property of the **preference/trip, not the chain** — a store can be online-capable and/or walk-capable. **Naming a store for one trip** ("I'm going to the West 7th Tom Thumb") overrides the standing `primary` for that trip only, without rewriting it. An unknown store-slug `primary` is **not a hard failure** (preferences is parse-only curated config) — the agent resolves it conversationally (offer to map the store, or fall back to online). `preferred_location` stays meaningful in walk mode too (it still drives Kroger pricing for sale checks).

## ingredient identity (shared corpus, D1)

The ingredient normalization layer — a directed identity graph the cron grows itself
(organic-ingredient-normalization). A canonical **id** is `base` or `base::detail[::detail]`;
the **base** (the id up to the first `::`) keeps the existing lowercase/space form (`ground beef`,
`olive oil`) so pre-change `sku_cache`/`brand_prefs` keys resolve unchanged, and details are
opaque discriminators to deterministic code (which compares only full-id or base equality). The
front-door `ingredient_alias` maps a surface form → id; the `ingredient_identity` registry holds
the node (with a union-find `representative` pointer, a `concrete` flag, and a cron-owned
embedding); `ingredient_edge` holds directed `satisfies` edges. The `readResolver` load bakes the
`representative` chain into the variant→id map. `update_aliases` writes `source='human'` (never
overwritten by the auto capture pass). A sibling re-confirm pass re-examines edgeless auto-minted
nodes against the denser registry and stamps `ingredient_identity.reconfirmed_at` once processed
(NULL = still eligible), so each node is only ever re-confirmed once; its decisions land in
`ingredient_normalization_log` alongside capture's, flagged by `is_reconfirm`.

```sql
-- ingredient_identity — canonical nodes. PRIMARY KEY (id).
id             TEXT  -- canonical id: `base` or `base::detail`
base           TEXT  -- id up to the first "::"  NOT NULL
detail         TEXT  -- the "::"-joined detail suffix, or NULL for a bare base
search_term    TEXT  -- human Kroger search phrase for a qualified id ("80/20 ground beef")
representative TEXT  -- union-find pointer to the surviving id, or NULL (self)
concrete       INTEGER NOT NULL DEFAULT 1  -- 0 = concept node (queryable class, not buyable)
embedding      TEXT  -- JSON array of EMBED_DIM floats; cron-owned, NULL until embedded
source         TEXT NOT NULL DEFAULT 'auto'  -- 'auto' | 'human'
decided_at     INTEGER
reconfirmed_at INTEGER  -- one-shot re-confirm stamp; NULL = eligible/not-yet-re-confirmed

-- ingredient_alias — surface form → id (hot-path exact match). PRIMARY KEY (variant).
variant    TEXT  -- lowercased, quantity-stripped surface form
id         TEXT  -- → ingredient_identity.id (pre-representative)  NOT NULL
source     TEXT NOT NULL DEFAULT 'auto'
confidence REAL
decided_at INTEGER

-- ingredient_edge — directed "satisfies" edges. PRIMARY KEY (from_id, to_id, kind).
from_id TEXT  -- A satisfies a request for to_id (reachability)
to_id   TEXT
kind    TEXT  -- 'general' | 'containment' | 'membership'
source  TEXT NOT NULL DEFAULT 'auto'

-- novel_ingredient_terms — the capture queue (surface forms not yet placed). PK (term).
-- ingredient_normalization_log — the decision audit log + evaluated-set (mirrors discovery_log).
-- is_reconfirm INTEGER NOT NULL DEFAULT 0  -- 1 = decision from the re-confirm pass, not initial capture
```

Example identity rows (id / base / detail):

| id | base | detail |
|----|------|--------|
| olive oil | olive oil | *(null)* |
| ground beef::fat-80-20 | ground beef | fat-80-20 |
| green onion | green onion | *(null)* — with alias `scallions → green onion` |
| chicken::thighs | chicken | thighs — edge `chicken::whole → chicken::thighs` (containment) |

## flyer_terms (shared corpus, D1 `flyer_terms` table)

User-curated. Broad scan terms for `kroger_flyer`'s serendipitous sale
discovery. Agent edits only when directed (it may suggest additions during a
flyer scan, but never writes on its own).

```sql
-- D1 flyer_terms table — broad scan terms for serendipitous sale discovery. PRIMARY KEY (term).
term  TEXT  -- a broad category or ingredient name (e.g. "chicken", "frozen meals")
```

Example rows:

| term |
|------|
| fruit |
| vegetables |
| frozen meals |
| cheese |
| chicken |
| ground beef |
| salmon |

**Notes:**
- The public Kroger API has no flyer/circular endpoint. The sale list is synthesized by searching these terms and keeping fulfillable, genuinely-discounted products. These broad terms are consumed by the **background warm** (`src/flyer-warm.ts`, a scheduled cron) that materializes a per-store cache, **not** by a live `kroger_flyer` call — the tool reads the cache. (Precise, per-tenant checks — a specific stockup item or substitute candidate on sale — live in the place-groceries flow.)
- A flat top-level `terms` array of strings. **Absent or empty degrades gracefully**: the sweep has no broad terms, the per-store rollup is empty, and `kroger_flyer` returns an empty list rather than erroring. Terms are trimmed, lowercased, and deduped by the warm, so case-variant duplicates ("Olive Oil" / "olive oil") are never scanned twice.
- Each term is scanned a few pages deep, but the scan is **relevance**-ranked (no sort-by-discount), so it samples the head of each category — deep sales on low-relevance items can be missed. This limitation is documented, not hidden.

## Warmed flyer cache (KV, not a repo file)

Derived, time-bound state written by the flyer warm into the `KROGER_KV` namespace (not the data repo — it's an ephemeral cache, regenerated each sweep). Documented here for completeness; nothing edits it by hand.

- `flyer:{locationId}` → `{ sweep_id, as_of, items }` — the per-store rollup. `items` are noise-floor `FlyerItem`s (`{ sku, brand, description, size, price: { regular, promo }, savings, categories, matched_terms }`); `as_of` is epoch ms of the last contribution (surfaced to `kroger_flyer` readers as an ISO 8601 string). Shared across all tenants at that store.
- `flyer:cursor` → `{ sweep_id, index, total, last_refresh_at, done, completed_at }` — tiny per-tick progress record; the idle-tick read. `completed_at` is epoch ms of the most recent FULL sweep (monotonic — a new sweep doesn't clear it), the freshness signal the warm's health record carries.
- `flyer:plan` → `{ sweep_id, units }` — the ordered `(locationId, term)` unit list, built once per sweep so later ticks don't re-enumerate over GitHub.

## Background-job health (D1 `job_health` table)

Derived operational state for the `/health` endpoint (background-job-health). Each background process upserts one row per run; `/health` aggregates them. Tenant-data-free by construction — counts, timestamps, and error classes only. It lives in D1 (not KV) because persisting per-job liveness on every cron tick is standing write load that belongs in D1's far larger budget (migration `0019_job_health`).

- `job_health` table — columns `name` (TEXT PRIMARY KEY), `ok` (INTEGER 0/1), `last_run_at` (INTEGER epoch ms), `summary` (TEXT, a JSON object). One upserted row per registered job (`flyer-warm`, `recipe-classify`, `recipe-index`, `recipe-embed`, `discovery-sweep`, `email`), written through `src/db.ts`. `ok` is the last run's success; `summary` is small tenant-clean detail (the warm carries `{ action, done, sweep_started_at, sweep_completed_at, errors }`; the recipe-facet classify pass carries `{ classified, pending, parked, errored, pruned, quota_exhausted, timed_out }`; the discovery sweep carries `{ processed, imported, duplicate, no_match, dietary_gated, parked, deferred, taste_updated, log_pruned }`; the email handler carries the gate outcome `{ accepted, reason, written }`).
- `GET /health` → `{ ok, generated_at, jobs: [{ name, ok, last_run_at, never_run?, summary? }], d1: { ok }, admin: { access_configured, email_allowlist, dev_bypass_set, exposed }, ai_quota_exhausted }` — **open and tenant-clean** (no token; the D1 probe is coarsened to a boolean so no raw `storage_error` string is exposed; the `admin` posture is booleans only — never the allowlisted emails). Aggregate-only. Overall `ok` is false when a job is *explicitly* failing, the D1 probe failed, the admin gate is `exposed` (the dev bypass set on a surface Access doesn't protect — only the loopback guard stands between it and an open panel), or `ai_quota_exhausted` is true; a never-run job is reported with `ok: null, never_run: true`. The top-level **`ai_quota_exhausted`** boolean is aggregated from the AI jobs' summaries (an explicit `quota_exhausted` flag or a 4006/"neurons" error string) and **names** Workers AI's daily-allocation exhaustion rather than leaving a generic job-fail — `/health.svg` renders an explicit `ai  quota exhausted` row and the admin Status view banners it. HTTP status is 200 when ok, 503 when failing (so plain HTTP-status monitors trip). Restricting reads is an edge concern (Cloudflare Access / WAF), not Worker config.
- `GET /health.svg` → the same aggregate payload rendered as an SVG **card** (`content-type: image/svg+xml`) for a README badge (data-repo-health-badge). **Open** like `/health` (no token — a public README badge must be anonymously fetchable), but **always HTTP 200** — degraded state is shown by color, not status, because an image proxy (GitHub Camo) may not render a non-200 as an image — with a short `Cache-Control` so it refreshes on a TTL. Tenant-data-free; a never-run job renders amber (pending), not red, and the `admin` row shows the gate state (green `gated` / muted `disabled`|`dev` / red `exposed`). It's a glance, not an alarm: point real HTTP-status/freshness monitors at `/health` (JSON), not `.svg`.

## Background-job run history (D1 `job_runs` table)

The per-run **history** behind `job_health`'s last-state row (background-job-health), backing the admin Status area's per-job uptime sparkline and "healthy/unhealthy since" label (and, downstream, the Logs area's all-jobs run log). `job_health` upserts ONE row per job; `job_runs` is the per-run series — appended beside every `job_health` write, never updated, and bounded per job (migration `0023_job_runs`).

- `job_runs` table — columns `id` (TEXT PRIMARY KEY, a writer-stamped unique id), `job` (TEXT), `ok` (INTEGER 0/1), `ran_at` (INTEGER epoch ms), `duration_ms` (INTEGER), `summary` (TEXT, a JSON object — the SAME tenant-clean shape as the paired `job_health.summary` for that run). Indexed on `(job, ran_at DESC)`. One inserted row per run, written through `src/db.ts` by `writeJobRun` (`src/health.ts`) at every `writeJobHealth` call site (`src/index.ts`'s `email` handler, and `flyer-warm.ts`/`recipe-classify.ts`/`recipe-projection.ts`/`recipe-embeddings.ts`/`discovery-sweep.ts`/`ingredient-normalize.ts`/`ingredient-reconfirm.ts`/`grocery-pantry-reconcile.ts`'s scheduled-run wrappers). A history-write failure degrades to a no-op (never blocks or fails the job it instruments), exactly like `writeJobHealth`'s call-site `.catch(() => {})`.
- **Retention:** bounded per job at `JOB_RUNS_PER_JOB_CAP` (100) — `writeJobRun` prunes that job's rows beyond the cap on every append, so the table cannot grow without limit.
- `readJobRuns(env, name, limit)` → the named job's most recent `limit` runs, newest-first, each `{ id, ok, ran_at, duration_ms, summary }`. Degrades to `[]` when D1 is unreachable rather than throwing (the Status page must stay renderable; the live D1 probe carries that signal separately).
- `currentStreakStart(runs)` → the earliest `ran_at` in the unbroken run of the job's current `ok` value, given a newest-first `runs` array (as `readJobRuns` returns) — the "healthy since" / "unhealthy since" instant the Status job rows render. Returns `null` for an empty history (no sparkline / since-label shown in that case).

## Usage trends (Workers Analytics Engine `grocery_usage` dataset)

The per-run **history** tier (usage-trends), complementing the `job_health` D1 liveness row. Each registered background job emits **one tenant-clean data point per run** through `recordUsagePoint` (`src/health.ts`) to the `grocery_usage` Analytics Engine dataset (binding `USAGE_AE`). AE `writeDataPoint` is non-blocking and costs **no KV or D1 budget**; the emission is best-effort (an unbound binding or a throw is a swallowed no-op).

AE has **no named columns** — a data point is `index1`, `blob1..blob20`, `double1..double20`, and an AE-supplied `timestamp`, and queries reference these **positions**. So the slot assignment is a **positional contract**: reordering an existing slot in a later change silently corrupts historical queries. Slot layout:

- `index1` = job name (the sampling key)
- `blob1` = job name · `blob2` = outcome (`"ok"` | `"fail"`)
- `double1` = run duration (ms) — the same slot-1 metric for every job
- `double2…` = the job's own summary counts, in a **fixed per-job order** (the five cron jobs' catch-path emits `double1` (duration) only; `email` and the `recipe-classify` quota-exhausted path still carry their counts even when `blob2` is `"fail"`):
  - `flyer-warm`: `[errors]`
  - `recipe-classify`: `[classified, pending, parked, errored, pruned]`
  - `recipe-index`: `[projected, skipped]`
  - `recipe-embed`: `[described, describePending, embedded, pruned, pending]`
  - `discovery-sweep`: `[processed, imported, duplicate, no_match, dietary_gated, parked, failed, failed_outstanding, deferred, taste_updated, log_pruned]`
  - `email`: `[accepted (0|1), written (0|1)]`
- `timestamp` = AE-supplied write time

Tenant-data-free by construction — job name, outcome, durations, and counts only, never a per-tenant id. Read back per job/day via the AE **SQL API** (see `/admin/api/usage/trends` below). AE free-tier retention (≈90 days) bounds the queryable window.

## Tool usage trends (Workers Analytics Engine `grocery_tool` dataset)

The per-MCP-tool-call **history** tier (tool-usage-trends), the request-path sibling of `grocery_usage`. Every tool call emits **one tenant-clean data point** through `recordToolPoint` (`src/health.ts`), fired once from the `buildServer` registration decorator (`src/tool-instrumentation.ts`, which wraps `server.registerTool` so every tool — present and future — is covered at one seam). The outcome is read from the tool's MCP result (`runTool`'s `fail()` sets `isError`); a raw throw records `error`. Emission is best-effort, non-blocking, and fires after the result is computed, so it never changes a tool's result or adds latency; it costs **no KV or D1 budget**.

Same positional-contract rule as `grocery_usage` — slots are referenced by position, so a later change must not reorder them. Slot layout:

- `index1` = tool name (the sampling key)
- `blob1` = tool name · `blob2` = outcome (`"ok"` | `"error"`) · `blob3` = **RESERVED** for a future error code (not written today)
- `double1` = call duration (ms)
- `timestamp` = AE-supplied write time

Tenant-data-free by construction — the tool name (a fixed, low-cardinality enum), the outcome, and the duration only, never a per-tenant id or any call argument. Read back per tool via the AE **SQL API** (see the Tool usage trends dashboard below).

## Tenant activity (D1 `tenant_activity` table)

Best-effort, throttled first-seen/last-seen tracking per tenant (admin-ui-redesign-members), backing the Members roster's `joined`/`lastActive` timestamps (NOT the active/pending status — see below). Written from the MCP tenant-resolution path (`touchTenantActivity` in `src/tenant.ts`, called from `resolveTenant(..., recordSeen=true)` — only on the `/mcp` request path, never from operator-driven resolutions like the admin Kroger-consent mint or the Data explorer's member lookup, which resolve a tenant without that tenant actually being active).

- `tenant_activity` table — columns `tenant` (TEXT PRIMARY KEY), `first_seen_at` (INTEGER epoch ms), `last_seen_at` (INTEGER epoch ms). One row per tenant that has completed at least one successful MCP tool call; **absent for a tenant with none** — `joined`/`lastActive` are `null` for such a tenant, but this absence is no longer the roster's "pending" signal (see the OAuth-grant-derived `status` below). Migration `0024_tenant_activity`.
- **Write semantics (THROTTLED, not a write on every tool call):** `first_seen_at`/`last_seen_at` are both set on the first touch (write-if-absent, via an upsert). On a later touch, `last_seen_at` is refreshed **only** when the stored value is older than a 1-hour throttle window — so a chatty session costs at most one write per hour, not one per MCP request. `first_seen_at` is never overwritten once set.
- **Best-effort:** a `tenant_activity` write failure is swallowed (never throws) — it must not fail the MCP request it rides alongside, mirroring `writeJobHealth`'s call-site `.catch(() => {})` posture.
- Read by `listTenants` (`src/admin.ts`) to derive the Members roster's `joined`/`lastActive` fields ONLY (see below) — one plain `SELECT` over the whole table, not a per-tenant query. Because this table only records recent tool-call activity, it is throttled/lossy by design and is deliberately NOT used to derive `status` — a member who is fully connected but has made no recent tool call would otherwise show as wrongly "pending".

## Operator admin surface (HTTP, not a repo file)

The operator admin panel (operator-admin) is a **Hono** app at `/admin` — server-rendered pages plus interactive **islands** that call a same-origin, typed JSON API at `/admin/api/*` — gated by **Cloudflare Access** on `/admin*` and verified in-Worker (`Cf-Access-Jwt-Assertion`). Opt-in: 404 when `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` are unset. An optional `ACCESS_ALLOWED_EMAILS` allowlist adds a second check on the verified `email` claim (else 403 — defense-in-depth against a too-loose Access policy). The local-dev bypass (`ADMIN_DEV_BYPASS`) only engages on a loopback host, so it is structurally inert on any deployed Worker (a stray flag leaves `/admin` at 404, and `/health` reports the gate `exposed`). The read-heavy areas (Status, Data, Usage) are **pure SSR** — the page calls the `src/` reader and renders the data in the first paint, no JSON round-trip; the **Data** explorer deliberately crosses per-tenant domain data — the operator sees every member's rows (the group has no assumed internal privacy). The interactive areas (Members, the Logs row-actions, the Config forms + corpus editors) call the JSON routes below. The minted invite code is returned **once** and never logged. Every JSON route serializes a failure as a structured `{ error, message }` body (`src/errors.ts` `ToolError.toShape()`) at a code-mapped status (`not_found`→404, `validation_failed`→400, `unsupported`→405, else 500), which the calling island renders; an SSR page renders the same structured outcome in-process (e.g. the Usage view's `{ configured: false }` card).

**Member lifecycle** (`/admin/api/*`, called by the Members island):

- `GET /admin/api/tenants` → `{ tenants: TenantRosterRow[] }` — every allowlisted member as a structured roster row (canonical lowercase ids, sorted), operational status only (no per-tenant domain data — see "Tenant listing is operational-only"): `{ id, owner, status: "active" | "pending", kroger: "linked" | "unlinked", joined, lastActive, cooked, favorites }`. `owner` is `id === env.OWNER_TENANT_ID` (false for everyone when that var is unset — never inferred from onboarding order). `status` is `active` once the member has at least one persisted OAuth grant in `OAUTH_KV` (a completed Claude.ai connection — a single prefix `list()` over `grant:<userId>:<grantId>` keys, the `@cloudflare/workers-oauth-provider` grant format, extracting the tenant id as the `userId` segment; see `oauthGrantTenantIds` in `src/admin.ts`), else `pending` (including a revoked grant); this KV list degrades to an empty set on failure (every tenant reports `pending`) rather than throwing, so a transient KV outage cannot break the roster. `joined`/`lastActive` are sourced independently from the `tenant_activity` row's `first_seen_at`/`last_seen_at` (epoch ms) — both `null` when that tenant has no such row, regardless of `status`. `kroger` reflects whether `kroger:refresh:<id>` exists in `KROGER_KV`, read via a single prefix `list` (no per-tenant get). `cooked`/`favorites` are `COUNT(*)` over `cooking_log` and `overlay WHERE favorite = 1` respectively, each a single `GROUP BY tenant` aggregate across the whole roster (never one query per member).
- `POST /admin/api/tenants` `{ username, invite_code? }` → `{ username, invite_code, connector_url }` — onboard; writes `tenant:<id>` + `invite:<code>` (generates the code when omitted). `connector_url` is `<origin>/mcp`.
- `POST /admin/api/tenants/<id>/rotate` → `{ username, invite_code, connector_url }` — mint a new code, delete the member's prior `invite:*` mapping(s); allowlist + per-tenant data untouched. Errors `not_found` if the member is absent.
- `POST /admin/api/tenants/<id>/kroger-login` → `{ url }` — mint a single-use Kroger consent link bound to an allowlisted member (the same nonce the `kroger_login_url` MCP tool mints, allowlist-rechecked via `resolveTenant`), so the operator can link a member who has no `/mcp` session yet. The nonce rides only in the returned `url` and is never logged; `not_found` for a non-member.
- `DELETE /admin/api/tenants/<id>` → `{ username, revoked: true, invites_removed }` — remove `tenant:<id>` + every `invite:* → id` + `kroger:refresh:<id>`, and purge the per-tenant D1 tables + attributed notes through `src/db.ts`. The member's issued token stops resolving (allowlist re-check fails).

**Usage dashboards** (SSR at `/admin/usage`, rendered in-process from `src/usage.ts` — no JSON route): each view renders either `{ configured: false }` (when `CF_ACCOUNT_ID`/`CF_ANALYTICS_TOKEN` is unset, shown as a setup card) or the configured shape below; an upstream/transport failure degrades to that area's error card.

- **Resource usage** (usage-observability) → `{ configured: true, generated_at, day, kv: { limits, totals, namespaces: [{ namespace_id, read, write, delete, list, resolved }], history: { window_days, days: [{ day, namespaces: [{ namespace_id, read, write, delete, list, resolved }] }] } }, ai: { neurons_limit, neurons_used, by_model: [{ model, neurons }], history: { window_days, days: [{ day, neurons }] } } }` — the current UTC day's account-wide KV operations + Workers AI neurons against the daily free-tier limits, read from the Cloudflare GraphQL Analytics API. `kv.limits`/`kv.totals` are `{ read, write, delete, list }`. `resolved` is `{ label, color, unlabeled }` — the namespace id's display identity. The **label** resolves from the `KV_NAMESPACE_LABELS` env var (`id:BINDING,...`, env.ts) — a **deploy-time** artifact `scripts/merge-wrangler-config.mjs` derives from the operator's own merged `kv_namespaces` array, never a runtime Cloudflare API call — falling back to the raw id (`unlabeled: true`) if unset/unmatched. The **color** is assigned independently of label resolution: every namespace id observed in the current payload gets a distinct, stable color by its position in the sorted list of ids present in that payload (a small fixed categorical palette, cycled) — an unresolved-label namespace still gets a real, distinct color, never a shared grey fallback. `kv.history` is a per-namespace, per-day series over the trailing `window_days` (30, the same window `usage-trends`/`tool-usage-trends` use), ascending oldest→newest, sourced from the SAME `kvOperationsAdaptiveGroups` GraphQL query widened to a date range (not a second query or a new dataset) — every namespace observed anywhere in the window is zero-filled into every day's entry, so a quiet day reports `0`, never an absent entry. `ai.history` is a per-day neuron-consumption series over the same `window_days`, ascending oldest→newest, summed across models, sourced from the SAME `aiInferenceAdaptiveGroups` GraphQL query widened to a date range — zero-filled the same way (a quiet day reports `0`, never an absent entry). Performs **no KV** (observing the budget must not consume it — the snapshot AND both histories); tenant-clean (account/namespace aggregates only); KV rows keyed by namespace **id**.
- **Usage trends** (usage-trends) → `{ configured: true, generated_at, window_days, jobs: [{ job, days: [{ day, runs, avg_ms, total_ms }] }] }` — each background job's per-day run count and mean/total run duration over the last `window_days` (30), read from the **Analytics Engine SQL API** (`POST /accounts/<id>/analytics_engine/sql`) over the `grocery_usage` dataset. A *different* surface from the resource view's GraphQL (custom AE datasets are SQL; built-in datasets are GraphQL), reusing the same account id + token. `day` is `YYYY-MM-DD` (UTC); `runs` is an integer, `avg_ms`/`total_ms` are numbers; jobs are ordered by name, days ascending. Performs **no KV or D1**; tenant-clean (per-job/per-day aggregates only).
- **Tool usage trends** (tool-usage-trends) → `{ configured: true, generated_at, window_days, tools: [{ tool, calls, errors, p50_ms, p95_ms }] }` — each MCP tool's call count, error count, and p50/p95 call duration over the last `window_days` (30), read from the **Analytics Engine SQL API** over the `grocery_tool` dataset. Reuses the same account id + token. `calls`/`errors` are integers (the error **rate** is derived in the panel from `errors`/`calls`, never stored); `p50_ms`/`p95_ms` are numbers; tools are ordered by call count descending (ties by name). Performs **no KV or D1**; tenant-clean (per-tool aggregates only, never per-tenant or per-call rows).

**Insights dashboard** (SSR at `/admin/insights`, rendered in-process from `src/insights.ts` — no JSON route; group-insights): the operator Insights area's group-wide popularity payload, precomputed for all four windows so its island re-scopes without a refetch → `{ windows: [{ key, label }], windowStart: { all, year, month, week }, perWindow: { all|year|month|week: { recipes: RecipeRow[], sources: SourceRow[], totals: { cooks, favorites, activeDays } } }, heatmap: { today, weeks, cells: [{ date, count, level }], months: [{ label, span }] }, generatedAt }`, where `RecipeRow` is `{ slug, title, cuisine, sourceName, favorites, cooks, combined, lastCookedLabel }` and `SourceRow` is `{ key, domain, name, isMember, isFeed, recipeCount, favorites, cooks, combined, recipes: RecipeRow[] }`. Aggregated **group-wide** (across all member-tenants — the admin surface is cross-tenant) from `cooking_log` (a recipe's times-cooked = its `type='recipe'` rows in-window; the heatmap + `totals.cooks` count `type IN ('recipe','ad_hoc')`, excluding `ready_to_eat`), `overlay` (group favorite count per slug — current state, so window-invariant), `recipes` (`title`/`cuisine`/`source_url` → domain), and `feeds` (a source domain matching a feed URL's host is tagged a discovery feed). `windowStart` holds the lexicographic `YYYY-MM-DD` cutoffs (`""` for `all`); `windowStart[win]` drives the heatmap's out-of-window dimming, and `cells` span the trailing 53 weeks (column-major, Sun→Sat; future days omitted), `level` a 0–4 intensity. Performs **no KV**; goes through `src/db.ts`; tenant-clean in presentation (no per-tenant identifier in the payload).

### Data explorer (SSR at `/admin/data/*`, operator-data-explorer)

The **Data** area is **server-rendered** (`src/admin-data.ts`, navigated by query/path params — no JSON API): read-only, cross-tenant views over D1 and the R2 corpus, behind the same Access gate (so they 404 with the rest of the surface when it is disabled). Its sub-nav is narrowed to three purpose-built explorers — **Recipes**, **Stores**, **Guidance** — each with its own reader(s); there is no generic per-table view. Member data lives at `/admin/members` (reusing the same `memberDetail` reader); the `flyer_terms`/`feeds` shared-corpus tables are edited at `/admin/config/*` and the ingredient identity graph at `/admin/normalize`; the discovery pipeline tables are `/admin/discovery`'s concern; `reconcile_errors`/`bug_reports`/`schema_meta` ("System") have no admin-panel surface — inspect them via `wrangler d1 execute DB --command "…"` (`--remote` against a deployed database). Each reader runs a **fixed** query (no operator-supplied SQL), goes through `src/db.ts` / `src/corpus-store.ts`, and performs **no redaction** — `private` notes are shown and cross-tenant aggregates name their tenants. Scope is D1 domain data + the R2 corpus only; no KV secret is reachable.

**Recipes** (`/admin/data/recipes`, `/admin/data/recipes/<slug>`):

- **recipes list** → `{ recipes: [{ slug, title, status }] }` — every slug in the R2 corpus ∪ the `recipes` table, each with its projection `status` (`indexed | skipped | pending | orphaned`).
- **recipe detail** (`<slug>`) → the cross-tier record: `{ slug, status, reconcile_message, source, body, projection, derived: { description, has_embedding, state } | null, dispositions: [{ tenant, favorite, reject }], notes: [...] }`. `status` is derived from (R2 source present?, `recipes` row present?); `skipped` carries the `reconcile_errors` reason; the embedding is shown as presence only, never the raw vector. `body` is `source` with its YAML frontmatter fence removed (the whole text when there's none, `null` when there's no source). `not_found` when the slug is in neither tier. The detail page derives the R2 frontmatter object from `source` for display (`parseMarkdown`) and shows the raw `source` text in a collapsible panel, omitted when `status === "orphaned"` (no R2 source to show).
- **`searchRecipes(env, query, mode)`** → `RecipeSearchResult` (`{ mode: "keyword" | "hybrid" | "hybrid-degraded"; results: RecipeSearchHit[] }`, `RecipeSearchHit` = `{ slug, score, semantic }`), the list's search backend. The requested `mode` param is `"keyword" | "hybrid"` — a discriminated toggle, not a bare string — but the RETURNED `mode` is a three-way discriminant on how the ranking was actually produced. **Keyword**: an AND-of-tokens substring match over each recipe's indexed metadata (title, slug, protein, cuisine, course, tags, `ingredients_key`, read from `recipes`); matches carry `score: null, semantic: false` (no ranking); always returns `mode: "keyword"` — it never calls Workers AI, so it cannot degrade. **Hybrid**: additionally embeds the query once (`embedText`, `src/embedding.ts` — one Workers AI call per search, never per recipe) and blends keyword-token coverage with `cosineSimilarity` against each candidate's stored `recipe_derived.embedding` (a single bulk `SELECT slug, embedding FROM recipe_derived WHERE embedding IS NOT NULL`, joined against the keyword-scored rows in memory — no per-recipe re-embedding). A hit's `score` is the blended relevance (`0`–`1`); `semantic: true` marks a hit that cleared the relevance floor via the cosine term without matching every query token (the "surfaced semantically" badge). A recipe with no stored embedding is absent from Hybrid results but still findable via Keyword. An empty query returns the full corpus unranked (`score: null`) in either mode, with **zero** AI calls. If the embed call or the `recipe_derived` read fails (a Workers AI outage or neuron-quota exhaustion — the same condition `/health`'s `ai_quota_exhausted` flag reports), Hybrid mode DEGRADES rather than throwing: it falls back to the plain keyword match for the same query and returns `mode: "hybrid-degraded"` so the caller can render a "semantic ranking unavailable" notice while still showing results, instead of the whole explorer 500ing. The blend weights and the semantic-surfaced relevance floor are tunable constants (`HYBRID_KEYWORD_WEIGHT`/`HYBRID_SEMANTIC_WEIGHT`/`HYBRID_RELEVANCE_FLOOR` in `src/admin-data.ts`), not part of this contract — distinct, independently-tunable rankers from `semantic-recipe-search`'s tool-facing ranked mode and `cookbook-search`'s keyword ranker, which this reader deliberately does NOT call into (no per-tenant re-ranks make sense for a cross-tenant operator search).

**Stores** (`/admin/data/stores`, `/admin/data/stores/<slug>`):

- **`storeList(env)`** → `{ stores: StoreListEntry[] }` (`{ slug, name, domain, chain, notes_count, skus_count }[]`) — every row in the shared `stores` registry with a notes/SKU count joined in memory (three bulk reads, no per-store fetch). `chain` is unpacked from `stores.extra`; `skus_count` is `0` for a store with no `location_id` (a non-Kroger chain).
- **`storeDetail(env, slug)`** → `{ slug, name, domain, chain, label, address, location_id, skus: SkuRow[], notes: Record<"layout"|"location"|"stock"|"general", StoreNoteRow[]> }` — one assembled per-store record: identity fields unpacked from `stores.extra` (`chain`/`label`/`address`/`location_id`), `sku_cache` rows scoped to that store's `location_id` (empty — not an error — when `location_id` is null, since SKU lookups don't apply to a non-Kroger location), and `store_notes` grouped server-side by the note's first tag (`layout | location | stock`, defaulting to `general`). `not_found` for an unknown slug.

**Guidance** (`/admin/data/guidance`, `?gprefix=`/`?gpath=`):

- **guidance browse** → list a `guidance/**` R2 prefix as `{ prefix, entries: [{ name, type }] }` (`guidanceListing`); one object as `{ key, markdown }` (`guidanceObject`). A breadcrumb + folder/file browser SSR'd from these two reads, unchanged from prior — presentation-only in this change.

### Shared-corpus editors (`/admin/api/corpus/*`, operator-admin)

The **Config** area's *writable* companion to the read-only Data explorer (`src/admin-corpus.ts`) — the operator curation surface for the group-wide shared-corpus lookup tables, behind the same Access gate (404 with the rest of the surface when disabled). `<table>` is one of `flyer-terms` | `feeds` | `senders` | `members`; an unknown table is `404`. (Ingredient aliases moved to the Normalization area's Aliases tab — see *ingredient identity* — so they are no longer a corpus editor here.) Distinct from the read-only SSR Data explorer (these are writable JSON routes). **Removal is operator-only** — no MCP tool deletes these — so the agent adds (via `update_feeds`/`update_discovery_sources`) and the operator prunes. All writes go through `src/corpus-db.ts` (→ `src/db.ts`, structured errors).

- `GET /admin/api/corpus/<table>` → `{ table, columns, rows }` — the table's rows (server-fixed column order): `flyer-terms` → `{term}`, `feeds` → `{url, name, weight, tags}`, `senders`/`members` → `{address}`.
- `POST /admin/api/corpus/<table>` `{...row}` → `{ added }` — add one validated row (insert-or-ignore, add-only dedup). Validation rejects a bad/empty key with `400` (`validation_failed`), writing nothing (`feeds` needs a `url`, a numeric `weight` defaulting to 1, and `tags` as a string array; addresses are normalized).
- `DELETE /admin/api/corpus/<table>/<key>` → `{ removed }` — remove by primary key. Idempotent: an absent key is `{ removed: false }`, not a `404`. Address keys (`senders`/`members`) are normalized (trim + lowercase) to match storage.

## feeds (shared corpus, D1 `feeds` table)

**Shared** (D1 shared corpus). RSS feed URLs and tags — **agent-writable via `update_feeds`** (add-only, deduped by canonicalized url) as well as hand-curated. Discovery sources are a group-wide concern: any member's feeds contribute to the one set the **background discovery sweep** polls each tick (`src/discovery-sweep.ts`); the sweep classifies and taste-matches the resulting candidates per member. The sweep reads `url`/`name`; `weight`/`tags` are descriptive (not used to rank).

```sql
-- D1 feeds table — shared RSS feeds for recipe discovery. PRIMARY KEY (url).
url     TEXT  -- canonical feed URL
name    TEXT  -- human-readable feed name
weight  REAL  -- relative fetch weight (descriptive)
tags    TEXT  -- JSON array of descriptive tags (e.g. ["trusted", "technique-focused"])
```

Example rows:

| url | name | weight | tags |
|-----|------|--------|------|
| https://www.seriouseats.com/recipes/atom.xml | Serious Eats | 1.0 | ["trusted","technique-focused"] |
| https://www.budgetbytes.com/feed/ | Budget Bytes | 0.8 | ["weeknight","approachable"] |
| https://www.bonappetit.com/feed/rss | Bon Appétit | 0.7 | ["aspirational","trend-aware"] |

## discovery_candidates (shared corpus, D1 `discovery_candidates` table)

**Shared** (D1 shared corpus). Agent-writable side-effect data (NOT user-curated). Written by the Worker's inbound-email handler (`email()`), which receives newsletters forwarded to `groceries-agent@<domain>`, and **drained by the background discovery sweep** (`src/discovery-sweep.ts`), which extracts recipe links from each row's full plain-text `body`, then classifies/taste-matches/imports them like any feed candidate. Each row is one received message with its full plain-text body — the Worker captures the email faithfully; the sweep does the link extraction (no pre-extraction at write). This is the *push* complement to the RSS feeds — it reaches bot-walled/paywalled sources (Serious Eats, NYT) the Worker can't fetch.

Old entries are automatically pruned when new ones arrive (default retention: 30 days).

```sql
-- D1 discovery_candidates table — forwarded-newsletter inbox (one row per received email).
-- PRIMARY KEY (id); url UNIQUE. (Group-wide URL suppression is the separate
-- discovery_rejections table, written by reject_discovery — not tracked here.)
id            TEXT  -- synthetic per-message key "inbox:<from> <subject> <received_at>" (same value as url)
url           TEXT  -- UNIQUE; the same synthetic key — the dedup handle (one row per from+subject+date)
source        TEXT  -- sender address (the forwarded email's From)
subject       TEXT  -- email subject line
body          TEXT  -- plain-text email body (HTML→text), truncated to 10,000 chars
discovered_at TEXT  -- YYYY-MM-DD from the message Date header
status        TEXT  -- 'new' on insert; not updated (the inbox tracks no per-candidate disposition)
```

Example rows (one row per email; the `body` carries the recipe links the agent extracts):

| id | url | source | subject | body | discovered_at | status |
|----|-----|--------|---------|------|---------------|--------|
| `inbox:news@seriouseats.com This week's best dinners 2026-06-11` | *(same as id)* | news@seriouseats.com | This week's best dinners | This week we're cooking: Weeknight Chili (seriouseats.com/weeknight-chili), Sheet-Pan Salmon (seriouseats.com/sheet-pan-salmon) … | 2026-06-11 | new |

**Notes:**
- `body` contains the email's plain-text content (or HTML converted to readable text), truncated to 10,000 characters. The sweep scans it for recipe links; there is no pre-extracted candidate list.
- Entries are deduped at write-time by `(source, subject, discovered_at)` — the same email forwarded twice is stored only once.
- An empty table is valid (no discoveries yet) — the sweep simply finds no email candidates that tick.

## ingest_keys (D1 table, shared) — walled-source scraper keys

The **ingest-key roster** (recipe-ingestion). One row per **scraper machine**; a key authenticates `POST /admin/api/ingest` as a bearer credential — a deliberate, key-authed carve-out from the Cloudflare Access gate (a headless home scraper has no Access JWT). The plaintext secret is shown **once** at mint and never stored: only a SHA-256 hash (the lookup key) + a short display prefix are persisted. `last_used_at` and the last-reported scraper/contract versions drive the admin liveness + contract-skew views. Schema: `migrations/d1/0029_ingest_keys.sql`.

```sql
-- D1 ingest_keys table. PRIMARY KEY (id); UNIQUE (key_hash), indexed for the auth lookup.
id                    TEXT     -- "ik_<hex>" (PK)
label                 TEXT     -- scraper machine label (e.g. home-nas-scraper)  NOT NULL
key_hash              TEXT     -- SHA-256 hex of the secret (the credential + lookup key)  NOT NULL UNIQUE
key_prefix            TEXT     -- display-only prefix, e.g. "ing_live_9f2a"  NOT NULL
created_at            INTEGER  -- epoch ms  NOT NULL
last_used_at          INTEGER  -- epoch ms of the last accepted push; NULL = never
status                TEXT     -- active | revoked  NOT NULL DEFAULT 'active'
last_scraper_version  TEXT     -- last reported scraper build
last_contract_version TEXT     -- last reported targeted contract version (skew source)
```

Auth is SHA-256 hash equality (`WHERE key_hash = ? AND status = 'active'`) — an indexed DB lookup; the hash **is** the credential, so there is no per-row secret compare. Revoke sets `status = 'revoked'` (the next push with it is rejected `401`).

## ingest_candidates (D1 table, shared) — the pushed-content inbox

The scraper push inbox (recipe-ingestion). `POST /admin/api/ingest` persists each accepted, non-duplicate recipe item here with its **pre-parsed content**; the discovery sweep drains it as a **third intake source** (beside feeds + the email inbox), classifying/matching/importing **without a fetch** (`acquire` returns the attached content). A row lives until the candidate reaches a **terminal** outcome (imported / rejected / contract-park), then it is deleted; a **transient** infrastructure failure KEEPS the row so the next tick retries from the stored content (no re-fetch, no `discovery_log` spam). Deduped by canonical `url`. Schema: `migrations/d1/0030_ingest_candidates.sql`.

```sql
-- D1 ingest_candidates table. PRIMARY KEY (id); UNIQUE (url) is the dedup key.
id           TEXT  -- uuid (PK)
url          TEXT  -- canonical source URL (the dedup key)  NOT NULL UNIQUE
title        TEXT  -- recipe title  NOT NULL
content      TEXT  -- JSON { ingredients[], instructions[], summary?, servings?, time_total?, time_active? }  NOT NULL
origin       TEXT  -- the batch `source` name (the pushed candidate's provenance / discovery_log `origin`)  NOT NULL
key_id       TEXT  -- the minting ingest key's id  NOT NULL
received_at  TEXT  -- ISO 8601
```

**Arrival dedup** (at the endpoint) checks the canonical url against the corpus `source_url`s, `discovery_rejections`, the **settled** `discovery_log` set (outcomes other than `error`/`failed`), and the in-flight inbox — but **not** walled/transient parks, so a push **supersedes** a prior `unreachable`/`no_jsonld` park (the scraper now supplies content the Worker's own fetch could not reach). Walled sources are therefore scraper-owned and SHOULD NOT also be registered as Worker-polled `feeds`.

## discovery_sources (shared corpus, D1 `discovery_senders` + `discovery_members`)

**Shared** (D1 shared corpus), allowlist config. The trust gate for inbound-email discovery: only mail from a listed source is processed. Two tables — `discovery_members` (friend-group personal addresses: anything they forward gets indexed) and `discovery_senders` (newsletter `From` addresses: auto-forwarded mail from them gets indexed). Editable by `update_discovery_sources` (anyone trusted with the MCP can widen intake), deduped by `address`.

```sql
-- D1 discovery_senders table — newsletter From-address allowlist. PRIMARY KEY (address).
address  TEXT  -- sender email address (required; must contain @)
name     TEXT  -- optional human-readable label (e.g. "NYT Cooking")

-- D1 discovery_members table — friend-group personal address allowlist. PRIMARY KEY (address).
address  TEXT  -- member email address (required; must contain @)
```

Example rows (`discovery_senders`):

| address | name |
|---------|------|
| cooking@nytimes.com | NYT Cooking |
| news@seriouseats.com | Serious Eats |

Example rows (`discovery_members`):

| address |
|---------|
| casey@example.com |

**Notes:**
- Every entry needs a valid `address` (contains `@`) — enforced at build + write time.
- Auth posture: a message is accepted only when authenticated (Cloudflare DKIM/SPF/DMARC) AND from a listed source — `sender ∧ aligned-DKIM` (auto-forward) or `member ∧ aligned-DKIM` (manual forward). Everything else is dropped silently.

## discovery_config (D1 singleton, operator-scoped)

**Operator-scoped** — read by the background discovery sweep at job start; written only by the operator via the admin Config console (not an agent tool). The table holds a **sparse override** of the sweep's compiled-in `DEFAULT_CONFIG`: only the knobs an operator has explicitly tuned are non-null; every null column falls back to the default. This means `DEFAULT_CONFIG` is the safe compile-time baseline and the table records only deliberate operator deltas — an empty or absent row runs with all defaults.

```sql
-- D1 discovery_config table (migration 0017 + 0020). SINGLE ROW (id = 1, enforced by CHECK).
id                      INTEGER PRIMARY KEY CHECK (id = 1)  -- singleton guard
taste_threshold         REAL     -- cosine threshold for per-member taste match (τ); null → DEFAULT_CONFIG.tasteThreshold
triage_threshold        REAL     -- cheaper pre-classify blurb-cosine gate; null → DEFAULT_CONFIG.triageThreshold
dedup_threshold         REAL     -- semantic duplicate cosine gate (δ); null → DEFAULT_CONFIG.dedupThreshold
classify_max            INTEGER  -- max classify+fetch calls per sweep tick; null → DEFAULT_CONFIG.classifyMaxPerTick
rate_cap                INTEGER  -- max recipe imports per tick (corpus-bloat governor); null → DEFAULT_CONFIG.rateCap
fetch_max_per_tick      INTEGER  -- max feed fetch calls per tick; null → 16
max_candidates_per_tick INTEGER  -- max candidates forwarded to classify per tick; null → 150
retry_max_attempts      INTEGER  -- max retry attempts for a failed candidate; null → 5
log_retention_days      INTEGER  -- days to retain discovery outcome log rows; null → 60
```

Example row (all knobs tuned):

| id | taste_threshold | triage_threshold | dedup_threshold | classify_max | rate_cap | fetch_max_per_tick | max_candidates_per_tick | retry_max_attempts | log_retention_days |
|----|----------------|-----------------|----------------|-------------|---------|-------------------|------------------------|-------------------|-------------------|
| 1 | 0.60 | 0.40 | 0.85 | 8 | 5 | 3 | 30 | 2 | 30 |

**Notes:**
- Read by `loadDiscoveryConfig(env)` (`src/discovery-calibration.ts`): reads the row, validates each knob against its range (`> 0 && ≤ 1` for real knobs; `> 0 && integer` for caps), and falls back to `DEFAULT_CONFIG` on a null or out-of-range value.
- Written via `saveDiscoveryConfig(env, patch)` — merges the patch over the existing row and upserts with `INSERT … ON CONFLICT(id) DO UPDATE SET`.
- Floor guards (`FLOOR_TASTE = 0.2`, `FLOOR_DEDUP = 0.7`) and ceiling guard (`CEILING_RATE_CAP = 100`) require `confirm: true` in the admin PUT to override — the API rejects without it (400 `validation_failed` + `needsConfirm: true`), preventing accidental footgun writes.
- The calibration console's **analyze** endpoint (`POST /admin/api/discovery/analyze`) computes a cheap no-AI readout of how many corpus pairs fall within δ and how many members clear τ, before any config write — a preview, not a write.
- The calibration console's **dry-run** endpoint (`POST /admin/api/discovery/dry-run`) runs the full pipeline with `importRecipe`/`recordMatches`/`recordLog` stubbed out, returning what *would* be imported — the sweep's built-in E2E verification.

## operator_config (D1 singleton, operator-scoped)

**Operator-scoped** — read at each MCP tool call (ranking, flyer) and at cron start (flyer warm). Written only via the admin Config panel. Follows the same sparse-override singleton pattern as `discovery_config`: only columns an operator has explicitly tuned are non-null; absent or null columns fall back to `DEFAULT_OPERATOR_CONFIG` compiled defaults. An empty or absent row runs with all defaults.

```sql
-- D1 operator_config table (migration 0019). SINGLE ROW (id = 1, enforced by CHECK).
id                  INTEGER PRIMARY KEY CHECK (id = 1)  -- singleton guard
-- Ranking weights (precedence: compiled → operator_config → per-tenant rotation)
favorite_weight     REAL     -- boost for favorited recipes in ranking; null → 0.15
novelty_boost       REAL     -- group-default novelty boost; null → 0.1 (per-tenant rotation overrides)
pantry_weight       REAL     -- pantry-hit score multiplier; null → 0.12
perish_weight       REAL     -- perishable-ingredient score multiplier; null → 1.0
key_weight          REAL     -- key-ingredient overlap score multiplier; null → 0.4
overlap_cap         INTEGER  -- max key-ingredient overlaps counted; null → 2
-- Flyer knobs
min_flyer_discount  REAL     -- minimum savings fraction to include in flyer results; null → 0.05
flyer_refresh_hours INTEGER  -- hours between flyer warm runs; null → 24
flyer_batch_units   INTEGER  -- SKUs fetched per Kroger flyer batch call; null → 12
```

Example row (ranking weights adjusted, flyer defaults left as-is):

| id | favorite_weight | novelty_boost | pantry_weight | perish_weight | key_weight | overlap_cap | min_flyer_discount | flyer_refresh_hours | flyer_batch_units |
|----|----------------|--------------|--------------|--------------|-----------|------------|-------------------|--------------------|--------------------|
| 1 | 0.20 | 0.15 | 0.10 | 1.0 | 0.5 | 3 | NULL | NULL | NULL |

**Notes:**
- `loadOperatorConfig(env)` (`src/operator-config.ts`) reads the singleton row and merges over `DEFAULT_OPERATOR_CONFIG` — any null column takes its compiled default.
- `saveOperatorConfig(env, patch)` upserts the id=1 row with non-null fields from the patch. `validateOperatorConfig(patch, {confirm})` enforces: `favorite_weight`/`novelty_boost`/`pantry_weight` in [0, 2]; `perish_weight`/`key_weight` in [0, 10]; `min_flyer_discount` in [0, 1]; `overlap_cap` positive integer ≤ 20; `flyer_refresh_hours` integer in [1, 720]; `flyer_batch_units` integer in [1, 200].
- Floor guards (`FLOOR_FLYER_REFRESH_HOURS = 6`, `FLOOR_FLYER_BATCH_UNITS = 4`) mirror `discovery_config`'s footgun-floor pattern: a value AT OR BELOW the floor requires `confirm: true` in the admin PUT to override — the API rejects without it (400 `validation_failed` + `needsConfirm: true`, `field`, `floor`), preventing accidental under-refresh (hammering the Kroger flyer endpoint) or under-batching (inflating per-tick embedding overhead). Validation runs only on write — a value saved below a floor before this gate existed is not retroactively rejected on read, only blocked on its next edit. The five ranking weight knobs (`favorite_weight`/`novelty_boost`/`pantry_weight`/`perish_weight`/`key_weight`) and `overlap_cap`/`min_flyer_discount` carry NO floor — `0` (or the range minimum) is a legitimate, non-dangerous value for a weight or a cap, so those knobs never need `confirm` regardless of value.
- Ranking precedence: compiled defaults → `operator_config` → per-tenant `profile.rotation` (for `novelty_boost` / `resurface_after_days`). `resolveRankParams` in `src/semantic-search.ts` applies these three tiers in order.

## guidance/

**Shared corpus** (R2 bucket `CORPUS`, under `guidance/`). A curated tree of **opinionated, vetted advice** the agent surfaces in flow, organized by **domain** subdirectory (each file is an R2 object keyed `guidance/<domain>/<slug>.md`). Each file is markdown prose keyed by a semantic slug, with an optional one-line `description` frontmatter field (the only structured field; the rest is freeform prose). Files are validated only for existence, not parse-checked as data (like other curated markdown). All domains map by **agent world-knowledge over the semantic slugs** — there is deliberately no manifest or alias table; over-fetching is harmless.

Two read tools cover the whole umbrella: `list_guidance(domain?)` (slugs + optional `description`, one domain or all grouped) and `read_guidance(domain, slugs)` (named entries' content). One gated write tool, `save_guidance(domain, slug, content, source?)`, covers the writable domains (`cooking_techniques`, `purchasing`). See `docs/TOOLS.md`.

### guidance/ingredient_storage/

**Read-only.** Opinionated put-away advice the agent surfaces when new perishables enter the kitchen (2–3 relevant, non-obvious tips — on both the order `received` restock and a farmers-market `update_pantry` haul). It encodes opinions the model lacks, not shelf-life facts it already has — there is no shelf-life table; freshness is the agent's own judgment, not table-gated.

Each file is **markdown prose keyed by a storage behavior *class*** — `tender-herbs.md`, `hardy-herbs.md`, `leafy-greens.md`, `alliums.md`, `potatoes.md`, … — so one entry covers a whole family without per-ingredient duplication. A few **singletons** (`basil.md`, `tomatoes.md`, `avocados.md`) exist for items whose rule contradicts their class. Relational "don't store together" rules (ethylene cross-contamination, onions↔potatoes) live in a dedicated **`_ethylene.md`**, because they belong to no single item.

```markdown
---
description: cilantro, parsley, dill, mint — stems in water, in the fridge
---

# Tender herbs

Stand stems in ~1 inch of water, loosely bagged, **in the refrigerator** …
```

- **Read-only / edit-when-directed curated config** — `save_guidance` rejects this domain (it is excluded from the writable allowlist), so it changes only by hand-editing the corpus (the Obsidian vault synced to the R2 bucket). The read-only guarantee is enforced by the allowlist, not by the absence of any write tool.
- **Confidence-in-prose:** solid tips are written plainly; contested/folklore tips are pre-hedged *in the prose itself* ("some cooks rinse berries in vinegar — results vary"), so relaying the file faithfully is relaying it honestly. No matching class file → the agent gives **no tip** (silence over invention).

### guidance/cooking_techniques/

**Agent-writable.** General cooking-technique memories the agent distills from member-supplied sources (ATK, Serious Eats) and surfaces inline during the guided `cook` flow. Each file is **markdown prose keyed by a *technique*** — `browning-meat.md`, `searing.md`, `resting-meat.md`, `blanching.md`, … — flat (no relational/`_`-prefixed files). One file per technique: refining a technique **overwrites** its file, never appends.

```markdown
---
description: brown ground/whole meat in an even layer for fond and color, not steam
source: https://www.seriouseats.com/...   # provenance — recorded by save_guidance
---

# Browning meat

Spread the meat in an even layer across the entire surface and **do not disturb**.
Break it up only after it's browned. You want **brown meat, not gray meat** — crowding steams it.
```

- **Shared + agent-writable** (the `stores`/`feeds` posture): any member's `save_guidance` write lands in the one shared tree, read by the whole group. Written through `src/corpus-store.ts` as a single object `put` (atomic at the object level, same path as `create_recipe`).
- `save_guidance(domain, slug, content, source?)`: `content` is the full markdown the agent composes (distilled, imperative, non-obvious — with a `description:` line); `source`, when given, is recorded into the frontmatter for provenance/citation. A kebab-case `slug`, no traversal.
- **Capture** is member-initiated (a posted article/URL/distillation → the capture skill); **surfacing** is at cook time (the agent maps a recipe step → technique slug and weaves the non-obvious tip in at that step, capped ~2, silent when nothing matches). See AGENT_INSTRUCTIONS.

### guidance/purchasing/

**Agent-writable.** Buy-side selection advice the agent distills from member-supplied buying guides (ATK taste tests, Serious Eats) and surfaces *while shopping* — *what kind of X to get* and the non-obvious *how to tell if it's good/ripe*. Each file is **markdown prose keyed by a *product/item*** — `canned-tomatoes.md`, `olive-oil.md`, … (a few natural **classes** like `stone-fruit.md` where the knowledge genuinely generalizes) — flat (no relational/`_`-prefixed files). One file per item: refining **overwrites** its file, never appends.

```markdown
---
description: choose canned whole tomatoes by the additive, not the label — calcium chloride keeps them firm
source: https://www.americastestkitchen.com/taste_tests/...   # provenance — recorded by save_guidance
---

# Choosing canned whole tomatoes

For a smooth sauce (mash/blitz → simmer), pick cans with **no calcium chloride** — true San Marzano
DOP collapses into a silky sauce. For chunky stews, cans **with** it hold their shape. Read the
ingredient list, not the front of the can.
```

- **Shared + agent-writable** (the `cooking_techniques` posture): any member's `save_guidance("purchasing", …)` write lands in the one shared tree, read by the whole group.
- **Scope gate — "phone-out non-obvious".** An entry earns its place only when it's worth pulling your phone out for in the aisle (the buy-side analogue of storage's "skip the obvious"). Obvious or well-understood buy knowledge — notably produce **seasonality** — is out of scope; ripeness/quality entries are admitted only through the same gate.
- **Confidence-in-prose:** like `ingredient_storage`, contested/folklore tips (ripeness lore especially) are pre-hedged *in the prose itself*; no matching entry → the agent gives **no tip** (silence over invention).
- **Capture** is member-initiated (a posted buying guide → the `save-buying-guide` skill); **surfacing** is at shop time — woven in per-aisle on the in-store walk, or a "check the cart and swap manually" callout on the online flush. **Narration only**: it does not influence `match_ingredient_to_kroger_sku` or write `preferences.brands`. See AGENT_INSTRUCTIONS.

## stores (shared corpus, D1 `stores` table)

**Shared corpus** (D1 `stores` table). One row per **specific store location** (not per chain) — keyed by a kebab-case location slug (e.g. `west-7th-tom-thumb`, not `tom-thumb`) — holding the store's **identity** every member reads for the in-store walk (the second fulfillment flush, alongside the Kroger `place_order` online flush). The registry is **identity only** — store **layout** (aisle order, where-it-hides hints, not-carried entries) lives in attributed store notes (the D1 `store_notes` table, below), not here. Identity is unattributed (like recipe *content*). There is **no `_indexes/stores.json`** — a group registers a handful of stores, so `list_stores` queries D1 directly. An **absent `stores` table (or empty table) is valid** (no stores registered yet → the walk degrades to a department list from world knowledge). Stores are shared like recipes: any MCP holder MAY register or edit one with no extra gate (the `update_discovery_sources` posture).

```sql
-- D1 stores table — one row per specific store location. PRIMARY KEY (slug).
-- Top-level columns: slug, name, domain. Optional identity fields (label, chain, address, location_id)
-- are stored in the extra JSON column and merged by read_store at read time.
slug   TEXT  -- required, kebab-case LOCATION id (e.g. "west-7th-tom-thumb")
name   TEXT  -- required, the chain/store name (e.g. "Tom Thumb")  NOT NULL
domain TEXT  -- free string; default "grocery" (grocery | home-improvement | garden | pharmacy | …)
extra  TEXT  -- JSON object: {label?, chain?, address?, location_id?}
```

Example rows:

| slug | name | domain | extra |
|------|------|--------|-------|
| west-7th-tom-thumb | Tom Thumb | grocery | {"label":"West 7th","chain":"tom-thumb","address":"1600 W 7th St","location_id":"70100156"} |
| fort-worth-kroger | Kroger | grocery | {"label":"Fort Worth","location_id":"01400376"} |

**Notes:**
- `slug` + `name` are required; everything else is optional. `slug` is the kebab-case location id. The registry carries **no layout** — aisle order, item placements, and not-carried entries are store notes.
- **D1 column layout:** the `stores` table has flat top-level columns `slug` (PK), `name`, and `domain`; the optional identity fields `label`, `chain`, `address`, and `location_id` are stored in an `extra` JSON column (not flat top-level keys). `read_store` assembles the full identity object by merging the flat columns with `extra`.
- **`location_id`** is an optional chain-specific external id — for Kroger stores, set it to the resolved Kroger `locationId` (a compact alphanumeric string like `"70100156"`). When present, `resolveLocationId` in `src/kroger.ts` detects a no-space string and returns it directly, bypassing the Locations API lookup; this makes Kroger in-store walks zero-friction after the one-time registration. Set via `add_store(location_id=…)` or `update_store` with `{ op: "set_identity", field: "location_id", value: … }`.
- **Layout is notes.** Aisle order, where-it-hides placements, and not-carried entries are `add_store_note` / `read_store_notes` with `layout` / `location` / `stock` tags (see the `store_notes/` schema below). One surface for everything we know about a store. The walk infers aisle order from the `layout` notes (lead each with the aisle number); item→aisle placement is agent judgment over the store's own sign vocabulary (open-vocab, no manifest — the storage-guidance posture). For Kroger stores with a `location_id`, the Kroger in-store branch uses `aisleLocation` from `kroger_prices` instead of layout notes — no pre-mapping required.
- `domain` (free string, default `grocery`) is the store's kind; the walk filters the grocery list to items of the same `domain`. A wrong tag only mis-files an item, so it's open-vocabulary, not a hard enum. For a store the user names that isn't registered, the agent classifies its domain from world knowledge (Lowe's → `home-improvement`).
- Unknown keys (`aisles` / `item_locations` / `doesnt_carry`) are **silently ignored** — identity is read, never an error.
- Validated at Worker write time (`src/validate.ts` → `validateStoreInput`). CRUD via `list_stores` / `read_store` / `add_store` / `update_store` (identity ops only) / `remove_store` (see `docs/TOOLS.md`). `list_stores` returns identity only — whether a store has a usable map is a `read_store_notes` concern.

## store_notes (per-tenant, D1 `store_notes` table)

A member's **attributed notes** on one store — the store analog of recipe notes, and the **single home for everything we know about a store**: both freeform observations ("fish counter closes at 6 PM", "they have the Kerrygold I like") AND the store's **layout**, captured by tag convention. Stored in the D1 `store_notes` table (`id TEXT PRIMARY KEY`); columns: `store` (store slug), `author` (the writing tenant, set by the Worker), `body`, `tags`, `private`, `created_at`. Shared-by-default, with an optional `private` flag.

```sql
-- D1 store_notes table — one row per note, across all tenants
id          TEXT PRIMARY KEY   -- generated stable key
store       TEXT               -- store slug
author      TEXT               -- writing tenant (set by the Worker)
body        TEXT               -- required; rows with no body are dropped on read
tags        TEXT               -- JSON array, e.g. ["layout", "location"]; default []
private     INTEGER            -- 1 = owner-only; default 0
created_at  TEXT               -- ISO timestamp (required; addressable key for edit/delete)
```

Example rows:

| id | store | author | body | tags | private | created_at |
|----|-------|--------|------|------|---------|------------|
| sn_abc | west-7th-tom-thumb | alice | Aisle 9: mexican, asian, tahini & specialty oils | ["layout"] | 0 | 2026-06-11T18:10:00.000Z |
| sn_def | west-7th-tom-thumb | alice | Tahini: aisle 9, bottom shelf by the specialty oils | ["location"] | 0 | 2026-06-11T18:12:00.000Z |
| sn_ghi | west-7th-tom-thumb | alice | Doesn't carry harissa | ["stock"] | 0 | 2026-06-11T18:14:00.000Z |
| sn_jkl | west-7th-tom-thumb | alice | Fish counter closes at 6 PM — get seafood early. | ["hours"] | 0 | 2026-06-11T18:30:00.000Z |
| sn_mno | west-7th-tom-thumb | alice | They stock the Kerrygold I like. | [] | 1 | 2026-06-11T19:05:00.000Z |

**Notes:**
- Same shape as recipe notes: `body` (required), `created_at` (required, ms-precision ISO — the addressable key for edit/delete), `tags` (optional, default `[]`), `private` (optional, default `false`). A note with no `body` is dropped on read.
- **Tag convention for layout:** `layout` (an aisle + its sections, body led by the aisle number), `location` (where a non-obvious item hides), `stock` (a not-carried entry). Untagged / other-tagged notes are freeform. The agent reads `layout` notes to order the walk; a `location` note wins over inference for that item.
- **Author-mutable.** `update_store_note(slug, created_at, …)` / `remove_store_note(slug, created_at)` edit or delete the caller's **own** notes (self-scoped by `author` — never another tenant's). This is the clean-correction path after a remodel. Across tenants there is no delete-the-other's-note — a reader prefers the most recent by `created_at` when two conflict.
- `read_store_notes(slug)` aggregates **non-private** notes from every member (attributed) plus the **caller's own** private notes; another member's `private` note is never surfaced. `add_store_note(slug, body, tags?, private?)` appends a row for the caller.

## ready_to_eat (per-tenant, D1 `ready_to_eat` table)

**Per-tenant** (a facet of the personal profile, not shared corpus — a ready-to-eat item is a Kroger SKU + "I'll eat this," pure personal taste with no shared content). Stored as `ready_to_eat(tenant, slug, meal, name, favorite, reject, category, source, brand, notes)` rows. Each item is tagged with a `meal` and keyed by a generated `slug`. The catalog mirrors the recipe disposition model: an item is **available (suggestible) by default**, with the same two mutually-exclusive marks `favorite` / `reject` (no `status` lifecycle, no `rating`). The agent seeds it at onboarding (items the member names) and adds items as discovery surfaces them.

```sql
-- D1 ready_to_eat table — one row per item. PRIMARY KEY (tenant, slug).
-- No `status` column — dropped. No `rating` column.
tenant    TEXT     -- owning user
slug      TEXT     -- generated from name, stable key (e.g. "kroger-breakfast-burrito-frozen")
meal      TEXT     -- breakfast | lunch | dinner
name      TEXT     -- display name (e.g. "Kroger breakfast burrito (frozen)")
category  TEXT     -- free-form string: frozen | refrigerated | shelf-stable | etc. (no controlled vocab)
source    TEXT     -- discovery source (e.g. "kroger-flyer"); NULL if seeded at onboarding
brand     TEXT     -- brand name (optional)
notes     TEXT     -- freeform prep/serving notes (optional)
favorite  INTEGER  -- 1 = loved; NULL = not set (mutually exclusive with reject)
reject    INTEGER  -- 1 = stop suggesting; NULL = not set (mutually exclusive with favorite)
```

Example rows:

| tenant | slug | meal | name | category | source | brand | notes | favorite | reject |
|--------|------|------|------|----------|--------|-------|-------|----------|--------|
| alice | kroger-breakfast-burrito-frozen | breakfast | Kroger breakfast burrito (frozen) | frozen | NULL | Kroger | Heat 90s in microwave | 1 | NULL |
| alice | murrays-overnight-oats | breakfast | Murray's overnight oats | refrigerated | kroger-flyer | Murray's | NULL | NULL | NULL |

Addressed by `slug`: `update_ready_to_eat(slug, { favorite | reject })` dispositions an item; `add_draft_ready_to_eat` appends an available item (no draft/active state) and returns the generated slug. `ready_to_eat_available()` reads the caller's own catalog and **skips rejected items**. There is **no** `_indexes/ready_to_eat.json` — the per-member list is small and read directly. `category` is a free-form string (no controlled vocabulary), unlike the pantry `category` enum.

## staples (per-tenant, D1 `staples` table)

**Per-tenant**. Curated "don't run out of these" list. Stored as `staples(tenant, name, normalized_name, perishable)` rows (deduped by normalized name). **Agent-writable via `update_staples`** (add-only with dedup; remove by name) as well as hand-edited; optionally seeded at onboarding.

```sql
-- D1 staples table — one row per staple item. PRIMARY KEY (tenant, normalized_name).
tenant           TEXT     -- owning user
name             TEXT     -- display name (e.g. "olive oil")
normalized_name  TEXT     -- normalized for dedup/lookup
perishable       INTEGER  -- 1 = perishable (triggers staleness nudge); 0/NULL = non-perishable
```

Example rows:

| tenant | name | normalized_name | perishable |
|--------|------|-----------------|------------|
| alice | olive oil | olive oil | NULL |
| alice | eggs | eggs | 1 |
| alice | kosher salt | kosher salt | NULL |

**Notes:**
- `name` is the only required item field. `perishable` is an optional boolean (default false when absent).
- **Distinct from `stockup`** (which is price-opportunism / bulk-buy). An item like rice can legitimately appear in both — they are independent and fire at different moments for different reasons.
- **An empty `staples` table degrades gracefully** — all staples-driven behaviors (depletion prompts, restocking callout, staleness nudges) become no-ops.
- **Perishable flag is explicit**, not inferred from pantry `category` — a staple that's completely empty won't be in the pantry table at all, so inferring from category wouldn't work.

## stockup (per-tenant, D1 `stockup` table + `profile.freezer_capacity_estimate`)

**Per-tenant**. Bulk-buy watchlist. Stored as `stockup(tenant, name, normalized_name, unit, typical_purchase, notes, baseline_price, buy_at_or_below)` rows (deduped by normalized item `name`), with the top-level `freezer_capacity_estimate` on the `profile` row. **Agent-writable via `update_stockup`** (add-only) as well as hand-edited; seeded at onboarding.

```sql
-- D1 stockup table — one row per watchlist item. PRIMARY KEY (tenant, normalized_name).
tenant            TEXT  -- owning user
name              TEXT  -- display name (e.g. "chicken thighs")
normalized_name   TEXT  -- normalized for dedup/lookup
unit              TEXT  -- purchase unit (e.g. "lb", "count")
typical_purchase  TEXT  -- typical buy amount (e.g. "5 lb")
notes             TEXT  -- freeform preference notes (e.g. "Bone-in skin-on preferred")
baseline_price    REAL  -- ADVISORY reference price; not a gate
buy_at_or_below   REAL  -- ADVISORY trigger price; not a gate

-- profile.freezer_capacity_estimate (TEXT column on the profile row):
-- tight | moderate | spacious — informs how aggressively to act on stockup opportunities
```

Example rows:

| tenant | name | normalized_name | unit | typical_purchase | notes | baseline_price | buy_at_or_below |
|--------|------|-----------------|------|------------------|-------|----------------|-----------------|
| alice | chicken thighs | chicken thighs | lb | 5 lb | Bone-in skin-on preferred | 3.99 | 2.99 |
| alice | salmon | salmon | lb | 2 lb | Wild only | NULL | NULL |

**Notes:**
- `name` is the only required item field. `freezer_capacity_estimate` is a top-level scalar (serialized before the `[[items]]` tables) and must precede them in TOML.
- **`baseline_price` / `buy_at_or_below` are advisory, not gates.** No Worker logic keys on them: `kroger_flyer(against_stockup)` scans stockup item *names* only, and "is this a good price?" is the agent reasoning over the live flyer price (and any learned baseline). They are optional — onboarding does not prompt for them, since members rarely know exact numbers.

## sku_cache (D1, shared corpus)

Machine-maintained SKU cache in the **shared corpus** (`sku_cache` table) — a mapping resolved by any member warms it for everyone. Written by `place_order` as the matching pipeline resolves ingredients. Each entry is **tagged with the `location_id`** it was resolved at.

```sql
-- D1 sku_cache table (migrations/d1/0006_shared_corpus.sql)
-- PRIMARY KEY (ingredient, location_id)

ingredient   TEXT  -- normalized ingredient name (e.g. "olive oil")
location_id  TEXT  -- Kroger locationId this was resolved at
sku          TEXT  -- resolved Kroger SKU
brand        TEXT  -- brand name of the resolved product
size         TEXT  -- size/weight string of the resolved product (e.g. "16.9 fl oz")
last_used    TEXT  -- ISO date of last use (informational; used for cache pruning)
```

Example rows:

| ingredient     | location_id | sku            | brand               | size        | last_used  |
|----------------|-------------|----------------|---------------------|-------------|------------|
| olive oil      | 01400376    | 0001111046025  | Simple Truth Organic| 16.9 fl oz  | 2025-05-15 |
| chicken thighs | 01400943    | 0001111091234  | Kroger              | 1.5 lb pack | 2025-05-14 |

**This is a speed cache, not the source of truth for dispositions.** It stores *resolved SKUs* to skip the expensive search/narrowing; the *disposition* (care / don't-care / ranked) lives in each member's `profile` row / `brand_prefs` rows. **Shared + location-tagged:** an entry tagged with the caller's own location is tried first, but every hit is revalidated against the caller's `preferred_location` for current price + curbside/delivery availability before use — a cross-location entry not carried at the caller's store falls through to a fresh search, so a shared cache can never serve an unavailable SKU. No TTL; `last_used` is informational (for pruning). "Don't care" commodities (`[]` in preferences) carry no pinned SKU here; they re-resolve to cheapest-acceptable each run. (An entry with no `location_id` is treated as same-location and still revalidated.)

## taste (per-tenant, D1 `profile.taste`)

User-curated narrative. Free-form markdown. Agent edits only when directed (via `update_taste`). Stored as the `taste` markdown column on the singleton `profile` row.

```markdown
# Taste profile

## Loves
- Anything with crispy skin (chicken thighs, fish skin)
- Bright, acidic dressings
- Fermented things — kimchi, miso, vinegars
- ...

## Dislikes
- Cilantro (genetic — to me it's soap)
- Overcooked vegetables
- ...

## Notes
- Generally prefer sheet-pan or one-pot for weeknights; reserve elaborate techniques for weekends
- Open to spice but not heat for the sake of heat
- ...
```

## diet_principles (per-tenant, D1 `profile.diet_principles`)

User-curated rules with reasoning. Free-form markdown. Agent edits only when directed (via `update_diet_principles`). Stored as the `diet_principles` markdown column on the singleton `profile` row.

```markdown
# Diet principles

## Variety targets
- Fish at least once per week (omega-3s, mix up the protein rotation)
- One vegetarian dinner per week (cost, environmental, palate variety)
- No single cuisine more than twice per week

## Restrictions
- ...

## Reasoning
[Explanation of why these principles, so the agent honors the spirit, not just the letter]
```
