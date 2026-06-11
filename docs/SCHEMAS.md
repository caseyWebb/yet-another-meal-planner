# SCHEMAS.md — Data File Reference

Concrete schemas with example values for every data file in the repo. Keep this in sync with the actual files — when you add a field, update here first, then update the file. Validation in `scripts/build-indexes.mjs` enforces these schemas.

## File placement: shared vs per-tenant (multi-tenant data model)

The data lives in **one private data repo** with two regions (see `docs/PROJECT.md` and the `multi-tenant-friend-group` change). Every file below lives in exactly one:

- **Shared corpus (data-repo root)** — objective, single-source, read by everyone: `recipes/*.md` (objective frontmatter + body), `aliases.toml`, `ingredients.toml`, `substitutions.toml` (the shared default layer), `skus/kroger.toml`, `flyer_terms.toml`, `_indexes/`.
- **Per-tenant subtree (`users/<username>/`)** — each member's own state: `pantry.toml`, `preferences.toml`, `stockup.toml`, `grocery_list.toml`, `meal_plan.toml`, `cooking_log.toml`, `feeds.toml`, `ready_to_eat.toml` (personal heat-and-eat catalog), `taste.md`, `diet_principles.md`, **`overlay.toml`** (subjective recipe view), **`notes/<slug>.toml`** (attributed notes), an optional **`substitutions.toml`** override layer, and any personal (unshared) recipes.

**Three-category recipe model (D5):** a recipe's *content* (objective frontmatter + body) is shared; its *overlay* (`rating` + `status`) is per-tenant in `overlay.toml`; its *notes* are per-tenant, attributed, append-mostly. `last_cooked` is **not stored** — it's derived per-tenant from that member's `cooking_log.toml`. Read tools merge shared content + the caller's overlay + cooking-log `last_cooked` at read time.

## Recipe frontmatter (recipes/*.md)

YAML frontmatter at the top of each recipe markdown file. Body below is freeform markdown.

```yaml
---
title: Lemon Garlic Roasted Chicken
tags: [chicken, mediterranean, sheet-pan, weeknight]
protein: chicken                # controlled vocab: chicken | beef | pork | lamb | turkey | fish | shellfish | egg | tofu | vegetarian | vegan | mixed
cuisine: mediterranean          # controlled vocab (coarse buckets); see the cuisine list below
style: sheet-pan                # sheet-pan | one-pot | grill | braise | stir-fry | etc.
time_total: 50                  # minutes, integer
time_active: 15                 # minutes, integer
servings: 4
difficulty: easy                # easy | medium | hard
dietary: [gluten-free, dairy-free]    # array; can be empty
season: [spring, summer]              # array of seasons; can be empty for year-round
veg_forward: false              # boolean
# --- The next three are NO LONGER shared-content fields (D5). They are per-tenant ---
# last_cooked  → derived from each member's cooking_log.toml (not stored here or in the index)
# rating       → per-tenant users/<id>/overlay.toml
# status       → per-tenant users/<id>/overlay.toml (effective default: draft)
discovered_at: null             # ISO date; only set for RSS imports
discovery_source: null          # string; only set for RSS imports (e.g., "serious-eats")
ingredients_key: [chicken thighs, lemon, garlic, oregano, potatoes]
meal_preppable: true            # boolean; good freezer/batch candidate
uses_components: []             # array of slugs; what other recipes' outputs this consumes
produces_components: []         # array of slugs; what other recipes can build on
pairs_with: []                  # array of recipe slugs; plate-companion sides (a PLATING edge)
standalone: true                # optional boolean; OMIT unless the dish is an already-rounded plate
source: https://www.seriouseats.com/lemon-garlic-roasted-chicken
---

[recipe instructions in markdown]
```

