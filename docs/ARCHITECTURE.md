---
update-when: the system components, determinism boundary, multi-tenant identity, data model, or Kroger matching pipeline change
---

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
│   • corpus store (src/corpus-store.ts) for R2 I/O      │
└─────────────────────┬──────────────────────────────────┘
                      │  R2 corpus bucket + Kroger API
                      ▼
┌────────────────────────────────────────────────────────┐
│  R2 corpus bucket (CORPUS, operator-owned)             │
│   authored markdown corpus (read by all):              │
│     recipes/*.md · guidance/                           │
│   (Obsidian vault syncs to this same bucket, S3-compat)│
└────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────┐
│  KV (Cloudflare KV) — ephemeral infra ONLY:            │
│   KROGER_KV · TENANT_KV · OAUTH_KV.                    │
└────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────┐
│  D1 (Cloudflare SQLite, relational tier)               │
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

- **Claude.ai** is the conversational surface and the reasoning. Each chat starts fresh; state lives in D1 (profile + session state + cooking log + recipe index + attributed records) and the R2 corpus (authored recipes + guidance markdown), not in chat history. The agent reads what it needs through MCP tools at the start of a conversation.
- **The Worker** (this repo, root `src/`) is a Cloudflare Worker hosting the `grocery-mcp` MCP server — the domain tool surface (pantry, recipes, Kroger, cart) — plus an OAuth 2.1 provider members connect their Claude.ai to. It is the locus of determinism and the multi-tenant gate.
- **The R2 corpus bucket** (`CORPUS`, bound to the Worker, operator-owned) holds the human-authored markdown: `recipes/*.md` and the `guidance/**/*.md` umbrella (`ingredient_storage/` + `cooking_techniques/` + `purchasing/`), read/written through `src/corpus-store.ts` (`createR2CorpusStore`: getFile/listDir/list/put/delete) — there is no GitHub App or GitHub API on the data path. Authors edit an Obsidian vault synced to the same bucket over its S3-compatible API. Everything else — profile, session state, shared corpus, cooking log, recipe index, attributed records — is in D1. See [`SELF_HOSTING.md`](SELF_HOSTING.md).

There is no database, no scheduler, no CLI, and no stateful agent runtime — the `agents` SDK is present only for its stateless `createMcpHandler` MCP transport (no Durable Objects, no Workflows). Everything else is glue.

## The determinism boundary

The whole design turns on putting the LLM only where genuinely-fuzzy judgment is needed and keeping everything else as plain deterministic code inside the Worker's tools.

**Three places the LLM earns its keep:**

1. **Message understanding and tool orchestration.** Claude reads the request, decides which tools to call in what order, asks follow-ups, interprets freeform constraints ("comfort food one night," "I'm feeling lazy"). This is Claude's native strength — there is no custom routing logic.
2. **Menu-generation reasoning.** Given assembled context (pantry, flyer, candidates, ready-to-eat, preferences), Claude proposes a plan honoring multiple soft and hard rules. The genuinely-fuzzy step.
3. **Fuzzy-matching fallback** inside the Worker's Kroger pipeline, only when deterministic narrowing leaves ambiguity, plus taste-profile scoring of new discoveries.

**Everything else is deterministic code with no LLM in the loop:** corpus (R2) reads/writes, frontmatter parsing, recipe filtering and scoring, Kroger API calls, RSS/JSON-LD parsing, cart writes, index projection, validation.

The MCP tool boundary is where this is enforced. Tools are **coarse and opinionated** — they wrap multi-step pipelines so the LLM can't bypass them. Raw building blocks (`kroger_raw_search`, `corpus_raw_write`, `cart_add_by_name`) are deliberately **not** exposed, because they would let the LLM skip the cache, the validation, or the SKU-matching pipeline. See [`TOOLS.md`](TOOLS.md) for the design philosophy and the full inventory.

**The deeper pattern — capture → retrieve → narrow.** Where the system needs LLM-derived *knowledge* (not just orchestration), it does not re-derive it on every read; it **captures** the model's judgment once into persistent data, **retrieves** it deterministically, and lets the LLM **narrow** with live context. Recipe import already works this way: Claude classifies `protein` / `cuisine` / `perishable_ingredients` / `course` once at import (capture), the scheduled projection (`src/recipe-projection.ts`) reads the R2 corpus and projects them into the D1 `recipes` table and `search_recipes` filters them (retrieve), and menu-gen reasons over the filtered set (narrow). The LLM sits at the two ends — the one-time capture and the contextual narrowing — while determinism owns the middle (identity, indexing, lookup) and the gates (validation). Caching beats re-reasoning at scale because the hot path stays deterministic, reserving the model for genuine novelty and genuine judgment — which is also what keeps the agent viable on a smaller, faster model. **The same pattern also runs on a schedule:** a cron-driven sweep warms a per-store Kroger *flyer* into KV (capture), `kroger_flyer` reads that rollup (retrieve), and menu-gen reasons over it (narrow) — keeping the multi-second sale fan-out off the agent's hot path and under the free-tier per-request subrequest cap (a synchronous tool call has one invocation's budget; a background sweep has unlimited invocations over time). See *the flyer warm* below.

**Direction — thin tools, recipe-side retrieval, LLM reasoning.** The scaling pressure is on the recipe side, and it's already solved there: recipes are first-class entities with captured metadata and an index, and you never reason over the whole corpus at once — `search_recipes` (membership filtering plus, in ranked mode, semantic retrieval) with the makeability gate and each member's **rejects** narrows it to a small candidate set that loads into context. So the system leans into LLM reasoning at the *narrow* end (substitution, freshness, pantry matching, the to-buy list — all read-time over the loaded pantry + chosen recipes) and keeps deterministic *retrieval* only over what's unloadable (the Kroger catalog) or large (the corpus index). Tools shrink — `substitutions.toml`/`propose_substitutions` and `verify_pantry` (with its recipe-ingredient parser) fall out — and the reasoning moves into the skills. The realized lever is **recipe faceting**: an open-vocabulary `course` field (`main | side | dessert | breakfast | …`, classified at import, shape-validated only — no controlled set) so one faceted `search_recipes` call returns the available mains+sides with metadata and `meal-plan` reasons holistically over the whole plate (menu + sides + expiry-matching + pantry subs) before cost/confirm. Sides are **two-tier**: corpus sides (`course: side` recipes, remembered in `pairs_with`) and **open-world** sides (trivial preparations with no recipe file) that ride on the main's `meal_plan` row and flow to the cart by world-knowledge ingredient enumeration. Whether a main needs a side is inferred in that same pass. Ingredients stay strings; the `aliases` table stays as the matcher's small normalization table. A self-growing *ingredient knowledge graph* was considered and deferred (the feature that justified it — expiry-driven cooking — is read-time-solvable). See [`adr/0001-determinism-boundary-capture-retrieve-narrow.md`](adr/0001-determinism-boundary-capture-retrieve-narrow.md) for the decision, the locked choices, the deferred graph, and the rollout (the `thin-pantry-and-substitution-path` change is Phase 0).

## Multi-tenant identity

One self-hosted Worker serves a small friend group; each member connects their own Claude.ai. The code is a separate upstream self-hosters deploy without forking. The R2 corpus bucket (`CORPUS`) holds the authored corpus (`recipes/*.md`, `guidance/**/*.md`); all operational data (profile, session state, cooking log, shared corpus, recipe index) lives in D1, tenant-isolated by the `tenant` column.

- **OAuth 2.1 provider.** Claude.ai custom connectors authenticate via OAuth, so the Worker hosts an OAuth provider (`@cloudflare/workers-oauth-provider`, KV-backed — no SQL). `src/index.ts` constructs the provider; `src/authorize.ts` renders the invite-code consent page.
- **Identity is an operator-issued invite code** against a curated allowlist — members need no GitHub account. The issued access token's grant carries the member's `tenantId`.
- **"Which tenant" is a D1 column.** Per-tenant data is isolated by the `tenant` column on every D1 table. Each request resolves token → tenant *before* any tool runs, so no tool can reach another member's data.
- **The authored corpus is the R2 `CORPUS` bucket**, bound to the Worker and read/written through `src/corpus-store.ts` — no credential, GitHub App, or installation token on the data path. The bucket is shared by the friend group (the corpus is single-source, read by all); per-tenant data never lands in R2.
- **Kroger split:** `client_credentials` product/price reads are shared at the app level; cart writes use a **per-tenant** `authorization_code` refresh token (`kroger:refresh:<tenant>`). The product/price client bounds its own concurrent in-flight requests to a small fixed cap (default 6), so fan-out callers (`kroger_prices`, the background flyer warm, etc.) use plain `Promise.all` — the cap prevents 429 storms without callers needing a concurrency primitive.
- **Shared flyer cache (the one deliberately cross-tenant data plane).** The warmed Kroger flyer is keyed by `locationId` (`flyer:{locationId}` in `KROGER_KV`), so tenants at the **same store share one rollup** and tenants at **different Krogers get independent ones**. This is the single shared data-plane cache; everything else is strictly per-tenant. It is sound because store-wide sale prices are **public-derived, not tenant-private** — no member's state leaks. The cron sweep that fills it (`src/flyer-warm.ts`) runs *without* an OAuth session, so it enumerates the tenant directory and reads each tenant's D1 `profile` row for its `preferred_location`.

A **solo operator** is simply the degenerate case: one tenant.

### Operator admin surface

Member lifecycle — **onboard / revoke / rotate-invite / list** — is an **in-Worker** operator surface at `/admin`, not a GitHub Action. A static **Elm** SPA (authored under `admin/src/`, built by `scripts/build-admin.mjs` into the committed `admin/dist/`, served via the Workers `assets` binding) calls a same-origin `/admin/api/*` JSON surface that writes the `TENANT_KV` allowlist + `invite:*` codes and purges per-tenant D1 through `src/db.ts` directly. It is the **4th surface that runs with no per-tenant OAuth session** (alongside the two crons and `email()`): deliberately cross-tenant, gated instead by **Cloudflare Access** on `/admin*`. The Worker verifies the injected `Cf-Access-Jwt-Assertion` (signature via the team JWKS + audience) as defense-in-depth and sets `workers_dev:false` to close the `*.workers.dev` bypass; the surface is **opt-in** (404 when `ACCESS_TEAM_DOMAIN`/`ACCESS_AUD` are unset). Two further guards close the "mis-set-up Access" gaps: an optional `ACCESS_ALLOWED_EMAILS` allowlist re-checks the verified `email` claim (so a too-loose Access policy or a wrong `ACCESS_AUD` can't admit a stranger), and the local-dev bypass (`ADMIN_DEV_BYPASS`) only engages on a **loopback** host so it is inert on any deployed Worker — and `/health` surfaces the gate posture, screaming `exposed` (→ 503 / red badge) if a deployment ever leaves that bypass as the surface's only safeguard. This is what keeps the minted invite code out of any git-hosted log — it is shown **once** in the authenticated UI. The carve-out is surface-specific: the **MCP** surface keeps its own OAuth provider (Access is not its identity), consistent with multi-tenancy's "no Access on the MCP-surface identity." Revoke is **complete**: it scans `invite:*` to delete the member's code(s) without one being pasted, and deletes the per-tenant `kroger:refresh:<id>` token. The `assets` binding is on the deploy-merge allowlist (like `ai`), or it would be silently dropped from operator deploys.

The SPA is **client-routed** (`Browser.application`): top-level areas — a **Status** home area (the `/health` service-health view: jobs, D1, admin-gate posture), a **Members** area (member management), and a **Dev** area (the **MCP tool console**) — each a routed page so the panel grows by adding pages, not cards. The home route `/admin` is the Status view; member management lives at `/admin/members`. Because `/admin*` is routed worker-first, the Worker serves the SPA shell (the committed `index.html`) for any `/admin/*` GET that maps to no asset, so client routes deep-link and survive refresh (it fetches the canonical `/admin/` rather than redirecting, avoiding a `run_worker_first` loop). The **tool console** (`src/admin-tools.ts`, behind `/admin/api/tools`) lets the operator inspect and invoke the full MCP tool surface **as a chosen tenant** — the cross-tenant admin identity (Access) standing in for an MCP OAuth token. It is faithful by construction: it builds the **same** per-tenant server `/mcp` builds (`buildServer`) and drives it over the SDK's in-memory transport, so the catalog (`tools/list`) and every invocation hit the identical Zod validation and structured-error serialization a real client does — no tool is reachable that `/mcp` doesn't expose, and no input validation is bypassed. This deliberately widens operator reach (read any member's data; fire real write tools as them), which is why safety rides the **persona axis**: the console shows the acting-as member and confirms before running as a real one (a `test-`/`sandbox-` persona is a throwaway and skips the confirm). The tool **contract** is unchanged — the console is a pure consumer of the live `tools/list`, so `docs/TOOLS.md` is unaffected.

## The data model

D1 plus the R2 corpus is the system's memory. It splits two ways — shared vs per-tenant — and within a tenant, into a small set of intents that must not be conflated. Field-level schemas live in [`SCHEMAS.md`](SCHEMAS.md); this is the conceptual map.

### Storage tiers (the three-tier boundary)

Per `cloudflare-storage-architecture`, persistent state lives across three tiers chosen by the *nature* of the data, not by convenience:

- **R2** (`CORPUS`) — authored **markdown** only: `recipes/*.md` (recipe *content*) and the `guidance/**/*.md` umbrella (`guidance/ingredient_storage/` — curated, read-only put-away advice; `guidance/cooking_techniques/` — agent-writable technique memories; `guidance/purchasing/` — agent-writable buy-side selection advice; the writable two go through `save_guidance`). The source of truth for the human-authored corpus, read/written through `src/corpus-store.ts` and hand-edited via an Obsidian vault synced to the same bucket over R2's S3-compatible API. This is the one tier a human edits directly; everything else (shared corpus, attributed notes, profile, session, cooking log, recipe index) is D1. Git history for the corpus is a deliberately-accepted loss of this move off GitHub.
- **D1** (`env.DB`) — all **domain/operational data and derived projections**: the queryable, relational, admin-editable, strongly-consistent (read-after-write) tier. The recipe index, profile, session state, cooking log, notes, registries, config, caches, and the `reconcile_errors` + `bug_reports` tables land here. Tools never touch `env.DB` directly — they go through `src/db.ts` (prepared-statement helpers + structured-error mapping; tools never throw).
- **KV** — **ephemeral infrastructure only**, no domain data: `KROGER_KV` (Kroger tokens, PKCE verifiers, the TTL flyer cache, background-job health), `OAUTH_KV` (OAuth provider state), `TENANT_KV` (tenant directory / invites). The Worker binds only `KROGER_KV`, `TENANT_KV`, and `OAUTH_KV`.

### Shared vs per-tenant

- **Shared corpus (D1)** — objective, single-source, read by everyone: `aliases`, the location-tagged `sku_cache`, `stores` (registry identity), `flyer_terms`, and the discovery sources (`feeds`, `discovery_candidates` inbox, `discovery_senders`/`discovery_members` allowlist, and `discovery_rejections` — the group-wide suppression set). Written + validated at the Worker write tools, read by query. (The curated `guidance/**/*.md` umbrella stays R2 markdown.) The recipe index is the derived D1 `recipes` table.
- **Attributed records (D1, `recipe_notes` / `store_notes`)** — each member's attributed recipe/store notes, in D1 tables with an `author` column + `private` flag (own-private + group-shared at read time). No per-tenant domain data lives in R2.
- **Per-tenant D1 (session state)** — each member's working state in D1 row tables: `pantry`, `meal_plan`, `grocery_list` (keyed by normalized name or recipe slug). Adds are row upserts, removes/status changes are targeted row statements — strong read-after-write consistency, no whole-array rewrite. The Worker read path has **no** GitHub/KV fallback (a miss returns empty).
- **Per-tenant D1 (records + profile)** — the relational tier. The `cooking_log` table is per-tenant realized cook history; the `recipes` table is the shared objective recipe index; the **profile** tables (`profile`, `brand_prefs`, `kitchen_equipment`, `staples`, `overlay`, `ready_to_eat`, `stockup`) hold each member's preferences/taste/diet/kitchen/staples/overlay/ready-to-eat/stockup. Tenant-scoped on every read; written via `log_cooked` (cooking events — which also clears the cooked recipe from `meal_plan` in the **same transaction**), the scheduled recipe-index projection, the profile write tools, and the session-state tools (`update_pantry`, `update_meal_plan`, `add_to_grocery_list`, …).

### Three-category recipe model

A recipe splits three ways so a shared corpus is safe to share:

- **Content** — objective frontmatter + body, shared and single-source.
- **Overlay** — the caller's two mutually-exclusive disposition marks `favorite` (loved) + `reject` (hidden-from-me), per-tenant in the D1 `overlay(tenant, recipe, favorite, reject)` table. One member's disposition never changes another's. Visibility is **opt-out**: a recipe with no overlay row is **neutral (available)**, so the candidate set is the whole shared corpus minus the caller's rejects. `reject` is a **hard gate** — a rejected recipe is dropped from that member's `search_recipes` results entirely (both membership and ranked modes). The group-favorites signal (`read_recipe_notes`) is a single indexed query — `SELECT tenant, favorite FROM overlay WHERE recipe=?` scoped to the caller's group, counted.
- **Notes** — per-tenant, attributed, append-mostly (D1 `recipe_notes` table, keyed by `(tenant, recipe)`).

`last_cooked` is **not stored** — it's derived per-tenant from that member's D1 `cooking_log` rows (`MAX(date)` per recipe). Read tools merge shared content + the caller's overlay + cooking-log `last_cooked` at read time; the shared D1 `recipes` table carries objective fields only.

**Notes are the spin-capture mechanism that makes sharing safe.** A tweak ("sub gochujang for the sriracha") is an attributed note, never an edit to shared content; only a genuinely *different dish* warrants importing as a separate corpus recipe. The shared body changes only for an objective correction. Group notes/favorites aggregate across members at read time (`read_recipe_notes`).

### The intent model (per-tenant)

Five intent kinds — don't conflate them:

| Key / backing | Kind of intent |
| --- | --- |
| `pantry` (D1, tenant-scoped) | **observation** — what's physically in the kitchen |
| `stockup` (D1, tenant-scoped) | **conditional intent** — buy IF it drops below a threshold |
| `grocery_list` (D1, tenant-scoped) | **committed buy intent** — buy on the next order (ingredient-level, SKU-free) |
| `meal_plan` (D1, tenant-scoped) | **committed cook intent** — recipes agreed to cook next (transient) |
| `cooking_log` (D1, tenant-scoped) | **realized history** — append-only log of meals actually cooked |

D1 row tables are freely mutable with strong read-after-write consistency (appropriate for operational data); the `cooking_log` D1 table is the durable, queryable cook history (`id`-addressable, read-after-write consistent). The agent **captures intent into the grocery list continuously**, and **flushes to the cart once**, at order time. Capture is store-agnostic (the list is SKU-free); the flush is not.

### The flush branches (`shop-groceries`)

Capture is identical regardless of where the user shops; only the flush differs, detected by the `shop-groceries` skill from the D1 `profile` row's `stores.primary` preference and trip context:

- **Kroger online** (`primary: kroger`, no in-store trip) — `place_order` resolves the whole D1 `grocery_list` against current Kroger availability, surfaces ambiguous/unavailable items as one batch, writes the Kroger cart, and appends learned SKU mappings to the D1 `sku_cache`. D1 is the mutable store (capture continuously); the cart is append-only (flush once).
- **Kroger in-store** (`primary: kroger` + in-store trip, or named Kroger location) — uses the Kroger Products API's `aisleLocation: { number, description, side? }` field (returned by `kroger_prices`) to order the list by aisle number automatically — no pre-mapped layout required. After the first visit, the store's slug and Kroger `locationId` are registered in the D1 `stores` table (`location_id` field); `resolveLocationId` in `src/kroger.ts` detects a no-space `location_id` string and returns it directly, bypassing the Locations API on every subsequent walk. Items with `inStore: false` are surfaced before the walk (not silently dropped); `location`-tagged store notes are seeded silently and idempotently after each walk.
- **In-store walk** (`primary` is a non-Kroger store slug, or named non-Kroger store) — reads the same list and groups it for the store, walked hands-free one aisle at a time. Degrades gracefully: no map → a department-grouped list from world knowledge; a mapped store → aisle-by-aisle from its `layout` notes, with `location` notes pinpointing the tricky items. On completion, picks received directly from `active` (no `in_cart`/`ordered` stage) — removing them and restocking the pantry, the same end-state as a Kroger pickup. A first visit to an unmapped store offers to record the layout (as `layout`-tagged store notes) *while* shopping.

The D1 `stores` table holds store **identity** per *location*, including the optional `location_id` (chain-specific external id — for Kroger, the `locationId` that bypasses the Locations API); the **layout** lives in attributed per-tenant D1 `store_notes` rows — aisle order (`layout` tag), where-it-hides hints (`location`), and not-carried entries (`stock`) — so mapping a store once helps the whole group, and an author can correct their own notes (`update_store_note` / `remove_store_note`). Each grocery-list item carries a `domain` facet (default `grocery`) so a non-grocery run (e.g. Lowe's) filters the list for free.

## Kroger product matching (ingredient → SKU)

The hardest deterministic problem: turning a recipe ingredient string ("extra virgin olive oil, 1 tbsp") into a specific Kroger SKU. It lives entirely inside `match_ingredient_to_kroger_sku`. The pattern is **progressive deterministic narrowing, with LLM fallback only when ambiguity remains.**

1. **Normalize** — strip quantity/units, lowercase, apply the D1 `aliases` table. Alias-driven, *not* an aggressive qualifier-stripper: the `aliases` table is the curated source of truth for which variants collapse to which canonical term.
2. **Cache lookup → revalidate** — if a normalized term → SKU mapping exists in the D1 `sku_cache`, take that SKU and revalidate it with one targeted lookup (current price + curbside/delivery availability at the preferred location). Available → use it with fresh price/promo; unavailable → treat as a miss and fall through to search (self-healing). Every hit is revalidated, so there is no TTL. The cache short-circuits the expensive search, not the price check. The LLM may pass `bypass_cache` when a cached generic doesn't fit the recipe context.
3. **Kroger search** — `filter.term` + `filter.locationId` (+ fulfillment) → candidate products with price, size, brand, `aisleLocation`, and `inStore`. `resolveLocationId` is called to resolve the `locationId` from the user's `preferred_location` label — if the D1 `stores` row has a `location_id` with no spaces, it is treated as an already-resolved `locationId` and returned directly without a Locations API round-trip.
4. **Score candidates** (rule-driven scoring, *not* hard filters) — brand preference from the D1 `brand_prefs` rows; dietary as a soft score. Two near-hard constraints govern *which product*: **availability** (must be fulfillable via curbside/delivery) and **identity relevance** (how many query tokens appear in the product description/categories). A confident pick comes only from the top relevance tier, so "anaheim peppers" resolves to the Fresh Anaheim Peppers PLU, never a cheaper unrelated fulfillable item. If nothing shares any query token, the matcher returns ambiguous rather than guess. Scoring (not filtering) means a missing preferred brand can't empty the set. This step does **not** substitute.
5. **Deterministic tiebreaker** (within the top-scoring set) — prefer on-sale, then best price-per-unit (deterministic arithmetic; the LLM only normalizes messy size strings, never does the math); "don't care" commodities take the smallest package covering the quantity hint, then cheapest.
6. **Confidence gate → LLM only when ambiguous** — **confident** (auto-pick): a cache hit, or a defined brand preference resolves it (including `[]` = "don't care, cheapest acceptable"). **Ambiguous**: no cache hit *and* no defined brand preference → return narrowed candidates and let Claude pick from context or ask.
7. **Cache result** (persisted at order time) — the resolved mapping is upserted into the D1 `sku_cache`; the matcher itself only resolves, and the cache write rides `place_order`'s flush.

**Confidence is legible and self-extinguishing.** It comes entirely from the D1 `brand_prefs` rows, which are **tri-state**: row absent → ask; `[]` → "don't care," cheapest acceptable; `["A","B"]` → ranked preference. Every answered question caches, so it asks less over time — after a few weeks of use, most common ingredients are cached and never hit the LLM. **Substitution is a separate, confirmed step** — LLM reasoning, not a tool: inventory subs are judged over the loaded pantry, sale/unavailable subs are enumerated from world knowledge and resolved as ordinary Kroger searches, and either is surfaced for the user to confirm. The matcher itself never substitutes. Quantity translation is intentionally coarse ("3 cloves garlic" → buy a bulb); pantry tracking absorbs the slack.

## The flyer warm (scheduled capture)

The public Kroger API has no flyer/circular endpoint, so the "what's on sale" list is **synthesized** by searching curated broad terms (the D1 `flyer_terms` table) and keeping the genuine discounts. Doing that live inside `kroger_flyer` fanned one search per term and ran into the Cloudflare Workers **free-tier cap of 50 external subrequests per invocation** as the term set grew — plus multi-second latency on the user's hot path. So the fetch runs in a scheduled **cron** (`src/flyer-warm.ts`, the `scheduled()` handler in `src/index.ts`), and `kroger_flyer` is a pure KV read.

- **One trigger, a cursor sweep.** A single cron fires on a short cadence (every few minutes). Each tick reads a small `flyer:cursor`, processes the **next bounded batch** of `(location, term)` units (sized to stay under the 50-subrequest *and* ~10ms-CPU per-invocation caps), advances the cursor, and **no-ops** once the sweep is complete — until the daily refresh window re-arms it. The total term set is unbounded: more terms just mean more ticks, never a bigger invocation. The murky free-tier cron-*count* limit never bites because there is exactly one trigger.
- **Plan built once, persisted.** Enumerating the work (the tenant directory + each tenant's D1 `profile` row + the D1 `flyer_terms` rows) happens **once at sweep start** and the plan is persisted in `flyer:plan`; every later tick reads the plan from KV (a CF-services read, not an external subrequest) and spends its budget only on Kroger scans.
- **Per-location rollup, noise floor at warm / deal floor at read.** Results are materialized as one `flyer:{locationId}` rollup of fulfillable, on-sale candidates (raw `regular`/`promo` kept). `kroger_flyer` applies the caller's `min_savings_pct` at read, so the deal threshold stays tunable without a re-fetch. A cold cache reads as empty (graceful), and an `as_of` timestamp conveys age — staleness is low-stakes because the order path re-prices live.

## The recipe-index projection (scheduled capture)

With the corpus in R2, the recipe **index** is projected by the Worker on a schedule: a job in the `scheduled()` handler (`src/recipe-projection.ts`, `runProjectionJob`) that holds the whole corpus each pass.

- **Whole-corpus read, validate, project.** Each tick reads the **entire** R2 corpus through `src/corpus-store.ts`, validates every recipe — the shared `recipe-contract.js` required-field/vocab contract, the body `## Ingredients` / `## Instructions` sections, a duplicate-slug guard, and **cross-corpus `pairs_with` slug resolution** (possible because the reconcile holds the whole corpus at once) — then rebuilds the D1 `recipes` table **wholesale** (`DELETE` + batched `INSERT` in one D1 transaction). A *derived* projection, rebuilt each pass, not a stateful migration.
- **Invalid recipes are skipped, not fatal.** A recipe that fails validation is **left out of the index** (not committed) and recorded to the D1 `reconcile_errors` table, so one malformed file can't break the whole rebuild. This is the system's eventual-consistency model — see *eventual human-edit feedback* below.
- **Runs before the recipe-derived reconcile** so that pass reads a fresh index; the flyer warm is independent of the index and runs alongside. A `recipe-index` health job reports the run (its skipped-invalid count in the `summary`).

