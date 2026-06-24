# Architecture

How the grocery agent works under the hood. This is the durable technical reference — the system as it *is*, not a roadmap. For the agent's conversational behavior see [`AGENT_INSTRUCTIONS.md`](../AGENT_INSTRUCTIONS.md); for file formats see [`SCHEMAS.md`](SCHEMAS.md); for the tool contract see [`TOOLS.md`](TOOLS.md); for working in the repo see [`CONTRIBUTING.md`](../CONTRIBUTING.md).

## Three components

The system is three pieces with one clean split: **the LLM does the fuzzy work; everything deterministic is code.**

```
┌────────────────────────────────────────────────────────┐
│  Claude.ai (each member's own — web + mobile)          │
│   • grocery-agent plugin: skills + grocery-mcp conn.   │
│     installed from a marketplace — nothing pasted      │
│   • connects once via an operator-issued INVITE CODE   │
└─────────────────────┬──────────────────────────────────┘
                      │  MCP over HTTPS (OAuth 2.1 bearer)
                      ▼
┌────────────────────────────────────────────────────────┐
│  Cloudflare Worker — OAuth 2.1 provider + grocery-mcp  │
│   • OAuth provider (KV): token → grant → tenantId      │
│       → resolveTenant → a per-tenant MCP server        │
│   • domain tools: coarse, opinionated, deterministic   │
│   • Kroger client (shared reads; per-tenant cart)      │
│   • GitHub App installation token (no PAT) for repo I/O │
└─────────────────────┬──────────────────────────────────┘
                      │  GitHub App token + Kroger API
                      ▼
┌────────────────────────────────────────────────────────┐
│  ONE private GitHub data repo (operator-owned)         │
│   shared root (read by all):                           │
│     recipes/*.md · aliases.toml                        │
│     skus/kroger.toml · storage_guidance/ · feeds.toml  │
│     stores/*.toml · _indexes/                           │
│   users/<username>/ (per-member attributed records):   │
│     notes/ · store_notes/                              │
└────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────┐
│  KV (Cloudflare KV) — ephemeral infra ONLY:            │
│   KROGER_KV · TENANT_KV · OAUTH_KV.                    │
│   (DATA_KV retired — recipe index, profile, and        │
│    session state all moved to D1.)                     │
└────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────┐
│  D1 (Cloudflare SQLite, relational tier — migrated     │
│   slice by slice)                                      │
│   recipes        (shared objective recipe index)       │
│   cooking_log    (per-tenant realized cook history)    │
│   profile        (per-tenant singleton: prefs scalars, │
│     taste/diet markdown, stores/dietary/custom JSON)   │
│   brand_prefs · kitchen_equipment · staples · overlay  │
│   ready_to_eat · stockup  (per-tenant profile children)│
│   pantry · meal_plan · grocery_list  (per-tenant       │
│     session state — row tables)                        │
└────────────────────────────────────────────────────────┘

(The CODE repo — this one: Worker src/, scripts/, docs/, CI —
 is a separate upstream. Self-hosters deploy it; they never fork it.)
```

