# TOOLS.md — MCP Tool Inventory

The complete tool surface exposed by `grocery-mcp` to Claude. Each tool encodes a deterministic operation. The LLM composes them; the tools enforce the pipelines.

## Design philosophy

**Coarse and opinionated.** Tools wrap multi-step deterministic logic so the LLM doesn't have to orchestrate every step. `match_ingredient_to_kroger_sku` runs the full 7-step matching pipeline internally; the LLM doesn't construct Kroger queries directly.

**Structured output via JSON.** Every tool returns structured data. The LLM reasons over the result; it doesn't parse free text.

**Honest about ambiguity.** When deterministic narrowing leaves multiple options (e.g., 3 brands of olive oil all match equally), tools return `ambiguous: true` with candidates. The LLM either picks based on context or asks the user. Tools don't silently pick.

**No raw building blocks exposed.** No `kroger_raw_search`, no `github_raw_write`, no `cart_add_by_name`. These would let the LLM bypass the deterministic pipelines.

---

## Recipe tools

### `list_recipes(filters)`

List recipes matching filters. Reads from `_indexes/recipes.json` (single API call).

**Params:**
- `filters` (object, optional): `{ status?, protein?, cuisine?, tags?, season?, dietary?, max_time_total?, not_cooked_since?, exclude_recently_cooked? }`

**Returns:**
- `{ recipes: [{ slug, title, frontmatter }] }` — array of matched recipes with frontmatter

**Notes:** Default `status: active`. Use `status: draft` to see discoveries awaiting disposition.

### `read_recipe(slug)`

Read a single recipe's full content (frontmatter + body).

**Params:**
- `slug` (string, required)

**Returns:**
- `{ slug, frontmatter, body, last_modified }`

### `update_recipe(slug, updates)`

Update recipe frontmatter fields. Use for `last_cooked`, `rating`, `status` transitions, and any other frontmatter edits the user has directed.

**Params:**
- `slug` (string, required)
- `updates` (object): partial frontmatter to merge

**Returns:**
- `{ slug, updated_fields }` — confirmation of what was changed

**Notes:** Side-effect updates (last_cooked, rating, status) happen during normal flow. Other frontmatter edits require user direction.

### `import_recipe(url)`

Parse a URL via JSON-LD and create a draft recipe in `recipes/`.

**Params:**
- `url` (string, required)

**Returns:**
- `{ slug, frontmatter }` — the imported recipe with `status: draft`

**Notes:** Always imports in draft state. User dispositions later via `update_recipe`.

---

## Pantry tools

### `read_pantry(filter)`

Read pantry items, optionally filtered.

**Params:**
- `filter` (object, optional): `{ category?, prepared_only?, stale_only? }`

**Returns:**
- `{ items: [...] }` — array of pantry items per schema

### `verify_pantry_for_recipe(slug)`

Walk all ingredients in the named recipe against pantry. Surface what's there, what's stale, what substitutes are available in inventory.

**Params:**
- `slug` (string, required)

**Returns:**
```
{
  have_fresh: [...items],
  have_stale: [...items],     // questions for the user about freshness
  inventory_substitutes_available: [...{ recipe_calls_for, available_substitute }],
  not_in_pantry: [...ingredients]    // to-buy list
}
```

### `verify_pantry_for_candidates(slugs)`

Same as above but for multiple candidate recipes (for open-ended menu requests). Aggregates the picture.

**Params:**
- `slugs` (array of strings, required)

**Returns:** Same shape as above, aggregated.

### `update_pantry(operations)`

Apply pantry updates from conversational messages.

**Params:**
- `operations` (array): `[{ op: "add" | "remove" | "verify", item: ..., ... }]`

**Returns:**
- `{ applied: [...], conflicts: [...] }`

**Notes:** Conflicts surface when remove targets aren't found. The agent should ask the user how to resolve.

### `mark_pantry_verified(items)`

Reset `last_verified_at` on confirmed items.

**Params:**
- `items` (array of names or slugs)

**Returns:**
- `{ updated: [...] }`

---

## Kroger tools

### `kroger_flyer(filter)`

Get this week's Kroger sale items, optionally filtered.

**Params:**
- `filter` (object, optional): `{ against_stockup?, against_substitutions?, categories? }`

**Returns:**
- `{ items: [{ sku, name, regular_price, sale_price, category, notes }] }`

### `kroger_prices(ingredients)`

Get current prices for a specific list of ingredients (used for menu pre-pass).

**Params:**
- `ingredients` (array of strings)

**Returns:**
- `{ prices: [{ ingredient, sku, price, in_stock, on_sale }] }`

### `match_ingredient_to_kroger_sku(ingredient, context)`

Run the full 7-step matching pipeline. Returns either a confident match or narrowed candidates for the LLM to choose from.

**Params:**
- `ingredient` (string, required)
- `context` (object, optional): `{ recipe_slug, dietary, quantity_hint }`

**Returns (confident match):**
```
{
  resolved: true,
  sku: "0001111046025",
  brand: "Simple Truth Organic",
  size: "16.9 fl oz",
  price: 8.99,
  reason: "cache hit" | "preferred brand match" | etc.
}
```

**Returns (ambiguous):**
```
{
  resolved: false,
  ambiguous: true,
  candidates: [{ sku, brand, size, price, ... }],
  reason: "multiple equivalent matches after deterministic narrowing"
}
```