## The recipe-derived reconcile (scheduled capture)

The same `scheduled()` handler runs a **third** job each tick (`src/recipe-embeddings.ts`), reconciling the `recipe_derived` table (migration 0013) in **two passes**. The **placement rule** behind it: a recipe field lives in frontmatter only if a human authors or corrects it; a purely-derived, regenerable field lives in D1. The `description` is exactly that — AI-written, not authored — so it leaves frontmatter for the reconcile-owned `recipe_derived` table, co-located with the embedding it feeds (the two derived halves of one artifact, one producer, one cadence, one `slug` key).

- **(1) Describe.** Generate the `description` from the recipe's authored **facets** (title, ingredients_key, course, protein, cuisine, time_total, dietary, season) via `env.AI`, gated by a `content_hash` over those facets — pure D1 + AI, **no body read**. Steady state ≈ 0 work.
- **(2) Embed.** Embed any description whose vector is new/changed (a `description_hash` gate) and prune rows whose slug no longer exists in `recipes`. A freshly-described recipe flows into the embed pass the same tick.

Both passes need `env.AI`, so they run Worker-side. The `description` is also **seeded synchronously at import** (`create_recipe`) so a new recipe reads well before the next tick (the reconcile stays the authority and refreshes on a facet change). This is *capture → retrieve → narrow*: capture the description + embedding once, `search_recipes` (ranked mode) retrieves by cosine, the planning skill narrows.

