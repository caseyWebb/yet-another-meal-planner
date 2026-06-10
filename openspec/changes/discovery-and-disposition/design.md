## Context

Change 10 adds the discovery + disposition loop on top of a system that already has: the menu pre-pass (`menu-generation`) calling `kroger_flyer`/`ready_to_eat_available`/etc. in parallel; the Change 06 atomic batched-commit engine and write tools (`update_recipe`, `add_draft_ready_to_eat`, `update_ready_to_eat`); the recipe body H2 contract (`## Ingredients` + `## Instructions`, enforced by `scripts/build-indexes.mjs` on push); and `list_recipes(status: draft)` for surfacing drafts later.

The roadmap's original Change 10 sketch predates two settled doctrines: Change 05's finding that Kroger's public API exposes no "featured"/circular primitive (only `promo > 0`), and the Change 08 "facts from the tool, judgment from the LLM" split. The design below reconciles the tool surface down to what a deterministic tool can actually know.

The agent runs in Claude.ai against the Worker (`workerd`), which constrains library choices (no Node `Buffer`/`fs`; `HTMLRewriter` available; pure-JS deps only).

## Goals / Non-Goals

**Goals:**
- Surface a small, taste-relevant trickle of new recipes (RSS) and on-sale ready-to-eat items per menu request, imported in draft.
- Keep tools deterministic; leave taste-fit, classification, and the final pick to the LLM.
- Parse external recipe pages robustly on `workerd` and land conformant draft recipe files without breaking the build.
- Reuse existing machinery (Change 06 commit engine, `kroger_flyer`, `add_draft_ready_to_eat`, `update_recipe`/`update_ready_to_eat`) rather than re-inventing it.

**Non-Goals:**
- Tool-side semantic scoring/ranking of discoveries (LLM territory).
- A `fetch_flyer_featured` tool or any "featured" Kroger signal (no API primitive exists).
- Auto-activating or auto-rating discoveries (drafts only; user dispositions later).
- Touching the `recipe-import` (ReciMe bulk migration) capability.
- Background/scheduled discovery — discovery is event-driven off menu requests only.

## Decisions

### D1 — `import_recipe(url)` is parse-only; `create_recipe` is the writer
`import_recipe` fetches the page, extracts schema.org `Recipe` JSON-LD, and **returns structured data**; it writes nothing. The LLM cleans the data, classifies the project-vocabulary fields, and assembles the markdown body, then calls `create_recipe(frontmatter, body)` to persist.

- **Why:** the parsed data has to go back to the LLM anyway (JSON-LD never carries `protein`/`cuisine`/`style`/`tags`/`dietary`/`ingredients_key`/`meal_preppable`). Having the LLM assemble the body means the `## Ingredients`/`## Instructions` H2 contract is satisfied **by construction** — no tool-side H2 validation gate. Same facts-vs-judgment split as `verify_pantry_*` and the matcher.
- **Alternative considered:** `import_recipe` writes a skeleton draft itself, LLM enriches via `update_recipe` after. Rejected: two commits per import, and a bad/partial parse would commit a build-breaking recipe (missing H2 section) straight to `main`.

### D2 — `create_recipe` commits solo, one commit per recipe
`create_recipe` writes `recipes/<slug>.md` and commits via the Change 06 engine immediately — not staged into the end-of-session `commit_changes`.

- **Why:** discovery imports are independent units; per-recipe commits are simple and keep import idempotent-ish (a slug collision is a clean structured error, not a tangled batch). `recipe-import`'s "never overwrite" instinct applies: `create_recipe` SHALL refuse an existing slug rather than clobber.
- **Alternative considered:** stage-and-fold into the session commit. Rejected per the explore decision — extra coupling for no benefit; recipes can commit without staging.

### D3 — `fetch_rss_discoveries` returns a deduped candidate pool, no `score`
The tool fetches feeds, dedups against the corpus (candidate link vs recipe `source:` frontmatter), and returns `{ candidates: [{ url, title, source, feed_weight, summary }] }`. No taste `score`.

