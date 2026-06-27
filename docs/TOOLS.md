---
update-when: a tool's parameters or returns change, or the tool surface changes
---

# TOOLS.md — MCP Tool Inventory

The complete tool surface exposed by `grocery-mcp` to Claude. Each tool encodes a deterministic operation. The LLM composes them; the tools enforce the pipelines.

## Design philosophy

**Coarse and opinionated.** Tools wrap multi-step deterministic logic so the LLM doesn't have to orchestrate every step. `match_ingredient_to_kroger_sku` runs the full 7-step matching pipeline internally; the LLM doesn't construct Kroger queries directly.

**Structured output via JSON.** Every tool returns structured data. The LLM reasons over the result; it doesn't parse free text.

**Honest about ambiguity.** When deterministic narrowing leaves multiple options (e.g., 3 brands of olive oil all match equally), tools return `ambiguous: true` with candidates. The LLM either picks based on context or asks the user. Tools don't silently pick.

**No raw building blocks exposed.** No `kroger_raw_search`, no `github_raw_write`, no `cart_add_by_name`. These would let the LLM bypass the deterministic pipelines.

---

## Recipe tools

### `search_recipes(specs)`

Find recipes in the corpus. Takes an array of search **specs** and returns one result group per spec, in one round-trip. Each spec applies its `facets` as the hard gate over the caller's available corpus (whole shared corpus + the caller's personal recipes − the caller's rejects); a spec's optional `vibe` picks the mode. **Without a vibe (membership):** returns every survivor, unranked, **including not-yet-embedded recipes**, uncapped by `k` — the named-dish / browse path. **With a vibe (ranked):** embeds the vibe and ranks the embedded survivors by cosine, re-ranked by taste and freshness; unembedded survivors are dropped and the top-`k` returned. Backend-agnostic ranking: the middle leg is a brute-force cosine over a D1 `recipe_embeddings` join today; a future Vectorize swap is invisible to the caller. Reads the index (`src/recipe-index.ts`); ranked specs additionally read the embeddings (`recipe_embeddings`), the caller's overlay / cooking log / preferences, and the alias table. An empty table returns empty result groups; an unreadable table returns `index_unavailable`.

**Params:**
- `specs` (array, required, ≥1): each `{ label, facets?, vibe?, k?, boost_ingredients? }`:
  - `label` (string): an arbitrary tag echoed back so the caller can tell each spec's results apart.
  - `facets` (object, optional): `{ protein?, cuisine?, course?, query?, season?, dietary?, max_time_total?, not_cooked_since?, exclude_cooked_within_days?, include_unmakeable? }` — the hard gate, applied identically in both modes (a ranked spec's cosine only reorders within the survivors and can never admit a facet-rejected recipe; the caller's rejects are excluded by the same gate).
  - `vibe` (string, optional): free-text description of the dish wanted (`"rich slow-braised cold-weather comfort"`), embedded and matched by **meaning**, not keyword. **Present ⇒ ranked mode; absent ⇒ membership mode.**
  - `k` (number, optional): top-K for a ranked spec (default `10`, max `50`). **Ignored in membership mode** (all survivors returned).
  - `boost_ingredients` (string[], optional): item names to bias a **ranked** spec toward — the caller's **at-risk perishables / on-hand items** worth using up. They add a small, perishable-weighted overlap boost (below); they **never gate** — a recipe with no overlap is ranked normally, not excluded, and overlap can never admit a facet-rejected recipe. The *caller* decides which items are at-risk (the agent's freshness judgment); the tool only does the overlap math. Pass corpus-canonical names where you know them; matching is alias-normalized but does **not** use per-ingredient embeddings. **Ignored in membership mode.**

**Returns:**
- `{ results: [{ label, recipes }] }` — one group per input spec, in spec order.
  - **Membership rows** (vibe absent): `{ slug, title, frontmatter }`. Each `frontmatter` carries the caller's `favorite` boolean (merged from the overlay) and the recipe's `description`; there is **no** `status` or `rating`. Under `include_unmakeable`, a gated-in recipe's `frontmatter` additionally carries `missing_equipment: [slugs]`.
  - **Ranked rows** (vibe present): `{ slug, title, description, protein, cuisine, time_total, score, similarity, pantry_overlap }`. `similarity` is the raw query↔recipe cosine; `score` is the blended rank (cosine + favorite + freshness + pantry overlap), rounded to 4 dp. `pantry_overlap` is the subset of that spec's `boost_ingredients` this recipe uses (normalized) — `[]` when none matched or none were passed.