- **It is *not* the flyer's free-tier problem — a different subrequest budget.** The flyer became a cron because Kroger fetches exhaust the **50 external-subrequest** cap. `env.AI` is an **internal Cloudflare-services** call (the **1,000**/invocation bucket, shared with D1), a different budget entirely — so the reconcile coexists with the flyer in one tick without competing for the 50. It is also far lighter than the flyer it rides beside: embedding **batches** (`embedTexts` = one subrequest for a whole chunk, where each Kroger term is an irreducible separate fetch) and is **change-driven** (the hash gate ⇒ steady-state ≈ 0 work). It still **bounds work per tick** (`RECONCILE_MAX_PER_TICK`, deferring the rest to later ticks) — for the 1,000 cap, Workers AI's own rate limit, and tidy wall-clock — keeping the flyer's bounded-batch discipline under the **one** cron trigger.
- **Separate table, not a `recipes` column.** The vector has a different producer and cadence than the rest of the row (the recipe-derived reconcile vs the recipe-index projection, though both run Worker-side in `scheduled()`); a sibling table keyed by `slug` lets each rebuild independently, so the projection's wholesale `DELETE FROM recipes` + re-INSERT can't clobber a vector it doesn't own. Search JOINs the two — facet-prefilter on `recipes`, cosine over the joined vectors. The cost is a bounded reconcile lag: a just-imported recipe is unembedded until the next tick (treated as "not yet indexed," not an error).