- **Why:** `taste.md` is freeform prose; a deterministic title-vs-prose score is the wrong-positioned-component pattern Change 08 rejected. Removing the score means the tool can no longer return "top 1–2" (ranking *was* the score) — so it returns a bounded pool and the LLM picks. `feed_weight` (from `feeds.toml`) is a legitimate tool-side number; it's passed through, not used to rank.
- **Dedup is tool-side and deterministic** (URL match against `source:`), because the LLM shouldn't eyeball it.

### D4 — `fetch_flyer_featured` is cut; RTE discovery rides `kroger_flyer` + agent
No dedicated tool. `flyer_terms.toml` gains ready-to-eat category terms; the existing menu-pre-pass `kroger_flyer` call surfaces on-sale items; the agent identifies RTE candidates, dedups them against `ready_to_eat/*.toml` (LLM-side), and drafts the good ones via the existing `add_draft_ready_to_eat`.

- **Why:** Kroger's public API has no "featured" signal — only `promo > 0`, which `kroger_flyer` already synthesizes. A separate tool would be redundant. The contract's `suggested_meal` field was always LLM judgment.
- **Trade-off:** RTE-catalog dedup moves from (hypothetical) tool-side to LLM-side. Acceptable for a soft discovery nudge; the agent already reads the catalogs.

### D5 — runtime-agnostic parsing (revised during apply)
JSON-LD: fetch HTML, extract `<script type="application/ld+json">` blocks by **regex** (not `HTMLRewriter`), `JSON.parse` each, then walk schema.org `Recipe`. RSS/Atom: a **hand-rolled string parser** (regex over `<item>`/`<entry>`, CDATA-aware, handling `<link>` element text and Atom `<link href>`). **No `HTMLRewriter`** (workerd-only → not exercisable in the Node test runner; the vitest config keeps the core "pure and runtime-agnostic") and **no new XML dependency** (`fast-xml-parser` was the candidate, but hand-rolling keeps deps thin and matches `parse.ts` choosing a manual frontmatter split over `gray-matter`). No `recipe-scraper` (Node/cheerio). Net: parsing is pure functions over strings, unit-tested in Node, identical on `workerd`.

