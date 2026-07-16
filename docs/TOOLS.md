---
update-when: a tool's parameters or returns change, or the tool surface changes
---

# TOOLS.md — MCP Tool Inventory

The complete tool surface exposed by `yamp` to Claude. Each tool encodes a deterministic operation. The LLM composes them; the tools enforce the pipelines.

## Design philosophy

**Coarse and opinionated.** Tools wrap multi-step deterministic logic so the LLM doesn't have to orchestrate every step. `import_recipe` runs the whole fetch → classify → validate → persist pipeline internally; the LLM doesn't assemble recipe frontmatter by hand.

**Structured output via JSON.** Every tool returns structured data. The LLM reasons over the result; it doesn't parse free text.

**Honest about ambiguity.** When deterministic narrowing leaves multiple options (e.g., 3 brands of olive oil all match equally), tools return `ambiguous: true` with candidates. The LLM either picks based on context or asks the user. Tools don't silently pick.

**No raw building blocks exposed.** No `kroger_raw_search`, no `github_raw_write`, no `cart_add_by_name`. These would let the LLM bypass the deterministic pipelines.

## Registration model: member, config-gated, operator, and app planes

`buildServer` resolves a per-request `RegistrationContext` before a single tool registers, and every tool's plane is decided there — not by a runtime permission check. A tool outside the caller's planes never registers: it is absent from `tools/list`, and a call to it gets the generic unknown-tool rejection, indistinguishable from a tool that never existed (never an `insufficient_permission` that would reveal it exists).

- **Member surface** — the base tool set below, registered for every caller on every configured deployment.
- **Config-gated** — the Kroger set (`flyer`, `kroger_prices`, `place_order`, `kroger_login_url`, `display_order_review`) registers only when the deployment carries Kroger API credentials; `create_instacart_handoff` registers only when the Instacart configuration resolves. Both gates are **deployment-level** (the credentials are Worker secrets, not per-tenant) — a walk-only deployment advertises no Kroger tools at all.
- **Operator plane** — `list_proposals`, `confirm_proposal`, `reconcile_read_signals`, and `reconcile_enqueue_proposal` register only when the caller's tenant is the operator (`OWNER_TENANT_ID`). A member connector never sees them. The call-time `isOperator` check on the reconcile pair stays as defense in depth.
- **App plane** — every widget/app-bridge-callable operation registers with the ext-apps `_meta.ui.visibility: ["app"]` marker, so a host excludes it from the model's tool context while the widget keeps calling it by name: the grocery snapshot family (`read_grocery_snapshot`, `grocery_add`, `grocery_remove`, `set_grocery_checked`, `set_grocery_buy_anyway`, `verify_grocery_pantry`, `set_grocery_substitution`, `relist_grocery_send_line`, `mark_grocery_send_placed`), the order-review family (`read_order_review`, `search_order_broader`, `search_order_catalog`, `save_order_brand_preference`, Kroger-gated), and `commit_shop`. `commit_shop` rides no other gate — it registers whenever the grocery widget does, purely app-plane. `display_*` widget tools (`display_recipe`, `display_meal_plan`, `display_grocery_list`, `display_order_review`) stay model-visible; a tool may legitimately serve both planes (`log_cooked`, `update_meal_plan`, `read_meal_plan`, `propose_meal_plan` are called by both the model and a widget).
- **The one-window dispatch aliases** (`toggle_favorite`/`toggle_reject`, `add_to_grocery_list`/`remove_from_grocery_list`, `list_guidance`) are registered plain and model-visible during their deprecation window — not app-plane-restricted — so a stale plugin's persona can still see and call them (see the deprecation convention below). At window close, `toggle_favorite`/`toggle_reject` flip to app-plane-only registrations (the recipe-card widget calls them by name through the app bridge) rather than disappearing; the grocery-list and `list_guidance` aliases are removed outright.

## Deprecation convention (`warnings` on the return)

The plugin lags the Worker (Worker-first deploy, async marketplace re-pull, mid-conversation cached skills), so a renamed/retired parameter key or a changed value shape ships with a **one-deprecation-window shim**: the old form is **accepted and converted** to the current model (never dropped, never bounced with an error — a stale agent's write must succeed and steer), and the tool's success return carries a `warnings` array flagging each conversion:

```
warnings: [{ key, reason, superseded_by }]
```

- `key` — the parameter path that arrived in the deprecated form (e.g. `brands.butter`).
- `reason` — why it was converted (e.g. `deprecated_shape` for a value-shape change).
- `superseded_by` — the current form to use instead.

`warnings` is additive on a success return and omitted when empty. After the window (once the matching plugin version has been published for one window), the old form is rejected as `malformed_data` like any other type error. Active shims:

| Tool | Deprecated form | Converts to | Reason |
|---|---|---|---|
| `update_preferences` | a `brands` family as a flat rank list (`[]` / `["A","B"]`) | `{ tiers: [], any_brand: true }` / `{ tiers: [["A"],["B"]], any_brand: false }` | `deprecated_shape` |
| `update_pantry` | an item `category` of `pantry` \| `fridge` \| `freezer` \| `spices` (the retired location-flavored values) | `location: pantry/fridge/freezer/spice_rack`, `category` left unset | `deprecated_shape` |
| `read_pantry` | a `category` filter of `pantry` \| `fridge` \| `freezer` \| `spices` | the corresponding `location` filter (`spices` → `spice_rack`) | `deprecated_shape` |
| `update_preferences` | `default_cooking_nights: N` | merged as `cadence.dinner = N` (breakfast/lunch preserved; the frozen column is never written) | `aliased` |
| `update_preferences` | `lunch_strategy` / `ready_to_eat_default_action` | **accepted and dropped** — nothing validated, nothing stored, never `validation_failed`, never the nest-under-`custom` hint | `retired` (superseded by meal vibes) |
| `log_cooked` | `type: "ready_to_eat"` | `type: "ad_hoc"` — `name`/`date`/`meal`/inline `protein`/`cuisine` carried over unchanged; the dedupe identity and the plan-clear logic run on the converted form | `retired` (superseded by `ad_hoc`) |
| `add_night_vibe` | the old tool name | **dispatch alias** of `add_meal_vibe` — one op layer, identical requests and identical responses, **no `warnings` injection** (an alias call is behavior-identical, not a converted write) | rename (D21) |
| `propose_meal_plan` / `display_meal_plan` | `nights: N` | `meals.dinner = N` (window-scoped; **ignored without error** when `meals` is supplied); `diagnostics.nights` stays returned as the dinner alias | `aliased` |
| `read_user_profile` | `preferences.default_cooking_nights` in the export | kept for the window as a **derived mirror** of the effective `cadence.dinner` (read-path skew protection) — prefer `preferences.cadence` | `aliased` |
| `POST /api/vibes/suggest` (member API) | the retired member-tappable suggest trigger | a pinned **410** `{ error: "gone", message }` stub (no derivation, no model) — band 2's profile/vibes slice removes the button | `retired` (the cron carries generation) |
| `toggle_favorite(slug, favorite)` / `toggle_reject(slug, reject)` | the old tool names | **dispatch aliases** of `set_recipe_disposition(slug, disposition)` — `favorite` → `disposition: "favorite"`/`"none"`, `reject` → `disposition: "hide"`/`"none"` — one op layer, identical requests and identical responses, **no `warnings` injection** | `rename (D21)` |
| `add_to_grocery_list(item)` / `remove_from_grocery_list(name)` / old-form `update_grocery_list(name, …patch)` | the old tool names, and `update_grocery_list`'s old single-patch form | `add`/`remove` are **dispatch aliases** into ops-form `update_grocery_list({ operations: [{ op, … }] })`; the old single-patch form is **detected by shape** within `update_grocery_list` itself and keeps its original bare-`{item}`-return/throw-on-failure contract — one op layer, **no `warnings` injection** | `rename (D21)` |
| `list_guidance(domain?)` | the old tool name | **dispatch alias** of `read_guidance(domain?)`'s list mode (no `slugs`) — identical requests and identical responses, **no `warnings` injection** | `rename (D21)` |

`update_pantry`'s shims report per-operation — its `warnings` entries are `{ op, name, field, reason }` (the operation-report shape its `applied`/`conflicts` already use) rather than the `{ key, reason, superseded_by }` patch shape. Any *other* off-vocabulary `category` value on an `update_pantry` add is **accepted-and-dropped** under the same posture: the op applies, `category` stores NULL (uncategorized — the background classifier fills it), and a `warnings` entry reports the drop — never a rejection, so a stale writer keeps working while its data converges.

**Removal condition (the meal-dimension rows):** the `add_night_vibe` alias, the `nights`/`diagnostics.nights` alias, the `default_cooking_nights` write alias + read mirror, the retired-key accept-and-drop, and the `/api/vibes/suggest` 410 stub are all removed by the `remove-meal-dimension-shims` cleanup change once **both** hold: a subsequent plugin publish has occurred **and** ≥30 days have elapsed since the meal-dimension plugin publish. The same cleanup drops the frozen `profile.default_cooking_nights` / `lunch_strategy` / `ready_to_eat_default_action` columns (gated on the retired pair being NULL everywhere — the pref-retirement pass's convergence predicate). After the window, the retired keys and old names fall through to the generic unknown-key/unknown-tool rejection like anything else.

**Removal condition (the `narrow-mcp-surface` fusion rows):** the `toggle_favorite`/`toggle_reject`, grocery-list, and `list_guidance` alias rows above are removed once **both** hold: a subsequent plugin publish has occurred **and** ≥30 days have elapsed since that publish (the `rewrite-agent-persona` republish starts the clock). At window close `toggle_favorite`/`toggle_reject` do not simply disappear: because the recipe-card widget calls them by name through the app bridge (`recipe-card-widget` D18), they **flip to app-plane registrations** (`visibility: ["app"]`) instead, exactly like `commit_shop`, so the widget contract never changes; the grocery-list and `list_guidance` aliases are removed outright. After the window, the old names and the old grocery-list single-patch shape fall through to the generic unknown-tool/`malformed_data` rejection like anything else.

**Removal condition (the `remove-ready-to-eat` `log_cooked` shim):** the `log_cooked` `ready_to_eat`→`ad_hoc` conversion row above is removed by a small follow-up tasklet — not a new change — once **both** hold: a subsequent plugin publish has occurred **and** ≥30 days have elapsed since that publish (the same `rewrite-agent-persona` republish that drops the `add-ready-to-eat-feedback` skill and the RTE flow weaves starts the clock). After the window, `type: "ready_to_eat"` falls through to the generic `validation_failed` rejection like any other unknown type.

---

## Recipe tools

### `search_recipes(specs)`

Find recipes in the corpus. Takes an array of search **specs** and returns one result group per spec, in one round-trip. Each spec applies its `facets` as the hard gate over the caller's available corpus — the household's **lens-visible** corpus minus the caller's rejects (the visibility note below); a spec's optional `vibe` picks the mode. **Without a vibe (membership):** returns every survivor, unranked, **including not-yet-embedded recipes**, uncapped by `k` — the named-dish / browse path. **With a vibe (ranked):** embeds the vibe and ranks the embedded survivors by cosine, re-ranked by taste and freshness; unembedded survivors are dropped and the top-`k` returned. Backend-agnostic ranking: the middle leg is a brute-force cosine over a D1 `recipe_derived` join today; a future Vectorize swap is invisible to the caller. Reads the index (`src/recipe-index.ts`); ranked specs additionally read the embeddings (`recipe_derived`), the caller's overlay / cooking log / preferences, and the alias table. An empty table returns empty result groups; an unreadable table returns `index_unavailable`.

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
- **The visibility lens gates membership in both modes.** The available corpus is the caller's household's **lens-visible** set, resolved through the one shared enforcement point (`src/visibility.ts` over the `recipe_imports` grant relation): a recipe is visible when the caller's household imported it, a friend household imported it, or it carries a **curated** grant (suppressible household-wide via the `curated_hide` preference). Under the **self-hosted** deployment profile the lens is implicit all-to-all — every household's non-curated imports are visible, i.e. the full attached corpus. Ranked mode gates candidates on the same lens **before** cosine, so rank can never admit an out-of-lens recipe.
- **Opt-out visibility within the lens — no status filter.** A visible recipe with no overlay row is neutral/available; the default result for an unfiltered membership spec is the **lens-visible corpus minus the caller's rejects**. There is no `status` filter and no per-member active set; a rejected recipe (`set_recipe_disposition(slug, "hide")`) is excluded entirely (a hard gate) in both modes.
- **Makeability gate (default-on):** joins the caller's kitchen `owned` and drops recipes whose `requires_equipment` is not a subset of `owned`. An **empty/absent** `owned` (unknown inventory) makes the gate a **no-op** (everything passes). `include_unmakeable: true` disables the drop and instead returns those recipes annotated with `missing_equipment` — use it when surfacing a specifically **named** dish so it's flagged, never silently dropped.
- Array filters (`dietary`, `season`) match **all** listed values (AND/narrowing). **There is no `tags` filter** — keyword/tag matching is done by `query`.
- `course` (string): the **open-vocabulary** dish-type facet (`main | side | dessert | breakfast | component | …` — `component` is a sub-recipe/building block like a dough or stock), matched by **containment** — `course: "side"` returns every recipe whose `course` array includes `side`, including a dual-use `[main, side]` dish. Matched literally against the normalized index (no controlled set). One vibe-less faceted spec returns mains and sides together (each entry's `frontmatter` carries `course`); the caller buckets by `course`. `search_recipes` applies **no default course gate** — it is an explicit-query tool, so a caller asking for sides/sauces/components keeps getting them (the default main-course gate belongs to the suggestion surfaces: `propose_meal_plan`'s pools and the app's picked-for-you/trending rows).
- `query` (string): the single name/keyword search over `title` **and** `tags`. Tokenize on whitespace, drop connective stopwords (`and`, `or`, `with`, `the`, `a`, `an`, `of`, `in`, `on`, `for`, `&`), then keep a recipe when **every** remaining token is a case-insensitive substring of its `title` or any `tag` (token-AND). Deterministic membership only — no ranking. So `"chicken and rice"` ≡ `"chicken rice"` and surfaces a recipe titled "Chicken and Rice" even when its tags omit "rice". Pair with a **vibe-less** spec for named-dish lookup so the match set is exhaustive and a just-imported recipe is included.
- `exclude_cooked_within_days` (number): drop recipes cooked within the last N days. `not_cooked_since` (date): recipes with `last_cooked: null` (never cooked) **pass**.
- **Ranked mode — facet gate first, then cosine.** Hard constraints are applied by the same `filterRecipes` gate as membership mode (including makeability); cosine only ranks the survivors.
- **Ranked mode — re-rank = cosine + three small nudges.** `+ favoriteWeight · max cosine to any favorited recipe` (taste *direction* — nearest-liked, not a centroid; no-op on cold start), `+ freshness` (never-cooked surfaced by `novelty_boost`; cooked-within-`resurface_after_days` linearly demoted), and `+ pantry overlap` (below). The nudges are deliberately small relative to cosine. Favorites are the caller's `favorite`-flagged recipes (set via `set_recipe_disposition(slug, "favorite")`); `rotation.{novelty_boost,resurface_after_days}` come from preferences, defaulting when unset.
- **Ranked mode — pantry overlap = two-tier, saturating, perishable-weighted.** For each `boost_ingredient`, a hit on the recipe's `perishable_ingredients` (the waste-prevention win) counts more than a hit on only its `ingredients_key`; the weighted sum saturates and scales by a small weight. Boost items and ingredient lists are alias-normalized before exact set-overlap — synonym recall depends on the alias table, **not** on ingredient embeddings. The weights are fixed constants today.
- **Ranked mode — unembedded recipes are dropped.** A just-imported recipe whose embedding the cron hasn't reconciled yet is excluded from a ranked group (not an error) — it stays findable via a **vibe-less** membership spec until the next reconcile.
- **One round-trip, at most one embedding call.** All vibe-bearing specs embed through the shared **query-embedding cache** (see `docs/SCHEMAS.md`) — cached phrases (recently embedded by either this tool or `propose_meal_plan`) cost no AI request, and the misses batch into a single Workers AI call; a batch of only vibe-less specs makes **no** AI request. Pass several diverse vibe specs (a vibe, a variety/wildcard, a never-cooked novelty) for recall rather than many calls.

### `read_recipe(slug)`

Read a single recipe's full content (frontmatter + body).

**Params:**
- `slug` (string, required)

**Returns:**
- `{ slug, frontmatter, body }` — `frontmatter` includes the objective shared fields, among them `perishable_ingredients` (a normalized list of the recipe's perishable ingredients; empty when absent), `course` (the open-vocabulary dish-type array — `main | side | dessert | breakfast | component | …`; empty when absent), and `pairs_with` (slugs of suggested corpus sides), plus the AI-generated `description` (merged from the derived `recipe_derived` store; absent until the reconcile first generates it). The `perishable_ingredients` and `course` fields also ride each entry's `frontmatter` from the index-backed `search_recipes`, so the menu-gen waste callout and the mains/sides faceting reason over them without any extra tool.

**Notes:** The read is **lens-gated**: a slug outside the caller's visibility lens returns the same structured `not_found` a nonexistent slug does — byte-identical, resolved before any body read — so the tool is never a slug-probing oracle.

### `display_recipe(slug)`

Render a recipe as an **inline, branded card** in the conversation — the bespoke in-chat widget (`ui://recipe/card`). Call it when the member wants to **SEE** a recipe; call `read_recipe` instead when you only need to read a recipe to reason over it (meal planning), so an internal read never forces a card render. Reuses `read_recipe`'s reader over the shared corpus + the caller's overlay. It is also the conversation's **guided-cook surface** (D32): the card carries a **Start Cooking** mode (mise-en-place check-off, step-by-step navigation, per-step timers) whose steps come from the `cook` block when a skill supplies one, else from a client-side parse of the recipe body, plus **favorite** and **log-cooked** controls the widget **writes** back through the app bridge.

**Params:**
- `slug` (string, required)

**Returns:**
- A **widget-bearing** result: `_meta.ui.resourceUri` is `ui://recipe/card` (the MCP Apps resource the host mounts as an iframe), `structuredContent` carries the recipe's display fields (title, facets, `time_total`/`dietary`, the caller's `favorite` overlay, the markdown `body`, `contract_version`, and the optional `cook` block — the `RecipeCardData` shape in [`SCHEMAS.md`](SCHEMAS.md)), and `content` is a plain-text rendering of the same card, the fallback for a host that cannot render the widget.

**Notes:** An unknown slug — or a slug outside the caller's visibility lens, indistinguishably (the same lens gate as `read_recipe`) — returns a structured `not_found` (nothing rendered). The `ui://recipe/card` resource is served over MCP `resources/read`, not a Worker HTTP route. A **writing widget** (D18): a favorite tap calls `toggle_favorite` (the recipe card's own dispatch alias onto `set_recipe_disposition`, per the registration model above) and mirrors state to the host model (`ui/update-model-context`, no message); a log-cooked calls `log_cooked` and mirrors state plus a `ui/message`; cook completion sends a `ui/message` only — the writes never route through the model, and a failed (`isError`) write is never announced as done. The widget re-hydrates `favorite` via `read_recipe` at boot before enabling writes, and degrades to a read-only card on an unknown-newer `contract_version` (D19). Tool/skill boundary: this tool owns *how* a recipe renders inline and cooks; the skill (`cook`) owns *when* to show one — call `display_recipe` to display or guide cooking a recipe, `read_recipe` to reason over one.

### `set_recipe_disposition(slug, disposition)`

Set the caller's **personal disposition** on a recipe — `disposition` is one of `"favorite"` (THE positive taste signal: anchors the `search_recipes` nearest-liked re-rank and the group "favorited by N others" signal on `read_recipe_notes`), `"hide"` (removes it from the caller's `search_recipes` results — a hard gate, both membership and ranked modes), or `"none"` (returns it to neutral/available). The three are **mutually exclusive by construction** — setting one clears the others. Writes only the caller's per-tenant overlay — never the shared recipe, so one member's disposition never affects another's.

**Params:**
- `slug` (string, required) — must resolve against the recipe index (D1 `recipes`)
- `disposition` (`"favorite" | "hide" | "none"`, required)

**Returns:**
- `{ slug, overlay }` — the caller's resulting overlay row; **no `commit_sha`** (the overlay is D1-backed, not a git commit)

**Errors (structured):**
- `{ error: "not_found" }` — unknown slug, writing nothing.

**Notes:** `"favorite"` sets the favorite flag and clears any reject; `"hide"` sets the reject flag and clears any favorite; `"none"` clears both, and the overlay row is DELETEd when nothing else is set on it (no lingering zeroed fields). "hide" is deliberately the member-facing word — the underlying reject semantics are unchanged from before the fusion. `toggle_favorite(slug, favorite)` / `toggle_reject(slug, reject)` remain registered as one-window **dispatch aliases** (see the deprecation convention above): identical requests and responses, no `warnings` injection. At window close they flip to app-plane-only registrations for the recipe-card widget rather than disappearing (`display_recipe`'s notes above).

### `import_recipe({ url? | text?, title? })`

Bring a recipe into the shared corpus in **one call** — takes **exactly one** of `url` or `text`, plus an optional `title` hint, and returns the landed slug. No frontmatter is supplied by the caller: the tool classifies and persists it internally, so the agent never assembles judgment fields (protein, cuisine, tags, dietary, `ingredients_key`) by hand.

**Params:**
- `url` (string, optional) — a recipe page to fetch and parse.
- `text` (string, optional) — pasted recipe content to classify directly (no fetch).
- `title` (string, optional) — a title hint, used when the source's own title is missing or unusable.

**URL path:** fetches the page and extracts its schema.org `Recipe` JSON-LD (handles `@graph`, top-level arrays, multiple script blocks, `@type` as string or array, and instructions as `HowToStep`/`HowToSection`/plain strings). The page's schema.org `tool` list, when present, is surfaced **internally** to the classification stage as a non-authoritative `tools_hint` informing the conservative `requires_equipment` gate — never written directly, never returned.

**Text path:** classifies the pasted content directly (`env.AI`, with a corrective retry) into contract-valid frontmatter and body — no page fetch. Use it for a recipe pasted from a bot-walled site, or dictated by the member. Genuinely unclassifiable text (no discernible ingredients/instructions split) returns a structured `validation_failed` and writes nothing.

Both paths populate every required **authored** field themselves (`title`, `source`, `time_total`, the two hard gates `dietary`/`requires_equipment`, `pairs_with`) and converge on the shared create operation: slug derived from the cleaned dish name (any parenthetical gloss excluded from the slug basis), `slug_exists` refusal on a genuine collision, `recipe_imports` attribution (`via 'agent'`, the resolved member) recorded beside the write, no `status` stamped, and the synchronous description/facet seed (`recipe-facet-derivation`) so the import is immediately findable via a vibe-less `search_recipes` spec.

**Returns:**
- `{ slug }` — a fresh import.
- `{ slug, already_existed: true }` — **dedup-to-grant**: the `source` URL was already in the shared corpus. No second copy is written; the caller household's visibility grant is minted (idempotently) on the existing recipe. This is a **success**, not an error — an import that lands the recipe in the caller's cookbook is exactly what was asked.

**Errors (structured), URL path only:**
- `{ error: "unreachable" }` — the page couldn't be fetched (network error or non-2xx), or the egress guard refused it (a non-`http(s)` scheme, embedded credentials, a private/loopback/link-local host, or a redirect into one) — the latter carries **no** status, indistinguishable from a dead host. Bot-walled/paywalled sites (Serious Eats, NYT, Food52) land here — paste the recipe as `text` instead.
- `{ error: "no_jsonld" }` — no `<script type="application/ld+json">` on the page.
- `{ error: "not_a_recipe" }` — JSON-LD present but no schema.org `Recipe`.
- `{ error: "incomplete", missing: [...] }` — a `Recipe` was found but yielded no ingredients and/or no instructions.
- `{ error: "validation_failed" }` — `url` and `text` were both supplied, or neither was.

**Notes:** Recipe **editing** is not this tool's job — the member web app owns member edits, and merge-review resolution lands on the fast-follow admin merge screen (`recipe-dedup`). `import_recipe` fuses the retired `parse_recipe` (URL parse) and `create_recipe` (persist) into one call; both operations persist internally (behind this tool and the discovery sweep) but are no longer separately model-advertised.

---

## Recipe note tools

Notes are the **spin-capture mechanism**: a tweak or observation is an *attributed note*, never an edit to shared recipe content. The canonical recipe stays canonical; "sub gochujang, cut the sugar" lives as a note. This is what makes a shared corpus safe — only a genuine "different dish" warrants a personal-recipe fork. Notes are stored in the D1 `recipe_notes` table (attributed by `author` column), so authorship is structural, not a spoofable field. Chat carries **capture and read only** — an author edits or deletes their own note from the member app's recipe detail page, over the same shared note-mutation operation (addressed by the note's `created_at`; re-tiering rides the same edit).

### `add_recipe_note(slug, body, tags?, tier?, private?)`

Append an attributed note to a recipe (shared or personal) in the caller's notes. **Append-mostly** — prior notes are retained, never overwritten; shared content is never touched. **Lens-gated**: only recipes inside the caller's visibility lens are writable — an out-of-lens slug returns the identical `not_found` a nonexistent slug does.

**Params:**
- `slug` (string, required) — the recipe the note is about.
- `body` (string, required) — free-form markdown (the tweak/observation).
- `tags` (array of strings, optional) — e.g. `["tweak"]`, `["observation"]`.
- `tier` (`"public" | "friends" | "private"`, optional) — the note's visibility tier, default **`friends`**. `friends` = the author's household plus its friend households (everyone on a self-hosted deployment); `private` = the authoring member only; `public` = anyone who can see the recipe, including the anonymous `/cookbook` site where (and only where) the recipe itself is anonymously visible.
- `private` (boolean, optional, **deprecated**) — the pre-tier alias, kept for stale plugin bundles: `true` → `tier: "private"`, `false` → `tier: "friends"`. `tier` wins when both are passed.

**Returns:**
- `{ slug, author, created_at, tier }` — D1-backed, no `commit_sha`

**Errors (structured):**
- `{ error: "validation_failed" }` — malformed slug or empty body.
- `{ error: "not_found" }` — slug outside the caller's lens (or nonexistent — indistinguishable).

### `read_recipe_notes(slug)`

Read the notes and favorites for a recipe — the collaborative-cookbook view. Notes follow the **visibility tiers**; favorites aggregate at read time across the households inside the caller's visibility lens (every household under the self-hosted profile; the caller's own plus friend households under SaaS).

