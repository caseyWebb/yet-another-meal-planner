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

Find recipes in the corpus. Takes an array of search **specs** and returns one result group per spec, in one round-trip. Each spec applies its `facets` as the hard gate over the caller's available corpus (whole shared corpus + the caller's personal recipes − the caller's rejects); a spec's optional `vibe` picks the mode. **Without a vibe (membership):** returns every survivor, unranked, **including not-yet-embedded recipes**, uncapped by `k` — the named-dish / browse path. **With a vibe (ranked):** embeds the vibe and ranks the embedded survivors by cosine, re-ranked by taste and freshness; unembedded survivors are dropped and the top-`k` returned. Backend-agnostic ranking: the middle leg is a brute-force cosine over a D1 `recipe_derived` join today; a future Vectorize swap is invisible to the caller. Reads the index (`src/recipe-index.ts`); ranked specs additionally read the embeddings (`recipe_derived`), the caller's overlay / cooking log / preferences, and the alias table. An empty table returns empty result groups; an unreadable table returns `index_unavailable`.

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
- `course` (string): the **open-vocabulary** dish-type facet (`main | side | dessert | breakfast | component | …` — `component` is a sub-recipe/building block like a dough or stock), matched by **containment** — `course: "side"` returns every recipe whose `course` array includes `side`, including a dual-use `[main, side]` dish. Matched literally against the normalized index (no controlled set). One vibe-less faceted spec returns mains and sides together (each entry's `frontmatter` carries `course`); the caller buckets by `course`. `search_recipes` applies **no default course gate** — it is an explicit-query tool, so a caller asking for sides/sauces/components keeps getting them (the default main-course gate belongs to the suggestion surfaces: `propose_meal_plan`'s pools and the app's picked-for-you/trending rows).
- `query` (string): the single name/keyword search over `title` **and** `tags`. Tokenize on whitespace, drop connective stopwords (`and`, `or`, `with`, `the`, `a`, `an`, `of`, `in`, `on`, `for`, `&`), then keep a recipe when **every** remaining token is a case-insensitive substring of its `title` or any `tag` (token-AND). Deterministic membership only — no ranking. So `"chicken and rice"` ≡ `"chicken rice"` and surfaces a recipe titled "Chicken and Rice" even when its tags omit "rice". Pair with a **vibe-less** spec for named-dish lookup so the match set is exhaustive and a just-imported recipe is included.
- `exclude_cooked_within_days` (number): drop recipes cooked within the last N days. `not_cooked_since` (date): recipes with `last_cooked: null` (never cooked) **pass**.
- **Ranked mode — facet gate first, then cosine.** Hard constraints are applied by the same `filterRecipes` gate as membership mode (including makeability); cosine only ranks the survivors.
- **Ranked mode — re-rank = cosine + three small nudges.** `+ favoriteWeight · max cosine to any favorited recipe` (taste *direction* — nearest-liked, not a centroid; no-op on cold start), `+ freshness` (never-cooked surfaced by `novelty_boost`; cooked-within-`resurface_after_days` linearly demoted), and `+ pantry overlap` (below). The nudges are deliberately small relative to cosine. Favorites are the caller's `favorite`-flagged recipes (set via `toggle_favorite`); `rotation.{novelty_boost,resurface_after_days}` come from preferences, defaulting when unset.
- **Ranked mode — pantry overlap = two-tier, saturating, perishable-weighted.** For each `boost_ingredient`, a hit on the recipe's `perishable_ingredients` (the waste-prevention win) counts more than a hit on only its `ingredients_key`; the weighted sum saturates and scales by a small weight. Boost items and ingredient lists are alias-normalized before exact set-overlap — synonym recall depends on the alias table, **not** on ingredient embeddings. The weights are fixed constants today.
- **Ranked mode — unembedded recipes are dropped.** A just-imported recipe whose embedding the cron hasn't reconciled yet is excluded from a ranked group (not an error) — it stays findable via a **vibe-less** membership spec until the next reconcile.
- **One round-trip, at most one embedding call.** All vibe-bearing specs embed through the shared **query-embedding cache** (see `docs/SCHEMAS.md`) — cached phrases (recently embedded by either this tool or `propose_meal_plan`) cost no AI request, and the misses batch into a single Workers AI call; a batch of only vibe-less specs makes **no** AI request. Pass several diverse vibe specs (a vibe, a variety/wildcard, a never-cooked novelty) for recall rather than many calls.

### `read_recipe(slug)`

Read a single recipe's full content (frontmatter + body).

**Params:**
- `slug` (string, required)

**Returns:**
- `{ slug, frontmatter, body }` — `frontmatter` includes the objective shared fields, among them `perishable_ingredients` (a normalized list of the recipe's perishable ingredients; empty when absent), `course` (the open-vocabulary dish-type array — `main | side | dessert | breakfast | component | …`; empty when absent), and `pairs_with` (slugs of suggested corpus sides), plus the AI-generated `description` (merged from the derived `recipe_derived` store; absent until the reconcile first generates it). The `perishable_ingredients` and `course` fields also ride each entry's `frontmatter` from the index-backed `search_recipes`, so the menu-gen waste callout and the mains/sides faceting reason over them without any extra tool.

### `recipe_site_url()`

Resolve the URL of the hosted cookbook (the static browse view of the shared corpus), served by the **grocery-mcp Worker itself** at `<host>/cookbook` — built from the D1 index + the R2 corpus (`src/cookbook.ts`), no GitHub Pages and no GitHub App token. No parameters; never writes. Used in onboarding to point a member at the full corpus.

**Returns:**
- `{ url, enabled }` — `enabled: true` with `<host>/cookbook` (the operator's domain the member connected to) when the host is resolvable; `{ url: null, enabled: false }` on the rare path where it isn't.

**Notes:** No GitHub Pages, no GitHub Pro, no permission grant — it cannot return `insufficient_permission`. On the `enabled: false` path the cookbook just couldn't be addressed; surface the corpus another way (e.g. `search_recipes`) rather than pointing at a URL.

### `read_reconcile_errors()`

List the recipes the index reconcile **SKIPPED** because they failed validation — the shared corpus's current indexing failures. The recipe index is rebuilt from the R2 corpus by a **background reconcile**; a recipe whose frontmatter breaks the required-field/vocabulary contract, is missing a `## Ingredients`/`## Instructions` body section, duplicates another slug, or has a dangling `pairs_with` is **NOT indexed** (so it won't appear in `search_recipes`) and is recorded here with the first actionable error. No parameters; **shared** across the group; never writes.

**Returns:**
- `{ errors: [{ slug, path, message, recorded_at }] }` — one entry per skipped recipe; `message` is the first actionable error (e.g. `` `thai-curry`: `protein: poltry` isn't a valid value``), `path` its R2 object path. An **empty list** means every recipe indexed cleanly.

**Notes:** Use it when a member reports a recipe they authored/edited (e.g. via Obsidian) isn't showing up, or proactively after a bulk edit — then relay the specific fix so they can correct the source.

### `read_satellite_rejections(source?)`

List a satellite's recently **REJECTED** observations — the source-audit rear-view mirror (satellite-source-audit). A satellite is a member's home helper that scrapes recipes / scans a non-Kroger store's sale flyer / fills a store cart; the Worker re-validates everything it sends and **DROPS** what fails. This read reflects **only rejected** observations — an accepted one **NEVER** appears (so an empty `rejections` means everything the satellite sent lately landed cleanly). Bounded, most-recent-first; never writes. **Visibility:** recipe and sale rejections/quarantines are operator-global (**shared** across the group), but `order`-kind rows are per-member **PRIVATE** (order-fill is a member's own store cart) — the caller sees only their own order rejections, never another member's. The optional `source` filters to one exact source (a feed/site for recipe, a store slug for sale/order).

**Returns:**
- `{ rejections: [{ kind, source, origin, reason, provenance, count, rejected_at }], quarantined: [{ kind, source, quarantined_at }] }`.
  - `kind` is `recipe` | `sale` | `order`; `source` is the feed/site (recipe) or the store slug (sale/order).
  - `origin` is `worker` (rejected by the Worker at intake — a bad shape, a wrong-endpoint item, or a **quarantined** source with `reason: "quarantined"`) or `local` (a satellite-reported, pre-aggregated summary of what its own validators dropped before the wire — `reason` is the reported category).
  - `count` is `1` for a Worker reject or `N` for a pre-aggregated local-summary entry; `provenance` is the offending url/id or a redacted sample.
  - `quarantined` lists the sources an operator has flagged as a Worker-side reject (their observations are dropped at intake until un-flagged), scoped to the same visibility rule as `rejections`.

**Notes:** Use it when a member says their satellite's recipes/sales aren't showing up: read it and relay the **specific defect** (e.g. "seriouseats: 12 items failed as `contract_invalid` in the last day — the adapter likely broke"). It is a health gauge, not a security boundary (the satellite runs on the operator's own network under the operator's own session; the audit trusts its honesty and reports operational breakage, not lies).

### `update_recipe(slug, updates)`

Edit a recipe's **objective shared content** (frontmatter/body) — the same recipe everyone in the group sees. `favorite`/`reject` are NOT settable here (they are the caller's personal disposition — use `toggle_favorite` / `toggle_reject`), nor is `last_cooked` (derived from the cooking log — record a cooked meal via `log_cooked`).

**Params:**
- `slug` (string, required)
- `updates` (object): partial objective frontmatter to merge (title, protein, cuisine, course, tags, dietary, pairs_with, perishable_ingredients, …)

**Returns:**
- `{ slug, updated_fields }` — confirmation of what was changed (`updated_fields` is `[]` when nothing was passed to change). **No `commit_sha`** — the recipe is a single R2 object, not a git commit.

**Notes:** Objective-only — it writes the shared recipe's R2 object and nothing else. `favorite`/`reject` (and `status`/`rating`) are rejected with `validation_failed` (the message names `toggle_favorite`/`toggle_reject`), and `last_cooked` is rejected toward `log_cooked`; `description` is rejected too (it is AI-generated from the recipe's facets and stored in `recipe_derived`, not authored). The **merged** result must satisfy the full required-field contract (the same one `create_recipe` enforces) — a one-field patch on a compliant recipe succeeds, but a patch that empties a required field (e.g. `ingredients_key: []`) or sets an off-vocab `protein`/`cuisine`/`requires_equipment` value is rejected (`validation_failed`) and nothing is written. `read_recipe`/`search_recipes` merge the caller's overlay (favorite/reject, set via `toggle_favorite`/`toggle_reject`) and cooking-log `last_cooked` onto shared content at read time; an absent overlay row means **neutral (available)** — `favorite: false`, `reject: false`. `perishable_ingredients` is objective shared content, so an edit to it writes the shared recipe; the Worker normalizes the names on write (the same `normalizeIngredient` the Kroger matcher uses) so cross-recipe overlap lines up. For no protein focus set `protein: null` (never omit, never `none`). **`duplicate_of`** is the operator-merge tombstone (`recipe-dedup`): a non-empty string naming the surviving recipe's slug, written through this tool's pass-through frontmatter as the final step of the agent-guided review of a `merge_recipes` proposal (fold what's worth keeping into the survivor, re-point `pairs_with` referrers, mark, then confirm). A marked recipe is deliberately excluded from the projected index on the next tick (no `reconcile_errors` entry) while its R2 file, notes, and cooking history stay intact; removing the field restores it. Only write it inside that confirmed merge flow.

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

