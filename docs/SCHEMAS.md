# SCHEMAS.md — Data File Reference

Concrete schemas with example values for every data file in the repo. Keep this in sync with the actual files — when you add a field, update here first, then update the file. Validation runs in two places: `scripts/build-indexes.mjs` (the full validator, at data-repo build time) and a *structural subset* in the Worker's `src/validate.ts` (at write time). Not every file is build-validated — e.g. `pantry.toml` / `grocery_list.toml` are structurally checked only in the Worker.

## File placement: shared vs per-tenant (multi-tenant data model)

The data lives in **one private data repo** with two regions (see `ARCHITECTURE.md`). Every file below lives in exactly one:

- **Shared corpus (data-repo root)** — objective, single-source, read by everyone: `recipes/*.md` (objective frontmatter + body), `aliases.toml`, `skus/kroger.toml`, `flyer_terms.toml`, `storage_guidance/` (curated put-away advice), **`stores/<slug>.toml`** (in-store walk store registry — identity, keyed by location; layout lives in store notes), **`feeds.toml`** (RSS discovery feeds), **`discoveries_inbox.toml`** (forwarded-newsletter candidates), **`discovery_sources.toml`** (inbound-email allowlist), `_indexes/`. Discovery is a shared, top-level concern — feeds and the newsletter inbox feed one group pool, judged against each caller's taste at read time.
- **Per-tenant subtree (`users/<username>/`)** — each member's own state: `pantry.toml`, `preferences.toml`, `stockup.toml`, `grocery_list.toml`, `meal_plan.toml`, `cooking_log.toml`, `ready_to_eat.toml` (personal heat-and-eat catalog), `kitchen.toml` (owned cooking equipment), `taste.md`, `diet_principles.md`, **`overlay.toml`** (subjective recipe view), **`notes/<slug>.toml`** (attributed recipe notes), **`store_notes/<slug>.toml`** (attributed store notes), and any personal (unshared) recipes.

**Three-category recipe model:** a recipe's *content* (objective frontmatter + body) is shared; its *overlay* (`rating` + `status`) is per-tenant in `overlay.toml`; its *notes* are per-tenant, attributed, append-mostly. `last_cooked` is **not stored** — it's derived per-tenant from that member's `cooking_log.toml`. Read tools merge shared content + the caller's overlay + cooking-log `last_cooked` at read time.

## Recipe frontmatter (recipes/*.md)

YAML frontmatter at the top of each recipe markdown file. Body below is freeform markdown.