**Notes:**
- `rating`, `status`, and `last_cooked` are **per-tenant**, not shared content (D5) — they live in `overlay.toml` (rating/status) or are derived from `cooking_log.toml` (last_cooked), and the shared `_indexes/recipes.json` carries objective fields only. A shared recipe's frontmatter SHOULD NOT carry them; the build strips them and treats `status` as optional. `update_recipe` routes a `rating`/`status` edit to the caller's overlay, never the shared file.
- `status` lifecycle (now per-tenant): new imports default to effective `draft`. A member's feedback promotes to `active` (with rating) or rejects to `rejected` **in their own overlay** — one member's disposition never changes another's.
- `uses_components` / `produces_components`: slugs of other recipes, optional. A *production* edge (cook a component once, reuse its output across the week). Used by `suggest_sequencing`.
- `pairs_with`: slugs of other recipes, optional (defaults to empty). A *plating* edge — recipes eaten together on one plate (a main's companion sides) — distinct from the `uses_components`/`produces_components` production edges. Each slug MUST resolve to a real recipe (a build hard-failure otherwise, like an unresolved component reference); sides are themselves recipes, so they reuse the normal verify/import/grocery-list pipeline. Objective **shared content** (carried in `_indexes/recipes.json`, written by `update_recipe`) — not a per-tenant overlay field. Grown lazily by the meal-plan flow as pairings are confirmed; the bootstrap selects sides by plate fit and does NOT traverse the component graph (bidirectional component sequencing stays with `suggest_sequencing`).
- `standalone`: optional boolean (defaults **unset**, never backfilled). Marks an already-rounded one-pot/inclusive plate so the planner won't prompt for a side. Must be a boolean when present (a build hard-failure otherwise). When unset, the agent infers at plan time whether the dish stands alone and offers to persist its verdict. Objective **shared content**, written by `update_recipe` — not a per-tenant overlay field.
- `protein` and `cuisine` are **controlled vocabularies** (coarse buckets — `fish` not `salmon`) so variety reasoning is reliable. A value **present** but outside its set is a hard build failure; **absence** keeps the warn-only treatment. Extending a vocabulary is a deliberate edit to the allowed sets in `scripts/build-indexes.mjs`. Current cuisine set: `american, brazilian, cajun, caribbean, chinese, cuban, filipino, french, german, greek, indian, italian, japanese, korean, mediterranean, mexican, moroccan, southwestern, spanish, thai, vietnamese`.
- `ingredients_key`: top 5–7 ingredients for filtering. Full ingredient list lives in the body.

### Recipe body structural contract

The markdown body below the frontmatter is freeform, with one **hard requirement**: it MUST contain both an `## Ingredients` H2 section and an `## Instructions` H2 section (exact labels, ATX `##` headings). Validation in `scripts/build-indexes.mjs` fails the build (non-zero exit) and names the offending file and missing section if either is absent.

- **Ingredients** is conventionally a `-` bullet list; **Instructions** a numbered list. Site generation renders them as `<ul>` and `<ol>` respectively.
- Additional H2 sections (e.g. `## Notes`) are permitted and render generically — no validator or generator change is needed to add one.
- The contract exists so downstream site generation (`scripts/build-site.mjs`) can reliably locate the ingredient list (to inject checkboxes) and the step list (for numbering + read-aloud) without guessing.

## users/&lt;username&gt;/overlay.toml (per-tenant)

Each member's **subjective view** of shared recipes — the overlay merged onto shared content at read time (D5). Keyed by recipe slug. Holds **only** `rating` + `status` (the two genuinely-subjective single-values). `last_cooked` is **not** here — it's derived from this member's `cooking_log.toml`. Agent-writable side-effect file; an absent row means effective `status: draft` for that member.

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

A member's **attributed notes** on one recipe (shared or personal) — the spin-capture mechanism (D6). One file per recipe slug, `[[notes]]` array, append-mostly. **Author is structural** — it's the `users/<id>/` path the file lives under, never a field (unspoofable). Adding a note never modifies shared content or prior notes.

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
- `read_recipe_notes(slug)` aggregates **non-private** notes from every member (attributed) plus the **caller's own** private notes; another member's `private` note is never surfaced. Group ratings (from each `overlay.toml`) ride the same read.

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

## grocery_list.toml

The buy list — committed intent for the next order. Ingredient/product-level and **SKU-free**: resolution to a Kroger SKU happens once, at order time (Change 06b), against current availability, so the list never pins a brand/SKU that could go stale between capture and order. Agent-writable side-effect file (NOT user-curated config). Distinct from `pantry.toml` (observation: what's in the kitchen) and `stockup.toml` (conditional intent: buy IF on sale). Items are keyed by normalized `name` — re-adding an existing name merges rather than duplicating.

```toml
# grocery_list.toml

[[items]]
name = "extra virgin olive oil"   # order-time search term (required)
quantity = "1 bottle"             # loose BUY amount: count | "1 bottle" | "enough for the week"
kind = "grocery"                  # grocery | household | other
status = "active"                 # active | in_cart | ordered  (required)
source = "pantry_low"             # ad_hoc | menu | pantry_low | stockup
for_recipes = []                  # recipe slugs needing it (menu-derived)
note = "the fancy one this time"  # freeform: one-off brand request, occasion, or null
added_at = "2026-06-09"           # ISO date (required)
ordered_at = null                 # ISO date set when status -> ordered; else null

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
- `source` carries provenance for order-time dedup/behavior: `pantry_low`/`stockup` were promoted (don't re-prompt); `menu` aggregates with recipe needs; `ad_hoc` is a one-off.
- `note` holds a **one-off** brand request ("the fancy olive oil this time") — explicitly NOT `preferences.toml`, which is for standing dispositions.
- Lifecycle: `active → in_cart → ordered → received`. `received` is terminal (entry removed + pantry restocked). The transitions past `active` arrive with order placement in Change 06b.

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
recipe = "arroz-caldo"        # slug (required)
planned_for = "2026-06-10"    # ISO date the cook is slated for (optional)
```

**Notes:**
- The session-start stale-planned reconcile surfaces only **due** rows — `planned_for` on or before today, or unset — and leaves future-dated plans alone.
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
primary = "Kroger"
preferred_location = "Kroger - 76104"   # resolved to a Kroger locationId, then used
                                        # for pricing + curbside/delivery availability

[dietary]
avoid = []                       # ingredients to always exclude
limit = ["cilantro"]             # ingredients to deprioritize but not reject
```

**`[brands]` is tri-state and drives matching confidence.** The Kroger matching pipeline reads a key's *presence* as the confidence signal: absent → ambiguous (Claude asks); `[]` → "don't care," pick cheapest acceptable without asking; a non-empty list → ranked preference, **list order is rank**. Keys are the canonical normalized ingredient term with spaces as underscores (`extra virgin olive oil` → normalize via aliases.toml → `olive oil` → key `olive_oil`). A non-empty list whose brands are all unavailable falls back to ambiguous.

## substitutions.toml

User-curated. Agent edits only when directed. **Shared with a per-tenant override layer (§7.2):** the shared corpus `substitutions.toml` (root) is the default for everyone; a member MAY carry a personal `users/<id>/substitutions.toml` with the same schema. At read time the two are joined and a personal rule **replaces** the shared rule for that same (alias-normalized) ingredient — for that member only. Override-only ingredients are added; shared rules with no override carry through.

```toml
# substitutions.toml — standing substitution rules

[[rules]]
ingredient = "salmon"
acceptable_substitutes = ["trout", "arctic char", "mahi mahi"]
unacceptable_substitutes = ["tilapia"]   # explicit no-go
notes = "Prefer wild over farmed for any of these"

[[rules]]
ingredient = "olive oil"
acceptable_substitutes = ["extra virgin olive oil"]
unacceptable_substitutes = ["vegetable oil", "canola oil"]

[[rules]]
ingredient = "mascarpone"
acceptable_substitutes = []      # no acceptable substitute — flag and ask
notes = "If unavailable, ask before falling back"
```

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
- The public Kroger API has no flyer/circular endpoint. `kroger_flyer` synthesizes a sale list by searching terms and keeping products where `promo > 0`. These **broad** terms supplement the **precise** terms derived from caller context (current menu ingredients, `stockup.toml`, substitution candidates), widening the net past the known-items list.
- A flat top-level `terms` array of strings. **Absent or empty degrades gracefully**: `kroger_flyer` still scans the precise context terms and returns a (smaller) sale list rather than erroring.
- Each term is scanned a few pages deep, but the scan is **relevance**-ranked (no sort-by-discount), so it samples the head of each category — deep sales on low-relevance items can be missed. This limitation is documented, not hidden.

## feeds.toml

User-curated. RSS feed URLs and tags.

```toml
# feeds.toml — RSS feeds for recipe discovery

[[feeds]]
url = "https://www.seriouseats.com/recipes/atom.xml"
name = "Serious Eats"
tags = [trusted, technique-focused]
weight = 1.0

[[feeds]]
url = "https://www.budgetbytes.com/feed/"
name = "Budget Bytes"
tags = [weeknight, approachable]
weight = 0.8

[[feeds]]
url = "https://www.bonappetit.com/feed/rss"
name = "Bon Appétit"
tags = [aspirational, trend-aware]
weight = 0.7
```

## ingredients.toml (Phase 7)

RESERVED for Phase 7. Empty in v1. Will hold perishability metadata for cross-recipe waste optimization.

```toml
# ingredients.toml — RESERVED for Phase 7; empty in v1

[[ingredients]]
name = "basil"
shelf_life_days_fridge = 7
shelf_life_days_freezer = 180
typical_unit = "bunch"
perishability_class = "very_perishable"

[[ingredients]]
name = "olive oil"
shelf_life_days_fridge = null    # shelf-stable
shelf_life_days_freezer = null
typical_unit = "bottle"
perishability_class = "shelf_stable"
```

## users/<username>/ready_to_eat.toml

**Per-tenant** (a facet of the personal profile, not shared corpus — a ready-to-eat item is a Kroger SKU + "I'll eat this," pure personal taste with no shared content). One file per member; each item is tagged with a `meal` and keyed by a generated `slug`. The agent seeds it at onboarding (items the member names land `active`) and adds drafts as discovery surfaces them; the member dispositions drafts. `variety_rules` are expressed per meal.

```toml
# users/alice/ready_to_eat.toml

[[items]]
name = "Kroger breakfast burrito (frozen)"
slug = "kroger-breakfast-burrito-frozen"   # generated from name, stable key, unique in-file
meal = "breakfast"               # breakfast | lunch | dinner
sku = null                       # populated after first cart write
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

[variety_rules.breakfast]
max_per_category_per_week = 2
preferred_rotation_days = 3      # don't suggest the same item within N days
```

Addressed by `slug`: `update_ready_to_eat(slug, …)` dispositions or rates an item; `add_draft_ready_to_eat` appends (default `draft`, or `status: "active"` for an onboarding-named item) and returns the generated slug. `ready_to_eat_available()` reads the caller's own catalog. There is **no** `_indexes/ready_to_eat.json` — the per-member list is small and read directly. `null` fields are omitted on write (TOML has no null) and treated as absent on read.

## stockup.toml

Bulk-buy watchlist with baseline prices.

```toml
# stockup.toml — bulk-buy watchlist

freezer_capacity_estimate = "moderate"   # tight | moderate | spacious

[[items]]
name = "chicken thighs"
unit = "lb"
baseline_price = 3.99
buy_at_or_below = 2.99
typical_purchase = "5 lb"
notes = "Bone-in skin-on preferred"

[[items]]
name = "salmon"
unit = "lb"
baseline_price = 12.99
buy_at_or_below = 9.99
typical_purchase = "2 lb"
notes = "Wild only"
```

## skus/kroger.toml (shared corpus)

Machine-maintained SKU cache, in the **shared corpus** (D7/§7.1) — a mapping resolved by any member warms it for everyone. Agent appends entries (via `place_order`) as the matching pipeline runs. Each entry is **tagged with the `locationId`** it was resolved at.

```toml
# skus/kroger.toml — Kroger SKU cache (agent-maintained, shared)

[[mappings]]
ingredient = "olive oil"
sku = "0001111046025"
brand = "Simple Truth Organic"
size = "16.9 fl oz"
locationId = "01400376"          # the Kroger location this was resolved at (D7)
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

**This is a speed cache, not the source of truth for dispositions.** It stores *resolved SKUs* to skip the expensive search/narrowing; the *disposition* (care / don't-care / ranked) lives in each member's `preferences.toml [brands]`. **Shared + location-tagged:** an entry tagged with the caller's own location is tried first, but every hit is revalidated against the caller's `preferred_location` for current price + curbside/delivery availability before use — a cross-location entry not carried at the caller's store falls through to a fresh search, so a shared cache can never serve an unavailable SKU. No TTL; `last_used` is informational (for pruning). "Don't care" commodities (`[]` in preferences) carry no pinned SKU here; they re-resolve to cheapest-acceptable each run. (`locationId` is absent on legacy entries written before §7.1 — those are treated as same-location and still revalidated.)

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