**Parse-only.** Fetch a recipe page, extract its schema.org `Recipe` JSON-LD, and return the structured data. Writes nothing — the agent cleans/classifies the data, assembles the markdown body, then persists via `create_recipe`.

**Params:**
- `url` (string, required)

**Returns:**
- `{ title, ingredients: [...], instructions: [...], servings, time_total, time_active, source, tools_hint?, existing_slug? }` — `ingredients`/`instructions` are string arrays; `servings` is a scalar (number when parseable); `time_total`/`time_active` are minutes or null; `source` is the recipe's canonical URL. **`tools_hint`** (present only when the page carries a schema.org `tool`) is the flattened tool-name list — a **non-authoritative hint** for classifying `requires_equipment`, never copied into it (it lists every utensil; default `requires_equipment` to `[]` and tag only truly-irreplaceable gear). **`existing_slug`** is present only when this source URL is **already in the shared corpus** (idempotent import) — reuse that recipe (rate it, note it) instead of calling `create_recipe`.

**Errors (structured):**
- `{ error: "unreachable" }` — the page couldn't be fetched (network error or non-2xx). Bot-walled/paywalled sites (Serious Eats, NYT, Food52) land here — paste the recipe instead. A URL the egress guard refuses (a non-`http(s)` scheme, embedded credentials, a private/loopback/link-local host, or a redirect into one) also returns `unreachable` with **no** status — indistinguishable from a dead host, so it can't be used to probe internal reachability.
- `{ error: "no_jsonld" }` — no `<script type="application/ld+json">` on the page.
- `{ error: "not_a_recipe" }` — JSON-LD present but no schema.org `Recipe`.
- `{ error: "incomplete", missing: [...] }` — a `Recipe` was found but yielded no ingredients and/or no instructions.

**Notes:** Handles JSON-LD in `@graph`, top-level arrays, multiple script blocks, `@type` as string or array, and instructions as `HowToStep`/`HowToSection`/plain strings (`HowToTip` notes are skipped). The agent owns the judgment fields (protein, cuisine, tags, dietary, `ingredients_key`, `meal_preppable`) when assembling frontmatter for `create_recipe`.

### `create_recipe(frontmatter, body, slug?)`

Write a **new** recipe to the **shared corpus** (read by everyone), from agent-assembled frontmatter + body, as **one R2 object**. The slug derives from the title's **dish name** — any parenthetical gloss is excluded from the slug basis ("Jatjuk (Pine Nut Porridge)" → `jatjuk`, with the gloss kept in the `title`; a title that is *only* a parenthetical falls back to the full-title basis) — unless `slug` is supplied. The body MUST contain `## Ingredients` and `## Instructions` H2 sections (guarded — a body missing them is rejected, never written). A recipe is shared and single-source: if the `source` URL is already in the corpus, the write is refused (`already_exists`) so the existing recipe is reused, not duplicated.

**Params:**
- `frontmatter` (object, required) — recipe frontmatter. The **descriptive facets are derived on the cron** (`recipe-facet-derivation`), so you author only the gates + identity: **required** `title`; `source` (URL or `null`); `time_total` (number or `null`); `dietary` and `requires_equipment` (the two **hard gates** — author them; may be `[]`); `pairs_with` (may be `[]`). You **may** supply `protein`/`cuisine`/`course`/`season`/`tags` as an optional authored **override** (vocab-validated; wins over the classifier; `tags` is unioned) but needn't — the classify pass and the import seed fill them. `ingredients_key`/`perishable_ingredients`/`side_search_terms`/`meal_preppable` are derived (a supplied value is only a legacy fallback). Other fields are free-form. **No `status`** is stamped — an imported recipe lands available to the group by default. Discovery imports should set `discovered_at`/`discovery_source`. `description` is **not** an input — it is AI-generated and stored in D1 (`recipe_derived`).
- `body` (string, required) — markdown body with the `## Ingredients` / `## Instructions` sections.
- `slug` (string, optional) — overrides the derived slug entirely.

**Returns:**
- `{ slug }` — the slug the recipe was written at. **No `commit_sha`** — the recipe is a single R2 object, not a git commit.

**Errors (structured):**
- `{ error: "slug_exists", slug }` — a recipe already exists at that path; not overwritten.
- `{ error: "already_exists", slug, source }` — a recipe with this `source` URL is already in the shared corpus (idempotent import); `slug` is the existing recipe to reuse.
- `{ error: "validation_failed" }` — no derivable slug (missing title), the body lacks the required H2 sections, or the frontmatter violates the contract (a missing required **authored** field — `title`/`source`/`time_total`/`dietary`/`requires_equipment`/`pairs_with` — an off-vocabulary `requires_equipment` slug, an off-vocab `protein`/`cuisine`/`season` **override**, or a `"none"` protein — the error names the offending field).

**Notes:** The everyday discovery write path: `parse_recipe` (parse) → agent cleans/classifies → `create_recipe`. The recipe is available to everyone the moment it's written (no draft, no activation); later personal disposition is `toggle_favorite` (love it) or `toggle_reject` (hide it). The frontmatter is a pass-through record (free-form fields ride through), but the required-field contract is enforced at write time (`src/validate.ts`, the shared `validateRecipeContract` the build also runs) so a recipe can never be created silently un-indexed. `protein`/`cuisine`/`requires_equipment` are checked against the shared vocabularies (`src/vocab.js`); a no-protein dish writes `protein: null` (never omitted, never `none`). `update_recipe` enforces the same contract on the **merged** result — a one-field patch on a compliant recipe succeeds, an edit that empties a required field is rejected — and is the path to backfill fields on existing recipes. `perishable_ingredients` **and `ingredients_key`** are **normalized on write** (Kroger-matcher normalization) so cross-recipe overlap lines up; classify `perishable_ingredients` by the "would the leftover rot" test.

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

## Night-vibe palette tools

The **night-vibe palette** is each member's durable, editable "shape of a week" — a set of saved `search_recipes` specs (a `vibe` phrase + optional `facets`) plus lifecycle metadata (a `cadence_days` period, `weather_affinity` bucket membership, an optional `season`, `pinned`, `base_weight`). `propose_meal_plan` samples this palette at Level 1 to shape the week, then fills each slot at Level 2. Per-tenant private profile data (D1 `night_vibes`, siblings of `staples`/`stockup`); the vibe text's embedding is reconciled on the cron (hash-gated) like `taste_derived`, so a fresh vibe is retrievable a tick later.

`weather_affinity` is discrete **bucket membership**, not a graded score: a vibe belongs to zero or more of `grill | cold-comfort | wet` (both the new category names and the legacy `soup | comfort | grill-friendly | light | no-grill` tags are accepted and resolve to the same buckets — see `propose_meal_plan` below). No membership (the default) makes a vibe a **universal filler**, eligible for every weather category's slots. `weather_antipathy` is accepted for backward compatibility but is not consulted by `propose_meal_plan`'s allocation.

### `list_night_vibes()`

Return the caller's palette. `{ vibes: [{ id, vibe, facets?, cadence_days?, pinned?, base_weight?, weather_affinity?, weather_antipathy?, season? }] }` — empty when unset. Per-tenant; never writes.

### `add_night_vibe(vibe, id?, …meta)`

Add a night vibe. `vibe` (required) is the craving/query phrase; `id` defaults to a slug of the vibe. Meta: `facets` (hard-gate search facets), `cadence_days` (target period — 7 ≈ weekly, 30 ≈ monthly, drives the debt scheduler), `pinned` (sticky weekly intent), `base_weight`, `weather_affinity` (discrete bucket membership — `grill | cold-comfort | wet`, or a legacy tag from `soup | comfort | grill-friendly | light | no-grill` that resolves to the same buckets; omit for a bucketless universal filler), `weather_antipathy` (accepted, not consulted by allocation), `season` (`spring | summer | fall | winter`). A duplicate id returns `conflict` (use `update_night_vibe`). Returns `{ id }`.