## Semantic recipe selection

Recipe **selection** is the retrieval analog of the classify-once pattern above. Instead of loading the whole corpus into the model and reasoning over it ("dump-and-reason"), the meal-plan flow **distills** the request into a few search specs, **retrieves** by meaning, and **composes** the plan from the much smaller returned set. A vibe-bearing `search_recipes(specs[])` spec is the retrieve leg: per spec it **facet-prefilters** the index (the same `filterRecipes` gate the membership mode uses — diet, makeability, anti-recency), then **cosines** the query embedding against the surviving recipes' vectors, then **re-ranks** with two small Worker-side nudges — *nearest-liked* (max cosine to a favorited recipe; taste **direction**) and *freshness* (never-cooked up, recently-cooked down; **rotation**, tuned by the `rotation` preference). Hard constraints stay in the prefilter, so semantic rank only reorders survivors — it can never admit a recipe a gate rejected.

**The determinism boundary doubles as a token boundary.** The embedding and the cosine run *in the Worker*, not the model: the skill ships a **query string**, never vectors, and gets back **compact candidate rows** (`slug`, `title`, the ~60-token `description`, key facets, score) rather than the full metadata of the whole corpus. So the same boundary that keeps the hot path deterministic also bounds the *token* cost of selection — it scales with the number of specs and K, not with corpus size. The AI-written `description` is the linchpin: generated by the reconcile into `recipe_derived` (and seeded at import), it is simultaneously the embed source, the compact per-candidate context rep, and the user-facing "why this dish."