```yaml
---
title: Lemon Garlic Roasted Chicken
tags: [chicken, mediterranean, sheet-pan, weeknight]
protein: chicken                # controlled vocab: chicken | beef | pork | lamb | turkey | fish | shellfish | egg | tofu | vegetarian | vegan | mixed
cuisine: mediterranean          # controlled vocab (coarse buckets); see the cuisine list below
course: [main]                  # OPEN-vocab dish type (main | side | dessert | breakfast | …); string or array; classified at import; index-normalized to a lowercased array
style: sheet-pan                # sheet-pan | one-pot | grill | braise | stir-fry | etc.
time_total: 50                  # minutes, integer
time_active: 15                 # minutes, integer
servings: 4
difficulty: easy                # easy | medium | hard
dietary: [gluten-free, dairy-free]    # array; can be empty
season: [spring, summer]              # array of seasons; can be empty for year-round
veg_forward: false              # boolean
# --- The next three are per-tenant, not shared-content fields ---
# last_cooked  → derived from each member's cooking_log.toml (not stored here or in the index)
# rating       → per-tenant users/<id>/overlay.toml
# status       → per-tenant users/<id>/overlay.toml (effective default: draft)
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
- `rating`, `status`, and `last_cooked` are **per-tenant**, not shared content — they live in `overlay.toml` (rating/status) or are derived from `cooking_log.toml` (last_cooked), and the shared `_indexes/recipes.json` carries objective fields only. A shared recipe's frontmatter SHOULD NOT carry them; the build strips them and treats `status` as optional. (`create_recipe` still stamps a default `status: draft` onto a brand-new recipe's frontmatter, which the build then strips from the shared index — frontmatter status is *tolerated and ignored*, not forbidden.) `update_recipe` routes a `rating`/`status` edit to the caller's overlay, never the shared file.
- `status` lifecycle (per-tenant): new imports default to effective `draft`. A member's feedback promotes to `active` (with rating) or rejects to `rejected` **in their own overlay** — one member's disposition never changes another's.
- `pairs_with`: slugs of other recipes, optional (defaults to empty). A *plating* edge — recipes eaten together on one plate (a main's companion **corpus** sides). Each slug MUST resolve to a real recipe (a build hard-failure otherwise); corpus sides are themselves recipes, so they reuse the normal import/grocery-list pipeline. Objective **shared content** (carried in `_indexes/recipes.json`, written by `update_recipe`) — not a per-tenant overlay field. Grown lazily by the meal-plan flow as corpus pairings are confirmed (filter candidates with `course: side`); **open-world sides** — trivial preparations with no recipe file — are not recorded here (no slug to remember) and ride on the main's `meal_plan.toml` `[[planned]]` row instead.
- `course`: optional, an **open-vocabulary** classification of what kind of dish the recipe is — one or more of `main`, `side`, `dessert`, `breakfast` by convention, but **any** string is allowed (e.g. `sauce`, `baked_good`) with **no controlled set and no code change** to extend it (contrast `protein`/`cuisine`, which ARE controlled). Authored as a string or an array of strings; the build **normalizes** it to a lowercased, trimmed **array** (so `Main` → `["main"]`), defaulting to `[]` when absent (warn-free). A recipe that plates as more than one course carries multiple values (`course: [main, side]`). Validated for **shape only** (a string or array-of-strings; otherwise a build/Worker hard-failure) — the *values* are never checked. Objective **shared content** carried in `_indexes/recipes.json`, classified at import by `create_recipe` (and editable via `update_recipe`); `list_recipes` filters it by **containment**. (`standalone` is **retired** — whether a main is an already-rounded plate is inferred by the agent at plan time, not persisted; a lingering `standalone` field is ignored, never validated or indexed.)
- `perishable_ingredients`: optional array (defaults to empty, warn-free when absent) — a **normalized** list of the recipe's perishable ingredients, feeding the menu-gen waste callout (a partial-unit perishable that no other proposed recipe uses). **Derived at import, not hand-maintained:** the import/create flow classifies it alongside `protein`/`cuisine`. The classification test is *"would the leftover rot before I'd realistically use it?"* — not botany — so shelf-stable staples (olive oil, canned beans) are excluded and a small amount of a fast-spoiling item is included; fuzzy edges (eggs, potatoes) are fine since a wrong call only costs a dismissed nudge. Names use the **same normalization the pantry-verify matcher applies** (`normalizeIngredient`), applied at write time by `create_recipe`/`update_recipe`, so a perishable lines up across recipes for overlap detection. Present-but-not-a-string-array is a build hard-failure (like a non-boolean `standalone`). Objective **shared content** carried in `_indexes/recipes.json` — not a per-tenant overlay field, not curated config. Hand-edit only to correct a misclassification.
- `protein` and `cuisine` are **controlled vocabularies** (coarse buckets — `fish` not `salmon`) so variety reasoning is reliable. A value **present** but outside its set is a hard build failure; **absence** keeps the warn-only treatment. Extending a vocabulary is a deliberate edit to the allowed sets in `scripts/build-indexes.mjs`. Current cuisine set: `american, brazilian, cajun, caribbean, chinese, cuban, filipino, french, german, greek, indian, italian, japanese, korean, mediterranean, mexican, moroccan, peruvian, southwestern, spanish, thai, vietnamese`.
- `requires_equipment`: optional array of `EQUIPMENT_VOCAB` slugs naming gear a dish is genuinely **impossible** without — the "no recipe-preserving workaround exists" test. **Default empty** (the overwhelming common case); tag only truly-irreplaceable equipment, since a wrong tag silently hides a makeable recipe. A controlled vocabulary like `protein`/`cuisine` (present-but-off-vocab = hard build failure; absence neither fails nor warns). Objective **shared content** carried in `_indexes/recipes.json`, written by `create_recipe`/`update_recipe`. Drives the `list_recipes` makeability gate against a member's `kitchen.toml` `owned` list. Current set: `pressure-cooker, sous-vide-circulator, blender, ice-cream-maker`.
- `ingredients_key`: top 5–7 ingredients for filtering. Full ingredient list lives in the body.

### Recipe body structural contract

The markdown body below the frontmatter is freeform, with one **hard requirement**: it MUST contain both an `## Ingredients` H2 section and an `## Instructions` H2 section (exact labels, ATX `##` headings). Validation in `scripts/build-indexes.mjs` fails the build (non-zero exit) and names the offending file and missing section if either is absent.

- **Ingredients** is conventionally a `-` bullet list; **Instructions** a numbered list. Site generation renders them as `<ul>` and `<ol>` respectively.
- Additional H2 sections (e.g. `## Notes`) are permitted and render generically — no validator or generator change is needed to add one.
- The contract exists so downstream site generation (`scripts/build-site.mjs`) can reliably locate the ingredient list (to inject checkboxes) and the step list (for numbering + read-aloud) without guessing.

## users/&lt;username&gt;/overlay.toml (per-tenant)

Each member's **subjective view** of shared recipes — the overlay merged onto shared content at read time. Keyed by recipe slug. Holds **only** `rating` + `status` (the two genuinely-subjective single-values). `last_cooked` is **not** here — it's derived from this member's `cooking_log.toml`. Agent-writable side-effect file; an absent row means effective `status: draft` for that member.

```toml
# users/alice/overlay.toml — Alice's subjective overlay (rating + status) by slug.
# Merged onto shared recipe content at read time; absent slug → status draft.
# last_cooked is NOT here — it is derived from cooking_log.toml.

[overlay.lemon-garlic-roasted-chicken]
status = "active"
rating = 5

[overlay.miso-glazed-salmon]
status = "rejected"            # Alice rejected it; other members are unaffected
```

**Notes:**
- A row carries `status` (`active | draft | rejected | archived`) and/or `rating` (1–5). Either may be absent. An empty row is dropped (the slug falls back to effective `draft`).
- Disposition is **per-tenant**: one member's `rejected` coexists with another's `active` for the same shared recipe.

## users/&lt;username&gt;/notes/&lt;slug&gt;.toml (per-tenant)

A member's **attributed notes** on one recipe (shared or personal) — the spin-capture mechanism. One file per recipe slug, `[[notes]]` array, append-mostly. **Author is structural** — it's the `users/<id>/` path the file lives under, never a field (unspoofable). Adding a note never modifies shared content; an author MAY edit or delete their **own** notes (`update_recipe_note` / `remove_recipe_note`, addressed by `created_at`, self-scoped) but never another tenant's.

