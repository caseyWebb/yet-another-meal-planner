# BUILD-SEQUENCE.md — OpenSpec Change Proposals

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

**Scope:** Initialize the repository structure exactly as specified in `PROJECT.md`. Create all directories, empty TOML files with header comments, README, gitignore, and commit CLAUDE.md + SCHEMAS.md + TOOLS.md at the root or under `docs/`.

**Dependencies:** None.

**Deliverables:**
- All directories from PROJECT.md's repo structure
- Stub TOML files with header comments and example commented-out entries per SCHEMAS.md
- `README.md` explaining the project and how to use the repo
- `.gitignore` (Node, OS, editor files, Worker secrets)
- CLAUDE.md, SCHEMAS.md, TOOLS.md, PROJECT.md committed at the root or under `docs/`
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

**Scope:** Import an initial 30-50 recipes from existing sources (ReciMe, personal notes, bookmarked URLs) into `recipes/*.md` with proper frontmatter per SCHEMAS.md. This is partly manual data work; the implementation aspect is small.

**Dependencies:** Changes 01 and 02 (validation needs to pass).

**Deliverables:**
- 30-50 well-formed recipe markdown files
- All recipes with status: active (these are your starting corpus)
- Indexes regenerate cleanly via the Action
- Pre-commit hook validation passes

**Done when:** Browsing `recipes/` in Obsidian on phone shows your real recipes with rendered frontmatter. The corpus is searchable client-side via Obsidian.

**Notes:** Don't aim for perfect frontmatter — `last_cooked` can be null for everything initially, `rating` can be null, `meal_preppable` can default to false. Refine as you cook them and the agent learns.

---

## Change 04: Worker skeleton + read-only data tools

**Scope:** Bootstrap a Cloudflare Worker in `worker/` with TypeScript, the MCP SDK, and the basic plumbing. Implement the **read-only** tools from TOOLS.md: `list_recipes`, `read_recipe`, `read_pantry`, `read_preferences`, `read_taste`, `read_diet_principles`, `ready_to_eat_available`. Set up GitHub API client. Deploy via Wrangler. Test via MCP Inspector.

**Dependencies:** Change 01 (structure), Change 03 (some recipes to read). Change 02 not strictly required but helpful (`_indexes/recipes.json` enables `list_recipes`).

**Deliverables:**
- `worker/` directory with full TypeScript Worker source
- `worker/wrangler.toml` and deployment config
- GitHub API client wrapper (handles auth, rate limiting, basic retries)
- All read tools per TOOLS.md, returning structured JSON
- Wrangler-deployed Worker at `grocery-mcp.<your-subdomain>.workers.dev`
- README in `worker/` explaining local dev and deploy

**Done when:** You can invoke `list_recipes({ status: "active" })` from MCP Inspector and see your migrated recipes returned as JSON.

---

## Change 05: Kroger API integration + matching pipeline

**Scope:** Implement the Kroger-facing tools inside the Worker: `kroger_flyer`, `kroger_prices`, `kroger_search` (internal helper), and the headline `match_ingredient_to_kroger_sku` with its full 7-step deterministic pipeline. Sign up for the Kroger Developer account, complete OAuth (auth code flow), store tokens as Worker secrets. Append new SKU mappings to `skus/kroger.toml` via the GitHub API.

**Dependencies:** Change 04.

**Deliverables:**
- Kroger Developer credentials configured as Worker secrets
- OAuth flow handler (probably a small auth route in the Worker for the initial token exchange; refresh handled automatically)
- All Kroger tools per TOOLS.md
- The 7-step matching pipeline as specified in PROJECT.md
- SKU cache writes via GitHub API
- Tests for the matching pipeline (canonicalization, cache, narrowing, tiebreaker, LLM-fallback signal)

**Done when:** `match_ingredient_to_kroger_sku("extra virgin olive oil")` returns a confident SKU with reasoning, or `ambiguous: true` with candidates. Cache populates after the first run.

---

## Change 06: Write tools + atomic commit

**Scope:** Implement the **write** tools from TOOLS.md: `update_recipe`, `update_pantry`, `mark_pantry_verified`, `add_draft_ready_to_eat`, `update_ready_to_eat`, the user-curated `update_*` tools, and the headline `write_cart_and_commit` + `commit_changes`. Implement atomic batched commits via GitHub's Git Data API (build a tree, create commit, update ref) instead of sequential file commits.

**Dependencies:** Changes 04 and 05.

**Deliverables:**
- Write tools per TOOLS.md
- Atomic batched commit implementation
- Cart-write integration with Kroger (cart_add subroutine inside `write_cart_and_commit`)
- Validation that updates pass schema checks before commit
- Tests for the atomic-commit path

**Done when:** A single tool call can write a Kroger cart, update multiple recipes, verify pantry items, and create one clean git commit summarizing all of it.

---

## Change 07: Claude.ai connection + first conversational flow

**Scope:** Connect the deployed Worker to Claude.ai as a custom connector. Add the GitHub MCP connector. Create the "Grocery Agent" project and paste CLAUDE.md into project instructions. Validate basic conversational flows end-to-end: "what's in my pantry?", "show me chicken recipes", "I ran out of olive oil", "rate the salmon thing 4 stars".

**Dependencies:** Changes 04, 05, 06.