### `update_night_vibe(id, …patch)`

Patch an existing vibe — pass only the fields to change. Editing `vibe` re-embeds it on the next cron tick. An un-passed field is **preserved** (there is no clear-a-field path — remove and re-add to drop one). Unknown id → `not_found`. Returns `{ id, updated_fields }`.

### `remove_night_vibe(id)`

Remove a vibe by `id` (its derived embedding is pruned on the next tick). Unknown id → `not_found`. Returns `{ id, removed: true }`.

### `propose_meal_plan(nights?, seed?, lock?, exclude?, boost_ingredients?, nudges?, slots?)`

Propose a week of dinners from the caller's night-vibe palette — **stateless, deterministic, no writes**, and at most **one batched, cache-gated Workers AI embedding call** per request: only the `nudges.freeform` phrase and any `slots[].vibe` override phrases not already served by the query-embedding cache are embedded (one batched call covers all misses); a request supplying **no such text makes no AI call** — every other query vector is cron-captured. The member app's `POST /api/propose` runs the **same shared operation** with the same input and result shape (one contract). Two levels: **(1) shape** — sample `nights` night-vibe slots by **cadence-debt** (a vibe overdue against its `cadence_days` surfaces; pinned vibes are placed; overdue placement yields ≥1 slot to the weighted pool) combined with **discrete weather-bucket quotas**: each forecast day collapses to exactly one category (`grill | cold-comfort | wet | mild`), the window's day-category mix is histogrammed into integer slot quotas (largest-remainder rounding — mirroring the forecast's proportion, e.g. one hot day in seven yields a small `grill` quota, not full-strength pressure on every slot), and each category's quota is filled from that category's member vibes plus bucketless (universal-filler) vibes, ranked by cadence-debt; a quota with no eligible member, and every `mild`-day slot, degrades to the flex pool (the whole remaining palette) so a slot is **never** left empty for lack of a weather match; **(2) fill** — retrieve each slot's vibe by meaning (the same ranked retrieval as `search_recipes`) and select a **varied** main by MMR + protein/cuisine caps **across the week** (not the top-3 lookalikes), then compose rung-1 `pairs_with` corpus sides. Each slot's candidate pool is **course-gated to meal candidates by default**: only recipes whose effective `course` includes `main` — or is **empty** (fail-open: a not-yet-classified recipe is unknown, never silently hidden) — are volunteered, so a component/side (a pasta dough, a sauce) never fills a dinner slot; the slot's alternates come from the same gated pool, so they are meal candidates by construction. A vibe authored with an explicit `facets.course` (e.g. breakfast-for-dinner) **suppresses the default** — that slot gates by its own course containment alone. `lock`s and `slots[].recipe` pins are **exempt** (an explicit caller choice is honored regardless of course), and a vibe whose entire pool the gate empties returns the existing **explicit empty slot** (reason set, no alternates) — pin a recipe or author the vibe with a `course` facet to escape. The fill also does **holistic use-it-up**: it derives the caller's at-risk perishables from their **pantry** (always-on — no param) and spreads them across the week's mains via a bounded, decrementing set-cover term, so a multi-serving item (a family pack of ground beef) can be used across **two** mains and residual is reported — all subordinate to vibe relevance and the hard gate.

The **planning window** (`preferences.planning_cadence_days`, days; defaults to 7 when unset) names how far out the caller plans/shops, independent of `nights`/`default_cooking_nights` (the count of cooking nights **within** that window — a longer window alone doesn't imply cooking more often). The window drives three things: the weather forecast is requested for that many days out (replacing a fixed horizon, clamped to the forecast source's own supported range, and further capped at a ~10-day forecast-reliability horizon for category derivation — days beyond it are treated as `mild`), each night vibe's **occurrence cap** for this plan — `max(1, floor(window / cadence_days))` — so a weekly vibe (`cadence_days: 7`) can be sampled into up to 2 slots of a 14-day window instead of at most once (a vibe with no period, or a period ≥ the window, still caps at 1; this cap, and "already placed" status, is enforced **globally across every category's quota fill**, not reset per category), and an overdue vibe whose bucket's quota is **zero** this window rolls over rather than force-placing into a mismatched slot — until its debt crosses the escape-hatch tier, at which point it force-places regardless. Recurrences are spread across the window (not placed adjacently) where the sampling mechanism allows it; determinism, pinned/overdue precedence, and rollover are unaffected. A recurring vibe never repeats the **same recipe** — cross-slot diversity (`usedSlugs`) still guarantees two occurrences of a vibe resolve to two different recipes.