The 2026-06-10 feed spike pinned the exact normalizer requirements (each keyed to a real feed, so they double as test fixtures — see tasks 1.3/1.4):
- **Recipe location:** top-level object (Budget Bytes, Woks of Life, Bon Appétit), inside an `@graph` array (RecipeTin Eats, The Kitchn), or a top-level array. Walk `@graph`/arrays recursively; **multiple `ld+json` blocks per page is normal** (RecipeTin 2, The Kitchn 3) — scan all. Match `@type` that *contains* `"Recipe"` — it may be a string **or an array of strings**.
- **`recipeInstructions` shapes:** plain `HowToStep[]` (Budget Bytes, Woks of Life, Bon Appétit); `HowToSection[]` whose `itemListElement` is `HowToStep[]` (RecipeTin Eats); **mixed `HowToStep` + `HowToSection` in one array**, and a section whose inner items are `HowToTip` not `HowToStep` (The Kitchn — don't assume section children are steps); and defensively a plain **string** (schema-legal, cheap to support). Read `text`; treat `name`/`url`/`image` as optional.
- **Durations** (`prepTime`/`cookTime`/`totalTime`): usually ISO minutes/hours (`PT5M`, `PT70M`), but also **seconds form `PT600S`** (The Kitchn — must parse `S`) and **non-ISO plain text `"45 minutes"`** (Bon Appétit — text fallback or graceful null). `cookTime` is frequently **absent** — don't require it.
- **`recipeYield`:** string|number|array — `["4","4 servings…"]`, `"4 servings"`, `"4"`, or `6`. Normalize to a sensible scalar.
- **`recipeIngredient`:** consistently `string[]` across every working site — safe to require.
- **URL canonicalization:** strip the query string before dedup/return — Woks of Life item links carry an `?adt_ei=…` tracking param.

### D7 — Worker sends browser-like headers, but bot walls are excluded, not bypassed
The Worker's outbound `fetch` (both `import_recipe` and feed fetches) SHALL send browser-like headers (`User-Agent`, `Accept`, `Accept-Language`). This is cheap hygiene and recovers sites that gate on headers alone.

- **Empirically confirmed (2026-06-10, `wrangler dev --remote` from Cloudflare's edge egress):** browser headers do **not** defeat Cloudflare Bot Management (Serious Eats → 403) or Vercel's checkpoint (Food52 → 429). These fingerprint TLS/HTTP-layer signals that a Worker cannot control. So header spoofing is hygiene, not a bypass.
- **Consequence:** Serious Eats and Food52 are **excluded** from `feeds.toml`, not worked around. Recovering discovery from those (and paywalled NYT) is the job of the push-based **Change 14** (inbound newsletter email), which never fetches the walled site. Do not add retry/fingerprint-evasion logic here.

### D6 — Structured errors, draft defaults
`import_recipe` returns structured errors per the project convention: `{ error: "unreachable" }`, `{ error: "no_jsonld" }`, `{ error: "not_a_recipe" }`, `{ error: "incomplete", missing: [...] }` (no ingredients or no instructions parsed). `create_recipe` returns `{ error: "slug_exists", slug }` on collision. Discovery imports default `status: draft`, `discovered_at` set, `discovery_source` set (feed name); the LLM supplies these in the frontmatter it passes to `create_recipe`.

## Risks / Trade-offs

- **JSON-LD coverage is uneven across the web** → seed `feeds.toml` only with feeds whose recipe pages are *verified* schema.org `Recipe` emitters (the 2026-06-10 spike validated Budget Bytes, RecipeTin Eats, Woks of Life, The Kitchn, Bon Appétit; it rejected Smitten Kitchen — WP Recipe Maker emits **0 `ld+json`**, microdata only — and Maangchi — `@graph` has no `Recipe`). `import_recipe` fails cleanly (`no_jsonld`/`not_a_recipe`) on the rest rather than half-parsing.
- **Discovery fires every menu request** against weekly-changing feeds → repeated feed fetches add latency and load. Mitigation candidate: a short-TTL KV cache for RSS responses (see Open Questions). `import_recipe` is only called on the 1–2 the LLM picks, so its cost is bounded.
- **LLM-side RTE dedup is non-deterministic** → the same sale might occasionally re-surface or get missed. Right failure mode for a soft nudge (worst case: one "already have that").
- **Feeds carry non-recipe items** (confirmed live 2026-06-10): RecipeTin announcements, The Kitchn articles, Bon Appétit `/gallery/` listicles all appear in the pool, so `import_recipe` returns `no_jsonld`/`not_a_recipe` for some candidates. Expected, not a bug — the agent picks recipe-looking candidates and skips failed imports (AGENT_INSTRUCTIONS step 5). The live smoke test (`discovery.live.test.ts`) scans several items per feed rather than assuming the first is a recipe.
- **LLM-assembled body could still drift from the H2 contract** if the agent misbehaves → the post-push `build-indexes.mjs` validator remains the backstop (fails the build, names the file). `create_recipe` MAY also run the Worker's Change 06 structural validation subset.

## Open Questions

- **RSS XML parser dependency**: confirm `fast-xml-parser` runs clean on `workerd`, or fall back to an `HTMLRewriter`-based extraction. Resolve during implementation.
- **KV caching for RSS**: add a short-TTL (e.g. 6–24h) KV cache for feed fetches, or accept per-request fetches in v1 (consistent with Change 04's "no cache until latency is felt")? Lean toward measuring first, adding only if discovery noticeably slows the menu pre-pass.
- **Mechanical vs deferred frontmatter split** in `import_recipe`'s return: confirm the exact field set the parser fills (`title`, `ingredients[]`, `instructions[]`, `servings`, `time_total`/`time_active`, `source`, `yield`) vs leaves to the LLM (everything judgment-based).
- **Feed selection — partially resolved.** 5 feeds validated by the spike and seeded (Budget Bytes, RecipeTin Eats, Woks of Life, The Kitchn, Bon Appétit). **Open:** the global tail (Korean/Indian/Filipino/Brazilian) is thin — Maangchi (Korean) failed, and the bot-walled sites can't fill it. Whether to spike additional global feeds before shipping, or ship the 5 and add later (feeds.toml is editable config), is undecided. RTE category terms for `flyer_terms.toml` still to pick.
