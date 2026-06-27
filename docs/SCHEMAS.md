---
update-when: a data file's schema or the validation rules change
---

# SCHEMAS.md — Data File Reference

Concrete schemas with example values for every data file in the repo. Keep this in sync with the actual files — when you add a field, update here first, then update the file. Validation runs in two places: `scripts/build-indexes.mjs` (the full validator, at data-repo build time) and a *structural subset* in the Worker's `src/validate.ts` (at write time). The build validates only what GitHub still owns — the shared corpus (recipes, stores, discovery files, aliases). The **D1-backed** per-tenant profile (preferences/taste/diet_principles/kitchen/staples/overlay/ready_to_eat/stockup), the **D1-backed** session state (the `pantry`/`meal_plan`/`grocery_list` tables), and the **D1-backed** `cooking_log` are validated **only by the Worker at write time** (`update_preferences`' merge-patch validation for preferences, `log_cooked` for the cooking log), never by the build.

## File placement: shared vs per-tenant (multi-tenant data model)

The data lives in **one private data repo** with two regions (see `ARCHITECTURE.md`). Every file below lives in exactly one:

- **Authored markdown (GitHub, data-repo root)** — the human-editable tier (Obsidian / native git apps): `recipes/*.md` (objective frontmatter + body) and the `guidance/**/*.md` umbrella (`guidance/ingredient_storage/` — curated put-away advice, read-only; `guidance/cooking_techniques/` — technique memories, also agent-writable via `save_guidance`). This is what remains in GitHub after the D1 migration.
- **Shared corpus (D1, `migrations/d1/0006_shared_corpus.sql`)** — objective, single-source, read by everyone: `aliases(variant, canonical)`, `sku_cache(ingredient, location_id, …)`, `flyer_terms(term)`, `stores(slug, name, domain, extra /*json*/)` (in-store-walk registry — identity columns `slug`/`name`/`domain` are top-level; optional identity fields `label`/`chain`/`address`/`location_id` are stored in the `extra` JSON column; layout lives in store notes), `feeds(url, …)` (RSS discovery feeds), `discovery_candidates(id, url UNIQUE, status, …)` (forwarded-newsletter inbox + group-wide rejection log; `status` values: `pending` | `rejected` — `pending` is the default for unprocessed candidates, `rejected` is set by `reject_discovery`), `discovery_senders`/`discovery_members` (inbound-email allowlist). Written + validated at the Worker write tools; read by query. The recipe index is the derived D1 `recipes` table — there is no `_indexes/recipes.json`.
- **Attributed records (D1 `recipe_notes` / `store_notes`)** — each member's attributed recipe/store notes, stored in D1 tables carrying `author` (the writing tenant, set by the Worker) + a `private` flag. Both tables use `id TEXT PRIMARY KEY` (a generated stable key); `recipe`/`slug` (the recipe or store slug), `author`, `body`, `tags`, `private`, and `created_at` are ordinary columns (not the primary key). `read_recipe_notes` returns own-private + group-shared in one query, joined with the overlay favorites.
- **Per-tenant D1 (the profile)** — each member's grocery **profile** lives in normalized D1 tables (`migrations/d1/0004_profile.sql`): a singleton `profile` row (the markdown fields `taste`/`diet_principles`, the preference scalars `default_cooking_nights`/`lunch_strategy`/`ready_to_eat_default_action`, the JSON columns `stores`/`dietary`/`rotation`/`custom`/`kitchen_notes`, and `freezer_capacity_estimate`), plus child tables `brand_prefs(tenant, term, ranks)`, `kitchen_equipment(tenant, slug)`, `staples(tenant, name, normalized_name, perishable)`, `overlay(tenant, recipe, favorite, reject)` (the two mutually-exclusive disposition marks; there is no `status` lifecycle or `rating` column), `ready_to_eat(tenant, slug, meal, name, favorite, reject, category, source, brand, notes)`, and `stockup(tenant, name, normalized_name, unit, typical_purchase, notes, baseline_price, buy_at_or_below)`. `idx_overlay_recipe` powers the cross-tenant group-favorites query. Reads assemble the agent-facing objects from these rows (`src/profile-db.ts`); writes mutate rows — no document format on the profile path.
- **Per-tenant D1 (session state)** — each member's working state lives in D1 row tables (`migrations/d1/0005_session_state.sql`): `pantry(tenant, name, normalized_name, quantity, category, prepared_from, added_at, last_verified_at, notes)`, `meal_plan(tenant, recipe, planned_for, sides /*json*/)`, `grocery_list(tenant, name, normalized_name, quantity, kind, domain, status, source, for_recipes /*json*/, note, added_at, ordered_at)` — keyed by normalized name (pantry/grocery) or recipe slug (meal plan), with `idx_grocery_status(tenant, status)` and `idx_pantry_category(tenant, category)` backing the read filters. Adds are row upserts (`INSERT … ON CONFLICT DO UPDATE`), removes/status changes are targeted row statements — no whole-array rewrite, strong read-after-write consistency. (The detailed item shapes are below.) The Worker read path has **no** GitHub/KV fallback — a miss returns empty/null.