**Notes:**
- **Opt-out visibility — no status filter.** A recipe with no overlay row is neutral/available; the default result for an unfiltered membership spec is the **whole shared corpus minus the caller's rejects**. There is no `status` filter and no per-member active set; a rejected recipe (`toggle_reject`) is excluded entirely (a hard gate) in both modes.
- **Makeability gate (default-on):** joins the caller's kitchen `owned` and drops recipes whose `requires_equipment` is not a subset of `owned`. An **empty/absent** `owned` (unknown inventory) makes the gate a **no-op** (everything passes). `include_unmakeable: true` disables the drop and instead returns those recipes annotated with `missing_equipment` — use it when surfacing a specifically **named** dish so it's flagged, never silently dropped.
- Array filters (`dietary`, `season`) match **all** listed values (AND/narrowing). **There is no `tags` filter** — keyword/tag matching is done by `query`.
- `course` (string): the **open-vocabulary** dish-type facet (`main | side | dessert | breakfast | …`), matched by **containment** — `course: "side"` returns every recipe whose `course` array includes `side`, including a dual-use `[main, side]` dish. Matched literally against the normalized index (no controlled set). One vibe-less faceted spec returns mains and sides together (each entry's `frontmatter` carries `course`); the caller buckets by `course`.
- `query` (string): the single name/keyword search over `title` **and** `tags`. Tokenize on whitespace, drop connective stopwords (`and`, `or`, `with`, `the`, `a`, `an`, `of`, `in`, `on`, `for`, `&`), then keep a recipe when **every** remaining token is a case-insensitive substring of its `title` or any `tag` (token-AND). Deterministic membership only — no ranking. So `"chicken and rice"` ≡ `"chicken rice"` and surfaces a recipe titled "Chicken and Rice" even when its tags omit "rice". Pair with a **vibe-less** spec for named-dish lookup so the match set is exhaustive and a just-imported recipe is included.
- `exclude_cooked_within_days` (number): drop recipes cooked within the last N days. `not_cooked_since` (date): recipes with `last_cooked: null` (never cooked) **pass**.
- **Ranked mode — facet gate first, then cosine.** Hard constraints are applied by the same `filterRecipes` gate as membership mode (including makeability); cosine only ranks the survivors.
- **Ranked mode — re-rank = cosine + three small nudges.** `+ favoriteWeight · max cosine to any favorited recipe` (taste *direction* — nearest-liked, not a centroid; no-op on cold start), `+ freshness` (never-cooked surfaced by `novelty_boost`; cooked-within-`resurface_after_days` linearly demoted), and `+ pantry overlap` (below). The nudges are deliberately small relative to cosine. Favorites are the caller's `favorite`-flagged recipes (set via `toggle_favorite`); `rotation.{novelty_boost,resurface_after_days}` come from preferences, defaulting when unset.
- **Ranked mode — pantry overlap = two-tier, saturating, perishable-weighted.** For each `boost_ingredient`, a hit on the recipe's `perishable_ingredients` (the waste-prevention win) counts more than a hit on only its `ingredients_key`; the weighted sum saturates and scales by a small weight. Boost items and ingredient lists are alias-normalized before exact set-overlap — synonym recall depends on the alias table, **not** on ingredient embeddings. The weights are fixed constants today.
- **Ranked mode — unembedded recipes are dropped.** A just-imported recipe whose embedding the cron hasn't reconciled yet is excluded from a ranked group (not an error) — it stays findable via a **vibe-less** membership spec until the next reconcile.
- **One round-trip, one embedding call.** All vibe-bearing specs embed in a single Workers AI request; a batch of only vibe-less specs makes **no** AI request. Pass several diverse vibe specs (a vibe, a variety/wildcard, a never-cooked novelty) for recall rather than many calls.

### `read_recipe(slug)`

Read a single recipe's full content (frontmatter + body).

**Params:**
- `slug` (string, required)

**Returns:**
- `{ slug, frontmatter, body }` — `frontmatter` includes the objective shared fields, among them `perishable_ingredients` (a normalized list of the recipe's perishable ingredients; empty when absent), `course` (the open-vocabulary dish-type array — `main | side | dessert | breakfast | …`; empty when absent), and `pairs_with` (slugs of suggested corpus sides). The `perishable_ingredients` and `course` fields also ride each entry's `frontmatter` from the index-backed `search_recipes`, so the menu-gen waste callout and the mains/sides faceting reason over them without any extra tool.

### `recipe_site_url()`

Resolve the URL of the hosted recipe site (the static browse view of the shared corpus) from the data repo's **GitHub Pages** config, via the GitHub App token. No parameters; reads the shared repo; never writes. Used in onboarding to point a member at the full corpus.

**Returns:**
- `{ url, enabled }` — `enabled: true` with the published `html_url` (honoring a custom domain) when Pages is on; `{ url: null, enabled: false }` when it isn't (the agent should tell the user their operator needs to enable GitHub Pages).

**Notes:** Returns a structured `insufficient_permission` error when the GitHub App lacks the **`Pages: read`** permission (a one-time operator grant; see `docs/SELF_HOSTING.md`).

### `update_recipe(slug, updates)`

Edit a recipe's **objective shared content** (frontmatter/body) — the same recipe everyone in the group sees. `favorite`/`reject` are NOT settable here (they are the caller's personal disposition — use `toggle_favorite` / `toggle_reject`), nor is `last_cooked` (derived from the cooking log — record a cooked meal via `log_cooked`).

**Params:**
- `slug` (string, required)
- `updates` (object): partial objective frontmatter to merge (title, protein, cuisine, course, tags, dietary, pairs_with, perishable_ingredients, …)

**Returns:**
- `{ slug, updated_fields, commit_sha? }` — confirmation of what was changed; `commit_sha` is present when a write landed and omitted when nothing changed

**Notes:** Objective-only — it writes shared GitHub recipe content and nothing else. `favorite`/`reject` (and the retired `status`/`rating`) are rejected with `validation_failed` (the message names `toggle_favorite`/`toggle_reject`), and `last_cooked` is rejected toward `log_cooked`. `read_recipe`/`search_recipes` merge the caller's overlay (favorite/reject, set via `toggle_favorite`/`toggle_reject`) and cooking-log `last_cooked` onto shared content at read time; an absent overlay row means **neutral (available)** — `favorite: false`, `reject: false`. `perishable_ingredients` is objective shared content, so an edit to it writes the shared recipe; the Worker normalizes the names on write (the same `normalizeIngredient` the Kroger matcher uses) so cross-recipe overlap lines up. Objective frontmatter is checked against the controlled vocabularies on write: `protein`/`cuisine` must be coarse buckets and `requires_equipment` slugs must be in-vocab — an off-vocab value returns `validation_failed` and makes no commit (a `none`/empty `protein`/`cuisine` is normalized to absent rather than rejected).

### `toggle_favorite(slug, favorite)`

Set the caller's **personal favorite flag** for a recipe — `favorite: true` marks it, `false` clears it. Favorites are THE positive taste signal: they anchor the `search_recipes` nearest-liked re-rank (ranked mode) and the group "favorited by N others" signal (`read_recipe_notes`). Writes only the caller's per-tenant overlay; one member's favorites never affect another's.

**Params:**
- `slug` (string, required) — must resolve against the recipe index (D1 `recipes`)
- `favorite` (boolean, required)

**Returns:**
- `{ slug, overlay }` — the caller's resulting overlay row; **no `commit_sha`** (the overlay is D1-backed, not a git commit)

**Notes:** Unknown slug → `not_found`, writing nothing. `favorite` and `reject` are **mutually exclusive** — favoriting clears any `reject`. `favorite: false` clears the flag; if nothing else is set on the row, the row is DELETEd (no lingering `favorite: 0`). The overlay lives in the caller's D1 `overlay` table.

### `toggle_reject(slug, reject)`

Hide a recipe from the **caller** — `reject: true` removes it from the caller's `search_recipes` results (a hard gate, both membership and ranked modes), `false` un-hides it back to the available default. Writes only the caller's per-tenant overlay; one member's reject never affects another's view, and it does not remove the shared recipe. **Distinct from `reject_discovery`**, which suppresses a discovery *URL* group-wide before import; `toggle_reject` acts on an existing corpus slug for one member.

**Params:**
- `slug` (string, required) — must resolve against the recipe index (D1 `recipes`)
- `reject` (boolean, required)

**Returns:**
- `{ slug, overlay }` — the caller's resulting overlay row; **no `commit_sha`** (the overlay is D1-backed).

**Notes:** Unknown slug → `not_found`, writing nothing. `favorite` and `reject` are **mutually exclusive** — setting `reject: true` clears any `favorite` (and vice-versa). `reject: false` clears the flag; if nothing else is set on the row, the row is DELETEd (back to neutral/available). `read_recipe`/`search_recipes` merge the overlay onto shared content at read time.

### `parse_recipe(url)`

**Parse-only.** Fetch a recipe page, extract its schema.org `Recipe` JSON-LD, and return the structured data. Writes nothing and commits nothing — the agent cleans/classifies the data, assembles the markdown body, then persists via `create_recipe`.

**Params:**
- `url` (string, required)

**Returns:**
- `{ title, ingredients: [...], instructions: [...], servings, time_total, time_active, source, tools_hint?, existing_slug? }` — `ingredients`/`instructions` are string arrays; `servings` is a scalar (number when parseable); `time_total`/`time_active` are minutes or null; `source` is the recipe's canonical URL. **`tools_hint`** (present only when the page carries a schema.org `tool`) is the flattened tool-name list — a **non-authoritative hint** for classifying `requires_equipment`, never copied into it (it lists every utensil; default `requires_equipment` to `[]` and tag only truly-irreplaceable gear). **`existing_slug`** is present only when this source URL is **already in the shared corpus** (idempotent import) — reuse that recipe (rate it, note it) instead of calling `create_recipe`.

**Errors (structured):**
- `{ error: "unreachable" }` — the page couldn't be fetched (network error or non-2xx). Bot-walled/paywalled sites (Serious Eats, NYT, Food52) land here — paste the recipe instead.
- `{ error: "no_jsonld" }` — no `<script type="application/ld+json">` on the page.
- `{ error: "not_a_recipe" }` — JSON-LD present but no schema.org `Recipe`.
- `{ error: "incomplete", missing: [...] }` — a `Recipe` was found but yielded no ingredients and/or no instructions.

**Notes:** Handles JSON-LD in `@graph`, top-level arrays, multiple script blocks, `@type` as string or array, and instructions as `HowToStep`/`HowToSection`/plain strings (`HowToTip` notes are skipped). The agent owns the judgment fields (protein, cuisine, tags, dietary, `ingredients_key`, `meal_preppable`) when assembling frontmatter for `create_recipe`.

### `create_recipe(frontmatter, body, slug?)`

Write a **new** recipe to the **shared corpus** (the data-repo root, read by everyone), from agent-assembled frontmatter + body, as **one solo commit**. The slug derives from the title unless `slug` is supplied. The body MUST contain `## Ingredients` and `## Instructions` H2 sections (guarded — a body missing them is rejected, never committed). A recipe is shared and single-source: if the `source` URL is already in the corpus, the write is refused (`already_exists`) so the existing recipe is reused, not duplicated.

**Params:**
- `frontmatter` (object, required) — full recipe frontmatter. **Every system-consumed field is required and must be present** (the required-field contract, `src/recipe-contract.js`): `title`, `description`, `ingredients_key`, `course` (non-empty); `protein`, `cuisine`, `time_total`, `source` (a value **or explicit `null`**); `dietary`, `season`, `tags`, `pairs_with`, `perishable_ingredients`, `requires_equipment` (may be `[]`); and `side_search_terms` (non-empty for a `main`, `[]` otherwise). Fields outside this set are free-form and pass through untouched. **No `status`** is stamped (the per-tenant status lifecycle is retired) — an imported recipe lands available to the whole group by default; a lingering `status` is stripped. Discovery imports should set `discovered_at` and `discovery_source`.
- `body` (string, required) — markdown body with the `## Ingredients` / `## Instructions` sections.
- `slug` (string, optional) — overrides the title-derived slug.

**Returns:**
- `{ slug, commit_sha }`

**Errors (structured):**
- `{ error: "slug_exists", slug }` — a recipe already exists at that path; not overwritten.
- `{ error: "already_exists", slug, source }` — a recipe with this `source` URL is already in the shared corpus (idempotent import); `slug` is the existing recipe to reuse.
- `{ error: "validation_failed" }` — no derivable slug (missing title), the body lacks the required H2 sections, or the frontmatter violates the required-field contract (a missing/empty required field, an off-vocabulary `protein`/`cuisine`/`season`/`requires_equipment` value, or a `"none"` protein — the error names the offending field).

**Notes:** The everyday discovery write path: `parse_recipe` (parse) → agent cleans/classifies → `create_recipe`. The recipe is available to everyone the moment it's committed (no draft, no activation); later personal disposition is `toggle_favorite` (love it) or `toggle_reject` (hide it). The frontmatter is a pass-through record (free-form fields ride through), but the required-field contract is enforced at write time (`src/validate.ts`, the shared `validateRecipeContract` the build also runs) so a recipe can never be created silently un-indexed. `protein`/`cuisine`/`requires_equipment` are checked against the shared vocabularies (`src/vocab.js`); a no-protein dish writes `protein: null` (never omitted, never `none`). `update_recipe` enforces the same contract on the **merged** result — a one-field patch on a compliant recipe succeeds, an edit that empties a required field is rejected — and is the path to backfill fields on existing recipes. `perishable_ingredients` **and `ingredients_key`** are **normalized on write** (Kroger-matcher normalization) so cross-recipe overlap lines up; classify `perishable_ingredients` by the "would the leftover rot" test.

---

## Recipe note tools

Notes are the **spin-capture mechanism**: a tweak or observation is an *attributed note*, never an edit to shared recipe content. The canonical recipe stays canonical; "sub gochujang, cut the sugar" lives as a note. This is what makes a shared corpus safe — only a genuine "different dish" warrants a personal-recipe fork. Notes are stored in the D1 `recipe_notes` table (attributed by `author` column), so authorship is structural, not a spoofable field.

### `add_recipe_note(slug, body, tags?, private?)`

Append an attributed note to a recipe (shared or personal) in the caller's notes. **Append-mostly** — prior notes are retained, never overwritten; shared content is never touched.

**Params:**
- `slug` (string, required) — the recipe the note is about.
- `body` (string, required) — free-form markdown (the tweak/observation).
- `tags` (array of strings, optional) — e.g. `["tweak"]`, `["observation"]`.
- `private` (boolean, optional) — default `false` (shared with the group). A `private` note is visible only to its author.

**Returns:**
- `{ slug, author, created_at }` — D1-backed, no `commit_sha`

**Errors (structured):**
- `{ error: "validation_failed" }` — malformed slug or empty body.

### `update_recipe_note(slug, created_at, body?, tags?, private?)`

Edit one of the caller's **own** notes, addressed by its `created_at` (from `add_recipe_note` / `read_recipe_notes`). Only the fields passed change; `created_at` is the immutable key. **Self-scoped** — it can only touch a note the caller authored. Shared recipe content and other tenants' notes are untouched. (Relaxes the append-only posture for your own notes.)

**Returns:**
- `{ slug, author, created_at }` — D1-backed, no `commit_sha`

**Errors (structured):**
- `{ error: "validation_failed" }` — malformed slug or empty body.
- `{ error: "not_found" }` — no note of the caller's on that slug with that `created_at`.

### `remove_recipe_note(slug, created_at)`

Delete one of the caller's **own** notes, addressed by its `created_at`. Self-scoped; shared content and other tenants' notes are untouched.

**Returns:**
- `{ slug, removed: true, created_at }` — D1-backed, no `commit_sha`

**Errors (structured):**
- `{ error: "not_found" }` — no note of the caller's on that slug with that `created_at`.

### `read_recipe_notes(slug)`

Read the **group's** notes and favorites for a recipe — the collaborative-cookbook view. Aggregated across everyone in the group at read time (the tenant directory → each member's subtree).