**Params:**
- `slug` (string, required)

**Returns:**
```
{
  slug,
  notes:     [{ author, handle, created_at, body, tags, tier, private }], // ordered by timestamp
  favorites: [{ author }]                                                 // one per member who favorited it
}
```

**Notes:** The read is **lens-gated**: a recipe outside the caller's lens returns the identical structured `not_found` a nonexistent slug does — notes are unreachable for a recipe the caller can't see. Within a visible recipe the tier rules decide per note: the caller's **own** notes at every tier; **`friends`** notes whose author's household is the caller's own or a friend household (everyone under self-hosted — the pre-tier shared behavior); **`public`** notes from **any** household, even one outside the caller's lens (e.g. a public note on a curated recipe). Another member's `private` note is never returned. Visibility is a **live lens**: a new or severed friendship, or a re-tiered note, changes the very next read — nothing is materialized. `handle` is the author's display handle (joined from the members registry; the author id doubles as the founding handle). `private` is **deprecated** — derived (`tier === "private"`), kept one band for stale readers; key off `tier`. `favorites` is the group signal — `favorites.length` is the favorite count. Surface it ("favorited by two others") before recommending a recipe the caller hasn't tried.

---

## Pantry tools

### `read_pantry(filter)`

Read pantry items, optionally filtered.

**Params:**
- `filter` (object, optional): `{ category?, location?, prepared_only?, stale_only? }`

