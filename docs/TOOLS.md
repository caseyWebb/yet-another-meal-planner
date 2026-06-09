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
- `filters` (object, optional): `{ status?, protein?, cuisine?, query?, tags?, season?, dietary?, max_time_total?, not_cooked_since?, exclude_cooked_within_days? }`

**Returns:**
- `{ recipes: [{ slug, title, frontmatter }] }` — array of matched recipes with frontmatter

**Notes:**
- Default `status: active`. Use `status: draft` to see discoveries awaiting disposition, or `status: "all"` to opt out of status filtering entirely.
- Array filters (`tags`, `dietary`, `season`) match **all** listed values (AND/narrowing).
- `query` (string): free-text filter. Keeps a recipe when **every** whitespace-separated token is a case-insensitive substring of its `title` or any `tag` (token-AND). Deterministic membership only — no ranking, scoring, or fuzzy matching. Use it to surface a named dish ("chicken rice") without silently missing an exact-title match. ANDed with the other filters; absent/empty `query` is a no-op.
- `exclude_cooked_within_days` (number): drop recipes cooked within the last N days. Caller-supplied window, not a stored default.
- `not_cooked_since` (date): recipes with `last_cooked: null` (never cooked) **pass** this filter.

### `read_recipe(slug)`

Read a single recipe's full content (frontmatter + body).

**Params:**
- `slug` (string, required)

**Returns:**
- `{ slug, frontmatter, body }`

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

**Notes:** `category` and `prepared_only` are deterministic from pantry data. `stale_only` depends on shelf-life thresholds from `ingredients.toml`, which doesn't exist until Change 12 — until then it returns a structured `{ error: "unsupported" }` rather than guessing.

### `verify_pantry_for_recipe(slug)`

Parse the named recipe's `## Ingredients` and walk each against the pantry. Returns **facts, not freshness verdicts** — the tool reports what's present and surfaces age metadata; the agent decides which items warrant a "still good?" prompt (resolved via `mark_pantry_verified`). The tool never classifies items as fresh/stale (it has no shelf-life data and freshness depends on storage, not age) and never guesses ambiguous matches.

**Params:**
- `slug` (string, required)

**Returns:**
```
{
  in_pantry: [...{                  // exact normalized match — confident
    recipe_calls_for,               // parsed ingredient name
    pantry_item,                    // matched pantry entry name
    added_at, last_verified_at,
    days_since_verified,            // for the agent's freshness-prompt judgment
    category,                       // when present on the pantry item
    prepared_from                   // slug if a cooked/prepared leftover
  }],
  possible_matches: [...{           // fuzzy/token-overlap candidate — AGENT CONFIRMS
    recipe_calls_for,
    candidate_pantry_item           // confirm → treat as in_pantry (and suggest an aliases.toml entry)
  }],
  not_in_pantry: [...{ ingredient }],  // no candidate at all → to-buy list (presence-driven, never quantity-netted)
  optional: [...ingredients],       // names of parsed "(optional ...)" ingredients — non-blocking; ask before adding to order
  inventory_substitutes_available: [...{ recipe_calls_for, available_substitute }]  // ∅ until substitutions.toml seeded
}
```

**Notes:** No `have_stale` bucket — freshness is an agent judgment over the surfaced age metadata, not a tool output. Matching is exact for `in_pantry`; anything inexact goes to `possible_matches` for the agent to confirm or reject (no silent false-misses, no silent false-positives). `inventory_substitutes_available` applies `substitutions.toml` rules and is empty until rules are seeded. Change 12 may later add a `past_typical_fresh_life` hint per item (from `ingredients.toml`) without changing this shape.

### `verify_pantry_for_candidates(slugs)`

Same as above but for multiple candidate recipes (for open-ended menu requests). Aggregates the picture, deduped by parsed ingredient name.

**Params:**
- `slugs` (array of strings, required)

**Returns:** Same shape as above, aggregated. Each `not_in_pantry`, `possible_matches`, and `inventory_substitutes_available` entry additionally carries `for_recipes: [...slugs]` — the candidate recipe(s) that need it — mirroring `grocery_list.toml`'s attribution and what `place_order` consumes.

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
- `{ verified: [...], conflicts: [...] }` — conflicts name items not found in the pantry

---

## Grocery list tools

The grocery list (`grocery_list.toml`) is the SKU-free buy list for the next order. It accumulates intent across the week; resolution to a Kroger SKU and the cart write are deferred to order placement (`place_order`, Change 06b). See `docs/SCHEMAS.md` for the item schema.