**Params:**
- `slug` (string, required)

**Returns:**
```
{
  slug,
  notes:     [{ author, created_at, body, tags, private }], // ordered by timestamp
  favorites: [{ author }]                                   // one per member who favorited it
}
```

**Notes:** The caller sees their **own** private notes plus **everyone's shared** notes; another member's `private` note is never returned. `favorites` is the group signal — `favorites.length` is the favorite count. Surface it ("favorited by two others") before recommending a recipe the caller hasn't tried.

---

## Pantry tools

### `read_pantry(filter)`

Read pantry items, optionally filtered.

**Params:**
- `filter` (object, optional): `{ category?, prepared_only?, stale_only? }`

**Returns:**
- `{ items: [...] }` — array of pantry items per schema

**Notes:** `category` and `prepared_only` are deterministic from pantry data. `stale_only` returns a structured `{ error: "unsupported" }`: freshness is an LLM-judged, conversational concern (it depends on storage, whether a package was opened, and visual inspection) rather than something the tool can compute. There is no shelf-life table backing it — the curated `guidance/ingredient_storage/` tree (see `list_guidance` / `read_guidance`) informs put-away advice rather than gating staleness.

### `update_pantry(operations)`

Apply pantry updates from conversational messages.

**Params:**
- `operations` (array): `[{ op: "add" | "remove" | "verify", item: ..., ... }]`

**Returns:**
- `{ applied: [...], conflicts: [...] }` — D1-backed, no `commit_sha`

**Notes:** Conflicts surface when remove targets aren't found. The agent should ask the user how to resolve. Pantry state is D1-backed (the `pantry` table) — no git commit. Each item may carry an optional freeform `notes` string alongside its structured fields.

### `update_kitchen(operations)`

Update the caller's kitchen equipment inventory (agent-editable on user direction, the same posture as `update_pantry`). D1-backed (`kitchen_equipment` rows + `profile.kitchen_notes`).

**Params:**
- `operations` (array): `[{ op: "add" | "remove", slug }]` for the gating `owned` list, and `[{ op: "set_note", key, value }]` for a freeform `notes` field.

**Returns:**
- `{ applied: [...], conflicts: [...] }` — D1-backed, no `commit_sha`

**Notes:** An `add` of an **off-vocabulary** slug is a **conflict**, never a silent write — `owned` is the gate's left operand and is kept vocabulary-clean (vocab: `pressure-cooker`, `sous-vide-circulator`, `blender`, `ice-cream-maker`). An `add` of an already-owned slug is idempotent (no-op, no conflict); a `remove` of an absent slug is a conflict. `set_note` fields (oven count, pan sizes) inform the `cook` flow only and **never** gate a recipe. Kitchen state is D1-backed (the `kitchen_equipment` rows + `profile.kitchen_notes`).

### `mark_pantry_verified(items)`

Reset `last_verified_at` on confirmed items.

**Params:**
- `items` (array of names or slugs)

**Returns:**
- `{ verified: [...], conflicts: [...] }` — conflicts name items not found in the pantry; D1-backed, no `commit_sha`

### `update_staples(add?, remove?)`

Add items to or remove items from the caller's staples list. D1-backed (`staples` table). Adds are deduped by normalized `name`; removes match by normalized `name` and silently succeed when not present.

**Params:**
- `add` (array, optional): `[{ name, perishable? }]`. Only `name` is required. `perishable: true` enables the staleness-nudge behavior for that item (see the `staples` table in `docs/SCHEMAS.md`).
- `remove` (array of strings, optional): item names to remove. Silently no-ops for absent names.

**Returns:**
- `{ added, removed }` — `added`/`removed` are counts; D1-backed (the `staples` table), no `commit_sha`.

**Notes:** Seeded at onboarding (see the configure-grocery-profile flow); usable any time the user names items they want to track. `perishable` is a flag about that item's typical shelf life — separate from its current pantry `category`. An item can be in both the staples list and the stockup watchlist; they are independent.

### `update_stockup(items?, freezer_capacity_estimate?)`

Add items to the caller's bulk-buy watchlist. Writes the caller's D1 `stockup` rows. **Add-only**, deduped by normalized item `name` (re-adding a name is a no-op; existing rows untouched), mirroring `update_discovery_sources`.