**Params:**
- `nights` (number, optional): dinners to plan (default: `preferences.default_cooking_nights` or 5, max 14).
- `seed` (number, optional): deterministic seed — the same inputs + seed give the same week; change **only** the seed for "give me another week." Defaults to today's date (stable within a day).
- `lock` (string[], optional): recipe slugs to keep — returned as leading `locked` slots; the rest of the week diversifies *against* them (won't duplicate/clash). Slugs resolve **case-insensitively** and **respect the reject hard gate**; a lock that's unknown, not-yet-embedded, or rejected is returned as an **explicit empty `locked` slot** (never silently dropped). Each lock occupies one night, so the sampled slot count is `nights − lock.length`.
- `exclude` (string[], optional): recipe slugs to drop from every pool (swap-out).
- `boost_ingredients` (string[], optional): an **override** for the always-on use-it-up — extra items to fold into the at-risk demand ("definitely use these"), unioned with the pantry-derived set (never lowering a larger pantry count). Not required to get use-it-up: the demand is derived from the pantry every call. Alias-normalized; a bounded coverage nudge, never a gate.
- `nudges` (object, optional):
  - `max_time_total?` (number): a hard time gate applied to every slot (overridden per-slot by `slots[].max_time_total`).
  - `variety?` (0–1): higher = more diverse (lower λ, clamped so relevance can't collapse).
  - `freeform?` (string): a week-level phrase ("more soup, lighter dinners") — embedded once (cache-gated) and applied to **every** slot's ranking as a bounded additive term, subordinate to the primary vibe relevance. **Never a gate**: it reorders gate survivors and cannot admit a gated-out recipe. A chosen main it materially matches says so in its `why[]`.
  - `proteins?` (string[]): a week-level **soft** protein boost, matched case-insensitively — matching candidates get a bounded additive bump and a `why` line; never a gate (the per-slot `protein` pin is the hard version).
- `slots` (array, optional): per-**vibe-slot** constraints, each `{ vibe_id, protein?, cuisine?, max_time_total?, vibe?, recipe? }`, keyed by the palette vibe's id (a vibe legitimately drawn twice in a long window applies the same constraints to both of its slots; a duplicate `vibe_id` entry beyond the first is ignored). A constraint whose vibe **isn't sampled this week** (or no longer exists) is **inert** — no effect, no error — so a replayed client session survives palette edits.
  - `protein?` / `cuisine?`: facet pins narrowing **that night's** hard gate (they overwrite the vibe facet's values for that slot; every other slot is untouched).
  - `max_time_total?` (number | **null**): a per-night time cap. Precedence: **slot pin > global `nudges.max_time_total` > the vibe's own facet**; an **explicit `null` lifts the vibe's own cap** for that night (which absence cannot express).
  - `vibe?` (string): a typed phrase **replacing that slot's query vector** (embedded at request time, cache-gated). The facet gate and the slot's vibe identity are unchanged; the returned slot carries `vibe_override: true`. Side effect: a fresh, **not-yet-embedded** palette vibe becomes fillable this request instead of returning an empty slot.
  - `recipe?` (string): an **identity-preserving recipe pin** — fills that slot with the named recipe while keeping its `vibe_id`/`reason` (so `from_vibe` provenance survives a swap→commit), admitted into the week's diversify state **up-front** alongside the locks so the rest of the week diversifies away from it. Resolved under the lock rules (case-insensitive; must exist, be embedded, not rejected, **not excluded** — `exclude` beats a pin); an unresolvable pin returns as an **explicit empty slot** with the reason, never silently dropped. The returned slot carries `recipe_pinned: true` and its `why` leads with "your pick".

**Returns:**
- `{ plan, variety, uncovered_at_risk, diagnostics }`.
  - `plan`: one entry per slot — `{ vibe_id, reason (pinned|overdue|sampled|locked), main, alternates, alt_similar, alt_different, sides, uses_perishables, flags, why, vibe_override?, recipe_pinned?, weather_category? }`. `main` is `{ slug, title, description, protein, cuisine, time_total, score }` or **`null`** for an **explicit empty slot** (`empty_reason` set — a vibe with no retrievable candidate, none clearing the caps, or an unresolvable pin — never silently dropped). `sides` are rung-1 corpus sides `{ slug, title }`. `uses_perishables` is the at-risk items this main **claimed** (decremented from the demand — what it actually uses up, not merely any perishable it lists). `flags`: `waste` (single-use perishables no other main shares, compared alias-resolved — canonical ids in the same form as `uses_perishables` — a cheap hint), `meal_prep`, `novel` (never cooked), `no_corpus_side` (add an open-world side). `why[]` explains the pick (incl. "uses your X" for a claimed at-risk item, the weather fit, a matched freeform ask, a requested protein, "your pick" on a pinned main); it may be empty (e.g. a plain overdue placement carries no badge).
  - **Swap material per vibe slot**, from its **already-computed ranked pool** (no extra retrieval or model call), excluding every recipe the week already uses: `alternates` — the top 6 remaining candidates as lites `{ slug, title, protein, cuisine, time_total }`; `alt_similar` — the remaining candidate nearest by cosine to the chosen main; `alt_different` — the highest-ranked remaining candidate of a different cuisine (each `null` when none qualifies). All are gate survivors by construction — a rejected, gated-out, or excluded recipe never appears. An **empty** vibe slot still returns its pool's alternates (the escape hatch for an over-constrained night); a vibe-less `locked` slot has no pool and returns none. Deterministic for a given request.
  - `vibe_override` / `recipe_pinned` (present when true): the slot's query vector came from `slots[].vibe` / its main was pinned via `slots[].recipe`. `weather_category` (`grill | cold-comfort | wet`, optional): the non-`mild` weather-category quota that placed this sampled slot — also folded into its `why[]`.
  - `variety`: `{ distinct_proteins, distinct_cuisines, mean_pairwise_sim, max_pairwise_sim }` over the chosen mains.
  - `uncovered_at_risk`: at-risk items the assembled plan could **not** use up (residual demand) — the honest "still going bad" signal, so the caller can re-roll, lock, or shop around them. `[]` when everything was covered (or there was no at-risk demand).
  - `diagnostics`: `{ seed, lambda, nights, filled, empty, rolled_over }` — `rolled_over` are due vibes that didn't fit this week (debt keeps climbing).

**Notes:** An empty palette returns an empty `plan` with a `note` to add vibes first. Determinism holds across **every** param: identical request bodies (with request-time vectors served from the query-embedding cache) produce identical responses — pins and nudges are inputs, and the seed fully determines the week given the inputs; this is what makes the stateless iteration loop (and the member app's client-side session replay) work. The tool never writes — persist an agreed plan with `update_meal_plan`, threading each chosen main's `vibe_id` as the row's `from_vibe` so cooking it advances that vibe's cadence (`satisfied_vibe`). Sides are **corpus-only** (rung-1 `pairs_with`); open-world sides and freeform-text queries are the calling surface's job, so the tool never fabricates a side. Holistic use-it-up is **always-on** (derived from the pantry) — the caller doesn't need to pass `boost_ingredients` to get it; matching is keyword + alias set-membership over `perishable_ingredients`/`ingredients_key` (no vectors).

---

## Profile-reconciliation tools

The reconcile reconciles a member's **stated** preference (their night-vibe palette + cadences) against **revealed** behavior (their cooking log). A background signal cron (and, optionally, the operator's frontier Claude) enqueues proposed profile edits into a per-member queue; the member confirms them from either surface.

### `list_proposals()`

List the caller's **pending** reconcile proposals — suggested palette edits (prune a vibe you never cook, stretch a cadence you keep deferring, tighten a cadence you keep satisfying early). The **operator's** queue may also carry corpus-curation **`merge_recipes`** proposals (the scheduled dup-scan's suspected near-duplicate pairs — payload `{ slugs, titles, cosine, shared_ingredients, jaccard, detector }`); those are review requests, not diffs. Read-only. `{ proposals: [{ id, kind, target, rationale, payload, evidence, producer }] }`.

### `confirm_proposal(id, accept)`

Accept (`accept: true` → applies the diff: prune/adjust/add a night vibe, marks accepted) or reject (`false` → recorded; the stable id means the same proposal is never re-surfaced) a proposal. For a **`merge_recipes`** proposal, accept records the decision **only** — it applies no corpus write; the merge itself is agent-guided and performed **first** via the corpus write tools (fold into the survivor with `update_recipe`, re-point `pairs_with` referrers, mark the duplicate `duplicate_of: <survivor-slug>`), then confirmed — **merge-then-accept**, so an interrupted flow leaves the proposal pending. Rejecting a `merge_recipes` proposal keeps both recipes forever. Unknown id → `not_found`; an already-resolved id — `accepted`, `rejected`, or system-`superseded` (a pending near-duplicate the derivation convergence sweep collapsed) → `conflict` naming the status (the earlier resolution stands — treat as converged). Returns `{ id, status, applied? }`.

### `reconcile_read_signals()` — operator-only

Read the deterministic reconcile signals across **all** members (each member's palette size + drafted cadence signals) so the operator's own Claude can reason over the group and enqueue richer proposals. Gated on `isOperator` (caller's tenant == `OWNER_TENANT_ID`); non-operators get `insufficient_permission`. `{ members: [{ tenant, palette_size, signals }] }`.

### `reconcile_enqueue_proposal(tenant, kind, target, payload, rationale, evidence?)` — operator-only

Enqueue a proposal for a member (the operator-frontier producer). The member still confirms it before anything changes. Idempotent by `(tenant, kind, target)`. `insufficient_permission` for non-operators. Returns `{ id, enqueued }`.

### `suggest_night_vibes(max_suggestions?, seed?)`

Derive candidate **night vibes** for the caller from what they actually like and cook, and **enqueue** them as `add_vibe` proposals (the caller confirms via `confirm_proposal`) — this tool **never writes the palette**. It clusters the caller's favorites + cook history (their `recipe_derived` vectors) into archetypes, names each on a **small model** (the same generation also classifies the cluster's discrete weather bucket — `grill | cold-comfort | wet`, or bucketless when neutral/unclassifiable — so a confirmed proposal's `weather_affinity` is populated at creation time, no second model call), and infers a `cadence_days` from the observed cook interval. Every candidate — cluster-derived and cold-start alike — is then **phrase-space deduped**: its named phrase is dropped when it is within the dedup threshold (cosine of the phrase embedding, the same space as the palette's stored vectors) of a **palette** vibe, a **pending** `add_vibe` proposal, a **rejected** `add_vibe` proposal, or another candidate kept earlier this run — so the caller is never offered a vibe they already have, already see pending, or already declined. With too little history to cluster **and an empty palette**, it falls back to **starter vibes from the caller's taste notes** (cold-start vibes are always bucketless); a caller who already has a palette but too little history to cluster is offered nothing (`source: "none"`, no model call). The run also **converges the caller's already-accumulated pending near-duplicates**: each is compared (earliest-created-first) against palette, rejected, and earlier survivors, and near-duplicates are resolved **`superseded`** (dropped from the queue), leaving one representative per archetype; member-rejected rows are never touched. All the run's embedding work is one batched, cached embed call. Use it at onboarding to seed an empty palette, or any time to grow it. `max_suggestions` (default 4, max 8) caps the enqueue; `seed` makes the clustering reproducible (defaults to today). Returns `{ candidates, enqueued, superseded, source }` — `source` is `clusters | cold_start | none` (a `note` is added when there's no taste-space yet), `superseded` counts the pending near-duplicates the convergence sweep resolved.

---

## Grocery list tools

The grocery list is the SKU-free buy list for the next order (D1-backed, `grocery_list` table). It accumulates intent across the week; resolution to a Kroger SKU and the cart write are deferred to order placement (`place_order`). Writes are D1-backed — no `commit_sha`. See `docs/SCHEMAS.md` for the item schema.

### `read_grocery_list()`

Return the current buy list — the **stored rows only** (all statuses). This does **not** include the meal plan's derived ingredient needs: for any shop-time read (what would an order buy, a store walk, the stale-cart check) use [`read_to_buy`](#read_to_buyenrich) instead. Use this read when the raw rows themselves are the subject (status/source/note edits, the receive flow).

**Returns:**
- `{ items: [...] }`

### `read_to_buy(enrich?)`

The **derived to-buy view** — what an order placed right now would buy: the `active` grocery list ∪ the **meal plan's derived ingredient needs** (each planned recipe's derived `ingredients_full`) − pantry on-hand, joined on canonical ingredient ids. This is the **same set algebra `place_order` flushes** (and the satellite pull-list serves), so "what would we buy?" has one answer on every surface. One shared operation with the member app's `GET /api/grocery/to-buy` (`?enrich=1` for the enriched variant).

**Guarantees:** read-only and cheap — the default read makes **zero Kroger calls, zero AI calls, and writes nothing** (derived lines exist only in the read; no reconcile or cron materializes them into rows). The plan is the derived lines' source of truth: editing the plan changes the next read with no sync step. The optional **`enrich: true`** variant turns on **one** Kroger Locations resolve (label → locationId, `kroger_flyer`'s posture) that pays for **both** per-line aisle `placement` and per-line `substitutes` under that single resolve — **zero product searches** either way; the default read is byte-identical to the pre-param shape.

**Returns:**
```
{
  to_buy:        [{ name, quantity, assumed_quantity, for_recipes, origin, key, kind, domain, note?,
                    placement?, substitutes? }],
                  // enrich only: placement: { aisle_number?, aisle_description?, aisle_side?, department? } | null
                  // enrich only: substitutes: [{ id, label,
                  //   relation: { role: "satisfies"|"sibling"|"generalization",
                  //               kind: "general"|"containment"|"membership", via? },
                  //   in_pantry, on_sale_hint?: { sku, description, price: { regular, promo }, savings } }]
  pantry_covered:[{ name, for_recipes, on_hand: { quantity?, category?, last_verified_at? } }],
  in_cart:       [{ name, added_at }],
  underived:     ["<slug>", ...],
  location?:     { id } | null,      // enrich only: the store the placements/hints are for
  flyer_as_of?:  ISO | null          // enrich only: freshness of the warmed flyer rollup behind on_sale_hint
}
```