- **Claude.ai** is the conversational surface and the reasoning. Each chat starts fresh; state lives in D1 (profile + session state + cooking log + recipe index) and the data repo (attributed records + shared corpus), not in chat history. The agent reads what it needs through MCP tools at the start of a conversation.
- **The Worker** (this repo, root `src/`) is a Cloudflare Worker hosting the `grocery-mcp` MCP server — the domain tool surface (pantry, recipes, Kroger, cart) — plus an OAuth 2.1 provider members connect their Claude.ai to. It is the locus of determinism and the multi-tenant gate.
- **The data repo** (`<operator>/groceries-agent-data`, private) is the substrate: flat files (TOML + markdown) in git, with git history as the audit log. Created from [`groceries-agent-data-template`](https://github.com/caseyWebb/groceries-agent-data-template); see [`SELF_HOSTING.md`](SELF_HOSTING.md).

There is no database, no scheduler, no CLI, and no stateful agent runtime — the `agents` SDK is present only for its stateless `createMcpHandler` MCP transport (no Durable Objects, no Workflows). Everything else is glue.

## The determinism boundary

The whole design turns on putting the LLM only where genuinely-fuzzy judgment is needed and keeping everything else as plain deterministic code inside the Worker's tools.

**Three places the LLM earns its keep:**

1. **Message understanding and tool orchestration.** Claude reads the request, decides which tools to call in what order, asks follow-ups, interprets freeform constraints ("comfort food one night," "I'm feeling lazy"). This is Claude's native strength — there is no custom routing logic.
2. **Menu-generation reasoning.** Given assembled context (pantry, flyer, candidates, ready-to-eat, preferences), Claude proposes a plan honoring multiple soft and hard rules. The genuinely-fuzzy step.
3. **Fuzzy-matching fallback** inside the Worker's Kroger pipeline, only when deterministic narrowing leaves ambiguity, plus taste-profile scoring of new discoveries.

**Everything else is deterministic code with no LLM in the loop:** file I/O, frontmatter parsing, recipe filtering and scoring, Kroger API calls, RSS/JSON-LD parsing, cart writes, git commits, index generation, validation.

The MCP tool boundary is where this is enforced. Tools are **coarse and opinionated** — they wrap multi-step pipelines so the LLM can't bypass them. Raw building blocks (`kroger_raw_search`, `github_raw_write`, `cart_add_by_name`) are deliberately **not** exposed, because they would let the LLM skip the cache, the validation, or the SKU-matching pipeline. See [`TOOLS.md`](TOOLS.md) for the design philosophy and the full inventory.

**The deeper pattern — capture → retrieve → narrow.** Where the system needs LLM-derived *knowledge* (not just orchestration), it does not re-derive it on every read; it **captures** the model's judgment once into persistent data, **retrieves** it deterministically, and lets the LLM **narrow** with live context. Recipe import already works this way: Claude classifies `protein` / `cuisine` / `perishable_ingredients` / `course` once at import (capture), the build projects them into `_indexes/` and `list_recipes` filters them (retrieve), and menu-gen reasons over the filtered set (narrow). The LLM sits at the two ends — the one-time capture and the contextual narrowing — while determinism owns the middle (identity, indexing, lookup) and the gates (validation). Caching beats re-reasoning at scale because the hot path stays deterministic, reserving the model for genuine novelty and genuine judgment — which is also what keeps the agent viable on a smaller, faster model. **The same pattern also runs on a schedule:** a cron-driven sweep warms a per-store Kroger *flyer* into KV (capture), `kroger_flyer` reads that rollup (retrieve), and menu-gen reasons over it (narrow) — relocating the multi-second sale fan-out off the agent's hot path and under the free-tier per-request subrequest cap (a synchronous tool call has one invocation's budget; a background sweep has unlimited invocations over time). See *the flyer warm* below.

**Direction — thin tools, recipe-side retrieval, LLM reasoning.** The scaling pressure is on the recipe side, and it's already solved there: recipes are first-class entities with captured metadata and an index, and you never reason over the whole corpus at once — `list_recipes` filtering plus each member's **active overlay** narrow it to a small candidate set that loads into context. So the system leans into LLM reasoning at the *narrow* end (substitution, freshness, pantry matching, the to-buy list — all read-time over the loaded pantry + chosen recipes) and keeps deterministic *retrieval* only over what's unloadable (the Kroger catalog) or large (the corpus index). Tools shrink — `substitutions.toml`/`propose_substitutions` and `verify_pantry` (with its recipe-ingredient parser) fall out — and the reasoning moves into the skills. The near-term lever, now realized, is **recipe faceting**: an open-vocabulary `course` field (`main | side | dessert | breakfast | …`, classified at import, shape-validated only — no controlled set) so one faceted `list_recipes` call returns the active mains+sides with metadata and `meal-plan` reasons holistically over the whole plate (menu + sides + expiry-matching + pantry subs) before cost/confirm. Sides are **two-tier**: corpus sides (`course: side` recipes, remembered in `pairs_with`) and **open-world** sides (trivial preparations with no recipe file) that ride on the main's `meal_plan.toml` row and flow to the cart by world-knowledge ingredient enumeration. `standalone` was retired as a vestigial cache — whether a main needs a side is inferred in that same pass. Ingredients stay strings; `aliases.toml` stays as the matcher's small normalization table. A self-growing *ingredient knowledge graph* was considered and deferred (the feature that justified it — expiry-driven cooking — is read-time-solvable). See [`adr/0001-determinism-boundary-capture-retrieve-narrow.md`](adr/0001-determinism-boundary-capture-retrieve-narrow.md) for the decision, the locked choices, the deferred graph, and the rollout (the `thin-pantry-and-substitution-path` change is Phase 0).

## Multi-tenant identity

One self-hosted Worker serves a small friend group; each member connects their own Claude.ai. The code is a separate upstream self-hosters deploy without forking; **all the data** lives in **one operator-owned private repo** with a shared root plus one `users/<username>/` subtree per member.

- **OAuth 2.1 provider.** Claude.ai custom connectors authenticate via OAuth, so the Worker hosts an OAuth provider (`@cloudflare/workers-oauth-provider`, KV-backed — no SQL). `src/index.ts` constructs the provider; `src/authorize.ts` renders the invite-code consent page.
- **Identity is an operator-issued invite code** against a curated allowlist — members need no GitHub account. The issued access token's grant carries the member's `tenantId`.
- **"Which tenant" is a path prefix.** `users/<username>/` in the single data repo, addressed by wrapping the GitHub client (`prefixedClient`). Each request resolves token → tenant *before* any tool runs, so no tool can reach another member's subtree.
- **Repo access is a short-lived GitHub App installation token**, never a PAT. The App private key is a Cloudflare secret; the App id / installation id / data-repo coords are non-secret `wrangler.jsonc` vars.
- **Kroger split:** `client_credentials` product/price reads are shared at the app level; cart writes use a **per-tenant** `authorization_code` refresh token (`kroger:refresh:<tenant>`). The product/price client bounds its own concurrent in-flight requests to a small fixed cap (default 6), so fan-out callers (`kroger_prices`, the background flyer warm, etc.) use plain `Promise.all` — the cap prevents 429 storms without callers needing a concurrency primitive.
- **Shared flyer cache (the one deliberately cross-tenant data plane).** The warmed Kroger flyer is keyed by `locationId` (`flyer:{locationId}` in `KROGER_KV`), so tenants at the **same store share one rollup** and tenants at **different Krogers get independent ones**. This is the single shared data-plane cache; everything else is strictly per-tenant. It is sound because store-wide sale prices are **public-derived, not tenant-private** — no member's state leaks. The cron sweep that fills it (`src/flyer-warm.ts`) runs *without* an OAuth session, so it enumerates the tenant directory and reads each `users/<id>/preferences.toml` for its `preferred_location` directly.

A **solo operator** is simply the degenerate case: one `users/<id>/` subtree.

## The data model

The data repo is the system's memory. It splits two ways — shared vs per-tenant — and within a tenant, into a small set of intent files that must not be conflated. Field-level schemas live in [`SCHEMAS.md`](SCHEMAS.md); this is the conceptual map.

### Storage tiers (the three-tier boundary)

Per `cloudflare-storage-architecture`, persistent state lives across three tiers chosen by the *nature* of the data, not by convenience:

- **GitHub** — authored **markdown** only: `recipes/*.md` (recipe *content*) and `storage_guidance/*.md` (curated put-away advice). The source of truth for the human-authored corpus, hand-edited via Obsidian / native git apps. This is the one tier a human edits directly; after the `d1-*` slices, everything else (shared corpus, attributed notes, profile, session, cooking log, recipe index) is D1.
- **D1** (`env.DB`) — all **domain/operational data and derived projections**: the queryable, relational, admin-editable, strongly-consistent (read-after-write) tier. The recipe index, profile, session state, cooking log, notes, registries, config, and caches land here, **migrated slice by slice**. Tools never touch `env.DB` directly — they go through `src/db.ts` (prepared-statement helpers + structured-error mapping; tools never throw). The `d1-foundation` slice stands up the binding, the access layer, and the migration pipeline but moves no domain data yet (a `schema_meta` bootstrap table only).
- **KV** — **ephemeral infrastructure only**, no domain data: `KROGER_KV` (Kroger tokens, PKCE verifiers, the TTL flyer cache, background-job health), `OAUTH_KV` (OAuth provider state), `TENANT_KV` (tenant directory / invites). **`DATA_KV` has been removed** — the recipe index, the profile, and session state (pantry/meal_plan/grocery_list) all moved to D1, and the one-time backfill ledger went with the retired `.mjs` migrations. The Worker binds only `KROGER_KV`, `TENANT_KV`, and `OAUTH_KV`.

As slices land, per-tenant operational state has moved from KV/GitHub into D1 behind `src/db.ts`; with session state migrated (`d1-session-state`), `DATA_KV` carries no domain data.

### Shared vs per-tenant

- **Shared corpus (D1, `d1-shared-corpus`)** — objective, single-source, read by everyone, migrated off GitHub TOML to D1 tables: `aliases`, the location-tagged `sku_cache`, `stores` (registry identity), `flyer_terms`, and the discovery sources (`feeds`, `discovery_candidates` inbox, `discovery_senders`/`discovery_members` allowlist). Written + validated at the Worker write tools, read by query. (Curated `storage_guidance/*.md` stays GitHub markdown.) The recipe index is the derived D1 `recipes` table.
- **Attributed records (D1, `recipe_notes` / `store_notes`)** — each member's attributed recipe/store notes, migrated off `users/<username>/*.toml` to D1 tables with an `author` column + `private` flag (own-private + group-shared at read time). The GitHub `users/<username>/` subtree holds **no domain data** after the migration — the pre-backfill TOML (notes, `cooking_log.toml`) remains in git, inert, until a post-migration cleanup removes it.
- **Per-tenant D1 (session state)** — each member's working state is now D1 row tables (`d1-session-state`): `pantry`, `meal_plan`, `grocery_list` (keyed by normalized name or recipe slug), replacing the former `state:<username>:*` KV blobs. Adds are row upserts, removes/status changes are targeted row statements — strong read-after-write consistency, no whole-array rewrite. The Worker read path has **no** GitHub/KV fallback (a miss returns empty).
- **Per-tenant D1 (records + profile)** — the relational tier. The `cooking_log` table is per-tenant realized cook history (`d1-cooking-log`); the `recipes` table is the shared objective recipe index; the **profile** tables (`profile`, `brand_prefs`, `kitchen_equipment`, `staples`, `overlay`, `ready_to_eat`, `stockup`; `d1-profile`) hold each member's preferences/taste/diet/kitchen/staples/overlay/ready-to-eat/stockup. Tenant-scoped on every read; written via `log_cooked` (cooking events — which also clears the cooked recipe from `meal_plan` in the **same transaction**), the build (recipe index), the profile write tools, and the session-state tools (`update_pantry`, `update_meal_plan`, `add_to_grocery_list`, …).

### Three-category recipe model

A recipe splits three ways so a shared corpus is safe to share:

- **Content** — objective frontmatter + body, shared and single-source.
- **Overlay** — `rating` + `status`, per-tenant in the D1 `overlay(tenant, recipe, rating, status)` table. One member's disposition never changes another's. `status` lifecycle: `active` (candidate set) · `draft` (surfaced, not yet dispositioned) · `rejected` (explicit no, kept for de-dup) · `archived`. Effective `status` defaults to `draft` when a member has no overlay row. The group-ratings signal (`read_recipe_notes`) is a single indexed query — `SELECT tenant, rating, status FROM overlay WHERE recipe=?` scoped to the caller's group — replacing the former per-tenant bundle scan.
- **Notes** — per-tenant, attributed, append-mostly (`users/<id>/notes/<slug>.toml`).

`last_cooked` is **not stored** — it's derived per-tenant from that member's D1 `cooking_log` rows (`MAX(date)` per recipe). Read tools merge shared content + the caller's overlay + cooking-log `last_cooked` at read time; the shared D1 `recipes` table carries objective fields only.

**Notes are the spin-capture mechanism that makes sharing safe.** A tweak ("sub gochujang for the sriracha") is an attributed note, never an edit to shared content; only a genuinely *different dish* warrants a personal-recipe fork under `users/<id>/recipes/`. The shared body changes only for an objective correction. Group notes/ratings aggregate across members at read time (`read_recipe_notes`).

### The intent model (per-tenant)

Five intent kinds — don't conflate them:

| Key / backing | Kind of intent |
| --- | --- |
| `pantry` (D1, tenant-scoped) | **observation** — what's physically in the kitchen |
| `stockup` (D1, tenant-scoped) | **conditional intent** — buy IF it drops below a threshold |
| `grocery_list` (D1, tenant-scoped) | **committed buy intent** — buy on the next order (ingredient-level, SKU-free) |
| `meal_plan` (D1, tenant-scoped) | **committed cook intent** — recipes agreed to cook next (transient) |
| `cooking_log` (D1, tenant-scoped) | **realized history** — append-only log of meals actually cooked |

KV state is freely mutable with no git history (appropriate for transient operational data); the `cooking_log` D1 table is the durable, queryable cook history (`id`-addressable, read-after-write consistent). The agent **captures intent into the grocery list continuously**, and **flushes to the cart once**, at order time. Capture is store-agnostic (the list is SKU-free); the flush is not.

### The flush branches (`shop-groceries`)

Capture is identical regardless of where the user shops; only the flush differs, detected by the `shop-groceries` skill from `preferences.toml [stores].primary` and trip context:

- **Kroger online** (`primary: kroger`, no in-store trip) — `place_order` resolves the whole `grocery_list.toml` against current Kroger availability, surfaces ambiguous/unavailable items as one batch, writes the Kroger cart, and appends learned `skus/kroger.toml` mappings. The repo is the mutable store (capture continuously); the cart is append-only (flush once).
- **Kroger in-store** (`primary: kroger` + in-store trip, or named Kroger location) — uses the Kroger Products API's `aisleLocation: { number, description, side? }` field (returned by `kroger_prices`) to order the list by aisle number automatically — no pre-mapped layout required. After the first visit, the store's slug and Kroger `locationId` are registered in `stores/<slug>.toml` (`location_id` field); `resolveLocationId` in `src/kroger.ts` detects a no-space `location_id` string and returns it directly, bypassing the Locations API on every subsequent walk. Items with `inStore: false` are surfaced before the walk (not silently dropped); `location`-tagged store notes are seeded silently and idempotently after each walk.
- **In-store walk** (`primary` is a non-Kroger store slug, or named non-Kroger store) — reads the same list and groups it for the store, walked hands-free one aisle at a time. Degrades gracefully: no map → a department-grouped list from world knowledge; a mapped store → aisle-by-aisle from its `layout` notes, with `location` notes pinpointing the tricky items. On completion, picks received directly from `active` (no `in_cart`/`ordered` stage) — removing them and restocking the pantry, the same end-state as a Kroger pickup. A first visit to an unmapped store offers to record the layout (as `layout`-tagged store notes) *while* shopping.

The shared `stores/<slug>.toml` registry holds store **identity** per *location*, including the optional `location_id` (chain-specific external id — for Kroger, the `locationId` that bypasses the Locations API); the **layout** lives in attributed per-tenant store notes (`users/<id>/store_notes/<slug>.toml`) — aisle order (`layout` tag), where-it-hides hints (`location`), and not-carried entries (`stock`) — so mapping a store once helps the whole group, and an author can correct their own notes (`update_store_note` / `remove_store_note`). Each grocery-list item carries a `domain` facet (default `grocery`) so a non-grocery run (e.g. Lowe's) filters the list for free.

## Kroger product matching (ingredient → SKU)

The hardest deterministic problem: turning a recipe ingredient string ("extra virgin olive oil, 1 tbsp") into a specific Kroger SKU. It lives entirely inside `match_ingredient_to_kroger_sku`. The pattern is **progressive deterministic narrowing, with LLM fallback only when ambiguity remains.**

1. **Normalize** — strip quantity/units, lowercase, apply `aliases.toml`. Alias-driven, *not* an aggressive qualifier-stripper: `aliases.toml` is the curated source of truth for which variants collapse to which canonical term.
2. **Cache lookup → revalidate** — if a normalized term → SKU mapping exists in `skus/kroger.toml`, take that SKU and revalidate it with one targeted lookup (current price + curbside/delivery availability at the preferred location). Available → use it with fresh price/promo; unavailable → treat as a miss and fall through to search (self-healing). Every hit is revalidated, so there is no TTL. The cache short-circuits the expensive search, not the price check. The LLM may pass `bypass_cache` when a cached generic doesn't fit the recipe context.
3. **Kroger search** — `filter.term` + `filter.locationId` (+ fulfillment) → candidate products with price, size, brand, `aisleLocation`, and `inStore`. `resolveLocationId` is called to resolve the `locationId` from the user's `preferred_location` label — if the value has no spaces it is treated as an already-resolved `locationId` (the `stores/<slug>.toml` `location_id` bypass) and returned directly without a Locations API round-trip.
4. **Score candidates** (rule-driven scoring, *not* hard filters) — brand preference from `preferences.toml [brands]`; dietary as a soft score. Two near-hard constraints govern *which product*: **availability** (must be fulfillable via curbside/delivery) and **identity relevance** (how many query tokens appear in the product description/categories). A confident pick comes only from the top relevance tier, so "anaheim peppers" resolves to the Fresh Anaheim Peppers PLU, never a cheaper unrelated fulfillable item. If nothing shares any query token, the matcher returns ambiguous rather than guess. Scoring (not filtering) means a missing preferred brand can't empty the set. This step does **not** substitute.
5. **Deterministic tiebreaker** (within the top-scoring set) — prefer on-sale, then best price-per-unit (deterministic arithmetic; the LLM only normalizes messy size strings, never does the math); "don't care" commodities take the smallest package covering the quantity hint, then cheapest.
6. **Confidence gate → LLM only when ambiguous** — **confident** (auto-pick): a cache hit, or a defined brand preference resolves it (including `[]` = "don't care, cheapest acceptable"). **Ambiguous**: no cache hit *and* no defined brand preference → return narrowed candidates and let Claude pick from context or ask.
7. **Cache result** (persisted at order time) — the resolved mapping is appended to `skus/kroger.toml`; the matcher itself only resolves, and the cache write rides `place_order`'s flush.

**Confidence is legible and self-extinguishing.** It comes entirely from `preferences.toml [brands]`, which is **tri-state**: key absent → ask; `[]` → "don't care," cheapest acceptable; `["A","B"]` → ranked preference. Every answered question caches, so it asks less over time — after a few weeks of use, most common ingredients are cached and never hit the LLM. **Substitution is a separate, confirmed step** — LLM reasoning, not a tool: inventory subs are judged over the loaded pantry, sale/unavailable subs are enumerated from world knowledge and resolved as ordinary Kroger searches, and either is surfaced for the user to confirm. The matcher itself never substitutes. Quantity translation is intentionally coarse ("3 cloves garlic" → buy a bulb); pantry tracking absorbs the slack.

## The flyer warm (scheduled capture)

The public Kroger API has no flyer/circular endpoint, so the "what's on sale" list is **synthesized** by searching curated broad terms (`flyer_terms.toml`) and keeping the genuine discounts. Doing that live inside `kroger_flyer` fanned one search per term and ran into the Cloudflare Workers **free-tier cap of 50 external subrequests per invocation** as the term set grew — plus multi-second latency on the user's hot path. So the fetch moved to a scheduled **cron** (`src/flyer-warm.ts`, the `scheduled()` handler in `src/index.ts`), and `kroger_flyer` became a pure KV read.

- **One trigger, a cursor sweep.** A single cron fires on a short cadence (every few minutes). Each tick reads a small `flyer:cursor`, processes the **next bounded batch** of `(location, term)` units (sized to stay under the 50-subrequest *and* ~10ms-CPU per-invocation caps), advances the cursor, and **no-ops** once the sweep is complete — until the daily refresh window re-arms it. The total term set is unbounded: more terms just mean more ticks, never a bigger invocation. The murky free-tier cron-*count* limit never bites because there is exactly one trigger.
- **Plan built once, persisted.** Enumerating the work (the tenant directory + each `preferences.toml` + `flyer_terms.toml`) costs external GitHub reads, so it happens **once at sweep start** and the plan is persisted in `flyer:plan`; every later tick reads the plan from KV (a CF-services read, not an external subrequest) and spends its budget only on Kroger scans.
- **Per-location rollup, noise floor at warm / deal floor at read.** Results are materialized as one `flyer:{locationId}` rollup of fulfillable, on-sale candidates (raw `regular`/`promo` kept). `kroger_flyer` applies the caller's `min_savings_pct` at read, so the deal threshold stays tunable without a re-fetch. A cold cache reads as empty (graceful), and an `as_of` timestamp conveys age — staleness is low-stakes because the order path re-prices live.

## The recipe-embedding reconcile (scheduled capture)

The same `scheduled()` handler runs a **second** job each tick: reconciling the semantic-search recipe embeddings (`src/recipe-embeddings.ts`, `semantic-meal-plan`). A recipe's embedding is **derived** from its AI-written `description`, but the Node build that projects the `recipes` table has no `env.AI` binding — so vectors are generated **Worker-side on the cron**, not by the build. Each tick embeds any recipe whose description is new or changed (a `description_hash` gate) and prunes vectors whose slug no longer has a description, writing the sibling `recipe_embeddings` table (slug → vector, migration 0007). This is the *capture → retrieve → narrow* pattern again: capture the embedding once, `recipe_semantic_search` retrieves by cosine, the planning skill narrows.

- **It is *not* the flyer's free-tier problem — a different subrequest budget.** The flyer became a cron because Kroger fetches exhaust the **50 external-subrequest** cap. `env.AI` is an **internal Cloudflare-services** call (the **1,000**/invocation bucket, shared with D1), a different budget entirely — so the reconcile coexists with the flyer in one tick without competing for the 50. It is also far lighter than the flyer it rides beside: embedding **batches** (`embedTexts` = one subrequest for a whole chunk, where each Kroger term is an irreducible separate fetch) and is **change-driven** (the hash gate ⇒ steady-state ≈ 0 work). It still **bounds work per tick** (`RECONCILE_MAX_PER_TICK`, deferring the rest to later ticks) — for the 1,000 cap, Workers AI's own rate limit, and tidy wall-clock — keeping the flyer's bounded-batch discipline under the **one** cron trigger.
- **Separate table, not a `recipes` column.** The vector has a different producer and cadence than the rest of the row (cron-reconciled vs build-projected); a sibling table keyed by `slug` lets each rebuild independently, so the build's wholesale `DELETE FROM recipes` + re-INSERT can't clobber a vector it doesn't own. Search JOINs the two — facet-prefilter on `recipes`, cosine over the joined vectors. The cost is a bounded reconcile lag: a just-imported recipe is unembedded until the next tick (treated as "not yet indexed," not an error).

## Background-job health

The two crons (flyer warm, recipe-embedding reconcile) and the inbound `email()` handler are the system's **background processes** — they run with no user attached, so a failure has no in-band consumer (every synchronous tool failure surfaces to the user via Claude.ai; a 3am cron failure surfaces to no one). And the platform won't fill the gap: Cloudflare Cron Triggers have no retries and no failure alerts. The keystone failure — *a stopped job emits nothing* — is only detectable from **outside** the Worker.

- **Each background job writes a `health:job:<name>` record** to KV per run (`{ ok, last_run_at, summary }`, tenant-data-free). The flyer warm, the recipe-embedding reconcile, and the email handler are the registered jobs (`HEALTH_JOBS`); a future cron rides the same convention with no new wiring. Both crons share the one trigger and each writes its **own** record, so `/health` shows them independently even though one tick drives both.
- **`/health` aggregates them** on the **fetch** path — deliberately, because `fetch` is independent of `scheduled`, so the endpoint stays answerable when the cron is dead, and an external monitor catches a stopped job via stale `last_run_at`. It is token-gated (`HEALTH_TOKEN`; 404 when unset) and aggregate-only (no per-tenant data; 200 when ok, 503 when a job is failing).
- **The Worker stays alerting-agnostic** — it *emits* truthful state; *what is alarming and who to notify* lives in an external monitor (point it at `/health`, route to ntfy). The one in-Worker exception is an **optional** secret-gated ntfy push (`NTFY_URL`) — a failure-domain-independent backstop that fires from the edge even if the operator's monitor is offline. Both default off; unset means `/health` is disabled and no push, i.e. unchanged behavior.
- **`scheduled()` rethrows** a failed tick (cron is not retried) so Cloudflare's native Cron-Events status reflects failures rather than always-green. Rich diagnosis lives in Workers Logs — queryable via the Cloudflare Workers Observability MCP.

## Discovery and disposition

Every menu request surfaces a small number of new items the user hasn't taken a position on, drawn from three sources:

- **RSS** (`fetch_rss_discoveries`) — recipe candidates from trusted blogs in `feeds.toml`, scored against the taste profile.
- **Newsletter email** (optional) — a *push* source that reaches the bot-walled/paywalled sites RSS can't. The Worker exports an `email()` handler; Cloudflare Email Routing points a forwarder address at it. Emails are captured (body text, not pre-extracted URLs) in the shared `discoveries_inbox.toml`; the agent scans each body for recipe links at menu time via `read_discovery_inbox`. See [`SELF_HOSTING.md`](SELF_HOSTING.md) step 9.
- **Kroger flyer** (`kroger_flyer`) — ready-to-eat candidates ride the flyer scan.

New items persist in **`draft` state immediately**, not gated on the user expressing interest at proposal time — they often won't have an opinion then but might later ("actually, add that Serious Eats one"). Drafts are de-prioritized in later menu generation but remain available. Disposition is conversational: a rating/like → `active`; an explicit no → `rejected` (kept for de-dup); silence → stays draft.

## Indexes and validation

A GitHub Action regenerates derived data on every push to the data repo's `recipes/**`:

- **The D1 `recipes` table** — the recipe index, the shared objective projection of all recipe frontmatter (no per-tenant `status`/`rating`/`last_cooked`). `build-indexes` validates `recipes/*.md` and **projects** the set into D1, replacing the table wholesale in one transaction (`DELETE` + batched `INSERT`) — a *derived* projection rebuilt on every recipe push, so there is **no data backfill** (contrast *authored/operational* data, which needs a one-time `.mjs` migration — see the `cooking_log` table below). The Worker reads it from D1 (`src/recipe-index.ts`) and filters in memory; discovery's source-URL idempotency check is an indexed lookup (`idx_recipes_source_url`). This replaces the former `_indexes/recipes.json` + KV `index:recipes` (retired by `d1-recipe-index`). Recipe *content* (`recipes/*.md`) stays in git — only the derived index moved.

- **The D1 `cooking_log` table** — per-tenant realized cook history (`d1-cooking-log`), the last per-tenant volatile artifact to leave GitHub. Unlike the derived `recipes` index, this is **authored** data, so it shipped with the first one-time **data backfill** (`migrations/0002-cooking-log-d1.mjs` over the foundation's `.mjs`+`d1` runner: read each `users/<username>/cooking_log.toml` from the checkout → INSERT rows, delete-then-insert per tenant for idempotency). `last_cooked` and `retrospective` are now SQL aggregations (the latter a `cooking_log LEFT JOIN recipes` — the JOIN only possible once the recipe index moved to D1). New events are appended via `log_cooked`, which validates the entry and resolves a recipe slug against `recipes` **at write time** (the validation that was structural-only on `workerd` is now real). The vestigial `cooking_log.toml` files remain in git post-backfill (inert; a later cleanup removes them).

Ready-to-eat is per-tenant and now lives in the D1 `ready_to_eat` table (no aggregate index, no GitHub file); the Worker reads each member's catalog from D1.

The same build runs **validation** over what GitHub still owns: every TOML parses, every recipe frontmatter is well-formed, `pairs_with` references resolve, status values are in the enum, and `stores/` and the discovery files are structurally checked. The D1 profile tables + the D1 session-state tables (`pantry`/`meal_plan`/`grocery_list`) + the D1 `cooking_log` are **not** build-validated — they have no GitHub file to check; the Worker is their sole validator, at write time (`update_preferences`’ merge-patch validation for preferences, `log_cooked` for the cooking log with real recipe-slug resolution against `recipes`). Validation failures fail the Action (red CI) but don't block reads — the Worker keeps reading HEAD. The point is fast feedback, not gating. The Worker reimplements a *structural* subset of this validation in TypeScript for write-time checks (it can't run the Node validator on `workerd`).

A useful side effect: the indexes are a public-ish artifact any tool can consume — `scripts/build-site.mjs` builds a static GitHub Pages cookbook from them with no backend.

## Migrations

**Schema (DDL) → `migrations/d1/*.sql`** is the only standing migration track. Declarative table shape, applied by the Cloudflare-native `wrangler d1 migrations apply DB` (`--local` to seed the dev SQLite, `--remote` on deploy) and tracked in D1's own `d1_migrations` table (created automatically on first apply). The `data-deploy` workflow runs it after `wrangler deploy` + the id pin-back, and before projecting the recipe index. Add a `.sql` file under `migrations/d1/` for a schema change.

**One-time data backfills (retired).** The original KV/GitHub → D1 move was carried by imperative `migrations/*.mjs` backfills, run by a `scripts/run-migrations.mjs` runner and ledgered in a `migrations:applied` **KV** key. Those have been **applied and removed** — there is no `.mjs` data-migration track anymore, and `DATA_KV` (which after the move held only that ledger) was retired with them. The recipe-index projection (`scripts/build-indexes.mjs` → `scripts/d1-rest.mjs`) is the only remaining script that writes D1 from CI, and it is a *rebuild* of a derived table, not a stateful migration. A future data reshape would re-introduce a runner; until then, schema migrations are the whole story.

Rollback is a redeploy of the prior Worker.

## Two surfaces, two instruction files

The same Worker, data, and indexes back two surfaces. What differs is which instruction file each consumes:

1. **Claude.ai (the agent).** [`AGENT_INSTRUCTIONS.md`](../AGENT_INSTRUCTIONS.md) is the canonical source from which the **grocery-agent plugin** is generated (`scripts/build-plugin.mjs` → `npm run build:plugin`). The persona ships as small **library skills** (`grocery-core`, plus `grocery-cart`/`grocery-corpus` depth); each `### ` flow becomes a workflow skill prefixed with a prerequisite line that loads `grocery-core` once per session. The `grocery-mcp` connector is bundled, its URL baked into `.mcp.json` at build time (claude.ai doesn't honor a configurable plugin variable). The version auto-increments as `0.1.<commit-count>`, so claude.ai pulls each new build. Members install from a marketplace — nothing pasted. **Edit `AGENT_INSTRUCTIONS.md` and rebuild; never hand-edit the generated bundle under `plugin/`.**
2. **Claude Code (development).** `CLAUDE.md` is read natively as repo-development context. It does **not** auto-load `AGENT_INSTRUCTIONS.md` — that's the plugin build source, not dev context — but points to it for anyone who needs the persona.

They are deliberately split so the agent persona isn't auto-loaded into a development session and vice versa.

## Security posture

- **The repo is public — but only code lives here.** This repo is the Worker, the agent's persona/skills source, and build tooling; *all* personal data — the operator's included — lives in the **separate private data repo**, under a per-tenant `users/<username>/` subtree (the operator is just another tenant). A public *code* repo collapses the auth story: the MCP read path leaks nothing not already public, so the security boundary moves cleanly to the **write + Kroger** path. The one genuinely-public read surface is the **optional** GitHub Pages cookbook (`scripts/build-site.mjs`), and it publishes only the **shared, objective recipe corpus** (`recipes/*.md`) — never any `users/` subtree, not even the per-tenant `status`/`rating` overlay. Eating habits, grocery cadence, and `preferences.toml`'s `preferred_location` stay private with the rest of each member's state.
- **Secrets never touch the repo.** Because it's public, this discipline is load-bearing: the GitHub App private key and Kroger OAuth tokens live as Cloudflare Worker secrets only (encrypted at rest, never logged, gitignored locally via `.dev.vars`).
- **OAuth protects writes, not reads.** Claude.ai's custom-connector UI requires OAuth (no "no auth" / bearer option), and that OAuth guards the write/cart surface.
- **The cart is write-only.** The Kroger Cart API can add but cannot remove or check out — so the agent literally cannot read the cart or check out for the user. A useful safety property: reconciliation reports what *should* change and tells the user to fix it in the Kroger app, never silently pretends items are gone.

## Tech stack

- **Claude.ai** (web + mobile) — conversational surface, subscription auth, fresh-context conversations.
- **Cloudflare Workers** (TypeScript / `workerd`) — hosts the MCP server + OAuth provider. Free tier handles personal-scale load. **Wrangler** for deploys; **KV** for OAuth/tenant/Kroger token state.
- **GitHub** — code, data, indexes, CI/CD via Actions. Repo I/O via a **GitHub App** installation token.
- **Kroger Developer API** — product search, prices, cart writes (write-only).
- **Pure-JS parsers** that run on `workerd`: `smol-toml`, `js-yaml`, JSON-LD via `HTMLRewriter`, RSS/Atom via `fast-xml-parser`. (No `recipe-scraper`/`cheerio` — they assume Node internals unavailable on `workerd`.)
- **Obsidian** (optional) — mobile recipe viewing during cooking, pointed at a local clone of the data repo.

## What this is — and isn't

A personal automation experiment targeting a real friction point — the time and willpower of grocery planning — tuned to one person's tastes, freezer, and grocer, and shareable with a small friend group. Not a product, not a startup. The architecture is intentionally minimal: Anthropic provides messaging and reasoning, the Worker provides a domain interface, GitHub provides storage and audit history. The data files are inspectable by humans, version-controlled, and outlive the agent if anyone stops using it.
