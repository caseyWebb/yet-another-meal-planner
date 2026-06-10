# ROADMAP.md — OpenSpec Change Proposals

A sequence of independently-buildable OpenSpec changes. Each change is sized to fit within OpenSpec's recommended 200-300 line spec cap and produces something concrete and testable. Dependencies are listed explicitly. You can build them in the suggested order, or fan out where dependencies allow parallel work.

The basic workflow per change:

1. Open Claude Code in the repo.
2. Use the OpenSpec proposal skill: "I want to implement change <N>: <title>. Here's the scope: ..."
3. Claude Code drafts `openspec/changes/<change-id>/proposal.md` + `specs/` deltas + `design.md` + `tasks.md`.
4. Review, refine, then `/openspec-apply` to implement.
5. `/openspec-archive` when done.

Each entry below contains enough description for the OpenSpec proposal skill to generate a real proposal artifact. Treat them as starting points, not final specs.

---

## Change 01: Repo skeleton

**Scope:** Initialize the repository structure exactly as specified in `docs/PROJECT.md`. Create all directories, empty TOML files with header comments, README, gitignore, and commit CLAUDE.md + docs/SCHEMAS.md + docs/TOOLS.md at the root or under `docs/`.

**Dependencies:** None.

**Deliverables:**
- All directories from docs/PROJECT.md's repo structure
- Stub TOML files with header comments and example commented-out entries per docs/SCHEMAS.md
- `README.md` explaining the project and how to use the repo
- `.gitignore` (Node, OS, editor files, Worker secrets)
- CLAUDE.md, docs/SCHEMAS.md, docs/TOOLS.md, docs/PROJECT.md committed at the root or under `docs/`
- Initial commit; push to GitHub private repo

**Done when:** `git clone` produces the structure that everything else builds on. Obsidian (or similar) can open `recipes/` and show... nothing yet, but the structure is there.

---

## Change 02: Index generation + validation Action

**Scope:** Implement `scripts/build-indexes.mjs` (TypeScript or modern JS) that walks `recipes/` and other relevant directories, generates `_indexes/recipes.json`, `_indexes/components.json`, `_indexes/ready_to_eat.json`, and runs validation (TOML parses, frontmatter well-formed, references resolve, status enums correct). Wire into a GitHub Action triggered on push to data directories. Add a local pre-commit hook running the same validation.

**Dependencies:** Change 01.

**Deliverables:**
- `scripts/build-indexes.mjs`
- `.github/workflows/build-indexes.yml`
- Pre-commit hook (in `scripts/pre-commit.sh` or via `husky`)
- Validation failure modes documented in CLAUDE.md or README
- Action commits regenerated indexes with `[skip ci]` to prevent loops

**Done when:** Pushing a recipe (or even an empty repo) triggers the Action; indexes regenerate; validation runs; the local pre-commit hook catches issues before push.

**Notes:** Can be built with empty/dummy recipes. The Action is content-agnostic.

---

## Change 03: Recipe corpus migration

**Scope:** Import an initial 30-50 recipes from existing sources (ReciMe, personal notes, bookmarked URLs) into `recipes/*.md` with proper frontmatter per docs/SCHEMAS.md. This is partly manual data work; the implementation aspect is small.

**Dependencies:** Changes 01 and 02 (validation needs to pass).

**Deliverables:**
- 30-50 well-formed recipe markdown files
- All recipes with status: active (these are your starting corpus)
- Indexes regenerate cleanly via the Action
- Pre-commit hook validation passes

**Done when:** Browsing `recipes/` in Obsidian on phone shows your real recipes with rendered frontmatter. The corpus is searchable client-side via Obsidian.

**Notes:** Don't aim for perfect frontmatter — `last_cooked` can be null for everything initially, `rating` can be null, `meal_preppable` can default to false. Refine as you cook them and the agent learns.

---

## Change 04: Worker skeleton + repo-data read tools

**Scope:** Bootstrap a Cloudflare Worker in `worker/` with TypeScript, the MCP SDK, and the basic plumbing. Implement the **repo-data-backed read tools** from docs/TOOLS.md: `list_recipes`, `read_recipe`, `read_pantry`, `read_preferences`, `read_taste`, `read_diet_principles`. These read only from the GitHub repo (indexes + flat files) — no external services. Set up GitHub API client. Deploy via Wrangler. Test via MCP Inspector.

**Tool/Kroger split (decided):** This change is the **repo-data** half of the tool surface. Anything that touches Kroger lives in the external-services bucket (Change 05). `ready_to_eat_available` — whose defining behavior is the Kroger availability cross-reference — therefore moves to **Change 05**, not here. The catalogs are empty until Change 05/10 populate them anyway, so nothing is lost by deferring. Result: Change 04 is exactly six pure repo-data reads.

**Transport (decided):** Use `createMcpHandler()` (stateless, **no Durable Objects**) over **Streamable HTTP** (SSE is deprecated). The six read tools are pure functions of repo state — no per-session memory — so the heavier `McpAgent` + Durable Objects path isn't needed.