**Returns:**
- `{ items: [...] }` — array of pantry items per schema; each item carries the orthogonal `category` (food taxonomy) and `location` (where it's kept) fields, either of which may be absent

**Notes:** `category` filters on the controlled food taxonomy (`produce | dairy | meat | seafood | grains | bakery | canned | condiments | oils | spices | baking | frozen | snacks | beverages`); `location` filters on the kitchen location vocabulary (`fridge | freezer | pantry | spice_rack | counter | cabinet`); both plus `prepared_only` are deterministic from pantry data. An absent `category` means not-yet-classified — treat it as uncategorized, never an error (the background `ingredient-category` pass fills it). For one deprecation window, a legacy location-flavored `category` filter value (`pantry | fridge | freezer | spices`) is mapped onto the corresponding `location` filter (the deprecation convention above) so cached-plugin reads keep working across the vocabulary split. Because `spices` is also a food-taxonomy value, the mapping wins during the window: `category: "spices"` reads as `location: "spice_rack"`, so a classifier-categorized spices row with no member-set location is not returned by that filter until the window closes — filter on `location` for shelf placement; `category` filtering is vocab-first once the window closes. `stale_only` returns a structured `{ error: "unsupported" }`: freshness is an LLM-judged, conversational concern (it depends on storage, whether a package was opened, and visual inspection) rather than something the tool can compute. There is no shelf-life table backing it — the curated `guidance/ingredient_storage/` tree (see `read_guidance`) informs put-away advice rather than gating staleness.

### `update_pantry(operations)`

Apply pantry operations from conversational messages — adds/merges, verification stamps, plain corrective removes, removal-as-disposition (`dispose`, the waste-telemetry capture point), and the **kitchen-equipment** operations (`equip`/`unequip`/`set_kitchen_note`) folded in from the retired `update_kitchen` tool. `mark_pantry_verified`'s job is the `verify` op below — there is no standalone verification tool.

**Params:**
- `operations` (array): `[{ op: "add" | "remove" | "verify" | "dispose" | "equip" | "unequip" | "set_kitchen_note", item?, name?, disposition?, reason?, event_id?, occurred_at?, slug?, key?, value? }]`
  - `add` (upsert-merge) / `verify` take an `item` object / `name`; items carry two orthogonal controlled fields — `category`, the food taxonomy (`produce | dairy | meat | seafood | grains | bakery | canned | condiments | oils | spices | baking | frozen | snacks | beverages`), and `location`, where it's kept (`fridge | freezer | pantry | spice_rack | counter | cabinet`) — plus the loose `quantity`, `prepared_from`, and an optional freeform `notes` string. Omit `category` to let the background classifier derive it: NULL reads as uncategorized, never an error. `add` is an **upsert**: re-adding an existing canonical item merges into it (overlay incoming fields, preserve `added_at`, refresh `last_verified_at` to today, **keep the surviving row's existing `name`/`display_name`** rather than adopting the incoming surface form) instead of duplicating, and the result carries `merged: true`; a fresh insert omits `merged` (or sets it `false`).
  - `remove` is a plain correction/cleanup delete and records **nothing** — mistakes and stale-row cleanup are not waste.
  - `verify` resets `last_verified_at` to today on the named item — the sole verification surface (the retired `mark_pantry_verified` tool's exact job).
  - `dispose` — `{ op: "dispose", name, disposition: "used" | "waste", reason?, event_id?, occurred_at? }` — removes the row when food actually leaves the kitchen. `used` (consumed) is pure removal recording nothing today. `waste` additionally persists exactly one `waste_events` row; `reason` is then required, exactly one of `spoiled | moldy | over_ripe | expired | freezer_burned | stale | forgot | bought_too_much | never_opened | other`.
  - `event_id` (dispose, optional): a client-minted idempotency key (1–64 chars of `[A-Za-z0-9_-]`; the member app mints a ULID at tap time). A replayed dispose with the same id reports applied and writes nothing — exactly one event ever exists under it. Omitted, the server mints one.
  - `occurred_at` (dispose, optional): ISO date (`YYYY-MM-DD`) the toss happened, so an offline toss replayed later records the right day; defaults to today.
  - `equip` / `unequip` — `{ op: "equip" | "unequip", slug }` — adds/removes an owned kitchen-equipment slug (the makeability gate's left operand). `slug` **must** be a known `EQUIPMENT_VOCAB` value (`pressure-cooker | sous-vide-circulator | blender | ice-cream-maker`); an off-vocab `equip` is a **conflict**, never a silent write. Equipping an already-owned slug is **idempotent** (no-op, not a conflict); unequipping an absent slug is a conflict.
  - `set_kitchen_note` — `{ op: "set_kitchen_note", key, value }` — sets a freeform kitchen note (oven count, pan sizes). Informs the `cook` flow only; **never** gates a recipe.

**Returns:**
- `{ applied: [...], conflicts: [...], warnings?: [...] }` — D1-backed, no `commit_sha`. `applied` entries for `dispose` carry `{ op, name, disposition }`; equipment-op entries carry `{ op, target }`; `warnings` (`{ op, name, field, reason }`) reports D21 conversions/drops per the deprecation convention above, omitted when empty.

**Notes:** Write validation runs in the shared apply path, so this tool and `POST /api/pantry/ops` enforce identical rules: an off-vocabulary pantry `location` is a per-op **conflict**, never a silent write; a legacy location-flavored `category` (`pantry|fridge|freezer|spices`) is transposed onto `location` for one deprecation window; any other off-vocabulary `category` is accepted-and-dropped with a `warnings` entry. Shape violations (missing disposition, waste without/with an unknown reason, malformed `event_id` or `occurred_at`) are a whole-call `validation_failed`; semantic misses (a remove/dispose/verify/unequip whose target isn't present, or an off-vocab equip) are per-op conflicts — the agent should ask the user how to resolve. **Disposition never asks or accepts a dollar value** — the op has no value/price/cost field, and the event's value is derived later from purchase history (band 4), so never prompt the member for what an item cost. A waste event's analytics `department` is stamped at capture from the item's identity — a `prepared_from` (leftover) row stamps `leftovers`; otherwise the row's in-vocabulary category, else the ingredient-identity memo, else NULL-pending (filled once by the `ingredient-category` cron, never rewritten). Pantry state is D1-backed (the `pantry` + `waste_events` + `kitchen_equipment` tables + `profile.kitchen_notes`) — no git commit. Staples and the bulk-buy stockup watchlist are separate per-tenant lists the member web app curates over their own shared operations — there is no `update_staples`/`update_stockup` MCP tool; both are read via `read_user_profile`'s `staples`/`stockup` fields.

---

## Meal-vibe palette tools

The **meal-vibe palette** is each member's durable, editable "shape of a week" — a set of saved `search_recipes` specs (a `vibe` phrase + optional `facets`) each carrying a **`meal`** (`breakfast | lunch | dinner` — which meal's slots it can fill; projects are never vibe-driven), an optional **`members`** assignment (opaque member handles; absent = everyone — D29-final), and lifecycle metadata (a `cadence_days` period, `weather_affinity` bucket membership, an optional `season`, `pinned`, `base_weight`). `propose_meal_plan` partitions this palette by meal at Level 1 to shape the week, then fills each slot at Level 2. Per-tenant private profile data — stored in the D1 `night_vibes` table (the table deliberately keeps its name; only the tool family renamed — D21), siblings of `staples`/`stockup`; the vibe text's embedding is reconciled on the cron (hash-gated) like `taste_derived`, so a fresh vibe is retrievable a tick later — and because the hash covers the **text** only, a `meal`/`members` change re-embeds nothing.

`weather_affinity` is discrete **bucket membership**, not a graded score: a vibe belongs to zero or more of `grill | cold-comfort | wet` (both the new category names and the legacy `soup | comfort | grill-friendly | light | no-grill` tags are accepted and resolve to the same buckets — see `propose_meal_plan` below). No membership (the default) makes a vibe a **universal filler**, eligible for every weather category's slots. Weather allocation is **dinner-scoped**: an affinity stored on a breakfast/lunch vibe is preserved on the row but **inert** in allocation. `weather_antipathy` is accepted for backward compatibility but is not consulted by `propose_meal_plan`'s allocation.

`add_meal_vibe` is the **only** member-chat meal-vibe tool. The palette is **read** via `read_user_profile().meal_vibes` (each vibe with its `meal`, `members`, and derived cadence status); **editing and removing** a vibe is the member web app's vibes page, over the same shared palette operations (`patchNightVibe`/`deleteNightVibe`) — there are no `list_meal_vibes`, `update_meal_vibe`, or `remove_meal_vibe` MCP tools. Palette **archetype suggestions** are produced only by the scheduled generative reconcile pass (`meal-vibe-archetype-derivation`) — there is no on-demand `suggest_meal_vibes` tool; candidates land as pending proposals in the member app's reconciliation queue, not a chat-tool result. `add_night_vibe` remains registered for one deprecation window as a dispatch alias onto `add_meal_vibe` (identical requests/responses, no `warnings` injection — owned by the separate `remove-meal-dimension-shims` gate); the `list`/`update`/`remove`/`suggest_night_vibes` alias rows fall away with their retired `*_meal_vibe` targets (an alias cannot outlive its target).

### `add_meal_vibe(vibe, id?, meal?, members?, …meta)`

Add a meal vibe. `vibe` (required) is the craving/query phrase; `id` defaults to a slug of the vibe; `meal` (`breakfast | lunch | dinner`, default `dinner`) picks which meal's palette it samples into — a lunch vibe only ever fills lunch slots. `members` (string[], optional) assigns the vibe to specific household members (opaque handles, non-empty, deduped, stored verbatim; omitted = everyone): an assigned vibe contributes slots and cadence-debt only when one of its members is in the effective eating set, and a list naming nobody the roster recognizes contributes as everyone (fail-open, noted in propose diagnostics) rather than silently vanishing. Meta: `facets` (hard-gate search facets), `cadence_days` (target period — 7 ≈ weekly, 30 ≈ monthly, drives the debt scheduler), `pinned` (sticky weekly intent), `base_weight`, `weather_affinity` (discrete bucket membership — `grill | cold-comfort | wet`, or a legacy tag from `soup | comfort | grill-friendly | light | no-grill` that resolves to the same buckets; omit for a bucketless universal filler; dinner-scoped — inert on a non-dinner vibe), `weather_antipathy` (accepted, not consulted by allocation), `season` (`spring | summer | fall | winter`).

**Returns:**
- `{ id }`

**Errors (structured):**
- `{ error: "conflict" }` — a duplicate id; edit the existing vibe from the member app's vibes page instead.
- `{ error: "validation_failed" }` — no id derivable from `vibe`/`id`, or a `members` entry is an empty string.

**Notes:** `add_night_vibe` is the deprecated alias (see above).

### `propose_meal_plan(meals?, attendance?, nights?, seed?, lock?, exclude?, boost_ingredients?, nudges?, slots?, ephemeral_vibes?, new_for_me?)`

Propose a week of meals from the caller's meal-vibe palette **or** a caller-authored ephemeral vibe set — **stateless, deterministic, no writes**, and at most **one batched, cache-gated Workers AI embedding call** per request: only the `nudges.freeform` phrase, any `slots[].vibe` override phrases, and any `ephemeral_vibes[].vibe` phrases not already served by the query-embedding cache are embedded (one batched call covers all misses); a request supplying **no such text makes no AI call** — every other query vector is cron-captured. The member app's `POST /api/propose` runs the **same shared operation** with the same input and result shape (one contract). Two levels, with the shape level run **per meal**: **(1) shape** — the palette partitions by `meal` and each meal's slots are sampled from **that meal's vibes only**, by **cadence-debt** (a vibe overdue against its `cadence_days` surfaces; pinned vibes are placed; overdue placement yields ≥1 slot to the weighted pool) combined with **discrete weather-bucket quotas**: each forecast day collapses to exactly one category (`grill | cold-comfort | wet | mild`), the window's day-category mix is histogrammed into integer slot quotas (largest-remainder rounding — mirroring the forecast's proportion, e.g. one hot day in seven yields a small `grill` quota, not full-strength pressure on every slot), and each category's quota is filled from that category's member vibes plus bucketless (universal-filler) vibes, ranked by cadence-debt; a quota with no eligible member, and every `mild`-day slot, degrades to the flex pool (the whole remaining palette) so a slot is **never** left empty for lack of a weather match. **Weather quotas apply to the DINNER pass only** (breakfast/lunch sample on cadence-debt alone — their passes see a neutral all-`mild` histogram, and a `weather_affinity` stored on a non-dinner vibe is preserved-but-inert); **(2) fill** — retrieve each slot's vibe by meaning (the same ranked retrieval as `search_recipes`) and select a **varied** main in **one shared compose pass across all meals** — MMR + protein/cuisine caps span the whole week, and the engine emits one recipe **at most once per proposal, across all meals** (the engine half of the D26-final planner-no-duplicates invariant; explicit `lock`s/`slots[].recipe` pins are the only exemption) — then compose rung-1 `pairs_with` corpus sides. Each slot's candidate pool is **course-gated by its meal**: dinner and lunch slots volunteer only recipes whose effective `course` includes `main` — or is **empty** (fail-open: a not-yet-classified recipe is unknown, never silently hidden) — and **breakfast slots gate on `course` includes `breakfast`, or empty** (the same fail-open), so a component/side never fills any slot by default and a dinner main never fills a breakfast slot; the slot's alternates come from the same gated pool, so they are gate survivors by construction. A vibe authored with an explicit `facets.course` (e.g. breakfast-for-dinner) **suppresses the default** — that slot gates by its own course containment alone. `lock`s and `slots[].recipe` pins are **exempt** (an explicit caller choice is honored regardless of course), and a vibe whose entire pool the gate empties returns the existing **explicit empty slot** (reason set, no alternates) — pin a recipe or author the vibe with a `course` facet to escape. The fill also does **holistic use-it-up**: it derives the caller's at-risk perishables from their **pantry** (always-on — no param) and spreads them across the week's mains via a bounded, decrementing set-cover term, so a multi-serving item (a family pack of ground beef) can be used across **two** mains and residual is reported — all subordinate to vibe relevance and the hard gate.

**Vibe-meal binding: an empty meal is explicit, never a fallback.** A meal requested with a count > 0 but **zero vibes of that meal** returns that many **explicit empty slots** (`empty_reason: "no_palette_for_meal"`) plus a `notes[]` entry naming the escapes — `add_meal_vibe` with that meal, or an `ephemeral_vibes` entry carrying `meal` — and **never silently falls back into another meal's palette**.

**Attendance (D29-final) — soft only, fail-open.** The propose contract is household-blend-first with today's single-member tenant as the degenerate case: **hard constraints** (dietary gates, rejects) are the **union across the household roster** and **never move with attendance** (an absent member's hard constraints still apply); **soft ranking** blends member taste profiles with uniform weights over the **effective eating set**. `attendance` takes exactly one of `{ away: [...] }` or `{ only: [...] }` (both is `validation_failed`); handles are opaque strings. Unknown handles are **dropped, never errors**, and echoed in `diagnostics.attendance.ignored`; the effective set is `only ∩ roster` or `roster − away`; an **empty effective set fails open to the full roster** (with a diagnostics note) — an attendance mistake can never produce a plan for nobody. A `members`-assigned vibe contributes slots and cadence-debt only when its members intersect the effective set (absent = everyone; an all-unresolvable list contributes as everyone, noted). `diagnostics.attendance = { effective, ignored, notes? }` is always returned; in today's single-member deployment every call ranks as the whole (singleton) household — byte-for-byte the pre-attendance ranking.

**Shaping is a spectrum — the saved palette or a caller-authored ephemeral set.** With no `ephemeral_vibes`, level 1 samples the saved palette as above (per-meal cadence-debt; dinner × weather quotas). When the caller supplies an `ephemeral_vibes` set — an ordered `{ vibe, facets, meal? }` set authored for this one request, the **same primitive** as a saved meal vibe but with no cadence history and no persistence — those entries **become the week's slots, with their meals** (`meal` defaults `dinner`): each `vibe` phrase is embedded and ranked exactly like a `slots[].vibe` override, its `facets` gate that slot, and its `meal` selects the slot's meal and meal-default course gate, **replacing** the palette cadence sampling for this request (the `meals` counts don't apply — the authored set IS the week's slots). Both paths then run the identical level-2 fill, MMR + facet-spread diversify, and hard gate — the ephemeral set supplies slot intent, never selection, so it does not bypass the diet/reject/makeability gate. This makes the agent surface (which authors the set from interpreted intent) and the bare/web-app surface (which lets the palette shape the week) one spectrum over one engine. `new_for_me` (accepted `list_new_for_me` discovery slugs, in priority order) **force-places** each resolvable, non-excluded, non-rejected discovery into the week — below the caller's pinned vibes, above overdue ones — within its weather-bucket quota, seeding the plan rather than competing on cadence. Force-placement is a **palette-path** mechanism: `new_for_me` is honored when the palette shapes the week and is **inert when an `ephemeral_vibes` set drives it** (there the caller places discoveries by authoring — an ephemeral entry describing the discovery, or a `lock`).

The **planning window** (`preferences.planning_cadence_days`, days; defaults to 7 when unset) names how far out the caller plans/shops, independent of the per-meal counts (`meals`/`cadence` — slots **within** that window, per-window not week-scaled; a longer window alone doesn't imply cooking more often). The window drives three things: the weather forecast is requested for that many days out (replacing a fixed horizon, clamped to the forecast source's own supported range, and further capped at a ~10-day forecast-reliability horizon for category derivation — days beyond it are treated as `mild`), each meal vibe's **occurrence cap** for this plan — `max(1, floor(window / cadence_days))`, meal-orthogonal (computed from the window and the vibe's own period alone, never a meal's slot supply) — so a weekly vibe (`cadence_days: 7`) can be sampled into up to 2 slots of a 14-day window instead of at most once (a vibe with no period, or a period ≥ the window, still caps at 1; this cap, and "already placed" status, is enforced **globally across every category's quota fill**, not reset per category), and an overdue vibe whose bucket's quota is **zero** this window rolls over rather than force-placing into a mismatched slot — until its debt crosses the escape-hatch tier, at which point it force-places regardless. Recurrences are spread across the window (not placed adjacently) where the sampling mechanism allows it; determinism, pinned/overdue precedence, and rollover are unaffected. A recurring vibe never repeats the **same recipe** — cross-slot diversity (`usedSlugs`) still guarantees two occurrences of a vibe resolve to two different recipes.

**Params:**
- `meals` (object, optional): the per-meal slot counts `{ breakfast?, lunch?, dinner? }`, each an integer 0–14, **per-window** (not week-scaled). Each absent meal falls through the default chain: the stored `preferences.cadence[meal]` → the read-time derivation (dinner: the frozen `default_cooking_nights ?? 5`; breakfast/lunch: 0).
- `nights` (number, optional, **deprecated alias**): `meals.dinner = N` for one deprecation window; **ignored without error** when `meals` is supplied (a Deprecations row above).
- `attendance` (object, optional): exactly one of `{ away: string[] }` / `{ only: string[] }` — who's eating this window (soft ranking only; the hard floor never moves). Fail-open semantics above; both forms together is `validation_failed`.
- `seed` (number, optional): deterministic seed — the same inputs + seed give the same week; change **only** the seed for "give me another week." Defaults to today's date (stable within a day).
- `lock` (string[], optional): recipe slugs to keep — returned as `locked` **dinner** slots (a lock is "cook this this week" intent, dinner-shaped by construction; per-meal pinning goes through `slots[].recipe` or an `ephemeral_vibes[].meal` entry plus a pin); the rest of the week diversifies *against* them (won't duplicate/clash). Slugs resolve **case-insensitively** and **respect the reject hard gate**; a lock that's unknown, not-yet-embedded, or rejected is returned as an **explicit empty `locked` slot** (never silently dropped). Each lock occupies one dinner slot, so the sampled dinner count is `meals.dinner − lock.length`.
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
- `ephemeral_vibes` (array, optional): an ordered set of caller-authored `{ vibe, facets, meal? }` entries — the same primitive as a saved meal vibe, with no cadence history and no persistence; `meal` defaults `dinner`. When present it **shapes the week**: each entry becomes a slot of its meal (its `vibe` phrase embedded + ranked like a `slots[].vibe` override, its `facets` gating that slot, its `meal` picking the meal-default course gate), **replacing** the saved-palette cadence sampling for this request; absent, the palette shapes the week. Distill interpreted intent into it for a rich request; omit it for a bare "plan my week." It does **not** bypass the hard gate (diet/reject/makeability) or the diversify pass — it supplies slot intent, not selection — and palette-keyed `slots`/`new_for_me` inputs are inert while it drives.
- `new_for_me` (string[], optional): accepted new-for-me discovery slugs (from `list_new_for_me`), in priority order — each resolvable, non-excluded, non-rejected one is **force-placed** into the week as a **dinner** slot within its weather bucket (below pinned vibes, above overdue), seeding the plan rather than competing on cadence. A **palette-path** input: honored when the palette shapes the week, **inert when `ephemeral_vibes` drives it** (there the caller places discoveries by authoring — an ephemeral entry describing one, or a `lock`). An unresolvable / excluded / already-locked slug is simply dropped.

**Returns:**
- `{ plan, variety, uncovered_at_risk, diagnostics, notes? }`.
  - `plan`: **flat and meal-ordered** — breakfast → lunch → dinner, position-stable within each meal — one entry per slot: `{ vibe_id, meal, reason (pinned|overdue|sampled|locked|new_for_me), main, alternates, alt_similar, alt_different, sides, uses_perishables, flags, why, vibe_override?, recipe_pinned?, weather_category? }`. `meal` is the slot's meal (`breakfast | lunch | dinner`); a meal with no palette of its own returns explicit `empty_reason: "no_palette_for_meal"` slots (see above). A `new_for_me` slot is a force-placed discovery (palette path); a vibe-less `locked` slot is a caller `lock`. `main` is `{ slug, title, description, protein, cuisine, time_total, score }` or **`null`** for an **explicit empty slot** (`empty_reason` set — a vibe with no retrievable candidate, none clearing the caps, or an unresolvable pin — never silently dropped). `sides` are rung-1 corpus sides `{ slug, title }`. `uses_perishables` is the at-risk items this main **claimed** (decremented from the demand — what it actually uses up, not merely any perishable it lists). `flags`: `waste` (single-use perishables no other main shares, compared alias-resolved — canonical ids in the same form as `uses_perishables` — a cheap hint), `meal_prep`, `novel` (never cooked), `no_corpus_side` (add an open-world side). `why[]` explains the pick (incl. "uses your X" for a claimed at-risk item, the weather fit, a matched freeform ask, a requested protein, "your pick" on a pinned main); it may be empty (e.g. a plain overdue placement carries no badge).
  - **Swap material per vibe slot**, from its **already-computed ranked pool** (no extra retrieval or model call), excluding every recipe the week already uses: `alternates` — the top 6 remaining candidates as lites `{ slug, title, protein, cuisine, time_total }`; `alt_similar` — the remaining candidate nearest by cosine to the chosen main; `alt_different` — the highest-ranked remaining candidate of a different cuisine (each `null` when none qualifies). All are gate survivors by construction — a rejected, gated-out, or excluded recipe never appears. An **empty** vibe slot still returns its pool's alternates (the escape hatch for an over-constrained night); a vibe-less `locked` slot has no pool and returns none. Deterministic for a given request.
  - `vibe_override` / `recipe_pinned` (present when true): the slot's query vector came from `slots[].vibe` / its main was pinned via `slots[].recipe`. `weather_category` (`grill | cold-comfort | wet`, optional): the non-`mild` weather-category quota that placed this sampled slot — also folded into its `why[]`.
  - `variety`: `{ distinct_proteins, distinct_cuisines, mean_pairwise_sim, max_pairwise_sim }` over the chosen mains.
  - `uncovered_at_risk`: at-risk items the assembled plan could **not** use up (residual demand) — the honest "still going bad" signal, so the caller can re-roll, lock, or shop around them. `[]` when everything was covered (or there was no at-risk demand).
  - `diagnostics`: `{ seed, lambda, nights, filled, empty, rolled_over, meals, attendance }` — `rolled_over` are due vibes that didn't fit this week (debt keeps climbing); `meals` is the per-meal `{ requested, filled, empty }` map; `nights` stays for one deprecation window as the alias of `meals.dinner.requested`; `attendance` is `{ effective, ignored, notes? }` (always present — the effective eating set and the dropped unknown handles).
  - `notes` (string[], present when non-empty): the empty-meal escape nudges.

**Notes:** Every candidate pool draws from the caller's **lens-visible** corpus (the same visibility lens as `search_recipes`, applied before retrieval), so a proposal — mains, sides, alternates, locks, and pins alike — can never surface an out-of-lens recipe. An empty palette (no vibes of ANY meal) **and** no `ephemeral_vibes` set returns an empty `plan` with a `note` to add vibes (or pass an ephemeral set) first — an ephemeral set drives a proposal even on an empty palette. Determinism holds across **every** param: identical request bodies (with request-time vectors served from the query-embedding cache) produce identical responses — pins and nudges are inputs, and the seed fully determines the week given the inputs; this is what makes the stateless iteration loop (and the member app's client-side session replay) work. The tool never writes — persist an agreed plan with `update_meal_plan`, threading each slot's **`meal`** and its chosen main's `vibe_id` as the row's `from_vibe` so cooking it advances that vibe's cadence (`satisfied_vibe`); an ephemeral-authored week's slot ids are synthetic (no palette vibe), so there cook-time cosine attribution advances the palette instead of `from_vibe`. Sides are **corpus-only** (rung-1 `pairs_with`); open-world sides and freeform-text queries are the calling surface's job, so the tool never fabricates a side. Holistic use-it-up is **always-on** (derived from the pantry) — the caller doesn't need to pass `boost_ingredients` to get it; matching is keyword + alias set-membership over `perishable_ingredients`/`ingredients_key` (no vectors). The forecast that shapes weather quotas is loaded silently, server-side (`resolveTenantForecast`) — there is no separate weather tool; narrate weather-based reasoning only when the user asks.