```toml
# users/alice/notes/miso-glazed-salmon.toml
# Recipe notes authored by this tenant (one file per recipe slug).
# Append-mostly; author is the users/<id>/ path, not a field. private → owner-only.

[[notes]]
created_at = "2026-06-09T18:30:00.000Z"   # ISO timestamp (required)
body = "Subbed gochujang for the sriracha and cut the sugar — better."
tags = ["tweak"]                           # optional: e.g. tweak | observation

[[notes]]
created_at = "2026-06-10T01:05:00.000Z"
body = "Didn't love it cold the next day."
private = true                             # owner-only; never surfaced to the group
```

**Notes:**
- `body` (required), `created_at` (required), `tags` (optional, default `[]`), `private` (optional, default `false`). A note with no `body` is dropped on read.
- `read_recipe_notes(slug)` aggregates **non-private** notes from every member (attributed) plus the **caller's own** private notes; another member's `private` note is never surfaced. Group ratings (from each `overlay.toml`) ride the same read. `created_at` is the addressable key for `update_recipe_note` / `remove_recipe_note`.

## pantry.toml

Live inventory. Agent-writable. Updated as side effect of menu generation and ad-hoc messages.

```toml
# pantry.toml — current inventory

[[items]]
name = "olive oil"
category = "pantry"             # pantry | fridge | freezer | spices
quantity = "partial"            # full | partial | low | "<count>" for countables
added_at = "2025-04-01"
last_verified_at = "2025-05-12"
prepared_from = null            # slug if this is cooked/prepared from a recipe

[[items]]
name = "ground beef"
category = "freezer"
quantity = "3 lb"
added_at = "2025-05-10"
last_verified_at = "2025-05-10"
prepared_from = null

[[items]]
name = "cooked rice"
category = "fridge"
quantity = "partial"
added_at = "2025-05-12"
last_verified_at = "2025-05-12"
prepared_from = "salmon-with-rice"   # tells the agent this is cooked food with faster perishability

[[items]]
name = "cumin"
category = "spices"
quantity = "full"
added_at = "2024-11-03"
last_verified_at = "2025-04-30"
prepared_from = null
```

**Notes:**
- `quantity` is intentionally loose — "full", "partial", "low" plus optional explicit counts. We don't track precise amounts (whiteboard problem).
- `prepared_from` set for cooked/prepared items — faster perishability profile, identifies which recipe produced it.
- `last_verified_at` resets when the user confirms the item is still there during a pantry confirmation pass.

## users/&lt;username&gt;/kitchen.toml (per-tenant)

What a member owns to cook **with** (equipment, not ingredients). Agent-writable via `update_kitchen`. Two structurally-separated regions: `owned` (controlled-vocabulary slugs — the **only** region that gates recipe makeability) and `[notes]` (freeform context the `cook` skill reasons over for parallelization — **never** gates). An absent file means the member's equipment is *unknown*, which makes the makeability gate a no-op (every recipe shows) — unknown is not the same as not-owned.

```toml
# users/alice/kitchen.toml — equipment Alice owns to cook WITH.
# `owned` GATES (requires_equipment ⊆ owned → makeable); `[notes]` never does.

owned = ["pressure-cooker", "blender"]   # EQUIPMENT_VOCAB slugs only

[notes]                                   # freeform — cook reads, gate ignores
ovens = 2
toaster_oven = true
free_text = "10-inch cast iron, half-sheet trays"
```

**Notes:**
- `owned`: array of `EQUIPMENT_VOCAB` slugs (the same set `requires_equipment` validates against: `pressure-cooker, sous-vide-circulator, blender, ice-cream-maker`). An off-vocab slug is a build hard-failure and is rejected by `update_kitchen` at write time (a structured conflict, no commit) — the gate's left operand is kept vocabulary-clean.
- `[notes]`: freeform table, parse-checked only. Oven count, pan sizes, sheet trays — surfaced to the `cook` flow for parallelization suggestions; **no schema, never gates**. Seeded through normal `cook` use, not at onboarding.
- The makeability rule: a recipe is makeable for a member when its `requires_equipment` is a subset of `owned`. Empty/absent `owned` ⇒ gate no-op. See `list_recipes` and the kitchen-equipment capability.

## grocery_list.toml