### `read_grocery_list()`

Return the current buy list.

**Returns:**
- `{ items: [...] }`

### `add_to_grocery_list(item)`

Add an item (ingredient/product level, no SKU). Keyed by normalized `name` — re-adding an existing name **merges** (union `for_recipes`, reconcile `quantity`) rather than duplicating. New items start `status: "active"`.

**Params:**
- `name` (string, required)
- `quantity` (string, optional) — loose buy amount; defaults to `"1"`
- `kind` (optional): `grocery | household | other`
- `source` (optional): `ad_hoc | menu | pantry_low | stockup`
- `for_recipes` (array of slugs, optional)
- `note` (string or null, optional) — one-off brand request / occasion

**Returns:**
- `{ item, merged, commit_sha }`

### `update_grocery_list(name, ...patch)`

Patch an existing item by name (`quantity`, `kind`, `status`, `source`, `for_recipes`, `note`).

**Returns:**
- `{ item, commit_sha }` — `not_found` if no such item

### `remove_from_grocery_list(name)`

Remove an item by name.

**Returns:**
- `{ removed: bool, commit_sha? }`

**Notes:** Promoting a low/out pantry item onto the list is a **prompted** decision (record `source: "pantry_low"`), never automatic. The lifecycle past `active` (`in_cart` → `ordered` → `received`) is driven by `place_order` and the user-asserted transitions — see [`place_order`](#place_orderpayload) below.

---

## Kroger tools

### `kroger_flyer(filter)`

Synthesized sale scan — the public API has **no** flyer/circular endpoint, so this searches terms and keeps products where `promo > 0`, deduped by `productId`. Scans **precise** terms (caller-passed plus stockup/substitution candidates) and **broad** curated terms from `flyer_terms.toml`. Explicitly **non-exhaustive**: each term returns a relevance-ranked page (no sort-by-discount), so it samples the head of each category.

**Params:**
- `filter` (object, optional): `{ terms?, against_stockup?, against_substitutions? }`
  - `terms` (array of strings): precise context terms (current menu ingredients, etc.).
  - `against_stockup` (boolean): also scan `stockup.toml` item names.
  - `against_substitutions` (boolean): also scan `substitutions.toml` ingredients + their acceptable substitutes.

**Returns:**
- `{ items: [{ sku, brand, description, size, price: { regular, promo }, savings, categories, matched_term }] }`

**Notes:** Degrades gracefully when `flyer_terms.toml` is absent/empty — still scans the precise terms and returns a smaller list. Each term is paginated a couple of pages deep.

### `kroger_prices(ingredients)`

Get current prices for a specific list of ingredients (used for menu pre-pass). Takes the top relevant fulfillable product per term.

**Params:**
- `ingredients` (array of strings)

**Returns:**
- `{ prices: [{ ingredient, sku, brand, size, price: { regular, promo }, on_sale, available: { curbside, delivery } }] }`

**Notes:** `price` is `{ regular, promo }` (`promo: 0` = not on sale); `available` reflects curbside/delivery fulfillment at the preferred location — the public API exposes no live in-store stock. When no product matches a term, that entry is `{ ingredient, sku: null, available: { curbside: false, delivery: false } }`.

### `match_ingredient_to_kroger_sku(ingredient, context)`

Run the full 7-step matching pipeline. Returns a confident match, narrowed candidates for the LLM to choose from, or an `unavailable` signal. **Resolve-only** — it does not write the cache (that rides `place_order`, Change 06b) and it does not substitute (that's `propose_substitutions`).

**Params:**
- `ingredient` (string, required)
- `context` (object, optional): `{ recipe_slug, dietary, quantity_hint }`
- `bypass_cache` (boolean, optional): force re-resolution, skipping the cache hit — for when a cached SKU doesn't fit the recipe context (cached generic, recipe wants organic).

**Confidence rule:** confident when a cache hit OR a defined `preferences.toml [brands]` entry resolves it (including `[]` = "don't care, cheapest acceptable"); otherwise ambiguous. Cache hits are revalidated for current price + curbside/delivery availability before being returned.

**Returns (confident match):**
```
{
  resolved: true,
  sku: "0001111046025",
  brand: "Simple Truth Organic",
  size: "16.9 fl oz",
  price: { regular: 8.99, promo: 0 },
  on_sale: false,
  reason: "cache hit" | "preferred brand match" | "don't-care: cheapest acceptable" | etc.
}
```

**Returns (ambiguous):**
```
{
  resolved: false,
  ambiguous: true,
  candidates: [{ sku, brand, size, price: { regular, promo }, on_sale, unit_price?, fulfillment: { curbside, delivery } }],
  reason: "no brand preference defined; choose or say 'don't care'"
}
```

**Returns (unavailable):**
```
{
  resolved: false,
  reason: "unavailable",
  message: "No candidate is fulfillable via curbside/delivery at the preferred location."
}
```

**Notes:** When ambiguous, the LLM picks from conversational context or asks the user; a standing "don't care" answer is recorded as `[]` in `preferences.toml [brands]`. On `unavailable`, the LLM may call `propose_substitutions` (which surfaces alternatives for confirmation) — the matcher never substitutes itself. All resolutions feed back into the cache via the next batched commit.

### `compare_unit_price(items)`

Deterministic price-per-unit comparison, used by the matching tiebreaker and when presenting ambiguous candidates. **The LLM never does the arithmetic** — it forwards raw `price` + `size` strings; the tool parses, converts units, and ranks.

**Params:**
- `items` (array): `[{ id, price, size, quantity_override?, unit_override? }]` — `size` is the raw Kroger size string (`"1/2 gal"`, `"16.9 fl oz"`, `"6 ct"`). Pass `quantity_override`/`unit_override` only for residue the parser couldn't handle (see `incomparable`).

**Returns:**
- `{ ranked: [{ id, unit_price, base_unit }], cheapest, incomparable: [id] }`

**Notes:** Ranks only WITHIN a dimension (volume / weight / count) — never compares `$/fl oz` to `$/lb`. Cross-dimension or unparseable items land in `incomparable`; the LLM may normalize an unparseable size into `quantity_override`/`unit_override` and re-call. Same deterministic core the matcher uses internally for step-5 tiebreaking.

### `ready_to_eat_available()`

Cross-reference `ready_to_eat/*.toml` catalogs against current Kroger availability. "Available" means fulfillable via **curbside or delivery** at the preferred location (`fulfillment.curbside || fulfillment.delivery`) — the public Products API exposes no live in-store stock level.

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

**Notes:** Tool applies rules deterministically; LLM presents result to user for confirmation. `"sale"` mode fetches current Kroger flyer/price data **internally** (it does not require the caller to pre-pass `kroger_flyer`). Empty until `substitutions.toml` is seeded — the file is edit-when-directed user config.

---

## Sequencing tools

### `suggest_sequencing(seed_recipes)`

> **Status: built in Change 13**, not Change 08. The tool walks the component vocabulary, which is unseeded in the corpus today (≈1/63 recipes declare a component), so it ships with Change 13 (the change that seeds that vocabulary via corpus reconciliation). The menu-request flow tolerates an absent/empty sequencing result until then. Contract below is the target.

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

### `update_preferences(content)` / `update_taste(content)` / `update_diet_principles(content)` / `update_substitutions(content)` / `update_aliases(content)`

Write to user-curated files. **Content-faithful:** each writes exactly the full file content supplied by the caller — no inferred merge. **These should only be called when the user explicitly directs an edit.** The tools exist; the discipline of when to call them lives in AGENT_INSTRUCTIONS.md.

**Params:**
- `content` (string, required) — the complete new file text

**Returns:**
- `{ file, commit_sha }`

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

> **Re-cut (capture/flush split).** The original monolithic `write_cart_and_commit` is split into two tools that ship in different changes: **`commit_changes`** (repo commit, no cart — this change) and **`place_order`** (the order-time cart flush + SKU-cache write — Change 06b). The repo commit exists for memory's sake; the cart write is a separate, deferred, order-time operation. See `docs/notes/2026-06-09-order-flow-reframe.md`.

### `commit_changes(payload)`

Persist a batch of repo updates as **one** atomic git commit — no cart. The everyday persist path: use it at the end of a session to keep the git log clean instead of calling the granular write tools repeatedly. Every change is structurally validated before commit; the commit lands via the Git Data API (tree → commit → update ref) with optimistic ref-retry against the index-build Action.

**Params:**
```
{
  recipe_updates:       [{ slug, updates }],          // frontmatter merges (last_cooked, rating, status, ...)
  pantry_operations:    [{ op, item?, name? }],       // op: add | remove | verify
  pantry_verified:      [name, name, ...],            // reset last_verified_at
  ready_to_eat_drafts:  [{ meal, name, category?, source?, brand?, notes? }],
  ready_to_eat_updates: [{ name, updates }],          // matched by name across meal catalogs
  config_updates:       [{ file, content }],          // file: preferences|taste|diet_principles|substitutions|aliases
  commit_message:       string
}
```
All sections are optional except `commit_message`.

**Returns:**
- `{ commit_sha, summary }`

**Notes:** Because the Worker is stateless, batching is **LLM-orchestrated** — accumulate a session's intended changes and flush them through one `commit_changes` call. The granular write tools (`update_recipe`, `update_pantry`, …) each commit on their own and are for standalone one-offs; don't call them N times mid-session.

### `place_order(payload)`

The order-time flush — the **only** tool that writes a Kroger cart. Resolves the whole to-buy set against *current* Kroger availability, writes the cart (`PUT /v1/cart/add`), and appends learned ingredient→SKU mappings to `skus/kroger.toml`. Backed by the Kroger `authorization_code` + PKCE user-context client and the KV-backed rotating refresh token.

**To-buy set (order-time dedup):** `grocery_list ∪ menu_needs − pantry_has`. Only `active` list items participate. A name present in the pantry is **not** silently dropped — it returns in `partials` for you to prompt on, and is bought only if the user confirms it via `include_partials` (the no-auto-decide rule). Default buy quantity is **1 package** per item unless overridden.

**Resolution + checkpoint:** each item runs through the [matcher](#match_ingredient_to_kroger_skuingredient-context) with cache revalidation (a cache hit no longer fulfillable is re-resolved). Items the matcher returns as `ambiguous` or `unavailable` are collected into a single `checkpoint` and are **not** added to the cart. Disposition them and re-call with `overrides` (force a SKU) — already-carted items have advanced to `in_cart`, so they won't be re-added.

**Params:**
```
{
  menu_needs:       [{ name, quantity?, for_recipes? }],  // needs not yet on the list
  quantities:       { "<name>": <packages> },             // per-item package count (default 1)
  include_partials: ["<name>", ...],                       // pantry items the user confirmed buying anyway
  overrides:        [{ name, sku, brand?, size? }],        // disposition previously-ambiguous items
  preview:          bool                                    // resolve + report only; no cart write, no commits
}
```
All sections optional. With no args it flushes the current `grocery_list.toml`.

**Returns:**
```
{
  resolved:  [{ name, sku, brand, size, quantity }],
  checkpoint:[{ name, kind: "ambiguous"|"unavailable", candidates?, message }],
  partials:  [{ name, for_recipes }],
  sku_cache: { committed, commit_sha?, error? },
  cart:      { written, count?, error?, code? },   // code carries reauth_required etc.
  list:      { advanced, commit_sha?, error? },
  preview:   bool
}
```

**Partial-failure honesty:** the SKU-cache commit and the cart write are **independent best-effort** operations (the SKU cache is a pure hint). Order: commit the cache → write the cart → advance the list to `in_cart` *only after a successful cart write*. So a cart failure leaves the list `active` (retryable, no silent drop) and **never** reports a populated cart; a cache-commit failure after a successful cart just re-resolves next time. If the cart write fails because the Kroger refresh token was rejected, `cart.code` is `reauth_required` — re-run the one-time `/oauth/init` (see `worker/README.md`).

**Lifecycle (`active → in_cart → ordered → received`):** `place_order` sets `in_cart`. Because the cart API is write-only and unreadable, the transitions past `in_cart` are **user-asserted**, never agent-verified:
- *"I placed the order"* → advance `in_cart` items to `ordered` via `update_grocery_list`.
- *"I picked up the groceries"* → `received` (terminal): `remove_from_grocery_list` for each, and for `grocery`-kind items only, restock `pantry.toml` via `update_pantry`. `household`/`other` items don't touch the pantry.

A **stale-cart reminder** fires when a new order begins while the prior list still has `in_cart` items never confirmed `ordered`: remind the user to clear the Kroger cart manually (the API can't), rather than silently double-adding.

---

## What this surface deliberately does NOT include

- No raw GitHub write access (atomic commits only)
- No raw Kroger API access (matching pipeline + cart write only)
- No "search arbitrary text across recipes" (use GitHub MCP for that)
- No "execute arbitrary code" or "run arbitrary script"
- No portion math (no whiteboard problem)
- No background or scheduled triggers