**Brute-force cosine over a D1 column, not Vectorize — a measured, deferred promotion.** The vectors live in the reconcile-owned `recipe_derived` table; retrieval loads them through the Worker and cosines the facet-prefiltered survivors. At friend-group scale (hundreds, low-thousands of recipes) this is **exact** (not ANN-approximate) and a single store — Vectorize's sub-linear ANN, server-side metadata filter, and managed scale buy nothing yet while costing a second, eventually-consistent copy to keep in sync. The contract is **backend-agnostic** (`search_recipes(specs) → ranked slugs + score`), so the swap is a tool-internal change skills never see. **Promote when *measured*:** a search that is measurably slow, OR loading embeddings through the Worker getting heavy (≈ low-thousands × 768 × 4 B). Runway before that bites: **int8-quantize** the stored vectors, or only ever cosine the **facet-prefiltered** subset (already the design). The written-down trigger keeps the decision data-driven, not guessed.

The three crons (flyer warm, recipe-index projection, recipe-derived reconcile) and the inbound `email()` handler are the system's **background processes** — they run with no user attached, so a failure has no in-band consumer (every synchronous tool failure surfaces to the user via Claude.ai; a 3am cron failure surfaces to no one). And the platform won't fill the gap: Cloudflare Cron Triggers have no retries and no failure alerts. The keystone failure — *a stopped job emits nothing* — is only detectable from **outside** the Worker.