**Params:**
- `items` (array, optional): `[{ name, unit?, typical_purchase?, notes?, baseline_price?, buy_at_or_below? }]`. Only `name` is required. The price fields are **advisory** — nothing in the Worker gates on them ("is this a good price?" is the agent's judgment over the flyer and live prices), so omit them when unknown.
- `freezer_capacity_estimate` (string, optional): `tight | moderate | spacious` — the top-level capacity hint.

**Returns:**
- `{ added }` — `added` is the count of new items; D1-backed (the `stockup` table + `profile.freezer_capacity_estimate`), no `commit_sha`.

**Notes:** The top-level `freezer_capacity_estimate` is serialized before the `[[items]]` tables (TOML ordering). Seeded at onboarding (see the configure-grocery-profile flow); also usable any time the user names a bulk-buy item.

---

## Grocery list tools

The grocery list is the SKU-free buy list for the next order (D1-backed, `grocery_list` table). It accumulates intent across the week; resolution to a Kroger SKU and the cart write are deferred to order placement (`place_order`). Writes are D1-backed — no `commit_sha`. See `docs/SCHEMAS.md` for the item schema.

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
- `domain` (string, optional) — the store-TYPE it's bought at; defaults to `"grocery"` (common values `grocery | home-improvement | garden | pharmacy`). Orthogonal to `kind`; filters which in-store walk includes the item.
- `source` (optional): `ad_hoc | menu | pantry_low | stockup`
- `for_recipes` (array of slugs, optional)
- `note` (string or null, optional) — one-off brand request / occasion

**Returns:**
- `{ item, merged }` — D1-backed, no `commit_sha`

### `update_grocery_list(name, ...patch)`

Patch an existing item by name (`quantity`, `kind`, `domain`, `status`, `source`, `for_recipes`, `note`).

**Returns:**
- `{ item }` — `not_found` if no such item; D1-backed, no `commit_sha`

### `remove_from_grocery_list(name)`

Remove an item by name.

**Returns:**
- `{ removed: bool }` — D1-backed, no `commit_sha`

**Notes:** Promoting a low/out pantry item onto the list is a **prompted** decision (record `source: "pantry_low"`), never automatic. The lifecycle past `active` (`in_cart` → `ordered` → `received`) is driven by `place_order` and the user-asserted transitions — see [`place_order`](#place_orderpayload) below.

---

## Store tools (in-store fulfillment)

The **in-store fulfillment flush**: the `shop-groceries` skill groups the same SKU-free grocery list for a specific store — by aisle when it's mapped, by department otherwise (vs. `place_order`'s Kroger online flush). For Kroger stores with a registered `location_id`, `kroger_prices` provides API-driven aisle ordering (`aisleLocation`) without a pre-mapped layout. The `stores/` registry holds **identity only** (the D1 `stores` table, keyed by location, **shared/unattributed**); any MCP holder may register or edit one with no extra gate (the `update_discovery_sources` posture). There is **no `stores` index** — the set is small, so `list_stores` reads the table. **Store layout lives in attributed store notes**, not the registry: aisle order (`layout`-tagged), where-it-hides hints (`location`), and not-carried entries (`stock`) are all `add_store_note` / `read_store_notes` — one surface for everything we know about a store. See `docs/SCHEMAS.md` for the `stores` and `store_notes` table schemas.

### `list_stores()`

List the registered stores (identity only). Reads the shared `stores/` directory directly; an absent/empty registry returns `{ stores: [] }` (the walk still works, degraded). To tell whether a store has a usable aisle map, read its `layout`-tagged store notes (`read_store_notes`), not this list.

**Returns:**
- `{ stores: [{ slug, name, label?, domain }] }` — identity only.

### `read_store(slug)`

Read one store's **identity**: `name`, `label?`, `chain?`, `address?`, `domain`, `location_id?`. Layout and observations are not here — they're attributed store notes; use `read_store_notes` for the aisle map (`layout`), where-it-hides hints (`location`), not-carried entries (`stock`), and freeform notes (hours, parking).

**Params:**
- `slug` (string, required)

**Returns:**
- `{ slug, name, label?, chain?, address?, domain, location_id? }` — `location_id` is a chain-specific external id (e.g. Kroger `locationId`); present only when set.

**Errors (structured):**
- `{ error: "not_found" }` — unknown (or malformed) slug.

### `add_store(slug, name, label?, chain?, address?, domain?, location_id?)`

Register a new store location — **identity only**. `slug` is a kebab-case **location** id (`west-7th-tom-thumb`, not `tom-thumb`). `domain` defaults to `"grocery"`. `location_id` is an optional chain-specific external id — for Kroger stores set it to the resolved Kroger `locationId` so in-store walks can bypass the Locations API lookup. Layout is **not** set here — map a store by recording `layout`-tagged store notes (`add_store_note`) as you walk it. D1-backed.

**Returns:**
- `{ store }` — D1-backed, no `commit_sha`

**Errors (structured):**
- `{ error: "validation_failed" }` — invalid slug or empty name.
- `{ error: "slug_exists" }` — the slug is already registered (edit with `update_store`).

### `update_store(slug, operations)`

Edit a registered store's **identity** with operations (`update_pantry`/`update_kitchen` style):
- `{ op: "set_identity", field, value }` — `field` ∈ `name | label | chain | address | domain | location_id`. Use `location_id` to set or update a chain-specific external id (e.g. Kroger `locationId`).

There are no aisle / item-location / not-carried ops — layout is notes now (`add_store_note` with `layout`/`location`/`stock` tags).

**Returns:**
- `{ slug, applied: [...], conflicts: [...] }` — D1-backed, no `commit_sha`; `conflicts` reports e.g. an unsettable field.

**Errors (structured):**
- `{ error: "not_found" }` — unknown slug.

### `remove_store(slug)`

Remove a registered store (D1 row delete). Members' attributed store notes are left untouched.

**Returns:**
- `{ slug, removed: true }` — D1-backed, no `commit_sha`

**Errors (structured):**
- `{ error: "not_found" }` — unknown slug.

### `add_store_note(slug, body, tags?, private?)`

Append an attributed note to a store — the single home for everything we know about it. Freeform observations ("fish counter closes at 6 PM", "they stock the Kerrygold I like") **and** layout, by tag convention: `layout` for an aisle + its sections (lead the body with the aisle number — `"Aisle 7: baking, spices"` — the number order is the walk path); `location` for where a non-obvious item hides; `stock` for a not-carried item. Append-mostly; D1-backed (`store_notes` table, attributed by `author` column).

**Params:**
- `slug` (string, required), `body` (string, required), `tags` (array, optional), `private` (boolean, optional — default `false`).

**Returns:**
- `{ slug, author, created_at }` — D1-backed, no `commit_sha`

**Errors (structured):**
- `{ error: "validation_failed" }` — malformed slug or empty body.

### `update_store_note(slug, created_at, body?, tags?, private?)`

Edit one of the caller's **own** store notes, addressed by its `created_at` (from `add_store_note` / `read_store_notes`). Only the fields passed change; `created_at` is the immutable key. **Self-scoped** — it can only touch a note the caller authored. The clean-correction path for a stale `layout` note after a remodel.

**Returns:**
- `{ slug, author, created_at }` — D1-backed, no `commit_sha`

**Errors (structured):**
- `{ error: "validation_failed" }` — malformed slug or empty body.
- `{ error: "not_found" }` — no note of the caller's on that slug with that `created_at`.

### `remove_store_note(slug, created_at)`

Delete one of the caller's **own** store notes, addressed by its `created_at` — e.g. drop a pre-remodel `layout` note. Self-scoped; other tenants' notes are untouched.

**Returns:**
- `{ slug, removed: true, created_at }` — D1-backed, no `commit_sha`

**Errors (structured):**
- `{ error: "not_found" }` — no note of the caller's on that slug with that `created_at`.

### `read_store_notes(slug)`

Read the **group's** attributed notes for a store, aggregated across everyone at read time. The caller sees their **own** private notes plus **everyone's shared** notes; another member's `private` note is never returned. Carries both freeform notes and layout (`layout`/`location`/`stock` tags); where two notes conflict (e.g. a remodel), prefer the most recent by `created_at`.

**Params:**
- `slug` (string, required)

**Returns:**
- `{ slug, notes: [{ author, created_at, body, tags, private }] }` — ordered by timestamp.

---

## Kroger tools

### `kroger_flyer(filter)`

Synthesized sale scan for the caller's store, served from a **cache warmed in the background** — the public API has **no** flyer/circular endpoint, and a live per-call fan-out (one search per term) would exceed the Worker's per-request subrequest limit, so a single cron sweep materializes a per-location flyer into KV and this tool reads it (see ARCHITECTURE → *the flyer warm*). Returns fulfillable products with a **meaningful discount** — on sale **and** at least `min_savings_pct`% off (default **5%**), deduped by `productId`. The noise floor (a real sale — `promo > 0 && promo < regular` — and fulfillable) is applied at *warm* time; the `min_savings_pct` deal floor is applied at *read*, so it stays caller-tunable without re-fetching. Explicitly **non-exhaustive** (each broad term sampled a relevance-ranked head, no sort-by-discount) and may be a few hours stale.

**Params:**
- `filter` (object, optional): `{ min_savings_pct? }`
  - `min_savings_pct` (number, default 5): minimum percentage markdown to keep. Applied at read over the warmed rollup — pass lower (e.g. 3) to widen, higher to tighten.

**Returns:**
- `{ items: [{ sku, brand, description, size, price: { regular, promo }, savings, categories, matched_terms }], as_of }`
  - `matched_terms` (array of strings): every broad term that surfaced this product during the sweep.
  - `as_of` (string | null): ISO 8601 timestamp of this store's last warm, or `null` when the store has not been swept yet.

**Notes:** Pure cache read — issues **no** external Kroger subrequest. Cold/absent cache returns `{ items: [], as_of: null }` (never an error), the same graceful degradation as an absent/empty flyer-terms set (the D1 `flyer_terms` table, which now feeds the **warm job**, not this tool). The flyer may be a few hours stale; for a specific purchase the order path re-prices live. There are **no** ad-hoc `terms` / `against_stockup` params — checking whether a specific stockup item or substitute candidate is on sale lives in the place-groceries flow, not here.

### `kroger_prices(ingredients)`

Get current prices for a specific list of ingredients (used for menu pre-pass). Returns the **full list of fulfillable products per ingredient** (relevance-ranked, up to Kroger's per-request max of 50) — not just the top one — so the LLM can compare across brands/sizes and pick.

**Params:**
- `ingredients` (array of strings)
- `location_id` (string, optional) — override the store location for this call; defaults to `preferences.stores.preferred_location`. Use when querying a specific store that differs from the primary.

**Returns:**
- `{ prices: [{ ingredient, products: [{ sku, brand, description, size, price: { regular, promo }, on_sale, available: { curbside, delivery }, fulfillment: { curbside, delivery, inStore }, aisleLocation: { number, description, side? } | null, inStore: boolean }] }] }`

**Notes:** `products` is every fulfillable match for the term, ordered by Kroger relevance; an ingredient with nothing fulfillable returns `{ ingredient, products: [] }`. `price` is `{ regular, promo }`; `on_sale` is true only on a real discount (`promo > 0` **and** `promo < regular`) — a `promo` equal to `regular` is not a sale; `available` reflects curbside/delivery fulfillment at the preferred location — the public API exposes no live in-store stock. `inStore` (boolean, top-level on each product) is true when the item is carried in-store at the queried location. `aisleLocation` is present when the API returns aisle data for this product at the location — `{ number, description, side? }` — and null otherwise; use it for Kroger in-store aisle ordering (the `kroger-instore` branch of `shop-groceries`).

### `match_ingredient_to_kroger_sku(ingredient, context)`

Run the full 7-step matching pipeline. Returns a confident match, narrowed candidates for the LLM to choose from, or an `unavailable` signal. **Resolve-only** — it does not write the cache (that rides `place_order`) and it does not substitute (when a swap is wanted, the agent enumerates candidate ingredients from world knowledge and resolves each).

**Params:**
- `ingredient` (string, required)
- `context` (object, optional): `{ recipe_slug, dietary, quantity_hint }`
- `bypass_cache` (boolean, optional): force re-resolution, skipping the cache hit — for when a cached SKU doesn't fit the recipe context (cached generic, recipe wants organic).

**Confidence rule:** confident when a cache hit OR a defined `preferences` `[brands]` entry resolves it (including `[]` = "don't care, cheapest acceptable"); otherwise ambiguous. Cache hits are revalidated for current price + curbside/delivery availability before being returned.

**Shared, location-tagged cache.** The SKU cache (D1 `sku_cache` table, shared corpus) stores mappings resolved by *any* member, warming it for everyone (a network effect). Each entry is tagged with the `location_id` it was resolved at. On lookup, an entry tagged with the caller's own location is tried first, but **every** candidate is revalidated against the caller's `preferred_location` before use — a cross-location entry that isn't carried at the caller's store falls through to a fresh search (so a shared cache can never serve an unavailable SKU). A cross-location hit that *does* revalidate returns `reason: "shared cache hit (revalidated at your store)"`.

**Identity relevance (near-hard).** Beyond curbside/delivery availability, a second near-hard constraint guards *which product*: each candidate is scored by how many query tokens appear in its description/categories, and a confident pick may only come from the **top relevance tier**. So `"anaheim peppers"` resolves to the Fresh Anaheim Peppers PLU, not a cheaper unrelated item that merely shows up in Kroger's results; and `[]` "don't care" picks the cheapest *matching* candidate, never the cheapest unrelated one. If nothing in the pool shares a query token, the tool returns `ambiguous` rather than confidently guessing. (Brand/dietary remain soft preferences — this constraint is about identity, not preference.)

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

**Returns (ambiguous):** `candidates` is the **full** relevance-ranked set of fulfillable products for the term (every match the search returned, up to Kroger's per-request max of 50 — **not** truncated to a handful), so the LLM can browse/list them all and pick without issuing another search.
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

**Notes:** When ambiguous, the LLM picks from conversational context or asks the user; a standing "don't care" answer is recorded as `[]` in `preferences` `[brands]`. On `unavailable`, the LLM enumerates substitute candidates from world knowledge and resolves each (surfacing the alternatives for confirmation) — the matcher never substitutes itself. All resolutions feed back into the D1 SKU cache.

### `compare_unit_price(items)`

Deterministic price-per-unit comparison, used by the matching tiebreaker and when presenting ambiguous candidates. **The LLM never does the arithmetic** — it forwards raw `price` + `size` strings; the tool parses, converts units, and ranks.

**Params:**
- `items` (array): `[{ id, price, size, quantity_override?, unit_override? }]` — `size` is the raw Kroger size string (`"1/2 gal"`, `"16.9 fl oz"`, `"6 ct"`). Pass `quantity_override`/`unit_override` only for residue the parser couldn't handle (see `incomparable`).

**Returns:**
- `{ ranked: [{ id, unit_price, base_unit }], cheapest, incomparable: [id] }`

**Notes:** Ranks only WITHIN a dimension (volume / weight / count) — never compares `$/fl oz` to `$/lb`. Cross-dimension or unparseable items land in `incomparable`; the LLM may normalize an unparseable size into `quantity_override`/`unit_override` and re-call. Same deterministic core the matcher uses internally for step-5 tiebreaking.

### `ready_to_eat_available()`

Cross-reference the **caller's own** personal ready-to-eat catalog against current Kroger availability. "Available" means fulfillable via **curbside or delivery** at the preferred location (`fulfillment.curbside || fulfillment.delivery`) — the public Products API exposes no live in-store stock level. Each available item carries the **full list of fulfillable matching products** (relevance-ranked) so the agent can pick the right/cheapest one. An empty or absent catalog returns empty lists.

**Returns:**
- `{ available: { breakfast: [...{ name, slug, meal, products: [{ sku, brand, description, size, price, on_sale, available }] }], lunch: [...], dinner: [...] }, unavailable: [...{ name, slug, meal, catalog_sku }] }`

---

## Discovery tools

### `fetch_rss_discoveries()`

Fetch the **shared, group-wide** discovery feeds and return a **deduped candidate pool** — deduped against recipes already in the corpus (by canonicalized `source:` URL) and with tracking query strings stripped. **No taste score and no ranking**: the agent judges taste fit against the taste profile and picks the 1–2 worth importing (then `parse_recipe` + `create_recipe` each).

**Returns:**
- `{ candidates: [{ url, title, source, feed_weight, summary }], skipped?: [{ feed, reason }] }` — `source` is the feed name; `feed_weight` is the feed's configured trust hint (passed through, not used to rank); unreachable feeds are reported in `skipped`, not fatal.

**Notes:** Feeds are read from the **shared D1 `feeds` table** (not a per-tenant store) — discovery sources are a shared concern, so any member's feeds contribute to one group pool. An empty feeds table returns `{ candidates: [] }`. The pool excludes URLs the group has **rejected** via `reject_discovery` (the canonical URL is folded into the corpus-dedup set), so a suppressed discovery never reappears. There is no `fetch_flyer_featured` tool — Kroger exposes no "featured" primitive, so on-sale ready-to-eat discovery rides the existing `kroger_flyer` pre-pass (with ready-to-eat terms in the D1 `flyer_terms` table) plus agent-side dedup against the caller's D1 `ready_to_eat` catalog and `add_draft_ready_to_eat`.

### `read_discovery_inbox()`

Read the **shared email discoveries inbox** (the D1 `discovery_candidates` table) and return a list of forwarded newsletter emails. Each email has a `body` field containing its full plain-text content — **the agent reads the body and extracts recipe titles and links itself**. No pre-extraction: the Worker captures the email faithfully and the LLM does the parsing. Surface these alongside `fetch_rss_discoveries` at menu time (1–2 picks at most, never dominating). The push complement to RSS pull: it reaches bot-walled/paywalled sources (Serious Eats, NYT) that the Worker cannot fetch.

**Returns:**
- `{ emails: [{ from, subject, received_at, body }] }` — `from` is the sender address; `received_at` is the message date (YYYY-MM-DD or null); `body` is the plain-text email content for LLM parsing.

**Notes:** Absent or empty inbox returns `{ emails: [] }`. After scanning an email body for recipes, call `parse_recipe(url)` on each promising link — if it returns `unreachable`/`no_jsonld`/`not_a_recipe`, present the link and have the user paste the recipe text, then `create_recipe`. Candidates whose URL the group has **rejected** via `reject_discovery` are dropped (canonical match), so a suppressed discovery never resurfaces. The inbox is populated by the Worker's inbound-email handler (forwarded newsletters → `groceries-agent@<domain>`), not by any agent tool. Entries are auto-pruned after 30 days.

### `reject_discovery(url, reason?)`

**Shared, group-wide suppression** of a discovery URL — the third disposition (alongside import and no-action) in the meal-plan flow. Stops the URL (and its tracker-wrapped variants) from ever resurfacing in `fetch_rss_discoveries` or `read_discovery_inbox` for **anyone**.

**Params:**
- `url` (string, required): the discovery URL to suppress. Canonicalized (query/fragment/trailing-slash stripped) so a tracker-wrapped and a bare link suppress as one.
- `reason` (string, optional): free-text provenance ("not a recipe", "duplicate").

**Returns:**
- `{ url, rejected: true }` — `url` is the stored canonical form.

**Notes:** Use **only** when a candidate is not corpus-worthy **for the group** — junk, broken, not actually a recipe, a duplicate, or clearly off-base. Deliberately **asymmetric** with the per-tenant `favorite`: rejection is *collective curation* (the group curates one noisy stream once), so a personal "not for me this time" is a no-action **skip**, never a reject. Writes a row to the shared `discovery_rejections` table (canonical `url` PK; `reason`/`rejected_by`/`rejected_at` for provenance — `rejected_by` records who, but suppression is group-wide regardless). Idempotent on the canonical URL; a repeat refreshes the reason/provenance. Touches no recipe content or overlay.

### `update_discovery_sources(members?, senders?)`

Add trusted sources to the **shared** inbound-newsletter allowlist (the D1 `discovery_senders`/`discovery_members` tables). Use when a member sets up a forward or wants a newsletter indexed. Anyone trusted with this MCP is trusted to widen intake (no extra gate). Deduped by `address` — existing entries untouched.

**Params:**
- `members` (array, optional): `[{ address }]` — friend-group personal addresses; anything they forward to `groceries-agent@` gets indexed (manual-forward path). **Address only — no label** (`name` is not stored for members; identity is the address, not an agent-supplied display name).
- `senders` (array, optional): `[{ address, name? }]` — newsletter `From` addresses; auto-forwarded mail from them gets indexed. `name` is the **newsletter's** name (e.g. "Serious Eats"), never a person's.

**Returns:**
- `{ added: { members, senders } }` — counts actually added (0 when already present); D1-backed, no `commit_sha`.

**Notes:** Pairs with the inbound-email handler's auth gate — a listed `sender`/`member` is accepted only when the message also passes aligned DKIM (see `docs/SCHEMAS.md` → `discovery_sources`).

### `update_feeds(feeds)`

Add RSS/Atom feeds to the **shared** discovery config (the D1 `feeds` table, the pool `fetch_rss_discoveries` reads). **Add-only**, deduped by canonicalized `url` (existing feeds untouched) — the same posture as `update_discovery_sources`. Discovery feeds are a shared, group-wide concern, so anyone trusted with this MCP may widen the set.

**Params:**
- `feeds` (array): `[{ url, name?, weight?, tags? }]`. `url` is required; `weight` defaults to `1`. (`fetch_rss_discoveries` reads `url`/`name`/`weight`; `tags` are descriptive.)

**Returns:**
- `{ added }` — `added` is the count of new feeds; D1-backed, no `commit_sha`.

### `add_draft_ready_to_eat(items)`

Append ready-to-eat items to the **caller's own** personal ready-to-eat catalog. Each item is given a generated `slug` (unique within the catalog) and is **available (suggestible) immediately** — there is no draft/active state or activation step.

**Params:**
- `items` (array): `[{ meal, name, category?, source?, brand?, notes? }]` — `meal` is `breakfast | lunch | dinner`

**Returns:**
- `{ added: [{ meal, name, slug }] }` — D1-backed, no `commit_sha`

### `update_ready_to_eat(slug, updates)`

Disposition or otherwise update a ready-to-eat item in the caller's catalog, addressed by `slug`. Unknown slug returns a structured `not_found`.

**Params:**
- `slug` (string, required) — the item's stable key (from `add_draft_ready_to_eat`'s return or `ready_to_eat_available`)
- `updates` (object): `{ favorite?, reject?, name?, category?, brand?, notes? }` — `favorite` and `reject` are the booleans of the disposition model, **mutually exclusive** (setting one clears the other); there is no `status` or `rating`. A rejected item is no longer suggested by `ready_to_eat_available`.

**Returns:**
- `{ slug, updated_fields }` — D1-backed, no `commit_sha`

---

## Preference / config tools

### `read_user_profile()`

Read the caller's full per-tenant profile, assembled from the D1 profile tables in **one call** (a batched set of per-table reads), including initialization status. Returns all profile fields; absent fields are null/empty — never throws `not_found`.

**Params:** none.

**Returns:**
```
{
  initialized:     boolean,          // true once preferences field is non-empty
  missing:         string[],         // onboarding areas still absent: subset of
                                     //   ["store","taste","diet","equipment","ready-to-eat","stockup"]
  preferences:     { ... } | null,   // parsed preferences object (TOML)
  taste:           string | null,    // taste-profile narrative (markdown)
  diet_principles: string | null,    // diet-principles narrative (markdown)
  kitchen:         { owned: [...], notes: {...} },  // equipment inventory (empty when absent)
  staples:         [...],            // staples list — bare array (empty when absent)
  ready_to_eat:    [...],            // ready-to-eat catalog items (empty array when absent)
  stockup:         { ... } | null,   // bulk-buy watchlist (parsed TOML)
}
```

**Notes:** The single call for session start, meal-plan pre-pass, and configure-grocery-profile. On `initialized: false`, run the `configure-grocery-profile` flow first; use `missing` to skip areas already done. D1-backed (assembled from the per-tenant profile tables) — a missing profile returns all fields null/empty. Kitchen `owned` is the array of `EQUIPMENT_VOCAB` slugs that **gate** recipe makeability; an **absent/empty** `owned` makes the gate a no-op (everything shows).

### `update_preferences(patch)` / `update_taste(content)` / `update_diet_principles(content)` / `update_aliases(aliases)`

Write user-curated config. `update_taste`/`update_diet_principles` are content-faithful (write the supplied full markdown to the D1 `profile` row, no `commit_sha`). `update_aliases` **upserts** variant→canonical ingredient mappings into the shared **D1 `aliases` table** (where the matcher reads them), keyed by variant — add/edit, no removal (`{ updated }`, no `commit_sha`). **`update_preferences` is a deep merge-patch**, not a whole-object write. **These should only be called when the user explicitly directs an edit.**

**Params:**
- `update_preferences`: `patch` (object, required) — a **JSON Merge Patch (RFC 7396)** over the caller's preferences: a present key sets/overwrites, `null` deletes, nested objects merge to **any depth**, arrays replace wholesale. Only the keys you touch change — a partial patch never clobbers siblings, so you do **not** re-send the whole object. Defined top-level keys: `default_cooking_nights` (number), `lunch_strategy` (`leftovers`|`buy`|`mixed`), `ready_to_eat_default_action` (`opt-in`|`auto-add`), `stores` (`{primary, preferred_location, location_zip}`), `brands` (map of term → ranked brand list; `[]` = don't-care/cheapest, `null` = clear back to ambiguous), `dietary` (`{avoid[], limit[]}`), `rotation` (`{resurface_after_days, novelty_boost}` — tunes the `search_recipes` freshness re-rank; both positive numbers). Anything else nests under `custom`; an unknown top-level key returns `validation_failed` (nest it under `custom`). A type-invalid merged result returns `malformed_data` and stores nothing. Applied atomically to the D1 `profile` row + `brand_prefs` rows.
- `update_taste` / `update_diet_principles`: `content` (string, required) — the complete new field text
- `update_aliases`: `aliases` (object, required) — a map of variant → canonical, e.g. `{ "EVOO": "olive oil" }`; each is upserted by variant

**Returns:**
- `update_preferences` / `update_taste` / `update_diet_principles`: `{ updated: "<field>" }` — D1-backed, no `commit_sha`
- `update_aliases`: `{ updated }` — count upserted; D1-backed, no `commit_sha`

---

## Guidance tools

Reads + one gated write over the shared, curated `guidance/` trees, organized by **domain** subdirectory:

- **`ingredient_storage`** — opinionated put-away advice keyed by storage **class** (`tender-herbs`, `alliums`, …), with a few singletons (`basil`, `tomatoes`, `avocados`) and a relational `_ethylene` file. **Read-only**: hand-maintained, edit-when-directed curated config.
- **`cooking_techniques`** — general cooking-technique memories keyed by **technique** (`browning-meat`, `searing`, `resting-meat`, …). **Agent-writable** via `save_guidance` (the member posts an article/technique; the agent distills it). One file per technique — refining overwrites, never appends.
- **`purchasing`** — buy-side selection advice keyed by **product/item** (`canned-tomatoes`, `olive-oil`, …): *what kind to get* plus the non-obvious *how to tell if it's good/ripe* judgments. **Agent-writable** via `save_guidance` (the member posts a buying guide / taste test; the agent distills it). One file per item — refining overwrites, never appends.

The agent maps a just-bought item, a recipe step, or a thing on the grocery list to the right slug with its own world knowledge over the semantic slugs (no manifest); over-fetching is harmless. See `docs/SCHEMAS.md` for the trees and the AGENT_INSTRUCTIONS put-away/cook/shop/capture rules for when these fire.

### `list_guidance(domain?)`

List the available guidance slugs. Pass `domain` for one corpus, or omit it for every domain grouped.

**Params:**
- `domain` (string, optional) — `"ingredient_storage"`, `"cooking_techniques"`, or `"purchasing"`. Omit to list all.

**Returns:**
- With a `domain`: `{ domain, entries: [{ slug, description? }] }` — one entry per `guidance/<domain>/*.md` file; `slug` is the filename without `.md` (e.g. `tender-herbs`, `_ethylene`, `browning-meat`); `description` is the optional one-line summary from the file's `description` frontmatter.
- Without a `domain`: `{ domains: [{ domain, entries }] }` — every domain grouped.
- An absent tree yields an empty listing (not an error). An unknown domain yields `{ error: "validation_failed", domain }`.

### `read_guidance(domain, slugs)`

Read the content of the named guidance entries within a domain.

**Params:**
- `domain` (string, required) — `"ingredient_storage"`, `"cooking_techniques"`, or `"purchasing"`.
- `slugs` (array of strings, required) — the slugs to read (from `list_guidance`).

**Returns:**
- `{ domain, entries: [{ slug, content }] }` — `content` is the file's full markdown (frontmatter + prose).

**Notes:** An unknown (or malformed) slug yields a structured `{ error: "not_found", slug }`; an unknown domain yields `{ error: "validation_failed", domain }`. Contested/folklore tips are pre-hedged in the prose — relay them with their hedge, never as settled fact. No matching entry for a bought item / cook step → offer no tip (silence over invention).

### `save_guidance(domain, slug, content, source?)`

Create or **refine** a single guidance memory. Gated by a **writable-domain allowlist**.

**Params:**
- `domain` (string, required) — must be on the writable allowlist (`"cooking_techniques"` or `"purchasing"`). A write to `"ingredient_storage"` (curated, read-only) or any unknown domain is rejected.
- `slug` (string, required) — kebab-case slug for the technique or product/item (e.g. `browning-meat`, `olive-oil`); no leading underscore, no path traversal.
- `content` (string, required) — the **full markdown** the agent composes: distilled, imperative, non-obvious advice with a one-line `description:` frontmatter — NOT the verbatim article.
- `source` (string, optional) — provenance (e.g. an ATK/Serious Eats URL), recorded into the file's frontmatter.

**Returns:**
- `{ domain, slug, path, commit_sha }` — `path` is `guidance/<domain>/<slug>.md`; the write is one atomic commit (the shared commit engine, same path as `create_recipe`).

**Notes:** There is exactly one file per slug — saving an existing slug **overwrites/refines** it (read the existing entry first and merge; never accumulate duplicates). A write to a non-allowlisted/unknown domain, an empty `content`, or a malformed slug yields `{ error: "validation_failed", … }` and commits nothing — this allowlist is how `ingredient_storage` stays read-only.

---

## Retrospective / analysis tools

### `retrospective(period)`

Aggregate **real** cooking history from the D1 `cooking_log` table over a period, joining `type=recipe` rows to the `recipes` table for protein/cuisine (a `cooking_log LEFT JOIN recipes` + COALESCE).

**Params:**
- `period` (string, optional, default `"month"`): `"Nd"` (e.g. `"30d"`) | `"week"` | `"month"` | `"quarter"` | `"year"` | `"all"`.

**Returns:**
```
{
  period, window: { from, to, days },                  // period scopes the next five fields only
  recipes_cooked:   [{ recipe, count, dates }],   // distinct recipes, with per-cook dates
  protein_mix:      { <protein>: count },          // counts EVERY cook event; non-recipe entries via inline dims; missing → "unknown"
  cuisine_mix:      { <cuisine>: count },
  cadence:          { cooks, weeks, cooks_per_week },   // counts recipe + ad_hoc only (ready_to_eat is not cooking)
  cook_vs_convenience: { cooked, convenience },         // cooked = recipe + ad_hoc; convenience = ready_to_eat
  ready_to_eat_favorites: [{ name, count }],            // frequency-ranked; feeds menu-flow restock suggestions
  underused:        [{ slug, title, last_cooked, why, cook_count }],  // loved & quiet & in-season; ≤15, stalest first
  underused_count:  <number>                            // total qualifying before the 15-item cap
}
```

**Notes:** `last_cooked` is derived (see `log_cooked`) — `MAX(date)` over the caller's `type=recipe` rows. **`underused` is independent of `period`**: it surfaces **loved** recipes — `favorite === true` (declared) **or** cooked **≥3× in the trailing 12 months** (revealed) — that are **stale** (`last_cooked` null, or older than a **fixed 30 days**) and **in season** now (the recipe's `season` is `[]`/year-round or includes the current Northern-hemisphere season; matched case-insensitively with `autumn`≡`fall`). Rejected recipes are excluded. `why` is `"favorite"` or `"revealed"`; `cook_count` is the all-time cook count (for the revival nudge). The list is sorted never-cooked-first then oldest `last_cooked` and capped at 15 — `underused_count` reports how many qualified. Eating out is never logged; leftovers of an already-logged cook are not re-logged.