The buy list — committed intent for the next order. Ingredient/product-level and **SKU-free**: resolution to a Kroger SKU happens once, at order time, against current availability, so the list never pins a brand/SKU that could go stale between capture and order. Agent-writable side-effect file (NOT user-curated config). Distinct from `pantry.toml` (observation: what's in the kitchen) and `stockup.toml` (conditional intent: buy IF on sale). Items are keyed by normalized `name` — re-adding an existing name merges rather than duplicating.

```toml
# grocery_list.toml

[[items]]
name = "extra virgin olive oil"   # order-time search term (required)
quantity = "1 bottle"             # loose BUY amount: count | "1 bottle" | "enough for the week"
kind = "grocery"                  # grocery | household | other
domain = "grocery"                # free string: which store-TYPE it's bought at (default "grocery")
status = "active"                 # active | in_cart | ordered  (required)
source = "pantry_low"             # ad_hoc | menu | pantry_low | stockup
for_recipes = []                  # recipe slugs needing it (menu-derived)
note = "the fancy one this time"  # freeform: one-off brand request, occasion, or null
added_at = "2026-06-09"           # ISO date (required)
ordered_at = null                 # ISO date set when status -> ordered; else null

[[items]]
name = "2x4 lumber"
quantity = "6"
kind = "other"
domain = "home-improvement"       # included in a home-improvement store's walk, excluded from a grocery walk
status = "active"
source = "ad_hoc"
for_recipes = []
added_at = "2026-06-09"

[[items]]
name = "paper towels"
quantity = "1 pack"
kind = "household"                # non-food: skips pantry reconcile on receive
status = "active"
source = "ad_hoc"
for_recipes = []
added_at = "2026-06-09"
```

**Notes:**
- `quantity` is the loose BUY amount (1 package unless told otherwise). Recipe-level needs are NOT stored — they're re-aggregated from `for_recipes` when needed (e.g. the partial-check prompt), keeping the no-portion-math stance.
- `kind` distinguishes non-food items. Only `grocery` items reconcile back into `pantry.toml` when an order is received.
- `domain` (free string, default `grocery`; common values `grocery | home-improvement | garden | pharmacy`) is the kind of **store** the item is bought at — **orthogonal to `kind`**: `kind` governs pantry reconcile on receive, `domain` governs which store-type an in-store walk includes the item in. Absent → read as `grocery` (existing items validate unchanged). Open-vocabulary, not a hard enum — a wrong tag only mis-files an item onto the wrong walk. Validated shape-only (a non-string fails) in the Worker write subset; `add_to_grocery_list` / `update_grocery_list` accept it.
- `source` carries provenance for order-time dedup/behavior: `pantry_low`/`stockup` were promoted (don't re-prompt); `menu` aggregates with recipe needs; `ad_hoc` is a one-off.
- `note` holds a **one-off** brand request ("the fancy olive oil this time") — explicitly NOT `preferences.toml`, which is for standing dispositions.
- Lifecycle: `active → in_cart → received`. The `status` **enum is only `active | in_cart | ordered`** — `received` is not a stored status but the receive *action* (the row is removed and the pantry restocked). `place_order` writes the `active → in_cart` advance; `ordered`/`ordered_at` exist in the schema but no path sets them.

## cooking_log.toml

The durable, append-only **cooking** log (not an eating log). One entry per cooking event or at-home convenience meal. **Eating out is never logged**, and **leftovers of an already-logged cook are not re-logged** (one cook that feeds several meals is one entry). This is the trend spine `retrospective` reads, and the source `last_cooked` is **derived** from: `last_cooked` for a recipe == the maximum entry `date` whose `recipe` equals that slug. Agent-writable side-effect file (NOT user-curated config).

```toml
# cooking_log.toml

[[entries]]
date = "2026-06-09"            # ISO date (required)
type = "recipe"               # recipe | ready_to_eat | ad_hoc (required)
recipe = "arroz-caldo"        # slug; present iff type = recipe

[[entries]]
date = "2026-06-08"
type = "ready_to_eat"
name = "Kroger frozen lasagna"   # present for ready_to_eat / ad_hoc

[[entries]]
date = "2026-06-07"
type = "ad_hoc"
name = "fridge-clearout fried rice"
protein = "mixed"             # optional inline dims for non-recipe entries so
cuisine = "chinese"          # they still count in retrospective mixes
```

**Notes:**
- `type = recipe` entries are slug-only — protein/cuisine are looked up from the recipe index, never duplicated, so recategorizing a recipe retroactively corrects its history.
- `ready_to_eat` consumption also decrements the item's on-hand stock in `pantry.toml` (the member's `ready_to_eat.toml` catalog stays a pure options list with no stock field) and its accumulating frequency (by `name`) is the favored-item signal for re-order suggestions.
- Cadence ("cooks/week") counts `recipe` + `ad_hoc` only; `ready_to_eat` is the convenience side of the cook-vs-convenience split.
- Append-only by tool. Removing an entry is a manual edit; a `type = recipe` entry whose slug no recipe resolves to is a **hard** build failure (archival keeps the file, so history resolves; deletion-with-history is intentionally blocked).

## meal_plan.toml

The transient, recipe-grain record of **committed cook intent** — what the agent has agreed to cook next. Distinct from `grocery_list.toml` (the ingredient-grain BUY list): a planned recipe whose ingredients are all in the pantry still belongs here even though nothing is bought. Rows are cleared as they resolve (cooked → removed; abandoned → dropped). Agent-writable side-effect file (NOT user-curated config).

```toml
# meal_plan.toml

[[planned]]
recipe = "arroz-caldo"            # slug (required)
planned_for = "2026-06-10"        # ISO date the cook is slated for (optional)
sides = ["roasted broccoli"]      # optional free-text OPEN-WORLD sides riding on this main's row (never slug-resolved)
```

**Notes:**
- The session-start stale-planned reconcile surfaces only **due** rows — `planned_for` on or before today, or unset — and leaves future-dated plans alone.
- `sides` (optional, array of strings) holds **open-world sides** — trivial plate companions ("roasted broccoli", "white rice") with no recipe file — that ride on their main's row. It is advisory free text only: **never slug-resolved**, and the `recipe` slug invariant (and the reconcile/cook flows that key off it) is unaffected. A **corpus** side (a `course: side` recipe with a slug) earns its **own** `[[planned]]` row instead. Its ingredients reach `grocery_list.toml` as `source = "menu"`, `for_recipes = []`, with a `note` identifying the side.
- Extends the store model: `pantry` = observation, `stockup` = conditional intent, `grocery_list` = committed buy intent, **`meal_plan` = committed cook intent**, **`cooking_log` = realized history**.

## preferences.toml

User-curated. Agent edits only when explicitly directed.

```toml
# preferences.toml — standing preferences

default_cooking_nights = 3
lunch_strategy = "leftovers"     # leftovers | buy | mixed
ready_to_eat_default_action = "opt-in"   # opt-in | auto-add

[brands]
# Tri-state, and the source of matching confidence (see note below):
#   key absent  → ask me (ambiguous)
#   key = []    → "don't care," pick cheapest acceptable, stop asking
#   key = [..]  → ranked preference; LIST ORDER IS RANK (first available wins)
olive_oil = ["California Olive Ranch", "Cobram Estate"]
butter = ["Kerrygold", "Plugra"]
yogurt = ["Fage", "Siggi's"]
yellow_onion = []                # commodity — cheapest acceptable, never ask

[stores]
primary = "kroger"               # fulfillment mode: "kroger" (online flush) OR a store slug (walk flush)
preferred_location = "Kroger - 76104"   # resolved to a Kroger locationId, then used
                                        # for pricing + curbside/delivery availability

[dietary]
avoid = []                       # ingredients to always exclude
limit = ["cilantro"]             # ingredients to deprioritize but not reject
```

**`[brands]` is tri-state and drives matching confidence.** The Kroger matching pipeline reads a key's *presence* as the confidence signal: absent → ambiguous (Claude asks); `[]` → "don't care," pick cheapest acceptable without asking; a non-empty list → ranked preference, **list order is rank**. Keys are the canonical normalized ingredient term with spaces as underscores (`extra virgin olive oil` → normalize via aliases.toml → `olive oil` → key `olive_oil`). A non-empty list whose brands are all unavailable falls back to ambiguous.

**`[stores].primary` is the fulfillment mode** (in-store-fulfillment). It is either the literal `kroger` (online mode — the agent flushes the grocery list with `place_order`, using `preferred_location` for the Kroger API) **or** a mapped store slug from `stores/` (walk mode — the agent runs the in-store walk for that store instead). The agent picks the flush from the resolved mode and SHALL NOT assume Kroger. Mode is a property of the **preference/trip, not the chain** — a store can be online-capable and/or walk-capable. **Naming a store for one trip** ("I'm going to the West 7th Tom Thumb") overrides the standing `primary` for that trip only, without rewriting it. An unknown store-slug `primary` is **not a hard failure** (preferences is parse-only curated config) — the agent resolves it conversationally (offer to map the store, or fall back to online). `preferred_location` stays meaningful in walk mode too (it still drives Kroger pricing for sale checks).

## aliases.toml

Ingredient name variants. Agent edits only when directed (it can suggest additions during matching pipeline runs).

```toml
# aliases.toml — ingredient name canonicalization

[aliases]
"EVOO" = "olive oil"
"extra virgin olive oil" = "olive oil"
"chx thighs" = "chicken thighs"
"chicken thigh" = "chicken thighs"
"cherry tomato" = "cherry tomatoes"
```

## flyer_terms.toml

User-curated. Broad scan terms for `kroger_flyer`'s serendipitous sale
discovery. Agent edits only when directed (it may suggest additions during a
flyer scan, but never writes on its own).

```toml
# flyer_terms.toml — broad scan terms for serendipitous sale discovery

terms = [
  "fruit",
  "vegetables",
  "frozen meals",
  "cheese",
  "yogurt",
  "chicken",
  "ground beef",
  "salmon",
  "pasta",
  "coffee",
  "snacks",
  "ice cream",
]
```

**Notes:**
- The public Kroger API has no flyer/circular endpoint. `kroger_flyer` synthesizes a sale list by searching terms and keeping products where `promo > 0`. These **broad** terms supplement the **precise** terms from caller context (current menu ingredients, `stockup.toml`, and any substitute candidates the caller enumerates from world knowledge and passes as `terms`), widening the net past the known-items list.
- A flat top-level `terms` array of strings. **Absent or empty degrades gracefully**: `kroger_flyer` still scans the precise context terms and returns a (smaller) sale list rather than erroring.
- Each term is scanned a few pages deep, but the scan is **relevance**-ranked (no sort-by-discount), so it samples the head of each category — deep sales on low-relevance items can be missed. This limitation is documented, not hidden.

## feeds.toml

**Shared** (data-repo root). RSS feed URLs and tags — **agent-writable via `update_feeds`** (add-only, deduped by canonicalized url) as well as hand-curated. Discovery sources are a group-wide concern: any member's feeds contribute to one shared candidate pool (`fetch_rss_discoveries`), judged against the caller's taste at read time. `fetch_rss_discoveries` reads `url`/`name`/`weight`; `tags` are descriptive (a TOML string array — quote each value).

```toml
# feeds.toml — shared RSS feeds for recipe discovery

[[feeds]]
url = "https://www.seriouseats.com/recipes/atom.xml"
name = "Serious Eats"
tags = ["trusted", "technique-focused"]
weight = 1.0

[[feeds]]
url = "https://www.budgetbytes.com/feed/"
name = "Budget Bytes"
tags = ["weeknight", "approachable"]
weight = 0.8

[[feeds]]
url = "https://www.bonappetit.com/feed/rss"
name = "Bon Appétit"
tags = ["aspirational", "trend-aware"]
weight = 0.7
```

## discoveries_inbox.toml

**Shared** (data-repo root). Agent-writable side-effect file (NOT user-curated). Written by the Worker's inbound-email handler (`email()`), which receives newsletters forwarded to `groceries-agent@<domain>`, and read by the agent via `read_discovery_inbox`. Each `[[entries]]` is one received message with its full plain-text body. The agent reads each `body` and extracts recipe titles and URLs itself — no pre-extraction happens in the Worker. This is the *push* complement to RSS pull — it reaches bot-walled/paywalled sources (Serious Eats, NYT) the Worker can't fetch.

Old entries are automatically pruned when new ones arrive (default retention: 30 days).

```toml
# discoveries_inbox.toml — emails from forwarded newsletters for recipe discovery

[[entries]]
from = "news@seriouseats.com"
subject = "This week's best dinners"
received_at = "2026-06-11"            # YYYY-MM-DD from the message Date header (or "")
body = """
This week we're cooking:

Weeknight Chili (https://www.seriouseats.com/weeknight-chili)
Sheet-Pan Salmon (https://www.seriouseats.com/sheet-pan-salmon)

...
"""
```

**Notes:**
- `body` contains the email's plain-text content (or HTML converted to readable text), truncated to 10,000 characters. The agent scans it for recipe links; there is no pre-extracted candidate list.
- Entries are deduped at write-time by `(from, subject, received_at)` — the same email forwarded twice is stored only once.
- Absent file is valid (no discoveries yet) — `read_discovery_inbox` returns `{ emails: [] }`.

## discovery_sources.toml

**Shared** (data-repo root), allowlist config. The trust gate for inbound-email discovery: only mail from a listed source is processed. Two entry kinds — `[[members]]` (friend-group personal addresses: anything they forward gets indexed) and `[[senders]]` (newsletter `From` addresses: auto-forwarded mail from them gets indexed). Editable by `update_discovery_sources` (anyone trusted with the MCP can widen intake), deduped by `address`.

```toml
# discovery_sources.toml — inbound-newsletter allowlist (members + senders)

[[members]]
address = "casey@example.com"        # required, must contain @
name = "Casey"                       # optional label

[[senders]]
address = "cooking@nytimes.com"
name = "NYT Cooking"
```

**Notes:**
- Every entry needs a valid `address` (contains `@`) — enforced at build + write time.
- Auth posture: a message is accepted only when authenticated (Cloudflare DKIM/SPF/DMARC) AND from a listed source — `sender ∧ aligned-DKIM` (auto-forward) or `member ∧ aligned-DKIM` (manual forward). Everything else is dropped silently.

## storage_guidance/

**Shared corpus** (data-repo root). A curated, hand-maintained tree of **opinionated, vetted storage advice** the agent surfaces at put-away (2–3 relevant, non-obvious tips when new perishables enter the kitchen — on both the order `received` restock and a farmers-market `update_pantry` haul). It encodes opinions the model lacks, not shelf-life facts it already has — there is no shelf-life table; freshness is the agent's own judgment, not table-gated.

Each file is **markdown prose keyed by a storage behavior *class*** — `tender-herbs.md`, `hardy-herbs.md`, `leafy-greens.md`, `alliums.md`, `potatoes.md`, … — so one entry covers a whole family without per-ingredient duplication. A few **singletons** (`basil.md`, `tomatoes.md`, `avocados.md`) exist for items whose rule contradicts their class. Relational "don't store together" rules (ethylene cross-contamination, onions↔potatoes) live in a dedicated **`_ethylene.md`**, because they belong to no single item.

```markdown
---
description: cilantro, parsley, dill, mint — stems in water, in the fridge
---

# Tender herbs

Stand stems in ~1 inch of water, loosely bagged, **in the refrigerator** …
```

**Notes:**
- **Read-only / edit-when-directed curated config** — there is **no write tool** for it (it is hand-maintained, never an agent side-effect file). Two read tools cover it: `list_storage_guidance()` (class slugs + the optional one-line `description` from each file's frontmatter) and `read_storage_guidance(slugs)` (the named entries' content). See `docs/TOOLS.md`.
- The optional `description` frontmatter line is the only structured field; the rest is freeform prose. The file is validated only for existence, not parse-checked as data (like other curated markdown).
- **Mapping is by agent world-knowledge over the semantic slugs** (e.g. cilantro → `tender-herbs`) — there is deliberately no ingredient→class manifest or alias table; over-fetching a class is harmless.
- **Confidence-in-prose:** solid tips are written plainly; contested/folklore tips are pre-hedged *in the prose itself* ("some cooks rinse berries in vinegar — results vary"), so relaying the file faithfully is relaying it honestly. No matching class file → the agent gives **no tip** (silence over invention).

## stores/&lt;slug&gt;.toml (shared corpus)

**Shared corpus** (data-repo root). One file per **specific store location** (not per chain) — `stores/west-7th-tom-thumb.toml`, not `stores/tom-thumb.toml` — holding the store's **identity** every member reads for the in-store walk (the second fulfillment flush, alongside the Kroger `place_order` online flush). The registry is **identity only** — store **layout** (aisle order, where-it-hides hints, not-carried entries) lives in attributed store notes (`users/<id>/store_notes/<slug>.toml`, below), not here. Identity is unattributed (like recipe *content*). There is **no `_indexes/stores.json`** — a group registers a handful of stores, so `list_stores` reads the directory directly (the `ready_to_eat` posture). An **absent `stores/` tree is valid** (no stores registered yet → the walk degrades to a department list from world knowledge). Stores are shared like recipes: any MCP holder MAY register or edit one with no extra gate (the `update_discovery_sources` posture).

```toml
# stores/west-7th-tom-thumb.toml — objective store IDENTITY, shared.
# Layout lives in attributed store notes (store_notes/<slug>.toml, tags layout/location/stock).

slug = "west-7th-tom-thumb"      # required, kebab-case LOCATION id (matches the filename)
name = "Tom Thumb"               # required, the chain/store name
label = "West 7th"               # optional human handle for this location
chain = "tom-thumb"              # optional
address = "1600 W 7th St"        # optional
domain = "grocery"               # free string; default "grocery" (grocery | home-improvement | garden | pharmacy | …)
```

**Notes:**
- `slug` + `name` are required; everything else is optional. `slug` SHOULD match the filename (the location id). The registry carries **no layout** — aisle order, item placements, and not-carried entries are store notes.
- **Layout is notes.** Aisle order, where-it-hides placements, and not-carried entries are `add_store_note` / `read_store_notes` with `layout` / `location` / `stock` tags (see the `store_notes/` schema below). One surface for everything we know about a store. The walk infers aisle order from the `layout` notes (lead each with the aisle number); item→aisle placement is agent judgment over the store's own sign vocabulary (open-vocab, no manifest — the storage-guidance posture).
- `domain` (free string, default `grocery`) is the store's kind; the walk filters the grocery list to items of the same `domain`. A wrong tag only mis-files an item, so it's open-vocabulary, not a hard enum. For a store the user names that isn't registered, the agent classifies its domain from world knowledge (Lowe's → `home-improvement`).
- Unknown keys (`aisles` / `item_locations` / `doesnt_carry`) are **silently ignored** by the parser and both validators — identity is read, never an error.
- Validated structurally at build time (`scripts/build-indexes.mjs` → `validateStore`) and by the Worker's write-time subset (`src/validate.ts`). CRUD via `list_stores` / `read_store` / `add_store` / `update_store` (identity ops only) / `remove_store` (see `docs/TOOLS.md`). `list_stores` returns identity only — whether a store has a usable map is a `read_store_notes` concern.