**Notes:** When ambiguous, the LLM picks based on conversational context or asks the user. The result feeds back into the cache.

### `ready_to_eat_available()`

Cross-reference `ready_to_eat/*.toml` catalogs against current Kroger availability.

**Returns:**
- `{ available: { breakfast: [...], lunch: [...], dinner: [...] }, unavailable: [...] }`

---

## Substitution tools

### `propose_substitutions(ingredient, mode)`

Apply `substitutions.toml` rules to surface acceptable alternatives.

**Params:**
- `ingredient` (string, required)
- `mode` (string, required): `"inventory"` (substitutes available in pantry) or `"sale"` (substitutes on sale at Kroger)

**Returns:**
- `{ substitutes: [...], unacceptable: [...] }`

**Notes:** Tool applies rules deterministically; LLM presents result to user for confirmation.

---

## Sequencing tools

### `suggest_sequencing(seed_recipes)`

Walk `produces_components` / `uses_components` references to find recipe pairings.

**Params:**
- `seed_recipes` (array of slugs, required)

**Returns:**
- `{ suggestions: [{ recipe_to_add, reason, shared_component }] }`

**Notes:** Conservative — only returns strong matches. Empty array if nothing fits.

---

## Discovery tools

### `fetch_rss_discoveries()`

Read all configured RSS feeds, score candidates against taste profile, return top 1-2.

**Returns:**
- `{ candidates: [{ url, title, score, source, summary }] }`

### `fetch_flyer_featured()`

Inspect this week's Kroger flyer for featured / promoted ready-to-eat items not yet in catalogs.

**Returns:**
- `{ candidates: [{ name, sku, category, sale_price, suggested_meal }] }`

### `add_draft_ready_to_eat(items)`

Append new ready-to-eat items to the appropriate catalog in `draft` status.

**Params:**
- `items` (array): `[{ name, category, source, ... }]`

**Returns:**
- `{ added: [...] }`

### `update_ready_to_eat(slug, updates)`

Disposition or otherwise update a ready-to-eat item.

**Params:**
- `slug` (string, required) — or `name` if no slug yet
- `updates` (object): `{ status?, rating?, notes? }`

**Returns:**
- `{ updated_fields }`

---

## Preference / config tools (read-only by default)

### `read_preferences()`

Return parsed `preferences.toml`.

### `read_taste()`

Return contents of `taste.md`.

### `read_diet_principles()`

Return contents of `diet_principles.md`.

### `update_preferences(updates)` / `update_taste(content)` / `update_diet_principles(content)` / `update_substitutions(rules)` / `update_aliases(mappings)`

Write to user-curated files. **These should only be called when the user explicitly directs an edit.** The tools exist; the discipline of when to call them lives in CLAUDE.md.

---

## Retrospective / analysis tools

### `retrospective(period)`

Aggregate cooking history over a period.

**Params:**
- `period` (string): `"30d"` | `"month"` | `"quarter"` | etc.

**Returns:**
- `{ recipes_cooked: [...], protein_mix: {...}, cuisine_mix: {...}, underused: [...] }`

### `inventory_hypothetical(items)`

Speculative menu re-evaluation with hypothetical pantry additions.

**Params:**
- `items` (array): pantry items to add in-memory only

**Returns:**
- `{ would_improve_week: bool, suggested_changes: [...], notes: string }`

**Notes:** Does not persist anything. Used for "is this market haul worth grabbing?" reasoning.

---

## Commit / atomic operations

### `write_cart_and_commit(payload)`

Atomic batched operation that does everything at conversation end:
- Writes the Kroger cart
- Updates `last_cooked` on selected recipes
- Marks pantry items verified
- Imports any draft recipes from discovery
- Adds any draft ready-to-eat items
- Appends new SKU mappings to cache
- Creates a single git commit summarizing the session

**Params:**
```
{
  cart_items: [{ sku, quantity }],
  recipes_cooked: [slug, slug, ...],
  pantry_verified: [item, item, ...],
  draft_recipes: [{ url, frontmatter }],
  draft_ready_to_eat: [{ name, category }],
  sku_mappings: [{ ingredient, sku, reason }],
  commit_message: string
}
```

**Returns:**
- `{ commit_sha, cart_summary, items_added }`

**Notes:** This is the *only* tool that writes to Kroger. Single point of cart-write enforcement. Single commit per session keeps git log clean.

### `commit_changes(payload)`

For non-cart updates that still need to be persisted (e.g., pantry update from "I ran out of milk" outside menu context). Same atomic-commit pattern, no cart write.

**Params:**
```
{
  pantry_updates: [...],
  recipe_updates: [...],
  ready_to_eat_updates: [...],
  config_updates: [...],   // for user-curated files when user has directed an edit
  commit_message: string
}
```

**Returns:**
- `{ commit_sha, summary }`

---

## What this surface deliberately does NOT include

- No raw GitHub write access (atomic commits only)
- No raw Kroger API access (matching pipeline + cart write only)
- No "search arbitrary text across recipes" (use GitHub MCP for that)
- No "execute arbitrary code" or "run arbitrary script"
- No portion math (no whiteboard problem)
- No background or scheduled triggers