---

### `display_meal_plan(meals?, attendance?, nights?, seed?, lock?, exclude?, boost_ingredients?, nudges?, slots?, ephemeral_vibes?, new_for_me?)`

Propose a week **and** render it as an **inline, interactive planning card** in the conversation — the bespoke in-chat widget (`ui://plan/propose`), the propose twin of `display_recipe`. Call it when the member wants to **see and tweak** a proposed week; call `propose_meal_plan` when you only need the data to reason over, and `read_meal_plan` to read the already-saved plan. Takes the **same input** as `propose_meal_plan` and reuses the **same shared stateless planner** (`runProposeMealPlan`) — same params, same shaping, same determinism (see `propose_meal_plan` above for the full semantics); it does **not** alter or replace `propose_meal_plan`, which stays a plain data tool. The card **commits the chosen week itself** (D18): its Commit control writes through `update_meal_plan` (re-reading the plan, packing open dates, writing each slot) rather than asking you to — see **Notes** below.

**Returns:**
- A **widget-bearing** result: `_meta.ui.resourceUri` is `ui://plan/propose` (the MCP Apps resource the host mounts as an iframe), returned **unconditionally** — never capability-gated, because the pinned SDK's UI-capability probe is unreliable, so a host that cannot render the widget still receives the fallback below. `structuredContent` carries the propose result's display fields (the proposed slots — **flat and meal-ordered, each carrying its `meal`** — with mains/alternates/sides/why/flags, `variety`, `uncovered_at_risk`, the per-meal + attendance `diagnostics`) **plus** the render context the card's controls need — the replayable `request` (which echoes `meals` and `attendance`), the vibe-id→label map, the palette presets, and the corpus protein/cuisine facet universes (the `ProposeCardData` shape in [`SCHEMAS.md`](SCHEMAS.md)). `content` is a plain-text rendering of the proposed nights, the fallback for a host that cannot render the widget.