## users/&lt;username&gt;/store_notes/&lt;slug&gt;.toml (per-tenant)

A member's **attributed notes** on one store — the store analog of recipe notes, and the **single home for everything we know about a store**: both freeform observations ("fish counter closes at 6 PM", "they have the Kerrygold I like") AND the store's **layout**, captured by tag convention. One file per store slug, `[[notes]]` array. **Author is structural** — the `users/<id>/` path the file lives under, never a field. Shared-by-default, with an optional `private` flag.

```toml
# users/alice/store_notes/west-7th-tom-thumb.toml
# Store notes authored by this tenant (one file per store slug).
# Author is the users/<id>/ path, not a field. private → owner-only.

# Layout — lead the body with the aisle number; note order by number is the walk path.
[[notes]]
created_at = "2026-06-11T18:10:00.000Z"
body = "Aisle 9: mexican, asian, tahini & specialty oils"
tags = ["layout"]

# Where a non-obvious item hides.
[[notes]]
created_at = "2026-06-11T18:12:00.000Z"
body = "Tahini: aisle 9, bottom shelf by the specialty oils"
tags = ["location"]

# A not-carried item (a hint, never a gate; supersede with a newer note if it changes).
[[notes]]
created_at = "2026-06-11T18:14:00.000Z"
body = "Doesn't carry harissa"
tags = ["stock"]

# Freeform observation.
[[notes]]
created_at = "2026-06-11T18:30:00.000Z"
body = "Fish counter closes at 6 PM — get seafood early."
tags = ["hours"]

[[notes]]
created_at = "2026-06-11T19:05:00.000Z"
body = "They stock the Kerrygold I like."
private = true                             # owner-only; never surfaced to the group
```