### `log_cooked(entry)`

Append one cooking event to the caller's `cooking_log` (D1-backed; **no `commit_sha`**).

**Params:**
- `type` (string, required): `recipe | ready_to_eat | ad_hoc`.
- `date` (string, optional): ISO `YYYY-MM-DD`; defaults to today.
- `recipe` (string): the recipe slug — **required** for `type=recipe`; it MUST resolve against the D1 `recipes` table.
- `name` (string): the dish name — **required** for `ready_to_eat | ad_hoc`.
- `protein`, `cuisine` (string, optional): inline dimensions for a non-recipe entry (so it still counts in `retrospective` mixes). Recipe entries take their dims from the recipe, not here.

**Returns:**
- `{ logged: { date, type, recipe?, name?, protein?, cuisine? } }` — no `commit_sha`.

**Notes:** Validated at write time — a bad date/type or a missing required field is `validation_failed`; an unknown recipe slug is `not_found`, written nowhere. **Auto-clears:** a `type=recipe` entry also removes the cooked slug from the caller's D1 meal plan (`meal_plan` table) so the plan stays current. Never set `last_cooked` via `update_recipe` — logging a recipe here updates its effective `last_cooked` automatically (it's derived by query). Ready-to-eat consumption is a `{ type: "ready_to_eat", name }` entry; use `update_pantry` to remove any pantry stock when the user used the last of it.