**Notes:** A structured error from the shared op (e.g. a context-load failure) is returned as a structured result, **never thrown**, and carries **no partial widget payload**. The widget-initiated control set is the D8/D20 shared-component enumeration — per-meal slot counts, the swap menu (from the returned alternates), facet chips, per-slot vibe override, sides editing, and commit; the cut dials (slot lock/exclude controls, the adventurousness slider, protein-want chips, the freeform phrase input, global reroll, the weather strip) are member-surface control removals only and do not appear in the widget either, while the underlying tool params (`lock`, `exclude`, `nudges`, `freeform`, `seed`) are retained unchanged (swap and session replay are implemented atop lock/pin/exclude in the replayed request). The controls iterate **model-free**: they re-invoke the **stateless** `propose_meal_plan` op client-side (proxied straight to the server through the ext-apps host bridge, `App.callServerTool`), replaying the adjusted request and re-rendering with **no** additional frontier-model turn — the same client-side session replay the member app relies on. This is the first **writing** widget (D18): the card's **Commit** control performs the write itself rather than delegating to the model — on commit it re-reads the live plan with `read_meal_plan`, packs client-assigned open dates, writes each chosen slot (with its edited sides + `from_vibe`) via `update_meal_plan`, re-reads the committed plan, mirrors that snapshot to the host model (`ui/update-model-context`), and announces the commit (`ui/message`). Each refinement likewise mirrors the full proposed-week snapshot to the host model, and a sides edit refines the already-proposed week via that context channel **without** a re-query. Degradation ladder: a host that can proxy tool calls runs the write; one that can only message falls back to a sendMessage delegation; one that can do neither renders read-only. A payload whose `contract_version` exceeds the widget's known version renders read-only as well (degrade, don't crash). A host that cannot proxy tool calls (no `serverTools` capability) degrades to the rendered proposal without dials; the plan is never blocked. The `ui://plan/propose` resource is served over MCP `resources/read` (asserting a widget marker so the SPA-fallback shell is never mistaken for it), **not** a Worker HTTP route — so it needs **no `run_worker_first` entry** in `wrangler.jsonc`. Tool/skill boundary: this tool owns *how* a proposed week renders inline and iterates; the skill owns *when* to show one — `display_meal_plan` to plan interactively, `propose_meal_plan` to reason over the data.

---

## Profile-reconciliation tools — operator plane only

**These four tools register only for the operator's own tenant** (`OWNER_TENANT_ID`); a member connector never sees them. Members confirm their own reconcile proposals from the **member web app's reconciliation queue** instead — the same underlying queue, a different surface. The reconcile reconciles a member's **stated** preference (their meal-vibe palette + cadences) against **revealed** behavior (their cooking log). Background signal producers — the deterministic signal cron, the scheduled generative archetype-derivation pass, the pref-retirement seed pass — enqueue proposed profile edits into a per-member queue; the operator's own queue additionally carries corpus-curation **`merge_recipes`** review requests (below). An `add_vibe` proposal's payload carries the vibe's **`meal`** (default dinner), and the confirm apply writes it onto the created vibe.

### `list_proposals()`

List the operator's own **pending** reconcile proposals — suggested palette edits (prune a vibe never cooked, stretch a cadence kept deferred, tighten a cadence kept satisfied early), exactly as any member would see for themselves in the web app. The operator's queue **additionally** carries corpus-curation **`merge_recipes`** proposals (the scheduled dup-scan's suspected near-duplicate pairs — payload `{ slugs, titles, cosine, shared_ingredients, jaccard, detector }`); those are review requests, not diffs. Read-only. `{ proposals: [{ id, kind, target, rationale, payload, evidence, producer }] }`.

### `confirm_proposal(id, accept)`

Accept (`accept: true` → applies the diff: prune/adjust/add a meal vibe — an `add_vibe` payload's `meal` lands on the created vibe — marks accepted) or reject (`false` → recorded; the stable id means the same proposal is never re-surfaced) a proposal. For a **`merge_recipes`** proposal, accepting records the decision **only** — there is no chat-callable corpus write today (member recipe editing left the MCP surface with `update_recipe`'s removal), so folding two recipes together waits on the fast-follow operator admin merge screen; the proposal stays queued as that screen's ready-made backlog. **Rejecting** a `merge_recipes` proposal is the available resolution — it keeps both recipes and permanently suppresses the pair from re-proposal. Unknown id → `not_found`; an already-resolved id — `accepted`, `rejected`, or system-`superseded` (a pending near-duplicate the derivation convergence sweep collapsed) → `conflict` naming the status (the earlier resolution stands — treat as converged). Returns `{ id, status, applied? }`.

### `reconcile_read_signals()` — operator-only

Read the deterministic reconcile signals across **all** members (each member's palette size + drafted cadence signals) so the operator's own Claude can reason over the group and enqueue richer proposals. Gated on `isOperator` (caller's tenant == `OWNER_TENANT_ID`) as defense in depth atop the registration gate; non-operators never see this tool registered at all. `{ members: [{ tenant, palette_size, signals }] }`.

### `reconcile_enqueue_proposal(tenant, kind, target, payload, rationale, evidence?)` — operator-only

Enqueue a proposal for a member (the operator-frontier producer). The member still confirms it — from the web app's queue — before anything changes. Idempotent by `(tenant, kind, target)`. Returns `{ id, enqueued }`.

---

## Grocery list tools

The grocery list is the SKU-free buy list for the next order (D1-backed, `grocery_list` table). It accumulates intent across the week; resolution to a Kroger SKU and the cart write are deferred to order placement (`place_order`). Writes are D1-backed — no `commit_sha`. There is **one list surface per plane**: `read_to_buy` is the reasoning read, `display_grocery_list` the member-facing verb, and the app-plane `read_grocery_snapshot` the widget's boot read — there is no `read_grocery_list` tool returning the stored rows directly. See `docs/SCHEMAS.md` for the item schema.

### `read_to_buy(enrich?)`

The **derived to-buy view** partitions `shopping = (active list ∪ plan needs) − pantry coverage − active substitution suppressions` into unchecked `to_buy` and durable `checked`. `place_order`, order preview, satellites, and sidebar counts consume only `to_buy`; checked rows remain visible but cannot enter a cart. One shared operation backs the member endpoint and adds opaque `snapshot_version` freshness.

**Guarantees:** read-only and cheap — the default read makes **zero Kroger calls, zero AI calls, and writes nothing** (derived lines exist only in the read; no reconcile or cron materializes them into rows). The plan is the derived lines' source of truth: editing the plan changes the next read with no sync step. The optional **`enrich: true`** variant turns on **one** Kroger Locations resolve (label → locationId, the `flyer` tool's posture) that pays for **both** per-line aisle `placement` and per-line `substitutes` under that single resolve — **zero product searches** either way; the default read is byte-identical to the pre-param shape.

**Returns:**
```
{
  to_buy:        [{ name, quantity, assumed_quantity, for_recipes, origin, key, kind, domain, note?,
                    display_name?, placement?, substitutes? }],
                  // enrich only: display_name — the reified human label for the line
                  // enrich only: placement: { aisle_number?, aisle_description?, aisle_side?, department?, department_label? } | null
                  // enrich only: substitutes: [{ id, label,
                  //   relation: { role: "satisfies"|"sibling"|"generalization"|"substitution",
                  //               kind: "general"|"containment"|"membership"|"substitution",
                  //               via?, via_label?, weight?, qualifier? },
                  //               // via_label: curated label for via; weight/qualifier: substitution role only
                  //   in_pantry, in_cart?, on_list?, on_sale_hint?: { sku, description, price: { regular, promo }, savings } }]
  checked:       [{ ...to_buy line, checked_at, row_version, updated_at }],
  pantry_covered:[{ key, name, for_recipes, freshness: "covered"|"worth_a_look",
                    freshness_reason?, buy_anyway, on_hand, display_name? }],
  in_cart:       [{ key, name, added_at, row_version, sent_in, display_name? }],
  underived:     ["<slug>", ...],
  location?:     { id } | null,      // enrich only: the store the placements/hints are for
  flyer_as_of?:  ISO | null,         // enrich only: freshness of warmed flyer hints
  snapshot_version: "<opaque digest>"
}
```

- `origin` — `"list"` (an explicit row the plan doesn't need), `"plan"` (a **virtual** line derived from a planned recipe; no stored row exists — an `add`-op `update_grocery_list` of the same name **materializes/pins** it under the same canonical `key`), or `"both"` (a stored row the plan also needs, merged with unioned `for_recipes`).
- `quantity` is the package count the order would use; derived lines default to 1 with `assumed_quantity: true` (derivation is **presence-only** — no portion math).
- `pantry_covered` — the needs the pantry cancels: the **same set `place_order` returns as `partials`**, each joined with the pantry row's verify metadata so a stale-verified perishable earns a "still good?" nudge instead of a silent skip.
- `in_cart` — the stored in-cart rows: the deterministic **stale-cart signal** (non-empty at order time ⇒ a prior order was never confirmed placed).
- `underived` — planned recipes whose full ingredient list is **not yet derived**; their items are NOT in `to_buy` (reported, never silently dropped) — compensate explicitly.
- A derived need whose canonical id matches an **in-flight** (`in_cart`/`ordered`) row is suppressed from `to_buy` — it is already being bought (it shows under `in_cart`); receiving (pantry restock) or re-listing the row resolves it.
- `display_name` (**enrich only**) — the reified human label for a line, on `to_buy`, `pantry_covered`, and `in_cart`. An **id-named line** (an add-by-id row, a legacy id-named row, or a plan-derived line whose `name` equals its `key`) resolves the identity node's curated `display_name`, or a deterministic `base (detail)` synthesis — **never a raw `::` id**; a typed row keeps the member's own phrasing. An explicit row-level display overrides. The default read omits it (byte-identical); the app renders `display_name ?? name`.
- `placement` (**enrich only**) — the line's captured aisle at the caller's Kroger location, read from the shared `sku_cache` (learned by `place_order`'s commit; the untagged-`''` legacy row is the fallback), plus a `department` derived from the identity graph's parents (out-edges, precedence `membership` → `general` → `containment`, lexicographic tiebreak; absent when the key has no parent) with its curated human `department_label` (present exactly when `department` is — grouping/keying stays on the raw `department` id). With no resolvable Kroger location (walk/satellite primary), `location` is null and placements carry `department`/`department_label` only. Placements start sparse and **converge organically as orders run** — a line without one is an honest unknown, never a fabricated aisle.
- `substitutes` (**enrich only**) — cross-ingredient hints from a **depth-1 walk over the persisted identity graph**, every endpoint representative-resolved, concrete (buyable) targets only, the line itself excluded, then **narrowed to the actionable ones** and capped at 4. Emitted in fixed precedence — satisfies → `general`-kind siblings → generalizations → `containment`-kind siblings → `membership`-kind siblings (a broad class family like `vegetables` only surfaces when nothing better exists) → observed taste **substitutions** (a `substitution`-role/`substitution`-kind edge carrying its promoted `weight` and optional authored `qualifier`, ranked **last** so a factual identity relation always wins the slot) — each **labeled with its relation** (`role`, `kind`, the shared parent `via` for siblings and its curated human `via_label` when `via` is present, and `weight`/`qualifier` for a substitution): the walk proposes and names the relation; fitness for the dish is the caller's judgment. **Only targets carrying at least one actionability reason survive** — `in_pantry` (a pantry row for the id exists), `in_cart` (an in-cart grocery row), or `on_list` (an active grocery-list line), the three **possession** reasons requiring the member to already have or be acquiring the target, or `on_sale_hint` (an **independent** reason: surfaces even when unowned) — and this narrowing runs **before** the cap, so an actionable target ranked past the raw 4 is never starved by non-actionable higher-precedence ones. A target already on the to-buy set is no longer hidden: it surfaces as a **consolidation nudge** (flagged `on_list`/`in_cart`). `in_pantry`/`in_cart`/`on_list` are pure-D1 joins needing no location, so they are served even with **no resolvable Kroger location** (walk/satellite primary); `on_sale_hint` matches the primary store's warmed flyer rollup at the flyer reads' default sale floor (not caller-tunable here) once the store resolves — a cached hint, not a live price, and **no per-sibling Kroger search is issued**. The walk runs over the **whole** to-buy set in one batched neighbor read, not a per-line budget. Always an array when `enrich` is set — empty, never omitted, for a line with no graph neighbors **or none that clear the actionability filter** (the common case in a sparse graph) — no hint is fabricated. This is still **read-only**: acting on a hint reuses the existing writes only — a same-identity swap stages a `place_order` `overrides` entry, a cross-ingredient swap on an explicit row is an `update_grocery_list` add/remove pair, and one on a plan-derived virtual row is the materialize-add plus an order-scoped `place_order` `exclude`. Same-identity alternatives and cross-ingredient hints both surface here — there is no separate `suggest_substitutions` tool; the ranking core it used (`compareUnitPrice`) is pipeline-internal, reached only through `place_order` and the order-review widget's app ops.
- `flyer_as_of` (**enrich only**) — ISO timestamp of the warmed flyer rollup behind `substitutes[].on_sale_hint` (`null` when no rollup was used — cold cache, or no resolvable store) — the freshness caveat for the sale hints.

### `update_grocery_list(operations)`

Apply grocery-list operations in one ops-form call — `{ operations: [{ op: "add" | "update" | "remove", … }] }` (the `update_pantry` operations idiom) — applied row-level against D1 with per-op `applied`/`conflicts` reporting and no `commit_sha`. One call per turn's worth of writes; one bad op never sinks the rest.

**Params:**
- `operations` (array): `[{ op, name?, id?, quantity?, kind?, domain?, status?, source?, for_recipes?, note?, substitutes_for? }]`
  - **`add`** carries the full former `add_to_grocery_list` contract. Keyed by a **normalized name** that MERGEs a re-added name into the existing row (union `for_recipes`, reconcile `quantity`) via upsert rather than creating a duplicate; a merge **keeps the surviving row's existing display** rather than adopting the incoming surface form. Supply `name` and/or `id` — at least one is required.
    - `name` (string, optional) — the member's surface form. Required unless `id` is supplied.
    - `id` (string, optional) — an **already-canonical** ingredient id (e.g. `cabbage::color-red`). When supplied the row keys on it **directly** — validated as a **live** canonical id (well-formed AND a current identity survivor), **not** re-resolved through the normalization funnel — and the human label is **resolved from the identity node's `display_name` at read** (not copied onto the row). It dedups against any existing row on that id. A posted `name` is ignored for the stored key. An invalid or non-survivor id falls back to resolving `name` (or, with no `name`, is a structured `validation_failed`).
    - `quantity` (string, optional) — loose buy amount; defaults to `"1"`.
    - `kind` (optional): `grocery | household | other`.
    - `domain` (string, optional) — the store-TYPE it's bought at; defaults to `"grocery"` (common values `grocery | home-improvement | garden | pharmacy`). Orthogonal to `kind`; filters which in-store walk includes the item.
    - `source` (optional): `ad_hoc | menu | pantry_low | stockup`.
    - `for_recipes` (array of slugs, optional).
    - `note` (string or null, optional) — one-off brand request / occasion.
    - `substitutes_for` (string, optional) — the recipe ingredient this added item **stands in for**, when the add is a taste swap the member accepted. A capture signal only: it never affects the row (key, quantity, merge, or return). Honored for a **food** add only (best-effort); see `docs/ARCHITECTURE.md` → *the ingredient-normalization capture*.
  - **`update`** patches an existing item by `name` (`quantity`, `kind`, `domain`, `status`, `source`, `for_recipes`, `note`). Every mutation advances `row_version`/`updated_at` and preserves `checked_at` unless the app-plane checked tool changes it. `status` is orthogonal to checked.
    - **`status` transition guard** (enforced in the shared update operation, so every caller gets the identical guarantee): `active ⇄ in_cart` is freely writable in both directions, and an `ordered` item may be re-listed back to `active`/`in_cart` (a canceled order is a legitimate correction). `status: "ordered"` is accepted **only** as the user-asserted *"I placed the order"* advance on an item currently `in_cart`; that write stamps `ordered_at` with today's date. Any other write of `ordered` is reported as a **conflict** carrying the attempted transition (`{ name, from, to }`), not a thrown error. `place_order`'s in-cart advance and the satellite receipt flush's ordered advance are separate code paths, unaffected by this guard.
  - **`remove`** deletes by `name`; resolved through the same normalization funnel so a case/quantity/alias-varying removal hits its row. A removal **never writes spend** — it is not a purchase assertion (it is also how a changed mind leaves the list). To record a purchase for an item still `in_cart` (a collapsed "picked up" that skipped the mark-placed step), advance it to `ordered` via an `update` op **before** removing it.

**Spend guarantees** (spend-telemetry, enforced in the shared operation): the legal `in_cart → ordered` advance is the **purchase assertion** — for an item an order flush advanced (it carries a send linkage), the shared writer materializes the flush's send-snapshot line as a spend event, a **verbatim copy** of the send-time quote, exactly once per `(send_id, line_key)`. An item moved `active → in_cart` by hand carries no send linkage — marking it `ordered` advances the row but records **no** spend. Moving `in_cart → active` clears the linkage and records nothing. Re-listing an `ordered` item **voids** its recorded spend events (`voided_at` stamp — retained, never deleted) and clears the linkage. See [`place_order`](#place_orderpayload)'s send record and `docs/SCHEMAS.md` (spend telemetry).

**Returns:**
- `{ applied: [...], conflicts: [...] }` — `applied` entries: `{ op: "add", item, merged? }` / `{ op: "update", item }` / `{ op: "remove", name, removed: bool }`. `conflicts`: `{ op, name?, reason, code? }` — a semantic miss (an update/remove target that doesn't resolve, an illegal status transition) never sinks the rest of the call.

**Notes:** Promoting a low/out pantry item onto the list is a **prompted** decision (record `source: "pantry_low"` on the `add`), never automatic. Removing a **materialized** (`source: "menu"`) row while its recipe stays planned un-pins, it doesn't un-plan — the ingredient re-derives as a virtual to-buy line on the next `read_to_buy`. The lifecycle past `active` (`in_cart` → `ordered` → the terminal receive action) is driven by `place_order` and the user-asserted transitions — see [`place_order`](#place_orderpayload) below. `add_to_grocery_list(item)` and `remove_from_grocery_list(name)` remain registered for one deprecation window as dispatch aliases onto the `add`/`remove` operations (identical requests/responses, no `warnings` injection); the old single-patch call form — `{ name, ...patch }` with no `operations` — is detected by shape within this same tool and converted to a single `update` operation, returning the bare `{ item }` shape identically to before. See the deprecation convention above.

### Grocery snapshot and exact mutation tools — app plane (never model-advertised)

The following register with `_meta.ui.visibility: ["app"]` (the registration model above) — the grocery widget calls them by name through the app bridge, but they never appear in a model's `tools/list`. `display_grocery_list()` is the model-visible counterpart.

- `display_grocery_list()` returns `_meta.ui.resourceUri = "ui://grocery/list"`, versioned `GroceryListData`, and equivalent plain text. Use it for "show me my grocery list." The spawning payload is render-only; the widget re-hydrates before writes.
- `read_grocery_snapshot()` is the app-callable authoritative boot read with grouped sends, immutable persisted sent estimates/savings, and honest unlinked-cart degradation.
- `grocery_add(name)` / `grocery_remove(key)` are the widget's own replay-safe add / canonical-key remove — the app-plane analogs of `update_grocery_list`'s `add`/`remove` ops.
- `set_grocery_checked(key, checked, expected_row_version, snapshot_version, occurred_at?)` changes only checked/concurrency fields. A virtual check atomically materializes `source: "menu"`; identical replay succeeds and opposing stale state returns `conflict` with the current snapshot.
- `commit_shop(session_id, mode, store_slug, expected_checked_keys, snapshot_version, occurred_at)` is the sole in-store/manual completion boundary. `session_id` is a client-minted ULID retained for the trip; keys are the sorted, unique, complete eligible checked set. `store_walk` resolves the existing Offline store and domain server-side; `manual_shop` requires `store_slug:null` and uses grocery domain. Success atomically stores an immutable receipt/lines, receives grocery-kind food into pantry as verified, materializes estimated or unpriced spend through `src/spend.ts`, consumes exactly those grocery rows, and returns a fresh snapshot. Identical replay returns the stored receipt without re-pricing or duplicating effects. A changed payload returns `idempotency_conflict`; any snapshot/set race returns `checked_set_changed` and performs no effects. `commit_shop` rides no Kroger/Instacart/operator gate — it registers whenever the grocery widget does, purely app-plane (this closes the leak where it was previously model-visible).
- `set_grocery_buy_anyway` / `verify_grocery_pantry` persist Buy-anyway/Undo or Still-good verification. `set_grocery_substitution` persists accept/Undo with attribution invalidation and edited-row-safe cleanup.
- `relist_grocery_send_line(send_id, line_key, expected_row_version)` performs guarded `in_cart → active`, clears linkage, retains immutable history, and writes no spend. A non-null `send_id` must name the row's current open send and matching `order_send_lines` membership. Null is accepted only when no current open send has matching line membership, including an unlinked, dangling, already-placed, or open-send-without-line linkage—the same rows the snapshot places in its synthetic unlinked group.
- `mark_grocery_send_placed(send_id, expected_line_keys, snapshot_version)` validates exact membership and atomically advances the send, stamps `placed_at`, and materializes the D16 quote without re-pricing. It is online-only. Per-row `update_grocery_list` (`op: "update", status: "ordered"`) remains compatible, but whole-send assertions prefer this batch tool.

Every shared mutation returns the full authoritative post-write snapshot. Send estimates are send-time quotes, never final fulfillment prices; pre-send flyer hints are not persisted totals. MCP writes immediately publish full `GroceryModelContext`; only successful mark-placed sends a completion message.

---

## Store tools (in-store fulfillment)

The member MCP surface carries the mid-walk, hands-busy **capture pair only** — `add_store` and `add_store_note`. Listing, identity reads, identity edits, and removal are member/admin web surfaces over the same shared store operations — there are no `list_stores`, `read_store`, `update_store`, or `remove_store` MCP tools, and no `update_store_note`/`remove_store_note`/`read_store_notes` tools (an author edits or removes their own store note, and anyone reads a store's notes, from the member app). Stores are shared corpus and unattributed — any member may capture one with no extra gate.

### `add_store(slug, name, label?, chain?, address?, domain?, location_id?)`

Register a new store location — **identity only**. `slug` is a kebab-case **location** id (`west-7th-tom-thumb`, not `tom-thumb`). `domain` defaults to `"grocery"`. `location_id` is an optional chain-specific external id — for Kroger stores set it to the resolved Kroger `locationId` so in-store walks can bypass the Locations API lookup. Layout is **not** set here — map a store by recording `layout`-tagged store notes (`add_store_note`) as you walk it. D1-backed.

**Returns:**
- `{ store }` — D1-backed, no `commit_sha`

**Errors (structured):**
- `{ error: "validation_failed" }` — invalid slug or empty name.
- `{ error: "slug_exists" }` — the slug is already registered; identity edits are a member/admin web surface.

### `add_store_note(slug, body, tags?, private?)`

Append an attributed note to a store — the single home for everything we know about it. Freeform observations ("fish counter closes at 6 PM", "they stock the Kerrygold I like") **and** layout, by tag convention: `layout` for an aisle + its sections (lead the body with the aisle number — `"Aisle 7: baking, spices"` — the number order is the walk path); `location` for where a non-obvious item hides; `stock` for a not-carried item. Append-mostly; D1-backed (`store_notes` table, attributed by `author` column).

**Params:**
- `slug` (string, required), `body` (string, required), `tags` (array, optional), `private` (boolean, optional — default `false`).

**Returns:**
- `{ slug, author, created_at }` — D1-backed, no `commit_sha`

**Errors (structured):**
- `{ error: "validation_failed" }` — malformed slug or empty body.

**Notes:** Reading a store's notes, and correcting or removing your own (e.g. a stale `layout` note after a remodel), are member web app surfaces over the same shared note operations — author-scoped, unchanged from before the cull. Where two notes conflict (e.g. an aisle after a remodel), a reader prefers the most recent by `created_at`.

---

## Kroger tools — config-gated

The following register **only when the deployment carries Kroger API credentials** (the registration model above) — a walk-only deployment advertises none of them. The gate is deployment-level (the credentials are Worker secrets), not per-tenant.

### `flyer(filter?)`

Synthesized sale scan for the caller's **primary fulfillment store** — Kroger or a satellite-scanned store — served from a background-warmed cache (never a live fetch; the public API has no flyer/circular endpoint, and a live per-call fan-out would exceed the Worker's per-request subrequest limit). Unifies the former `kroger_flyer` (Kroger-only) and `store_flyer` (store-generic) reads into one tool, one name — there is no separate Kroger-specific flyer read.

**Params:**
- `filter` (object, optional): `{ min_savings_pct? }`
  - `min_savings_pct` (number, default 5): minimum percentage markdown to keep. Applied at read over the warmed rollup — pass lower (e.g. 3) to widen, higher to tighten.

**Returns:**
- `{ items: [{ sku, brand, description, size, price: { regular, promo }, savings, categories, matched_terms }], as_of }`
  - `matched_terms` (array of strings): every broad term that surfaced this product during the sweep (empty for a satellite-scanned store, which doesn't report which term surfaced each product).
  - `as_of` (string | null): ISO 8601 timestamp of this store's last warm, or `null` when the store has not been swept/scanned yet — in which case `items` is empty, **not** an error.

**Notes:** Resolves the caller's primary fulfillment store from the profile (`stores.primary` + `stores.preferred_location`) and reads that store's `flyer:{store}:{locationId}` rollup (falling back to the legacy un-namespaced Kroger key while a deploy's first namespaced sweep is pending). Issues **no** flyer fan-out subrequest — the background sweep already performed it; a satellite store's `preferred_location` label IS its rollup `locationId` (no subrequest at all), while a Kroger primary may cost one Kroger Locations API resolve. Kroger and satellite-scanned sales are **indistinguishable** to the reader except by which store they came from. A **satellite-scanned** store's rollup older than the operator's staleness ceiling reads as **empty** (with `as_of` still surfaced) rather than steering on stale sales — a dead satellite degrades to empty, not to stale; Kroger keeps its cron-refresh freshness (no ceiling). A missing/unresolvable store, or a cold cache, degrades to `{ items: [], as_of: null }`, never an error. This tool takes no ad-hoc `terms`/`against_stockup` params — checking whether a specific stockup item or substitute candidate is on sale is handled in the place-groceries flow, not here.

### `kroger_prices(ingredients)`

Get current prices for a specific list of ingredients (used for menu pre-pass). Returns the **full list of fulfillable products per ingredient** (relevance-ranked, up to Kroger's per-request max of 50) — not just the top one — so the LLM can compare across brands/sizes and pick.

**Params:**
- `ingredients` (array of strings)
- `location_id` (string, optional) — override the store location for this call; defaults to `preferences.stores.preferred_location`. Use when querying a specific store that differs from the primary.

**Returns:**
- `{ prices: [{ ingredient, products: [{ sku, brand, description, size, price: { regular, promo }, on_sale, available: { curbside, delivery, inStore }, aisleLocation: { number, description, side? } | null, inStore: boolean }] }] }`

**Notes:** `products` is every fulfillable match for the term, ordered by Kroger relevance; an ingredient with nothing fulfillable returns `{ ingredient, products: [] }`. `price` is `{ regular, promo }`; `on_sale` is true only on a real discount (`promo > 0` **and** `promo < regular`) — a `promo` equal to `regular` is not a sale; `available` is the full fulfillment object `{ curbside, delivery, inStore }` at the preferred location (there is no separate `fulfillment` key) — the curbside/delivery flags are order fulfillability; the public API exposes no live in-store stock level. `inStore` (boolean, also surfaced top-level on each product, duplicating `available.inStore`) is true when the item is carried in-store at the queried location. `aisleLocation` is present when the API returns aisle data for this product at the location — `{ number, description, side? }` — and null otherwise; use it for Kroger in-store aisle ordering (the Kroger in-store walk in the `shop` skill).

### `kroger_login_url()`

Mint the one-time Kroger account-authorization link for the **current member** and return `{ url }`. Kroger ordering (`place_order`, any cart write) requires the member's own Kroger shopping account to be linked first; this returns a personal browser link the member opens to consent at Kroger (scope: add-to-cart only). Hand the returned URL to the member to click.

Takes **no parameters** — the link is bound to the calling member from their authenticated session, so it can never mint a link for anyone else. The link carries a **single-use nonce that expires in ~10 minutes**, so mint it on demand rather than caching it.

**When to call:** (1) the first time a member sets up ordering, and (2) whenever a cart write returns `cart.code: "reauth_required"` — the stored token was rejected and the member must re-authorize. (Operators bootstrapping a member who isn't connected yet use the admin panel's **Kroger link** action on the Members page instead.)

**Returns:**
- `{ url }` — e.g. `https://<connector-host>/oauth/init?nonce=<nonce>`

---

## Discovery tools

Unprompted discovery is **autonomous**: a background **discovery sweep** (a scheduled cron job — see ARCHITECTURE → *the discovery sweep*) polls the shared feeds + drains the email inbox, classifies and taste-matches each candidate, and **auto-imports** the fits into the shared corpus, attributed per member. The agent does **not** pull/triage/parse discoveries in-flow; it **reads the sweep's output** for the caller via `list_new_for_me` at plan time. The **manual** import path is `import_recipe` (Recipe tools, above), for a URL/paste the user hands the agent. Parked candidates, group-wide source suppression, and the shared feed/allowlist config are **operator admin surfaces** — there are no `read_discovery_errors`, `reject_discovery`, `update_feeds`, or `update_discovery_sources` MCP tools.

### `list_new_for_me()`

Return the recipes the **background discovery sweep imported for the caller** since their last meal plan — the discovery surface the `plan` flow reads. Each row is **already classified and embedded**, so it is immediately usable *and* retrievable via `search_recipes`. Scoped to the calling **member**: recipes the sweep **matched to the caller's taste** (a `discovery_matches` row whose `member` is the caller — attribution is per-member, while recipe visibility is per-household), discovered after their `last_planned_at` watermark, with **no overlay disposition** (not favorited/rejected) and **not yet cooked**. Read-only.

**Returns:**
- `{ recipes: [{ slug, title, description, protein, cuisine, time_total, discovered_at }] }` — most-recent-first, bounded. `description` is the AI-generated "why this dish."

**Notes:** The watermark is the **later** of the caller's `last_planned_at` (the D1 `profile` planning watermark, stamped by `update_meal_plan` on an `add`) and a fixed **~21-day floor**, so a never-planned member sees at most a recent window of discoveries, not the whole backlog. An **empty list is normal** (nothing new since they last planned). Only taste **matches** appear: curated-tier landings write no match rows, and a bare visibility grant (a recipe entering the lens without being matched to this member) is never surfaced here — the row set is lens-visible by construction (the household's own sweep imports carry its grant). Fold these into the menu *before* the rest of retrieval. This is the discovery surface the `plan` flow reads — the agent reads ready-made results; it does not fetch/score/import in-flow.

---

## Preference / config tools

### `read_user_profile()`

Read the caller's full per-tenant profile, assembled from the D1 profile tables in **one call** (a batched set of per-table reads), including initialization status and the server-computed `attention` nudge block. Returns all profile fields; absent fields are null/empty — never throws `not_found`.

**Params:** none.

**Returns:**
```
{
  initialized:     boolean,          // true once preferences field is non-empty
  missing:         string[],         // onboarding areas still absent: subset of
                                     //   ["store","taste","diet","equipment","stockup","vibes"]
  preferences:     { ... } | null,   // the assembled preferences object; each brands entry
                                     //   is the canonical tier object { tiers: string[][],
                                     //   any_brand: boolean } with BOTH fields always present
                                     //   (a don't-care family reads { tiers: [], any_brand:
                                     //   true }) — never a bare array.
                                     //   `cadence` is the per-meal planning-frequency map
                                     //   { breakfast, lunch, dinner } — the stored map, or
                                     //   (when unset) the read-time derivation { breakfast: 0,
                                     //   lunch: 0, dinner: default_cooking_nights ?? 5 }.
                                     //   `default_cooking_nights` remains exported for ONE
                                     //   deprecation window as a DERIVED MIRROR of the
                                     //   effective cadence.dinner — prefer `cadence`. The
                                     //   retired lunch_strategy / ready_to_eat_default_action
                                     //   never appear (meal vibes supersede them).
                                     //   `curated_hide` appears as `true` only when the
                                     //   household hides the curated recipe tier from its
                                     //   visibility lens; absent otherwise (shown is the
                                     //   default). Household-scoped; set via
                                     //   update_preferences.
  taste:           string | null,    // taste-profile narrative (markdown)
  diet_principles: string | null,    // diet-principles narrative (markdown)
  kitchen:         { owned: [...], notes: {...} },  // equipment inventory (empty when absent)
  staples:         [...],            // staples list — bare array (empty when absent)
  stockup:         { ... } | null,   // bulk-buy watchlist (parsed TOML)
  meal_vibes:      [...],            // the meal-vibe palette — each saved vibe with its `meal`,
                                     //   its `members` when set, and its derived last_satisfied +
                                     //   cadence status ("overdue"|"due"|"soon"|"ok"); empty array
                                     //   when absent (also joins `missing` under the unchanged
                                     //   "vibes" label). The revealed-preference rhythm read at
                                     //   session start — a prior for shaping a plan, not a cage.
  household: {                       // the caller's household roster (social-graph)
    members: [{
      handle:    string,             //   the member's @handle (the stable key for
                                     //   "away"/"only" attendance and chat references)
      nickname:  string | null,      //   the CALLING member's own alias for them — see
                                     //   the privacy guarantee below; null when unset
      you:       boolean,            //   marks the calling member's own row
      joined_at: number              //   epoch ms the member row was created
    }]
  },
  attention: {                       // server-computed nudge inputs (data-read-tools D8):
                                     //   deterministic, no AI call, no write beyond the
                                     //   retrospective surfaces' own watermark stamp
    retrospective_due:      boolean, //   true when the caller's cooking log is non-empty AND
                                     //   the retrospective hasn't been read in 42+ days
                                     //   (reading one via the retrospective tool resets it)
    unverified_perishables: number,  //   a COUNT (never a list) of pantry rows in produce/
                                     //   dairy/seafood/meat unverified for 7+ days
    stale_areas:            string[]//   the same array as `missing`, under the attention lens
  }
}
```

**Notes:** The single call for session start, the `plan` flow's pre-pass, and `setup`. On `initialized: false`, run the `setup` flow first; use `missing` to skip areas already done. D1-backed (assembled from the per-tenant profile tables) — a missing profile returns all fields null/empty. Kitchen `owned` is the array of `EQUIPMENT_VOCAB` slugs that **gate** recipe makeability; an **absent/empty** `owned` makes the gate a no-op (everything shows).

**Household + nickname privacy (guaranteed):** `household.members` lists every member of the caller's household, and `nickname` carries ONLY the calling member's own per-viewer alias (set on the member app's People page; `null` when unset). The tool **never** returns a nickname set *by* anyone else or *for* the caller — aliases are private to the viewer who set them, and no member surface or export discloses an alias to its subject or to a third member. Handles are the stable keys: resolve chat references ("Mom and Grandma are coming to town") through this block, and pass `handle` values to attendance (`away`/`only`).

**`attention` is a nudge input, not a narration mandate.** It rides the same batched read as the rest of the profile — no new subrequest budget — and is deterministic Worker math over tables already read (cooking log existence, a bounded pantry aggregate, the `profile.last_retrospective_at` watermark), plus the existing `missing` derivation. `retrospective_due` resets the next time the `retrospective` tool runs (it stamps today's date on every successful read — the `last_planned_at` precedent). `unverified_perishables` is always a count, never a list — surface the number, not a synthesized item list. `stale_areas` is `missing` again, under the attention framing; it does not add new onboarding logic. A brand-new tenant (no pantry, no cooking log, no watermark) reads `{ retrospective_due: false, unverified_perishables: 0, stale_areas: [...] }` — nothing errors. The persona's one-light-nudge-per-session discipline for *using* this block is a later change; this tool only supplies the data.

### `update_preferences(patch)` / `update_taste(content, mode?)` / `update_diet_principles(content)`

Write user-curated config. `update_taste`/`update_diet_principles` write to the D1 `profile` row, no `commit_sha`. **`update_preferences` is a deep merge-patch**, not a whole-object write. **These should only be called when the user explicitly directs an edit** — except `update_taste(content, mode: "append")`, which is safe for a silent ambient capture (below). Ingredient alias and display-name curation (the shared human-precedence write into the identity graph) is an **operator admin surface** — there is no member `update_aliases` tool; reserve a manual correction for the admin **Normalization** area.

**Params:**
- `update_preferences`: `patch` (object, required) — a **JSON Merge Patch (RFC 7396)** over the caller's preferences. Present values set, nested objects merge recursively, arrays replace wholesale, and `null` deletes. The defined keys are `cadence`, `planning_cadence_days`, `weekly_budget`, `stores`, `brands`, `dietary`, `rotation`, `curated_hide`, and `custom`; an unknown top-level key is rejected with `validation_failed` and a hint to place open-ended data under `custom`. `curated_hide` is a boolean: `true` suppresses the **curated recipe tier** (the product-maintained starter set, SaaS profile) from the household's visibility lens — household-scoped (it applies to every member) and reversible (`false`/`null` restores the tier; nothing is deleted); it never affects the anonymous public site, and it is inert under the self-hosted profile (no curated tier grants visibility there). `stores` supports `{primary, preferred_location, location_zip, nicknames:{[store_slug]: string|null}}`; nicknames are household-private presentation and never write the shared `stores` row. A family in `brands` is `{tiers:string[][], any_brand:boolean}`; family `null` deletes it, and partial nested patches preserve omitted fields. The merged result is validated before a single atomic D1 apply; malformed enums/shapes return `malformed_data` and store nothing. During the compatibility window, flat brand arrays, `default_cooking_nights`, and retired meal-strategy keys follow the conversion/drop warning contract in the deprecation table above.
- `update_taste`: `content` (string, required) — the taste narrative text. `mode` (`"replace" | "append"`, optional, default `"replace"`): `"replace"` overwrites the narrative verbatim with `content` — call only when the user has directed an edit. `"append"` adds `content` to the **end** of the existing narrative with a blank-line separator, preserving everything already there — use this for a silent ambient capture, never a directed rewrite, so it can never clobber the member's curated text (an absent/empty narrative stores `content` as-is either way).
- `update_diet_principles`: `content` (string, required) — the complete new field text, written verbatim (replace-only — dietary gates are edited deliberately, never appended ambiently).

**Returns:**
- `update_preferences`: `{ updated: "preferences" }`, plus `warnings` (`[{ key, reason, superseded_by }]`, the deprecation convention above) when part of the patch arrived in a deprecated form and was converted or dropped — D1-backed, no `commit_sha`
- `update_taste` / `update_diet_principles`: `{ updated: "<field>" }` — D1-backed, no `commit_sha`

---

## Guidance tools

One fused read over the shared, curated `guidance/` trees, organized by **domain** subdirectory — **read-only from the agent surface**, because no agent guidance write path exists at all:

- **`ingredient_storage`** — opinionated put-away advice keyed by storage **class** (`tender-herbs`, `alliums`, …), with a few singletons (`basil`, `tomatoes`, `avocados`) and a relational `_ethylene` file.
- **`cooking_techniques`** — general cooking-technique memories keyed by **technique** (`browning-meat`, `searing`, `resting-meat`, …).
- **`purchasing`** — buy-side selection advice keyed by **product/item** (`canned-tomatoes`, `olive-oil`, …): *what kind to get* plus the non-obvious *how to tell if it's good/ripe* judgments.

All three domains are **operator-curated** — hand-edits to the guidance tree in the R2 corpus (via any S3-compatible client); the admin panel's Data › Guidance area is a read-only viewer. There is no `save_guidance` tool: a member who posts an article or a buying guide gets conversational use of it, not a corpus write; an operator who wants it distilled into the corpus edits it directly (one file per slug — refining overwrites, never appends).

The agent maps a just-bought item, a recipe step, or a thing on the grocery list to the right slug with its own world knowledge over the semantic slugs (no manifest); over-fetching is harmless. See `docs/SCHEMAS.md` for the trees and the AGENT_INSTRUCTIONS put-away/cook/shop/capture rules for when these fire.

### `read_guidance(domain?, slugs?)`

Read or list curated guidance from the shared `guidance/` trees — one tool covers both the listing and the content read.

**Params:**
- `domain` (string, optional) — `"ingredient_storage"`, `"cooking_techniques"`, or `"purchasing"`.
- `slugs` (array of strings, optional) — the slugs to read. **Present** (domain required): returns their content. **Absent**: lists available slugs instead — pass `domain` for one corpus, or omit it to list every domain grouped.

**Returns:**
- With `slugs` present: `{ domain, entries: [{ slug, content }] }` — `content` is the file's full markdown (frontmatter + prose). An unknown (or malformed) slug yields a structured `{ error: "not_found", slug }`; an unknown domain yields `{ error: "validation_failed", domain }`.
- With `slugs` absent, and a `domain`: `{ domain, entries: [{ slug, description? }] }` — one entry per `guidance/<domain>/*.md` file; `slug` is the filename without `.md` (e.g. `tender-herbs`, `_ethylene`, `browning-meat`); `description` is the optional one-line summary from the file's `description` frontmatter.
- With both absent: `{ domains: [{ domain, entries }] }` — every domain grouped.
- An absent tree yields an empty listing (not an error) in either mode.

**Notes:** Contested/folklore tips are pre-hedged in the prose — relay them with their hedge, never as settled fact. No matching entry for a bought item / cook step → offer no tip (silence over invention). `list_guidance(domain?)` remains registered for one deprecation window as a dispatch alias onto this tool's listing mode (identical requests and responses, no `warnings` injection — the deprecation convention above).

---

## Retrospective / analysis tools

### `retrospective(period, spend_range?, waste_range?, waste_mapping_version?)`

Aggregate **real** cooking history from the D1 `cooking_log` table over a period, joining `type=recipe` rows to the `recipes` table for protein/cuisine (a `cooking_log LEFT JOIN recipes` + COALESCE), and return the household's independent read-only Spend and Waste analyzers. Every successful call stamps `profile.last_retrospective_at` (today) — the `attention.retrospective_due` watermark on `read_user_profile` (data-read-tools D8).

**Params:**
- `period` (string, optional, default `"month"`): `"Nd"` (e.g. `"30d"`) | `"week"` | `"month"` | `"quarter"` | `"year"` | `"all"`.
- `spend_range` (string, optional, default `"4w"`): `"4w" | "8w" | "12w"`. It scopes only `spend`; `period` independently scopes cooking history.
- `waste_range` (string, optional, default `"4w"`): `"4w" | "8w" | "12w"`. It scopes only `waste`; cooking `period` and `spend_range` remain independent.
- `waste_mapping_version` (string, optional, default current): selects a supported immutable Waste avoidability mapping. The current and only supported name is `"waste-avoidability-v1"`; an unsupported name returns `validation_failed` with `unsupported waste avoidability mapping version; supported versions: waste-avoidability-v1` rather than silently falling back.

**Returns:**
```
{
  period, window: { from, to, days },                  // period scopes the next five fields only
  recipes_cooked:   [{ recipe, count, dates }],   // distinct recipes, with per-cook dates
  protein_mix:      { <protein>: count },          // counts EVERY cook event; non-recipe entries via inline dims; missing → "unknown"
  cuisine_mix:      { <cuisine>: count },
  cadence:          { cooks, weeks, cooks_per_week,     // counts recipe + ad_hoc only — a historical `ready_to_eat`
                                                         //   row (the type is retired) stays excluded, as before
                      by_meal: { breakfast, lunch, dinner, project },  // cooks per meal, over rows whose meal is set
                      meal_unknown },                    // in-window cooks whose meal is NULL (pre-meal rows) — counted
                                                         //   in the overall figure, reported unknown, never fabricated
  underused:        [{ slug, title, last_cooked, why, cook_count }],  // loved & quiet & in-season; ≤15, stalest first
  underused_count:  <number>,                           // total qualifying before the 15-item cap
  spend: {                                              // shared SpendAnalyzer; independent of period
    range: "4w" | "8w" | "12w",
    as_of, selected_start, selected_end, prior_start, prior_end,  // inclusive YYYY-MM-DD UTC bounds
    status: "empty" | "unavailable" | "partial" | "complete",
    coverage: {
      monetary: { status, event_count, priced_event_count, unpriced_event_count,
                  estimated_event_count, known_amount },
      department: { status, event_count, classified_event_count, pending_event_count },
      savings: { status, event_count, known_event_count, unknown_event_count, known_savings }
    },
    weekly_budget: <number> | null,                     // positive dollars/week, else null
    weeks: [{                                           // exactly N ISO-Monday buckets, oldest first
      week_start, week_end, through, is_partial,
      total, savings, events, estimated, status,
      monetary_coverage, department_coverage, savings_coverage,
      over_budget: true | false | null
    }],
    awaiting_mark_placed: <number>,                     // current sent in_cart rows; never spend
    kpis: {
      total_spend: { amount: <number> | null, status },
      average_per_week: { amount: <number> | null, status },
      cost_per_meal: { amount: <number> | null, known_numerator, meal_count, status,
                       reason: null | "zero_meals" | "numerator_unavailable" },
      trend: { percent: <number> | null, current_known_amount, prior_known_amount,
               status: "available" | "unavailable",
               reason: null | "current_incomplete" | "prior_incomplete" | "prior_zero" }
    },
    breakdowns: {
      department: { known_denominator, status, items: [{ key, label, amount, event_count,
                    priced_event_count, unpriced_event_count, percentage }] },
      store:      { known_denominator, status, items: [/* same item shape */] },
      provenance: { known_denominator, status, items: [/* same item shape */] }
    },
    top_drivers: { cap: 6, total_count, items: [{ key, name,
      department: { key, label } | null, amount, event_count, priced_event_count,
      unpriced_event_count, percentage }] },
    insight: <string>                                   // deterministic server template
  },
  waste: {                                              // shared WasteAnalyzer; independent of period/spend
    range: "4w" | "8w" | "12w",
    as_of, selected_start, selected_end, prior_start, prior_end,  // inclusive YYYY-MM-DD UTC bounds
    status: "empty" | "unavailable" | "partial" | "complete", // selected monetary status
    avoidability_mapping: { version, current_version, is_current },
    coverage: {
      monetary: { status, event_count, priced_event_count, unpriced_event_count,
                  estimated_event_count, known_amount },
      department: { status, event_count, classified_event_count, pending_event_count }
    },
    weeks: [{                                           // exactly N ISO-Monday buckets, oldest first
      week_start, week_end, through, is_partial, events,
      amount: <number> | null, status, monetary_coverage, department_coverage
    }],
    kpis: {
      tossed_value: { amount: <number> | null, status },
      items_binned: { count, per_week },
      waste_rate: {
        percent: <number> | null, known_waste_amount, qualifying_spend_amount,
        status: "available" | "unavailable",
        reason: null | "waste_incomplete" | "spend_incomplete" | "zero_denominator",
        spend_coverage: { status, spend_event_count, qualifying_event_count,
          excluded_household_event_count, pending_department_event_count,
          priced_event_count, unpriced_event_count, estimated_event_count, known_amount }
      },
      trend: { percent: <number> | null, current_known_amount, prior_known_amount,
               status: "available" | "unavailable",
               reason: null | "current_incomplete" | "prior_incomplete" | "prior_zero" }
    },
    breakdowns: {
      department: { count_denominator, known_amount_denominator,
                    classification_coverage, monetary_coverage, items },
      reason:      { /* same container */ },
      avoidability:{ /* same container */ }
      // each item: { key, label, event_count, valued_event_count,
      //   unvalued_event_count, estimated_event_count, amount,
      //   count_percentage, amount_percentage }
    },
    most_wasted: { cap: 6, total_count, items: [{ key, name,
      department: { key, label } | null, event_count, valued_event_count,
      unvalued_event_count, estimated_event_count, amount, amount_percentage,
      status: "unavailable" | "partial" | "complete" }] },
    insight: <string>                                   // exact deterministic server template
  }
}
```

**Notes:** `last_cooked` is derived (see `log_cooked`) — `MAX(date)` over the caller's `type=recipe` rows. **`underused` is independent of `period`**: it surfaces **loved** recipes — `favorite === true` (declared) **or** cooked **≥3× in the trailing 12 months** (revealed) — that are **stale** (`last_cooked` null, or older than a **fixed 30 days**) and **in season** now (the recipe's `season` is `[]`/year-round or includes the current Northern-hemisphere season; matched case-insensitively with `autumn`≡`fall`). Rejected recipes are excluded. `why` is `"favorite"` or `"revealed"`; `cook_count` is the all-time cook count (for the revival nudge). The list is sorted never-cooked-first then oldest `last_cooked` and capped at 15 — `underused_count` reports how many qualified. Eating out is never logged; leftovers of an already-logged cook are not re-logged.

**`spend` is read-only, household-scoped, bounded, and independent of `period`.** `spend_range` maps to N=4/8/12 UTC ISO-Monday buckets including the current partial week. Spend facts are bounded from the matched prior range's start through `as_of`; selected cooking rows are bounded from `selected_start` through `as_of`; future facts are excluded. The prior range has the same elapsed weekday shape shifted back N weeks. Profile budget and the current awaiting count are tenant-scoped current-state reads. Every source uses the authenticated identity's tenant; no input can select a tenant.

All currency reduction rounds each stored decimal once to integer cents. Monetary coverage is empty with no events, unavailable with no priced events, partial with any unpriced or estimated event, and complete otherwise. Department and savings coverage apply the analogous captured-value rules; a pending department remains absent from breakdown items and never becomes a synthetic “Not mapped” group. Overall status is empty with no events, unavailable when money is unavailable, partial when money is partial or department coverage is incomplete, and complete otherwise. Numeric legacy totals are known subtotals and must be presented with their coverage.

`average_per_week` divides known spend by all N buckets without partial-week proration. Cost per meal divides the known eligible numerator by every in-range `recipe` or `ad_hoc` cooking row (all meal values, including `project` and legacy null); it excludes a historical `ready_to_eat` row (the retired type — `log_cooked` no longer writes it), never infers servings, and excludes only capture-stamped `household` and `beverages` from its numerator. Total spend still includes those departments. Trend compares the selected interval with its matched prior interval and is unavailable for incomplete inputs or a zero prior denominator. A positive weekly budget yields `over_budget:true` as soon as known spend exceeds it, `null` while missing value could change an otherwise-below result, and `false` only for complete known value; an absent/non-positive budget normalizes to null.

Department, store, and provenance breakdowns use immutable captured keys only. Items sort by known amount descending then raw key ascending; department percentages use classified known spend, while store/provenance use total known spend. Top drivers group by captured `line_key`, include priced groups only, count event rows rather than quantity, select name and department together from the latest `(occurred_on, send_id)` row, sort by amount descending then event count descending then key ascending, and cap at six after reporting `total_count`. Insight selection is the fixed server template ladder; no LLM, random choice, or client reclassification participates. Reads filter voided events and perform no mutation, cache fill, queue action, schema migration, scheduled aggregation, or analyzer cron. No MCP tool writes spend events.

**`waste` is read-only, household-scoped, bounded, and independent of both cooking and Spend.** `waste_range` maps to N=4/8/12 UTC ISO-Monday buckets, including the current partial week, and the matched prior interval has the same elapsed shape. The largest request reads Waste only from `prior_start` through `as_of` (at most 24 weeks), performs tenant/item/date-bounded last-paid seeks, and reads qualifying Spend only from `selected_start` through `as_of`; future facts are excluded. Authentication supplies the tenant before analysis, every read is tenant-predicated, and no MCP or HTTP input can select a household.

Waste value is one last-paid **estimate** per persisted toss: the latest same-tenant, non-voided, priced `spend_events.unit_price` for the same canonical item on or before the toss, with date then send-id tie-breaking. Missing history stays unavailable; estimated matches stay known but partial; zero is known. Waste quantity, Spend package quantity/amount, member input, pantry, catalog, flyer, recipe allocation, store quote, cross-tenant history, and heuristics never fill or multiply a value. `prepared_from` makes the effective read-time department `leftovers`; otherwise the capture-stamped department is used, and NULL remains pending. Avoidability is the selected immutable reason-only five/five mapping, echoed by `avoidability_mapping` and never written to an event.

Waste monetary status is `empty` with no events, `unavailable` with events but no matched price, `partial` with any unmatched or estimated event, and `complete` when every event has a non-estimated match. Empty exposes zero, unavailable exposes NULL value, and partial/complete expose the known subtotal. Department coverage is separate: pending classification never changes top-level or Tossed monetary status. Counts are exact persisted event counts; `items_binned.per_week` divides by all N calendar buckets. Trend is available only for exact current/prior money and positive prior value; otherwise the returned reason follows `current_incomplete`, `prior_incomplete`, then `prior_zero` precedence. The contract intentionally returns no prior coverage counts.

Waste rate is known Tossed last-paid value divided by qualifying recorded grocery Spend plus that Waste value. Qualifying Spend sums selected non-voided captured `amount` rows except `household`; `beverages` remains included. Pending, unpriced, or estimated qualifying input makes its coverage incomplete. Rate reasons follow `waste_incomplete`, `spend_incomplete`, then `zero_denominator`. Waste-derived dollars are last-paid estimates; `qualifying_spend_amount` is recorded/captured grocery Spend, never a per-toss estimate.

Department breakdown count and known-money denominators cover only effectively classified events; pending events remain in classification coverage and never become `Not mapped`. Reason and avoidability denominators cover all selected events and all selected known Waste value. Every sparse group remains visible, including an unvalued group with NULL amount. Breakdown items sort by known amount descending, event count descending, then canonical key ascending. Most-wasted items group canonical item id, count every row, keep valued groups before unvalued-only groups, apply the documented amount/count/key tie-breakers, choose the latest `(occurred_at, id)` representative, report the pre-cap `total_count`, and cap at six. Weeks remain chronological. The returned `insight` is the exact server-authored string; consumers relay it and the returned ordering without recomputation or invented advice.

The MCP and profile retrospective results carry the same direct `WasteAnalyzer` object. MCP accepts only the distinct `waste_range` / `waste_mapping_version` names and defaults to `4w` / current. Profile retrospective exposes no Waste selector and also uses `4w` / current. **Member API adapters:** authenticated `GET /api/retrospective/spend?range=4w|8w|12w` returns the shared Spend body; authenticated `GET /api/retrospective/waste?range=4w|8w|12w&mapping_version=<name>` returns the shared Waste body. Both use the normal private/no-cache ETag/304 helper and default a missing HTTP range to `8w`; invalid range returns HTTP 400 `{ "error": "validation_failed", "message": "range must be 4w | 8w | 12w" }`. HTTP uses exactly `mapping_version`, not the MCP-only `waste_mapping_version`; omission selects current, and an unsupported name returns the exact mapping error above. Both GETs resolve tenant only from the session and are deterministic and side-effect-free. These analyzer surfaces add no standalone/direct event, derived-value, avoidability, aggregate, edit, delete, or correction writer, and reads perform no capture, classification fill, cache persistence, model call, queue action, migration, scheduled aggregation, or analyzer cron. The separate existing `update_pantry` operation may capture a qualitative Waste event with `disposition: "waste"`; this change does not alter that contract, and it accepts no dollar value.

### `log_cooked(entry)`

Append one cooking event to the caller's `cooking_log` (D1-backed; **no `commit_sha`**).

**Params:**
- `type` (string, required): `recipe | ad_hoc`. For **one deprecation window**, `type: "ready_to_eat"` is also accepted and **converted to `ad_hoc`** (see Notes and the deprecation convention above); after the window it is rejected as `validation_failed` like any other unknown type.
- `date` (string, optional): ISO `YYYY-MM-DD`; defaults to today.
- `meal` (string, optional): `breakfast | lunch | dinner | project` — which meal this event was. Valid on **all** types; **omitted stores NULL**, meaning "unknown / not a meal" (`type` and `meal` are orthogonal axes: a baked loaf logs `{ type: "ad_hoc" }` with no meal — there is no fourth "other" value). Cooking a **planned project** logs `{ type: "recipe", meal: "project" }`, which routes the clear at the project row.
- `plan_row_id` (string, optional): the exact plan row to clear (a `read_meal_plan`/`update_meal_plan` row id) — clear-order step 1 below.
- `recipe` (string): the recipe slug — **required** for `type=recipe`; it MUST resolve against the D1 `recipes` table.
- `name` (string): the dish name — **required** for `ad_hoc`.
- `protein`, `cuisine` (string, optional): inline dimensions for a non-recipe entry (so it still counts in `retrospective` mixes). Recipe entries take their dims from the recipe, not here.

**Returns:**
- `{ logged: { date, type, recipe?, name?, protein?, cuisine?, meal? }, cleared_plan_row?, note?, warnings? }` — no `commit_sha`. On a `recipe` entry `cleared_plan_row` is the one plan row the cook cleared (`{ id, recipe, meal, planned_for }`) or `null` when nothing cleared; `note` explains a stale `plan_row_id`; `warnings` is present only when a deprecated input shape was accepted and converted (the `ready_to_eat` shim below).

**Notes:** Validated at write time — a bad date/type/meal or a missing required field is `validation_failed`; an unknown recipe slug is `not_found`, written nowhere. **Deterministic clear (at most ONE row, in the same D1 transaction as the log insert):** a `type=recipe` entry resolves which plan row it clears by this order — (1) a supplied **`plan_row_id`**: the row exists and slug-matches → clear exactly it; the row exists but holds a **different recipe** → a structured `conflict` and **no log written** (never clear a different dish's slot); the row is **absent** → **no clear, the log is still written**, and the result carries `cleared_plan_row: null` plus a note — deliberately **no fall-through** to the slug stages (on a replay the row was already cleared and the intent satisfied; falling through would consume an unrelated explicit duplicate); (2) else the exact **`(recipe, meal, date)`** triple, when the entry carries a meal (ties among explicit duplicates break by the earliest-due selector — `planned_for ASC NULLS LAST, id ASC`); (3) else the **earliest-due row for the slug**, **excluding `meal='project'` rows unless the entry's meal IS `'project'`** — cooking a dinner never silently consumes a same-slug project row; (4) no match → no clear (an off-plan cook). An explicitly-duplicated recipe therefore **survives its first cook** — one cook clears one row, which is the point of duplication. Route-level replay dedupe (the member API) keys on **`(date, meal, type, recipe|name)`**, a NULL meal matching NULL only — this is cooking_log **dedupe identity only, never plan-row identity**. `last_cooked` is **derived** — no tool sets it directly; logging a recipe here updates its effective `last_cooked` automatically (it's derived by query). For one deprecation window, a stale plugin's `type: "ready_to_eat"` write is **accepted and converted** to `type: "ad_hoc"` — `name`/`date`/`meal`/inline `protein`/`cuisine` carry over unchanged, and the dedupe identity + plan-clear logic above run on the converted form (an `ad_hoc` row never clears a plan row, same as `ready_to_eat` never did) — the success return carries the `warnings` entry from the Active-shims table. The ready-to-eat concept itself is retired (`remove-ready-to-eat`): the retained D1 `ready_to_eat` table holds only historical rows no tool reads or writes, and every read (this log, `retrospective`, group insights) treats a stored `ready_to_eat` row exactly as before its retirement.

**Meal-vibe cadence (automatic, meal-scoped):** a `type=recipe` cook also attributes **meal-vibe satisfaction** by a **cook-time cosine match** of the cooked recipe against the caller's palette — the recipe's cron-captured embedding vs. each vibe's, using the already-derived vectors (`recipe_derived` / `night_vibe_derived`), so it costs **no** AI call. The cosine candidates are **scoped to the entry's meal** when one is set (a lunch cook matches lunch vibes only); a NULL-meal entry matches against **all** vibes (fail-open — the pre-meal behavior). It writes a satisfaction record (`vibe_satisfaction` table) for **every** in-scope vibe the recipe genuinely matches, unioned with **the cleared row's** `from_vibe` (read from the row the clear order actually selected, never a slug-global pick) as a **guaranteed-reset prior** — the prior always resets regardless of meal, even at a borderline cosine. A single cook MAY reset **more than one** vibe, and an **off-plan** cook (no plan row) still resets any in-scope vibe its recipe matches. Over-reset is bounded: the single strongest match resets, weaker matches only when they clear a higher threshold, so one dish cannot suppress the whole palette. This is fully automatic — you never pass a vibe to `log_cooked`; each vibe's `last_satisfied` is derived as `MAX(date)` over these records (never stored on the vibe).

### `read_meal_plan()`

Return the current meal plan — the slots committed to cook next (transient cook intent, D1-backed, **slot grain**). Use at session start to resume.

**Params:** none.

**Returns:**
- `{ planned: [{ id, recipe, meal, planned_for, sides?, from_vibe? }] }` — a **flat ordered array** ("grouped by meal" is an **ordering guarantee**, not nesting): dated rows first by `(planned_for, meal order breakfast < lunch < dinner)`, then undated rows grouped by meal, then `meal='project'` rows last, ties broken by `id ASC` (an **arbitrary-but-deterministic** tiebreak — id formats mix, so no consumer ever reads meaning into an id or its order). `planned_for` may be null; `sides` is an optional array of free-text open-world side names riding on the main's row.

**Notes:** The returned `id` is **THE address** for row-level edits (`update_meal_plan` `set`/`remove` by id, `log_cooked`'s `plan_row_id`) and the class (b) offline-replay key. A recipe may legitimately occupy several rows (explicit duplication). Project rows flow into the to-buy derivation like any planned row (no `read_to_buy` contract change). The session-start stale-planned reconcile surfaces only **due** rows (`planned_for` on/before today, or unset). D1-backed (`meal_plan` table); a missing/empty table reads as empty.

### `update_meal_plan(ops)`

Add, remove, or edit planned rows — **slot grain**, keyed by opaque row **`id`** (client-mintable ULID; the class (b) replay key), each row carrying a **`meal`** (`breakfast | lunch | dinner | project`, default `dinner`). D1-backed — no commit, no `commit_sha`. A recipe may occupy multiple rows, but ONLY by explicit user action — the **planner-no-duplicates invariant** (D26-final): this op layer's slug-global coalesce is the commit half; the propose engine's cross-meal dedupe is the other.

**Params:**
- `ops` (array): `[{ op: "add" | "remove" | "set", id?, recipe?, meal?, duplicate?, planned_for?, sides?, from_vibe? }]`
  - **`add`** (requires `recipe`) resolves deterministically:
    1. a supplied **`id` that exists** (tenant-scoped) → **replay/update** that row: `planned_for` set when supplied, `sides` unioned, `meal`/`from_vibe` set when supplied. An id holding a **different recipe** (case-insensitive slug mismatch) is a per-op conflict. Redelivering a queued offline add is a no-op-shaped update — the class (b) idempotency property, in every branch.
    2. else **`duplicate: true`** → **insert** a second row (supplied id or a server-minted ULID) — the **ONE** wire spelling of explicit duplication; a replayed explicit duplication finds its id and updates (step 1), never a third row.
    3. else **slug-global coalesce** (case-insensitive, **across ALL meals** — no cross-meal duplication hole): **0** matching rows → insert (`meal` defaults `dinner`); **exactly 1** → update it — a supplied `meal` **MOVES the row between meals**, sides union, `planned_for`/`from_vibe` set when supplied — reported with the **surviving row's id** and `coalesced: true` (the caller's supplied id is discarded; **adopt the survivor's**); **>1** (explicit duplicates exist) → a per-op **conflict carrying `candidates`** (`[{ id, meal, planned_for, sides? }]`) — never an earliest-due auto-pick; re-issue by `id` or with `duplicate: true`.
  - **`remove`** takes **exactly one** of `id` / `recipe`: by **id** it is **idempotent** — applied with `removed: 0|1`, a missing id is never a conflict (the offline-replay surface must replay silently); by **recipe slug** (optionally narrowed by `meal`) it deletes **ALL** matching rows — applied with `removed: N` plus the removed ids (the conversational surface, where "nothing matched" is signal: zero matches stays a conflict).
  - **`set`** addresses by **id** (must exist, else conflict; may change **any** field including `recipe` — the swap-in-slot — and `meal`) or by **slug** (optionally narrowed by `meal`; requires a **unique** match — zero → conflict, **>1 → conflict with `candidates`**; a slug-addressed set cannot change `recipe`). Field semantics: a supplied `sides` array replaces the row's sides **wholesale** — an empty array removes them all, the only way to remove a side; a supplied `planned_for` string sets the date and an **explicit `planned_for: null` clears it** (unschedules); `from_vibe` is preserved unless supplied (supplied `null` clears it).
  - **Project rows** (`meal: "project"` — bakes, preserves, big-batch projects) carry **no date and no sides**: any op that would produce a dated or sided project row (insert, move-to-project, or edit) is refused with the per-op conflict `"project rows carry no date or sides"` — **op-layer enforcement**, a structured conflict, never a raw SQL failure. A `set` moving a row to project may itself supply `planned_for: null` + `sides: []` to satisfy the constraint in one op.

**Returns:**
- `{ applied: [...], conflicts: [...] }` — D1-backed, no `commit_sha`; each applied entry carries `{ op, id, recipe?, meal?, coalesced?, removed?, removed_ids? }` (the `id` is the row acted on — the SURVIVOR's on a coalescing add); conflicts include the reason and, on a >1-match add/set, the `candidates`.

**Notes:** Called after the user confirms a menu (add rows — thread each slot's `meal` and `from_vibe`, and adopt the returned row ids), during the stale-planned reconcile (remove rows), and for row edits — side removal, rescheduling/unscheduling, swapping a recipe in its slot (id-addressed set). Cooking is logged with `log_cooked`, which clears its own row — call `remove` only to drop an **abandoned** plan. A **corpus** side (a `course: side` recipe) gets its own `add` row; open-world sides ride on the main's `sides` field. An **`add`** op that applies also stamps the caller's `profile.last_planned_at` planning watermark (today) — the bound `list_new_for_me` reads, so the next plan surfaces only discoveries imported since this one; `set`/`remove` never move the watermark.

---

## Order placement — config-gated (Kroger)

`display_order_review` and `place_order` register only when the deployment carries Kroger API credentials (the registration model above).

### `display_order_review()` and app-plane review operations

`display_order_review()` returns `_meta.ui.resourceUri = "ui://order/review"`, versioned
`OrderReviewData`, and equivalent plain text. The payload is first-paint-only: both member and MCP
hosts perform an empty-stage `read_order_review` before enabling controls. The disposable
`OrderReviewStage` carries skips, assumed quantities, selected SKUs with explicit selection source,
bare impulse entries, and verified-brand markers; it never carries a trusted price or credential.

`read_order_review(stage?)`, `search_order_broader(line_key, preview_fingerprint)`,
`search_order_catalog(line_key, preview_fingerprint, query)`, and
`save_order_brand_preference(family_key, line_key, brand, expected_family_fingerprint,
preview_fingerprint)` are **app-plane operations** (`_meta.ui.visibility: ["app"]`, the registration
model above) — never model-advertised, callable only by the order-review widget. Preview and search
are write-free. Broader search uses at most three distinct direct factual-ancestor/base/search-term
rungs and returns at most twelve fulfillable products with factual divergence. Manual search accepts
2–80 characters, performs one current-location query, and returns at most twenty fulfillable products
with modality facts. Brand save is the sole pre-send write: it joins a current same-identity brand to
tier 1, removes its case-insensitive duplicates below, sets `any_brand:false`, and uses the family
fingerprint for an atomic stale conflict without touching another family.

### `place_order(payload)`

The member/widget review send form is `{ stage, preview_fingerprint, cleared_cart_ack }`. Immediately
before any write, the operation rebuilds current list/plan/pantry/store/brand/availability/quote facts,
compares the opaque fingerprint, and runs a final guard over the exact resolution pass. Drift returns
`review_changed` with a refreshed preview and categorized divergence; an uncleared stale cart returns
`cart_clearance_required`. Both are zero-write. The agent compatibility form (`menu_needs`,
`quantities`, `include_partials`, `overrides`, `exclude`, `preview`) remains accepted during its
documented compatibility window.

On commit, send snapshot plus list advance precede the additive Kroger cart call. Cart failure is
compensated and never calls the SKU-cache writer. Only `cart.written:true` compares/upserts learned
mappings, returning exact `inserted`, `updated`, and `unchanged` canonical keys; cache failure never
rolls back groceries. A successful review result independently reports list/rollback, cart, send id
and persisted D16 item/total/savings truth, cache changes, freshly verified tier-1 brands, and every
left-off line. Prices remain quotes and the result never claims checkout.

The order-time flush — the **only** tool that writes a Kroger cart. Resolves the whole to-buy set against *current* Kroger availability, writes the cart (`PUT /v1/cart/add`), and caches learned ingredient→SKU mappings to the shared SKU cache. Backed by the Kroger `authorization_code` + PKCE user-context client and the KV-backed rotating refresh token.

**To-buy set (order-time dedup):** `grocery_list ∪ menu needs − pantry_has`, joined on canonical ingredient ids — where **menu needs are the union of the meal plan's server-derived ingredient needs and any caller-supplied `menu_needs`**. The tool derives each planned recipe's needs itself from its derived `ingredients_full` (the same derivation [`read_to_buy`](#read_to_buyenrich) and the satellite pull-list use), so a caller never hand-expands the plan; `menu_needs` is for **supplements** only (open-world side ingredients not yet captured, spontaneous extras). **A caller passing plan-derived (or already-listed) duplicates in `menu_needs` is safe**: the canonical-id union merges them into one line — a not-yet-republished plugin bundle whose persona still passes the bulk expansion cannot cause a double-buy. Planned recipes whose ingredient list is not yet derived return in `underived` (their items are NOT in the set — compensate explicitly rather than silently under-buying). A derived need whose row is already in flight (`in_cart`/`ordered`) is suppressed — a repeat order never re-buys the lines the last order carted. Only `active` list items participate. A name present in the pantry is **not** silently dropped — it returns in `partials` for you to prompt on, and is bought only if the user confirms it via `include_partials` (the no-auto-decide rule). A caller-supplied **`exclude`** list drops named lines (resolved through the same canonical-id funnel) from the to-buy set **before resolution** — an order-scoped opt-out for a line with no row to remove (a derived one); it is never persisted, so the line returns on the next read/order. Default buy quantity is **1 package** per item unless overridden.

**Quantity (package count):** supply it per item via `menu_needs[].quantity`, or via the `quantities` map; the `quantities` map **overrides** `menu_needs[].quantity` when both are present (precedence: `quantities` → `menu_needs[].quantity` → default 1). A line that fell back to the default carries `assumed_quantity: true`. The tool reports that fact but does **not** classify "by-the-each produce" or do portion math — at `preview`, *you* reconcile any `assumed_quantity` by-the-each produce (peppers, tomatillos, …) against the recipe's required amount and set an explicit quantity before the real flush. (`grocery_list` items' string `quantity` like "2 lbs" is a human need-annotation, not a package count.)

**Resolution + checkpoint:** each item runs through the internal matcher (`matchIngredient` — resolve-only, not a model-advertised tool) with cache revalidation (a cache hit no longer fulfillable is re-resolved). Items the matcher returns as `ambiguous` or `unavailable` are collected into a single `checkpoint` and are **not** added to the cart. Disposition them and re-call with `overrides` — already-carted items have advanced to `in_cart`, so they won't be re-added.

**`overrides` — force a specific SKU (disposition *or* lock a deal):** `[{ name, sku, brand?, size? }]` pins a chosen SKU for a line, bypassing the matcher. Use it two ways: to **disposition** an ambiguous/unavailable item, or to **lock a SKU you verified** — e.g. the on-sale `sku` returned by [`kroger_prices`](#kroger_pricesingredients) — so the deal's exact SKU survives into the cart instead of the matcher picking its own. A forced SKU is **revalidated** for current curbside/delivery availability and returned with **fresh** `price`/`on_sale` (so a deal that lapsed since you checked is visible); a forced SKU that has gone **unavailable** is routed to `checkpoint` rather than blind-carted. **Overrides pin the SKU, not the price:** the cart write (`PUT /v1/cart/add`) carries only SKU + quantity — no price — so whether a sale price actually realizes is Kroger's determination at fulfillment, against flyer data that may be hours-stale. Don't promise the user a locked price; surface the fresh `on_sale` at `preview` and let them decide.

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
The review form is the mutually exclusive shape
`{ stage: { skipped, quantities, selections, impulses, saved_brands }, preview_fingerprint,
cleared_cart_ack }`. Each selection is `{ line_key, sku, source, divergence? }`; each impulse is
`{ key, label, sku? }`. The server rejects duplicate keys/markers and selections that were not
issued for that exact line and current fingerprint.
All sections optional. With no args it flushes the current to-buy set (list ∪ derived plan needs − pantry). Package counts (`quantities` and `menu_needs[].quantity`) must be positive integers ≤ 99 — a fractional, zero, or oversized value is rejected before any cart write (`place_order` is the only tool that writes a real Kroger cart).

**Returns:**
```
{
  resolved:  [{ name, sku, brand, size, quantity, assumed_quantity, price?, on_sale?, aisleLocation? }],  // assumed_quantity: qty defaulted to 1; price/on_sale/aisleLocation: fresh at resolution
  checkpoint:[{ name, kind: "ambiguous"|"unavailable", candidates?, message }],
  partials:  [{ name, for_recipes }],
  sku_cache: { committed, inserted?: [line_key], updated?: [line_key], unchanged?: [line_key], error? },
  cart:      { written, count?, error?, code? },   // code carries reauth_required etc.
  list:      { advanced, rolled_back?, error? },   // D1-backed (no commit_sha); see partial-failure honesty below
  send:      { recorded, id?, error? },            // the send-record snapshot (spend telemetry); honest independent reporting
  preview:   bool,
  underived: ["<slug>", ...]              // planned recipes whose items are NOT in this order
}
```

**Send record (spend telemetry):** a real (non-preview) flush persists a **send record** — one `order_sends` row plus one `order_send_lines` row per resolved line, carrying the pick (`sku`/`brand`/`size`), package quantity, the resolution-time `regular`/`promo`/`on_sale` prices with the effective `unit_price` and derived sale `savings`, the canonical `department` stamp (NULL while its ingredient is pending classification), and a deterministic `provenance` (`planned` for a line from the stored list, the server-derived plan needs, or one carrying `for_recipes`; `impulse` for a bare caller extra) — written **in the same D1 batch as the in-cart advance**, with each advanced row linked to it (`sent_in`). These prices are **send-time quotes** by definition: the cart write carries only SKU + quantity, so fulfillment may differ (weight-priced items, lapsed/appeared promos) and no reconciliation source exists. The snapshot materializes into spend events only when the user asserts the order was placed (the `in_cart → ordered` advance — see [`update_grocery_list`](#update_grocery_listoperations)); a rolled-back cart write **deletes** the send record (no phantom order), and a snapshot-build failure never blocks the flush — rows advance without a linkage and `send` reports `{ recorded: false, error }`. Preview writes no send record. See `docs/SCHEMAS.md` (spend telemetry) for the row shapes.

**Partial-failure honesty (double-add-safe write order):** the advance/cart pair is ordered so a retry can never double-add, and learning follows confirmed cart acceptance. Order: advance the list plus send snapshot to `in_cart` → write the cart → compare/upsert the SKU cache. The ordering exists because `PUT /v1/cart/add` is **additive and unreadable**: items left `active` after a successful cart write would be silently re-bought by a retry (costs money), whereas items marked `in_cart` without a cart write are a *visible* under-buy that a retry never compounds. The legs report honestly:
- **Advance fails** → the cart write is **skipped entirely**: `list: { advanced: false, error }`, `cart: { written: false, error }` — nothing was carted, the whole order is safe to retry.
- **Cart write fails** → the advance is **undone exactly**, the cache writer is not called, and zero mappings are claimed learned: pre-existing rows roll back to `active`, and rows the advance itself inserted are deleted — `list: { advanced: false, rolled_back: true }`. Retryable, no silent drop, and the cart is never reported populated.
- **The rollback itself fails** → `list: { advanced: true, rolled_back: false, error }` — the items are marked `in_cart` with **no** cart write. A retried `place_order` will **not** re-add them (`in_cart` is excluded from the to-buy set); recover via `update_grocery_list` (set them back to `active`) or let the stale-cart flow surface them.

A cache-commit failure after a successful cart reports exact zero learned plus the error and re-resolves next time; it never rolls groceries back. If the cart write fails because the Kroger refresh token was rejected, `cart.code` is `reauth_required` — call [`kroger_login_url`](#kroger_login_url) and give the member the returned link to re-authorize (see `docs/SELF_HOSTING.md`).

**Mapping commit (refresh-on-difference, aisle capture):** the SKU-cache commit covers **every** resolved line — cache-hit lines included, whose revalidation carries fresh data — and each mapping carries the resolved product's **aisle placement** (`aisle_number`/`aisle_description`/`aisle_side`, stamped `aisle_captured_at`) when Kroger reports one. A key already cached is skipped **only when its learned fields (SKU, brand, size, aisle) are identical**; a differing row is refreshed in place (with `last_used`), so mappings and placements **converge organically with each order** instead of freezing at first capture. The captured placements feed [`read_to_buy`](#read_to_buyenrich)'s enriched read and the in-store walk.

**Lifecycle (`active → in_cart → ordered → received`):** `place_order` sets `in_cart` (stamping each advanced row's send linkage). Because the cart API is write-only and unreadable, the transitions past `in_cart` are **user-asserted**, never agent-verified:
- *"I placed the order"* → advance `in_cart` items to `ordered` via `update_grocery_list`'s `update` op (stamps `ordered_at`). This is the **only** path into `ordered` that `update_grocery_list` accepts — a write of `ordered` on an item not currently `in_cart` is rejected as a structured **conflict** (see [`update_grocery_list`](#update_grocery_listoperations)). This advance is the **purchase assertion** that materializes the order's spend from the send-time snapshot; items never marked placed surface as *awaiting mark-placed* (in [`retrospective`](#retrospectiveperiod-spend_range-waste_range-waste_mapping_version)'s spend section) and are never auto-counted.
- *"I picked up the groceries"* → for rows still `in_cart`, first advance them to `ordered` (the purchase assertion), then `received` (terminal): an `update_grocery_list` `remove` op for each, and for `grocery`-kind items only, restock the pantry via `update_pantry`. `household`/`other` items don't touch the pantry, and the receive itself records nothing (removes never write spend).

A **stale-cart reminder** fires when a new order begins while the prior list still has `in_cart` items never confirmed `ordered` (the deterministic signal is [`read_to_buy`](#read_to_buyenrich)'s `in_cart` section — the member app's order dialog leads with the same warning): remind the user to clear the Kroger cart manually (the API can't), rather than silently double-adding.

**One shared operation.** The tool body is the extracted `runPlaceOrder` op; the member app's `POST /api/grocery/order` calls the same operation over fresh `buildOrderWiring` deps (preview and commit are the same endpoint discriminated by `preview`), with the tool's observable behavior unchanged. The endpoint is gated to Kroger-online fulfillment — a non-Kroger primary receives a structured `unsupported` naming the correct flow — and the app's commit is **online-only** (never queued/replayed: the cart write is not idempotent).

**`place_order` stays Kroger-only.** The parallel **satellite cart-fill flush** for an API-less store (satellite-order-cart-fill) adds **no MCP tool** and does not touch `place_order`: it is served by the two direct `/satellite/order/*` endpoints (see `docs/SCHEMAS.md`), driven by the tenant's local helper, and the agent routes to it from the `preferences.stores.fulfillment === "satellite"` marker it already reads at the start of the `shop` skill — no `place_order`-shaped tool is minted for it (there is nothing Worker-side to mint; the helper URL/token live on the tenant's machine). Carted/substituted lines advance to `in_cart` exactly as `place_order` does, and the same `active → in_cart → ordered → received` lifecycle + user-asserted transitions apply.

---

## Bug reporting (agent-bug-reporting)

### `report_bug(title, body)`

Records a bug report into the **operator's review queue** (the D1 `bug_reports` table), on behalf of a member who can't file issues themselves. The operator reviews it in the **admin panel** (`GET /admin/api/bug-reports`). The Worker stamps attribution it controls — the reporter is the caller's tenant id, plus a UTC timestamp — so identity can't be omitted or spoofed by the agent. Use it when a yamp tool errors in a way the agent can't work around, or when the user has had to repeatedly correct/redirect on the same thing; write a specific, reproducible report. Returns `{ filed: true }`.

**Errors:** `storage_error` (the D1 write failed). It does not file a GitHub issue, so it **cannot** return `insufficient_permission`.

Behind the per-tenant gate; a pure D1 write — no GitHub. Driven by the agent's `report-bug` skill, which fires on an unworkable tool error or repeated user correction, files at most one report per distinct problem per session, then tells the user it flagged it.

---

## What this surface deliberately does NOT include

- No raw corpus write access — recipe **editing** is not on the member surface at all (the member web app owns member edits; `import_recipe` is create-only; the operator merge screen owns fold/tombstone). Guidance writes are entirely operator-curated (direct corpus edits; the admin panel only views the tree) — there is no `save_guidance` tool for any domain.
- No raw Kroger API access (the matching pipeline + cart write only); the matcher core (`matchIngredient`) and the unit-price core (`compareUnitPrice`) are pipeline-internal, reached only through `place_order`'s resolution and the order-review widget's app ops — neither is a model-advertised tool.
- No "search arbitrary text across recipes" (use `search_recipes` over the index).
- No "execute arbitrary code" or "run arbitrary script".
- No portion math (no whiteboard problem).
- No store management beyond mid-walk capture — `add_store`/`add_store_note` are the only member MCP store tools; listing, identity reads/edits, removal, and store-note maintenance are member/admin web surfaces over the same shared operations.
- No discovery configuration on the member surface — feeds, the inbound-newsletter allowlist, source rejection, and the parked-candidate error log are all operator admin surfaces (`admin Discovery`/`Config`); the member's own reach is `list_new_for_me` (read) and `import_recipe` (manual bring-in).
- No diagnostics/audit tools on the member surface — `reconcile_errors`, `discovery_errors`, and the satellite rejection ledger are all read from the operator admin panel, not an agent tool.
- No tool that itself schedules or triggers background work — the scheduled jobs (the flyer warm, the recipe-index projection, the recipe-derived reconcile, the discovery sweep) run in the Worker's `scheduled()` handler, not as tools; the tool surface only *reads* their output (`flyer`, `search_recipes`, `list_new_for_me`).
- No weather tool — `propose_meal_plan`/`display_meal_plan` load the forecast silently, server-side; weather is engine context, not an agent verb.
- No batch `commit_changes` tool — each write category has its own standalone tool (or ops-form tool), and a multi-write turn is one granular call per write.
- No ready-to-eat surface — heat-and-eat items a member keeps on hand are ordinary pantry stock (`update_pantry`); the retained D1 `ready_to_eat` table (see SCHEMAS.md) is not read or written by any tool.

---

## `create_instacart_handoff` — config-gated (Instacart)

Registers only when the Instacart configuration resolves (the registration model above). Creates or reuses an Instacart Marketplace shopping-list page for the caller's current
derived to-buy set. No parameters. Returns one of:

- `ready`: `url`, `expires_at`, `reused`, `item_count`, `underived`, and
  `destination:"instacart_marketplace"`;
- `empty`: `item_count:0` and `underived`;
- `unavailable`: `code:"not_configured"`;
- `error`: closed `code` (`invalid_request | unauthorized | forbidden | rate_limited |
  upstream_unavailable | invalid_response`) and `retryable`.

This tool creates a review handoff only. It never chooses a retailer, matches a product,
fills or reads a cart, places an order, advances grocery rows, records sends/spend, or
claims checkout. It makes no external request when operator configuration is absent.

## Harness-provided widgets (NOT MCP tools)

These are **claude.ai built-ins**, not part of `yamp`. They are exposed by the Claude.ai harness, are invisible to the Worker, and appear in the agent's tool set only where the harness exposes them. A skill that uses one MUST guard on its presence and degrade when it is absent — see the guided `cook` flow in [`AGENT_INSTRUCTIONS.md`](../packages/plugin/AGENT_INSTRUCTIONS.md). They are documented here so the contract a skill encodes has a single anchor, not because they belong to this surface.

**Two bespoke widgets sit alongside these built-ins.** `yamp` ships two **bespoke** MCP Apps widgets of its own — the recipe card at `ui://recipe/card` (rendered from the `display_recipe` tool, above) and the interactive meal-plan proposal card at `ui://plan/propose` (rendered from the `display_meal_plan` tool) — real resources this Worker serves over MCP `resources/read`. They belong to *this* surface, not to the harness. The recipe card is the conversation's guided-cook surface (D32): the guided `cook` flow emits `display_recipe`'s cook-mode card on an MCP-Apps host, so cook completion, log-cooked, and favorite reach the agent through the card's bridge. `recipe_display_v0` below is the harness-provided built-in it supersedes for that flow.

### `recipe_display_v0`

Renders an interactive recipe card: a servings-scalable ingredient list and a tappable, timer-bearing step list. The harness-provided built-in; the guided `cook` flow scaffolds prep + cook onto `display_recipe`'s cook-mode card (D32), falling back to a plain-text walk when the host does not render MCP Apps.

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