- **Each background job writes a `health:job:<name>` record** to KV per run (`{ ok, last_run_at, summary }`, tenant-data-free). The flyer warm, the recipe-index projection (`recipe-index` — its `summary` carries the skipped-invalid count), the recipe-embedding reconcile, and the email handler are the registered jobs (`HEALTH_JOBS`); a future cron rides the same convention with no new wiring. The three crons share the one trigger and each writes its **own** record, so `/health` shows them independently even though one tick drives all of them.
- **`/health` aggregates them** on the **fetch** path — deliberately, because `fetch` is independent of `scheduled`, so the endpoint stays answerable when the cron is dead, and an external monitor catches a stopped job via stale `last_run_at`. It is **open and tenant-clean** (no per-tenant data; the D1 probe is coarsened to a boolean so no raw `storage_error` string leaks; 200 when ok, 503 when a job is failing). The payload also carries the **admin gate posture** as tenant-clean booleans (`access_configured` / `email_allowlist` / `dev_bypass_set` / `exposed`, never the allowlisted emails), computed from the same gate logic `requireAccess` uses; an `exposed` gate (dev bypass set without Access) degrades overall health (503 / red badge), the loud backstop for a mis-set-up deployment. The payload carries nothing secret, so restricting *who* may read it is an **edge** concern (Cloudflare Access / WAF), not Worker code — the same "emit truthful state, decide policy outside" stance as the alerting. A sibling **`/health.svg`** renders the same payload as a README status-badge card — **also open** (a public README badge must be anonymously fetchable), always 200 + `image/svg+xml` so an image proxy renders it (degraded shows by color), stamped into the data-repo README by the deploy. (There is no `HEALTH_TOKEN` — health is non-sensitive, so both endpoints are public and the badge is a normal anonymous badge URL.)
- **The Worker stays alerting-agnostic** — it *emits* truthful state; *what is alarming and who to notify* lives in an external monitor (point it at `/health`, route to ntfy). The one in-Worker exception is an **optional** secret-gated ntfy push (`NTFY_URL`) — a failure-domain-independent backstop that fires from the edge even if the operator's monitor is offline. Both default off; unset means `/health` is disabled and no push, i.e. unchanged behavior.
- **`scheduled()` rethrows** a failed tick (cron is not retried) so Cloudflare's native Cron-Events status reflects failures rather than always-green. Rich diagnosis lives in Workers Logs — queryable via the Cloudflare Workers Observability MCP.