### `read_meal_plan()`

Return the current meal plan — recipes committed to cook next (transient cook intent, D1-backed). Use at session start to resume.

**Params:** none.

**Returns:**
- `{ planned: [{ recipe, planned_for, sides? }] }` (`planned_for` may be null; `sides` is an optional array of free-text open-world side names riding on the main's row)

**Notes:** The session-start stale-planned reconcile surfaces only **due** rows (`planned_for` on/before today, or unset). D1-backed (`meal_plan` table); a missing/empty table reads as empty.

### `update_meal_plan(ops)`

Add or remove planned meal entries. D1-backed — no commit, no `commit_sha`.

**Params:**
- `ops` (array): `[{ op: "add" | "remove", recipe, planned_for?, sides? }]`
  - `add` upserts by recipe slug (updating `planned_for`, merging open-world `sides`); `remove` drops all rows for the slug.

**Returns:**
- `{ applied: [...], conflicts: [...] }` — D1-backed, no `commit_sha`; each applied entry has `{ op, recipe }`; conflicts include the reason.

**Notes:** Called after the user confirms a menu (add rows), and during cook-capture or the stale-planned reconcile (remove rows). `log_cooked` also auto-removes a cooked recipe from the meal plan. A **corpus** side (a `course: side` recipe) gets its own `add` row; open-world sides ride on the main's `sides` field.

---

## Order placement

### `place_order(payload)`

The order-time flush — the **only** tool that writes a Kroger cart. Resolves the whole to-buy set against *current* Kroger availability, writes the cart (`PUT /v1/cart/add`), and caches learned ingredient→SKU mappings to the shared SKU cache. Backed by the Kroger `authorization_code` + PKCE user-context client and the KV-backed rotating refresh token.

**To-buy set (order-time dedup):** `grocery_list ∪ menu_needs − pantry_has`. Only `active` list items participate. A name present in the pantry is **not** silently dropped — it returns in `partials` for you to prompt on, and is bought only if the user confirms it via `include_partials` (the no-auto-decide rule). Default buy quantity is **1 package** per item unless overridden.

**Quantity (package count):** supply it per item via `menu_needs[].quantity`, or via the `quantities` map; the `quantities` map **overrides** `menu_needs[].quantity` when both are present (precedence: `quantities` → `menu_needs[].quantity` → default 1). A line that fell back to the default carries `assumed_quantity: true`. The tool reports that fact but does **not** classify "by-the-each produce" or do portion math — at `preview`, *you* reconcile any `assumed_quantity` by-the-each produce (peppers, tomatillos, …) against the recipe's required amount and set an explicit quantity before the real flush. (`grocery_list` items' string `quantity` like "2 lbs" is a human need-annotation, not a package count.)