- `origin` — `"list"` (an explicit row the plan doesn't need), `"plan"` (a **virtual** line derived from a planned recipe; no stored row exists — an `add_to_grocery_list` of the same name **materializes/pins** it under the same canonical `key`), or `"both"` (a stored row the plan also needs, merged with unioned `for_recipes`).
- `quantity` is the package count the order would use; derived lines default to 1 with `assumed_quantity: true` (derivation is **presence-only** — no portion math).
- `pantry_covered` — the needs the pantry cancels: the **same set `place_order` returns as `partials`**, each joined with the pantry row's verify metadata so a stale-verified perishable earns a "still good?" nudge instead of a silent skip.
- `in_cart` — the stored in-cart rows: the deterministic **stale-cart signal** (non-empty at order time ⇒ a prior order was never confirmed placed).
- `underived` — planned recipes whose full ingredient list is **not yet derived**; their items are NOT in `to_buy` (reported, never silently dropped) — compensate explicitly.
- A derived need whose canonical id matches an **in-flight** (`in_cart`/`ordered`) row is suppressed from `to_buy` — it is already being bought (it shows under `in_cart`); receiving (pantry restock) or re-listing the row resolves it.
- `placement` (**enrich only**) — the line's captured aisle at the caller's Kroger location, read from the shared `sku_cache` (learned by `place_order`'s commit; the untagged-`''` legacy row is the fallback), plus a `department` derived from the identity graph's parents (out-edges, precedence `membership` → `general` → `containment`, lexicographic tiebreak; absent when the key has no parent). With no resolvable Kroger location (walk/satellite primary), `location` is null and placements carry `department` only. Placements start sparse and **converge organically as orders run** — a line without one is an honest unknown, never a fabricated aisle.
- `substitutes` (**enrich only**) — cross-ingredient hints from a **depth-1 walk over the persisted identity graph**, every endpoint representative-resolved, concrete (buyable) targets only, the line itself and anything already on the to-buy set excluded, capped at 4. Emitted in fixed precedence — satisfies → `general`-kind siblings → generalizations → `containment`-kind siblings → `membership`-kind siblings (a broad class family like `vegetables` only surfaces when nothing better exists) — each **labeled with its relation** (`role`, `kind`, and the shared parent `via` for siblings): the walk proposes and names the relation; fitness for the dish is the caller's judgment. `in_pantry` marks a sibling already on hand — a pure-D1 join needing no location, so it is served even with **no resolvable Kroger location** (walk/satellite primary); `on_sale_hint` matches the primary store's warmed flyer rollup at the flyer reads' default sale floor (not caller-tunable here) once the store resolves — a cached hint, not a live price, and **no per-sibling Kroger search is issued**. The walk runs over the **whole** to-buy set in one batched neighbor read, not a per-line budget. Always an array when `enrich` is set — empty, never omitted, for a line with no graph neighbors (the common case in a sparse graph) — no hint is fabricated. This is still **read-only**: acting on a hint reuses the existing writes only — a same-identity swap stages a `place_order` `overrides` entry, a cross-ingredient swap on an explicit row is the add + remove list writes, and one on a plan-derived virtual row is the materialize-add plus an order-scoped `place_order` `exclude`.
- `flyer_as_of` (**enrich only**) — ISO timestamp of the warmed flyer rollup behind `substitutes[].on_sale_hint` (`null` when no rollup was used — cold cache, or no resolvable store) — the freshness caveat for the sale hints.

### `suggest_substitutions(names?, max_lines?)`

Deterministic same-identity **alternatives** for to-buy lines — a different SKU for the same ingredient, ranked by price/availability. **READ-ONLY**: it never writes the cart, the SKU cache, the grocery list, or anything else — nothing is applied implicitly, and acting on an alternative reuses the existing writes (a same-identity swap is a `place_order` `overrides` entry). One shared operation with the member app's `POST /api/grocery/substitutions`. The matcher is not involved: the read composes the SKU cache, one term search per line, and the unit-price core — the matcher's resolve-only / never-substitutes contracts are untouched. Cross-ingredient substitute suggestions (a sibling already on hand or on sale) are not part of this read — they ride [`read_to_buy`](#read_to_buyenrich)'s `enrich` variant instead, computed by the same shared annotator over the whole to-buy set with no Kroger call.

**Params:**
- `names` (array, optional) — lines to process, resolved through the ingredient funnel. Omitted = the caller's current derived to-buy set, in view order.
- `max_lines` (number, optional) — per-call line budget; defaults to and is **capped at 12**.

**Returns:**
```
{
  suggestions: [{
    for: { name, key, origin? },                    // origin from the to-buy view when derived
    status: "ok" | "current_unavailable" | "no_cached_pick",
    current: { sku, brand, description, size, price, on_sale, available,
               unit_price?, base_unit?, aisleLocation } | null,
    alternatives: [{ …product fields, reasons: ("cheaper" | "on_sale" | "in_stock")[] }]
  }],
  remaining: [name, ...],          // unprocessed this call — call again to continue
  location: { id } | null          // null = no resolvable Kroger location
}
```

- `current` — the line's cached SKU pick, **revalidated live** (fresh price/fulfillment/aisle). `status: "current_unavailable"` when it no longer fulfills; `"no_cached_pick"` when no mapping exists at the caller's location (nor a legacy untagged one).
- `alternatives` — same-ingredient products from **exactly one term search**, fulfillable only, current SKU excluded, ranked by `compare_unit_price`'s core, capped at 5. `reasons` is a **closed deterministic vocabulary and nothing else**: `cheaper` (strictly lower unit price than the current pick, only when both ranked comparable in one size dimension — `unit_price`/`base_unit` carry the numbers), `on_sale` (a genuine promo discount), `in_stock` (fulfillable while the current pick is unavailable). Qualitative reasons ("lower fat") are never produced here — that judgment stays with the caller, grounded in this data.
- **Budget:** ≤ 1 product revalidation + 1 term search per processed line, ≤ 12 lines per call; unprocessed names return in `remaining` for an explicit follow-up call.
- **No Kroger location** (walk-store tenants): degrades instead of erroring — `location: null`, empty `alternatives` for every line, zero Kroger product calls. Call [`read_to_buy`](#read_to_buyenrich) with `enrich: true` instead for the store-independent sibling/pantry/sale hints, which are served even without a resolvable location.

### `add_to_grocery_list(item)`

Add an item (ingredient/product level, no SKU). Keyed by normalized `name` — re-adding an existing name **merges** (union `for_recipes`, reconcile `quantity`) rather than duplicating. New items start `status: "active"`. A **planned recipe's ingredient needs no add** — the to-buy set derives it from the meal plan automatically; adding one anyway **materializes/pins** it as an explicit row (do this to carry a quantity annotation or note) — it upserts under the same canonical id, so the row and the derived need merge into one line, never a duplicate.

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

**`status` transition guard** (enforced in the shared update operation, so every caller — this tool and the member web app — gets the identical guarantee):
- `active ⇄ in_cart` is freely writable in both directions, and an `ordered` item may be re-listed back to `active`/`in_cart` (a canceled order is a legitimate correction).
- `status: "ordered"` is accepted **only** as the user-asserted *"I placed the order"* advance on an item currently `in_cart`; that write stamps `ordered_at` with today's date.
- Any other write of `ordered` returns a structured `validation_failed` carrying the attempted transition (`{ name, from, to }`) and changes nothing.
- The order flow's own advances (`place_order`'s in-cart advance, the satellite receipt flush's ordered advance) are separate code paths, unaffected by this guard.

**Returns:**
- `{ item }` — `not_found` if no such item; `validation_failed` on an illegal `status` transition; D1-backed, no `commit_sha`

### `remove_from_grocery_list(name)`

Remove an item by name.

**Returns:**
- `{ removed: bool }` — D1-backed, no `commit_sha`

**Notes:** Promoting a low/out pantry item onto the list is a **prompted** decision (record `source: "pantry_low"`), never automatic. Removing a **materialized** (`source: "menu"`) row while its recipe stays planned un-pins, it doesn't un-plan — the ingredient re-derives as a virtual to-buy line on the next `read_to_buy`. The lifecycle past `active` (`in_cart` → `ordered` → the terminal receive action) is driven by `place_order` and the user-asserted transitions — see [`place_order`](#place_orderpayload) below.

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

**Notes:** Pure cache read — issues **no** external Kroger subrequest. Reads the store-namespaced `flyer:kroger:{locationId}` rollup, falling back to the legacy `flyer:{locationId}` key while a deploy's first namespaced sweep is pending (no cold gap). Cold/absent cache returns `{ items: [], as_of: null }` (never an error), the same graceful degradation as an absent/empty flyer-terms set (the D1 `flyer_terms` table, which now feeds the **warm job**, not this tool). The flyer may be a few hours stale; for a specific purchase the order path re-prices live. There are **no** ad-hoc `terms` / `against_stockup` params — checking whether a specific stockup item or substitute candidate is on sale lives in the place-groceries flow, not here. `store_flyer` (below) is the store-aware generalization that also serves a satellite-scanned store; `kroger_flyer` is the retained Kroger-specific read.

### `store_flyer(filter)`

Synthesized sale scan for the caller's **primary fulfillment store** — Kroger **or** a satellite-scanned store — served from the same background-warmed cache, in the **same shape** as `kroger_flyer`. Resolves the store from the profile (`stores.primary` + `stores.preferred_location`), reads its `flyer:{store}:{locationId}` rollup, and applies the `min_savings_pct` deal floor at read. Kroger and satellite-scanned sales are **indistinguishable** to the reader (both re-derive `savings` from raw `{ regular, promo }`) except by which store they came from. Use this as the general menu-gen flyer read; `kroger_flyer` remains the Kroger-specific read.

**Params:**
- `filter` (object, optional): `{ min_savings_pct? }` — same as `kroger_flyer` (default **5%**, applied at read).

**Returns:**
- `{ items: [{ sku, brand, description, size, price: { regular, promo }, savings, categories, matched_terms }], as_of }` — the same item shape as `kroger_flyer`. For a satellite-scanned store `matched_terms` is empty (the satellite doesn't report which broad term surfaced each product).

**Notes:** Pure cache read — issues **no** flyer **fan-out** subrequest (the background sweep already did that). For a **satellite** store the `preferred_location` label IS its rollup `locationId`, so no subrequest at all; for a **Kroger** primary, resolving that label to a numeric `locationId` may cost **one** Kroger Locations API call (inherited from `kroger_flyer`) — no flyer scan either way. Cold/absent/unresolvable store returns `{ items: [], as_of: null }` (never an error). A **satellite-scanned** store's rollup older than the operator staleness ceiling (default ~7 days) reads as **empty** (with `as_of` still surfaced) rather than steering menu-gen on stale sales — a dead satellite degrades to empty, not to stale; Kroger keeps its cron-refresh freshness (no ceiling).

### `kroger_prices(ingredients)`

Get current prices for a specific list of ingredients (used for menu pre-pass). Returns the **full list of fulfillable products per ingredient** (relevance-ranked, up to Kroger's per-request max of 50) — not just the top one — so the LLM can compare across brands/sizes and pick.

**Params:**
- `ingredients` (array of strings)
- `location_id` (string, optional) — override the store location for this call; defaults to `preferences.stores.preferred_location`. Use when querying a specific store that differs from the primary.

**Returns:**
- `{ prices: [{ ingredient, products: [{ sku, brand, description, size, price: { regular, promo }, on_sale, available: { curbside, delivery, inStore }, aisleLocation: { number, description, side? } | null, inStore: boolean }] }] }`

**Notes:** `products` is every fulfillable match for the term, ordered by Kroger relevance; an ingredient with nothing fulfillable returns `{ ingredient, products: [] }`. `price` is `{ regular, promo }`; `on_sale` is true only on a real discount (`promo > 0` **and** `promo < regular`) — a `promo` equal to `regular` is not a sale; `available` is the full fulfillment object `{ curbside, delivery, inStore }` at the preferred location (there is no separate `fulfillment` key) — the curbside/delivery flags are order fulfillability; the public API exposes no live in-store stock level. `inStore` (boolean, also surfaced top-level on each product, duplicating `available.inStore`) is true when the item is carried in-store at the queried location. `aisleLocation` is present when the API returns aisle data for this product at the location — `{ number, description, side? }` — and null otherwise; use it for Kroger in-store aisle ordering (the `kroger-instore` branch of `shop-groceries`).

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

Cross-reference the **caller's own** personal ready-to-eat catalog against current Kroger availability. "Available" means fulfillable via **curbside or delivery** at the preferred location (`available.curbside || available.delivery`) — the public Products API exposes no live in-store stock level. Each available item carries the **full list of fulfillable matching products** (relevance-ranked) so the agent can pick the right/cheapest one. An empty or absent catalog returns empty lists.

**Returns:**
- `{ available: { breakfast: [...{ name, slug, meal, products: [{ sku, brand, description, size, price: { regular, promo }, on_sale, available: { curbside, delivery, inStore }, aisleLocation: { number, description, side? } | null, inStore: boolean }] }], lunch: [...], dinner: [...] }, unavailable: [...{ name, slug, meal, catalog_sku }] }` — each product row is the same shape `kroger_prices` returns (`available` is the full fulfillment object; there is no separate `fulfillment` key).

### `kroger_login_url()`

Mint the one-time Kroger account-authorization link for the **current member** and return `{ url }`. Kroger ordering (`place_order`, `ready_to_eat_available`, any cart write) requires the member's own Kroger shopping account to be linked first; this returns a personal browser link the member opens to consent at Kroger (scope: add-to-cart only). Hand the returned URL to the member to click.

Takes **no parameters** — the link is bound to the calling member from their authenticated session, so it can never mint a link for anyone else. The link carries a **single-use nonce that expires in ~10 minutes**, so mint it on demand rather than caching it.

**When to call:** (1) the first time a member sets up ordering, and (2) whenever a cart write returns `cart.code: "reauth_required"` — the stored token was rejected and the member must re-authorize. (Operators bootstrapping a member who isn't connected yet use the admin panel's **Kroger link** action on the Members page instead.)

**Returns:**
- `{ url }` — e.g. `https://<connector-host>/oauth/init?nonce=<nonce>`

---

## Discovery tools

Unprompted discovery is **autonomous**: a background **discovery sweep** (a scheduled cron job — see ARCHITECTURE → *the discovery sweep*) polls the shared feeds + drains the email inbox, classifies and taste-matches each candidate, and **auto-imports** the fits into the shared corpus, attributed per member. The agent does **not** pull/triage/parse discoveries in-flow; it **reads the sweep's output** for the caller via `list_new_for_me` at plan time. The tools here are the reads (`list_new_for_me`, `read_discovery_errors`), source suppression (`reject_discovery`), the shared source config (`update_feeds`, `update_discovery_sources`), and the **manual** import path (`parse_recipe` + `create_recipe`, for a URL/paste the user hands the agent).

### `list_new_for_me()`

Return the recipes the **background discovery sweep imported for the caller** since their last meal plan — the discovery surface the meal-plan flow reads. Each row is **already classified and embedded**, so it is immediately usable *and* retrievable via `search_recipes`. Scoped to the caller: recipes the sweep **matched to the caller's taste** (a `discovery_matches` row for this tenant), discovered after their `last_planned_at` watermark, with **no overlay disposition** (not favorited/rejected) and **not yet cooked**. Read-only; per-tenant.

**Returns:**
- `{ recipes: [{ slug, title, description, protein, cuisine, time_total, discovered_at }] }` — most-recent-first, bounded. `description` is the AI-generated "why this dish."

**Notes:** The watermark is the **later** of the caller's `last_planned_at` (the D1 `profile` planning watermark, stamped by `update_meal_plan` on an `add`) and a fixed **~21-day floor**, so a never-planned member sees at most a recent window of discoveries, not the whole backlog. An **empty list is normal** (nothing new since they last planned). Fold these into the menu *before* the rest of retrieval. This is the discovery surface the meal-plan flow reads — the agent reads ready-made results; it does not fetch/score/import in-flow.

### `read_discovery_errors()`

List the discovery candidates the background sweep **parked or failed** — a **content park** (`outcome` `error`: a candidate it couldn't reach or classify into a contract-valid recipe after its corrective retries, so it was never imported) or an **infrastructure failure** (`outcome` `failed`: a candidate dropped by a transient env.AI/D1 error — a subrequest-limit hit, an outage), held for an operator/author to look at. **Shared** across the group, read-only; the discovery analog of `read_reconcile_errors`.

**Returns:**
- `{ errors: [{ url, title, source, outcome, slug, detail, created_at }] }` — one entry per parked/failed candidate (`outcome` is `error` or `failed`; `slug` is null); `source` is the feed name / sender address, `detail` the reason (e.g. the validator's complaints, `unreachable`, or the env.AI error). An **empty list** means the sweep is importing cleanly. A standing `failed` row also degrades the `discovery-sweep` health record (`/health`); a content `error` does not.

**Notes:** `failed` rows are **transient/in-retry** — the sweep automatically re-attempts them on an exponential backoff schedule (capped at `retryMaxAttempts`); exhausted infrastructure failures terminalize to `outcome = 'error'` so `/health` clears. The operator can also retry or delete any `error`/`failed` row individually via the admin **Discovery** area's candidate-pipeline view. This is the `outcome IN ('error', 'failed')` subset of the sweep's `discovery_log` (see `docs/SCHEMAS.md` → `discovery_log`). The full per-candidate outcome log (every outcome, not just these) is the operator's **Discovery** admin area, not an agent tool.

### `reject_discovery(url, reason?)`

**Shared, group-wide suppression** of a discovery **source** URL: stops the URL (and its tracker-wrapped variants) from ever being re-imported by the **background discovery sweep** for **anyone**. The sweep folds these into its intake dedup, so a rejected url is never re-evaluated.

**Params:**
- `url` (string, required): the discovery URL to suppress. Canonicalized (query/fragment/trailing-slash stripped) so a tracker-wrapped and a bare link suppress as one.
- `reason` (string, optional): free-text provenance ("not a recipe", "duplicate").

**Returns:**
- `{ url, rejected: true }` — `url` is the stored canonical form.

**Notes:** Use **only** when a source is not corpus-worthy **for the group** — junk, broken, not actually a recipe, a duplicate, or a feed/site producing off-base results. Deliberately **asymmetric** with the per-tenant marks: this is *collective curation* of the noisy intake stream (pre-import, by source URL), whereas a member who simply dislikes an **already-imported** corpus recipe uses **`toggle_reject`** (per-tenant), not this. Writes a row to the shared `discovery_rejections` table (canonical `url` PK; `reason`/`rejected_by`/`rejected_at` for provenance — `rejected_by` records who, but suppression is group-wide regardless). Idempotent on the canonical URL; a repeat refreshes the reason/provenance. Touches no recipe content or overlay.

There is no `fetch_flyer_featured` tool — Kroger exposes no "featured" primitive, so on-sale ready-to-eat discovery rides the existing `kroger_flyer` pre-pass (with ready-to-eat terms in the D1 `flyer_terms` table) plus agent-side dedup against the caller's D1 `ready_to_eat` catalog and `add_draft_ready_to_eat`. This is buy-time discovery, separate from the recipe sweep.

### `update_discovery_sources(members?, senders?)`

Add trusted sources to the **shared** inbound-newsletter allowlist (the D1 `discovery_senders`/`discovery_members` tables). Use when a member sets up a forward or wants a newsletter indexed. Anyone trusted with this MCP is trusted to widen intake (no extra gate). Deduped by `address` — existing entries untouched.

**Params:**
- `members` (array, optional): `[{ address }]` — friend-group personal addresses; anything they forward to `groceries-agent@` gets indexed (manual-forward path). **Address only — no label** (`name` is not stored for members; identity is the address, not an agent-supplied display name).
- `senders` (array, optional): `[{ address, name? }]` — newsletter `From` addresses; auto-forwarded mail from them gets indexed. `name` is the **newsletter's** name (e.g. "Serious Eats"), never a person's.

**Returns:**
- `{ added: { members, senders } }` — counts actually added (0 when already present); D1-backed, no `commit_sha`.

**Notes:** Pairs with the inbound-email handler's auth gate — a listed `sender`/`member` is accepted only when the message also passes aligned DKIM (see `docs/SCHEMAS.md` → `discovery_sources`).

### `update_feeds(feeds)`

Add RSS/Atom feeds to the **shared** discovery config (the D1 `feeds` table, the feed set the **background discovery sweep** polls). **Add-only**, deduped by canonicalized `url` (existing feeds untouched) — the same posture as `update_discovery_sources`. Discovery feeds are a shared, group-wide concern, so anyone trusted with this MCP may widen the set.

**Params:**
- `feeds` (array): `[{ url, name?, weight?, tags? }]`. `url` is required and MUST be a public `http`/`https` URL — a non-http scheme, embedded credentials, or a private/loopback/link-local host is rejected with `validation_failed` and nothing is stored. `weight` defaults to `1`. (The sweep reads `url`/`name`; `tags` are descriptive.)

**Returns:**
- `{ added }` — `added` is the count of new feeds; D1-backed, no `commit_sha`.

**Sweep calibration is an operator/admin surface, not an MCP tool.** The discovery sweep's pipeline knobs (`tasteThreshold`, `triageThreshold`, `dedupThreshold`, `classifyMaxPerTick`, `rateCap`) are tunable via the **Config** area of the operator admin panel — a D1-backed `discovery_config` sparse override merged over `DEFAULT_CONFIG` at job start. The admin console also exposes a cheap no-AI threshold analysis (`POST /admin/api/discovery/analyze`) and a no-write full-pipeline dry-run (`POST /admin/api/discovery/dry-run`) for calibration before committing changes. These surfaces are deliberate non-tools: they are cross-tenant, Access-gated, and operator-only — not reachable by any per-tenant MCP session. The tool contract is unchanged.

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
- `updates` (object): `{ favorite?, reject?, name?, category?, brand?, notes? }` — `favorite` and `reject` are the booleans of the disposition model, **mutually exclusive** (setting one clears the other); there is no `status` or `rating`. A rejected item is no longer suggested by `ready_to_eat_available`. Those six are the **only** updatable keys — any other key (`slug`, `meal`, the discovery source, timestamps) is identity/provenance and is **rejected** with a structured `validation_failed` listing the offending keys; nothing is written.

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

Write user-curated config. `update_taste`/`update_diet_principles` are content-faithful (write the supplied full markdown to the D1 `profile` row, no `commit_sha`). `update_aliases` **upserts** variant→canonical-id ingredient mappings into the shared **ingredient identity graph** (`ingredient_alias` + `ingredient_identity`, where the matcher's resolver reads them) as **human** edits (`source='human'`, which the auto capture cron never overwrites), keyed by lowercased variant — add/edit, no removal (`{ updated }`, no `commit_sha`). The cron grows the same store automatically, so a manual alias is rarely needed — reserve it for a synonym the cron hasn't bridged. **`update_preferences` is a deep merge-patch**, not a whole-object write. **These should only be called when the user explicitly directs an edit.**

**Params:**
- `update_preferences`: `patch` (object, required) — a **JSON Merge Patch (RFC 7396)** over the caller's preferences: a present key sets/overwrites, `null` deletes, nested objects merge to **any depth**, arrays replace wholesale. Only the keys you touch change — a partial patch never clobbers siblings, so you do **not** re-send the whole object. Defined top-level keys: `default_cooking_nights` (number — cooking nights within the planning window), `planning_cadence_days` (positive number — how far out the caller plans/shops, in days; drives `propose_meal_plan`'s weather horizon and vibe-recurrence caps, unset falls back to a 7-day window), `lunch_strategy` (`leftovers`|`buy`|`mixed`), `ready_to_eat_default_action` (`opt-in`|`auto-add`), `stores` (`{primary, preferred_location, location_zip}`), `brands` (map of term → ranked brand list; `[]` = don't-care/cheapest, `null` = clear back to ambiguous), `dietary` (`{avoid[], limit[]}`), `rotation` (`{resurface_after_days, novelty_boost}` — tunes the `search_recipes` freshness re-rank; both positive numbers). Anything else nests under `custom`; an unknown top-level key returns `validation_failed` (nest it under `custom`). A type-invalid merged result returns `malformed_data` and stores nothing. Applied atomically to the D1 `profile` row + `brand_prefs` rows.
- `update_taste` / `update_diet_principles`: `content` (string, required) — the complete new field text
- `update_aliases`: `aliases` (object, required) — a map of variant → canonical id, e.g. `{ "EVOO": "olive oil" }`; each is upserted by lowercased variant as a human edit

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
- `{ domain, slug, path }` — `path` is `guidance/<domain>/<slug>.md`; the write is one R2 object put (atomic at the object level, same store as `create_recipe`). **No `commit_sha`** — the corpus is R2, not git.

**Notes:** There is exactly one file per slug — saving an existing slug **overwrites/refines** it (read the existing entry first and merge; never accumulate duplicates). A write to a non-allowlisted/unknown domain, an empty `content`, or a malformed slug yields `{ error: "validation_failed", … }` and writes nothing — this allowlist is how `ingredient_storage` stays read-only.

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

Add, remove, or edit planned meal entries. D1-backed — no commit, no `commit_sha`.

**Params:**
- `ops` (array): `[{ op: "add" | "remove" | "set", recipe, planned_for?, sides?, from_vibe? }]`
  - `add` upserts by recipe slug: updates `planned_for` (when supplied non-null), **unions** open-world `sides` onto the row, and sets `from_vibe` when supplied.
  - `remove` drops all rows for the slug.
  - `set` edits an **existing** row with **replace** semantics (a `set` addressing a recipe with no planned row is a per-op conflict, not an error): a supplied `sides` array replaces the row's sides **wholesale** — an empty array removes them all, the only way to remove a side; a supplied `planned_for` string sets the date and an **explicit `planned_for: null` clears it** (unschedules the night); `from_vibe` is preserved unless supplied (supplied `null` clears it).

**Returns:**
- `{ applied: [...], conflicts: [...] }` — D1-backed, no `commit_sha`; each applied entry has `{ op, recipe }`; conflicts include the reason.

**Notes:** Called after the user confirms a menu (add rows), during cook-capture or the stale-planned reconcile (remove rows), and for row edits — side removal, rescheduling/unscheduling a night (set rows). `log_cooked` also auto-removes a cooked recipe from the meal plan. A **corpus** side (a `course: side` recipe) gets its own `add` row; open-world sides ride on the main's `sides` field. An **`add`** op that applies also stamps the caller's `profile.last_planned_at` planning watermark (today) — the bound `list_new_for_me` reads, so the next plan surfaces only discoveries imported since this one; `set`/`remove` never move the watermark.

---

## Order placement

### `place_order(payload)`

The order-time flush — the **only** tool that writes a Kroger cart. Resolves the whole to-buy set against *current* Kroger availability, writes the cart (`PUT /v1/cart/add`), and caches learned ingredient→SKU mappings to the shared SKU cache. Backed by the Kroger `authorization_code` + PKCE user-context client and the KV-backed rotating refresh token.

**To-buy set (order-time dedup):** `grocery_list ∪ menu needs − pantry_has`, joined on canonical ingredient ids — where **menu needs are the union of the meal plan's server-derived ingredient needs and any caller-supplied `menu_needs`**. The tool derives each planned recipe's needs itself from its derived `ingredients_full` (the same derivation [`read_to_buy`](#read_to_buyenrich) and the satellite pull-list use), so a caller never hand-expands the plan; `menu_needs` is for **supplements** only (open-world side ingredients not yet captured, spontaneous extras). **A caller passing plan-derived (or already-listed) duplicates in `menu_needs` is safe**: the canonical-id union merges them into one line — a not-yet-republished plugin bundle whose persona still passes the bulk expansion cannot cause a double-buy. Planned recipes whose ingredient list is not yet derived return in `underived` (their items are NOT in the set — compensate explicitly rather than silently under-buying). A derived need whose row is already in flight (`in_cart`/`ordered`) is suppressed — a repeat order never re-buys the lines the last order carted. Only `active` list items participate. A name present in the pantry is **not** silently dropped — it returns in `partials` for you to prompt on, and is bought only if the user confirms it via `include_partials` (the no-auto-decide rule). A caller-supplied **`exclude`** list drops named lines (resolved through the same canonical-id funnel) from the to-buy set **before resolution** — an order-scoped opt-out for a line with no row to remove (a derived one); it is never persisted, so the line returns on the next read/order. Default buy quantity is **1 package** per item unless overridden.

**Quantity (package count):** supply it per item via `menu_needs[].quantity`, or via the `quantities` map; the `quantities` map **overrides** `menu_needs[].quantity` when both are present (precedence: `quantities` → `menu_needs[].quantity` → default 1). A line that fell back to the default carries `assumed_quantity: true`. The tool reports that fact but does **not** classify "by-the-each produce" or do portion math — at `preview`, *you* reconcile any `assumed_quantity` by-the-each produce (peppers, tomatillos, …) against the recipe's required amount and set an explicit quantity before the real flush. (`grocery_list` items' string `quantity` like "2 lbs" is a human need-annotation, not a package count.)

**Resolution + checkpoint:** each item runs through the [matcher](#match_ingredient_to_kroger_skuingredient-context) with cache revalidation (a cache hit no longer fulfillable is re-resolved). Items the matcher returns as `ambiguous` or `unavailable` are collected into a single `checkpoint` and are **not** added to the cart. Disposition them and re-call with `overrides` — already-carted items have advanced to `in_cart`, so they won't be re-added.

**`overrides` — force a specific SKU (disposition *or* lock a deal):** `[{ name, sku, brand?, size? }]` pins a chosen SKU for a line, bypassing the matcher. Use it two ways: to **disposition** an ambiguous/unavailable item, or to **lock a SKU you verified** — e.g. the on-sale `sku` returned by [`kroger_prices`](#kroger_pricesingredients-location_id) — so the deal's exact SKU survives into the cart instead of the matcher picking its own. A forced SKU is **revalidated** for current curbside/delivery availability and returned with **fresh** `price`/`on_sale` (so a deal that lapsed since you checked is visible); a forced SKU that has gone **unavailable** is routed to `checkpoint` rather than blind-carted. **Overrides pin the SKU, not the price:** the cart write (`PUT /v1/cart/add`) carries only SKU + quantity — no price — so whether a sale price actually realizes is Kroger's determination at fulfillment, against flyer data that may be hours-stale. Don't promise the user a locked price; surface the fresh `on_sale` at `preview` and let them decide.

**Params:**
```
{
  menu_needs:       [{ name, quantity?, for_recipes? }],  // SUPPLEMENTS only (plan needs are derived server-side); quantity: 1–99 integer
  quantities:       { "<name>": <packages> },             // per-item package count, 1–99 integer (default 1)
  include_partials: ["<name>", ...],                       // pantry items the user confirmed buying anyway
  overrides:        [{ name, sku, brand?, size? }],        // force a SKU: disposition, or lock a verified/on-sale SKU
  exclude:          ["<name>", ...],                       // drop lines from the to-buy set BEFORE resolution (order-scoped, never persisted)
  preview:          bool                                    // resolve + report only; no cart write, no commits
}
```
All sections optional. With no args it flushes the current to-buy set (list ∪ derived plan needs − pantry). Package counts (`quantities` and `menu_needs[].quantity`) must be positive integers ≤ 99 — a fractional, zero, or oversized value is rejected before any cart write (`place_order` is the only tool that writes a real Kroger cart).

**Returns:**
```
{
  resolved:  [{ name, sku, brand, size, quantity, assumed_quantity, price?, on_sale?, aisleLocation? }],  // assumed_quantity: qty defaulted to 1; price/on_sale/aisleLocation: fresh at resolution
  checkpoint:[{ name, kind: "ambiguous"|"unavailable", candidates?, message }],
  partials:  [{ name, for_recipes }],
  sku_cache: { committed, error? },
  cart:      { written, count?, error?, code? },   // code carries reauth_required etc.
  list:      { advanced, rolled_back?, error? },   // D1-backed (no commit_sha); see partial-failure honesty below
  preview:   bool,
  underived: ["<slug>", ...]              // planned recipes whose items are NOT in this order
}
```

**Partial-failure honesty (double-add-safe write order):** the SKU-cache commit is **independent best-effort** (a pure hint); the advance/cart pair is ordered so a retry can never double-add. Order: commit the cache → advance the list to `in_cart` *before* the cart write → write the cart. The ordering exists because `PUT /v1/cart/add` is **additive and unreadable**: items left `active` after a successful cart write would be silently re-bought by a retry (costs money), whereas items marked `in_cart` without a cart write are a *visible* under-buy (the stale-cart reminder and the human checkout surface them) that a retry never compounds. The legs report honestly:
- **Advance fails** → the cart write is **skipped entirely**: `list: { advanced: false, error }`, `cart: { written: false, error }` — nothing was carted, the whole order is safe to retry.
- **Cart write fails** → the advance is **undone exactly**: pre-existing rows roll back to `active`, and rows the advance itself inserted (menu-plan-derived lines with no stored row) are **deleted** rather than stranded as never-listed active items — `list: { advanced: false, rolled_back: true }`. Retryable, no silent drop, and the cart is **never** reported populated.
- **The rollback itself fails** → `list: { advanced: true, rolled_back: false, error }` — the items are marked `in_cart` with **no** cart write. A retried `place_order` will **not** re-add them (`in_cart` is excluded from the to-buy set); recover via `update_grocery_list` (set them back to `active`) or let the stale-cart flow surface them.

A cache-commit failure after a successful cart just re-resolves next time. If the cart write fails because the Kroger refresh token was rejected, `cart.code` is `reauth_required` — call [`kroger_login_url`](#kroger_login_url) and give the member the returned link to re-authorize (see `docs/SELF_HOSTING.md`).

**Mapping commit (refresh-on-difference, aisle capture):** the SKU-cache commit covers **every** resolved line — cache-hit lines included, whose revalidation carries fresh data — and each mapping carries the resolved product's **aisle placement** (`aisle_number`/`aisle_description`/`aisle_side`, stamped `aisle_captured_at`) when Kroger reports one. A key already cached is skipped **only when its learned fields (SKU, brand, size, aisle) are identical**; a differing row is refreshed in place (with `last_used`), so mappings and placements **converge organically with each order** instead of freezing at first capture. The captured placements feed [`read_to_buy`](#read_to_buyenrich)'s enriched read and the in-store walk.

**Lifecycle (`active → in_cart → ordered → received`):** `place_order` sets `in_cart`. Because the cart API is write-only and unreadable, the transitions past `in_cart` are **user-asserted**, never agent-verified:
- *"I placed the order"* → advance `in_cart` items to `ordered` via `update_grocery_list` (stamps `ordered_at`). This is the **only** path into `ordered` that `update_grocery_list` accepts — a write of `ordered` on an item not currently `in_cart` is rejected with a structured `validation_failed` (see [`update_grocery_list`](#update_grocery_listname-patch)).
- *"I picked up the groceries"* → `received` (terminal): `remove_from_grocery_list` for each, and for `grocery`-kind items only, restock the pantry via `update_pantry`. `household`/`other` items don't touch the pantry.

A **stale-cart reminder** fires when a new order begins while the prior list still has `in_cart` items never confirmed `ordered` (the deterministic signal is [`read_to_buy`](#read_to_buyenrich)'s `in_cart` section — the member app's order dialog leads with the same warning): remind the user to clear the Kroger cart manually (the API can't), rather than silently double-adding.

**One shared operation.** The tool body is the extracted `runPlaceOrder` op; the member app's `POST /api/grocery/order` calls the same operation over fresh `buildOrderWiring` deps (preview and commit are the same endpoint discriminated by `preview`), with the tool's observable behavior unchanged. The endpoint is gated to Kroger-online fulfillment — a non-Kroger primary receives a structured `unsupported` naming the correct flow — and the app's commit is **online-only** (never queued/replayed: the cart write is not idempotent).

**`place_order` stays Kroger-only.** The parallel **satellite cart-fill flush** for an API-less store (satellite-order-cart-fill) adds **no MCP tool** and does not touch `place_order`: it is served by the two direct `/satellite/order/*` endpoints (see `docs/SCHEMAS.md`), driven by the tenant's local helper, and the agent routes to it from the `preferences.stores.fulfillment === "satellite"` marker it already reads at the start of `shop-groceries` — no `place_order`-shaped tool is minted for it (there is nothing Worker-side to mint; the helper URL/token live on the tenant's machine). Carted/substituted lines advance to `in_cart` exactly as `place_order` does, and the same `active → in_cart → ordered → received` lifecycle + user-asserted transitions apply.

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

Records a bug report into the **operator's review queue** (the D1 `bug_reports` table), on behalf of a member who can't file issues themselves. The operator reviews it in the **admin panel** (`GET /admin/api/bug-reports`). The Worker stamps attribution it controls — the reporter is the caller's tenant id, plus a UTC timestamp — so identity can't be omitted or spoofed by the agent. Use it when a grocery-mcp tool errors in a way the agent can't work around, or when the user has had to repeatedly correct/redirect on the same thing; write a specific, reproducible report. Returns `{ filed: true }`.

**Errors:** `storage_error` (the D1 write failed). It does not file a GitHub issue, so it **cannot** return `insufficient_permission`.

Behind the per-tenant gate; a pure D1 write — no GitHub. Driven by the agent's `report-grocery-agent-bug` skill, which fires on an unworkable tool error or repeated user correction, files at most one report per distinct problem per session, then tells the user it flagged it.

---

## What this surface deliberately does NOT include

- No raw corpus write access (whole-object R2 writes via `create_recipe`/`update_recipe`/`save_guidance` only)
- No raw Kroger API access (matching pipeline + cart write only)
- No "search arbitrary text across recipes" (use `search_recipes` over the index)
- No "execute arbitrary code" or "run arbitrary script"
- No portion math (no whiteboard problem)
- No tool that itself schedules or triggers background work — the scheduled jobs (the flyer warm, the recipe-index projection, the recipe-derived reconcile, the discovery sweep) run in the Worker's `scheduled()` handler, not as tools; the tool surface only *reads* their output (`kroger_flyer`, `search_recipes`, `list_new_for_me`, `read_reconcile_errors`, `read_discovery_errors`)

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