**Deliverables:**
- Custom MCP connector configured in Claude.ai account settings
- "Grocery Agent" project created with CLAUDE.md as instructions
- GitHub MCP enabled in the project
- Manual test transcript of basic flows working end-to-end
- Any necessary fixes to CLAUDE.md or tool descriptions discovered through testing

**Done when:** From your phone, you can open Claude.ai, start a fresh conversation in the "Grocery Agent" project, and have a useful conversation about your pantry or recipes without things going off the rails.

**Notes:** This is a milestone change — it proves the architecture works end-to-end. Expect to iterate on CLAUDE.md as you see what Claude does with it.

---

## Change 08: Menu request flow — pantry verification + sequencing

**Scope:** Implement the deterministic menu-request foundation: `verify_pantry_for_recipe`, `verify_pantry_for_candidates`, `suggest_sequencing`, `propose_substitutions` (inventory and sale modes). Update CLAUDE.md to specify the comprehensive pantry confirmation pass and the sequencing/substitution timing rules. Test conversationally: "I want to make salmon and rice tonight" should walk the pantry, surface any questions, and suggest sequencing if relevant.

**Dependencies:** Change 07.

**Deliverables:**
- Tools per TOOLS.md
- Updated CLAUDE.md with menu-request orchestration
- Pantry confirmation pass surfacing have_fresh, have_stale, inventory_substitutes, not_in_pantry
- Sequencing pass via `uses_components` / `produces_components` references
- Inventory-mode substitutions surfaced during pantry pass; sale-mode held until later

**Done when:** A recipe-seeded menu request walks the pantry comprehensively, surfaces drift, suggests sequencing, and produces a clean to-buy list — all without you having to invoke specific commands.

---

## Change 09: Menu generation — full flow with Kroger context + LLM proposal

**Scope:** Wire the full menu-request flow: pre-pass gathering of `kroger_flyer`, `kroger_prices`, `ready_to_eat_available`, `read_preferences`, `read_taste`. Update CLAUDE.md so Claude assembles all context and reasons about menus including freeform constraints ("comfort food one night"), meal-prep callouts, sale-based substitutions, ready-to-eat opportunity buys.

**Dependencies:** Change 08.

**Deliverables:**
- Updated CLAUDE.md with full menu-generation orchestration
- Conversational test of open-ended ("make me a menu") and recipe-seeded flows
- Cart write at the end of an agreed menu via `write_cart_and_commit`

**Done when:** An end-to-end menu request from a fresh conversation produces a useful menu proposal, you iterate with revisions, you agree, and the Kroger cart populates. The first real cycle works.

---

## Change 10: Discovery + disposition

**Scope:** Implement `fetch_rss_discoveries`, `fetch_flyer_featured`, `import_recipe` (with JSON-LD parsing via `recipe-scraper` or similar), and the draft-state import behavior. Update CLAUDE.md so discovery surfaces 1-2 recipes and 1-2 ready-to-eat items per menu request, always imported in draft state.

**Dependencies:** Change 09.

**Deliverables:**
- `feeds.toml` populated with 5-8 RSS feeds
- Discovery tools per TOOLS.md
- JSON-LD recipe import pipeline
- Draft-state behavior in CLAUDE.md
- Conversational test of disposition: "rate the Serious Eats one 4 stars", "remove that one"

**Done when:** Menu proposals include opportunistic discoveries; you can disposition them in subsequent conversations; the corpus grows over weeks without manual import work.

---

## Change 11: Variety + retrospection

**Scope:** Implement the `retrospective` tool. Add `diet_principles.md` with your variety rules. Update CLAUDE.md so menu generation honors principles softly, explaining tradeoffs when it can't satisfy all of them. Add a conversational pattern for retrospectives.

**Dependencies:** Change 09. (Change 10 helps but isn't strictly required.)

**Deliverables:**
- `retrospective` tool returning structured cooking-history aggregates
- Populated `diet_principles.md`
- Updated CLAUDE.md with variety reasoning patterns
- Conversational test of "how have I been eating this month?" and variety-aware menu requests

**Done when:** Menu proposals show awareness of variety principles without being naggy. Retrospectives surface useful patterns.

---

## Change 12 (Phase 7): Perishability refinement

**Scope:** Populate `ingredients.toml` with shelf-life data. Refine pantry verification thresholds to use explicit data instead of LLM judgment. Add waste-tracking observation in menu generation ("this menu leaves 3/4 of a cilantro bunch unused — want a third recipe that uses it?").

**Dependencies:** Change 09. Change 11 helpful for context.

**Deliverables:**
- Populated `ingredients.toml`
- Updated `verify_pantry_*` tools using `ingredients.toml` thresholds
- Cross-recipe waste callouts in menu generation
- Updated CLAUDE.md

**Done when:** Less produce going bad in the fridge; occasional useful "consider swapping recipe X for Y, less waste" suggestions.

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
05 Kroger API + matching pipeline
    ↓
06 Write tools + atomic commit
    ↓
07 Claude.ai connection + smoke test  ← milestone: agent live
    ↓
08 Pantry verification + sequencing
    ↓
09 Full menu generation flow  ← milestone: real cycles working
    ↓
10 Discovery + disposition
    ↓
11 Variety + retrospection
    ↓
12 Perishability refinement
```

**Parallelization options:**
- 02 and 03 can run in parallel after 01.
- 10 and 11 can run in parallel after 09.

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