**Resolution + checkpoint:** each item runs through the [matcher](#match_ingredient_to_kroger_skuingredient-context) with cache revalidation (a cache hit no longer fulfillable is re-resolved). Items the matcher returns as `ambiguous` or `unavailable` are collected into a single `checkpoint` and are **not** added to the cart. Disposition them and re-call with `overrides` — already-carted items have advanced to `in_cart`, so they won't be re-added.

**`overrides` — force a specific SKU (disposition *or* lock a deal):** `[{ name, sku, brand?, size? }]` pins a chosen SKU for a line, bypassing the matcher. Use it two ways: to **disposition** an ambiguous/unavailable item, or to **lock a SKU you verified** — e.g. the on-sale `sku` returned by [`kroger_prices`](#kroger_pricesingredients-location_id) — so the deal's exact SKU survives into the cart instead of the matcher picking its own. A forced SKU is **revalidated** for current curbside/delivery availability and returned with **fresh** `price`/`on_sale` (so a deal that lapsed since you checked is visible); a forced SKU that has gone **unavailable** is routed to `checkpoint` rather than blind-carted. **Overrides pin the SKU, not the price:** the cart write (`PUT /v1/cart/add`) carries only SKU + quantity — no price — so whether a sale price actually realizes is Kroger's determination at fulfillment, against flyer data that may be hours-stale. Don't promise the user a locked price; surface the fresh `on_sale` at `preview` and let them decide.

**Params:**
```
{
  menu_needs:       [{ name, quantity?, for_recipes? }],  // needs not yet on the list (quantity: 1–99 integer)
  quantities:       { "<name>": <packages> },             // per-item package count, 1–99 integer (default 1)
  include_partials: ["<name>", ...],                       // pantry items the user confirmed buying anyway
  overrides:        [{ name, sku, brand?, size? }],        // force a SKU: disposition, or lock a verified/on-sale SKU
  preview:          bool                                    // resolve + report only; no cart write, no commits
}
```
All sections optional. With no args it flushes the current grocery list. Package counts (`quantities` and `menu_needs[].quantity`) must be positive integers ≤ 99 — a fractional, zero, or oversized value is rejected before any cart write (`place_order` is the only tool that writes a real Kroger cart).

**Returns:**
```
{
  resolved:  [{ name, sku, brand, size, quantity, assumed_quantity, price?, on_sale? }],  // assumed_quantity: qty defaulted to 1; price/on_sale: fresh at resolution
  checkpoint:[{ name, kind: "ambiguous"|"unavailable", candidates?, message }],
  partials:  [{ name, for_recipes }],
  sku_cache: { committed, error? },
  cart:      { written, count?, error?, code? },   // code carries reauth_required etc.
  list:      { advanced, error? },        // D1-backed (no commit_sha)
  preview:   bool
}
```

**Partial-failure honesty:** the SKU-cache commit and the cart write are **independent best-effort** operations (the SKU cache is a pure hint). Order: commit the cache → write the cart → advance the list to `in_cart` *only after a successful cart write*. So a cart failure leaves the list `active` (retryable, no silent drop) and **never** reports a populated cart; a cache-commit failure after a successful cart just re-resolves next time. If the cart write fails because the Kroger refresh token was rejected, `cart.code` is `reauth_required` — re-run the one-time `/oauth/init?tenant=<id>` (see `docs/SELF_HOSTING.md`).

**Lifecycle (`active → in_cart → ordered → received`):** `place_order` sets `in_cart`. Because the cart API is write-only and unreadable, the transitions past `in_cart` are **user-asserted**, never agent-verified:
- *"I placed the order"* → advance `in_cart` items to `ordered` via `update_grocery_list`.
- *"I picked up the groceries"* → `received` (terminal): `remove_from_grocery_list` for each, and for `grocery`-kind items only, restock the pantry via `update_pantry`. `household`/`other` items don't touch the pantry.

A **stale-cart reminder** fires when a new order begins while the prior list still has `in_cart` items never confirmed `ordered`: remind the user to clear the Kroger cart manually (the API can't), rather than silently double-adding.

---

## Weather tools (menu-generation)

### `get_weather_forecast(days?)`

Fetch a daily weather forecast for the user's location. Read-only, no side effects. Used by the meal-plan flow as silent context for weather-appropriate recipe selection.

**Params:**
- `days` (number, optional): number of forecast days to return; default 7, clamped to 1–16.

**Returns:**
```json
{
  "location": "Fort Worth, Texas",
  "forecast": [
    {
      "date": "2026-06-15",
      "high_f": 95,
      "low_f": 78,
      "precipitation_chance": 5,
      "condition": "clear",
      "meal_vibes": ["grill-friendly", "light"]
    }
  ]
}
```

- `condition`: one of `clear | partly_cloudy | overcast | rainy | snowy | stormy` (derived from WMO weather code).
- `meal_vibes`: deterministic hints derived in the Worker from temperature/precipitation thresholds. An empty array means no strong signal.

  | Condition | `meal_vibes` added |
  |---|---|
  | precipitation_chance ≥ 60% | `no-grill`, `comfort` |
  | high_f < 55°F | `soup`, `comfort` (deduped) |
  | high_f ≥ 80°F AND precipitation_chance < 30% | `grill-friendly` |
  | high_f ≥ 85°F | `light` |

**Location resolution:** checks `preferences.location_zip` first; falls back to parsing a 5-digit ZIP from `preferred_location` (`"Kroger - 76104"` → `"76104"`). No operator config or API key required (uses Open-Meteo).

**Errors (structured):**
- `{ error: "no_location" }` — no ZIP resolvable from preferences; agent asks once and stores to `location_zip`.
- `{ error: "forecast_unavailable" }` — Open-Meteo returned non-2xx or network failure.
- `{ error: "no_results" }` — geocoding found no match for the location string.

**Notes:** All errors are best-effort — the meal-plan flow continues with season-based reasoning on any error. The agent SHALL NOT narrate weather-based reasoning unless the user asks.

---

## Bug reporting (agent-bug-reporting)

### `report_bug(title, body)`

Files a bug report as a GitHub issue on the operator's **private data repo** (where the App is installed), on behalf of a member who has no GitHub account and can't file issues themselves. The Worker adds attribution it controls — the caller's `username`, a UTC timestamp, and the `agent-reported` label — so identity can't be omitted or spoofed by the agent. Returns `{ url, number }`.

**Errors:** `insufficient_permission` (the App lacks `Issues: write` — see [`SELF_HOSTING.md`](SELF_HOSTING.md)); `upstream_unavailable` (GitHub unreachable). The agent relays either to the user rather than implying it filed.

Behind the per-tenant gate; the only tool that writes GitHub Issues. Driven by the agent's `report-grocery-agent-bug` skill, which fires on an unworkable tool error or repeated user correction, files at most one issue per distinct problem per session, then tells the user it flagged it.

---

## What this surface deliberately does NOT include

- No raw GitHub write access (atomic commits only)
- No raw Kroger API access (matching pipeline + cart write only)
- No "search arbitrary text across recipes" (use GitHub MCP for that)
- No "execute arbitrary code" or "run arbitrary script"
- No portion math (no whiteboard problem)
- No background or scheduled triggers

---

## Harness-provided widgets (NOT MCP tools)

These are **claude.ai built-ins**, not part of `grocery-mcp`. They are exposed by the Claude.ai harness, are invisible to the Worker, and appear in the agent's tool set only where the harness exposes them. A skill that uses one MUST guard on its presence and degrade when it is absent — see the guided `cook` flow in [`AGENT_INSTRUCTIONS.md`](../AGENT_INSTRUCTIONS.md). They are documented here so the contract a skill encodes has a single anchor, not because they belong to this surface.

### `recipe_display_v0`

Renders an interactive recipe card: a servings-scalable ingredient list and a tappable, timer-bearing step list. The guided `cook` flow emits one to scaffold the prep + cook half of the walkthrough.

**Parameters:**

- `title` (string, **required**) — recipe name.
- `ingredients` (array, **required**) — each:
  - `id` (string, **required**) — 4-char zero-padded string by convention (`"0001"`, `"0042"`), referenced from step text.
  - `amount` (number, **required**) — quantity **at `base_servings`** (the widget scales it proportionally).
  - `name` (string, **required**) — display name; fold counting nouns in here (`"garlic cloves"`, not `"garlic"` with a `clove` unit).
  - `unit` (string, optional) — one of `g | kg | ml | l | tsp | tbsp | cup | fl_oz | oz | lb | pinch`. Omit for countable items. For seasonings, give a concrete amount in `tsp` rather than a vague count.
- `steps` (array, **required**) — each:
  - `id` (string, **required**) — unique step identifier.
  - `title` (string, **required**) — short summary; used as the timer label and step header.
  - `content` (string, **required**) — full instruction text; reference ingredients inline with `{ingredient_id}` syntax so amounts update when servings scale.
  - `timer_seconds` (int, optional) — include for **any** step involving waiting (cooking, baking, resting, marinating, simmering, chilling, preheating). Omit only for active hands-on steps with no waiting.
- `base_servings` (int, optional) — defaults to `4`.
- `description` (string, optional) — tagline or brief description.
- `notes` (string, optional) — tips, variations, additional context.

**Behavioral contract:**
- The widget scales all ingredient amounts proportionally when servings are adjusted — which only works if `amount` is always the numeric quantity at `base_servings` and step text uses `{ingredient_id}` refs rather than hardcoding amounts.
- `unit` is absent for countable items — the counting noun goes in `name` instead (don't write `amount: 3, name: "garlic", unit: "clove"`).
- Timers are meant to be comprehensive — include one whenever a step involves any waiting, not just the "main" cook step.
- `id` on ingredients is a 4-digit zero-padded string by convention (`"0001"`, `"0042"`), not arbitrary.

The agent never *starts* a timer — in card-tap mode the user taps the step's native timer; in voice mode the user sets their own. Voice-mode timer control is a future seam (issue #87) and not relied upon.
