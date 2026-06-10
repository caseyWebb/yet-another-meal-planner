## 1. Parsing foundation (workerd-safe)

- [x] 1.1 RSS/Atom parser in `feeds.ts` using `fast-xml-parser` (a real XML parser — pure JS, runs on workerd + Node, unit-testable). Handles RSS 2.0 / Atom / RSS 1.0, CDATA, `<link>` text and Atom `<link href rel>`, returning `{ title, link, summary }[]`
- [x] 1.2 JSON-LD extraction in `jsonld.ts` via `HTMLRewriter` (`extractJsonLd(res)`, workerd) — collect all `<script type="application/ld+json">` blocks, `JSON.parse` each (skip unparseable); pure `findRecipe` walks `@graph`/arrays recursively and matches `@type` *containing* `"Recipe"` (string **or array**)
- [x] 1.3 Implement the `Recipe`-shape normalizer per design D5: `recipeInstructions` as `HowToStep[]` / `HowToSection[]` (flatten `itemListElement`) / **mixed** / `HowToTip`-inner sections / plain string; durations ISO minutes-hours **and `PT…S` seconds** **and** non-ISO plain text (`"45 minutes"` → minutes or null); `recipeYield` string|number|array → scalar; `recipeIngredient` as `string[]`; absent `cookTime` tolerated
- [x] 1.4 Unit tests for the normalizer over fixture JSON-LD captured from the spike's validated feeds: Budget Bytes (`HowToStep`, top-level), RecipeTin Eats (`HowToSection`, `@graph`), The Kitchn (mixed `HowToStep`+`HowToSection`, `HowToTip`, `PT…S` seconds, 3 blocks), Bon Appétit (plain-text `totalTime`), plus a plain-string-instructions case
- [x] 1.5 Shared fetch helper sending browser-like headers (`User-Agent`, `Accept`, `Accept-Language`) used by both `import_recipe` and feed fetches (design D7 — hygiene, not a bot-wall bypass; no retry/evasion logic)

## 2. `import_recipe` tool (parse-only)

- [x] 2.1 Implement `import_recipe(url)` wiring fetch → JSON-LD extraction → normalizer; return structured data, write nothing, commit nothing
- [x] 2.2 Implement structured errors: `unreachable`, `no_jsonld`, `not_a_recipe`, `incomplete` (missing ingredients or instructions) per the design convention
- [x] 2.3 Register `import_recipe` in `worker/src/tools.ts`; unit tests for each error path and the happy path

## 3. `create_recipe` write tool

- [x] 3.1 Implement `create_recipe(frontmatter, body)`: derive/accept slug, serialize frontmatter (YAML) + body to `recipes/<slug>.md`, commit solo via the Change 06 atomic commit engine
- [x] 3.2 Slug-collision guard: return `{ error: "slug_exists", slug }` without overwriting an existing file
- [x] 3.3 (Optional) run the Worker's structural validation subset before commit as a backstop; register in `tools.ts`; unit tests for create + collision

## 4. `fetch_rss_discoveries` tool

- [x] 4.1 Implement `fetch_rss_discoveries()`: read `feeds.toml`, fetch each feed (via the 1.5 helper), parse items, attach `feed_weight`, return `{ candidates: [{ url, title, source, feed_weight, summary }] }` (no `score`); empty/absent feeds → `{ candidates: [] }`
- [x] 4.2 Canonicalize candidate URLs (strip query string — e.g. Woks of Life `?adt_ei=…` tracking param) before dedup and return, so both dedup and downstream `import_recipe` get clean URLs
- [x] 4.3 Tool-side dedup: exclude items whose canonical link matches any existing recipe's `source:` (read the recipe index / frontmatter)
- [x] 4.4 Register in `tools.ts`; unit tests for dedup, empty-config, and field shape (mocked feed responses)

## 5. Config seeding

- [x] 5.1 Seed `feeds.toml` with the 5 spike-validated feeds (Budget Bytes, RecipeTin Eats, The Woks of Life, The Kitchn `weight 0.7`, Bon Appétit `weight 0.8` — using BA's `/feed/recipes-rss-feed/rss`), with `name`/`tags`/`weight`. Do **not** add Serious Eats or Food52 (bot-walled, confirmed unrecoverable — see design D7 / roadmap Change 14) or Smitten Kitchen (no JSON-LD). Global-tail expansion (Korean/Indian/Filipino) is an open follow-up, not a blocker.
- [x] 5.2 Add ready-to-eat category terms to `flyer_terms.toml` (e.g. frozen meals, deli, rotisserie, prepared salads) so the existing `kroger_flyer` pre-pass surfaces RTE sales

## 6. Agent orchestration + docs

- [x] 6.1 Update `AGENT_INSTRUCTIONS.md`: un-gate the discovery section — surface ~1–2 recipe + ~1–2 RTE candidates per menu request, import recipes in draft (`import_recipe` → enrich → `create_recipe`), dedup RTE sales vs catalogs and draft via `add_draft_ready_to_eat`, plus the conversational disposition patterns ("rate the X one N stars" → active+rating; "remove that one" → rejected)
- [x] 6.2 Update `docs/TOOLS.md`: remove `fetch_flyer_featured`; add `fetch_rss_discoveries` (pool, no score), `import_recipe` (parse-only, returns + errors), `create_recipe` (write + solo commit + slug_exists)
- [x] 6.3 Update `ROADMAP.md` Change 10 entry: record the `fetch_flyer_featured` cut, the parse/write split (`import_recipe` + `create_recipe`), and the no-score decision

## 7. Verification

- [x] 7.1 `cd worker && npm run typecheck && npm test` green
- [x] 7.2 Live parsing smoke test (`discovery.live.test.ts`, `RECIPE_LIVE=1`): all 5 feeds parse and a real recipe page from each normalizes (covers fast-xml-parser, findRecipe/normalizeRecipe over real ISO+seconds+plain-text durations, `@graph`/`HowToSection`, tracking URLs).
- [ ] 7.2b **Manual, against the deployed Worker** (needs CD to ship + GitHub/Access creds — can't run headless here): MCP Inspector confirms the `HTMLRewriter` extraction path end-to-end, `import_recipe(<no-jsonld url>)` → `{ error: "no_jsonld" }`, `create_recipe(...)` lands a draft `recipes/*.md` in one real commit and rejects a duplicate slug, and `fetch_rss_discoveries` dedup excludes an already-imported source.
- [x] 7.3 `openspec validate "discovery-and-disposition"` passes; confirm `docs/TOOLS.md` ↔ implemented tool signatures have no drift