**Notes:**
- Same shape as recipe notes: `body` (required), `created_at` (required, ms-precision ISO — the addressable key for edit/delete), `tags` (optional, default `[]`), `private` (optional, default `false`). A note with no `body` is dropped on read.
- **Tag convention for layout:** `layout` (an aisle + its sections, body led by the aisle number), `location` (where a non-obvious item hides), `stock` (a not-carried entry). Untagged / other-tagged notes are freeform. The agent reads `layout` notes to order the walk; a `location` note wins over inference for that item.
- **Author-mutable.** `update_store_note(slug, created_at, …)` / `remove_store_note(slug, created_at)` edit or delete the caller's **own** notes (self-scoped by structural authorship — never another tenant's). This is the clean-correction path after a remodel. Across tenants there is no delete-the-other's-note — a reader prefers the most recent by `created_at` when two conflict.
- `read_store_notes(slug)` aggregates **non-private** notes from every member (attributed) plus the **caller's own** private notes; another member's `private` note is never surfaced. `add_store_note(slug, body, tags?, private?)` appends to the caller's subtree.

## users/<username>/ready_to_eat.toml

**Per-tenant** (a facet of the personal profile, not shared corpus — a ready-to-eat item is a Kroger SKU + "I'll eat this," pure personal taste with no shared content). One file per member; each item is tagged with a `meal` and keyed by a generated `slug`. The agent seeds it at onboarding (items the member names land `active`) and adds drafts as discovery surfaces them; the member dispositions drafts. (`variety_rules`, shown below, are a hand-maintained convention only — no tool reads, writes, or validates them.)