**Auth posture (decided).** Three separate auth legs — keep them distinct:
- *Leg 1 — Worker → GitHub:* a fine-grained **PAT** scoped to this repo, set via `wrangler secret put GITHUB_TOKEN`. Server-side secret; Claude.ai never sees it. Scope it `contents:read+write` once so Change 06 reuses it.
- *Leg 2 — Claude.ai → Worker:* deploy **authless for Change 04** (read-only on public data leaks nothing; test via MCP Inspector). Securing this leg lands via **Cloudflare Access** in front of the Worker (policy: only Casey's identity), and **must be in place by Change 06** — the moment write/cart tools exist, an authless public URL lets anyone write the repo and add to the cart. Change 07 then just points Claude.ai at the already-secured Worker; it is *not* the first place auth appears.
- *Leg 3 — Worker → Kroger:* Change 05, separate OAuth, Worker secrets.

**GitHub access (decided — Option B):** Build the authenticated GitHub client wrapper **now** (not tokenless), reused by Changes 05/06. Authenticated reads get 5,000 req/hr vs. 60/hr unauthenticated; writes (Change 06) need the token regardless of repo visibility, so reads piggyback on it. `list_recipes` reads `_indexes/recipes.json` (one call, filter in-worker); the rest read flat files at `main` HEAD. No KV cache in v1 — add only if latency is felt.

**CI/CD (decided — CD from day 1):** Ship `.github/workflows/deploy-worker.yml` that deploys on push to `worker/**`. First deploy is manual (`wrangler deploy`, to create the Worker and run `wrangler secret put` for the PAT); CD owns every deploy after. The **Cloudflare API token** lives in GitHub Actions secrets; the **Worker's own secrets** (PAT, later Kroger tokens) are set via `wrangler secret put` straight to Cloudflare and persist across deploys — they are NOT in the repo or in Actions.

**`list_recipes` semantics (decided):**
- Array filters (`tags`, `dietary`, `season`) match **ALL** listed values (AND / narrowing). Trivial to widen later if it annoys.
- `exclude_recently_cooked` is a **tool param** — `exclude_cooked_within_days` (number) — not a hardcoded window or a preferences lookup. Caller decides.
- Requesting every status is **explicit**: `status: "all"`. Default remains `active`.
- `not_cooked_since` **passes** recipes with `last_cooked: null` (never cooked ⊃ not-cooked-since-X, i.e. infinity).

**Errors (decided):** Tools return **structured** errors the agent can reason over, never raw throws/500s. Enumerate explicit cases with helpful messages: unknown recipe slug, missing/malformed `_indexes/recipes.json`, GitHub unreachable or rate-limited, malformed TOML/frontmatter. Shape e.g. `{ error: "not_found", slug, message }`. This convention is set here and inherited by every later tool.

**`read_recipe` shape (decided):** Drop `last_modified` from the return — it would cost an extra Commits-API call per read and nothing currently consumes it. Return `{ slug, frontmatter, body }` (blob `sha` available cheaply if a need appears). Revisit if a consumer materializes.

**Parsing on `workerd` (decided — minimal deps):** Do **not** use `gray-matter` in the Worker (Node `Buffer` assumptions). Split frontmatter on `---` by hand and parse the YAML with `js-yaml` (pure JS, runs on `workerd`); TOML via `smol-toml` (already a dep). Rewriting the small amount of parsing glue is acceptable to keep the dependency surface thin.

**`read_pantry` filter (decided):** Ship `category` and `prepared_only` (both deterministic from pantry data). `stale_only` depends on shelf-life thresholds from `ingredients.toml` (Change 12) and can't be computed deterministically yet — until then it returns a structured `{ error: "unsupported" }` rather than guessing. Same deferral shape as `ready_to_eat_available`.

**Local dev + secrets hygiene (decided):** `wrangler dev` locally, MCP Inspector pointed at the local URL; the PAT lives in `.dev.vars` for local runs. Anything gitignored-but-needed-to-run gets documented in `worker/README.md` as it's added (the repo is public — no secret silently required). Confirm `.gitignore` covers `.dev.vars` and `.wrangler/`.

**TOOLS.md is the contract — keep it in sync.** When a tool's params/returns change during a proposal or build, update `docs/TOOLS.md` in the same pass. No drift. (Already reconciled for the `list_recipes` filter rename, the `read_recipe` `last_modified` drop, and the `read_pantry` `stale_only` deferral.)

**Dependencies:** Change 01 (structure), Change 03 (some recipes to read). Change 02 not strictly required but helpful (`_indexes/recipes.json` enables `list_recipes`).

**Deliverables:**
- `worker/` directory with full TypeScript Worker source (own `package.json`/`tsconfig`, separate dep tree from the root index-build tooling)
- `worker/wrangler.toml` (or `wrangler.jsonc`) and deployment config
- Authenticated GitHub client wrapper (PAT via Worker secret; handles rate limiting, basic retries, structured errors)
- The six repo-data read tools per docs/TOOLS.md, returning structured JSON
- `list_recipes` filter logic over the index per the semantics above (AND on arrays, `status: "all"` opt-out, `exclude_cooked_within_days` param, null-`last_cooked` passes `not_cooked_since`)
- `js-yaml` + manual frontmatter split for recipe parsing; `smol-toml` for TOML — no `gray-matter` in the Worker
- Explicit structured error cases with helpful messages (unknown slug, missing/bad index, GitHub down/rate-limited, malformed data)
- `.github/workflows/deploy-worker.yml` — CD on push to `worker/**` (Cloudflare API token in Actions secrets)
- First manual `wrangler deploy` + `wrangler secret put GITHUB_TOKEN`; Worker live at `grocery-mcp.<your-subdomain>.workers.dev`
- README in `worker/` explaining local dev, the one-time manual deploy/secret setup, and how CD takes over

**Done when:** You can invoke `list_recipes({ status: "active" })` from MCP Inspector and see your migrated recipes returned as JSON, and a push to `worker/**` redeploys via CD.

---

## Change 05: Kroger API integration + matching pipeline

**Scope:** Implement the Kroger-facing (external-service) **read** tools inside the Worker: `kroger_flyer`, `kroger_prices`, `kroger_search` (internal helper), `ready_to_eat_available` (catalog read **+** Kroger availability cross-reference — moved here from Change 04 because its defining behavior needs Kroger), and the headline `match_ingredient_to_kroger_sku` with its full 7-step deterministic pipeline (**resolve-only** — see below). Sign up for the Kroger Developer account; authenticate with the `client_credentials` grant; store the Kroger client ID/secret as Worker secrets.

**This is the "external services" half of the tool surface** — the counterpart to Change 04's repo-data reads.

**Read-only scope (decided).** Change 05 is **entirely read-only** and stays **authless + stateless**, inheriting Change 04's posture unchanged. Every Kroger tool here uses the `client_credentials` grant (products, prices, flyer, availability) — none needs the user-context `authorization_code` flow, because none writes a cart. Two writes that earlier drafts placed here move to the order-placement change, **Change 06b** (the Cloudflare Access gate that protects the Worker ships earlier, in Change 06, with the first git write):
- **SKU cache writes** → Change 06b, folded into `place_order`'s atomic batched commit. The matching pipeline here *resolves and returns* a mapping; it does **not** persist it.
- **`authorization_code` OAuth + callback route + KV refresh-token storage** → Change 06b, paired with the `place_order` cart-write tool that consumes them. (Kroger refresh tokens are **single-use/rotating**, so they need a writable KV slot — that lands in Change 06b, not here.) Change 05 needs no persistent storage: client-credentials access tokens live in isolate memory, re-minted on expiry.

**Kroger API reality (decided — researched 2026-06):**
- **Public tier only.** The richer **Catalog API / Catalog API V2** are *partner*-gated (negotiated Kroger Digital contract, bespoke catalog) — out of reach for a personal app. The **public Products API** (term search + per-item price, location-scoped) is the ceiling. The *partner* Cart API can read/remove items; the **public Cart API is add-only** — so the write-only cart limitation is a tier artifact, not a choice.
- **No flyer/circular endpoint.** There is no "list all sales" primitive. Product price is `{ regular, promo }` where `promo: 0` means not on sale; the only way to find a sale is to search a term and inspect `promo`. So `kroger_flyer` is a **synthesized scan**, not a feed (see below).
- **`filter.locationId` is required for pricing.** Resolving `preferences.toml`'s `preferred_location` label → a Kroger `locationId` via the Locations API (cached) is a **hard prerequisite** for every priced call.
- **Availability = curbside/delivery fulfillment.** Per user decision, availability means `fulfillment.curbside || fulfillment.delivery` at the location — *not* live in-store inventory (the API exposes no stock level). `ready_to_eat_available` and the pipeline's "in stock" filter use this fulfillment signal.
- **Rate limits are undocumented.** Kroger publishes no firm numeric limits (community-cited figures exist but aren't canonical). Design the Kroger client for `429` + `Retry-After` / exponential backoff rather than a hardcoded budget.

**`kroger_flyer` mechanics (decided).** Two term sources, deduped by `productId`, each scanned and filtered to `promo > 0`:
- **Precise terms** — *derived* (stockup-flagged pantry items, current menu ingredients, substitution candidates). High precision.
- **Broad terms** — *curated* in a new `flyer_terms.toml` (e.g. `"fruit"`, `"frozen meals"`, `"cheese"`). Serendipity. **Explicitly non-exhaustive**: each term returns a bounded, *relevance*-ranked page (the API has no "sort by discount"), so this samples the head of each category, not the whole category. Paginate a few pages deep per term for coverage; cost is trivial. `flyer_terms.toml` is **user-curated config** (edit-only-when-directed bucket) — needs a `docs/SCHEMAS.md` entry and a line in `CLAUDE.md`'s curated-config list.

**Matching pipeline (decided).** `match_ingredient_to_kroger_sku` is **resolve-only** and runs the deterministic narrowing per docs/PROJECT.md, with these specifics:
- **Confidence = cache hit OR a defined `preferences.toml [brands]` entry.** The `[brands]` table is **tri-state**: key absent → ambiguous (ask); `[]` → "don't care," cheapest acceptable; non-empty list → ranked preference (list order = rank). Otherwise return narrowed candidates for the LLM to resolve; every resolution caches, so it asks less over time.
- **Scoring, not hard filters** — a missing preferred brand can't empty the candidate set. Dietary is a **best-effort soft score** ("organic" in the name), never a gate (the API exposes no dietary attributes).
- **No substitution.** If nothing is fulfillable via curbside/delivery, return `{ resolved: false, reason: "unavailable" }`; substitution stays with `propose_substitutions` (sole owner of `substitutions.toml`, always confirmed). **PROJECT.md step 4 reconciled accordingly.**
- **Cache revalidation, no TTL.** A cache hit short-circuits search/narrowing but is revalidated with one targeted lookup (current price + curbside/delivery availability) before use; unavailable → re-resolve. The LLM may pass `bypass_cache` when a hit doesn't fit the recipe context.
- **`compare_unit_price` (new tool):** deterministic price-per-unit, dimension-bucketed (never compares `$/fl oz` to `$/lb`); the LLM normalizes only unparseable size strings, never does the math. One core — used internally for the tiebreaker and exposed for the conversational ambiguous-flow.

**Build-time confirmations (not blockers):** the `filter.fulfillment` codes (curbside/delivery) and whether `filter.productId` accepts multiple IDs (would let cache revalidation batch into 1–2 calls).

**Dependencies:** Change 04.

**Deliverables:**
- Kroger Developer `client_credentials` (client ID/secret) configured as Worker secrets
- Kroger API client wrapper: `client_credentials` token caching (in-memory, re-mint on expiry) + `429`/backoff handling, structured errors per the Change 04 convention
- Location resolution: `preferred_location` label → `locationId`, cached
- `kroger_search` internal helper; `kroger_prices`, `kroger_flyer`, `ready_to_eat_available` per docs/TOOLS.md
- `flyer_terms.toml` curated config + `docs/SCHEMAS.md` / `CLAUDE.md` sync
- `match_ingredient_to_kroger_sku`: the 7-step deterministic pipeline per docs/PROJECT.md, **resolve-only** (confident match / narrowed candidates / `unavailable`; tri-state brand confidence; scoring not filtering; `bypass_cache` param; cache revalidation; cache *write* deferred to Change 06)
- `compare_unit_price` tool + its deterministic unit-conversion core (shared by the matcher's tiebreaker and the exposed tool); `flyer_terms.toml` consumed by `kroger_flyer`
- Tests for the matching pipeline (canonicalization, cache lookup + revalidation, scoring, tiebreaker/unit-price, confidence gate, `unavailable` signal) with mocked Kroger responses
- `docs/TOOLS.md` kept in sync (fulfillment-based availability semantics; flyer term-source behavior)

**Done when:** `match_ingredient_to_kroger_sku("extra virgin olive oil")` returns a confident SKU with reasoning, or `ambiguous: true` with candidates — invoked from MCP Inspector against the live public Products API. `kroger_flyer` returns real on-sale items synthesized from the precise + broad term scan.

---

## Change 06: Git write tools + atomic commit + Access gate

**Scope:** The **capture** half of the write surface — everything that persists to the repo, plus the security gate in front of the Worker. Implement the repo-data **write** tools from docs/TOOLS.md and the atomic batched-commit engine. **No Kroger, no cart, no order-side OAuth here** — placing an order is Change 06b. (Re-cut from a single "write tools + cart" Change 06; see the capture/flush reframe below.)

**Write tools:** `update_recipe`, `update_pantry`, `mark_pantry_verified`, `add_draft_ready_to_eat`, `update_ready_to_eat`, the user-curated `update_*` tools, the new **grocery-list** tools (`read_grocery_list`, `add_to_grocery_list`, `update_grocery_list`, `remove_from_grocery_list`), and `commit_changes`. Atomic commits via GitHub's Git Data API (build tree → create commit → update ref), never sequential per-file commits.

**Capture/flush reframe (decided — see `docs/notes/2026-06-09-order-flow-reframe.md`):** `write_cart_and_commit` fused two unlike operations — persist memory (atomic git, mutable store) and place an order (external, write-only, un-rollback-able). The repo commits exist for **memory's sake**, not the cart's: the repo *is* the database (stateless conversations). So the cart write is split out to Change 06b. Mutable store (repo) → capture continuously; append-only store (Kroger cart) → flush once, at order time. `commit_changes` becomes the everyday persist path; `place_order` (06b) is the order-time flush. The roadmap's "first write and its gate ship together" is satisfied **here** — the gate must precede the first *git* write, which is earlier than the cart write.

**`grocery_list.toml` (new, decided):** an ingredient-level, **SKU-free** buy list that accumulates intent across the week (mid-week "I'm low on X", menu-derived restocks, staples promoted from low/out pantry, stockup items hitting their sale price, and non-food household items). Resolution to a Kroger SKU is deferred to order time (06b), against current availability — which immunizes against brand/price drift between capture and order. Three-file state model: `pantry.toml` = observation (what's in the kitchen), `stockup.toml` = conditional intent (buy IF on sale), `grocery_list.toml` = committed intent (buy next order). Transitions are always **prompted, never automatic** (low/out → prompt "add to list?"). Non-food items are an intentional feature (general shopping list). Schema + field rationale in the design note; needs a `docs/SCHEMAS.md` entry. Agent-writable side-effect file (NOT curated-config).

**Lifecycle state (decided):** `active → in_cart → ordered → received`. The agent **cannot read the Kroger cart or verify checkout** (write-only API), so every state past `in_cart` is **user-asserted** ("I placed the order", "I picked up the groceries"), never agent-verified — same honesty rule as "never claim cart items were removed." `received` is terminal: entry removed + pantry restocked (grocery items only). The underlying state writes are this change's tools; the order-time orchestration that drives them lands in 06b. Stale-cart across sessions is an accepted human-in-the-loop limitation (Casey clears the cart manually), not engineered around.

**Access gate (decided — spike complete, see design note):** Cloudflare Access in front of the Worker (policy: only Casey's identity). Claude.ai **web** connectors are **OAuth-only** (no custom headers / service tokens), so the gate uses Cloudflare Access **Managed OAuth**: Access becomes the OAuth authorization server (emits `WWW-Authenticate`, runs DCR + PKCE + token issuance), and the Worker needs **no MCP-facing OAuth code** — it validates `Cf-Access-Jwt-Assertion` (defense-in-depth) or trusts Access fronting it. Managed OAuth is **open beta** — re-verify before Change 07; fallback is `workers-oauth-provider` (OAuth endpoints in the Worker). This is leg 2 (Claude.ai → Worker), **distinct** from leg 3 (Worker → Kroger, 06b).

**Atomic commit (decided):** optimistic ref-update with retry — the index-build Action (Change 02) is a second writer, so a non-fast-forward `update ref` re-reads base and replays the changeset. High-frequency mid-week writes touch **non-indexed** files (pantry, grocery_list) → no index Action triggered → no race in the common case; the recipe/index-touching commit happens ~once per order.

**Validation (decided):** the Worker validates **structurally** before commit (TOML/YAML parses, enums/status well-formed) so it never commits syntactic garbage; cross-reference / index validation remains the post-push Action's job. The Node validator (`scripts/build-indexes.mjs`) can't run on `workerd`, so the Worker reimplements the structural subset in TS.

**Dependencies:** Change 04. **Not Change 05** — no Kroger here, so this can be built in parallel with 05 (the repo currently has 05 done, so in practice 06 is next).

**Deliverables:**
- Repo-data write tools per docs/TOOLS.md, incl. the grocery-list tools
- `grocery_list.toml` schema + `docs/SCHEMAS.md` entry; `CLAUDE.md` side-effect-files + capture/flush behavior + prompting rules
- Atomic batched-commit engine (Git Data API: tree → commit → update ref) with optimistic ref-retry against the second-writer Action
- `commit_changes` (no cart); structural pre-commit validation (TS subset, workerd-safe)
- Cloudflare Access in front of the Worker via Managed OAuth (only-Casey policy); optional `Cf-Access-Jwt-Assertion` validation in the Worker
- `docs/TOOLS.md` kept in sync (grocery-list tools; `write_cart_and_commit` re-cut into `commit_changes` + `place_order`)
- Tests for the atomic-commit path (tree build, ref-retry, structural validation)

**Done when:** a single `commit_changes` call updates multiple recipes, verifies pantry items, edits the grocery list, and lands one clean git commit — behind Cloudflare Access, with the second-writer ref-retry exercised in tests. No Kroger involved.

---

## Change 06b: Order placement (cart + Kroger write-side OAuth)

**Scope:** The **flush** half — turn the accumulated `grocery_list.toml` into a populated Kroger cart, once, at order time, and drive the order lifecycle. Implement `place_order` and the Kroger write-side auth bundle.

**`place_order` (decided):** resolve the **whole** grocery list at once via the Change 05 matcher (`match_ingredient_to_kroger_sku`, with cache revalidation against current price + curbside/delivery availability) → surface ambiguous/unavailable items as a single batch checkpoint for Casey to disposition → `PUT /v1/cart/add` for the resolved set → append learned mappings to `skus/kroger.toml`. Marks items `in_cart`. Order-time dedup: to-buy = `grocery_list ∪ (menu needs) − (pantry has)`. Partials prompt Casey ("the plan needs ~X; you have a partial — enough, or add?"); default buy is 1 package unless told.

**Partial-failure (decided):** nothing in the repo is transactional with the cart. The SKU-cache commit and the cart write are **two independent best-effort ops** — SKU cache is a hint, so either failing alone corrupts nothing. `place_order` returns honest partial status; the agent never claims a cart is populated when the write failed.

**Lifecycle orchestration (decided):** the conversational flow that advances `in_cart → ordered` (on "I placed the order") and `ordered → received` (on "I picked up" → pantry restock for grocery items + clear from list). The underlying state writes are Change 06 tools; 06b owns the CLAUDE.md orchestration + the stale-cart reminder at the start of a new order.

**Kroger `authorization_code` OAuth + PKCE + KV (decided):** a one-time auth-callback route in the Worker for the token exchange, plus automatic refresh. Kroger refresh tokens are **single-use/rotating**, so the refresh token lives in a **KV namespace** (one key) — the minimal writable slot, *not* a Durable Object (single-user, no coordination need). Write the new refresh token to KV **before** using the access token (the brick-risk window); treat a rejected refresh as a clean `{ error: "reauth_required" }` (re-run the one-time auth), never a silent 500. This is leg 3 (Worker → Kroger), distinct from the Change 06 Access gate (leg 2).

**Access carve-out (decided):** the Kroger OAuth callback path (`/oauth/*`) must **bypass** Cloudflare Access (Kroger's redirect carries no Access JWT); protect it with OAuth `state` / PKCE instead. Confirm no path collision with Access's own Managed-OAuth endpoints at build time.

**Dependencies:** Changes 05 (matching pipeline) and 06 (atomic commit engine + grocery-list tools + Access gate).

**Deliverables:**
- `place_order` tool: whole-list resolution + ambiguity/unavailable batch checkpoint + `PUT /v1/cart/add` + SKU-cache append, with honest partial-failure status
- Kroger `authorization_code` OAuth + PKCE: one-time callback route, automatic refresh, single-use rotation handled correctly (KV write-before-use; `reauth_required` on rejection)
- KV namespace holding the rotating Kroger refresh token (read on cold start; rewritten on each refresh)
- `/oauth/*` Access carve-out
- CLAUDE.md order-lifecycle orchestration (place / "I placed the order" / "I picked up" → pantry restock; stale-cart reminder)
- `docs/TOOLS.md` in sync (`place_order` semantics, lifecycle)
- Tests for resolution-to-cart and refresh-token rotation (mocked Kroger)

**Done when:** "place my order" resolves the whole grocery list against current availability, surfaces any calls as one batch, populates the Kroger cart, and persists the SKU-cache learnings — and you check out by hand in the Kroger app, then tell the agent "I placed the order" / "I picked up" to advance state.

---

## Change 07: Claude.ai connection + first conversational flow

**Scope:** Connect the deployed Worker to Claude.ai as a custom connector. Add the GitHub MCP connector. Create the "Grocery Agent" project and paste CLAUDE.md into project instructions. Validate basic conversational flows end-to-end: "what's in my pantry?", "show me chicken recipes", "I ran out of olive oil", "rate the salmon thing 4 stars".

**Dependencies:** Changes 04, 05, 06, 06b.

**Deliverables:**
- Custom MCP connector configured in Claude.ai account settings
- "Grocery Agent" project created with CLAUDE.md as instructions
- GitHub MCP enabled in the project
- Manual test transcript of basic flows working end-to-end
- Any necessary fixes to CLAUDE.md or tool descriptions discovered through testing

**Done when:** From your phone, you can open Claude.ai, start a fresh conversation in the "Grocery Agent" project, and have a useful conversation about your pantry or recipes without things going off the rails.

**Notes:** This is a milestone change — it proves the architecture works end-to-end. Expect to iterate on CLAUDE.md as you see what Claude does with it.

---

## Change 08: Menu request flow — pantry verification + substitution

**Scope:** Implement the deterministic pantry side of the menu-request foundation: `verify_pantry_for_recipe`, `verify_pantry_for_candidates`, and `propose_substitutions` (inventory and sale modes), plus the recipe-ingredient parser both verify tools depend on. Update CLAUDE.md's menu-request orchestration (comprehensive pantry confirmation pass + substitution timing). **`suggest_sequencing` is cut from this change and moves to Change 13** (see below).

**Data-readiness reframe (decided 2026-06-09, explore session):** Of the original Change 08 tool set, only the *presence* half of pantry verification delivers value on today's corpus — the staleness source (`ingredients.toml`, Change 12), the component graph (1/63 recipes declare a non-empty component), and the substitution rules (`substitutions.toml` empty) are all deferred or unseeded. The cut and the decisions below align the change with what the data can actually support, rather than shipping tools that return ∅ against the real corpus. `suggest_sequencing` belongs with Change 13, the change that seeds the component vocabulary it walks.

**Recipe-ingredient parser (decided — net-new, reuses a base):** Recipe ingredients are free-text, price-annotated lines, e.g. `1.25 lbs. boneless, skinless chicken thighs (4-5 thighs) ($4.59)`. The Change 05 matcher's `normalizeIngredient()` (in `worker/src/matching.ts`) already strips a single leading quantity+unit and applies `aliases.toml`, but is deliberately conservative — no prep/parenthetical/price stripping — because it was built for clean LLM-supplied terms and SKU-free grocery-list names, never raw recipe lines. So Change 08 adds a `parseRecipeIngredient()` layer (strip trailing/leading prep descriptors, `(...)` parentheticals, the `($x.xx)` price annotation) that yields a clean name, then feeds the existing `normalizeIngredient` + alias step. The parser is shared by both verify tools and reusable by `place_order`'s `menu_needs` path. The recipe-site change already enforces a `## Ingredients` H2 contract, so the parser has a guaranteed section to read.

**Matching strategy (decided 2026-06-09 — Option C, tool surfaces, LLM confirms):** With `aliases.toml` empty, exact normalized-string equality would silently miss real matches (`chicken thighs` vs pantry `chicken`, `vegetable broth` vs `vegetable stock`, `long-grain white rice` vs `rice`) and a token-overlap heuristic would silently false-positive (`onion powder` matching `onion`, `coconut milk` matching `milk`). So the matcher does **not** guess. It returns three sets: `in_pantry` (exact normalized match — confident), `possible_matches` (fuzzy/token-overlap candidates pairing a recipe ingredient with a plausible pantry item — *the LLM confirms or rejects each*), and `not_in_pantry` (no candidate at all). This mirrors the staleness decision: the tool surfaces candidates and ambiguity, the LLM judges — never silent false-misses, never silent false-positives. Confirmed `possible_matches` are the natural place to *suggest seeding an `aliases.toml` entry* so the pair resolves automatically next time (suggest only — aliases is edit-when-directed config).

**Optional ingredients (decided 2026-06-09):** Parentheticals aren't uniform — `(4-5 thighs)` is a quantity hint, `(optional garnish)` is a directive. The parser detects an `optional` marker and tags those ingredients **non-blocking**: they never auto-populate `not_in_pantry`/to-buy. They're surfaced separately, and when one isn't in the pantry the agent **asks** whether to add it to the order rather than dropping it silently or adding it unilaterally.

**Staleness (decided 2026-06-09 — facts from the tool, judgment from the LLM, resolution by prompting):** There is **no `have_stale` bucket** and no tool-side freshness determination. The tool is the worst-positioned thing in the system to classify freshness: the deterministic shelf-life source (`ingredients.toml`) is Change 12 (and Change 04 already deferred `read_pantry(stale_only)` to `{error:"unsupported"}` for exactly this reason), categories are absent on 42/45 items, and — more fundamentally — freshness isn't a function of age. It depends on storage, whether the bag was opened, how it looked this morning; none of that is in the repo. The real resolution is a *prompt to go check* ("Basil added 9 days ago — still good?"), not a verdict.

So verify returns **facts, not classifications**: matched items in a single `in_pantry` set, each carrying the metadata already tracked — `added_at`, `last_verified_at`, `days_since_verified`, `category` (when present), `prepared_from`. The LLM, guided by CLAUDE.md's spoilage prose, decides *which* items warrant a "still good?" prompt (perishables long-since-verified, `prepared_from` leftovers); the user confirms; `mark_pantry_verified` resets the timestamp. This is the existing verify→confirm→`mark_pantry_verified` loop, and it's exactly "LLM where it earns its keep" — judging "8-day-old fridge herbs are worth a check but canned beans never are" is contextual reasoning the tool can't do.

The bucket name `have_fresh` goes away too (it asserts a freshness the tool isn't determining); it becomes `in_pantry`, the clean antonym of `not_in_pantry`. **Accepted tradeoff:** prompting is non-deterministic run-to-run — the same pantry may surface a slightly different set of "still good?" nudges. For a soft waste-prevention nudge that's the right failure mode (worst case: one unnecessary "yep"); a hard stale/fresh gate would be the wrong one.

**Change 12's role shrinks accordingly:** `ingredients.toml` stops being "the thing that computes the stale bucket" and becomes a *hint that informs the prompt* — the tool may surface a `past_typical_fresh_life` flag to bias which items the LLM raises, but the prompt-or-not decision stays with the LLM (storage context still varies). Same return contract, richer hint.

**Presence-only, no quantity sufficiency (decided):** verify reports have-it / don't-have-it, never "you have 1 onion but need 3." CLAUDE.md bans portion tracking and Change 06b already owns quantity reconciliation via partials at order time. `not_in_pantry` is presence-driven; netting required amounts is out of scope.

**Candidate aggregation carries per-recipe attribution (decided):** `verify_pantry_for_candidates` tags `not_in_pantry` (and `inventory_substitutes_available`) entries with the recipe slug(s) that need them — mirroring `grocery_list.toml`'s `for_recipes` and what `place_order` already consumes. A flat union across candidates would lose the attribution the menu reasoner and order-time dedup need.

**Substitution surface is dormant until seeded (decided — not a bug):** `propose_substitutions` applies `substitutions.toml` rules deterministically; verify's `inventory_substitutes_available` bucket draws on the *same* rule source. Both `substitutions.toml` and `aliases.toml` are empty user-curated config that fills only when Casey directs it — so in v1 both substitution paths return ∅, and matching relies on the `possible_matches` → LLM-confirm path (above) rather than alias expansion. This is expected: v1 drift-catching value lives in `in_pantry` (with age metadata, LLM-judged freshness) / `possible_matches` / `not_in_pantry`; the substitution and alias layers light up over time (and confirmed `possible_matches` are where alias seeding is suggested). **Sale-mode substitution fetches Kroger flyer/price data internally** (Change 05, available) — self-contained, not caller-supplied; if the menu flow already pulled `kroger_flyer` this is a small redundant fetch and that's acceptable.

**Staples = data-hygiene, not a tool feature (decided 2026-06-09):** Pantry presence is authoritative, so a recipe's `1/4 tsp salt` surfaces in `not_in_pantry` whenever salt isn't in `pantry.toml`. The resolution is to keep `pantry.toml` reasonably complete on staples — **not** to give the tool an assumed-present staple list. The bet: making pantry updates easy and conversational, plus the routine "still good?" / "did you run out?" check-up prompts, keeps the staples list honest and turns drift into a caught-and-corrected loop rather than a silent gap. This is the drift-catcher working as designed (CLAUDE.md explicitly wants staples/spices surfaced).

**Open questions for the proposal pass:**
- **Return-shape contract sync.** The new shape (`in_pantry` with age metadata + `possible_matches` + `not_in_pantry` + `inventory_substitutes_available`, **`have_stale` dropped**, per-recipe attribution on the candidate aggregate) differs from `docs/TOOLS.md`'s current four-bucket `have_fresh`/`have_stale`/… shape — confirm and sync TOOLS.md in the same pass.

**Dependencies:** Change 07. Reuses the Change 05 `normalizeIngredient`/alias base; no new Kroger work beyond sale-mode substitution reads.

**Deliverables:**
- `parseRecipeIngredient()` (strip qty/unit/prep/parenthetical/price; detect `optional` marker) + reuse of the existing `normalizeIngredient`/alias step, with unit tests over real corpus lines
- `verify_pantry_for_recipe`, `verify_pantry_for_candidates` returning `in_pantry` (exact, with age metadata) + `possible_matches` (fuzzy candidates for LLM confirm) + `not_in_pantry` + `inventory_substitutes_available`; **no `have_stale` bucket** (freshness LLM-judged); optional ingredients tagged non-blocking; candidate aggregate carries per-recipe `for_recipes` attribution
- `propose_substitutions` (inventory + sale modes) — deterministic rule application over `substitutions.toml`; sale mode fetches Kroger flyer/price internally
- Updated CLAUDE.md menu-request orchestration: comprehensive pantry confirmation pass; confirm `possible_matches`; ask before adding missing optional ingredients; suggest `aliases.toml` seeding on confirmed fuzzy matches; inventory-mode substitutions surfaced during the pass, sale-mode held for the menu proposal; note sequencing arrives with Change 13
- `docs/TOOLS.md` synced for the refined verify return shape; `suggest_sequencing` left as a contract entry tagged "built in Change 13"
- Tests: parser (incl. optional detection), exact + fuzzy matching (`possible_matches`), age-metadata surfacing (no staleness classification), candidate aggregation/attribution, substitution rule application (seeded fixture rules)

**Done when:** A recipe-seeded menu request walks the pantry comprehensively (exact + fuzzy `possible_matches` for the LLM to confirm, age-surfaced freshness prompts, optional ingredients asked-not-assumed), produces a clean presence-based to-buy list, and applies any seeded substitution rules — all conversationally. Sequencing is explicitly **not** part of this change's done-criteria.

---

## Change 09: Menu generation — full flow with Kroger context + LLM proposal

**Scope:** Wire the full menu-request flow: pre-pass gathering of `kroger_flyer`, `kroger_prices`, `ready_to_eat_available`, `read_preferences`, `read_taste`. Update AGENT_INSTRUCTIONS.md so Claude assembles all context and reasons about menus including freeform constraints ("comfort food one night"), meal-prep callouts, sale-based substitutions, ready-to-eat opportunity buys.

**Recipe-discovery thoroughness (observed 2026-06-09, Change 08 smoke test):** `list_recipes` has **no free-text search** — it filters by status/protein/tags only, so matching a user's named dish ("let's make chicken and rice") to the corpus is pure LLM judgment over the filtered list. In smoke testing, a recipe-seeded request listed the 15 active chicken recipes but surfaced only two ethnic-named chicken-rice dishes (Arroz Caldo, Galinhada Mineira), **under-counted** ("you've got two") and silently skipped the recipe literally titled "Chicken and Rice." The data and tools were correct; the gap is the selection/framing step. AGENT_INSTRUCTIONS.md guidance here should make the agent scan titles/tags exhaustively when the user names a dish (don't vibe-match a couple), and either disambiguate among all genuine matches or confirm which one before walking the pantry. Consider whether a lightweight title/text match belongs in `list_recipes` or stays an LLM responsibility.

**Dependencies:** Change 08.

**Deliverables:**
- Updated AGENT_INSTRUCTIONS.md with full menu-generation orchestration
- Conversational test of open-ended ("make me a menu") and recipe-seeded flows
- Agreed-menu items appended to `grocery_list.toml` via `commit_changes` (06); cart populated via `place_order` (06b) when you're ready to order

**Done when:** An end-to-end menu request from a fresh conversation produces a useful menu proposal, you iterate with revisions, you agree, and the Kroger cart populates. The first real cycle works.

---

## Change 10: Discovery + disposition

**Scope:** Implement `fetch_rss_discoveries`, `import_recipe`, `create_recipe`, and the draft-state import behavior. Update AGENT_INSTRUCTIONS.md so discovery surfaces 1-2 recipes and 1-2 ready-to-eat items per menu request, always imported in draft state. (Built via the `discovery-and-disposition` OpenSpec change.)

**Decisions (decided 2026-06-10, explore + apply):**
- **`fetch_flyer_featured` is cut.** Kroger's public API has no "featured"/circular primitive — only `promo > 0`, which `kroger_flyer` already synthesizes. On-sale ready-to-eat discovery instead rides the existing `kroger_flyer` pre-pass (ready-to-eat terms added to `flyer_terms.toml`) + agent-side dedup against `ready_to_eat/*.toml` + `add_draft_ready_to_eat`.
- **`import_recipe` is parse-only; `create_recipe` is the writer.** JSON-LD never carries the project's judgment fields, so the parsed data goes back to the LLM, which cleans/classifies, assembles the `## Ingredients`/`## Instructions` body (H2 contract guaranteed by construction), and persists via `create_recipe` — one solo commit per recipe.
- **`fetch_rss_discoveries` returns a candidate pool with no taste `score`.** Taste fit + the final 1–2 pick are LLM judgment (facts-from-tool, judgment-from-LLM); the tool does deterministic fetch + corpus dedup + URL canonicalization.
- **Parsing is runtime-agnostic.** RSS/Atom via `fast-xml-parser` (real XML parser, unit-tested in Node); JSON-LD extraction via `HTMLRewriter` (workerd) with a pure, fully-tested normalizer for the instruction/duration/yield shapes. No `recipe-scraper`/`cheerio`.
- **Bot-walled/paywalled sources** (Serious Eats, Food52, NYT) confirmed unreachable from the Worker even with browser headers; recovering them is the push-based **Change 14** (newsletter email).

**Dependencies:** Change 09.

**Deliverables:**
- `feeds.toml` seeded with the 5 spike-validated feeds (Budget Bytes, RecipeTin Eats, The Woks of Life, The Kitchn, Bon Appétit); ready-to-eat terms added to `flyer_terms.toml`
- `fetch_rss_discoveries`, `import_recipe` (parse-only), `create_recipe` (solo-commit write) per docs/TOOLS.md
- JSON-LD recipe parse + normalize pipeline (`jsonld.ts`) and RSS/Atom parser (`feeds.ts`), unit-tested
- Draft-state + disposition behavior in AGENT_INSTRUCTIONS.md (incl. paste-to-import fallback for walled sources)
- Conversational test of disposition: "rate the Budget Bytes one 4 stars", "remove that one"

**Done when:** Menu proposals include opportunistic discoveries; you can disposition them in subsequent conversations; the corpus grows over weeks without manual import work.

---

## Change 11: Variety + retrospection

**Scope:** Implement the `retrospective` tool. Add `diet_principles.md` with your variety rules. Update AGENT_INSTRUCTIONS.md so menu generation honors principles softly, explaining tradeoffs when it can't satisfy all of them. Add a conversational pattern for retrospectives.

**Dependencies:** Change 09. (Change 10 helps but isn't strictly required.)

**Deliverables:**
- `retrospective` tool returning structured cooking-history aggregates
- Populated `diet_principles.md`
- Updated AGENT_INSTRUCTIONS.md with variety reasoning patterns
- Conversational test of "how have I been eating this month?" and variety-aware menu requests

**Done when:** Menu proposals show awareness of variety principles without being naggy. Retrospectives surface useful patterns.

---

## Change 12 (Phase 7): Perishability refinement

**Scope:** Populate `ingredients.toml` with shelf-life data, and use it to **inform** verify's freshness prompting — not replace the LLM judgment with it. Per the Change 08 staleness decision, freshness stays an LLM-judged, prompt-resolved concern (storage context isn't in the repo); Change 12 adds a `past_typical_fresh_life` hint to verify's `in_pantry` items so the LLM raises the right "still good?" prompts more reliably. The return contract is unchanged — no `have_stale` bucket is reintroduced. Also add waste-tracking observation in menu generation ("this menu leaves 3/4 of a cilantro bunch unused — want a third recipe that uses it?").

**Dependencies:** Change 09. Change 11 helpful for context.

**Deliverables:**
- Populated `ingredients.toml`
- `verify_pantry_*` tools surface a `past_typical_fresh_life` hint from `ingredients.toml` (informs the LLM's prompting; does not classify or gate)
- Cross-recipe waste callouts in menu generation
- Updated AGENT_INSTRUCTIONS.md

**Done when:** Less produce going bad in the fridge; occasional useful "consider swapping recipe X for Y, less waste" suggestions.

---

## Change 13: Component vocabulary registry + sequencing

**Scope:** Introduce a canonical component vocabulary so `uses_components` / `produces_components` slugs stay consistent across recipes and over time, **and build `suggest_sequencing` on top of it** (moved here from Change 08 — see the data-readiness reframe under that change). `suggest_sequencing` matches components by exact slug, so drift (`fresh-pasta` in one recipe, `pasta-dough` in another) silently breaks sequencing links — which is precisely why the tool belongs with the vocabulary that prevents the drift, not before it. Add a source-of-truth registry file, document it in `docs/SCHEMAS.md`, extend validation to flag component references not in the registry, update AGENT_INSTRUCTIONS.md so the agent consults the registry when wiring components (and may extend it when a genuinely new component appears), and seed the vocabulary by reconciling the corpus. **This modifies the `data-validation` capability** (new soft/hard rule for unknown component references).

**Why sequencing moved here (decided 2026-06-09, explore session):** Building `suggest_sequencing` in Change 08 would have shipped a dormant tool — only 1/63 recipes declare a non-empty component today, so it returns `[]` for essentially every real input. Change 13's own thesis is that the vocabulary should be *seeded by corpus reconciliation, not designed in the abstract*; the tool that consumes the vocabulary should land with it. Change 08's menu-request flow tolerates an absent/empty sequencing result (it's a soft preference), so deferring loses nothing in the interim.

**Dependencies:** Change 08 (menu-request orchestration that calls sequencing) and a recipe corpus that actually declares components (the ReciMe import / `import-recime-corpus` change). Best **seeded by** that import's reconciliation pass rather than designed in the abstract — let the corpus reveal which components recur (realistically a small set, e.g. `fresh-pasta` feeding `lasagna-bolognese` / `uovo-in-raviolo`) before codifying the vocabulary.

**Deliverables:**
- `suggest_sequencing` tool: walk `produces_components` / `uses_components`, return strong matches only (`[]` when nothing fits), per `docs/TOOLS.md`
- A registry file (e.g. `components.toml`) listing canonical component slugs with descriptions
- `docs/SCHEMAS.md` entry for the registry
- Validation rule in `scripts/build-indexes.mjs`: warn (or fail) when a recipe references a component absent from the registry
- AGENT_INSTRUCTIONS.md guidance: consult the registry when setting `uses_components` / `produces_components`; extend it deliberately, don't coin variants; sequencing now live in the menu-request flow (step 3)
- Existing corpus reconciled to the canonical vocabulary
- `docs/TOOLS.md` sync (move `suggest_sequencing`'s "built in Change 13" tag to built)

**Done when:** Two recipes that should sequence together reliably share the same component slug, `suggest_sequencing` returns that pairing, and a typo'd or off-vocabulary component reference is caught at build time instead of silently failing to link.

**Notes:** Low urgency — only earns its keep once recipes are actually sharing components. Worth capturing now because the `import-recime-corpus` reconcile pass is the natural place to harvest the initial vocabulary, and because Change 08's reframe explicitly parks the sequencing tool here.

---

## Change 14: Newsletter discovery via inbound email

**Scope:** A *push*-based discovery source that complements Change 10's *pull* (RSS). Subscribe a dedicated inbox to recipe newsletters (Serious Eats, NYT Cooking, Bon Appétit, etc.); Cloudflare Email Routing delivers each message to an Email Worker that extracts candidate recipes (title, description, link), unwraps tracker-wrapped links to their canonical URLs, and persists them to an agent-readable inbox file surfaced at menu time. Because the teaser arrives *in the email*, this discovers from sources we cannot fetch — the bot-walled (Serious Eats, Food52) and paywalled (NYT) sites confirmed unreachable in Change 10. Full-recipe import still hits those walls, so the flow presents clean links and the user pastes the recipe to import.

**Why this exists (decided 2026-06-10, explore session):** Change 10's feed spike confirmed — from Cloudflare's actual edge egress, with full browser headers — that Serious Eats (403) and Food52 (429 Vercel) bot-wall the Worker via TLS/bot-management fingerprinting, *not* a UA check, so header spoofing can't recover them; NYT is paywall+login-gated. Pull discovery cannot reach these. Email inverts it: the publisher pushes content to us, so *discovery* becomes unblockable; only the optional full-recipe *import* fetch remains blocked, and that degrades gracefully to manual paste.

**Decisions:**
- **Dedicated spare domain, not the ProtonMail domain (decided).** Email Routing requires Cloudflare to manage the zone's MX records; repointing the in-use ProtonMail domain's MX would break existing email. Use one of the spare unused domains, added fresh to Cloudflare and dedicated to newsletter intake (e.g. `newsletters@<spare-domain>`). Easiest *and* isolates intake — touches nothing live.
- **Push via Email Routing → Email Worker (decided).** Inbound `email()` handler, not IMAP polling. No cron, no mailbox scraping.
- **Canonical-URL unwrapping is a core requirement, not a nicety (decided).** Newsletter links are wrapped in click-trackers (Mailchimp/SendGrid/publisher redirectors). The Worker SHALL resolve each to its canonical destination before storing: decode the destination from the tracker URL's path/query when it's encoded there (no network call), else follow the redirect from the Worker's egress and capture the final `Location` *without* downloading the (possibly walled) destination body. Rationale: Casey's home network runs a privacy DNS that blocks tracking redirectors, so wrapped links are broken on his network; the Worker runs on Cloudflare's network (not behind that DNS), so it unwraps once and Casey only ever sees clean, working URLs. High, concrete user-facing value.
- **Explicit sender allowlist (decided).** Only mail from known newsletter senders is processed into the inbox; everything else is dropped (spam + security). Curated, edit-when-directed config.
- **Persist to a flat inbox file (decided/proposed).** Parsed candidates land in a new agent-writable `discoveries_inbox.toml` (`{from, subject, received_at, candidates: [{title, summary, url}]}`), consistent with repo-as-database. Surfaced at menu time alongside `fetch_rss_discoveries`. v0 may store sender/subject/unwrapped-links and let the LLM present them; richer HTML parsing is incremental.
- **Import stays split; reuse `create_recipe` (decided).** Discovery is unblockable; full-recipe import still hits the same bot walls/paywalls, so the path is present-clean-link → user pastes recipe text → LLM assembles → `create_recipe` (already built in Change 10). No new import tool. The same paste-or-fetch-if-unblocked logic covers "check this article/listicle for recipes."

**Dependencies:** Change 10 (`create_recipe`, the discovery-surfacing menu step, the inbox-at-menu-time pattern). Independent of all Kroger work — buildable any time after 10.

**Deliverables:**
- A spare domain added to Cloudflare with Email Routing enabled; a route delivering allowlisted senders to the Email Worker
- Email Worker `email()` handler: sender-allowlist gate, MIME/HTML parse to candidates, tracker-link unwrapping (decode-or-follow), write to `discoveries_inbox.toml` via the commit engine
- `discoveries_inbox.toml` schema + `docs/SCHEMAS.md` entry; sender-allowlist config + `CLAUDE.md` curated-config line
- A read path surfacing inbox candidates at menu time (extend `fetch_rss_discoveries` or a sibling `read_discovery_inbox`)
- AGENT_INSTRUCTIONS.md: newsletter-discovery surfacing + the paste-to-import pattern (incl. NYT is paste-only) + "check this article" on request
- `docs/TOOLS.md` sync

**Done when:** A recipe newsletter sent to the dedicated address lands as inbox candidates with clean, *unwrapped* URLs (verified working behind the privacy DNS), the agent surfaces them at the next menu request, and pasting a chosen recipe imports it as a draft via `create_recipe`.

---

## Suggested ordering and parallelization

```
01 Repo skeleton
    ↓
02 Index generation + validation Action ──┐
    ↓                                     │
03 Recipe corpus migration                │
    ↓                                     │
04 Worker skeleton + read tools ←─────────┘
    ↓
    ├───────────────────────────┐
    ↓                           ↓
05 Kroger API +            06 Git write tools + atomic
   matching pipeline          commit + Access gate
    ↓                           ↓
    └─────────────┬─────────────┘
                  ↓
06b Order placement (cart + Kroger write-side OAuth)
                  ↓
07 Claude.ai connection + smoke test  ← milestone: agent live
    ↓
08 Pantry verification + substitution
    ↓
09 Full menu generation flow  ← milestone: real cycles working
    ↓
10 Discovery + disposition
    ↓
11 Variety + retrospection
    ↓
12 Perishability refinement
    ↓
13 Component vocabulary registry + sequencing
       (seeded by corpus reconciliation; builds suggest_sequencing, moved from 08)
```

**Parallelization options:**
- 02 and 03 can run in parallel after 01.
- **05 and 06 can run in parallel after 04** — 06 is repo-data + the Access gate (no Kroger), so it doesn't depend on 05. 06b then needs both. (In the current repo 05 is already done, so 06 is simply next.)
- 10 and 11 can run in parallel after 09.
- **Change 14 (newsletter email discovery) depends only on 10** — push-based complement to 10's RSS pull; buildable any time after 10, independent of Kroger work.
- **`suggest_sequencing` moved from 08 → 13** (decided 2026-06-09): it consumes the component vocabulary that 13 seeds, and would ship dormant if built earlier (1/63 recipes declare a component today). 08 is now pantry-verification + substitution only; the menu-request flow tolerates an absent sequencing result until 13 lands.

**Natural pause points** (where you'd want to actually use the system for a few weeks before continuing):
- After 07: confirm the architecture works end-to-end with simple flows
- After 09: confirm the full menu-request flow actually saves you time
- After 10: confirm discovery surfaces useful things at the rate you want

These pauses are important. Each phase produces something you can use; iterate based on real experience before committing to the next layer.

---

## What's NOT in this sequence

- A separate "release branch" for processed data (decided against)
- A CLI tool (decided against)
- iMessage, OpenClaw, Lobster, Dispatch, Cowork integrations (decided against)
- Background or scheduled triggers (event-driven only)
- Photo-based pantry check-ins (deferred as optional; could become Change 13+)
- Pages site for recipe search (deferred; the indexes already enable it when you want to add)
- Recipe scaling for solo cooking (lunch_strategy: leftovers handles it for v1)
- Multiple grocers beyond Kroger (the `skus/` directory leaves room but only Kroger has API access)

Add to the sequence later as the system actually proves useful and reveals what's missing.
