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
│   users/<username>/ (per-member historical records):   │
│     cooking_log.toml · notes/ · store_notes/           │
└────────────────────────────────────────────────────────┘
┌────────────────────────────────────────────────────────┐
│  DATA_KV (Cloudflare KV, per-tenant operational state) │
│   profile:<username>  → JSON bundle (preferences,      │
│     taste, diet_principles, kitchen, staples, overlay, │
│     ready_to_eat, stockup)                             │
│   state:<username>:pantry                              │
│   state:<username>:meal_plan                           │
│   state:<username>:grocery_list                        │
└────────────────────────────────────────────────────────┘

(The CODE repo — this one: Worker src/, scripts/, docs/, CI —
 is a separate upstream. Self-hosters deploy it; they never fork it.)
```

- **Claude.ai** is the conversational surface and the reasoning. Each chat starts fresh; state lives in DATA_KV (profile + session state) and the data repo (historical records + shared corpus), not in chat history. The agent reads what it needs through MCP tools at the start of a conversation.
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

### Shared vs per-tenant

- **Shared corpus (data-repo root)** — objective, single-source, read by everyone: recipe **content** (`recipes/*.md`), `aliases.toml`, the location-tagged `skus/kroger.toml` cache, the curated `storage_guidance/` tree, the `stores/<slug>.toml` store registry (identity), and the discovery sources (`feeds.toml`, `discoveries_inbox.toml`, `discovery_sources.toml`). Discovery is shared and top-level: feeds and the newsletter inbox feed one group pool, judged against each caller's taste at read time. `_indexes/` is generated from the shared content.
- **Per-tenant GitHub subtree (`users/<username>/`)** — each member's **historical records** only: `cooking_log.toml` (realized cook history), `notes/<slug>.toml` (attributed recipe notes), `store_notes/<slug>.toml` (attributed store notes). Addressed by prefixing repo-relative paths; one request can never reach another member's data.
- **Per-tenant DATA_KV** — each member's **operational state**, keyed by `profile:<username>` (the profile bundle) and `state:<username>:pantry/meal_plan/grocery_list` (session state). On a KV miss the Worker lazily migrates from any matching GitHub file, populates KV, and returns the data — zero-downtime transition for existing members.

### Three-category recipe model

A recipe splits three ways so a shared corpus is safe to share:

- **Content** — objective frontmatter + body, shared and single-source.
- **Overlay** — `rating` + `status`, per-tenant in the `overlay` field of the KV `profile:<username>` bundle (slug-keyed TOML). One member's disposition never changes another's. `status` lifecycle: `active` (candidate set) · `draft` (surfaced, not yet dispositioned) · `rejected` (explicit no, kept for de-dup) · `archived`. Effective `status` defaults to `draft` when a member has no overlay entry.
- **Notes** — per-tenant, attributed, append-mostly (`users/<id>/notes/<slug>.toml`).

`last_cooked` is **not stored** — it's derived per-tenant from that member's `cooking_log.toml`. Read tools merge shared content + the caller's overlay + cooking-log `last_cooked` at read time; the shared `_indexes/recipes.json` carries objective fields only.

**Notes are the spin-capture mechanism that makes sharing safe.** A tweak ("sub gochujang for the sriracha") is an attributed note, never an edit to shared content; only a genuinely *different dish* warrants a personal-recipe fork under `users/<id>/recipes/`. The shared body changes only for an objective correction. Group notes/ratings aggregate across members at read time (`read_recipe_notes`).

### The intent model (per-tenant)

Five intent kinds — don't conflate them:

| Key / backing | Kind of intent |
| --- | --- |
| `state:<username>:pantry` (KV) | **observation** — what's physically in the kitchen |
| `profile:<username>.stockup` (KV bundle field) | **conditional intent** — buy IF it drops below a threshold |
| `state:<username>:grocery_list` (KV) | **committed buy intent** — buy on the next order (ingredient-level, SKU-free) |
| `state:<username>:meal_plan` (KV) | **committed cook intent** — recipes agreed to cook next (transient) |
| `users/<username>/cooking_log.toml` (GitHub) | **realized history** — append-only log of meals actually cooked |

KV state is freely mutable with no git history (appropriate for transient operational data); `cooking_log.toml` is GitHub-backed for a durable audit trail. The agent **captures intent into the grocery list continuously**, and **flushes to the cart once**, at order time. Capture is store-agnostic (the list is SKU-free); the flush is not.

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

## Background-job health

The warm cron and the inbound `email()` handler are the system's **background processes** — they run with no user attached, so a failure has no in-band consumer (every synchronous tool failure surfaces to the user via Claude.ai; a 3am cron failure surfaces to no one). And the platform won't fill the gap: Cloudflare Cron Triggers have no retries and no failure alerts. The keystone failure — *a stopped job emits nothing* — is only detectable from **outside** the Worker.

- **Each background job writes a `health:job:<name>` record** to KV per run (`{ ok, last_run_at, summary }`, tenant-data-free). The warm and the email handler are the registered jobs; a future cron rides the same convention with no new wiring.
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

- **`_indexes/recipes.json`** — all recipe frontmatter aggregated as one slug-keyed JSON document (objective fields only). The Worker reads it once per filtering operation — one API call instead of fetching every recipe file.

Ready-to-eat is per-tenant (`users/<username>/ready_to_eat.toml`), so it has **no** aggregate index; the Worker reads each member's catalog directly (the build still structurally validates any it finds).

The same build runs **validation**: every TOML parses, every recipe frontmatter is well-formed, `pairs_with` references resolve, and status values are in the enum. Validation failures fail the Action (red CI) but don't block reads — the Worker keeps reading HEAD. The point is fast feedback, not gating. The Worker reimplements a *structural* subset of this validation in TypeScript for write-time checks (it can't run the Node validator on `workerd`).

A useful side effect: the indexes are a public-ish artifact any tool can consume — `scripts/build-site.mjs` builds a static GitHub Pages cookbook from them with no backend.

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