```toml
# users/alice/ready_to_eat.toml

[[items]]
name = "Kroger breakfast burrito (frozen)"
slug = "kroger-breakfast-burrito-frozen"   # generated from name, stable key, unique in-file
meal = "breakfast"               # breakfast | lunch | dinner
sku = null                       # reserved — no tool populates it (always written null)
category = "frozen"
status = "active"                # active | draft | rejected
rating = 4                       # optional integer 1–5
added_at = "2025-04-01"
discovered_at = null             # set only for drafts
discovery_source = null
brand = "Kroger"
notes = "Heat 90s in microwave"

[[items]]
name = "Murray's overnight oats"
slug = "murrays-overnight-oats"
meal = "breakfast"
sku = null
category = "refrigerated"
status = "draft"
added_at = "2025-05-15"
discovered_at = "2025-05-15"
discovery_source = "kroger-flyer"
brand = "Murray's"
notes = null

# variety_rules: reserved convention — hand-written only; no tool reads/writes/validates these
[variety_rules.breakfast]
max_per_category_per_week = 2
preferred_rotation_days = 3      # don't suggest the same item within N days
```

Addressed by `slug`: `update_ready_to_eat(slug, …)` dispositions or rates an item; `add_draft_ready_to_eat` appends (default `draft`, or `status: "active"` for an onboarding-named item) and returns the generated slug. `ready_to_eat_available()` reads the caller's own catalog. There is **no** `_indexes/ready_to_eat.json` — the per-member list is small and read directly. `null` fields are omitted on write (TOML has no null) and treated as absent on read. `category` is a free-form string (no controlled vocabulary), unlike the pantry `category` enum — the `"frozen"`/`"refrigerated"` values above are illustrative. Only `name`, `slug`, `meal`, `status`, and `rating` are validated; `category` / `brand` / `notes` / `added_at` / `discovered_at` / `discovery_source` / `sku` are unenforced passthrough metadata.