## Discovery and disposition

Every menu request surfaces a small number of new items the user hasn't taken a position on, drawn from three sources:

- **RSS** (`fetch_rss_discoveries`) — recipe candidates from trusted blogs in the D1 `feeds` table, scored against the taste profile.
- **Newsletter email** (optional) — a *push* source that reaches the bot-walled/paywalled sites RSS can't. The Worker exports an `email()` handler; Cloudflare Email Routing points a forwarder address at it. Emails are captured (body text, not pre-extracted URLs) in the D1 `discovery_candidates` table; the agent scans each body for recipe links at menu time via `read_discovery_inbox`. See [`SELF_HOSTING.md`](SELF_HOSTING.md) step 8.
- **Kroger flyer** (`kroger_flyer`) — ready-to-eat candidates ride the flyer scan.

A discovery is dispositioned by a **decision, not a lifecycle**: **import** it (`create_recipe` — it joins the shared corpus available to everyone, opt-out, no draft state), **leave** it (no-action — it stays a discovery, resurfaced next time), or **`reject_discovery`** the URL (the group shouldn't see it again). Importing isn't gated on the user expressing interest at proposal time — a good fit can be imported eagerly; an imported recipe a member doesn't want is just a personal `toggle_reject` away.

**Group-wide reject suppression.** Per-tenant disposition is `favorite` / `reject` in the overlay — but a discovery being **not corpus-worthy for the group** (junk, broken, not a recipe, a dupe) is a *shared* judgment, so it has its own collective surface: `reject_discovery(url)` writes the canonical URL to a shared `discovery_rejections` table, and both discovery read paths consult it — `fetch_rss_discoveries` folds it into the corpus-dedup `seen` set, `read_discovery_inbox` drops matching candidates. This is deliberately asymmetric with the per-tenant marks: group `reject_discovery` is collective curation of a noisy stream (pre-import, by URL); per-tenant `toggle_reject` hides an already-imported corpus recipe for one member; favoriting is personal taste. The meal-plan flow leans on this — its aggressive in-session import collapses disposition to **import / no-action / reject_discovery**, with import landing a normal available corpus recipe and `reject_discovery` being this shared suppression.

## Indexes and validation

The scheduled recipe-index projection (above) regenerates the derived tables from the R2 corpus:

- **The D1 `recipes` table** — the recipe index, the shared objective projection of all recipe frontmatter (no per-tenant `favorite`/`reject`/`last_cooked`). The projection validates `recipes/*.md` and **projects** the valid set into D1, replacing the table wholesale in one transaction (`DELETE` + batched `INSERT`) — a *derived* projection rebuilt each pass. The Worker reads it from D1 (`src/recipe-index.ts`) and filters in memory; discovery's source-URL idempotency check is an indexed lookup (`idx_recipes_source_url`). Recipe *content* (`recipes/*.md`) stays in R2; the derived index is in D1.

- **The D1 `cooking_log` table** — per-tenant realized cook history. `last_cooked` and `retrospective` are SQL aggregations (the latter a `cooking_log LEFT JOIN recipes`). New events are appended via `log_cooked`, which validates the entry and resolves a recipe slug against `recipes` **at write time**.

Ready-to-eat is per-tenant, in the D1 `ready_to_eat` table; the Worker reads each member's catalog from D1.

**Validation runs through one validator.** Both the agent write tools (`src/validate.ts`, on `workerd`) and the projection share `src/recipe-contract.js` — the sole recipe contract. The projection checks every recipe frontmatter is well-formed, `pairs_with` references resolve cross-corpus, and the body has its `## Ingredients` / `## Instructions` sections; `guidance/**/*.md` is structurally checked. The D1 profile tables + the D1 session-state tables (`pantry`/`meal_plan`/`grocery_list`) + the D1 `cooking_log` + the shared corpus (stores, aliases, sku_cache, feeds, discovery) are **not** corpus-validated — they live in D1, not in R2; the Worker is their sole validator, at write time (`update_preferences`’ merge-patch validation for preferences, `log_cooked` for the cooking log with real recipe-slug resolution against `recipes`).

**Eventual human-edit feedback.** A malformed Obsidian/R2 edit cannot fail a push — there is no push. Instead the projection **skips** the invalid recipe (it stays out of the index) and surfaces it four ways: the D1 `reconcile_errors` table, the `/health` `recipe-index` job's skipped count, an agent-readable `read_reconcile_errors` MCP tool, and an ntfy push for each **new** invalid recipe. This is the system's accepted eventual-consistency model: a bad edit degrades that one recipe's discoverability until corrected, never the whole index, and the author learns out-of-band rather than from a build log.

**Client-side validation at the editing surface.** The eventual reconcile feedback is backstopped by a *fast* one at authoring time. The **authoring vault** is the third generated, committed artifact (`scripts/build-vault.mjs` → `vault/`, from `vault-template/` + `src/vocab.js`, with a `--check` drift gate — same discipline as `plugin/` and `admin/dist/`). Its Metadata Menu `recipe` fileClass binds each controlled-vocabulary facet (`protein` / `cuisine` / `season` / `requires_equipment`, plus the open `course` set) to a dropdown **generated from `src/vocab.js`** — the same module `src/validate.ts` and `recipe-contract.js` enforce — so the values an author can pick are, by construction, exactly the values the reconcile accepts, and an off-vocab token like `poltry` is never offered. This is a **convenience and a fast-feedback aid, not the gate**: an author can edit with plugins off or outside the vault, so the reconcile stays authoritative and is never bypassed by the dropdowns. The vault is an **author** tool (operator + co-authors); the friend read-path is the cookbook, not this vault. See [`SELF_HOSTING.md`](SELF_HOSTING.md) and the `recipe-authoring-vault` capability.

The hosted **cookbook** is served by the Worker (`src/cookbook.ts`, route `/cookbook`): the index lists from the D1 `recipes` table, each `/cookbook/<slug>` renders that recipe's R2 body, and `recipe_site_url` resolves `<origin>/cookbook`. Open + read-only, publishing only the shared objective corpus. A `?q=` runs **hybrid search** (`src/cookbook-search.ts`): an exact-intent substring tier (title+tags, the `filterRecipes` query facet) is pinned ahead of a semantic tier (the query embedded via Workers AI, cosine-ranked against the `recipe_derived` vectors, above a similarity floor), deduped by slug. The surface is anonymous, so ranking is pure cosine — none of `search_recipes`' per-tenant favourite/freshness/pantry boosts. The semantic tier is never load-bearing: when Workers AI is unavailable the page degrades to substring-only rather than erroring, and a not-yet-embedded recipe stays findable by title. Query vectors are cached in KV (`cookbook:qvec:<hash(model+query)>`) so repeats skip the embed call — the *vector* is cached, not the result list, so a corpus reconcile needs no invalidation. It stays a server-rendered GET form (no script) under the same restrictive CSP.

## Migrations

**Schema (DDL) → `migrations/d1/*.sql`** is the only migration track. Declarative table shape, applied by the Cloudflare-native `wrangler d1 migrations apply DB` (`--local` to seed the dev SQLite, `--remote` on deploy) and tracked in D1's own `d1_migrations` table (created automatically on first apply). The deploy workflow runs it after `wrangler deploy`. Add a `.sql` file under `migrations/d1/` for a schema change.

The recipe index is not written from CI — the Worker's scheduled projection rebuilds it (a *derived* table rebuild, not a stateful migration). A future data reshape would introduce an imperative runner alongside the DDL track; until then, schema migrations are the whole story.

Rollback is a redeploy of the prior Worker.

## Two surfaces, two instruction files

The same Worker, data, and indexes back two surfaces. What differs is which instruction file each consumes:

1. **Claude.ai (the agent).** [`AGENT_INSTRUCTIONS.md`](../AGENT_INSTRUCTIONS.md) is the canonical source from which the **grocery-agent plugin** is generated (`scripts/build-plugin.mjs` → `aubr build:plugin`). The persona ships as small **library skills** (`grocery-core`, plus `grocery-cart`/`grocery-corpus`/`grocery-discovery` depth); each `### ` flow becomes a workflow skill prefixed with a prerequisite line that loads `grocery-core` (and any depth it `needs`) once per session. The `grocery-mcp` connector is bundled, its URL baked into `.mcp.json` at build time (claude.ai doesn't honor a configurable plugin variable). The version auto-increments as `0.1.<commit-count>`, floored above the already-published bundle version so a squash-merge that shrinks the commit count can't regress it, so claude.ai pulls each new build. Members install from a marketplace — nothing pasted. **Edit `AGENT_INSTRUCTIONS.md` and rebuild; never hand-edit the generated bundle under `plugin/`.**
2. **Claude Code (development).** `CLAUDE.md` is read natively as repo-development context. It does **not** auto-load `AGENT_INSTRUCTIONS.md` — that's the plugin build source, not dev context — but points to it for anyone who needs the persona.

They are deliberately split so the agent persona isn't auto-loaded into a development session and vice versa.

## Security posture

- **The repo is public — but only code lives here.** This repo is the Worker, the agent's persona/skills source, and build tooling; all personal data — the operator's included — lives in D1 (private, tenant-isolated, the operator is just another tenant), with the shared authored corpus in the operator's private R2 bucket. A public *code* repo collapses the auth story: the MCP read path leaks nothing not already public, so the security boundary moves cleanly to the **write + Kroger** path. The one genuinely-public read surface is the Worker-hosted cookbook (`src/cookbook.ts`, `/cookbook`), and it publishes only the **shared, objective recipe corpus** (`recipes/*.md`) — never any per-tenant data or the per-tenant `favorite`/`reject` overlay. Eating habits, grocery cadence, and each member's `preferred_location` stay private in D1 with the rest of each member's state.
- **Secrets never touch the repo.** Because it's public, this discipline is load-bearing: the Kroger OAuth tokens live as Cloudflare Worker secrets only (encrypted at rest, never logged, gitignored locally via `.dev.vars`).
- **OAuth protects writes, not reads.** Claude.ai's custom-connector UI requires OAuth (no "no auth" / bearer option), and that OAuth guards the write/cart surface.
- **The cart is write-only.** The Kroger Cart API can add but cannot remove or check out — so the agent literally cannot read the cart or check out for the user. A useful safety property: reconciliation reports what *should* change and tells the user to fix it in the Kroger app, never silently pretends items are gone.

## Tech stack

- **Claude.ai** (web + mobile) — conversational surface, subscription auth, fresh-context conversations.
- **Cloudflare Workers** (TypeScript / `workerd`) — hosts the MCP server + OAuth provider. Free tier handles personal-scale load. **Wrangler** for deploys; **KV** for OAuth/tenant/Kroger token state.
- **GitHub** — code and the plugin marketplace, CI/CD via Actions. Not on the data path (the authored corpus is R2).
- **Cloudflare R2** (`CORPUS`) — the authored markdown corpus, read/written through `src/corpus-store.ts`; Obsidian authoring rides its S3-compatible API.
- **Kroger Developer API** — product search, prices, cart writes (write-only).
- **Pure-JS parsers** that run on `workerd`: `js-yaml`, JSON-LD via `HTMLRewriter`, RSS/Atom via `fast-xml-parser`. (No `recipe-scraper`/`cheerio` — they assume Node internals unavailable on `workerd`.)
- **Obsidian** (optional) — recipe authoring + mobile viewing during cooking, pointed at a vault synced to the R2 corpus bucket.

## What this is — and isn't

A personal automation experiment targeting a real friction point — the time and willpower of grocery planning — tuned to one person's tastes, freezer, and grocer, and shareable with a small friend group. Not a product, not a startup. The architecture is intentionally minimal: Anthropic provides messaging and reasoning, the Worker provides a domain interface, R2 holds the authored recipe corpus, D1 provides the operational data layer. Recipe files and narrative markdown are inspectable by humans (edited through an Obsidian vault) and outlive the agent if anyone stops using it.