**Three-category recipe model:** a recipe's *content* (objective frontmatter + body) is shared markdown in GitHub; its *overlay* (`favorite` + `reject`) is per-tenant in the D1 `overlay` table; its *notes* are per-tenant, attributed, append-mostly in the D1 `recipe_notes` table (`id TEXT PRIMARY KEY`, `recipe`, `author`, `body`, `tags`, `private`, `created_at`). `last_cooked` is **not stored** — it's derived per-tenant from the D1 `cooking_log` table (`MAX(date)` per recipe). Read tools merge shared content + the caller's overlay + cooking-log `last_cooked` at read time.

The shared corpus, profile, session state, cooking log, and attributed notes are all **D1 tables** (see the placement list above and `migrations/d1/*.sql`), not repo files. Per-artifact sections below document each artifact's current D1 column shape.

### preferences shape + merge-patch contract

`preferences` is reconstructed from the `profile` row + `brand_prefs` rows into a defined top-level surface plus an open `custom` bag:

```jsonc
{
  "default_cooking_nights": 3,                 // number
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
description: "A weeknight sheet-pan chicken, bright with lemon and garlic over crisp potatoes — easy, savory comfort for an unfussy dinner."  # AI-written brief summary; embed source + compact candidate row (meal-plan retrieval)
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
discovered_at: null             # ISO date; only set for RSS imports
discovery_source: null          # string; only set for RSS imports (e.g., "serious-eats")
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
- **Required-field contract (blunt-uniform).** Every **system-consumed** field — anything a deterministic consumer reads (`filterRecipes`, the semantic candidate row, the retrospective JOIN, the embedding, side retrieval, discovery dedup) — MUST be **present** on every recipe, in its explicit empty form where a value is genuinely empty. The contract is defined once in `src/recipe-contract.js` (`validateRecipeContract`), imported by both the Worker write-time validator (`src/validate.ts`) and the build (`scripts/build-indexes.mjs`), and is a **hard failure** at both gates — there is no warn-only "recommended" tier. The three shapes:
  - **Required, non-empty:** `title`, `description` (non-empty strings); `ingredients_key`, `course` (non-empty arrays).
  - **Required, value or explicit `null`:** `protein`, `cuisine` (vocab value or `null`), `time_total` (number or `null`), `source` (URL string or `null`).
  - **Required, may be `[]`:** `dietary`, `season`, `tags`, `pairs_with`, `perishable_ingredients`, `requires_equipment`.
  - **Conditional:** `side_search_terms` — present always; **non-empty** when `course` includes `main`, else `[]`.

  Fields outside this set are **free-form** and pass through into the `extra` projection unchecked (e.g. `meal_preppable`, `veg_forward`, `difficulty`, `style`, `servings`, `time_active`, `discovered_at`, `discovery_source`). Promoting a free-form field to a queryable/consumed column means adding it to the contract in the same change. A compliant skeleton:

  ```yaml
  title: …
  description: …                 # non-empty
  ingredients_key: [ … ]         # non-empty
  course: [main]                 # non-empty
  protein: null                  # value or null
  cuisine: null                  # value or null
  time_total: null               # number or null
  source: null                   # URL or null
  dietary: []
  season: []
  tags: []
  pairs_with: []
  perishable_ingredients: []
  requires_equipment: []
  side_search_terms: []          # non-empty iff course includes main
  ```
- `favorite`, `reject`, and `last_cooked` are **per-tenant**, not shared content — `favorite`/`reject` live in each member's D1 `overlay` table; `last_cooked` is derived from the D1 `cooking_log` table. The shared D1 `recipes` table carries objective fields only. A shared recipe's frontmatter SHOULD NOT carry them; the build strips them. (The retired `status`/`rating` are likewise *tolerated and ignored*, not forbidden — a lingering value is stripped from the shared index, never validated; `create_recipe` stamps no `status`.) `update_recipe` is objective-only and rejects a `favorite`/`reject` edit toward `toggle_favorite` / `toggle_reject`, which write the caller's D1 overlay row.
- Disposition is **per-tenant and opt-out**: a recipe with no overlay row is **available** to that member by default. A member's feedback either favorites it (`toggle_favorite`) or hides it (`toggle_reject` → a hard gate that drops it from their `search_recipes` results) — the two are mutually exclusive, and one member's disposition never changes another's. There is no `active`/`draft` lifecycle and no per-member curated set.
- `pairs_with`: slugs of other recipes, **required (may be `[]`)**. A *plating* edge — recipes eaten together on one plate (a main's companion **corpus** sides). Each slug MUST resolve to a real recipe (a build hard-failure otherwise); corpus sides are themselves recipes, so they reuse the normal import/grocery-list pipeline. Objective **shared content** (carried in the D1 `recipes` table, written by `update_recipe`) — not a per-tenant overlay field. **Primarily authored by the `recipe-sides` flow** — the standalone "sides for X" flow records the edge when a corpus side is confirmed for a corpus main; the **meal-plan** flow only **backfills** it opportunistically, for a pairing it confirms while composing a menu (both filter side candidates with `course: side`). **Open-world sides** — trivial preparations with no recipe file — are not recorded here (no slug to remember) and ride on the main's meal-plan row instead (the D1 `meal_plan` table's `sides` JSON column).
- `course`: **required, non-empty** — an **open-vocabulary** classification of what kind of dish the recipe is — one or more of `main`, `side`, `dessert`, `breakfast` by convention, but **any** string is allowed (e.g. `sauce`, `baked_good`) with **no controlled set and no code change** to extend it (contrast `protein`/`cuisine`, which ARE controlled). Authored as a string or an array of strings; the build **normalizes** it to a lowercased, trimmed **array** (so `Main` → `["main"]`). A recipe that plates as more than one course carries multiple values (`course: [main, side]`). An absent or empty `course`, or a non-string/array value, is a build/Worker **hard failure**; the *values* are never checked against a set. Objective **shared content** carried in the D1 `recipes` table, classified at import by `create_recipe` (and editable via `update_recipe`); `search_recipes` filters it by **containment**. (`standalone` is **retired** — whether a main is an already-rounded plate is inferred by the agent at plan time, not persisted; a lingering `standalone` field is ignored, never validated or indexed.)
- `perishable_ingredients`: **required array (may be `[]`)** — a **normalized** list of the recipe's perishable ingredients, feeding the menu-gen waste callout (a partial-unit perishable that no other proposed recipe uses). **Derived at import, not hand-maintained:** the import/create flow classifies it alongside `protein`/`cuisine`. The classification test is *"would the leftover rot before I'd realistically use it?"* — not botany — so shelf-stable staples (olive oil, canned beans) are excluded and a small amount of a fast-spoiling item is included; fuzzy edges (eggs, potatoes) are fine since a wrong call only costs a dismissed nudge. Names use the **same normalization the pantry-verify matcher applies** (`normalizeIngredient`), applied at write time by `create_recipe`/`update_recipe`, so a perishable lines up across recipes for overlap detection. Present-but-not-a-string-array is a build hard-failure (like a non-boolean `standalone`). Objective **shared content** carried in the D1 `recipes` table — not a per-tenant overlay field, not curated config. Hand-edit only to correct a misclassification.
- `description`: **required, non-empty** — a **brief AI-written summary** of the dish (~1–2 sentences) in a consistent, craving-aligned register (identity, flavor/texture, when you'd want it) — **not** the scraped marketing copy. It is the single semantic-identity field that powers meal-plan retrieval: the source the recipe **embedding** is derived from, the compact per-candidate row loaded into context, the user-facing "why this dish," and the dedup signal. Authored frontmatter (human-editable in Obsidian); the embedding is the **derived** projection, reconciled Worker-side on the cron from whatever the description currently says (the sibling `recipe_embeddings` table; see ARCHITECTURE). Validated as a **required non-empty string** at build and Worker write time (a recipe can't be created without one). Objective **shared content**.
- `side_search_terms`: **required** — an array of AI-memoized phrases describing the *kind of side that complements this main* ("a crisp acidic green salad", "crusty bread for the sauce"), **non-empty when `course` includes `main`** and `[]` otherwise. Written at import; used as the **semantic side-retrieval query** so the complementarity judgment is captured once and the retrieval is plain similarity (the terms describe the side you want, not the main). Additive — does **not** replace curated `pairs_with` (the deterministic, slug-resolved pairing). Validated at build and Worker write time. Objective **shared content**.
- `protein` and `cuisine` are **controlled vocabularies** (coarse buckets — `fish` not `salmon`) so variety reasoning is reliable. Both are **required-present** (the contract above), carrying either an in-vocabulary value or the explicit literal `null`. A value **present** but outside its set is a hard failure **at both write time (the Worker, `src/validate.ts`) and build time (`scripts/build-indexes.mjs`)** — `create_recipe`/`update_recipe` reject an off-vocab value with `validation_failed` and make no commit, so it never reaches `main`. A dish with **no protein focus** — a side, a plain noodle/grain dish, a condiment — carries **`protein: null`** (present and explicit); the old `none`→absent normalization is **retired**, so an omitted field or a `none`/`""` value is now rejected, prompting `null`. The allowed sets are defined **once** in the shared `src/vocab.js`, imported by both validators so they cannot drift; extending a vocabulary is a deliberate edit there. Current cuisine set: `american, brazilian, cajun, caribbean, chinese, cuban, filipino, french, german, greek, indian, italian, japanese, korean, mediterranean, mexican, moroccan, peruvian, southwestern, spanish, thai, vietnamese`.
- `requires_equipment`: **required array (may be `[]`)** of `EQUIPMENT_VOCAB` slugs naming gear a dish is genuinely **impossible** without — the "no recipe-preserving workaround exists" test. **`[]` is the overwhelming common case**; tag only truly-irreplaceable equipment, since a wrong tag silently hides a makeable recipe. A controlled vocabulary like `protein`/`cuisine` (an off-vocab slug = hard failure **at both write time and build time**, from the same shared `src/vocab.js`). Objective **shared content** carried in the D1 `recipes` table, written by `create_recipe`/`update_recipe`. Drives the `search_recipes` makeability gate against a member's kitchen `owned` list (the D1 `kitchen_equipment` rows). Current set: `pressure-cooker, sous-vide-circulator, blender, ice-cream-maker`.
- `season`: **required array (may be `[]`)** of `SEASON_VOCAB` tokens — a **controlled vocabulary** like `protein`/`cuisine`/`requires_equipment`, validated at **both write and build time** from the shared `src/vocab.js` (an off-vocab token is a hard failure; `autumn` is rejected in favor of `fall`). `[]` means **year-round**. Drives the retrospective's in-season `underused` surfacing (a non-empty `season` not including the current Northern-hemisphere season is treated as out of season). Read paths normalize legacy values (case-fold + `autumn`→`fall`) so a pre-enforcement value still matches on read; a non-canonical *stored* value must be corrected to the vocabulary before it is re-written or rebuilt under the gate. Current set: `spring, summer, fall, winter`.
- `ingredients_key`: **required, non-empty** — the top 5–7 defining ingredients for filtering and the pantry-overlap re-rank. Full ingredient list lives in the body. **Normalized through the alias table on write** (`create_recipe`/`update_recipe`, same matcher as `perishable_ingredients`) so names line up across recipes.
- **The recipe index is the D1 `recipes` table — not a file.** `build-indexes` validates `recipes/*.md`, then **projects** the shared objective set into the D1 `recipes` table, replacing it wholesale in one transaction (`DELETE` then batched `INSERT`) so a removed recipe loses its row and the table is a deterministic function of `recipes/*.md`. There is **no** `_indexes/recipes.json`. The Worker reads the index from D1 (`src/recipe-index.ts`, built on `src/db.ts`). A *provisioned-but-empty* table is a valid empty corpus (a vibe-less `search_recipes` spec returns `{ results: [{ label, recipes: [] }] }`); an *unreadable* table (D1 unreachable / unmigrated) surfaces as `index_unavailable`. The `data-deploy` workflow runs `build-indexes` after deploy to populate the table on a fresh database (the bootstrap guarantee). `_indexes/` remains in the data repo for the static site's `components.json`, which a different build target owns.

  The `recipes` table holds **objective shared content only** (no per-tenant `favorite`/`reject`/`last_cooked`): scalar columns `slug` (PK), `title`, `protein`, `cuisine`, `time_total`, `ingredients_key` (a JSON array as TEXT), `source_url` (the recipe's `source` frontmatter); JSON-array columns `tags`, `course`, `season`, `dietary`, `pairs_with`, `perishable_ingredients`, `requires_equipment`; and an `extra` JSON object carrying any other objective frontmatter (so a new field is lossless without a migration until promoted to a queryable column). `idx_recipes_source_url` makes the discovery idempotency check an indexed lookup. Schema: `migrations/d1/0002_recipes.sql`.

### Recipe body structural contract

The markdown body below the frontmatter is freeform, with one **hard requirement**: it MUST contain both an `## Ingredients` H2 section and an `## Instructions` H2 section (exact labels, ATX `##` headings). Validation in `scripts/build-indexes.mjs` fails the build (non-zero exit) and names the offending file and missing section if either is absent.

- **Ingredients** is conventionally a `-` bullet list; **Instructions** a numbered list. Site generation renders them as `<ul>` and `<ol>` respectively.
- Additional H2 sections (e.g. `## Notes`) are permitted and render generically — no validator or generator change is needed to add one.
- The contract exists so downstream site generation (`scripts/build-site.mjs`) can reliably locate the ingredient list (to inject checkboxes) and the step list (for numbering + read-aloud) without guessing.

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

Live inventory. Agent-writable. Updated as side effect of menu generation and ad-hoc messages. Stored as rows in the D1 `pantry` table (`PRIMARY KEY (tenant, normalized_name)`; `idx_pantry_category(tenant, category)` backs the `read_pantry` category filter). `notes` is an optional short freeform string. Adds are `INSERT … ON CONFLICT DO UPDATE` (keep `added_at`, refresh `last_verified_at`, overlay the rest); reads/writes are row-level and strongly consistent. The schema below describes each item object's shape:

```sql
-- D1 pantry table — one row per item. PRIMARY KEY (tenant, normalized_name).
-- idx_pantry_category on (tenant, category).
tenant           TEXT  -- owning user
name             TEXT  -- display name (e.g. "olive oil")
normalized_name  TEXT  -- normalized for dedup/lookup
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
- `owned`: array of `EQUIPMENT_VOCAB` slugs (the same set `requires_equipment` validates against: `pressure-cooker, sous-vide-circulator, blender, ice-cream-maker`). An off-vocab slug is rejected by `update_kitchen` at write time (a structured conflict, no write) — the gate's left operand is kept vocabulary-clean. (D1-backed now, so there is no build-time check; the write-time gate is the sole guard.)
- `[notes]`: freeform table, parse-checked only. Oven count, pan sizes, sheet trays — surfaced to the `cook` flow for parallelization suggestions; **no schema, never gates**. Seeded through normal `cook` use, not at onboarding.
- The makeability rule: a recipe is makeable for a member when its `requires_equipment` is a subset of `owned`. Empty/absent `owned` ⇒ gate no-op. See `search_recipes` and the kitchen-equipment capability.

## grocery list (per-tenant, D1 session state)

The buy list — committed intent for the next order. Ingredient/product-level and **SKU-free**: resolution to a Kroger SKU happens once, at order time, against current availability, so the list never pins a brand/SKU that could go stale between capture and order. Stored as rows in the D1 `grocery_list` table (`PRIMARY KEY (tenant, normalized_name)`; `for_recipes` is a JSON column; `idx_grocery_status(tenant, status)` backs the `read_grocery_list` status filter). Agent-writable side-effect data (NOT user-curated config). Distinct from pantry (observation: what's in the kitchen) and `stockup` (conditional intent: buy IF on sale). Items are keyed by normalized `name` — re-adding an existing name merges (row upsert) rather than duplicating; the order/cart status transitions (`place_order`, the in-store walk) are row updates. The schema below describes each item object's shape:

```sql
-- D1 grocery_list table — one row per item. PRIMARY KEY (tenant, normalized_name).
-- idx_grocery_status on (tenant, status).
tenant           TEXT  -- owning user
name             TEXT  -- order-time search term (display name; required)
normalized_name  TEXT  -- normalized for dedup/upsert keying
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
default_cooking_nights      INTEGER  -- default number of cooking nights per week
lunch_strategy              TEXT     -- leftovers | buy | mixed
ready_to_eat_default_action TEXT     -- opt-in | auto-add
stores                      TEXT     -- JSON: {primary, preferred_location, location_zip}
dietary                     TEXT     -- JSON: {avoid[], limit[]}
custom                      TEXT     -- JSON: arbitrary agent-added keys
kitchen_notes               TEXT     -- JSON: freeform cook-reasoning notes (oven count, pan sizes)
freezer_capacity_estimate   TEXT     -- tight | moderate | spacious
rotation                    TEXT     -- JSON: {resurface_after_days?, novelty_boost?}

-- D1 brand_prefs table — one row per (tenant, ingredient term). PRIMARY KEY (tenant, term).
tenant  TEXT  -- owning user
term    TEXT  -- normalized ingredient term (e.g. "olive_oil")
ranks   TEXT  -- JSON array: [] = don't-care/cheapest; non-empty = ranked brand list (first available wins)
```

Example rows (`profile`):

| tenant | default_cooking_nights | lunch_strategy | ready_to_eat_default_action | stores | dietary | freezer_capacity_estimate |
|--------|----------------------|----------------|----------------------------|--------|---------|--------------------------|
| alice | 3 | leftovers | opt-in | {"primary":"kroger","preferred_location":"Kroger - 76104","location_zip":"76104"} | {"avoid":[],"limit":["cilantro"]} | moderate |

Example rows (`brand_prefs`):

| tenant | term | ranks |
|--------|------|-------|
| alice | olive_oil | ["California Olive Ranch","Cobram Estate"] |
| alice | butter | ["Kerrygold","Plugra"] |
| alice | yellow_onion | [] |

**`[brands]` is tri-state and drives matching confidence.** The Kroger matching pipeline reads a key's *presence* as the confidence signal: absent → ambiguous (Claude asks); `[]` → "don't care," pick cheapest acceptable without asking; a non-empty list → ranked preference, **list order is rank**. Keys are the canonical normalized ingredient term with spaces as underscores (`extra virgin olive oil` → normalize via the aliases table → `olive oil` → key `olive_oil`). A non-empty list whose brands are all unavailable falls back to ambiguous.

**`[stores].primary` is the fulfillment mode** (in-store-fulfillment). It is either the literal `kroger` (online mode — the agent flushes the grocery list with `place_order`, using `preferred_location` for the Kroger API) **or** a mapped store slug from `stores/` (walk mode — the agent runs the in-store walk for that store instead). The agent picks the flush from the resolved mode and SHALL NOT assume Kroger. Mode is a property of the **preference/trip, not the chain** — a store can be online-capable and/or walk-capable. **Naming a store for one trip** ("I'm going to the West 7th Tom Thumb") overrides the standing `primary` for that trip only, without rewriting it. An unknown store-slug `primary` is **not a hard failure** (preferences is parse-only curated config) — the agent resolves it conversationally (offer to map the store, or fall back to online). `preferred_location` stays meaningful in walk mode too (it still drives Kroger pricing for sale checks).

## aliases (shared corpus, D1 `aliases` table)

Ingredient name variants. Agent edits only when directed (it can suggest additions during matching pipeline runs).

```sql
-- D1 aliases table — ingredient name canonicalization. PRIMARY KEY (variant).
variant    TEXT  -- the raw/alternate form (e.g. "EVOO", "extra virgin olive oil")
canonical  TEXT  -- the normalized canonical form (e.g. "olive oil")  NOT NULL
```

Example rows:

| variant | canonical |
|---------|-----------|
| EVOO | olive oil |
| extra virgin olive oil | olive oil |
| chx thighs | chicken thighs |
| chicken thigh | chicken thighs |
| cherry tomato | cherry tomatoes |

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
- The public Kroger API has no flyer/circular endpoint. The sale list is synthesized by searching these terms and keeping fulfillable, genuinely-discounted products. As of the flyer-warm change these broad terms are consumed by the **background warm** (`src/flyer-warm.ts`, a scheduled cron) that materializes a per-store cache, **not** by a live `kroger_flyer` call — the tool reads the cache. (Precise, per-tenant checks — a specific stockup item or substitute candidate on sale — moved to the place-groceries flow.)
- A flat top-level `terms` array of strings. **Absent or empty degrades gracefully**: the sweep has no broad terms, the per-store rollup is empty, and `kroger_flyer` returns an empty list rather than erroring. Terms are trimmed, lowercased, and deduped by the warm, so case-variant duplicates ("Olive Oil" / "olive oil") are never scanned twice.
- Each term is scanned a few pages deep, but the scan is **relevance**-ranked (no sort-by-discount), so it samples the head of each category — deep sales on low-relevance items can be missed. This limitation is documented, not hidden.

## Warmed flyer cache (KV, not a repo file)

Derived, time-bound state written by the flyer warm into the `KROGER_KV` namespace (not the data repo — it's an ephemeral cache, regenerated each sweep). Documented here for completeness; nothing edits it by hand.

- `flyer:{locationId}` → `{ sweep_id, as_of, items }` — the per-store rollup. `items` are noise-floor `FlyerItem`s (`{ sku, brand, description, size, price: { regular, promo }, savings, categories, matched_terms }`); `as_of` is epoch ms of the last contribution (surfaced to `kroger_flyer` readers as an ISO 8601 string). Shared across all tenants at that store.
- `flyer:cursor` → `{ sweep_id, index, total, last_refresh_at, done, completed_at }` — tiny per-tick progress record; the idle-tick read. `completed_at` is epoch ms of the most recent FULL sweep (monotonic — a new sweep doesn't clear it), the freshness signal the warm's health record carries.
- `flyer:plan` → `{ sweep_id, units }` — the ordered `(locationId, term)` unit list, built once per sweep so later ticks don't re-enumerate over GitHub.

## Background-job health (KV, not a repo file)

Derived operational state for the `/health` endpoint (background-job-health). Each background process writes one record per run; `/health` aggregates them. Tenant-data-free by construction — counts, timestamps, and error classes only.

- `health:job:<name>` → `{ ok, last_run_at, summary }` — one per background job (`health:job:flyer-warm`, `health:job:email`). `ok` is the last run's success; `last_run_at` is epoch ms; `summary` is small tenant-clean detail (the warm carries `{ action, done, sweep_started_at, sweep_completed_at, errors }`; the email handler carries the gate outcome `{ accepted, reason, written }`).
- `GET /health?token=<HEALTH_TOKEN>` → `{ ok, generated_at, jobs: [{ name, ok, last_run_at, never_run?, summary? }] }` — token-gated (404 when `HEALTH_TOKEN` unset, 401 on a wrong token), aggregate-only. Overall `ok` is false only when a job is *explicitly* failing; a never-run job is reported with `ok: null, never_run: true`. HTTP status is 200 when ok, 503 when failing (so plain HTTP-status monitors trip).

## feeds (shared corpus, D1 `feeds` table)

**Shared** (data-repo root). RSS feed URLs and tags — **agent-writable via `update_feeds`** (add-only, deduped by canonicalized url) as well as hand-curated. Discovery sources are a group-wide concern: any member's feeds contribute to one shared candidate pool (`fetch_rss_discoveries`), judged against the caller's taste at read time. `fetch_rss_discoveries` reads `url`/`name`/`weight`; `tags` are descriptive.

```sql
-- D1 feeds table — shared RSS feeds for recipe discovery. PRIMARY KEY (url).
url     TEXT  -- canonical feed URL
name    TEXT  -- human-readable feed name
weight  REAL  -- relative fetch weight (higher = more results surfaced)
tags    TEXT  -- JSON array of descriptive tags (e.g. ["trusted", "technique-focused"])
```

Example rows:

| url | name | weight | tags |
|-----|------|--------|------|
| https://www.seriouseats.com/recipes/atom.xml | Serious Eats | 1.0 | ["trusted","technique-focused"] |
| https://www.budgetbytes.com/feed/ | Budget Bytes | 0.8 | ["weeknight","approachable"] |
| https://www.bonappetit.com/feed/rss | Bon Appétit | 0.7 | ["aspirational","trend-aware"] |

## discovery_candidates (shared corpus, D1 `discovery_candidates` table)

**Shared** (D1 shared corpus). Agent-writable side-effect data (NOT user-curated). Written by the Worker's inbound-email handler (`email()`), which receives newsletters forwarded to `groceries-agent@<domain>`, and read by the agent via `read_discovery_inbox`. Each row is one received message with its full plain-text body. The agent reads each `body` and extracts recipe titles and URLs itself — no pre-extraction happens in the Worker. This is the *push* complement to RSS pull — it reaches bot-walled/paywalled sources (Serious Eats, NYT) the Worker can't fetch.

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
- `body` contains the email's plain-text content (or HTML converted to readable text), truncated to 10,000 characters. The agent scans it for recipe links; there is no pre-extracted candidate list.
- Entries are deduped at write-time by `(source, subject, discovered_at)` — the same email forwarded twice is stored only once.
- An empty table is valid (no discoveries yet) — `read_discovery_inbox` returns `{ emails: [] }`.

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

## guidance/

**Shared corpus** (data-repo root). A curated tree of **opinionated, vetted advice** the agent surfaces in flow, organized by **domain** subdirectory. Each file is markdown prose keyed by a semantic slug, with an optional one-line `description` frontmatter field (the only structured field; the rest is freeform prose). Files are validated only for existence, not parse-checked as data (like other curated markdown). Both domains map by **agent world-knowledge over the semantic slugs** — there is deliberately no manifest or alias table; over-fetching is harmless.

Two read tools cover the whole umbrella: `list_guidance(domain?)` (slugs + optional `description`, one domain or all grouped) and `read_guidance(domain, slugs)` (named entries' content). One gated write tool, `save_guidance(domain, slug, content, source?)`, exists for the writable domain only. See `docs/TOOLS.md`.

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

- **Read-only / edit-when-directed curated config** — `save_guidance` rejects this domain (it is excluded from the writable allowlist), so it changes only by hand-editing the data repo. The read-only guarantee is enforced by the allowlist, not by the absence of any write tool.
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

- **Shared + agent-writable** (the `stores`/`feeds` posture): any member's `save_guidance` write lands in the one shared tree, read by the whole group. Written via the shared commit engine (one atomic commit, same path as `create_recipe`).
- `save_guidance(domain, slug, content, source?)`: `content` is the full markdown the agent composes (distilled, imperative, non-obvious — with a `description:` line); `source`, when given, is recorded into the frontmatter for provenance/citation. A kebab-case `slug`, no traversal.
- **Capture** is member-initiated (a posted article/URL/distillation → the capture skill); **surfacing** is at cook time (the agent maps a recipe step → technique slug and weaves the non-obvious tip in at that step, capped ~2, silent when nothing matches). See AGENT_INSTRUCTIONS.

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