## stockup.toml

**Per-tenant** (`users/<username>/stockup.toml`). Bulk-buy watchlist. **Agent-writable via `update_stockup`** (add-only, deduped by normalized item `name`) as well as hand-edited; seeded at onboarding.

```toml
# stockup.toml — bulk-buy watchlist

freezer_capacity_estimate = "moderate"   # tight | moderate | spacious

[[items]]
name = "chicken thighs"
unit = "lb"
baseline_price = 3.99             # ADVISORY — see note; not a gate
buy_at_or_below = 2.99            # ADVISORY — see note; not a gate
typical_purchase = "5 lb"
notes = "Bone-in skin-on preferred"

[[items]]
name = "salmon"
unit = "lb"
typical_purchase = "2 lb"
notes = "Wild only"               # price thresholds omitted — they're optional
```

**Notes:**
- `name` is the only required item field. `freezer_capacity_estimate` is a top-level scalar (serialized before the `[[items]]` tables) and must precede them in TOML.
- **`baseline_price` / `buy_at_or_below` are advisory, not gates.** No Worker logic keys on them: `kroger_flyer(against_stockup)` scans stockup item *names* only, and "is this a good price?" is the agent reasoning over the live flyer price (and any learned baseline). They are optional — onboarding does not prompt for them, since members rarely know exact numbers.

## skus/kroger.toml (shared corpus)

Machine-maintained SKU cache, in the **shared corpus** — a mapping resolved by any member warms it for everyone. Agent appends entries (via `place_order`) as the matching pipeline runs. Each entry is **tagged with the `locationId`** it was resolved at.

```toml
# skus/kroger.toml — Kroger SKU cache (agent-maintained, shared)

[[mappings]]
ingredient = "olive oil"
sku = "0001111046025"
brand = "Simple Truth Organic"
size = "16.9 fl oz"
locationId = "01400376"          # the Kroger location this was resolved at
last_used = "2025-05-15"
reason = "preferred brand match; in stock at preferred location"
ambiguity_resolved = false       # true if this required LLM fallback in matching

[[mappings]]
ingredient = "chicken thighs"
sku = "0001111091234"
brand = "Kroger"
size = "1.5 lb pack"
locationId = "01400943"
last_used = "2025-05-14"
reason = "default brand; price-per-unit best in deterministic narrowing"
ambiguity_resolved = false
```

**This is a speed cache, not the source of truth for dispositions.** It stores *resolved SKUs* to skip the expensive search/narrowing; the *disposition* (care / don't-care / ranked) lives in each member's `preferences.toml [brands]`. **Shared + location-tagged:** an entry tagged with the caller's own location is tried first, but every hit is revalidated against the caller's `preferred_location` for current price + curbside/delivery availability before use — a cross-location entry not carried at the caller's store falls through to a fresh search, so a shared cache can never serve an unavailable SKU. No TTL; `last_used` is informational (for pruning). "Don't care" commodities (`[]` in preferences) carry no pinned SKU here; they re-resolve to cheapest-acceptable each run. (An entry with no `locationId` is treated as same-location and still revalidated.)

## taste.md

User-curated narrative. Free-form markdown. Agent edits only when directed.

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

## diet_principles.md

User-curated rules with reasoning. Free-form markdown. Agent edits only when directed.

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
