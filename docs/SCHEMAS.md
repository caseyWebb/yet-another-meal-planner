---
update-when: a data file's schema or the validation rules change
---

# SCHEMAS.md — Data File Reference

Concrete schemas with example values for every data file in the repo. Keep this in sync with the actual files — when you add a field, update here first, then update the file. Validation runs in two places: the Worker's scheduled recipe-index reconcile (`src/recipe-projection.ts`, the full validator over the **R2 corpus**) and a *structural subset* in the Worker's `src/validate.ts` (at write time). The reconcile validates the authored recipe corpus; a recipe failing the contract is skipped and recorded in the D1 `reconcile_errors` table (below). The **D1-backed** per-tenant profile (preferences/taste/diet_principles/kitchen/staples/overlay/ready_to_eat/stockup), the **D1-backed** session state (the `pantry`/`meal_plan`/`grocery_list` tables), and the **D1-backed** `cooking_log` are validated **only by the Worker at write time** (`update_preferences`' merge-patch validation for preferences, `log_cooked` for the cooking log), never by the reconcile.

## File placement: shared vs per-tenant (multi-tenant data model)

The data lives in three tiers (see `ARCHITECTURE.md`): the authored markdown corpus in an **R2 bucket** (bound as `CORPUS`), all operational/relational + derived data in **D1**, and ephemeral infra in **KV**. Every artifact below lives in exactly one:

- **Authored markdown (R2 bucket `CORPUS`)** — the human-editable tier (an Obsidian vault synced to the same bucket): `recipes/*.md` (objective frontmatter + body) and the `guidance/**/*.md` umbrella (`guidance/ingredient_storage/` — curated put-away advice, read-only; `guidance/cooking_techniques/` — technique memories, agent-writable via `save_guidance`; `guidance/purchasing/` — buy-side selection advice, also agent-writable). Object keys are repo-relative paths (`recipes/<slug>.md`, `guidance/<domain>/<slug>.md`); read/written through `src/corpus-store.ts`. There is no GitHub App or data repo on the data path.
- **Shared corpus (D1, `migrations/d1/0006_shared_corpus.sql` + `0033_ingredient_identity.sql`)** — objective, single-source, read by everyone: the ingredient identity graph (`ingredient_identity`/`ingredient_alias`/`ingredient_edge` + the `novel_ingredient_terms` queue + `ingredient_normalization_log`), `sku_cache(ingredient, location_id, …)`, `flyer_terms(term)`, `stores(slug, name, domain, extra /*json*/)` (in-store-walk registry — identity columns `slug`/`name`/`domain` are top-level; optional identity fields `label`/`chain`/`address`/`location_id` are stored in the `extra` JSON column; layout lives in store notes), `feeds(url, …)` (RSS discovery feeds), `discovery_candidates(id, url UNIQUE, status, …)` (forwarded-newsletter inbox + group-wide rejection log; `status` values: `pending` | `rejected` — `pending` is the default for unprocessed candidates, `rejected` is set by `reject_discovery`), `discovery_senders`/`discovery_members` (inbound-email allowlist). Written + validated at the Worker write tools; read by query. The recipe index is the derived D1 `recipes` table — there is no `_indexes/recipes.json`.
- **Attributed records (D1 `recipe_notes` / `store_notes`)** — each member's attributed recipe/store notes, stored in D1 tables carrying `author` (the writing member id, set by the Worker; founding member = tenant id for pre-split rows). Recipe notes carry a visibility **`tier`** (`public | friends | private`, default `friends`) with the legacy `private` column dual-written; store notes keep the binary `private` flag. Both tables use `id TEXT PRIMARY KEY` (a generated stable key); `recipe`/`slug` (the recipe or store slug), `author`, `body`, `tags`, `private`, and `created_at` are ordinary columns (not the primary key). `read_recipe_notes` returns the caller's own notes plus the tier-admitted notes in one members-joined query, joined with the overlay favorites.
- **Per-tenant D1 (the profile)** — each member's grocery **profile** lives in normalized D1 tables (`migrations/d1/0004_profile.sql`): a singleton `profile` row (the markdown fields `taste`/`diet_principles`, the preference scalars `planning_cadence_days`/`weekly_budget`, the per-meal `cadence` JSON map (migration 0052 — the planning-frequency preference), the JSON columns `stores`/`dietary`/`rotation`/`custom`/`kitchen_notes`, `freezer_capacity_estimate`, `last_planned_at`, and the FROZEN legacy columns `default_cooking_nights` (readable — the cadence read-fallback — but no writer) / `lunch_strategy` / `ready_to_eat_default_action` (retired; converge to NULL via the pref-retirement cron and drop, with `default_cooking_nights`, at the deprecation-window close) — the per-tenant planning watermark, migration 0016, stamped by `update_meal_plan` on an add and read by `list_new_for_me`), plus child tables `brand_prefs(tenant, term, tiers, any_brand)`, `kitchen_equipment(tenant, slug)`, `staples(tenant, name, normalized_name, perishable)`, `overlay(tenant, recipe, favorite, reject)` (the two mutually-exclusive disposition marks; there is no `status` lifecycle or `rating` column), `ready_to_eat(tenant, slug, meal, name, favorite, reject, category, source, brand, notes)`, and `stockup(tenant, name, normalized_name, unit, typical_purchase, notes, baseline_price, buy_at_or_below)`. `idx_overlay_recipe` powers the cross-tenant group-favorites query. Reads assemble the agent-facing objects from these rows (`src/profile-db.ts`); writes mutate rows — no document format on the profile path.
- **Per-tenant D1 (session state)** — each member's working state lives in D1 row tables (`migrations/d1/0005_session_state.sql`): `pantry(tenant, name, normalized_name, quantity, category, prepared_from, added_at, last_verified_at, notes)`, `meal_plan(tenant, id /*opaque row id — PRIMARY KEY (tenant, id), migration 0052*/, recipe, meal /*breakfast|lunch|dinner|project, default dinner*/, planned_for, sides /*json*/, from_vibe /*meal-vibe slot provenance, migration 0026; advisory, never slug-resolved*/)`, `grocery_list(tenant, name, normalized_name, quantity, kind, domain, status, source, for_recipes /*json*/, note, added_at, ordered_at, sent_in /*internal send-record linkage, migration 0051*/)` — keyed by normalized name (pantry/grocery) or the opaque row id (meal plan — per-slot identity, D26-final: `id` is a client- or server-minted ULID, or the migration's one-time 32-hex mint; formats mix, so nothing ever parses or meaningfully sorts an id, and `id ASC` is only an arbitrary-but-deterministic tiebreak; there is deliberately NO unique index on `(tenant, recipe)` — a recipe may occupy several rows by explicit user action, and uniqueness lives in the op layer's slug-global coalesce; project rows carry no date and no sides, enforced at the op layer, not by a CHECK), with `meal_plan_tenant_recipe(tenant, recipe)` backing the slug ops, `idx_grocery_status(tenant, status)` and `idx_pantry_category(tenant, category)` backing the read filters. Adds are row upserts (`INSERT … ON CONFLICT DO UPDATE`), removes/status changes are targeted row statements — no whole-array rewrite, strong read-after-write consistency. (The detailed item shapes are below.) The Worker read path has **no** GitHub/KV fallback — a miss returns empty/null.
- **Shared operational D1 (reconcile + bug reports + discovery log)** — group-wide (not per-tenant) operational tables the Worker owns: `reconcile_errors(slug, path, message, recorded_at)` (`migrations/d1/0014_reconcile_errors.sql`) — recipes the index reconcile **skipped**, replaced wholesale each pass; `bug_reports(id, reporter, title, body, created_at, status)` (`migrations/d1/0015_bug_reports.sql`) — agent-filed bug reports, `reporter`/`created_at` attributed server-side; and `discovery_log(id, url, title, source, outcome, slug, detail, created_at)` (`migrations/d1/0016_background_discovery.sql`) — the discovery sweep's per-candidate outcome log, one table serving three roles (operator audit, intake dedup, parked-error surface), retention-pruned. (The detailed shapes are below.)
- **Sweep-/reconcile-owned per-member D1 (discovery sweep)** — group-wide *attribution + taste* tables the discovery sweep owns (`migrations/d1/0016_background_discovery.sql`): `discovery_matches(recipe, tenant, member, score, matched_at)` — per-member match attribution (the import gate **and** the `list_new_for_me` filter); and `taste_derived(tenant, taste_hash, embedding, updated_at)` — each member's taste-text embedding, content-hash gated like `recipe_derived`. Like `recipe_derived`, these are **siblings of `recipes`** so the index projection's wholesale `recipes` rebuild never owns them. (The detailed shapes are below.)
- **Visibility grants (D1 `recipe_imports`, migration 0059)** — the canonical grant relation behind the recipe **visibility lens**: one provenance row per `(recipe, household)`, written at creation by every import path and read by the one lens enforcement point (`src/visibility.ts`). Included in a tenant purge; untouched by a member revoke (the grant belongs to the household). (The detailed shape is below.)

**Three-category recipe model:** a recipe's *content* (objective frontmatter + body) is shared markdown in the R2 corpus; its *overlay* (`favorite` + `reject`) is per-tenant in the D1 `overlay` table; its *notes* are per-member, attributed, append-mostly in the D1 `recipe_notes` table (`id TEXT PRIMARY KEY`, `recipe`, `author`, `body`, `tags`, `tier`, `private`, `created_at`). `last_cooked` is **not stored** — it's derived per-tenant from the D1 `cooking_log` table (`MAX(date)` per recipe). Read tools merge shared content + the caller's overlay + cooking-log `last_cooked` at read time.

The shared corpus, profile, session state, cooking log, and attributed notes are all **D1 tables** (see the placement list above and `migrations/d1/*.sql`), not repo files. Per-artifact sections below document each artifact's current D1 column shape.

### preferences shape + merge-patch contract

`preferences` is reconstructed from the `profile` row + `brand_prefs` rows into a defined top-level surface plus an open `custom` bag:

```jsonc
{
  "cadence": { "breakfast": 0, "lunch": 2, "dinner": 3 },  // per-meal weekly counts (0–7 each) WITHIN the planning
                                               //   window — the planning-frequency preference (stored as the
                                               //   profile row's `cadence` JSON column; merged PER KEY)
  "planning_cadence_days": 7,                  // number — how far out the caller plans/shops (days); drives propose_meal_plan's weather horizon + vibe-recurrence caps
  "weekly_budget": 95,                         // number ≥ 0 — the household's weekly grocery budget (dollars/week); unset or 0 = no budget line (echoed by retrospective's spend section)
  "stores":  { "primary": "kroger", "preferred_location": "Kroger - 76104", "location_zip": "76104" },
  "brands":  { "olive_oil": { "tiers": [["California Olive Ranch"]], "any_brand": false },
               "yellow_onion": { "tiers": [], "any_brand": true } },
  "dietary": { "avoid": [], "limit": ["cilantro"] },
  "curated_hide": true,                        // boolean, defined key — true hides the CURATED recipe tier from the
                                               //   whole household's visibility lens (profile.curated_hide column);
                                               //   present in the export only when set (shown is the default)
  "custom":  { /* arbitrary agent-added keys */ }
}
```

`update_preferences` takes a `patch` and applies **JSON Merge Patch (RFC 7396)**: a present key sets, `null` deletes, nested objects merge to any depth, arrays replace wholesale. Validation is staged — an unknown top-level patch key is rejected toward `custom` (`validation_failed`), then the merged result's types are validated (`malformed_data` on a bad enum/shape, storing nothing). The whole patch applies in one D1 transaction. Each `brands` family value is a **tier object** and maps onto rows: a family present in the patch UPSERTs the **merged** family value into that `brand_prefs` row's `tiers`/`any_brand` columns (a partial family patch like `{ any_brand: true }` merges into the stored object — tiers preserved), `null` DELETEs the row (back to ambiguous = "ask me"), and an absent term leaves its row untouched. For one deprecation window a legacy flat rank list is accepted-and-converted with a `warnings` entry on the return (see docs/TOOLS.md's deprecation convention). `cadence` merges **per key** (`{ cadence: { lunch: 2 } }` sets lunch only; `{ cadence: { dinner: null } }` clears one key; `cadence: null` clears the map). `curated_hide` must be a boolean when present (`null` deletes it, back to the shown default). For the same window `default_cooking_nights: N` is accepted as an **alias** merged onto `cadence.dinner` (the frozen column is never written), and the retired `lunch_strategy` / `ready_to_eat_default_action` keys are **accepted and dropped** — each flagged in `warnings`. The **profile export** (`read_user_profile`) always carries `cadence` (the stored map, or the read-time derivation `{ breakfast: 0, lunch: 0, dinner: default_cooking_nights ?? 5 }` when unset) and mirrors `default_cooking_nights` from the effective `cadence.dinner` for the window; the retired pair never appears in the export.

## Recipe frontmatter (recipes/*.md)

YAML frontmatter at the top of each recipe markdown file. Body below is freeform markdown.

```yaml
---
title: Lemon Garlic Roasted Chicken
tags: [chicken, mediterranean, sheet-pan, weeknight]
protein: chicken                # controlled vocab: chicken | beef | pork | lamb | turkey | fish | shellfish | egg | tofu | vegetarian | vegan | mixed
cuisine: mediterranean          # controlled vocab (coarse buckets); see the cuisine list below
course: [main]                  # OPEN-vocab dish type (main | side | dessert | breakfast | component | …); string or array; classified at import; index-normalized to a lowercased array
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
- **The descriptive facets are DERIVED on the cron, not authored.** `protein`, `cuisine`, `course`, `season`, `tags`, `ingredients_key`, `ingredients_full`, `perishable_ingredients`, `side_search_terms`, and `meal_preppable` are classified from the body by the **classify pass** (`recipe-facet-derivation`) into the D1 `recipe_facets` table and **merged into `recipes`** by the projection. They are **optional in frontmatter**: absent → the classifier supplies them; present → an authored **override** (Tier B: `protein`/`cuisine`/`course`/`season`/`tags`, vocab-validated, wins over the classifier; `tags` is unioned) or a pre-migration legacy value (Tier A: the rest, classified-wins). The YAML example above shows them for illustration — a new recipe may omit them all (body-only). See *recipe_facets* below.
- **Required-field contract (authored gates + identity).** The contract governs only the **authored** fields — the two hard gates plus identity. It is defined once in `src/recipe-contract.js` (`validateRecipeContract`), imported by the Worker write-time validator (`src/validate.ts`), the index reconcile (`src/recipe-projection.ts`), and the classifier (`src/discovery-classify.ts`); a **hard failure** at write time and a **skip-and-record** at reconcile time. **One function serves both callers:** AUTHORED frontmatter omits the derived keys (relaxed); the CLASSIFIER's output sets every key (fully validated against vocab + the `course`→`side_search_terms` rule), so the classifier's backstop is preserved.
  - **Required (authored), non-empty:** `title`.
  - **Required (authored), value or explicit `null`:** `time_total` (number or `null`), `source` (URL string or `null`).
  - **Required (authored), may be `[]`:** `dietary`, `pairs_with`, `requires_equipment` (an `EQUIPMENT_VOCAB` array). `dietary` + `requires_equipment` are the **hard gates** kept authored — a wrong AI value risks allergen exposure / silently hiding a makeable recipe.
  - **Optional (derived), validated when present:** Tier B `protein`/`cuisine` (vocab value or `null`), `course` (non-empty array), `season` (`SEASON_VOCAB` array), `tags`; Tier A `ingredients_key` (non-empty array), `ingredients_full` (non-empty array), `perishable_ingredients`, `side_search_terms` (non-empty iff `course` includes `main`), `meal_preppable` (boolean). `description` is likewise not authored (see *recipe_derived*).

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
- `duplicate_of`: the **operator-merge tombstone** (`recipe-dedup`) — a non-empty string naming the surviving recipe's slug. Written **only through the operator-confirmed merge flow** (the agent-guided review of a `merge_recipes` proposal; it rides `update_recipe`'s pass-through frontmatter). The projection treats it as a **deliberate exclusion**: the marked file projects **no** `recipes` row and **no** `reconcile_errors` row (a curation decision, not a defect; counted as `tombstoned` in the projection summary), so the recipe leaves search/menu-generation/list on the next tick and its derived rows (`recipe_derived`, the `dup_scan` stamp) converge via the existing orphan prunes. **Reversible and non-destructive**: the R2 file, member notes, and cooking-log history stay intact, and removing the field restores the index row on the next projection. An empty-string value is ignored (projects normally). It is a narrow redirect marker, not a lifecycle state — there is still no `status` field and no `draft` limbo.
- Disposition is **per-tenant and opt-out**: a recipe with no overlay row is **available** to that member by default. A member's feedback either favorites it (`toggle_favorite`) or hides it (`toggle_reject` → a hard gate that drops it from their `search_recipes` results) — the two are mutually exclusive, and one member's disposition never changes another's. There is no `active`/`draft` lifecycle and no per-member curated set.
- `pairs_with`: slugs of other recipes, **required (may be `[]`)**. A *plating* edge — recipes eaten together on one plate (a main's companion **corpus** sides). Each slug MUST resolve to a real recipe (a reconcile skip-and-record otherwise — the dangling-`pairs_with` cross-corpus check); corpus sides are themselves recipes, so they reuse the normal import/grocery-list pipeline. Objective **shared content** (carried in the D1 `recipes` table, written by `update_recipe`) — not a per-tenant overlay field. **Primarily authored by the `recipe-sides` flow** — the standalone "sides for X" flow records the edge when a corpus side is confirmed for a corpus main; the **meal-plan** flow only **backfills** it opportunistically, for a pairing it confirms while composing a menu (both filter side candidates with `course: side`). **Open-world sides** — trivial preparations with no recipe file — are not recorded here (no slug to remember) and ride on the main's meal-plan row instead (the D1 `meal_plan` table's `sides` JSON column).
- `course`: **required, non-empty** — an **open-vocabulary** classification of what kind of dish the recipe is — one or more of `main`, `side`, `dessert`, `breakfast`, `component` by convention (`component` = a **sub-recipe/building block** — a dough, a stock, a spice blend, a base sauce made to be used inside other dishes — not plated as its own course), but **any** string is allowed (e.g. `sauce`, `baked_good`) with **no controlled set and no code change** to extend it (contrast `protein`/`cuisine`, which ARE controlled). Authored as a string or an array of strings; the projection **normalizes** it to a lowercased, trimmed **array** (so `Main` → `["main"]`). A recipe that plates as more than one course carries multiple values (`course: [main, side]`). An absent or empty `course`, or a non-string/array value, is a Worker write-time / reconcile **hard failure** (rejected on write, skip-and-recorded by the reconcile); the *values* are never checked against a set. Objective **shared content** carried in the D1 `recipes` table, classified at import by `create_recipe` (and editable via `update_recipe`); `search_recipes` filters it by **containment**. The **meal-suggestion surfaces** (`propose_meal_plan`'s pools, the app's picked-for-you/trending rows) additionally gate on it by default: a recipe is a **meal candidate** when its effective `course` includes `main` or is empty (fail-open for a not-yet-classified recipe — `isMealCourse`, `src/recipes.ts`), so a component/side is never volunteered as a dinner. (`standalone` is **not** a contract field — whether a main is an already-rounded plate is inferred by the agent at plan time, not persisted; a lingering `standalone` field is ignored, never validated or indexed.)
- `perishable_ingredients`: **required array (may be `[]`)** — a **normalized** list of the recipe's perishable ingredients, feeding the menu-gen waste callout (a partial-unit perishable that no other proposed recipe uses). **Derived at import, not hand-maintained:** the import/create flow classifies it alongside `protein`/`cuisine`. The classification test is *"would the leftover rot before I'd realistically use it?"* — not botany — so shelf-stable staples (olive oil, canned beans) are excluded and a small amount of a fast-spoiling item is included; fuzzy edges (eggs, potatoes) are fine since a wrong call only costs a dismissed nudge. Names use the **same normalization the pantry-verify matcher applies** (`normalizeIngredient`), applied at write time by `create_recipe`/`update_recipe` — and the projected `recipes` value is **re-resolved through the current ingredient resolver at each index projection** (same funnel and snapshot semantics as `ingredients_key` above) — so a perishable lines up across recipes for overlap detection. Present-but-not-a-string-array is a write-time / reconcile hard-failure (like a non-boolean `standalone`). Objective **shared content** carried in the D1 `recipes` table — not a per-tenant overlay field, not curated config. Hand-edit only to correct a misclassification.
- `description`: **Worker-derived (not authored frontmatter)** — a **brief AI-written summary** of the dish (~1–2 sentences) in a consistent, craving-aligned register (identity, flavor/texture, when you'd want it) — **not** the scraped marketing copy. It is the single semantic-identity field that powers meal-plan retrieval: the source the recipe **embedding** is derived from, the compact per-candidate row loaded into context, the user-facing "why this dish," and the dedup signal. It is **Worker-DERIVED, not authored**: generated from the recipe's facets (`env.AI`) and stored in D1 (`recipe_derived`, alongside the embedding it feeds), reconciled on the cron and seeded synchronously at import — see ARCHITECTURE and *recipe_derived* below. It is **not** a frontmatter field and **not** in the required-field contract; `read_recipe`/`search_recipes` merge it at read time (absent until the reconcile first generates it).
- `side_search_terms`: **required** — an array of AI-memoized phrases describing the *kind of side that complements this main* ("a crisp acidic green salad", "crusty bread for the sauce"), **non-empty when `course` includes `main`** and `[]` otherwise. Written at import; used as the **semantic side-retrieval query** so the complementarity judgment is captured once and the retrieval is plain similarity (the terms describe the side you want, not the main). Additive — does **not** replace curated `pairs_with` (the deterministic, slug-resolved pairing). Validated at Worker write time and by the reconcile. Objective **shared content**.
- `protein` and `cuisine` are **controlled vocabularies** (coarse buckets — `fish` not `salmon`) so variety reasoning is reliable. Both are **required-present** (the contract above), carrying either an in-vocabulary value or the explicit literal `null`. A value **present** but outside its set is a hard failure **at both write time (the Worker, `src/validate.ts`) and reconcile time (`src/recipe-projection.ts`, skip-and-record)** — `create_recipe`/`update_recipe` reject an off-vocab value with `validation_failed` and write nothing, so it never reaches the corpus. A dish with **no protein focus** — a side, a plain noodle/grain dish, a condiment — carries **`protein: null`** (present and explicit); an omitted field or a `none`/`""` value is rejected, prompting `null`. The allowed sets are defined **once** in the shared `src/vocab.js`, imported by both validators so they cannot drift; extending a vocabulary is a deliberate edit there. Current cuisine set: `american, brazilian, cajun, caribbean, chinese, cuban, filipino, french, german, greek, indian, italian, japanese, korean, mediterranean, mexican, moroccan, peruvian, southwestern, spanish, thai, vietnamese`.
- `requires_equipment`: **required array (may be `[]`)** of `EQUIPMENT_VOCAB` slugs naming gear a dish is genuinely **impossible** without — the "no recipe-preserving workaround exists" test. **`[]` is the overwhelming common case**; tag only truly-irreplaceable equipment, since a wrong tag silently hides a makeable recipe. A controlled vocabulary like `protein`/`cuisine` (an off-vocab slug = hard failure **at both write time and reconcile time**, from the same shared `src/vocab.js`). Objective **shared content** carried in the D1 `recipes` table, written by `create_recipe`/`update_recipe`. Drives the `search_recipes` makeability gate against a member's kitchen `owned` list (the D1 `kitchen_equipment` rows). Current set: `pressure-cooker, sous-vide-circulator, blender, ice-cream-maker`.
- `season`: **required array (may be `[]`)** of `SEASON_VOCAB` tokens — a **controlled vocabulary** like `protein`/`cuisine`/`requires_equipment`, validated at **both write and reconcile time** from the shared `src/vocab.js` (an off-vocab token is a hard failure; `autumn` is rejected in favor of `fall`). `[]` means **year-round**. Drives the retrospective's in-season `underused` surfacing (a non-empty `season` not including the current Northern-hemisphere season is treated as out of season). Read paths normalize legacy values (case-fold + `autumn`→`fall`) so a pre-enforcement value still matches on read; a non-canonical *stored* value must be corrected to the vocabulary before it is re-written or re-projected under the gate. Current set: `spring, summer, fall, winter`.
- `ingredients_key`: **required, non-empty** — the top 5–7 defining ingredients for filtering and the pantry-overlap re-rank. The full ingredient list is derived separately (`ingredients_full`, below); the body remains the authored source. **Normalized through the alias table on write** (`create_recipe`/`update_recipe`, same matcher as `perishable_ingredients`) so names line up across recipes. The projected `recipes` value is additionally **re-resolved through the current ingredient resolver at each index projection** (the `IngredientContext` funnel — surviving full canonical ids, with unplaced terms enqueued for capture), so an alias or synonym-merge improvement reaches the index within one tick; the stored `recipe_facets` value is the classify-time snapshot and is never rewritten.
- `ingredients_full`: **Tier A derived (never authored)** — the recipe's **complete** ingredient list as plain, alias-normalized canonical ids (no amounts, no prep clauses, no optional-markers; a disjunctive line records its primary), one more output field on the **same** classify call that derives `ingredients_key` (no extra model call). The deterministic source the **plan→to-buy derivation** reads (`read_to_buy`, `place_order`, the satellite pull-list): the meal plan's ingredient needs are computed from it at read time, joined against the pantry on canonical ids. Same normalization + snapshot semantics as `ingredients_key`: classify-time snapshot in `recipe_facets`, projected into `recipes` **re-resolved through the current resolver** each tick. Superset-of-`ingredients_key` is deliberately NOT enforced — the two are independent classifier outputs. NULL/empty until derived; consumers treat a not-yet-derived recipe as an explicit reported gap (`underived`), never as an empty ingredient list. Columns added (and the classify gate cleared for organic whole-corpus re-derivation) by migration 0040.
- **The recipe index is the D1 `recipes` table — not a file.** The Worker's scheduled **reconcile** (`src/recipe-projection.ts`) reads the whole R2 corpus, validates every `recipes/*.md` object, then **projects** the shared objective set into the D1 `recipes` table, replacing it wholesale in one transaction (`DELETE` then batched `INSERT`) so a removed recipe loses its row and the table is a deterministic function of the R2 corpus. A recipe that fails validation is **skipped** (left out of the index) and recorded to the D1 `reconcile_errors` table. There is **no** `_indexes/recipes.json`. The Worker reads the index from D1 (`src/recipe-index.ts`, built on `src/db.ts`). A *provisioned-but-empty* table is a valid empty corpus (a vibe-less `search_recipes` spec returns `{ results: [{ label, recipes: [] }] }`); an *unreadable* table (D1 unreachable / unmigrated) surfaces as `index_unavailable`. A fresh database is populated by the first reconcile pass over the R2 corpus (the bootstrap guarantee).

  The `recipes` table holds **objective shared content only** (no per-tenant `favorite`/`reject`/`last_cooked`): scalar columns `slug` (PK), `title`, `protein`, `cuisine`, `time_total`, `discovered_at` (the recipe's `discovered_at` frontmatter, `YYYY-MM-DD`; null when not a dated import), `ingredients_key` (a JSON array as TEXT), `source_url` (the recipe's `source` frontmatter); JSON-array columns `ingredients_full`, `tags`, `course`, `season`, `dietary`, `pairs_with`, `perishable_ingredients`, `requires_equipment`, `side_search_terms`; and an `extra` JSON object carrying any other objective frontmatter (so a new field is lossless without a migration until promoted to a queryable column). `idx_recipes_source_url` makes the discovery idempotency check an indexed lookup, and `idx_recipes_discovered_at` makes `list_new_for_me`'s `WHERE discovered_at > <watermark>` an indexed range scan. `discovered_at` is **promoted out of `extra` to its own column** (migration 0016) precisely so the new-for-me read can filter on it; the projection writes it from each recipe's frontmatter. Schema: `migrations/d1/0002_recipes.sql` (+ `0016_background_discovery.sql` for `discovered_at`).

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
- `ingredients_key`, `ingredients_full`, `perishable_ingredients`, `side_search_terms` — classified JSON-array columns, alias-normalized for the first three. **Tier A** (derived-only; an authored value is a pre-migration legacy fallback). The ingredient columns are the **classify-time snapshot**: the index projection re-resolves them through the current resolver on every rebuild (so `recipes` may carry a different — current — id than the row here), and only a reclassification rewrites them. `ingredients_full` (migration 0040) is the complete list the plan→to-buy derivation reads; NULL/empty means not yet derived (`underived` to consumers).
- `meal_preppable` — classified boolean (0/1), NULL until classified. **Tier A**; currently has no consumer (rides `recipes.extra`).

**Effective-facet merge** (the projection, `src/recipe-facets.ts`): Tier A → classified (authored legacy only as fallback); Tier B → `authored ?? classified`; `tags` → `authored ∪ classified`; Tier C (`dietary`, `requires_equipment`, `time_total`, `pairs_with`) → authored, untouched. A not-yet-classified recipe projects its derived facets as empty (not an error). After the merge, the projection re-resolves the effective `ingredients_key`/`ingredients_full`/`perishable_ingredients` through the current ingredient resolver (see the recipe schema notes above) — this covers the authored Tier-A fallbacks too.

## display_recipe structuredContent (RecipeCardData, `@yamp/contract`)

The wire shape the `display_recipe` tool returns as its result's `structuredContent`, and the shape the bespoke `ui://recipe/card` widget hydrates from (recipe-card-widget). Defined once in the runtime-agnostic `@yamp/contract` package (`packages/contract/src/recipe-card.ts`) so the Worker (workerd) that produces it and the browser widget that consumes it share **one** definition and cannot drift. It is a **read projection** of a recipe read — `read_recipe`'s reader (`readRecipeDetail`) yields the overlay-merged frontmatter + markdown body, mapped onto the display fields the card shows. Not stored: it is assembled per call, never persisted. The card is the conversation's guided-cook surface (D32): it carries cook mode plus the `favorite`/`log_cooked` writes it performs through the MCP Apps bridge (see [`TOOLS.md`](TOOLS.md)).

- `contract_version` (number, optional) — the payload's contract version (D19), stamped by the Worker (`KNOWN_RECIPE_CONTRACT_VERSION`, currently `2`). A widget on an older build renders **read-only** when this exceeds the version it knows; `undefined` reads as `1`. Versioned **independently** of `ProposeCardData`; additive-only within a major (v2 added the optional `cook` block).
- `slug` (string) — the recipe's slug (its stable corpus id).
- `title` (string) — display title (falls back to the slug when the frontmatter has none).
- `description` (string, optional) — the AI-derived ~1–2 sentence summary, merged from `recipe_derived` at read time; absent until first generated.
- `time_total` (number | null) — total time in minutes, or `null` when the recipe declares none.
- `dietary` (string[]) — dietary hard-gate tags; may be empty.
- `tags` (string[], optional) — free Tier-B tags, when present.
- `protein` (string | null, optional) — primary protein facet (Tier B), or `null`.
- `cuisine` (string | null, optional) — cuisine facet (Tier B), or `null`.
- `course` (string[], optional) — open-vocabulary dish-type facets (Tier B), when present.
- `requires_equipment` (string[], optional) — the `EQUIPMENT_VOCAB` slugs the recipe truly requires, when present.
- `favorite` (boolean, optional) — the caller's `favorite` overlay mark (merged from the per-tenant `overlay` table). The widget re-hydrates this via `read_recipe` at boot before enabling writes (D19).
- `body` (string) — the recipe's markdown body (Ingredients/Instructions), rendered escape-first in the card.
- `cook` (`CookModeData`, optional) — the structured cook-mode data (D32), when a skill supplies it. Absent for a plain `display_recipe`; the widget then parses `body` client-side (`@yamp/ui`'s `parseCookBody`) to the same shape, so every card is cook-capable. Shape:
  - `base_servings` (number | null, optional) — the serving count the amounts are stated at. Carried for provenance; v1 renders no serving-scale control.
  - `ingredients` (`{ id, text, group? }[]`) — the mise-en-place lines; `id` is the `{id}`-token key, `group` an optional authored ingredient subsection.
  - `steps` (`{ title?, content, timer_seconds? }[]`) — the ordered prep+cook steps; `title` is the step header / timer label, `content` the prose (with `{id}` ingredient tokens), `timer_seconds` set on steps that involve a wait.

## display_meal_plan structuredContent (ProposeCardData, `@yamp/contract`)

The wire shape the `display_meal_plan` tool returns as its result's `structuredContent`, and the shape the bespoke `ui://plan/propose` widget hydrates its interactive render from (meal-plan-widget). Defined once in the runtime-agnostic `@yamp/contract` package (`packages/contract/src/propose-card.ts`) so the Worker (workerd) that produces it and the browser widget that consumes it share **one** definition and cannot drift. Not stored: it is assembled per call from `runProposeMealPlan`'s result plus a little render context, never persisted. The **result-portion fields** mirror `propose_meal_plan`'s own `ProposeResult` exactly, so the widget parses **both** the initial payload and a dial-triggered `propose_meal_plan` re-invocation (proxied through the host, `App.callServerTool`) with one shape.

- `contract_version` (number, optional) — the payload's contract version (D19), stamped by the Worker (`KNOWN_PROPOSE_CONTRACT_VERSION`, currently `1`). A widget on an older build renders **read-only** when this exceeds the version it knows; `undefined` reads as `1`. Versioned **independently** of `RecipeCardData`; additive-only within a major.
- `plan` (ProposeCardSlot[]) — the proposed slots (one card per slot; **flat and meal-ordered**, breakfast → lunch → dinner, position-stable within each meal), mirroring `propose_meal_plan`'s `plan` field-for-field: `{ vibe_id, meal, reason, main, empty_reason?, alternates, alt_similar, alt_different, vibe_override?, recipe_pinned?, weather_category?, sides, uses_perishables, flags, why }` (see [`TOOLS.md`](TOOLS.md) `propose_meal_plan` returns for each field).
- `variety` (`{ distinct_proteins, distinct_cuisines, mean_pairwise_sim, max_pairwise_sim }`) — the week's cross-slot diversity summary (the variety bar).
- `uncovered_at_risk` (string[]) — at-risk items the plan could not cover (the honest "still going bad" list).
- `diagnostics` (`{ seed, lambda, nights, filled, empty, rolled_over?, meals?, attendance? }`) — the op's diagnostics: `meals` is the per-meal `{ requested, filled, empty }` map, `attendance` the `{ effective, ignored, notes? }` eating-set echo, and `nights` the one-window dinner alias of `meals.dinner.requested`.
- `note` (string, optional) — present only on the empty-palette short-circuit (an add-a-vibe nudge).
- `notes` (string[], optional) — the empty-meal escape nudges (`no_palette_for_meal`).
- `request` (ProposeCardRequest) — the request that produced `plan` (`{ nights, meals?, attendance?, seed, variety, proteins, freeform, exclude, slots }` — the palette-flow subset the member app's client session serializes, with `meals` carrying the resolved per-meal counts and `attendance` echoed when supplied); the widget seeds its client session from this and replays an adjusted copy against the stateless op on each control change.
- `vibeLabels` (Record<string, string>) — vibe id → its phrase, so each slot renders its vibe name (the result carries only the id).
- `palettePresets` (string[]) — the palette's vibe phrases, for the per-night "pick one of your vibes" panel.
- `proteins` (string[]) / `cuisines` (string[]) — the corpus facet universes, for the per-night facet-pin pickers.

## title_audit (D1 `title_audit` table — Worker-owned, shared)

The **title re-audit**'s one-shot convergence stamp (migration 0044, `recipe-title-audit`). The scheduled pass (`src/title-audit.ts`, the `title-audit` job in `scheduled()` phase 1) audits each projected recipe **once**: it runs the guarded title-clean judgment (the discovery classifier's word-subset guard — a cleaned title may only *remove* words, fail-open), rewrites only the R2 frontmatter `title` when the accepted clean name differs, and stamps the outcome here. A recipe with a row never re-enters the backlog (`recipes.slug NOT IN title_audit`); **new writes are born-stamped** by both import paths (the sweep's import and `create_recipe`, `outcome = 'kept'` — their titles are clean at birth), so the pass drains exactly the pre-existing corpus and quiesces to a ~0-LLM no-op. A **sibling of `recipes`** keyed by `slug` (like `recipe_facets`/`recipe_derived`) because the `recipes` projection is rebuilt wholesale and cannot carry a durable stamp. Slugs are **immutable ids** — the audit never renames a slug or moves an R2 object; only the display title converges, and it reaches the index/description/embedding through the existing reconciles (the recipe-derived `content_hash` covers the title; the facet gate hash does not, so no reclassification).

```sql
-- D1 title_audit table — one-shot title-audit stamp. PRIMARY KEY (slug).
slug         TEXT     -- recipe id (immutable; never renamed by the audit)
audited_at   INTEGER  -- epoch ms of the stamp
outcome      TEXT     -- 'kept' | 'cleaned'
before_title TEXT     -- the title as audited (or at birth, for a born-stamp)
after_title  TEXT     -- the rewritten title ('cleaned' outcomes only; NULL on 'kept')
```

## dup_scan (D1 `dup_scan` table — Worker-owned, shared)

The **corpus dup-scan**'s per-recipe watermark (migration 0045, `recipe-dedup`). The scheduled scan (`src/dup-scan.ts`, the `dup-scan` job in `scheduled()` phase 5) compares each embedded corpus recipe against the full description-vector set **once per state**: `scanned_hash` is `hashText(description_hash + "|" + ingredients_key JSON)` at scan time, so a recipe whose stamp is missing or differs from its current hash re-queues — a regenerated/re-embedded description changes `description_hash`, and a facet re-derivation that changes the effective `ingredients_key` changes the JSON half. A tick scans at most `DUP_SCAN_MAX_PER_TICK` (25) queued recipes, then stamps them; a fully-stamped corpus plans zero comparisons. Rows whose slug has left `recipe_derived` are **pruned by the job** each tick (so a tombstoned or deleted recipe cannot re-trigger detection). A **sibling of `recipes`** keyed by `slug` (like `recipe_facets`/`title_audit`) because the projection is rebuilt wholesale and cannot carry a durable stamp. When no operator tenant is configured the job stamps **nothing** (a recorded no-op), preserving the backlog for a later operator.

```sql
-- D1 dup_scan table — the dup-scan's per-recipe watermark. PRIMARY KEY (slug).
slug         TEXT  -- recipe id
scanned_hash TEXT  -- hashText(description_hash | ingredients_key JSON) at scan time
scanned_at   TEXT  -- ISO timestamp of the stamp
```

## taste_derived (per-member, D1 `taste_derived` table — Worker-derived)

Each member's **taste-text embedding** — the cold-start/taste signal the **discovery sweep**'s matcher scores a candidate against (alongside the member's favorited-recipe vectors). Derived from the member's authored `profile.taste` text via `env.AI` and **content-hash gated**, mirroring `recipe_derived`'s description/embedding gate exactly: it regenerates only when the taste text changes, so a steady profile does ~no work. Refreshed at the **start of each discovery-sweep tick** (a small reconcile pass, `src/taste-vector.ts`) and pruned for a member who clears their taste text or leaves the group. A NULL/absent vector means the member is matched on **favorites alone** (or the cold-start fallback). Keyed by `tenant`. Migration 0016.

```sql
-- D1 taste_derived table — one row per member. PRIMARY KEY (tenant).
tenant     TEXT  -- owning member
taste_hash TEXT  -- hash of the profile.taste text the vector was built from (the regeneration gate)
embedding  TEXT  -- JSON array of EMBED_DIM floats as TEXT; NULL until first derived
updated_at TEXT  -- ISO timestamp of the last (re)embed
```

## meal vibes (per-tenant — stored in the D1 `night_vibes` + `night_vibe_derived` tables)

Each member's **meal-vibe palette** — the durable, editable "shape of a week" `propose_meal_plan` samples per meal (meal-vibe-palette capability, migrations 0025 + 0052). A meal vibe is a saved `search_recipes` spec (a `vibe` phrase + optional `facets`) plus a `meal` dimension (`breakfast | lunch | dinner` — projects are never vibe-driven), an optional `members` assignment (D29-final; NULL = everyone), and lifecycle metadata. The tables deliberately keep their `night_vibes`/`night_vibe_derived` names — D21 renamed the tool family only. Per-tenant PRIVATE profile data (siblings of `staples`/`stockup`), never shared; written by the `add_/update_/remove_meal_vibe` tools and their `*_night_vibe` aliases (`src/night-vibe-db.ts`). The per-vibe embedding lives in the sibling `night_vibe_derived`, hash-gated on the vibe **text** and reconciled Worker-side (`src/night-vibe-vector.ts`, the `night-vibe-embed` job) exactly like `taste_derived` — a `meal`/`members` change re-embeds nothing.

`weather_affinity` is discrete **bucket membership** (`weather-bucket-planning`), not a graded score: `src/night-vibe-schedule.ts`'s `resolveBucketMembership` reads each stored string through the same tag→category map a forecast day resolves through (`src/weather.ts`'s `deriveCategory`), so a row can store either the new category names (`grill | cold-comfort | wet`) or the legacy `deriveVibes` tags (`soup | comfort | grill-friendly | light | no-grill`) and both resolve to the same bucket set — zero data migration. An empty/absent/all-unrecognized array is **bucketless** (a universal filler, eligible for every category's slot quota). Weather allocation is **dinner-scoped** (stories/02 Q4): an affinity stored on a breakfast/lunch vibe is preserved on the row but inert in allocation. `weather_antipathy` is retained on the row for back-compat but is **not consulted** by `propose_meal_plan`'s quota allocation (the hard category exclusion replaces graded penalties).

```sql
-- D1 night_vibes table — PRIMARY KEY (tenant, id).
tenant            TEXT     -- owning member
id                TEXT     -- stable per-tenant vibe id (slug)
vibe              TEXT     -- the craving/query phrase (the slot's retrieval query)
meal              TEXT     -- breakfast | lunch | dinner (NOT NULL, default 'dinner', migration 0052):
                            -- which meal's palette this vibe samples into; settable, never null
members           TEXT     -- JSON string[] of opaque member handles (migration 0052, D29-final);
                            -- NULL = everyone. An assigned vibe contributes slots/cadence-debt only
                            -- when its members intersect the effective eating set; an all-unresolvable
                            -- list contributes as everyone (fail-open, noted in propose diagnostics)
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

The **profile-reconciliation** queue (migration 0027, `profile-reconciliation` capability): proposed profile edits that reconcile a member's **stated** palette against their **revealed** cooking behavior. Written by the deterministic `reconcile-signals` cron (`src/reconcile-signals.ts`, producer `signal-cron`), the generative archetype derivation (producer `edge`), the pref-retirement seed pass (`src/pref-retirement.ts`, producer `pref-retirement` — the D8 value migration: for each profile row whose retired `lunch_strategy`/`ready_to_eat_default_action` is non-NULL it enqueues seeded lunch/dinner `add_vibe` suggestions with deterministic targets `pref-retire:lunch_strategy`/`pref-retire:rte` and NULLs both columns in the SAME batch, so columns-NULL is the convergence predicate and the pass terminates) and, optionally, the operator via `reconcile_enqueue_proposal` (producer `operator`); read/resolved by the member via `list_proposals`/`confirm_proposal` (`src/reconcile-db.ts`). An `add_vibe` payload carries the vibe's `meal` (default dinner) — every producer sets it and the confirm apply writes it onto the created vibe. `id` is a **stable hash of `(kind, target)`** so re-drafting is an idempotent `INSERT OR IGNORE` and a rejected proposal is never re-surfaced.

The queue also carries **corpus-curation** proposals addressed to the **operator tenant only**: the `merge_recipes` kind (the `dup-scan` producer, `recipe-dedup` capability) surfaces a suspected near-duplicate recipe pair for review. Its `target` is the lexicographically-sorted pair key `"<slugA>+<slugB>"` and its payload is **review evidence, not a diff**: `{ slugs: [a, b], titles: [ta, tb], cosine, shared_ingredients: [...], jaccard, detector: "cosine" | "corroborated" }`. Accepting one records the decision **without any profile or corpus write** — the merge itself is agent-guided through the corpus write tools (see the `duplicate_of` frontmatter note above), performed before confirmation; rejecting keeps both recipes and suppresses the pair permanently (the stable id blocks re-insert).

```sql
-- D1 pending_proposals table. PRIMARY KEY (tenant, id). idx_pending_proposals_tenant_status on (tenant, status).
id          TEXT  -- stable hash(kind|target) — dedup + no-re-propose
tenant      TEXT  -- the member the proposal is for (the operator, for merge_recipes)
kind        TEXT  -- add_vibe | adjust_cadence | prune_vibe | merge_recipes
target      TEXT  -- the vibe id the proposal acts on; the sorted "<a>+<b>" pair key for merge_recipes
payload     TEXT  -- JSON: the proposed profile diff (applied verbatim on accept), or review evidence (merge_recipes)
rationale   TEXT  -- human-readable "why"
evidence    TEXT  -- JSON: the signals that triggered it
status      TEXT  -- pending | accepted | rejected | superseded
producer    TEXT  -- signal-cron | edge | operator | dup-scan
created_at  TEXT
resolved_at TEXT  -- when accepted/rejected/superseded
```

`status` values: `pending` (awaiting the member); `accepted`/`rejected` are the **member verbs** (a `rejected` dismissal is a revealed signal, never rewritten by any pass); `superseded` is **system-set only** — the night-vibe derivation convergence sweep (`src/night-vibe-dedupe.ts`) marks a `pending` `add_vibe` proposal superseded when it is a near-duplicate (phrase-embedding cosine) of a palette vibe, a rejected proposal, or an earlier pending representative, so accumulated redundancy heals organically. The sweep only ever touches `pending` rows (`WHERE status='pending'`). Member-facing reads (`list_proposals`, `GET /api/vibes/proposals`) filter to `pending`, so `superseded` rows leave both surfaces; confirming a superseded id answers the same `conflict` as any other resolved status.

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
- The group-favorites aggregate (`read_recipe_notes`) is a single indexed query (`SELECT tenant, favorite FROM overlay WHERE recipe=?`) scoped to the caller's lens households, not a per-tenant scan.

## recipe_notes (per-member, D1 `recipe_notes` table)

A member's **attributed notes** on one recipe (shared or personal) — the spin-capture mechanism. Stored in the D1 `recipe_notes` table (`id TEXT PRIMARY KEY`); columns: `recipe` (slug), `author` (the writing member id, set by the Worker; founding member = tenant id for pre-split rows), `body`, `tags`, `tier`, `private`, `created_at`. Append-mostly. Adding a note never modifies shared content; an author MAY edit or delete their **own** notes (`update_recipe_note` / `remove_recipe_note`, addressed by `created_at`, self-scoped) but never another member's.

```sql
-- D1 recipe_notes table — one row per note, across all tenants
id          TEXT PRIMARY KEY   -- generated stable key
recipe      TEXT               -- recipe slug
author      TEXT               -- writing member id (set by the Worker)
body        TEXT               -- required; rows with no body are dropped on read
tags        TEXT               -- JSON array, e.g. ["tweak", "observation"]; default []
private     INTEGER            -- LEGACY, derived: dual-written as (tier = 'private')
created_at  TEXT               -- ISO timestamp (required; addressable key for edit/delete)
tier        TEXT               -- visibility tier: CHECK (tier IN ('public','friends','private'));
                               -- migration 0061; new notes default 'friends'
```

Example rows:

| id | recipe | author | body | tags | tier | private | created_at |
|----|--------|--------|------|------|------|---------|------------|
| rn_abc | miso-glazed-salmon | alice | Subbed gochujang for the sriracha — better. | ["tweak"] | friends | 0 | 2026-06-09T18:30:00.000Z |
| rn_def | miso-glazed-salmon | alice | Didn't love it cold the next day. | [] | private | 1 | 2026-06-10T01:05:00.000Z |

**Notes:**
- `body` (required), `created_at` (required), `tags` (optional, default `[]`), `tier` (optional on the wire, default `friends`). A note with no `body` is dropped on read.
- **`tier` is the source of truth** — `private` = author-only (member-level), `friends` = the author's household + friend households (everyone under self-hosted), `public` = anyone who can see the recipe, including the anonymous `/cookbook` page where the recipe itself is anonymously visible. No read path consults the `private` column; it is **dual-written** (`private = 1` exactly when `tier = 'private'`) purely so a rolled-back Worker never widens a private note's audience.
- **NULL-healing rule**: a NULL `tier` (a row written by pre-tier code during a rollback window) reads as `COALESCE(tier, CASE WHEN private = 1 THEN 'private' ELSE 'friends' END)` — the same pure mapping migration 0061's backfill applied (`private=1` → `'private'`, everything else → `'friends'`), so unmigrated rows behave identically and converge organically.
- `read_recipe_notes(slug)` aggregates the tier-admitted notes in one `members`-joined query (the join supplies each author's `handle` and household): the caller's own notes at every tier, `friends` notes from the caller's own + friend households, `public` notes from any household; another member's `private` note is never surfaced. Group favorites (a single indexed query over the D1 `overlay` table, scoped to the caller's lens households) ride the same read. `created_at` is the addressable key for `update_recipe_note` / `remove_recipe_note`; a tier change rides `update_recipe_note`.
- The anonymous `/cookbook/<slug>` page renders **public-tier notes only**, selected tier-scoped in SQL, and only where the recipe is anonymously visible.

## pantry (per-tenant, D1 session state)

Live inventory. Agent-writable. Updated as side effect of menu generation and ad-hoc messages. Stored as rows in the D1 `pantry` table (`PRIMARY KEY (tenant, normalized_name)`; `idx_pantry_category(tenant, category)` and `idx_pantry_location(tenant, location)` back the `read_pantry` filters). `notes` is an optional short freeform string. Adds are `INSERT … ON CONFLICT DO UPDATE` (keep `added_at`, refresh `last_verified_at`, overlay the rest); reads/writes are row-level and strongly consistent. Pantry has no `kind`/`domain` — it's kitchen inventory, food by construction — so `normalized_name` is always the canonical ingredient id resolved through the `IngredientContext` funnel (`resolve(name)`: normalize **and** capture), the same key `sku_cache` and recipe `ingredients_key` use, so a pantry "chicken breast" and a grocery/menu need for "2 lb chicken breast" join on the same id. The schema below describes each item object's shape:

```sql
-- D1 pantry table — one row per item. PRIMARY KEY (tenant, normalized_name).
-- idx_pantry_category on (tenant, category); idx_pantry_location on (tenant, location).
tenant           TEXT  -- owning user
name             TEXT  -- surface form / resolver input (e.g. "olive oil"; always member phrasing, never a raw id)
display_name     TEXT  -- optional explicit label override (usually NULL); a row renders display_name ?? name
normalized_name  TEXT  -- canonical ingredient id via the IngredientContext funnel (resolve)
quantity         TEXT  -- full | partial | low | "<count>" for countables
category         TEXT  -- food taxonomy: produce | dairy | meat | seafood | grains | bakery | canned |
                       --   condiments | oils | spices | baking | frozen | snacks | beverages;
                       --   NULL = uncategorized (filled by the ingredient-category cron, never an error)
location         TEXT  -- where it's kept: fridge | freezer | pantry | spice_rack | counter | cabinet; NULL = unassigned
prepared_from    TEXT  -- recipe slug if this is cooked/prepared from a recipe; else NULL
added_at         TEXT  -- ISO date when first added
last_verified_at TEXT  -- ISO date; resets when user confirms item is still present
notes            TEXT  -- optional short freeform note
```

Example rows:

| tenant | name | display_name | normalized_name | quantity | category | location | prepared_from | added_at | last_verified_at | notes |
|--------|------|--------------|-----------------|----------|----------|----------|---------------|----------|------------------|-------|
| alice | olive oil | NULL | olive oil | partial | oils | pantry | NULL | 2025-04-01 | 2025-05-12 | NULL |
| alice | ground beef | NULL | ground beef | 3 lb | meat | freezer | NULL | 2025-05-10 | 2025-05-10 | freezer burned, best for stocks or stews |
| alice | cooked rice | NULL | cooked rice | partial | NULL | fridge | salmon-with-rice | 2025-05-12 | 2025-05-12 | NULL |

**Notes:**
- `category` and `location` are **orthogonal, controlled vocabularies** (`src/department.ts`): the food taxonomy vs where the item physically lives. Both are optional on write and nullable in storage; readers treat NULL as unassigned/uncategorized, never an error. A NULL `category` converges through the scheduled `ingredient-category` pass (the identity memo below), which only ever fills NULLs — a member-set value is pinned. Write validation (shared by `update_pantry` and `POST /api/pantry/ops`): an off-vocabulary `location` is a per-op conflict; a legacy location-flavored `category` value (`pantry|fridge|freezer|spices`) transposes onto `location` for one deprecation window; any other off-vocabulary `category` is accepted-and-dropped with a `warnings` entry (see docs/TOOLS.md's deprecation convention). There is deliberately no `other` category value — "don't know" is NULL.
- `quantity` is intentionally loose — "full", "partial", "low" plus optional explicit counts. We don't track precise amounts (whiteboard problem).
- `prepared_from` set for cooked/prepared items — faster perishability profile, identifies which recipe produced it (and stamps `leftovers` on a waste event).
- `last_verified_at` resets when the user confirms the item is still there during a pantry confirmation pass.
- `display_name` (nullable) is an optional explicit label override, stored independently of the resolver-input `name` and the canonical `normalized_name`. A pantry row's `name` is always the member's phrasing (never a raw id — `update_pantry` takes no id), so a surface renders `display_name ?? name`. A merge (adding "green onions" onto an existing "scallions" row on the same canonical id) keeps the surviving row's `name`/`display_name`, never overwriting it with the incoming surface form.
- A row leaves the pantry through plain `remove` (correction/cleanup, records nothing) or `dispose` (`used` | `waste`) — a `waste` dispose deletes the row and appends one `waste_events` row (below) in the same D1 batch.

## waste_events (per-tenant, D1 `waste_events` table)

The waste-telemetry capture (removal-as-disposition): one append-only row per `disposition: "waste"` dispose, written by the shared pantry apply path (`update_pantry` / `POST /api/pantry/ops`). Band 4's waste analyzer is a read surface over this table.

```sql
-- D1 waste_events table. PRIMARY KEY (tenant, id); idx_waste_events_when on (tenant, occurred_at).
tenant        TEXT NOT NULL
id            TEXT NOT NULL   -- client-minted event id (ULID); server-minted when omitted
name          TEXT NOT NULL   -- the row's display label at capture
item_id       TEXT NOT NULL   -- canonical ingredient id (the row's stored normalized_name)
prepared_from TEXT            -- recipe slug snapshot when the tossed row was a leftover
quantity      TEXT            -- the row's loose quantity at capture
department    TEXT            -- D17 analytics stamp; NULL ONLY while pending classification
reason        TEXT NOT NULL   -- spoiled | moldy | over_ripe | expired | freezer_burned | stale |
                              --   forgot | bought_too_much | never_opened | other
occurred_at   TEXT NOT NULL   -- ISO date the toss happened (client-stamped; defaults to today)
created_at    TEXT NOT NULL   -- ISO timestamp recorded
```

Example rows:

| tenant | id | name | item_id | prepared_from | quantity | department | reason | occurred_at | created_at |
|--------|----|------|---------|---------------|----------|------------|--------|-------------|------------|
| alice | 01JZX8… | Cilantro | cilantro | NULL | 1 bunch | produce | over_ripe | 2026-07-08 | 2026-07-08T21:14:02Z |
| alice | 01JZY2… | cooked rice | cooked rice | salmon-with-rice | partial | leftovers | forgot | 2026-07-10 | 2026-07-10T18:03:11Z |

**Notes:**
- **`department` is the D17 analytics dimension**: the pantry food taxonomy ∪ `household` (non-food, via the identity memo) ∪ `leftovers` (`prepared_from` rows). Stamped at capture with the precedence leftovers → the row's in-vocabulary `category` → the identity memo → NULL (**pending**); the `ingredient-category` cron fills a pending stamp exactly once (NULL→value), and a stamped department is never rewritten — vocabulary evolution never rewrites history.
- **The PK includes `tenant`** so a client-minted id can never collide with (or squat on) another tenant's event; the insert is `ON CONFLICT(tenant, id) DO NOTHING`, so a replayed offline dispose converges to exactly one event.
- **No value or avoidability column, and no member value input**: dollar value is never asked at capture and avoidability is never stamped on the event. `WasteAnalyzer` derives both at read time from existing tenant-owned facts. There is no pantry/SKU/flyer/catalog/store-quote/receipt/recipe/quantity/cross-tenant/heuristic fallback, no member override, and no history rewrite when the current mapping changes.
- Rows are append-only from the write path (the pending-department fill is the only mutation); the row delete and event insert ride one D1 batch through the `src/db.ts` helpers.
- `tenant` reads as the household — waste is household-scoped behavioral data.

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
name             TEXT  -- human display: a typed add's member phrasing, or an add-by-id row's resolved label
display_name     TEXT  -- optional explicit label override (usually NULL); highest read precedence
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
sent_in          TEXT  -- INTERNAL: the order_sends id whose flush advanced this row's in-flight cart state (0051); NULL otherwise
checked_at       TEXT  -- nullable ISO check-off timestamp; deliberately orthogonal to status
row_version      INTEGER -- starts at 1 and advances on every grocery-row mutation
updated_at       TEXT  -- nullable ISO timestamp for legacy rows; latest row mutation thereafter
decision_owner_token TEXT -- internal proof that a decision created this row; cleared by ordinary upserts
```

Example rows:

| tenant | name | display_name | normalized_name | quantity | kind | domain | status | source | for_recipes | note | added_at | ordered_at |
|--------|------|--------------|-----------------|----------|------|--------|--------|--------|-------------|------|----------|------------|
| alice | extra virgin olive oil | NULL | olive oil | 1 bottle | grocery | grocery | active | pantry_low | [] | the fancy one this time | 2026-06-09 | NULL |
| alice | 2x4 lumber | NULL | 2x4 lumber | 6 | other | home-improvement | active | ad_hoc | [] | NULL | 2026-06-09 | NULL |
| alice | paper towels | NULL | paper towels | 1 pack | household | grocery | active | ad_hoc | [] | NULL | 2026-06-09 | NULL |

**Notes:**
- `quantity` is the loose BUY amount (1 package unless told otherwise). Recipe-level needs are NOT stored — they're re-aggregated from `for_recipes` when needed (e.g. the partial-check prompt), keeping the no-portion-math stance.
- `kind` distinguishes non-food items. Only `grocery` items reconcile back into the pantry when an order is received.
- `domain` (free string, default `grocery`; common values `grocery | home-improvement | garden | pharmacy`) is the kind of **store** the item is bought at — **orthogonal to `kind`**: `kind` governs pantry reconcile on receive, `domain` governs which store-type an in-store walk includes the item in. Absent → read as `grocery` (existing items validate unchanged). Open-vocabulary, not a hard enum — a wrong tag only mis-files an item onto the wrong walk. Validated shape-only (a non-string fails) in the Worker write subset; `add_to_grocery_list` / `update_grocery_list` accept it.
- `source` carries provenance for order-time dedup/behavior: `pantry_low`/`stockup` were promoted (don't re-prompt); `menu` aggregates with recipe needs; `ad_hoc` is a one-off.
- `note` holds a **one-off** brand request ("the fancy olive oil this time") — explicitly NOT `preferences` (the D1 profile), which is for standing dispositions.
- `name` and `normalized_name` are stored separately: an **add-by-id** row (e.g. an accepted sibling swap) stores the human display as `name` ("Red cabbage") and the canonical id as `normalized_name` (`cabbage::color-red`); the set-algebra keys on the stored `normalized_name`, so every surface renders `name` natively. The rendered human label is: the row's explicit `display_name` override when set; else, for an **id-named** row (its `name` equals its `normalized_name` — a **legacy** row from before this capability, or a **plan-derived** virtual line), the identity node's label (its `display_name`, else the `base (detail)` synthesis), resolved at read so it converges as the node is backfilled (a legacy row heals with no row edit); else the stored `name`. `display_name` is nullable and rarely populated — the highest-precedence override, not the primary label source. A merge keeps the surviving row's `name`/`display_name`, never adopting the incoming surface form.
- Lifecycle: `active → in_cart → ordered` + the terminal **receive action**. The `status` **enum is only `active | in_cart | ordered`** — `received` is not a stored status but the receive *action* (the row is removed and, for `grocery`-kind items, the pantry restocked), identical across every fulfillment mode. `place_order` and the satellite receipt write the `active → in_cart` advance; `ordered` is reached by the **user-asserted** "I placed the order" advance (the `update_grocery_list` tool or the member app's mark-order-placed, both through the shared W3 transition guard — legal only from `in_cart`, stamping `ordered_at`) and by the satellite receipt's optional `mark_placed` re-post (`advanceOrderedRows`). Any status write that leaves `ordered` clears `ordered_at`.
- **`sent_in` is internal send-record linkage** (spend telemetry, below): stamped ONLY by the two snapshot-writing order-flush advances (`place_order`, the satellite receipt) — never by a manual `active → in_cart` write, and never accepted as a caller-writable field on any tool or HTTP surface (the write boundaries have no such field; a supplied value is dropped). It rides reads harmlessly. Cleared when the row leaves its in-flight send without a purchase assertion (`in_cart → active`, the cart-write rollback, re-listing an `ordered` row); kept across `in_cart → ordered`, where the shared writer materializes the linked snapshot line as a spend event.
- **`checked_at` is not a cart state.** It partitions active shopping into unchecked `to_buy` and durable checked lines. Checking a virtual plan need atomically materializes a `source: menu` row. Old rows read unchecked at `row_version: 1`; every later row mutation advances the version and `updated_at`.
- **The to-buy set is a derived read, not rows.** The order-time set — `active` rows ∪ the meal plan's derived ingredient needs (each planned recipe's projected `ingredients_full`) − pantry on-hand, on canonical ids — is computed at read time by one shared operation (`read_to_buy` / `GET /api/grocery/to-buy`, the same algebra `place_order` flushes and the satellite pull-list serves). Plan needs are **never materialized into rows automatically**; an explicit `source: "menu"` row is a **materialization** (a derived need pinned/edited, or an open-world side's ingredients) and merges with the derived need under the same canonical id. A derived need whose row is in flight (`in_cart`/`ordered`) is suppressed from to-buy until received or re-listed.
- **The enriched read's `substitutes[]` is derived, never stored.** With `enrich`/`?enrich=1`, each to-buy line additionally carries a `substitutes[]` array alongside its `placement` (see `sku_cache` below for the placement columns) — cross-ingredient hints computed fresh on every call from three already-persisted sources: a depth-1 walk over the `ingredient_edge` graph (the ingredient identity section below), an `in_pantry` join against the pantry table above (a row exists for the sibling's resolved id — no location needed), and, once the primary store resolves, an `on_sale_hint` match against that store's warmed flyer rollup (the flyer cache section below) — `{ sku, description, price: { regular, promo }, savings }`. Each entry also carries its relation label — `{ role: "satisfies" | "sibling" | "generalization", kind: "general" | "containment" | "membership", via? }` — naming how the walk reached it. Nothing here is written to a table: a line's `substitutes[]` is recomputed from the identity graph, pantry, and flyer rollup's current state on every enriched call, so it converges automatically as those sources change (a new edge, a pantry edit, a re-warmed flyer) with no reconcile of its own. The view's `flyer_as_of` is that rollup's own `as_of` (the flyer cache section below), surfaced alongside the hints it fed. See `docs/TOOLS.md`'s `read_to_buy` for the full shape and precedence.

## spend telemetry (per-tenant, D1 `order_sends` + `order_send_lines` + `spend_events`)

Grocery-spend capture in **two phases** (migration 0051): **snapshot at send** — an order flush that advances rows to `in_cart` (the `place_order` Kroger flush, the satellite cart-fill receipt's first landing) persists a **send record** in the same D1 batch as the advance — and **materialize at the purchase assertion** — the guarded `in_cart → ordered` advance copies the linked snapshot lines **verbatim** into `spend_events` through the ONE shared writer (`src/spend.ts`, called only from the shared status operations, never a surface; no MCP tool writes spend). Prices exist only at send (the Kroger cart is write-only; the satellite reports a single observed price), so the snapshot is the spend truth **by definition** — a send-time quote, never reconciled against fulfillment (no such source exists). Rows are behavioral data, tenant-scoped, retained **forever** (voided events included — no prune, no rollup).

```sql
-- D1 order_sends table — one row per flush. PRIMARY KEY (id); idx_order_sends_tenant on (tenant, created_at).
id            TEXT  -- place_order: minted per flush; satellite: the order_list id (deterministic, so replays converge)
tenant        TEXT  -- owning household
store         TEXT  -- 'kroger' | the satellite store slug
location_id   TEXT  -- resolved Kroger locationId; the order-list's (nullable)
fulfillment   TEXT  -- 'kroger_online' | 'satellite'
order_list_id TEXT  -- satellite correlation; NULL on the Kroger path
created_at    TEXT  -- ISO 8601
placed_at     TEXT  -- nullable ISO timestamp of the exact batch purchase assertion; old/unplaced sends stay NULL
placement_token TEXT -- nullable internal claim token; gates every row/spend effect in the atomic placement batch

-- D1 order_send_lines table — one row per sent line. PRIMARY KEY (send_id, line_key); insert-or-ignore (a snapshot is never rewritten).
send_id       TEXT     -- -> order_sends.id
line_key      TEXT     -- === grocery_list.normalized_name (the canonical key the advance uses)
name          TEXT     -- display at send
sku           TEXT     -- Kroger UPC / satellite productId; NULL when unreported
brand         TEXT     -- NULL on the satellite path (the receipt's description does not split a brand out)
size          TEXT
quantity      INTEGER  -- package count sent
price_regular REAL     -- per-package regular price at resolution; NULL-unknown on the satellite path
price_promo   REAL
on_sale       INTEGER  -- 1/0; NULL = unknown (satellite)
unit_price    REAL     -- effective per-package price: promo when on sale else regular; the satellite's observed product.price; NULL when unpriced
savings       REAL     -- deriveSavings(regular, promo) when on sale, else 0; NULL = unknown
estimated     INTEGER  -- 1 = fallback-priced; send-path quotes are 0
department    TEXT     -- D17 stamp (below); NULL ONLY while pending classification
provenance    TEXT     -- 'planned' | 'impulse' (below)
for_recipes   TEXT     -- JSON array

-- grocery_substitution_decisions — PRIMARY KEY (tenant, original_key).
tenant TEXT; original_key TEXT; replacement_key TEXT
attribution_signature TEXT -- canonical JSON of date/id/slug attribution; invalidates when plan relations change
created_replacement INTEGER -- 1 only when acceptance created the replacement row
replacement_version INTEGER -- created row version used by edited-row-safe Undo
row_version INTEGER; created_at TEXT; updated_at TEXT; operation_token TEXT -- internal conditional-claim token
ownership_token TEXT -- matches the created row's decision_owner_token; NULL means Undo cannot delete the row
-- idx_grocery_substitution_replacement on (tenant, replacement_key).

-- grocery_coverage_decisions — PRIMARY KEY (tenant, line_key).
tenant TEXT; line_key TEXT
created_row INTEGER -- 1 only when Buy anyway materialized the pantry-low row
created_row_version INTEGER -- created row version used by edited-row-safe Undo
row_version INTEGER; created_at TEXT; updated_at TEXT; operation_token TEXT -- internal conditional-claim token
ownership_token TEXT -- matches the created row's decision_owner_token; NULL means Undo cannot delete the row
-- idx_grocery_coverage_updated on (tenant, updated_at).

-- D1 spend_events table — one row per asserted purchase line, copied VERBATIM from its snapshot line.
-- PRIMARY KEY (send_id, line_key) — the idempotency key; insert-or-ignore, so a replayed assertion converges.
-- idx_spend_events_tenant on (tenant, occurred_on); idx_spend_events_item on (tenant, line_key, occurred_on).
send_id     TEXT
line_key    TEXT
tenant      TEXT
occurred_on TEXT     -- ISO date of the purchase assertion (parity with ordered_at)
name        TEXT
sku         TEXT
quantity    INTEGER
unit_price  REAL     -- copied verbatim — never re-priced at assertion time
amount      REAL     -- unit_price × quantity; NULL when the snapshot was unpriced
savings     REAL
estimated   INTEGER
department  TEXT     -- copied from the snapshot line; NULL ONLY while pending (filled once by the ingredient-category cron)
provenance  TEXT
store       TEXT
fulfillment TEXT
voided_at   TEXT     -- set when the row was re-listed after ordering (voided, never deleted); reads filter voided_at IS NULL
price_source TEXT    -- shop receipt estimate source: sku_cache | flyer | last_paid | unpriced; NULL for order-send assertions
```

**Notes:**
- **Atomicity + rollback:** the `place_order` snapshot shares the in-cart advance's batch — the send exists iff the advance succeeded — and a failed cart write's rollback **deletes** the send record with its row compensation (no phantom order). Building the snapshot is honest-best-effort: a build failure degrades to advancing **without** a send (`place_order` reports `send: { recorded: false, error }`; the satellite receipt still lands) — telemetry never costs the member their groceries. Those rows carry no `sent_in` and produce no spend events.
- **The satellite send** stores only what the receipt observed: the single `product.price` as `unit_price` (`price_regular`/`price_promo`/`on_sale`/`savings` NULL-unknown, nothing fabricated), `product.productId`/`size` as the pick, quantity 1 per issued line. Its send id **equals the order-list id**, so the residual double-intake replay converges on insert-or-ignore.
- **`department` — the grocery-line D17 derivation chain** (`departmentForGroceryLine`, `src/department.ts` — the same canonical dimension `waste_events` stamps, same vocab and immutability): a **non-food** line (`kind` `household`/`other`, or a non-grocery `domain` — the "2x4 lumber" row above stamps `household` this way) stamps **`household` immediately, never pending** (included in spend, excluded from cost-per-meal); else the identity memo's category (`ingredient_identity.category`, representative-resolved — any memo value, `household` included); else **NULL = pending classification**, filled exactly once (NULL→value) by the shared `ingredient-category` cron's spend-fill phase over both tables — a stamped value is never rewritten, and a memo-cold food line records *pending*, never a guess. `leftovers` is waste-only; spend lines never stamp it. Store placement (`sku_cache` aisles, Kroger categories) never feeds the dimension, and no capture path calls the model. The cost-per-meal numerator exclusion constant `COST_PER_MEAL_EXCLUDED = {household, beverages}` lives beside the vocab.
- **`provenance` mapping (deterministic, computed at flush):** `planned` when the line's key came from a stored `grocery_list` row or the server-derived plan needs, **or** its merged `for_recipes` is non-empty (an open-world side passed via `menu_needs` is plan work); `impulse` for a caller-supplied `menu_needs` extra with no recipe attribution. Satellite pull-list lines are `planned` by construction (list ∪ plan only).
- **Negative rules (enforced in the shared operations):** a row leaving `in_cart` without an assertion (re-listed `active`, removed, rolled back) writes no spend and drops its linkage; the shared removal operation **never** writes spend; a manually-moved `active → in_cart` row has no linkage, so asserting it writes nothing; re-listing an `ordered` row **voids** its events (`voided_at`, never a delete); never-marked orders surface as *awaiting mark-placed* (the `retrospective` spend section) and are never auto-counted.
- **The last-paid read:** `idx_spend_events_item` serves the per-household "what did we last pay for X" memo — the latest non-voided priced event per `line_key`, a tenant-scoped **query, not a table**, never cross-household.
- Send rows and lines are immutable send-time quote history. Relisting clears only current grocery membership; it never rewrites snapshot prices. `placed_at` is placement truth and drives D16 materialization. Analytics `department` classifies spend and is distinct from the grocery UI's store-placement `section`/aisle presentation.

### SpendAnalyzer read-time wire projection (no D1 schema)

`readSpendAnalyzer` projects existing facts directly; there is no analyzer table, rollup, migration, index, cache, queue, binding, or scheduled aggregate. `idx_spend_events_tenant (tenant, occurred_on)` serves the bounded spend read from matched `prior_start` through `as_of`; `idx_cooking_log_tenant_date (tenant, date)` serves the selected cost-per-meal denominator. The other two sources are tenant-point/current-state reads: `profile.weekly_budget` and `grocery_list` rows with non-null `sent_in` still at `in_cart`. Every read is tenant-predicated and goes through `src/db.ts`. The read filters `voided_at IS NULL`, has an upper date bound, and never rewrites old or nullable rows; databases already migrated through the existing spend/cooking schemas require no analyzer DDL.

The exact shared wire object is:

- Top level: `range`, `as_of`, `selected_start`, `selected_end`, `prior_start`, `prior_end`, `status`, `coverage`, `weekly_budget`, `weeks`, `awaiting_mark_placed`, `kpis`, `breakdowns`, `top_drivers`, `insight`.
- `range` is exactly `4w | 8w | 12w`. N buckets include the current UTC week, start on ISO Monday, and are oldest first. Selected bounds are the oldest bucket Monday through `as_of`; prior bounds are the same elapsed shape shifted back N weeks. Each week has `week_start`, `week_end`, `through`, `is_partial`, legacy numeric `total`, `savings`, `events`, `estimated`, `status`, `monetary_coverage`, `department_coverage`, `savings_coverage`, and `over_budget`.
- A monetary coverage object has `status`, `event_count`, `priced_event_count`, `unpriced_event_count`, `estimated_event_count`, `known_amount`; department coverage has `status`, `event_count`, `classified_event_count`, `pending_event_count`; savings coverage has `status`, `event_count`, `known_event_count`, `unknown_event_count`, `known_savings`. Each status is `empty | unavailable | partial | complete`. Estimated amounts are known but make monetary coverage partial. Missing department is retained only as pending coverage, never a synthetic group. Savings missingness does not change overall spend status. Overall is empty with no events, unavailable when monetary coverage is unavailable, partial when monetary coverage is partial or department coverage is not complete, and complete otherwise.
- `kpis` contains `total_spend { amount, status }`, `average_per_week { amount, status }`, `cost_per_meal { amount, known_numerator, meal_count, status, reason }`, and `trend { percent, current_known_amount, prior_known_amount, status, reason }`. Cost reasons are null, `zero_meals`, or `numerator_unavailable`; trend status is `available | unavailable` and reasons are null, `current_incomplete`, `prior_incomplete`, or `prior_zero` in that precedence. Amounts round each stored value once to cents before summation; percentages round to one decimal. Average uses all N buckets. Cost counts each selected `recipe`/`ad_hoc` cooking row once (all meal values, including null), excludes `ready_to_eat`, and excludes only capture-stamped `household` and `beverages` from the spend numerator. It never infers servings, quantities, weights, household size, or missing value.
- `breakdowns` contains `department`, `store`, and `provenance`, each with `known_denominator`, `status`, and `items`. An item has `key`, `label`, `amount`, `event_count`, `priced_event_count`, `unpriced_event_count`, `percentage`. Groups use only captured keys and include unpriced-only groups. Department's denominator is classified known spend; store/provenance use total known spend. Items order by amount descending then raw key ascending; zero denominators produce null percentages.
- `top_drivers` has literal `cap: 6`, pre-cap `total_count`, and `items`. Each item has `key`, `name`, nullable `department { key, label }`, `amount`, `event_count`, `priced_event_count`, `unpriced_event_count`, `percentage`. Drivers group captured `line_key`, include groups with a priced event, count event rows rather than package quantity, and select name plus department from the same latest row by `occurred_on` descending then `send_id` descending. Ordering is amount descending, event count descending, key ascending.
- `weekly_budget` normalizes absent/non-positive storage to null. With a positive budget, `over_budget` is true once known spend exceeds it, null when missing value could change an otherwise-below result, and false only for complete known value. `awaiting_mark_placed` is a separate current count and enters no bucket, KPI, breakdown, driver, or insight. `insight` is selected from fixed server templates; it is not stored and no LLM participates.

The MCP `retrospective` and legacy profile retrospective shapes default `range` to `4w`; authenticated `GET /api/retrospective/spend` and the member UI default it to `8w`. All transports return this same additive object. Repeated reads are deterministic for the visible committed facts and clock and perform no insert, update, delete, capture action, classification, cache fill, or cron work.

### WasteAnalyzer read-time wire projection (no D1 schema)

`readWasteAnalyzer` projects only the existing `waste_events` and `spend_events` columns above. One tenant/date-bounded Waste read uses `idx_waste_events_when (tenant, occurred_at)` from the matched prior start through `as_of`. For each row, an indexed correlated seek uses `idx_spend_events_item (tenant, line_key, occurred_on)` to select the latest same-tenant, non-voided, non-NULL `unit_price` whose `line_key = waste_events.item_id` and `occurred_on <= waste_events.occurred_at`, ordered by `occurred_on DESC, send_id DESC`; `unit_price` and `estimated` come from that same selected row. A second selected-window, non-voided Spend read uses `idx_spend_events_tenant (tenant, occurred_on)` and reads only `amount`, `estimated`, and capture-stamped `department` for Waste rate. Waste rows order by `(occurred_at, id)` ascending and rate rows by `(occurred_on, send_id, line_key)` ascending. The largest `12w` result bounds the outer Waste scan to 24 weeks and the rate read to the selected twelve weeks; last-paid history is reached only through the indexed item seeks.

These are read-time derivations, not stored fields:

- **Last-paid Waste value:** one matched `unit_price` values one persisted Waste event. Each source decimal is rounded once to cents before summing. Same-day purchase is eligible; future, voided, and NULL-priced rows are not. A newer ineligible row falls through to an older eligible price. Known zero remains valued. `spend_events.amount`, Spend package `quantity`, and the loose `waste_events.quantity` never multiply or replace the unit price.
- **Effective department:** `leftovers` whenever `prepared_from` is non-NULL; otherwise the event's immutable capture-stamped `department`. A non-leftover NULL remains pending and absent from Department groups; no `Not mapped` row or event rewrite is created. The existing ingredient-category job may later fill a NULL capture stamp independently, but the analyzer neither invokes nor replaces it.
- **Avoidability:** the selected frozen in-code `waste-avoidability-v1` reason-only table maps `forgot`, `bought_too_much`, `never_opened`, `freezer_burned`, and `stale` to `avoidable`, and the other five canonical reasons to `hard_to_avoid`. The result echoes selected/current/is-current metadata. A named version is replayable, an unknown version is a validation error, and item/name/department/quantity/value/member/model fields never affect classification.
- **Qualifying recorded Spend:** selected non-voided `spend_events.amount` rows whose capture-stamped department is non-NULL and not `household`; `beverages` is included. Household-only input is exact empty qualifying Spend. NULL department stays pending and enters no known amount. This amount is captured grocery Spend, distinct from per-toss last-paid estimates.

The workerd-free `WasteAnalyzer` wire object is returned directly by the shared reader, MCP/profile composition, and member endpoint. Its top level is `range`, UTC `as_of` and selected/prior bounds, selected monetary `status`, `avoidability_mapping`, selected monetary/department `coverage`, chronological `weeks`, `kpis`, `breakdowns`, `most_wasted`, and deterministic `insight`. `range` is exactly `4w | 8w | 12w`; each selected bucket has `week_start`, `week_end`, `through`, `is_partial`, exact event count, nullable amount, monetary status/coverage, and independent department coverage.

Monetary coverage contains `status`, event/priced/unpriced/estimated counts, and `known_amount`. No events is `empty` with exposed zero; events with no match are `unavailable` with known zero but exposed NULL; any unmatched or estimated match is `partial` with its known subtotal; all matched non-estimated events are `complete`. Department coverage has event/classified/pending counts and independent `empty | unavailable | partial | complete` status; it never changes top-level money. Items binned counts rows rather than loose quantity and divides by all N buckets. Trend carries only percent, current/prior known amounts, availability, and `current_incomplete | prior_incomplete | prior_zero | null`; there are deliberately no prior coverage counts.

Waste rate carries known Waste, qualifying recorded Spend, percent/status/reason, and qualifying-Spend coverage. It is available only when both inputs are exact (`empty` or `complete`) and their cents denominator is positive; unavailable reason precedence is `waste_incomplete`, `spend_incomplete`, then `zero_denominator`. Department breakdown denominators cover effectively classified events/value; Reason and Avoidability cover all selected events/value. Every breakdown returns its classification and monetary coverage. Most-wasted groups are nonempty and therefore use only `unavailable | partial | complete`, retain sparse/unvalued groups, report pre-cap count, and cap at six.

No `waste_events` value/avoidability column, analyzer table, materialized rollup, migration, index, cache, binding, dependency, queue, scheduled aggregate, or analyzer cron exists. The reader performs no insert/update/delete, classification fill, backfill, repair, or historical rewrite. Existing nullable rows and databases already migrated through the tables/indexes documented above use this one current reader with missingness represented by coverage rather than a compatibility branch or fallback.

### `GroceryListData` wire snapshot

`@yamp/contract` independently versions the dual-host grocery snapshot. Version 1 carries
`contract_version`, opaque `snapshot_version`, `as_of`, the complete active/checked `lines`,
unchecked `to_buy` canonical keys, pantry coverage and decisions, current send groups with persisted
quote totals/savings, underived recipes, location/flyer freshness, and header counts. Narrow line/send
freshness rides the corresponding objects. A shopping line carries `staple: true` when its canonical
key is a member of the household's staples list. `GroceryModelContext` extends the complete snapshot with
an action summary/outcome; hosts publish the full context, never an event delta. A spawning payload is
render-only and must be re-hydrated before writes.

Contract v2 adds nullable `walk_context`: only the selected Offline store's secret-free slug/shared
name/household display name/domain, effective aisle-map summary, deterministic route groups, placement
source/warning, and observation time. It contains no adapter credentials, Kroger link/token truth,
Satellite state, full profile, or note bodies and is the only store context persisted with the Grocery query.

### Shop completion receipts (D1 `shop_commits` + `shop_commit_lines`)

Migration 0054 adds one immutable completion receipt keyed by `(tenant, session_id)` and one immutable line snapshot keyed by `(tenant, session_id, line_key)`. The commit stores canonical request hash, `store_walk | manual_shop`, resolved store/domain, client `occurred_at`, server `committed_at`, and receipt JSON. Lines retain quantity/count assumption, kind/domain, pantry result, estimate source/price/amount/savings, department, and planned/impulse provenance. The receipt is the idempotency/replay and pricing source. There is deliberately **no walk-session table**: URL/local state owns navigation and grocery `checked_at` owns picked truth.

### `OrderReviewData` and disposable stage

`@yamp/contract` independently versions the stateless Order Review wire/model contract. Version 1
carries `preview_fingerprint`, `grocery_snapshot_version`, current store and quote disclaimer,
stale-cart gate, matched and decision lines, transient estimate/savings, categorized left-offs,
underived recipes, counts, and the normalized `OrderReviewStage`. Matched products carry fresh
selection source, fulfillment, prices/promotions, options, and family fingerprint. Search responses
carry bounded products plus structured requested/searched identity divergence and modality facts.

The stage is plain JSON and persists nowhere: skipped line keys, assumed package quantities,
line-key/SKU selections with `same_identity | broader | manual | impulse` source, bare impulse labels,
and saved-brand verification markers. It has no prices. `OrderReviewModelContext` publishes the full
preview, complete stage, save receipts, current outcome, and action summary after every MCP
interaction. `OrderReviewSendResult` is discriminated as `review_changed`,
`cart_clearance_required`, `preflight_failed`, `send_failed`, or `sent`; only `sent` may drive the
confirmed screen, and its totals/savings are read by send id from immutable `order_send_lines`.

No review-session table exists. A successfully resolved bare review extra is materialized directly
as an `in_cart` row in the existing advance batch and its immutable send line uses
`provenance='impulse'`. Previewed, skipped, unresolved, revalidation-failed, or compensated extras
leave no grocery row, mapping, send line, or spend event.

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
meal    TEXT     -- breakfast | lunch | dinner | project, NULLABLE (migration 0052): which meal the
                 -- event was; NULL = "unknown / not a meal" (type and meal are orthogonal axes — a
                 -- baked loaf is { type: 'ad_hoc', meal: NULL }; there is no fourth "other" value,
                 -- and pre-migration rows keep NULL — a meal is never fabricated). Cooking a planned
                 -- project logs { type: 'recipe', meal: 'project' }. The member API's replay dedupe
                 -- identity is (date, meal, type, recipe|name), NULL matching NULL only — cooking_log
                 -- DEDUPE identity only, never plan-row identity.
satisfied_vibe TEXT -- meal-vibe slot provenance (migration 0026): copied from the CLEARED meal_plan
                    -- row's from_vibe on cook — the row the deterministic clear order actually selected,
                    -- never a slug-global pick (NULL for an off-plan cook). Retained for provenance, but
                    -- last_satisfied is NO LONGER derived from it — cadence attribution moved to the
                    -- cook-time cosine records in `vibe_satisfaction` (migration 0047; see below). The
                    -- from_vibe here is the guaranteed-reset prior that seeds one of those records.
                    -- (idx_cooking_log_satisfied_vibe on (tenant, satisfied_vibe))
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

## vibe_satisfaction (per-tenant, D1 table)

The **cook-time night-vibe satisfaction** records (migration 0047, `cooking-history` + `night-vibe-palette` capabilities). Night-vibe cadence attribution is **revealed at cook time**, not at plan time: when a `type=recipe` cook is logged, `log_cooked` cosine-matches the cooked recipe's cron-captured embedding (`recipe_derived`) against the caller's palette vibe vectors (`night_vibe_derived`) — reusing the ranker's cosine helper, **no new AI call** — and writes **one row per satisfied vibe**, in the **same D1 batch** as the `cooking_log` insert + the meal-plan clear. Attribution unions (a) the cleared plan row's `from_vibe` as a **guaranteed-reset prior** (always recorded, even at a borderline cosine, and even when unembedded) with (b) every palette vibe the recipe matches at/above a calibrated threshold — the single top match resets, weaker matches only when they clear a higher gate (the over-reset guard). A cook MAY satisfy **more than one** vibe; an **off-plan** cook resets any vibe it genuinely matches. Per-tenant PRIVATE, isolated by `tenant`. Schema: `migrations/d1/0047_vibe_satisfaction.sql`.

```sql
-- D1 vibe_satisfaction table. PRIMARY KEY (tenant, cooking_log_id, vibe_id) — one record per
-- (cook, vibe). idx_vibe_satisfaction_vibe on (tenant, vibe_id) backs the derived last_satisfied.
tenant         TEXT     -- owning member
cooking_log_id INTEGER  -- the cooking_log row that satisfied the vibe (soft ref, no FK)
vibe_id        TEXT     -- the night_vibes id satisfied (soft ref)
date           TEXT     -- YYYY-MM-DD of the cook (denormalized from cooking_log — MAX(date) needs no JOIN)
score          REAL     -- cosine at attribution time (provenance for threshold calibration only; the
                        -- from_vibe prior stores 0 when the recipe/vibe isn't embedded, NOT NULL — score is
                        -- NULL only for the migration-backfilled rows, which predate cosine attribution). It
                        -- does NOT scale the reset: any record fully advances the vibe's cadence to `date`.
```

**Notes:**
- A vibe's **`last_satisfied` is derived**, never stored: `last_satisfied(vibe) = MAX(date)` over this table's rows for that `(tenant, vibe_id)` (`readVibeLastSatisfied`). A never-satisfied vibe is simply absent (max cadence debt). This is the sole source for the palette's cadence status in `read_user_profile` and the propose engine's cadence-debt scheduling.
- **Backfill:** migration 0047 seeds this table from existing `cooking_log.satisfied_vibe` provenance (one row per stamped cook, `cooking_log_id` = the log row's id, `score` NULL), so past attribution is preserved when the derivation switches source. `cooking_log.satisfied_vibe` is kept (still written on cook) but is no longer the derivation input.
- `cooking_log_id`/`vibe_id` are **soft references** (no FK) — a since-deleted vibe simply never matches a live palette row on read, and history survives an admin edit/delete of the cook.

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

## recipe_imports (D1 `recipe_imports` table, shared — the visibility-grant relation)

The **canonical grant relation** behind the recipe **visibility lens** (D12): one provenance row per `(recipe, household)`, recording how the recipe first arrived for that household. Visibility is **computed at read time** from these rows — a recipe is visible to a household when its own row exists, a friend household's row exists, or the reserved curated tenant's row exists (subject to the household's `profile.curated_hide`); under the **self-hosted** deployment profile the friend input is the implicit all-to-all relation (any household's non-curated row grants visibility — computed from the profile flag, never stored). Nothing per-viewer is ever materialized. Written at creation by **every** import path — `create_recipe` (fresh create and dedup-to-grant), the discovery sweep (in the same batch as its match rows), curated intake, and the `lens-reconcile` scheduled job (legacy attachment) — through one grant primitive (`src/visibility.ts`); read only through that module's lens queries. Included in a tenant purge; a member revoke never touches it (the grant belongs to the household). Migration 0059.

```sql
-- D1 recipe_imports table — one provenance row per (recipe, household). PRIMARY KEY (recipe, tenant):
-- a household's second import of the same recipe is INSERT OR IGNORE — first provenance wins.
-- idx_recipe_imports_tenant on (tenant) backs the per-household lens reads.
recipe      TEXT  -- recipe slug (joins recipes.slug)  NOT NULL
tenant      TEXT  -- owning household; or the reserved curated tenant  NOT NULL
member      TEXT  -- importing member  NOT NULL — no NULL-owner sentinel; reconciled/backfilled
                  --   and curated rows stamp the founding-member value (= tenant id)
via         TEXT  -- how the recipe first arrived for this household  NOT NULL:
                  --   'agent' (conversational import / operator attachment) |
                  --   'feed:<url>' (sweep feed/email intake, the canonical feed URL) |
                  --   'satellite' (sweep import pushed by a satellite) |
                  --   'curated' (the curated tier; tenant is the reserved curated tenant)
imported_at TEXT  -- YYYY-MM-DD
```

Example rows:

| recipe | tenant | member | via | imported_at |
|--------|--------|--------|-----|-------------|
| harissa-roast-chicken | alice | alice | feed:https://example.com/feed.xml | 2026-06-26 |
| harissa-roast-chicken | ~curated | ~curated | curated | 2026-07-02 |
| jatjuk | bob | bob | agent | 2026-07-01 |

**The reserved curated tenant.** Curated-tier grants are owned by the system tenant **`~curated`** (a code constant, `CURATED_TENANT` in `src/visibility.ts`). `~` is syntactically outside the canonical tenant-username space and the product handle grammar, so no signup, onboarding, or invite path can ever claim it; it has no allowlist entry, no `tenants`-registry row, no `members` row, and can never resolve a session or token — it exists **only** as a value in `recipe_imports.tenant`/`member`. Curated rows grant visibility under the SaaS profile only (and are exactly the anonymous `/cookbook` position there); the self-hosted lens arm excludes them.

## discovery_matches (per-member, D1 `discovery_matches` table)

The **discovery sweep**'s per-member match attribution: which member(s) the sweep matched an imported recipe to, and at what taste score. This one record does **double duty** — it is the sweep's **import gate** (a candidate is imported only when ≥1 member matches it, so the shared corpus never floods any one member with the group's combined discovery firehose) **and** the per-member filter behind `list_new_for_me` (a member sees only the discoveries attributed to them — attribution is per-**member** via the `member` column, while recipe visibility is per-household via `recipe_imports`). Keyed by `(recipe, tenant)`; written by the sweep on an import (`src/discovery-db.ts` `recordDiscoveryMatches`) **in the same batch as the household's `recipe_imports` grant** — one write path, so attribution and visibility cannot drift (the `lens-reconcile` job heals any historical match row missing its grant). Curated intake writes **no** match rows. Read by `readNewForMe`. **Sibling of `recipes`** (like `recipe_derived`/`taste_derived`), so the index projection's wholesale `recipes` rebuild never touches it. Migration 0016; `member` added by 0059.

```sql
-- D1 discovery_matches table — one row per (recipe, member) the sweep matched. PRIMARY KEY (recipe, tenant).
-- idx_discovery_matches_tenant on (tenant) backs the per-member new-for-me read.
recipe     TEXT  -- recipe slug (joins recipes.slug)  NOT NULL
tenant     TEXT  -- the household the sweep matched it to  NOT NULL
member     TEXT  -- the matched member within that household (0059) — backfilled to the founding
                 --   member (= tenant id), exact under the founding-member invariant; the sweep
                 --   stamps real members going forward. list_new_for_me filters on it.
score      REAL  -- the taste cosine that cleared the match threshold (provenance / log detail)
matched_at TEXT  -- YYYY-MM-DD the match was recorded
```

Example rows:

| recipe | tenant | member | score | matched_at |
|--------|--------|--------|-------|------------|
| harissa-roast-chicken | alice | alice | 0.6312 | 2026-06-26 |
| harissa-roast-chicken | bob | bob | 0.5841 | 2026-06-26 |

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
pushed         INTEGER  -- 1 when the candidate arrived via POST /admin/api/ingest (a satellite push); 0 otherwise  (0031)
origin         TEXT     -- for a pushed row, the batch `source` name (provenance shown in the admin Discovery view)  (0031)
```

A **pushed** row (`pushed = 1`, `origin = "<source>"`) is a satellite candidate (see `ingest_candidates` below): its `acquire` stage was satisfied from attached content, not a fetch, so the admin Discovery view badges it (`satellite: <origin>`) and renders `acquire` as arrived-via-push. A pushed candidate's **transient** infrastructure failure is NOT written here — its `ingest_candidates` inbox row is the retry state — so only its terminal outcome ever appears in this log.

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

User-curated. Agent edits only when explicitly directed, via the `update_preferences` **merge-patch** (the defined-surface + `custom` shape and the RFC-7396 contract are described in the storage overview at the top of this doc). Assembled from the `profile` row (scalars + `stores`/`dietary`/`custom` JSON columns) and the `brand_prefs(tenant, term, tiers, any_brand)` rows. The example below shows the **assembled object** (what `read_user_profile` returns).

```sql
-- D1 profile table — singleton row per tenant. PRIMARY KEY (tenant).
tenant                      TEXT     -- owning user
taste                       TEXT     -- markdown (see taste section below)
diet_principles             TEXT     -- markdown (see diet_principles section below)
default_cooking_nights      INTEGER  -- default number of cooking nights WITHIN the planning window
cadence                     TEXT     -- JSON {breakfast,lunch,dinner} per-meal weekly counts 0-7 (migration 0052)
planning_cadence_days       INTEGER  -- how far out the caller plans/shops, in days (0028); unset falls back to a 7-day planning window in propose_meal_plan
lunch_strategy              TEXT     -- leftovers | buy | mixed
ready_to_eat_default_action TEXT     -- opt-in | auto-add
weekly_budget               REAL     -- household weekly grocery budget, dollars/week (0051); NULL or 0 = no budget line
stores                      TEXT     -- JSON: {primary, fulfillment?, preferred_location, preferred_location_name?, preferred_location_address?, location_zip, nicknames?:{[store_slug]:string}}
dietary                     TEXT     -- JSON: {avoid[], limit[]}
custom                      TEXT     -- JSON: arbitrary agent-added keys
kitchen_notes               TEXT     -- JSON: freeform cook-reasoning notes (oven count, pan sizes)
freezer_capacity_estimate   TEXT     -- tight | moderate | spacious
rotation                    TEXT     -- JSON: {resurface_after_days?, novelty_boost?}
retrospective_prefs         TEXT     -- JSON: {stale_after_days?, revealed_months?, revealed_min_cooks?}; overrides retrospective defaults per member (0021)
last_planned_at             TEXT     -- YYYY-MM-DD planning watermark (0016): set by update_meal_plan on an add; bounds list_new_for_me
curated_hide                INTEGER  -- household-level curated-tier hide (0059): NULL/0 = curated shown (the default),
                                     --   1 = the whole curated tier leaves this household's visibility lens; reversible,
                                     --   deletes nothing; surfaced as the `curated_hide` preferences boolean

-- D1 brand_prefs table — one row per (tenant, ingredient term). PRIMARY KEY (tenant, term).
tenant    TEXT     -- owning user
term      TEXT     -- normalized ingredient term (e.g. "olive_oil")
tiers     TEXT     -- JSON string[][]: the ordered preference ladder — earlier tiers tried first,
                   --   brands within a tier equally acceptable (cheapest wins); [] with any_brand=1 = don't-care
any_brand INTEGER  -- 1 = after the tiers (if any) are exhausted, take the cheapest acceptable instead of asking
```

Example rows (`profile`):

| tenant | default_cooking_nights | planning_cadence_days | lunch_strategy | ready_to_eat_default_action | stores | dietary | freezer_capacity_estimate |
|--------|----------------------|----------------------|----------------|----------------------------|--------|---------|--------------------------|
| alice | 3 | 7 | leftovers | opt-in | {"primary":"kroger","preferred_location":"01400943","preferred_location_name":"Kroger Marketplace","preferred_location_address":"123 Main St, Fort Worth, TX 76104","location_zip":"76104","nicknames":{"west-7th-tom-thumb":"The big store"}} | {"avoid":[],"limit":["cilantro"]} | moderate |

Example rows (`brand_prefs`):

| tenant | term | tiers | any_brand |
|--------|------|-------|-----------|
| alice | butter | [["Challenge"],["Tillamook"],["Kerrygold"]] | 0 |
| alice | canned_tomatoes | [["DeLallo"],["Muir Glen"],["Cento"]] | 0 |
| alice | paper_towels | [["Viva"]] | 0 |
| alice | yellow_onion | [] | 1 |

**`brands` is tri-state and drives matching confidence.** The Kroger matching pipeline reads a family's *presence* as the confidence signal:

| State | Row | Meaning |
|---|---|---|
| Ambiguous — ask | absent | no standing disposition; Claude asks |
| Don't-care — never ask | `{ tiers: [], any_brand: true }` | cheapest acceptable within the top identity-relevance tier |
| Preference ladder | non-empty `tiers` | earlier tiers first; within a tier, equally fine — cheapest wins |
| Ladder + never-ask fallback | non-empty `tiers`, `any_brand: 1` | exhausted ladder → cheapest acceptable instead of asking |

"Any brand" is a per-family **flag**, not a tier and not an absence — collapsing it into absence would delete the ask state, and a sentinel tier would put magic values in data. Exactly one representation exists per state: `{ tiers: [], any_brand: 0 }` expresses nothing and is rejected on write (`null` clears the family). Keys are the canonical id with spaces as underscores (`extra virgin olive oil` → resolve via the ingredient identity graph → `olive oil` → key `olive_oil`), unchanged by the tier model. The matcher consumes the native family object: tiers remain ordered, peers remain equal, and `any_brand` applies only after the tier ladder is exhausted.

**`[stores].primary` is the fulfillment mode** (in-store-fulfillment). It is either the literal `kroger` (online mode — the agent flushes the grocery list with `place_order`, using `preferred_location` for the Kroger API) **or** a mapped store slug from `stores/` (walk mode — the agent runs the in-store walk for that store instead). The agent picks the flush from the resolved mode and SHALL NOT assume Kroger. Mode is a property of the **preference/trip, not the chain** — a store can be online-capable and/or walk-capable. **Naming a store for one trip** ("I'm going to the West 7th Tom Thumb") overrides the standing `primary` for that trip only, without rewriting it. An unknown store-slug `primary` is **not a hard failure** (preferences is parse-only curated config) — the agent resolves it conversationally (offer to map the store, or fall back to online). `preferred_location` stays meaningful in walk mode too (it still drives Kroger pricing for sale checks).

For Kroger, `preferred_location` remains a string and stores the exact provider `locationId` after an explicit member selection. The additive `preferred_location_name` and `preferred_location_address` fields are display metadata from that result; `location_zip` is the selected result's five-digit ZIP. Legacy label/ZIP strings remain readable and resolvable, and converge only when the member picks an exact result. These are additive fields in the existing `stores` JSON column, so **no D1 migration is needed**.

### Member store-adapter projection (secret-free wire)

`GET /api/profile/store-adapters` returns the household projection assembled by `loadStoreAdapterProjection`: `adapters.kroger` (`linked` plus the exact preferred identity or null), secret-free `adapters.instacart.available`, `adapters.satellites` with configured stores and `session_fresh:null` under `state="freshness_unavailable"`, `adapters.offline` from grocery-domain rows in the shared `stores` registry, and ordered `launcher[]` entries. Launcher entries carry stable `adapter` (`kroger | instacart | satellite | offline`), `mode` (`online_order | marketplace_handoff | satellite_cart_fill | store_walk`), `enabled`, and `disabled_reason` discriminants. The payload contains no API key, OAuth token, refresh token, helper URL, or helper token.

### `instacart_links`

Tenant-scoped cache keyed by `(tenant, content_hash)`, with HTTPS `url`, `expires_at`,
and `created_at`. `content_hash` is SHA-256 over a versioned canonical serialization of
every `products_link` request field; tenant remains a mandatory SQL key rather than hash
material. Expiry cleanup is opportunistic and indexed by `expires_at`.

`POST /api/grocery/instacart` and MCP `create_instacart_handoff` return the same
`InstacartHandoffResult` discriminated union documented in `docs/TOOLS.md`. A ready URL
is a Marketplace page, not cart/order/lifecycle/spend state.

## ingredient identity (shared corpus, D1)

The ingredient normalization layer — a directed identity graph the cron grows itself
(organic-ingredient-normalization). A canonical **id** is `base` or `base::detail` — at most one
detail segment: no deterministic path constructs a deeper id (a specialization pick whose match
already carries a detail is demoted to SAME with the match, logged `specialization_demoted`), and
a deeper id observed in the registry is repaired onto its 2-segment prefix by a deterministic
per-tick sub-pass of the capture job (merge / re-root / mint-missing-prefix; logged `merge` with
`note: "segment_overflow"`);
the **base** (the id up to the first `::`) keeps the existing lowercase/space form (`ground beef`,
`olive oil`) so pre-change `sku_cache`/`brand_prefs` keys resolve unchanged, and details are
opaque discriminators to deterministic code (which compares only full-id or base equality). The
front-door `ingredient_alias` maps a surface form → id; the `ingredient_identity` registry holds
the node (with a union-find `representative` pointer, a `concrete` flag, and a cron-owned
embedding); `ingredient_edge` holds directed `satisfies` edges plus the taste-`substitution` kind (a
capture-first, weighted, satisfies()-EXCLUDED taste swap surfaced only as a read-time suggestion — see
the *ingredient-normalization capture* section of `docs/ARCHITECTURE.md`). The `readResolver` load bakes the
`representative` chain into the variant→id map. `update_aliases` writes `source='human'` (never
overwritten by the auto capture pass). A sibling re-confirm pass re-examines edgeless auto-minted
nodes against the denser registry and stamps `ingredient_identity.reconfirmed_at` once processed
(NULL = still eligible), so each node is only ever re-confirmed once; its decisions land in
`ingredient_normalization_log` alongside capture's, flagged by `is_reconfirm`. Two rolling
re-audit passes converge `source='auto'` rows to the hardened classifier rules, self-quiescing on
the one-shot `audited_at` stamps (NULL = the un-audited backlog): the **alias audit** stamps
self-aliases (variant = node id) deterministically and re-decides every other auto mapping via
the classifier (re-point / mint / merge — a stranded alias-less auto node merges into the
re-decision's node; a re-decision that only re-derives the standing survivor is a keep, logged
`specialization_demoted` or `canonical_is_standing`), and the **edge audit** deletes
representative-resolved self-loops, resolves reverse-pair 2-cycles with one satisfies-direction
check, and drops standing auto edges whose FROM→TO direction ("having FROM acceptably fulfills a
request for TO") does not hold. A **structural** edge — `X::detail → X` with a surviving
from-node — is definitionally valid: kept + stamped deterministically, never deleted, no model
call; a deterministic per-tick pre-pass of the edge audit guarantees every surviving
`base::detail` node such an edge (born-stamped inserts, missing base minted with a NULL embedding
for the backfill; logged `edge_restore` with `note: "structural_guarantee"`) and sweeps STAMPED
rep-resolved self-loop auto edges. A one-shot **replay** re-evaluates every pre-calibration
`edge_drop` log row once under the current direction check, marking each row's detail
(`replayed_at` + `replay`) and re-inserting edges whose verdict holds (logged `edge_restore` with
`replay_of`); a drop whose resolved reverse edge still stands is re-decided as a pair by that one
check — the true direction restored and a wrongly-kept reverse deleted (logged `edge_drop` with
`note: "replay_cycle"`), with human and structural reverses immune. A term (or re-audited
variant) whose punctuation- and plural-insensitive lexical form (lowercased, punctuation
collapsed to spaces, letters-only tokens of ≥ 4 chars conservatively singular-folded: `-ies`→`-y`,
`-oes`→`-o`, else one trailing `-s` unless the token ends `-ss`/`-us`/`-is`) uniquely equals a
surviving node id or known alias variant resolves SAME deterministically
(`note: "lexical_match"`, no model call) — mid-batch mints join the tick's lexical map
immediately, and a colliding form goes ambiguous (the fast path abstains). A per-tick
lexical-twin reconcile merges two surviving auto nodes of equal `concrete` whose ids share one
lexical form into the lexicographically smaller id via `representative` (plain `merge` log rows;
human-involved pairs, mixed-concreteness pairs, and 3+-survivor forms are skipped and counted in
the job summary's `lexicalTwinMerged`/`lexicalTwinSkipped`). Alias +
edge rows written by capture/re-confirm/the guarantee/the replay are born-stamped (`audited_at`
set at write time), and the edge audit's drop rows are born-marked `replayed_at`; human rows are
never selected by any audit. A **`substitution` edge** is born differently — not by the capture
cron but by the **agent-side capture trigger**: `add_to_grocery_list`'s `substitutes_for` on a food
add resolves the replaced ingredient X and the added item Y through the same funnel and, by pure set
logic (Y crosses a canonical-id boundary not already an identity neighbor of X, no classifier),
records a candidate `substitution` edge X → Y (`captureSubstitution`, `src/corpus-db.ts`). It is
operator-global: born `weight = 1` (a candidate) and incremented `+1` per repeat observation across
members, promoting past `SUBSTITUTION_PROMOTE_MIN` (2), and only promoted edges surface (the depth-1
walk). Because a substitution is a taste judgment, not identity, it is **EXCLUDED by kind from every
edge-audit read** (`readEdgeAuditBatch`, `readAllEdges`, `filterCommittableEdges`, the re-confirm
edgeless probe, and the Normalize/Nodes orphan + `satisfies`-count lenses and the audit backlog
count) — so the satisfies re-audit never selects or deletes it, it never trips the reverse-pair
2-cycle guard, and a concrete node's ORPHAN signal is never masked behind one. `audited_at` stays
NULL for it (it is never audited); the exclusion, not a stamp, keeps it out of the backlog.

```sql
-- ingredient_identity — canonical nodes. PRIMARY KEY (id).
id             TEXT  -- canonical id: `base` or `base::detail`
base           TEXT  -- id up to the first "::"  NOT NULL
detail         TEXT  -- the "::"-joined detail suffix, or NULL for a bare base
search_term    TEXT  -- human Kroger search phrase for a qualified id ("80/20 ground beef")
display_name   TEXT  -- curated human-facing label ("Red cabbage") — distinct from the id (the join
                     --   key) and from search_term (the Kroger phrase); NULL until set; classifier-
                     --   proposed at import, human-overridable via update_aliases (source='human',
                     --   never downgraded by an auto pass), reconcile-backfilled for the null backlog;
                     --   labelOf(id) returns it, else the `base (detail)` synthesis
representative TEXT  -- union-find pointer to the surviving id, or NULL (self)
concrete       INTEGER NOT NULL DEFAULT 1  -- 0 = concept node (queryable class, not buyable);
                                           --   disjunctive ids ("x or y") are always concepts —
                                           --   their search_term is a member phrase (first
                                           --   disjunct), never the disjunctive phrase
embedding      TEXT  -- JSON array of EMBED_DIM floats; cron-owned, NULL until embedded
source         TEXT NOT NULL DEFAULT 'auto'  -- 'auto' | 'human'
decided_at     INTEGER
reconfirmed_at INTEGER  -- one-shot re-confirm stamp; NULL = eligible/not-yet-re-confirmed
category       TEXT  -- the food-category memo (the ONE deterministic item→department source,
                     --   D17): produce | dairy | meat | seafood | grains | bakery | canned |
                     --   condiments | oils | spices | baking | frozen | snacks | beverages |
                     --   household (the non-food catch-all, so classification always terminates).
                     --   NULL = not yet classified; cron-owned (`ingredient-category`, survivors
                     --   only). Pantry category autofill, waste-event department stamping, and
                     --   spend capture all read it through the identity funnel
                     --   (readIngredientCategoryMemo) — never re-derived per surface. Corrections
                     --   ship as reclassify migrations (the 0042 precedent).

-- ingredient_alias — surface form → id (hot-path exact match). PRIMARY KEY (variant).
variant    TEXT  -- lowercased, quantity-stripped surface form
id         TEXT  -- → ingredient_identity.id  NOT NULL — converges to the SURVIVING id: the
                 -- sku-cache-rekey pass re-points audited/human rows whose id the representative
                 -- chain merged away (id column only; source/confidence/decided_at/audited_at
                 -- untouched); an un-audited auto row converges via the alias re-audit instead
source     TEXT NOT NULL DEFAULT 'auto'
confidence REAL
decided_at INTEGER
audited_at INTEGER  -- one-shot alias-audit stamp; NULL = un-audited backlog; born-set on new writes

-- ingredient_edge — directed edges: the factual "satisfies" kinds + the taste-`substitution`
--   kind. PRIMARY KEY (from_id, to_id, kind).
from_id    TEXT  -- satisfies kinds: A satisfies a request for to_id (reachability);
                 --   'substitution': A is an observed taste substitute for to_id
to_id      TEXT
kind       TEXT  -- 'general' | 'containment' | 'membership' — FACTUAL, satisfies()-reachable;
                 --   'substitution' — a taste swap, EXCLUDED from satisfies() (never gates a match
                 --   or a purchase), surfaced only as a labeled read-time suggestion (depth-1 walk)
source     TEXT NOT NULL DEFAULT 'auto'
weight     INTEGER NOT NULL DEFAULT 1  -- substitution edges: observation count; a candidate is born
                 --   at 1 and PROMOTES past the candidate threshold on repeat (the read surfaces
                 --   only promoted edges). Factual edges default 1 and never read it.
qualifier  TEXT  -- substitution edges: an optional caveat authored LATER (a sub ratio like '1:2', a
                 --   leavening/cook-time note); NULL until authored — a bare weighted edge is useful
audited_at INTEGER  -- one-shot edge-audit stamp; NULL = un-audited backlog; born-set on new writes

-- novel_ingredient_terms — the capture queue (surface forms not yet placed). PK (term).
-- ingredient_normalization_log — the decision audit log + evaluated-set (mirrors discovery_log).
-- outcome: same | specialization | novel | merge | error | failed | edge_drop | edge_keep | edge_restore | reshape
--   (edge_* rows are the edge audit's decisions — edge-shaped, filtered out of the admin
--    Decisions stream, queryable here)
-- is_reconfirm INTEGER NOT NULL DEFAULT 0  -- 1 = decision from the re-confirm pass, not initial capture
```

The log's `detail` JSON carries per-decision context: `reason` (the classifier's short rationale);
`note` — `confirm_failed_safe` (contract-invalid confirm → fail-safe NOVEL, or a re-audit's
keep-and-stamp) or `confirm_below_min` (the distance guard rejected a same/specialization pick,
with `rejected {outcome, match, score}`); `canonical_rejected` + `canonical_reason` (`invalid` |
`collision` | `disjunctive` — a proposed "x or y" canonical never mints a concrete disjunctive
identity) when a classifier-proposed canonical id fell back to the verbatim term; and
`edges_skipped [{from, to, kind, reason: "self_loop" | "reverse_exists"}]` for edges withheld by
the commit-time contradiction gate. Re-audit decisions carry an `audit` marker: alias-audit rows
`audit: "alias"` + `previous_id` (the mapping the re-decision replaced); edge-audit rows
`audit: "edge"` + the `direction` verdict (`forward | reverse | both | neither`) or a `note`
(`self_loop` — a deterministic delete; `human_reverse` — the auto side of a 2-cycle lost to a
human edge; `structural` — a deterministic keep of an `X::detail → X` edge; `structural_guarantee`
— a pre-pass restore; `replay_cycle` — the losing reverse of a replay pair re-decision, with
`replay_of` = the replayed log row's id). Edge rows also carry structured `from`/`to`/`kind`
fields, and `edge_drop` rows a `replayed_at` mark (born-set on new drops; the one-shot replay sets
it on the pre-calibration backlog together with `replay`: `restored | stands | structural |
self_loop | human_reverse | endpoint_merged | structural_reverse | human_reverse_standing |
confirm_failed_safe | unparseable`, plus the verdict `direction` where one was spent). Alias-audit
keeps that only re-derive the standing mapping log `note: "specialization_demoted"` (with
`proposed_detail`) or `note: "canonical_is_standing"`; deterministic lexical resolutions log
`note: "lexical_match"`. A `merge` row with `note: "segment_overflow"` records the overflow
repair (`reroot: true` for the re-root shape, `minted_prefix: true` when the prefix was minted).
A `merge` row with `note: "merge_cycle_skip"` records a refused merge: the survivor
already resolved into the loser's tree, so writing the representative would have closed a cycle
and the merge no-opped instead. Disjunction rows (disjunctive-term-modeling): a `novel` row with
`note: "disjunction_concept"` (+ `disjuncts`) is the deterministic capture disposal of an
"x or y" term into an abstract concept (no model call; the alias re-audit's parity branch adds
its `audit: "alias"` marker); a `reshape` row with `note: "disjunction_flip"` is the shape sweep
flipping a wrongly-concrete disjunction node abstract (`search_term` = the member phrase;
`reroot: true` when the inverted family was re-rooted at the base); a `merge` row with
`note: "disjunction_child_fold"` is a `::detail` child folded into its disjunction base
(`minted_base: true` when the base was minted for an orphan child); an `edge_restore` row with
`note: "disjunction_membership"` is a member → concept membership edge inserted born-stamped by
the disjunction reconcile; and a re-confirm row with `note: "concept_survivor"` (with
`rejected {outcome, match}`) is the concept–concrete merge guard rejecting a `same` pick whose
survivor is a concept node — nothing merged, the node stamped.

Example identity rows (id / base / detail):

| id | base | detail |
|----|------|--------|
| olive oil | olive oil | *(null)* |
| ground beef::fat-80-20 | ground beef | fat-80-20 |
| green onion | green onion | *(null)* — with alias `scallions → green onion` |
| chicken::thighs | chicken | thighs — edge `chicken::whole → chicken::thighs` (containment) |

## ingredient_coresolution_rejection (shared corpus, D1)

Co-resolution rejection memory (normalization-audit-calibration): a SKU co-resolution pair the
classifier confirm rejects (distinct products sharing a Kroger SKU) is remembered here so it is
not re-proposed — one wasted classifier call per tick otherwise. `(a, b)` are the pair's
**surviving** ids at decision time, lexicographically ordered; the capture job suppresses a
remembered pair for `NORMALIZE_CORESOLVE_REJECT_BACKOFF_MS` (30 days), re-confirms once after it
(a re-rejection refreshes `decided_at`), and a later merge that changes either survivor changes
the key — so a materially-changed graph re-opens the question immediately.

```sql
a          TEXT NOT NULL  -- smaller surviving id of the rejected pair
b          TEXT NOT NULL  -- larger surviving id of the rejected pair
decided_at INTEGER NOT NULL  -- epoch ms of the (latest) rejection
-- PRIMARY KEY (a, b)
```

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

Derived, time-bound state written by the flyer warm (and the satellite sale intake) into the `KROGER_KV` namespace (not the data repo — it's an ephemeral cache, regenerated each sweep/scan). Documented here for completeness; nothing edits it by hand.

- `flyer:{store}:{locationId}` → `{ sweep_id, as_of, items, store, location_id }` — the **store-namespaced** per-(store,location) rollup. The Kroger warm writes `flyer:kroger:{locationId}`; a satellite sale scan writes `flyer:{store}:{locationId}` (e.g. `flyer:target:{locationId}`). `items` are noise-floor `FlyerItem`s (`{ sku, brand, description, size, price: { regular, promo }, savings, categories, matched_terms }`) — the **identical** shape whether the source was the Kroger API or a satellite scan (savings re-derived by the Worker either way); `as_of` is epoch ms of the last contribution (surfaced to `kroger_flyer`/`store_flyer` readers as an ISO 8601 string). Shared across all tenants at that store. **Legacy read fallback:** the Kroger read path falls back to the pre-namespacing `flyer:{locationId}` key while a deploy's first namespaced sweep is pending — no cold read-gap, no data migration (the ephemeral cache converges on the next sweep; the fallback is Kroger-only, since a satellite store never had an un-namespaced key).
- `flyer:cursor` → `{ sweep_id, index, total, last_refresh_at, done, completed_at }` — the Kroger sweep's tiny per-tick progress record; the idle-tick read. `completed_at` is epoch ms of the most recent FULL sweep (monotonic — a new sweep doesn't clear it), the freshness signal the warm's health record carries.
- `flyer:plan` → `{ sweep_id, units }` — the Kroger sweep's ordered `(locationId, term)` unit list, built once per sweep so later ticks don't re-enumerate.
- `sale-scan:cursor` → `{ last_refresh_at }` — the sale-scan producer's refresh marker (mirrors `flyer:cursor`), gating a fresh enqueue cycle to the daily cadence; between cycles the producer is a cheap no-op. (A rollup key always carries a `locationId` segment, so it never collides with these `flyer:cursor`/`flyer:plan`/`sale-scan:cursor` markers.)

## Query-embedding cache (KV, not a repo file)

Content-addressed request-time query vectors (member-app-propose D5), in the `KROGER_KV` namespace beside the flyer cache — the ephemeral-infra home for derived, self-expiring, deliberately **cross-tenant** state (a vector is a pure function of a public model and the text; there is no tenant dimension to leak). Written/read by `embedTextsCached` (`src/embedding.ts`); nothing edits it by hand.

- `embed:<sha256-hex(EMBED_MODEL + "\n" + normalized)>` → the raw JSON `EMBED_DIM`-float array, exactly as Workers AI returned it (full precision, no rounding — while an entry lives, every re-submission of the phrase ranks with the byte-identical vector). `normalized` is the query text lowercased, trimmed, inner whitespace collapsed, so case/spacing variants share one entry. Folding the model id into the hashed material **welds the cache to the model**: an `EMBED_MODEL` change (which re-embeds the whole index anyway) orphans old entries to TTL expiry — no version constant to bump, and a mismatched vector can never be served. SHA-256 (not the 8-hex FNV-1a `hashText`) because a hash collision here would silently serve the wrong *vector*, which does not self-heal.
- Written with `expirationTtl` = 30 days, fixed at put (no rolling re-put — an expiry costs one cheap re-embed). Misses within one request are embedded in a **single batched** Workers AI call and written back best-effort; a KV read/write failure or a malformed value **fails open** to the plain embed (never fails the request).
- Callers: the propose operation (`nudges.freeform` + `slots[].vibe` phrases) and `search_recipes` ranked mode's vibe embeds — a phrase recently embedded by either surface is a warm hit for both. The scheduled reconciles (`recipe-embeddings.ts`, `night-vibe-vector.ts`) do **not** route through it: they already hash-gate their embeds in D1 and never re-embed unchanged text.

## Web sessions (KV, not a repo file)

The member web app's session store (member-session-auth), in the `TENANT_KV` namespace beside the `tenant:*` allowlist and `invite:*` codes — identity-adjacent operational state, never domain data. Written/read by `src/session.ts`; nothing edits it by hand.

- `session:<token>` → `{ tenant, member, created_at, refreshed_at }` (epoch ms) — one record per live web session, bound to the `(tenant, member)` pair that logged in. `<token>` is 32 bytes from `crypto.getRandomValues`, base64url (256 bits, never logged); the same value rides the `__Host-session` cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age` 90d). Written with `expirationTtl` ≈ 90 days — **the KV TTL is the single expiry authority** (no second clock). A record minted before the member-identity split has no `member` field and resolves to the **founding member** (`member = tenant` — the uniform legacy-defaulting rule); the throttled rolling refresh re-puts the record carrying `member`, so live legacy sessions converge organically. The middleware re-puts with a fresh TTL only when `refreshed_at` is >24 h old, so a chatty session costs ≤1 extension write/day. Deleted on logout, scanned-and-deleted by household purge (matching the stored `tenant`) and by member-revoke (matching the record's resolved member, legacy defaulting included); the middleware's `resolveIdentity` allowlist + member-liveness re-check makes a missed key moot.
- **Fixed-window rate-limit counters** (`KROGER_KV` — ephemeral infra, self-expiring): the shared limiter (`src/rate-limit.ts`, `underRateLimit(kv, key, max, windowS, now)` — fail-open, `expirationTtl: windowS × 2`) appends a window bucket to its caller's key. Callers: `ingest:rl:<keyId>:<bucket>` (the satellite push/pull surfaces, 120/min per key) and `login:rl:<ip>:<bucket>` (member login, 10/min per client IP from `CF-Connecting-IP`, `"unknown"` fallback).

## Invite records (KV, not a repo file)

The operator-issued **bootstrap** codes, in the `TENANT_KV` namespace beside the `tenant:*` allowlist and `session:*` records (member-session-auth / passkey-auth). Written by `onboard()`/`rotate()` (`src/admin.ts`), resolved by `resolveInvite` (`src/tenant.ts`); nothing edits them by hand. An invite code is a **single-use bootstrap**, not a standing credential: it authenticates a web `/login` and (while grace is on) a Claude.ai `/authorize` only until the member's first passkey enrollment consumes every `invite:*` mapping resolving to their tenant.

This KV bootstrap path is one of **two, deliberately separate, invite systems**. A KV `invite:<code>` **resolves an existing** tenant (operator onboarding + recovery of one named member). A **group invite code** (self-service-signup, in D1 — see *Group invite codes* below) **creates a new** tenant from a self-chosen username. The two never share a namespace or a redemption path.

- `invite:<code>` → `{ v, tenant, member, single_use, expires_at }` (JSON) — a code minted by `onboard()`/`rotate()`. `v` is the record-shape version; `tenant` is the allowlisted tenant id and `member` the member id the code resolves to (the admin surface mints founding-member codes); `single_use` is `true`; `expires_at` is the code's expiry. Written with a **30-day KV `expirationTtl`**. `rotate()` mints a grace-bypassing single-use bootstrap — the recovery primitive for a member who lost every device or was never enrolled before grace was turned off (see `SELF_HOSTING.md`).
- **Legacy shapes:** a pre-migration invite record is a **bare-string** value (just the tenant id, no JSON), and a JSON record written before the member-identity split has no `member` field. `resolveInvite` parses all of these; a record without a member dimension resolves to the **founding member** (`member = tenant` — the uniform legacy-defaulting rule). Whether a legacy bare-string code still *authenticates* is governed by the operator `INVITE_GRACE` grace control (a Worker `var`, default on; see `SELF_HOSTING.md`): honored while grace is on, rejected once it is off. A single-use JSON bootstrap is always honored until consumed/expired, regardless of the grace flag.

## Group invite codes + the tenant registry (D1: `signup_invites`, `signup_redemptions`, `tenants`)

The self-service-signup store (multi-use group invite codes), all in D1 via `src/signup-db.ts` (never `env.DB` directly). Distinct from the KV `invite:<code>` bootstrap path above: a group code **creates** a tenant, a bootstrap code **resolves** one. An operator mints a group code with a **cap** (max redemptions) and an optional **expiry** + **label**; a friend redeems it at `POST /api/signup` under a chosen username, which atomically creates a new isolated tenant. Redemption is web-app-only (never the MCP `/authorize` surface). Migration `0047_self_service_signup`.

**The invite-kind trio** — three deliberately separate kinds, distinguished by authority and effect, sharing **no namespace and no redemption path** (each path rejects the foreign kinds uniformly): the KV `invite:<code>` **bootstrap** (operator-minted; RESOLVES an existing `(tenant, member)` for login/enrollment), the D1 **group invite code** here (operator-minted; CREATES a standalone tenant, capped, no social edge), and the D1 **`member_invites` link** (member-minted; creates a RELATIONSHIP — household membership or a friendship — and an account when the redeemer has none; see its own section).

- **`tenants`** — the FIRST strongly-consistent registry of tenant ids, keyed by the canonical lowercase id (`PRIMARY KEY`), the **uniqueness authority** for self-service username claims. A claim does `INSERT … ON CONFLICT(id) DO NOTHING` and wins iff first; the KV `tenant:<id>` allowlist entry (still the hot-path resolution authority) is written only after the claim wins. `via_code` is the group code that created the tenant, or `NULL` for an operator-onboarded member. Existing tenants are backfilled here idempotently on the `scheduled()` reconcile (`backfillTenantRegistry`, `src/signup.ts`). Purged (by `id`) on member revocation.
- **`signup_invites`** — the group codes. `used` is bumped by a guarded `UPDATE … WHERE used < max_redemptions AND (expires_at IS NULL OR expires_at > ?) AND revoked_at IS NULL` — a single serialized statement that is the **atomic cap gate**, so the cap is never exceeded under concurrency. Revoking sets `revoked_at` (halts further signups; accounts already created are untouched). Operator-owned, NOT per-tenant — never purged on member revoke.
- **`signup_redemptions`** — provenance: one row per created tenant linking it to the code it came from (`idx_signup_redemptions_code`, `idx_signup_redemptions_tenant`). In the per-tenant `TENANT_TABLES` purge, so member revocation deletes a member's rows.

Redemption is phased so every intermediate state fails toward **under-granting**: spend a slot (guarded UPDATE, `changes === 1`), claim the username (`INSERT tenants … ON CONFLICT DO NOTHING`; on collision **refund** the slot), record provenance. A crash between phases can at worst waste one slot — never exceed the cap or double-claim a name — so no multi-statement transaction is required.

```sql
-- D1 tenants — the tenant-id uniqueness registry. PRIMARY KEY (id).
id         TEXT     -- canonical lowercase username (the uniqueness authority)
created_at INTEGER  -- epoch ms
via_code   TEXT     -- the group code that created it; NULL for operator-onboarded

-- D1 signup_invites — operator-issued group codes. PRIMARY KEY (code).
code            TEXT     -- the group invite code (16 hex chars)
max_redemptions INTEGER  -- the cap
used            INTEGER  -- redemptions spent (total ever, not decremented on member revoke)
expires_at      INTEGER  -- epoch ms; NULL = never expires
revoked_at      INTEGER  -- epoch ms; NULL = active
label           TEXT     -- optional operator label (nullable)
created_at      INTEGER  -- epoch ms

-- D1 signup_redemptions — provenance. idx on (code) and (tenant).
code       TEXT     -- the group code
tenant     TEXT     -- the created tenant id (isolation column for the revoke purge)
created_at INTEGER  -- epoch ms
```

## members (D1 `members` table)

The member-identity substrate (multi-tenancy): one row per member within a tenant (household). The **tenant is the isolation boundary; the member is attribution within it** — every per-request identity resolves to a `(tenant, member)` pair before any tool or route runs. Every tenant created by onboarding or a tenant-creating signup path has a **founding member whose id and handle equal the canonical tenant id**, so every credential value issued before the member-identity split (grant props, session records, WebAuthn user handles, invite mappings, note-author values) is already a valid member id — zero re-keying, by construction. A tenant **spawned by the member-move primitive** (leave-household / eviction) is instead founded by the moving member, who keeps their existing id and handle (member ids never change — WebAuthn user handles are burned into authenticators). Read/written only through `src/members-db.ts` over `src/db.ts` (never `env.DB` directly). Migration `0058_member_identity`.

- **Minting:** every tenant-creation path writes the founding member in the same flow — operator onboarding (`onboard()`), group-code self-service redemption (`redeemGroupCode`), friend-tier invite-link redemption (`/api/join`), the member-move spawn, the migration's idempotent seed over the `tenants` registry, and a **lazy convergence guard** at identity resolution that mints the founding row only when the presented member id equals the tenant id AND the tenant has zero member rows (healing a KV-allowlisted tenant the registry missed; under any other condition a missing member row is a structured `unauthorized`). **Non-founding members** are minted with server-generated ULID ids and a member-chosen handle (household-tier invitation accepts and join-link redemptions), bounded by the household size cap (`HOUSEHOLD_MAX_MEMBERS`, 8).
- **Handles** are deployment-unique (`idx_members_handle`, a unique index). Every NEW handle or username mint — join-link and invitation handles, self-service usernames, operator-onboarded usernames — validates the ONE product handle grammar `^[a-z0-9_]{3,20}$` (`HANDLE_RE`, `src/members-db.ts`). Everything already issued is grandfathered verbatim, including values outside the grammar (no read-path validation anywhere); machine-suffixed spawned-tenant ids (`<handle>-2`, `-3`, …) use a hyphen deliberately outside the grammar so they can never collide with a future mint. Handle rename rules belong to later changes.
- **Lifecycle:** in the household-purge `TENANT_TABLES` batch (all rows for the tenant); member-revoke deletes one row — refused for a tenant's last member, in-batch as well as up front.

```sql
-- D1 members table. PRIMARY KEY (id); UNIQUE idx_members_handle on (handle);
-- idx_members_tenant on (tenant).
id         TEXT     -- opaque member id; founding member: equals the tenant id
tenant     TEXT     -- owning household (isolation column)
handle     TEXT     -- deployment-unique display key; founding: equals the tenant id
created_at INTEGER  -- epoch ms
```

## friendships (D1 `friendships` table)

The symmetric, accepted-only tenant↔tenant edge relation (social-graph) — the data source of the visibility lens's friend seam (`friendHouseholds`, `src/visibility.ts`). Each edge is stored **once** as a canonically ordered pair (`tenant_a < tenant_b`, CHECK-enforced), so duplicates and self-edges are unrepresentable. **Accepted-only by construction:** pending state lives in `social_requests`, never here — a row here IS an accepted friendship, and severing (unfriend / friend-tier block / purge) is a plain delete that hides both cookbooks on the next lens read. Read/written through `src/social-db.ts` over `src/db.ts`. Migration `0060_households_social`.

```sql
-- PRIMARY KEY (tenant_a, tenant_b); CHECK (tenant_a < tenant_b); idx_friendships_b on (tenant_b).
tenant_a     TEXT     -- lexicographically LOWER tenant id
tenant_b     TEXT     -- lexicographically HIGHER tenant id
requested_by TEXT     -- member id that sent the originating request
created_at   INTEGER  -- epoch ms
```

## social_requests (D1 `social_requests` table)

Household/friend request rows (social-graph), append-then-resolve. `tier` is `household` (an INVITATION into the sender's household, addressed to the invitee personally) or `friend` (addressed to the target household — any member may act). The requester's view derives from state: **`pending`, `declined`, and `swallowed` all render "Request sent"** (D24's invisible decline), the standing outgoing cap counts all three, and no read ever distinguishes them to the requester. `swallowed` rows (an active 30-day decline cooldown or a household-wide block match at send time, or a block minted over a pending row) reach **no inbox** and their `note`/`display_name` are never delivered. A declined pair's cooldown anchor is its `resolved_at`; cancelling keeps a declined row's anchor (state `cancelled`, `resolved_at` preserved) and nulls it for cancelled pending/swallowed rows, so the cooldown probe reads `declined` rows plus `cancelled` rows with a non-null `resolved_at`.

```sql
-- PRIMARY KEY (id) — a ULID. idx_social_requests_to on (to_tenant, state);
-- idx_social_requests_from on (from_tenant, state).
id           TEXT     -- ULID
tier         TEXT     -- 'household' | 'friend'
from_tenant  TEXT     -- sending household
from_member  TEXT     -- sending member
to_tenant    TEXT     -- target household (friend tier); invitee's household at send time
to_member    TEXT     -- the looked-up member; household tier: the invitee (personal)
note         TEXT     -- inert plain text, <= 200 chars; rendered quoted, never interpreted
display_name TEXT     -- sender-supplied self-introduction (the nickname seed)
state        TEXT     -- 'pending' | 'accepted' | 'declined' | 'cancelled' | 'swallowed'
created_at   INTEGER  -- epoch ms
resolved_at  INTEGER  -- epoch ms; a declined row's value is the pair's cooldown anchor
```

## member_invites (D1 `member_invites` table)

Member-minted invite links (social-graph) — the **third invite kind** (see the trio note under *Group invite codes*). Single-use, 14-day expiry, per-invite `inviter_member` + `tier`; the link is `<origin>/join/<token>`. Redemption claims the token **atomically with what it creates** (a guarded UPDATE — one winner; a downstream handle/username collision refunds the claim, the group-code idiom). Unknown, expired, revoked, and already-redeemed tokens are **indistinguishable** on `/api/join` (one uniform `invalid_or_expired` — cancel = revocation, oracle-free), and a blocked party's redemption consumes the token and creates nothing, behind the same uniform state. Friend-tier mints are refused under the self-hosted profile.

```sql
-- PRIMARY KEY (token) — >= 128 random bits, base64url. idx_member_invites_tenant on (tenant).
token          TEXT     -- the bearer token (unguessable, never logged)
tenant         TEXT     -- inviter household (isolation column)
inviter_member TEXT     -- the minting member
tier           TEXT     -- 'household' | 'friend'
created_at     INTEGER  -- epoch ms
expires_at     INTEGER  -- epoch ms (mint: created_at + 14 days)
revoked_at     INTEGER  -- epoch ms; NULL = live (cancel = revoke)
redeemed_at    INTEGER  -- epoch ms; NULL = unredeemed (single-use claim stamp)
redeemed_by    TEXT     -- resulting member id (household) or tenant id (friend)
```

## nicknames (D1 `nicknames` table)

Per-viewer, **others-only** aliases (social-graph): one row per `(viewer_member, target_member)`, writable only by the viewer, never disclosed to the named member or any third member on any surface (a member's export includes nicknames they SET, never nicknames set FOR them). Empty-save clears (row delete); the canonical pair key makes the member app's offline replay converge. Seeded from a newcomer's self-supplied `display_name` when a relationship forms (only for viewers without an existing alias — seeds are ordinary editable rows). `tenant` is the VIEWER's household (isolation/purge column; re-keyed when the viewer moves households). Targets may be any live member of the deployment.

```sql
-- PRIMARY KEY (viewer_member, target_member); idx_nicknames_tenant on (tenant).
tenant        TEXT     -- the VIEWER's household (isolation column)
viewer_member TEXT     -- who set the alias (the only member who ever sees it)
target_member TEXT     -- who it names (never told)
nickname      TEXT     -- <= 40 chars plain text
updated_at    INTEGER  -- epoch ms
```

## blocks (D1 `blocks` table)

Directional, tier-scoped suppression records (social-graph, D24). Minted by one member from an inbox row, an awaiting-response row, or a friend row — but **evaluated household-wide** (one member's block binds the household). A matching block makes the counterparty's future requests of that tier silently swallow, swallows their existing pending inbox rows at mint time, severs the friendship when minted from a friend row, and makes their invite-link redemptions consume-and-create-nothing. Household-tier blocks record `blocked_member` and match by member id (the protection follows the person across member-moves); friend-tier blocks match by tenant. Block records stay with the household that minted them when the minter later moves. Silent-swallow subsumes mute — no separate mute exists; unblock is a plain delete that retroactively delivers nothing.

```sql
-- PRIMARY KEY (tenant, tier, blocked_tenant).
tenant          TEXT     -- blocking household (isolation column)
blocking_member TEXT     -- the member who clicked (audit; evaluation is household-wide)
tier            TEXT     -- the tier this record suppresses ('household' | 'friend')
blocked_tenant  TEXT     -- counterparty household at mint time
blocked_member  TEXT     -- set for household-tier blocks (follows the person); NULL for friend
created_at      INTEGER  -- epoch ms
```

## WebAuthn ceremony state (KV, not a repo file)

Ephemeral, single-use ceremony state for passkeys and the cross-device MCP approval (passkey-auth), in the `TENANT_KV` namespace — identity-adjacent, self-expiring, mirroring the Kroger PKCE-nonce pattern. Written/read by `src/webauthn.ts` / `src/authorize.ts`; nothing edits it by hand.

- `webauthn:chal:<challenge>` → the ceremony **purpose** string, `"reg"` or `"auth"` (the challenge string itself is the key; no tenant is bound to the challenge — the enrolling tenant comes from the session at verify time). **Single-use** — deleted on verification — with a short TTL (~5 min). A returned attestation/assertion is verified against the stored challenge; a missing or already-consumed challenge, or a purpose mismatch, fails verification.
- `authz:<ref>` → `{ oauth, clientName, code, status, tenant?, member? }` — the Claude.ai `/authorize` **approval reference**. `oauth` is the base64-encoded parsed OAuth request; `clientName` is the requesting client's display name; `code` is the short human-readable verification code shown on both the `/authorize` page and the web app's `/connect` screen; `status` is `"pending"` → `"approved"`; `tenant` and `member` are bound server-side from the approving passkey-authenticated session (pending-only and one-shot — an approved reference is never re-bound; a record written before the member-identity split has no `member` and claims as the founding member). **Single-use** with a ~10-min TTL — the poll completes `completeAuthorization` EXACTLY ONCE and then deletes the reference; an expired or already-consumed reference is rejected and mints no token. The completed grant carries `props: { tenantId, memberId }` with the grant's `userId` = the tenant id (the roster's `grant:<userId>:*` scan contract); a grant minted before the split carries `props: { tenantId }` only and resolves to the founding member on every MCP request.

## webauthn_credentials (per-tenant, D1 `webauthn_credentials` table)

Each member's enrolled **passkeys** (passkey-auth) — one row per device, many per tenant and per member. A member authenticates on both member surfaces with these credentials; the invite code is only the single-use bootstrap that seeds their first login/connection (see *Invite records* above). Written/read through `src/db.ts` (never `env.DB` directly), keyed by the credential id; `idx_webauthn_tenant` on `(tenant)` backs the list-by-tenant read and the purge. Scoped by both lifecycle operations: household purge (the `TENANT_TABLES` batch, `src/admin.ts`) deletes every row for the tenant; member-revoke deletes only the revoked member's rows. Passkey login and connect-approve are rate-limited per client IP by the shared fixed-window limiter (`src/rate-limit.ts`, fail-open). Migrations `0046_webauthn_credentials` + `0058_member_identity` (the `member` column).

Binary fields are stored **base64url** (the Worker runs on `workerd` — no `Buffer`): `credential_id` and `public_key` are base64url text. The verification library is `@simplewebauthn/server@13.3.2` (pure WebCrypto), supporting at least ES256 (`-7`) and RS256 (`-257`); registration is `residentKey: "required"` / `attestation: "none"` with the WebAuthn user handle = the **member id** (for a founding member that equals the tenant id — exactly the handle every credential enrolled before the member-identity split carries burned in, which is why the migration backfill re-keys nothing).

```sql
-- D1 webauthn_credentials table — one row per enrolled device. PRIMARY KEY (credential_id).
-- idx_webauthn_tenant on (tenant).
tenant        TEXT     -- owning tenant/household (many rows may share it)
member        TEXT     -- owning member (= the credential's user handle); backfilled to tenant by 0058
credential_id TEXT     -- WebAuthn credential id, base64url — the primary key
public_key    TEXT     -- COSE public key, base64url
sign_count    INTEGER  -- authenticator signature counter; STORED, NEVER ENFORCED (see below)
transports    TEXT     -- JSON string[] of reported transports (e.g. ["internal","hybrid"]); may be []
label         TEXT     -- optional human label for the device (nullable)
created_at    INTEGER  -- epoch ms of enrollment
last_used_at  INTEGER  -- epoch ms of the last successful assertion (nullable until first use)
```

**The signature counter is stored but never enforced.** `sign_count` is updated to the value each assertion reports, but an assertion is NEVER rejected because the counter failed to advance: synced passkeys (iCloud Keychain, Google Password Manager) report `0` or a non-incrementing counter, and enforcing would reject legitimate logins. Counter regression is therefore not treated as a cloning signal that blocks login.

## Background-job health (D1 `job_health` table)

Derived operational state for the `/health` endpoint (background-job-health). Each background process upserts one row per run; `/health` aggregates them. Tenant-data-free by construction — counts, timestamps, and error classes only. It lives in D1 (not KV) because persisting per-job liveness on every cron tick is standing write load that belongs in D1's far larger budget (migration `0019_job_health`).

- `job_health` table — columns `name` (TEXT PRIMARY KEY), `ok` (INTEGER 0/1), `last_run_at` (INTEGER epoch ms), `summary` (TEXT, a JSON object). One upserted row per registered job (`flyer-warm`, `sale-scan-plan`, `recipe-classify`, `recipe-index`, `recipe-embed`, `discovery-sweep`, `email`, …), written through `src/db.ts`. `ok` is the last run's success; `summary` is small tenant-clean detail (the warm carries `{ action, done, sweep_started_at, sweep_completed_at, errors }`; the sale-scan producer carries `{ action, pairs, enqueued, pruned }`; the recipe-index projection carries `{ projected, skipped, unresolved, degraded }` — `unresolved` is the distinct projected ingredient terms the current resolver has not placed, the capture-convergence gauge; `degraded` is true when the resolver read failed and the pass ran on the empty context (which also counts every term unresolved) — the alertable signal, since the projection itself still reports ok; the recipe-facet classify pass carries `{ classified, pending, parked, errored, pruned, quota_exhausted, timed_out }`; the discovery sweep carries `{ processed, imported, duplicate, no_match, dietary_gated, parked, deferred, taste_updated, log_pruned }`; the email handler carries the gate outcome `{ accepted, reason, written }`; the alias re-audit carries `{ audited, self_stamped, kept, repointed, minted, merged, skipped }`; the edge re-audit carries `{ audited, self_loops, cycles, dropped, kept, skipped, structural, structural_restored, self_loops_swept, replayed, restored }`; the sku-cache re-key carries `{ rekeyed, merged, truncated }`).
- `GET /health` → `{ ok, generated_at, jobs: [{ name, ok, last_run_at, never_run?, summary? }], d1: { ok }, admin: { access_configured, email_allowlist, dev_bypass_set, exposed }, ai_quota_exhausted }` — **open and tenant-clean** (no token; the D1 probe is coarsened to a boolean so no raw `storage_error` string is exposed; the `admin` posture is booleans only — never the allowlisted emails). Aggregate-only. Overall `ok` is false when a job is *explicitly* failing, the D1 probe failed, the admin gate is `exposed` (the dev bypass set on a surface Access doesn't protect — only the loopback guard stands between it and an open panel), or `ai_quota_exhausted` is true; a never-run job is reported with `ok: null, never_run: true`. The top-level **`ai_quota_exhausted`** boolean is aggregated from the AI jobs' summaries (an explicit `quota_exhausted` flag or a 4006/"neurons" error string) and **names** Workers AI's daily-allocation exhaustion rather than leaving a generic job-fail — `/health.svg` renders an explicit `ai  quota exhausted` row and the admin Status view banners it. HTTP status is 200 when ok, 503 when failing (so plain HTTP-status monitors trip). Restricting reads is an edge concern (Cloudflare Access / WAF), not Worker config.
- `GET /health.svg` → the same aggregate payload rendered as an SVG **card** (`content-type: image/svg+xml`) for a README badge (data-repo-health-badge). **Open** like `/health` (no token — a public README badge must be anonymously fetchable), but **always HTTP 200** — degraded state is shown by color, not status, because an image proxy (GitHub Camo) may not render a non-200 as an image — with a short `Cache-Control` so it refreshes on a TTL. Tenant-data-free; a never-run job renders amber (pending), not red, and the `admin` row shows the gate state (green `gated` / muted `disabled`|`dev` / red `exposed`). It's a glance, not an alarm: point real HTTP-status/freshness monitors at `/health` (JSON), not `.svg`.

## Background-job run history (D1 `job_runs` table)

The per-run **history** behind `job_health`'s last-state row (background-job-health), backing the admin Status area's per-job uptime sparkline and "healthy/unhealthy since" label (and, downstream, the Logs area's all-jobs run log). `job_health` upserts ONE row per job; `job_runs` is the per-run series — appended beside every `job_health` write, never updated, and bounded per job (migration `0023_job_runs`).

- `job_runs` table — columns `id` (TEXT PRIMARY KEY, a writer-stamped unique id), `job` (TEXT), `ok` (INTEGER 0/1), `ran_at` (INTEGER epoch ms), `duration_ms` (INTEGER), `summary` (TEXT, a JSON object — the SAME tenant-clean shape as the paired `job_health.summary` for that run). Indexed on `(job, ran_at DESC)`. One inserted row per run, written through `src/db.ts` by `writeJobRun` (`src/health.ts`) at every `writeJobHealth` call site (`src/index.ts`'s `email` handler, and `flyer-warm.ts`/`recipe-classify.ts`/`recipe-projection.ts`/`recipe-embeddings.ts`/`discovery-sweep.ts`/`ingredient-normalize.ts`/`ingredient-reconfirm.ts`/`ingredient-alias-audit.ts`/`ingredient-edge-audit.ts`/`sku-cache-rekey.ts`/`grocery-pantry-reconcile.ts`'s scheduled-run wrappers). A history-write failure degrades to a no-op (never blocks or fails the job it instruments), exactly like `writeJobHealth`'s call-site `.catch(() => {})`.
- **Retention:** bounded per job at `JOB_RUNS_PER_JOB_CAP` (100) — `writeJobRun` prunes that job's rows beyond the cap on every append, so the table cannot grow without limit.
- `readJobRuns(env, name, limit)` → the named job's most recent `limit` runs, newest-first, each `{ id, ok, ran_at, duration_ms, summary }`. Degrades to `[]` when D1 is unreachable rather than throwing (the Status page must stay renderable; the live D1 probe carries that signal separately).
- `currentStreakStart(runs)` → the earliest `ran_at` in the unbroken run of the job's current `ok` value, given a newest-first `runs` array (as `readJobRuns` returns) — the "healthy since" / "unhealthy since" instant the Status job rows render. Returns `null` for an empty history (no sparkline / since-label shown in that case).

## Usage trends (Workers Analytics Engine `yamp_usage` dataset)

The per-run **history** tier (usage-trends), complementing the `job_health` D1 liveness row. Each registered background job emits **one tenant-clean data point per run** through `recordUsagePoint` (`src/health.ts`) to the `yamp_usage` Analytics Engine dataset (binding `USAGE_AE`). AE `writeDataPoint` is non-blocking and costs **no KV or D1 budget**; the emission is best-effort (an unbound binding or a throw is a swallowed no-op).

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

## Tool usage trends (Workers Analytics Engine `yamp_tool` dataset)

The per-MCP-tool-call **history** tier (tool-usage-trends), the request-path sibling of `yamp_usage`. Every tool call emits **one tenant-clean data point** through `recordToolPoint` (`src/health.ts`), fired once from the `buildServer` registration decorator (`src/tool-instrumentation.ts`, which wraps `server.registerTool` so every tool — present and future — is covered at one seam). The outcome is read from the tool's MCP result (`runTool`'s `fail()` sets `isError`); a raw throw records `error`. Emission is best-effort, non-blocking, and fires after the result is computed, so it never changes a tool's result or adds latency; it costs **no KV or D1 budget**.

Same positional-contract rule as `yamp_usage` — slots are referenced by position, so a later change must not reorder them. Slot layout:

- `index1` = tool name (the sampling key)
- `blob1` = tool name · `blob2` = outcome (`"ok"` | `"error"`) · `blob3` = **RESERVED** for a future error code (not written today)
- `double1` = call duration (ms)
- `timestamp` = AE-supplied write time

The **member `/api` surface emits into this same dataset** (member-api): the shared `/api` middleware records one point per request with the same slot layout, named `api:<METHOD> <matched route pattern>` (e.g. `api:POST /api/session`) in `index1`/`blob1` — always the matched pattern, never the raw URL, so points stay low-cardinality and tenant-clean. App usage thereby reads beside tool usage with no new AE binding.

Tenant-data-free by construction — the tool name (a fixed, low-cardinality enum), the outcome, and the duration only, never a per-tenant id or any call argument. Read back per tool via the AE **SQL API** (see the Tool usage trends dashboard below).

## AI usage attribution (Workers Analytics Engine `yamp_ai` dataset)

The per-AI-call **history** tier (ai-usage-attribution), a **third** sibling of `yamp_usage`/`yamp_tool`. Every `env.AI.run` inference the Worker performs routes through the single `src/ai.ts` gateway (`runAi`), which emits **one tenant-clean data point per call** through `recordAiPoint` to the `yamp_ai` Analytics Engine dataset (binding `AI_AE`). The gateway sits **below the KV embedding cache** (`embedTextsCached` short-circuits on a hit *before* the real inference), so a cache hit spends no neurons and emits **nothing** — a point is written only for a genuine inference. Emission is best-effort (an unbound `AI_AE` or a throwing `writeDataPoint` is a swallowed no-op) and non-blocking, and costs **no KV or D1 budget** — exactly like `recordUsagePoint`/`recordToolPoint`. It captures WHICH of the Worker's ~13 AI activities spent the neurons — the attribution Cloudflare's account-level analytics, which groups only by model, cannot show.

Same positional-contract rule as `yamp_usage`/`yamp_tool` — slots are referenced by position, so a later change must not reorder them. Slot layout:

- `index1` = activity (the sampling key)
- `blob1` = activity · `blob2` = model label (`"mistral-small"` | `"bge-base"`) · `blob3` = trigger (`"cron"` | `"import"` | `"request"`) · `blob4` = outcome (`"ok"` | `"error"`)
- `double1` = call duration (ms) · `double2` = calls (1 for a text-gen call; the batch size for a batched embedding call) · `double3` = input tokens (text-gen: the real `usage.prompt_tokens`; embeddings: a `chars/4` length estimate) · `double4` = output tokens (text-gen: `usage.completion_tokens`; embeddings: `0`) · `double5` = est_neurons (DERIVED — see below)
- `timestamp` = AE-supplied write time

`activity` is a **fixed, documented enum** — finer than a job name (one job spans several) and spanning triggers (the same activity fires from cron and import): the text-gen (mistral-small) activities `classify`, `describe`, `confirm-match`, `title-clean`, `ingredient-confirm`, `ingredient-category`, `nightvibe-name`; the embedding (bge-base) activities `embed-recipe`, `embed-discovery`, `embed-nightvibe`, `embed-taste`, `embed-ingredient`, `embed-search`, `embed-admin-search`. `trigger` makes non-cron spend first-class: `cron` (the reconcile/audit passes), `import` (`create_recipe`'s inline description/facet seeds), `request` (the member/agent tool path — cache-gated to near-zero).

`est_neurons` is a **DERIVED estimate**, never a billing figure: `input_tokens × in-rate + output_tokens × out-rate`, using a per-model neuron rate table in `src/ai.ts` (from Cloudflare's published Workers AI pricing, $0.011 / 1000 neurons) — `mistral-small`: **31876** neurons/M input + **50488** neurons/M output; `bge-base`: **6058** neurons/M input (embeddings produce no output tokens). Storing the raw tokens alongside means a later rate correction recomputes forward from tokens with no schema change. The Usage panel always renders the summed estimate against the account-level by-model actual (`fetchUsage`'s `ai.by_model`, the canonical neuron source), so the estimate's fidelity is self-evident.

Tenant-data-free by construction — the activity (a fixed enum), model, trigger, outcome, and numbers only, never a per-tenant id or any input text. Read back per `(activity, model, trigger)` via the AE **SQL API** (`fetchAiUsage`, `src/usage.ts`; see the Usage dashboards below). AE free-tier retention (≈90 days) bounds the queryable window.

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
- `POST /admin/api/tenants` `{ username, invite_code? }` → `{ username, invite_code, connector_url }` — onboard; writes `tenant:<id>`, the founding `members` row (id and handle = the canonical tenant id), and `invite:<code>` resolving to that `(tenant, member)` pair (generates the code when omitted). `connector_url` is `<origin>/mcp`.
- `POST /admin/api/tenants/<id>/rotate` → `{ username, invite_code, connector_url }` — mint a new code, delete the member's prior `invite:*` mapping(s). Member-addressed with the founding member as the default (the endpoint passes only the tenant id); allowlist, member row, + per-tenant data untouched. Errors `not_found` if the member is absent.
- `POST /admin/api/tenants/<id>/kroger-login` → `{ url }` — mint a single-use Kroger consent link bound to an allowlisted member (the same nonce the `kroger_login_url` MCP tool mints, allowlist-rechecked via `resolveTenant`), so the operator can link a member who has no `/mcp` session yet. The nonce rides only in the returned `url` and is never logged; `not_found` for a non-member.
- `DELETE /admin/api/tenants/<id>` → `{ username, revoked: true, invites_removed, sessions_removed }` — **household purge**: remove `tenant:<id>` + every `invite:*`/`session:*` resolving to the tenant + `kroger:refresh:<id>`, and purge the per-tenant D1 tables (`members` included) + all members' attributed notes (`author IN` the household's member set, deleted before the `members` rows so non-founding authors never orphan) + the household's social rows in **both directions** (`friendships` and `social_requests` as either party, its `member_invites`, `nicknames` it holds and nicknames targeting its members, `blocks` it minted and blocks recorded against it or its members) through `src/db.ts`. The household's issued tokens stop resolving (allowlist re-check fails).
- `DELETE /admin/api/tenants/<id>/members/<member>` → `{ username, member, revoked: true, invites_removed, sessions_removed }` — **member revoke**: delete one member's `members` row, `webauthn_credentials` rows, attributed notes (`author = member`), their social rows (nicknames set and targeting them; outgoing `social_requests` cancelled; minted `member_invites` revoked; `blocked_member` block records), and every `session:*`/`invite:*` resolving to that member (a pre-split record with no member field belongs to the founding member) — leaving the allowlist entry, `tenants` registry row, Kroger token, and household tables untouched. The member's grants/sessions stop resolving via the shared resolver's member-liveness check. Refused (`conflict`) for a tenant's last member — enforced inside the delete batch too (a concurrent last-two-members race can never produce a zero-member allowlisted tenant); household purge is the applicable operation.

**Usage dashboards** (SSR at `/admin/usage`, rendered in-process from `src/usage.ts` — no JSON route): each view renders either `{ configured: false }` (when `CF_ACCOUNT_ID`/`CF_ANALYTICS_TOKEN` is unset, shown as a setup card) or the configured shape below; an upstream/transport failure degrades to that area's error card.

- **Resource usage** (usage-observability) → `{ configured: true, generated_at, day, kv: { limits, totals, namespaces: [{ namespace_id, read, write, delete, list, resolved }], history: { window_days, days: [{ day, namespaces: [{ namespace_id, read, write, delete, list, resolved }] }] } }, ai: { neurons_limit, neurons_used, by_model: [{ model, neurons }], history: { window_days, days: [{ day, neurons }] } } }` — the current UTC day's account-wide KV operations + Workers AI neurons against the daily free-tier limits, read from the Cloudflare GraphQL Analytics API. `kv.limits`/`kv.totals` are `{ read, write, delete, list }`. `resolved` is `{ label, color, unlabeled }` — the namespace id's display identity. The **label** resolves from the `KV_NAMESPACE_LABELS` env var (`id:BINDING,...`, env.ts) — a **deploy-time** artifact `scripts/merge-wrangler-config.mjs` derives from the operator's own merged `kv_namespaces` array, never a runtime Cloudflare API call — falling back to the raw id (`unlabeled: true`) if unset/unmatched. The **color** is assigned independently of label resolution: every namespace id observed in the current payload gets a distinct, stable color by its position in the sorted list of ids present in that payload (a small fixed categorical palette, cycled) — an unresolved-label namespace still gets a real, distinct color, never a shared grey fallback. `kv.history` is a per-namespace, per-day series over the trailing `window_days` (30, the same window `usage-trends`/`tool-usage-trends` use), ascending oldest→newest, sourced from the SAME `kvOperationsAdaptiveGroups` GraphQL query widened to a date range (not a second query or a new dataset) — every namespace observed anywhere in the window is zero-filled into every day's entry, so a quiet day reports `0`, never an absent entry. `ai.history` is a per-day neuron-consumption series over the same `window_days`, ascending oldest→newest, summed across models, sourced from the SAME `aiInferenceAdaptiveGroups` GraphQL query widened to a date range — zero-filled the same way (a quiet day reports `0`, never an absent entry). Performs **no KV** (observing the budget must not consume it — the snapshot AND both histories); tenant-clean (account/namespace aggregates only); KV rows keyed by namespace **id**.
- **Usage trends** (usage-trends) → `{ configured: true, generated_at, window_days, jobs: [{ job, days: [{ day, runs, avg_ms, total_ms }] }] }` — each background job's per-day run count and mean/total run duration over the last `window_days` (30), read from the **Analytics Engine SQL API** (`POST /accounts/<id>/analytics_engine/sql`) over the `yamp_usage` dataset. A *different* surface from the resource view's GraphQL (custom AE datasets are SQL; built-in datasets are GraphQL), reusing the same account id + token. `day` is `YYYY-MM-DD` (UTC); `runs` is an integer, `avg_ms`/`total_ms` are numbers; jobs are ordered by name, days ascending. Performs **no KV or D1**; tenant-clean (per-job/per-day aggregates only).
- **Tool usage trends** (tool-usage-trends) → `{ configured: true, generated_at, window_days, tools: [{ tool, calls, errors, p50_ms, p95_ms }] }` — each MCP tool's call count, error count, and p50/p95 call duration over the last `window_days` (30), read from the **Analytics Engine SQL API** over the `yamp_tool` dataset. Reuses the same account id + token. `calls`/`errors` are integers (the error **rate** is derived in the panel from `errors`/`calls`, never stored); `p50_ms`/`p95_ms` are numbers; tools are ordered by call count descending (ties by name). Performs **no KV or D1**; tenant-clean (per-tool aggregates only, never per-tenant or per-call rows).
- **AI usage attribution** (ai-usage-attribution) → the `/admin/api/usage` payload's `aiUsage` key (alongside `usage`/`trends`/`tools`): `{ configured: false }` (when `CF_ACCOUNT_ID`/`CF_ANALYTICS_TOKEN` is unset) or `{ configured: true, generated_at, window_days, activities: [{ activity, model, trigger, calls, input_tokens, output_tokens, est_neurons }] }` — each AI activity's per-`(model, trigger)` call count, tokens, and estimated neurons over the last `window_days` (30), read from the **Analytics Engine SQL API** (`fetchAiUsage`, `src/usage.ts`) over the `yamp_ai` dataset (reusing the same account id + token). `activities` are ordered by `est_neurons` descending (ties by activity name); `calls`/`input_tokens`/`output_tokens`/`est_neurons` are numbers. `est_neurons` is the **derived** attribution estimate (tokens × the per-model rate table in `src/ai.ts`), rendered against the account-level by-model actual (the resource view's `ai.by_model`), never billing truth. Paired with the `aiBacklog` key — `{ classify, describe, embed }`, the AI-job backlog depths (recipes awaiting facet classification / description generation / embedding) composed from the `recipe-classify`/`recipe-embed` `job_health` summaries (`readAiBacklog`, `src/health.ts`; degrades to zeros when D1 is flaky) — so a bounded, falling backlog reads as "draining, will finish" rather than steady churn. The AE read performs **no KV or D1** (`aiBacklog` is a bounded D1 health read); tenant-clean (per-activity aggregates + job counts only).

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

**Shared** (D1 shared corpus). Agent-writable side-effect data (NOT user-curated). Written by the Worker's inbound-email handler (`email()`), which receives newsletters forwarded to `yamp@<domain>`, and **drained by the background discovery sweep** (`src/discovery-sweep.ts`), which extracts recipe links from each row's full plain-text `body`, then classifies/taste-matches/imports them like any feed candidate. Each row is one received message with its full plain-text body — the Worker captures the email faithfully; the sweep does the link extraction (no pre-extraction at write). This is the *push* complement to the RSS feeds — it reaches bot-walled/paywalled sources (Serious Eats, NYT) the Worker can't fetch.

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

## ingest_keys (D1 table, shared) — satellite keys

The **ingest-key roster** (recipe-ingestion). One row per **satellite machine**; a key authenticates `POST /admin/api/ingest` as a bearer credential — a deliberate, key-authed carve-out from the Cloudflare Access gate (a headless home satellite has no Access JWT). The plaintext secret is shown **once** at mint and never stored: only a SHA-256 hash (the lookup key) + a short display prefix are persisted. `last_used_at` and the last-reported satellite/contract versions drive the admin liveness + contract-skew views. The table, its columns, and the migration keep their `ingest_*` / `last_scraper_version` names (renaming a deployed DB object is out of bounds); the v2 wire field `satellite_version` maps onto the retained `last_scraper_version` column. Schema: `migrations/d1/0029_ingest_keys.sql`.

```sql
-- D1 ingest_keys table. PRIMARY KEY (id); UNIQUE (key_hash), indexed for the auth lookup.
id                    TEXT     -- "ik_<hex>" (PK)
label                 TEXT     -- satellite machine label (e.g. home-nas-satellite)  NOT NULL
key_hash              TEXT     -- SHA-256 hex of the secret (the credential + lookup key)  NOT NULL UNIQUE
key_prefix            TEXT     -- display-only prefix, e.g. "ing_live_9f2a"  NOT NULL
created_at            INTEGER  -- epoch ms  NOT NULL
last_used_at          INTEGER  -- epoch ms of the last accepted push; NULL = never
status                TEXT     -- active | revoked  NOT NULL DEFAULT 'active'
last_scraper_version  TEXT     -- last reported satellite build (column name retained; carries satellite_version)
last_contract_version TEXT     -- last reported targeted contract version (skew source; current = "v2")
tenant                TEXT     -- OPTIONAL tenant BINDING (satellite-pull-channel); NULL = operator-global
```

Auth is SHA-256 hash equality (`WHERE key_hash = ? AND status = 'active'`) — an indexed DB lookup; the hash **is** the credential, so there is no per-row secret compare. Revoke sets `status = 'revoked'` (the next push or pull-channel request with it is rejected `401`).

The additive, nullable **`tenant`** column (migration `0037`) is the key's optional **tenant binding**, governing the pull channel's claim scope (`satellite-pull-channel`, below): **NULL** = **operator-global** (every already-minted recipe-scrape key reads this way — the default is unaffected) and claims **operator-scope** work only; a **bound** key (`tenant = <id>`) additionally claims its own tenant's **tenant-scope** work, never another tenant's. The binding is set at mint (resolved against the operator allowlist; a non-allowlisted target mints nothing), **immutable** for the key's life (re-mint to rebind), and does **not** change the recipe-scrape push path, which stays operator-global regardless.

## ingest_candidates (D1 table, shared) — the pushed-content inbox

The satellite push inbox (recipe-ingestion). `POST /admin/api/ingest` persists each accepted, non-duplicate recipe observation here with its **pre-parsed content**; the discovery sweep drains it as a **third intake source** (beside feeds + the email inbox), classifying/matching/importing **without a fetch** (`acquire` returns the attached content). A row lives until the candidate reaches a **terminal** outcome (imported / rejected / contract-park), then it is deleted; a **transient** infrastructure failure KEEPS the row so the next tick retries from the stored content (no re-fetch, no `discovery_log` spam). Deduped by canonical `url`. Schema: `migrations/d1/0030_ingest_candidates.sql`.

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

**Arrival dedup** (at the endpoint) checks the canonical url against the corpus `source_url`s, `discovery_rejections`, the **settled** `discovery_log` set (outcomes other than `error`/`failed`), and the in-flight inbox — but **not** walled/transient parks, so a push **supersedes** a prior `unreachable`/`no_jsonld` park (the satellite now supplies content the Worker's own fetch could not reach). Walled sources are therefore satellite-owned and SHOULD NOT also be registered as Worker-polled `feeds`.

The v2 wire envelope the endpoint accepts is `{ capability, source, satellite_version, contract_version, observations: [...] }`, where `observations[]` is a **discriminated union keyed by `kind`** (`{ kind: "recipe", title, ingredients[], instructions[], source, summary?, servings?, time_total?, time_active? }` — the only kind today). The endpoint also accepts the legacy v1 recipe batch (`{ source, scraper_version, contract_version, recipes[] }`), normalizing it inward to the recipe-scrape capability; a batch declaring an unimplemented `capability` is rejected `bad_payload`. The wire contract is defined once in `@yamp/contract` and imported by both the Worker and the satellite.

## satellite_tasks (D1 table, shared) — the pull-channel queue

The **outbound-only pull channel's** work queue (satellite-pull-channel). The satellite is strictly outbound-only, so the Worker cannot push Worker-decided work at it; instead the satellite **claims** work over `POST /satellite/tasks/claim` and reports outcomes over `POST /satellite/results` — sibling `/satellite/*` routes to the retained `POST /admin/api/ingest` push, authenticated by the **same** ingest-key bearer + rate limit, outside `/admin*` so the Access gate never applies. Rows move through a **claim/lease lifecycle**: `pending → claimed → done` (success) or `→ failed` (terminal at the attempt cap). The first concrete task `kind` is **`sale-scan`** (satellite-sale-scan) — operator-scope, enqueued by the sale-scan producer (`src/sale-scan-plan.ts`); `order-fill` extends the `kind` set later. The channel treats `payload` as opaque JSON; only the owning capability interprets it. All access goes through `src/satellite-tasks-db.ts` → `src/db.ts`. Schema: `migrations/d1/0037_satellite_pull_channel.sql` (sale-scan adds **no** migration — it rides this table + KV). The producer prunes terminal `sale-scan` rows past a small age each cycle (`pruneTerminalTasks`) so the recurring queue stays bounded.

```sql
-- D1 satellite_tasks table. PRIMARY KEY (id).
id                TEXT     -- "st_<hex>" opaque task id (the results correlation key)  (PK)
kind              TEXT     -- 'sale-scan' (first concrete kind; order-fill later)  NOT NULL
scope             TEXT     -- 'operator' (cross-tenant, public-derived) | 'tenant'  NOT NULL
tenant            TEXT     -- NULL for operator-scope; the owning tenant id for tenant-scope
dedup_key         TEXT     -- logical task identity for idempotent enqueue  NOT NULL
payload           TEXT     -- JSON task body, opaque to the channel  NOT NULL
status            TEXT     -- 'pending' | 'claimed' | 'done' | 'failed'  NOT NULL DEFAULT 'pending'
claimed_by        TEXT     -- ingest key id holding the lease
claimed_at        INTEGER  -- epoch ms of the claim
lease_expires_at  INTEGER  -- epoch ms; a 'claimed' row past this is re-claimable
attempts          INTEGER  -- claims counted (each claim bumps it)  NOT NULL DEFAULT 0
max_attempts      INTEGER  -- attempt cap; at/above it a failed task is parked terminal  NOT NULL DEFAULT 3
last_error        TEXT     -- last reported failure reason (surfaced to the operator)
created_at        INTEGER  -- epoch ms  NOT NULL
updated_at        INTEGER  -- epoch ms of the last lifecycle write  NOT NULL
-- INDEX satellite_tasks_claimable (status, scope, tenant, kind, created_at) — the claim scan.
-- UNIQUE INDEX satellite_tasks_dedup (dedup_key) WHERE status IN ('pending','claimed') — idempotent enqueue.
```

**Claim (atomic).** One conditional `UPDATE … RETURNING` (D1 is SQLite — single-writer, statements serialized) selects claimable rows — `pending`, OR `claimed` with an **expired** `lease_expires_at` — filtered by the key's scope (operator-global → `scope='operator'`; tenant-bound → `scope='operator' OR (scope='tenant' AND tenant=<key tenant>)`) **and** the claim's declared `capabilities` (`kind IN (…)`), oldest first, `LIMIT max`, stamping owner + lease + `attempts+1`. Two concurrent claims cannot both acquire a row (the loser sees it already `claimed`). **Enqueue is idempotent per `dedup_key`**: the partial-unique index admits at most one non-terminal row per logical key (`INSERT OR IGNORE` no-ops while in flight); once terminal, the key is enqueuable afresh. **Correctness rests on result-side dedup, not the lease** — a lease can expire mid-work, so a task may run more than once; the results are **observations** that dedup on arrival (see below), so a double-run is safe and the lease is a pure optimization.

The **claim/result wire shapes** (defined once in `@yamp/contract`, `satellite-pull.ts`):

```
POST /satellite/tasks/claim   { capabilities: string[], max?: number }
   → { tasks: TaskEnvelope[] }          TaskEnvelope = { id, kind, scope: "operator"|"tenant", payload }  (payload opaque)
POST /satellite/results       { task_id, status: "done"|"failed", reason?, observations?: ObservationItem[] }
   → { task: { id, status }, results?, notice? }  results = per-observation { disposition: "accepted"|"deduped"|"rejected", … };
                                                   notice = operator-visible marker set when a sale-scan `done` reported
                                                            items but ZERO survived validation (the rollup converged empty)
```

A results report is correlated by `task_id`; an unknown (or out-of-the-key's-scope, masked to avoid leaking existence) `task_id` yields a structured `not_found`. On `status: "done"` the `observations[]` (the change-1 discriminated union — `recipe` and `sale`) enter the **same raw-observation intake** as `/admin/api/ingest` (shared `intakeObservations`, dispatched by observation `kind` — same validation + arrival dedup per arm), then the task transitions terminal (idempotent — a late/repeat report is a safe no-op). For a `sale-scan` task the results handler threads the **claimed task's** `(store, locationId)` into the sale arm as the authoritative rollup key (a `sale` is pull-channel-only — the push path lands only `recipe`), and a `done` converges that store's rollup even when empty/all-rejected. On `status: "failed"` the Worker counts the attempt and returns the task to claimable, or parks it terminal `failed` at the cap. `TaskEnvelope`'s `kind` is a **closed, extensible** set, so a consumer of the current set keeps validating claim batches unchanged when a later capability adds a kind.

The **`sale-scan` task payload** (`@yamp/contract`, `satellite-pull.ts`) and the **`sale` observation** (`ingest.ts`) — the concrete shapes riding the opaque `payload` / the observation union for satellite-sale-scan:

```
sale-scan task payload   { store, locationId, terms: string[] }
   -- the producer enqueues one operator-scope task per (store, locationId), dedup_key "sale-scan:{store}:{locationId}",
   -- carrying the shared flyer_terms. It instructs WHAT to observe (sensor-not-judge) — no derived conclusion.

sale observation         { kind: "sale", store, locationId, productId, description, size?, regular, promo, brand?, categories?, url? }
   -- RAW price facts only. NO savings/savings_pct/on-sale field: the Worker re-derives "on sale" (isOnSale:
   -- promo>0 && promo<regular), savings (regular-promo), and the min_savings_pct deal floor (at READ, never stored),
   -- so a `sale` and a first-party Kroger scan of the same product derive an IDENTICAL FlyerItem. productId → FlyerItem.sku
   -- (the merge/dedup identity within a store); url is retained on the item for spot-checkability.
   -- store/locationId are PROVENANCE ONLY: the rollup WRITE key `flyer:{store}:{locationId}` is authoritative
   -- from the CLAIMED sale-scan task's payload, never the observation. Sale intake is pull-channel-only (a `sale`
   -- pushed to /admin/api/ingest is rejected), an observation disagreeing with its task's store is rejected, and
   -- the arm never writes the Worker-owned `kroger` namespace (guarded after lowercasing). A `done` converges the
   -- task's store even when empty/all-rejected (clears stale sales); a `failed` does not.
```

## order_lists (D1 table, shared) — the satellite cart-fill issued set

The issued to-buy set for a **satellite cart-fill** (satellite-order-cart-fill). Order-fill is a **direct request/response**, not a pull-channel task: a satellite-fulfilled tenant's local helper calls two `/satellite/*` endpoints — a **pull-list** (`POST /satellite/order/list`) and a **receipt** (`POST /satellite/order/receipt`) — added alongside the claim/results routes, outside `/admin*` so the Access gate never applies, authenticated by the **same** ingest-key bearer + rate limit. Both endpoints require a **tenant-bound** key (an operator-global key is rejected `403` — there is no operator-scope order-fill). The pull-list **mints one row here per Refresh**, recording the exact canonical ingredient ids the Worker handed that tenant; the receipt references the row by id. The **`item_ids` column is the AUTHORITATIVE issued set** the receipt is validated against — a receipt can only advance ids the Worker issued (it cannot invent an item, graft in another list's id, or redirect another tenant's list), the order-fill analog of the sale intake's task-scoped-authoritative rule. All access goes through `src/order-lists-db.ts` → `src/db.ts`. Schema: `migrations/d1/0038_satellite_order_lists.sql`.

```sql
-- D1 order_lists table. PRIMARY KEY (id).
id           TEXT     -- "ol_<hex>" opaque order-list id (the receipt correlation key)  (PK)
tenant       TEXT     -- the issuing tenant (from the ingest key's binding)  NOT NULL
store        TEXT     -- primary store slug at issue time  NOT NULL
location_id  TEXT     -- store location id (may be NULL — the operator's preferred_location label)
item_ids     TEXT     -- JSON array of canonical ingredient ids issued (AUTHORITATIVE)  NOT NULL
status       TEXT     -- 'issued' | 'received'  NOT NULL DEFAULT 'issued'
created_at   INTEGER  -- epoch ms  NOT NULL
received_at  INTEGER  -- epoch ms a receipt was applied; NULL until then
-- INDEX order_lists_tenant (tenant, created_at) — per-tenant recency scan (audit / prune ordering).
```

The **pull-list** is served **only** when the tenant's primary store is satellite-fulfilled (`preferences.stores.fulfillment === "satellite"`); a Kroger/Worker-native primary gets a structured `409` directing to `place_order`, and a non-Kroger primary **without** the marker (a plain walk store) gets a `409` directing to the in-store walk (so a walk-only tenant can't mint an order-list by accident). The list is `computeToBuy` over the current `active` grocery list **∪ the meal plan's server-derived ingredient needs** (`deriveMenuNeeds` — the same derivation `read_to_buy` and `place_order` use, so every flush surface sees the same set; in-flight rows suppress their derived need) minus pantry on-hand, each line keyed to its canonical id, with the not-yet-derived planned recipes reported alongside as `underived` — it is **not** resolved against store product availability (product matching is the satellite's browser job). A cron step reaps orphaned **`issued`** rows past a ~7-day retention (`pruneStaleOrderLists`, wired into `scheduled()` beside the sale-scan prune); **`received`** rows are retained as the audit trail. (`order_lists.status`'s `issued | received` is unrelated to the `grocery_list` lifecycle's own states, below.)

The **`order` observation** (`ingest.ts`, the third member of the shared observation union — `recipe | sale | order`) and the two **endpoint shapes** (`@yamp/contract`, `satellite-order.ts`):

```
POST /satellite/order/list      {}
   → { order_list_id, store, location_id, items: [{ item_id, name, quantity, for_recipes, assumed_quantity }], partials: [{ name, for_recipes }] }
      -- item_id is the canonical ingredient id (=== grocery_list.normalized_name); store/location_id are the tenant's primary.

POST /satellite/order/receipt   { order_list_id, observations: OrderObservation[], mark_placed? }
   → { order_list: { id, status }, results: ItemResult[] }

order observation   { kind: "order", item_id, disposition: "carted"|"substituted"|"unavailable", product?: { productId, description, size?, price?, url? }, note? }
   -- RAW per-item cart-fill outcome only (sensor-not-judge): NO derived grocery-list state. The Worker re-derives the
   -- in_cart transition itself (it never trusts a state from the wire), the way it re-derives on-sale/savings from a `sale`.
   -- item_id is the AUTHORITATIVE key — one NOT in the referenced order-list's item_ids is rejected per-item. An `order`
   -- observation is valid ONLY on the receipt endpoint against an issued order-list; on the push path (/admin/api/ingest)
   -- or the pull-results path it is rejected (as `sale` is pull-channel-only). Delivered over the order-receipt endpoint,
   -- NOT the capability-tagged push batch, so the CAPABILITIES enum is unchanged by it.
```

**Receipt reconciliation** (`grocery_list` reused unchanged — no schema change): `carted` and `substituted` lines advance to **`in_cart`** via the **same** `advanceInCartRows` `place_order` uses (keyed by canonical id — a substitute still satisfies the canonical ingredient), but ONLY for ids still on the list as `active` — plus, for an issued id with **no stored row**, ids the meal plan **still derives** (a carted plan-derived line lands through the insert-on-missing branch as an `in_cart` `source: "menu"` row) — so a stale pull-list cannot resurrect a removed line or regress an `ordered` one; an `unavailable` line stays `active` to retry on the next order. No line advances past `in_cart` automatically (the satellite stops at the store's review page and never checks out — see `docs/ARCHITECTURE.md`). The optional **mark-placed** re-post (`mark_placed: true`, no new observations) advances the issued `in_cart` lines to **`ordered`** (`advanceOrderedRows`); unused, a line stays `in_cart`, identical to an unconfirmed Kroger cart. Application is **idempotent** — a re-posted receipt converges rather than double-advancing.

## satellite_rejections / satellite_source_stats / satellite_quarantine (D1 tables, shared) — the source-audit

The **sensor-health audit** substrate (satellite-source-audit): a rejection **ledger**, a per-source **accept-tally** (the reliability rate denominator), and a per-source **quarantine flag** (a reversible operator-confirmed Worker-side reject). All three are accessed only through `src/satellite-audit-db.ts` → `src/db.ts` (throw-free → structured `storage_error`). Schema: `migrations/d1/0039_satellite_rejections.sql`. The whole spine starts **empty** and populates from an operator's first reject after deploy (no backfill). The `tenant` column on all three follows the **carrying ingest key's binding** (NULL = operator-global, else the bound tenant) — keyed off the **key**, not the kind (sale is operator-global, order tenant-bound, recipe MAY be either).

**`satellite_rejections`** — an **append-with-rolling-prune LOG** (NOT the DELETE + re-insert idiom of `reconcile_errors`): each rejected observation is a point-in-time event, appended and pruned by **age** (`pruneSatelliteRejections`, wired into `scheduled()`'s phase-1 reap beside `pruneStaleOrderLists`, retention = the operator's `logRetentionDays` — the same knob that prunes `ingest_pushes`). Fed by every Worker-side reject across the three `intakeObservations` arms (`origin: worker`, one row, `count = 1`) — including a quarantined source's dropped observations (`reason: "quarantined"`) — **and** by satellite-reported local rejects (`origin: local`, `count = N`, `reason` = the category, `provenance` = the redacted sample; see the wire field below). Surfaced by the agent-readable `read_satellite_rejections` tool and the admin Satellites page.

```sql
-- D1 satellite_rejections table. PRIMARY KEY (id). An append-with-rolling-prune LOG.
id           TEXT     -- uuid  (PK)
tenant       TEXT     -- the carrying key's tenant binding: NULL = operator-global, else the bound tenant
key_id       TEXT     -- the ingest key that carried it (NULL for a synthesized origin)
kind         TEXT     -- 'recipe' | 'sale' | 'order'  NOT NULL
source       TEXT     -- recipe: the batch/feed source; sale/order: the store slug  NOT NULL
origin       TEXT     -- 'worker' (rejected at intake) | 'local' (a satellite-reported, pre-aggregated summary)  NOT NULL
reason       TEXT     -- the reject reason (worker) or the reason-category (local)  NOT NULL
provenance   TEXT     -- nullable: the offending url / productId / item_id / a redacted local sample
count        INTEGER  -- 1 for a worker reject; N for a pre-aggregated local-summary entry  NOT NULL DEFAULT 1
rejected_at  INTEGER  -- epoch ms  NOT NULL
-- INDEX satellite_rejections_source (kind, source, rejected_at) — per-source most-recent-first reads.
-- INDEX satellite_rejections_age (rejected_at) — the rolling-prune scan.
```

**The `local_rejects` wire field (the local-reject reporting path)** — the loudest breakage never reaches a Worker-side-only ledger: the satellite's own validators (`validateSaleEmit`/`validateOrderEmit`/the recipe adapter's contract check) drop a malformed or judgment-smuggling item **before the wire**. So the satellite attaches a compact, **pre-aggregated** local-reject summary to each of its three delivery envelopes — the push batch (`SatelliteBatchSchema` / `POST /admin/api/ingest`), the pull-channel results (`POST /satellite/results`), and the order-receipt (`POST /satellite/order/receipt`) — and the Worker records each entry as one `origin: local` ledger row. The field is defined **once** in `@yamp/contract` and is **additive + OPTIONAL** on all three envelopes, so it keeps `CONTRACT_VERSION: "v2"` (a satellite that omits it is unaffected; an older Worker ignores an unknown field):

```jsonc
// local_rejects?: LocalReject[]  — set only when non-empty (a clean delivery omits it)
{ "category": "contract_invalid" | "judgment_smuggled",
  "count": 12,                    // positive int — items dropped under this category in THIS delivery
  "sample": "…redacted reason…" } // optional: ONE truncated example reason, never a raw body (leak risk)
```

The two categories map 1:1 to the satellite's local validators: **`contract_invalid`** = the emit failed the shared-contract parse (`parseSaleObservation`/`parseOrderObservation`/`parseRecipeItem` — the "DOM changed / adapter rotted" signal); **`judgment_smuggled`** = the emit carried a derived JUDGMENT field a sensor must never report (`JUDGMENT_KEYS` — the sensor-not-judge violation). The Worker sets `kind`/`source` from the envelope's implied context (the push `source`; the claimed sale-scan task's store; the order-list's store) and `tenant` from the carrying key's binding. Local rejects do **not** bump the accept-tally (they were never accepted); they raise the source's fail-rate exactly as a Worker-side reject does — a locally-dropped flood becomes visible. A whole-task failure (session expired / source unreachable) is **not** a local-item reject and rides the existing `failed`/`reason` path, out of this summary.

**`satellite_source_stats`** — the per-`{tenant, kind, source, day}` **accept-tally**, the uniform denominator the reliability rollup needs across all three arms (`ingest_pushes` is left untouched — Decision B: zero blast radius on the shipped recency view). **DAY-BUCKETED**: `day` is an epoch-day (`floor(bump_ms / 86_400_000)`), so the rollup can sum accepts over a RECENT window comparably to how it counts rejects over that window — a huge STALE accept history must not dilute the windowed fail-rate below the quarantine threshold. Bumped once per batch per source into today's bucket from the single `intakeObservations` choke point; `last_accepted_at` advances only on a real accept (a dedup bumps `deduped` without touching recency). The unique key is `COALESCE(tenant,'')` + kind + source + **day** so an operator-global (NULL-tenant) source keeps **one** row per day (a plain UNIQUE would treat NULLs as distinct); the upsert targets that index with `ON CONFLICT`. Buckets age out on the SAME rolling prune as the ledger (`pruneSourceStats`, retention = `logRetentionDays`), wired into `scheduled()`'s phase-1 reap beside `pruneSatelliteRejections`.

```sql
-- D1 satellite_source_stats table — the accept-tally. UNIQUE (COALESCE(tenant,''), kind, source, day).
tenant           TEXT     -- the key's tenant binding (NULL = operator-global)
kind             TEXT     -- 'recipe' | 'sale' | 'order'  NOT NULL
source           TEXT     -- as satellite_rejections.source  NOT NULL
day              INTEGER  -- epoch-day bucket = floor(bump_ms / 86_400_000); the windowing/prune key  NOT NULL
accepted         INTEGER  -- accepted observations for this source in this bucket  NOT NULL DEFAULT 0
deduped          INTEGER  -- deduped (benign re-report; excluded from the rate denominators)  NOT NULL DEFAULT 0
last_accepted_at INTEGER  -- epoch ms of the most recent accept in this bucket (NULL until first); staleness = now − max over buckets
-- INDEX satellite_source_stats_day (day) — the rolling-prune scan (pruneSourceStats).
```

The **reliability signal** is computed on read (`readSourceQuality`, volume is a household's satellites), **WINDOWED to a recent span W** (defaults to `logRetentionDays`, the same knob the prunes use): per `{tenant, kind, source}`, acceptance rate = `accepted / (accepted + rejected)` and fail rate = `rejected / (accepted + rejected)` where accepts are summed over the **day buckets within W** and rejects are the ledger's per-source reject `count`s with **`rejected_at ≥ now − W`** — so both sides of the rate are windowed and comparable (windowed-rejects / all-time-accepts was biased DOWN, and the recommendation never fired when a long-healthy source finally broke). Dedups are excluded from both denominators; `reason: "quarantined"` rows are excluded from the numerator (a block, not a validation failure); staleness = `now − last_accepted_at` (max over in-window buckets). A source over a **fixed** fail-rate threshold (0.3) with a minimum sample (20) is marked `recommendQuarantine` — a pure numeric rule, **no model**; it never auto-quarantines.

**`satellite_quarantine`** — the per-source **quarantine flag**: a `{tenant, kind, source}` marked here has its future observations **rejected at intake** before acceptance (`origin: worker, reason: "quarantined"`), persisting nothing downstream (no corpus candidate, no flyer-rollup REPLACE, no grocery-list advance / receipt mark). Reversible — clearing the row lets the next observation flow again. **Never auto-applied**: the Satellites page surfaces a recommendation when a source crosses the threshold and the operator toggles it (the standing "quarantinable through the pipeline" SHALL as a per-source lever, complementing whole-machine `revokeIngestKey`). Same `COALESCE(tenant,'')` unique key as the accept-tally.

```sql
-- D1 satellite_quarantine table — the reversible per-source Worker-side reject flag.
tenant         TEXT     -- the key's tenant binding (NULL = operator-global)
kind           TEXT     -- 'recipe' | 'sale' | 'order'  NOT NULL
source         TEXT     -- as satellite_rejections.source  NOT NULL
quarantined_at INTEGER  -- epoch ms the operator toggled it on  NOT NULL
note           TEXT     -- nullable operator note
-- UNIQUE INDEX satellite_quarantine_key (COALESCE(tenant,''), kind, source) — one flag per source.
```

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

**Operator-scoped** — read at each MCP tool call (ranking, flyer, the deployment profile) and at cron start (flyer warm, the curated source). Written only via the admin Config panel. Follows the same sparse-override singleton pattern as `discovery_config`: only columns an operator has explicitly tuned are non-null; absent or null columns fall back to `DEFAULT_OPERATOR_CONFIG` compiled defaults. An empty or absent row runs with all defaults.

```sql
-- D1 operator_config table (migration 0019; deployment columns 0059). SINGLE ROW (id = 1, enforced by CHECK).
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
-- Deployment (0059)
deployment_profile  TEXT     -- CHECK IN ('self-hosted','saas'); NULL resolves to 'self-hosted'
                             --   (existing deployments need no write)
curated_source_url  TEXT     -- the curated tier's public feed: NULL → the compiled product
                             --   default (DEFAULT_CURATED_SOURCE_URL, src/operator-config.ts);
                             --   '' (empty string) → curated intake disabled; any other value →
                             --   an operator repoint. Consumed by the sweep under SaaS only.
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
- **`deployment_profile` is the D9 profile flag's one configuration channel**, read exclusively through `loadDeploymentProfile(env)` (`src/deployment.ts`) — every profile-conditioned path (the visibility lens, the trending guard, the curated sweep, whoami, the admin card) takes that accessor's value. It is deliberately NOT a wrangler var (the operator deploy merge drops code-repo `vars`, and a var would make the flip guards unenforceable). Written via `PUT /admin/api/deployment-config` (read via the sibling GET), with **flip guards** on the write path: self-hosted → SaaS requires an explicit `confirm` (implicit all-to-all edges disappear and the public `/cookbook` narrows to the curated tier); SaaS → self-hosted is **refused** with a structured `conflict` (the consent-inversion guard — `confirm` cannot override) while more than one household owns a non-empty non-curated cookbook (≥1 own `recipe_imports` row, curated tenant excluded).
- **`curated_source_url` is tri-state** (NULL = product default / `''` = disabled / value = repoint), resolved by `loadDeploymentConfig` (`src/operator-config.ts`); the same admin card writes it. The curated feed joins the sweep's ordinary per-tick feed rotation and volume-governance bounds, so curated intake can never starve member feeds.

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

## store_notes (attributed shared D1 `store_notes` table)

A member's attributed notes on one store retain immutable/addressable `created_at` and gain nullable `updated_at`; effective recency is `COALESCE(updated_at, created_at)`. New notes initialize both, and an edit advances only `updated_at`. The aisle-map read returns a winner per normalized aisle by recency/note-id, the caller's complete contribution, a strong ETag over visible participating notes, and `unknown | stale | mapped` (stale is strictly older than 180 days). Conditional whole-document saves create/update/remove/collapse only the caller's layout rows; every other author and all location/stock/general rows survive.

```sql
-- D1 store_notes table — one row per note, across all tenants
id          TEXT PRIMARY KEY   -- generated stable key
store       TEXT               -- store slug
author      TEXT               -- writing member id (set by the Worker)
body        TEXT               -- required; rows with no body are dropped on read
tags        TEXT               -- JSON array, e.g. ["layout", "location"]; default []
private     INTEGER            -- 1 = owner-only; default 0
created_at  TEXT               -- ISO timestamp (required; addressable key for edit/delete)
updated_at  TEXT               -- nullable ISO recency; edits advance it, legacy rows fall back to created_at
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

Machine-maintained SKU cache in the **shared corpus** (`sku_cache` table) — a mapping resolved by any member warms it for everyone. `place_order` compares/upserts it only after the Kroger cart write succeeds; preview, search, and a failed cart never teach. Each entry is **tagged with the `location_id`** it was resolved at. Keys converge to the canonical ingredient id on the cron: the `sku-cache-rekey` reconcile resolves every `ingredient` key through the current alias/representative chain each tick and re-keys rows whose resolution differs — on a (canonical, location) collision the row with the newer `last_used` wins whole. Keys that resolve to nothing (non-food or never-captured terms) stay as-is; the re-key has no capture side effect.

```sql
-- D1 sku_cache table (migrations/d1/0006_shared_corpus.sql + 0041_sku_cache_aisle.sql)
-- PRIMARY KEY (ingredient, location_id)

ingredient        TEXT  -- normalized ingredient name (e.g. "olive oil")
location_id       TEXT  -- Kroger locationId this was resolved at
sku               TEXT  -- resolved Kroger SKU
brand             TEXT  -- brand name of the resolved product
size              TEXT  -- size/weight string of the resolved product (e.g. "16.9 fl oz")
last_used         TEXT  -- ISO date of last use (informational; used for cache pruning)
aisle_number      TEXT  -- captured aisle number at this location (e.g. "11"); NULL until captured
aisle_description TEXT  -- captured aisle/section description (e.g. "Meat & Seafood")
aisle_side        TEXT  -- aisle side marker when Kroger reports one (e.g. "L")
aisle_captured_at TEXT  -- ISO date the aisle placement was last captured; NULL = never
```

**Aisle placement columns** carry the resolved product's Kroger `aisleLocation` at this row's `location_id`, written by `place_order`'s SKU-cache commit: the commit covers **every** resolved line (cache hits included — their revalidation carries fresh placement) and skips a row only when its learned fields (SKU, brand, size — and the aisle too, when the fresh mapping actually carries one) are identical, so placements refresh organically with each order. **Keep-on-null:** a revalidation whose response omits `aisleLocation` never clears a captured placement — it either matches on SKU/brand/size and is skipped, or a genuine SKU/brand/size change carries the stored row's placement forward instead of writing NULL; only a present fresh placement ever overwrites a stored one. They start NULL (no backfill) and converge order-by-order; `read_to_buy`'s `enrich` enrichment and the grocery page's aisle grouping read them at the caller's location (with the untagged-`''` legacy fallback).

Example rows:

| ingredient     | location_id | sku            | brand               | size        | last_used  |
|----------------|-------------|----------------|---------------------|-------------|------------|
| olive oil      | 01400376    | 0001111046025  | Simple Truth Organic| 16.9 fl oz  | 2025-05-15 |
| chicken thighs | 01400943    | 0001111091234  | Kroger              | 1.5 lb pack | 2025-05-14 |

**This is a speed cache, not the source of truth for dispositions.** It stores *resolved SKUs* to skip the expensive search/narrowing; the *disposition* (care / don't-care / ranked) lives in each member's `profile` row / `brand_prefs` rows. **Shared + location-tagged:** an entry tagged with the caller's own location is tried first, but every hit is revalidated against the caller's `preferred_location` for current price + curbside/delivery availability before use — a cross-location entry not carried at the caller's store falls through to a fresh search, so a shared cache can never serve an unavailable SKU. No TTL; `last_used` is informational (for pruning). "Don't care" commodities (an any-brand family with no tiers in `preferences.brands`) carry no pinned SKU here; they re-resolve to cheapest-acceptable each run. (An entry with no `location_id` is treated as same-location and still revalidated.)

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
