# SCHEMAS.md — Data File Reference

Concrete schemas with example values for every data file in the repo. Keep this in sync with the actual files — when you add a field, update here first, then update the file. Validation in `scripts/build-indexes.mjs` enforces these schemas.

## Recipe frontmatter (recipes/*.md)

YAML frontmatter at the top of each recipe markdown file. Body below is freeform markdown.

```yaml
---
title: Lemon Garlic Roasted Chicken
tags: [chicken, mediterranean, sheet-pan, weeknight]
protein: chicken                # chicken | beef | pork | lamb | fish | shellfish | vegetarian | vegan | mixed
cuisine: mediterranean
style: sheet-pan                # sheet-pan | one-pot | grill | braise | stir-fry | etc.
time_total: 50                  # minutes, integer
time_active: 15                 # minutes, integer
servings: 4
difficulty: easy                # easy | medium | hard
dietary: [gluten-free, dairy-free]    # array; can be empty
season: [spring, summer]              # array of seasons; can be empty for year-round
veg_forward: false              # boolean
last_cooked: 2025-04-15         # ISO date; null if never cooked
rating: 4                       # 1-5 integer; null if unrated
status: active                  # active | draft | rejected | archived
discovered_at: null             # ISO date; only set for RSS imports
discovery_source: null          # string; only set for RSS imports (e.g., "serious-eats")
ingredients_key: [chicken thighs, lemon, garlic, oregano, potatoes]
meal_preppable: true            # boolean; good freezer/batch candidate
uses_components: []             # array of slugs; what other recipes' outputs this consumes
produces_components: []         # array of slugs; what other recipes can build on
source: https://www.seriouseats.com/lemon-garlic-roasted-chicken
---

[recipe instructions in markdown]
```

**Notes:**
- `status` lifecycle: new RSS imports default to `draft`. User feedback promotes to `active` (with rating) or rejects to `rejected`. Drafts past ~6 months get archived (Phase 5).
- `uses_components` / `produces_components`: slugs of other recipes, optional. Used by `suggest_sequencing`.
- `ingredients_key`: top 5–7 ingredients for filtering. Full ingredient list lives in the body.

### Recipe body structural contract

The markdown body below the frontmatter is freeform, with one **hard requirement**: it MUST contain both an `## Ingredients` H2 section and an `## Instructions` H2 section (exact labels, ATX `##` headings). Validation in `scripts/build-indexes.mjs` fails the build (non-zero exit) and names the offending file and missing section if either is absent.

- **Ingredients** is conventionally a `-` bullet list; **Instructions** a numbered list. Site generation renders them as `<ul>` and `<ol>` respectively.
- Additional H2 sections (e.g. `## Notes`) are permitted and render generically — no validator or generator change is needed to add one.
- The contract exists so downstream site generation (`scripts/build-site.mjs`) can reliably locate the ingredient list (to inject checkboxes) and the step list (for numbering + read-aloud) without guessing.

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

## preferences.toml

User-curated. Agent edits only when explicitly directed.

```toml
# preferences.toml — standing preferences

default_cooking_nights = 3
lunch_strategy = "leftovers"     # leftovers | buy | mixed
ready_to_eat_default_action = "opt-in"   # opt-in | auto-add

[brands]
olive_oil = ["California Olive Ranch", "Cobram Estate"]
butter = ["Kerrygold", "Plugra"]
yogurt = ["Fage", "Siggi's"]

[stores]
primary = "Kroger"
preferred_location = "Kroger - 76104"   # for in-stock filtering

[dietary]
avoid = []                       # ingredients to always exclude
limit = ["cilantro"]             # ingredients to deprioritize but not reject
```

## substitutions.toml

User-curated. Agent edits only when directed.

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

## ready_to_eat/breakfast.toml (and lunch.toml, dinner.toml)

Catalogs of acceptable ready-to-eat options per meal. Agent adds drafts as discovery surfaces them; user dispositions.

```toml
# ready_to_eat/breakfast.toml

[[items]]
name = "Kroger breakfast burrito (frozen)"
sku = null                       # populated after first cart write
category = "frozen"
status = "active"                # active | draft | rejected
added_at = "2025-04-01"
discovered_at = null             # set only for drafts
discovery_source = null
brand = "Kroger"
notes = "Heat 90s in microwave"

[[items]]
name = "Murray's overnight oats"
sku = null
category = "refrigerated"
status = "draft"
added_at = "2025-05-15"
discovered_at = "2025-05-15"
discovery_source = "kroger-flyer-featured"
brand = "Murray's"
notes = null

[variety_rules]
max_per_category_per_week = 2
preferred_rotation_days = 3      # don't suggest the same item within N days
```

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

## skus/kroger.toml

Machine-maintained SKU cache. Agent appends entries as the matching pipeline runs.

```toml
# skus/kroger.toml — Kroger SKU cache (agent-maintained)

[[mappings]]
ingredient = "olive oil"
sku = "0001111046025"
brand = "Simple Truth Organic"
size = "16.9 fl oz"
last_used = "2025-05-15"
reason = "preferred brand match; in stock at preferred location"
ambiguity_resolved = false       # true if this required LLM fallback in matching

[[mappings]]
ingredient = "chicken thighs"
sku = "0001111091234"
brand = "Kroger"
size = "1.5 lb pack"
last_used = "2025-05-14"
reason = "default brand; price-per-unit best in deterministic narrowing"
ambiguity_resolved = false
```

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
