## Why

The corpus only grows when Casey manually finds and imports recipes, and on-sale ready-to-eat options that aren't already cataloged go unnoticed. The system should surface a small, taste-relevant trickle of new recipes and ready-to-eat items as a side effect of normal menu requests — imported in draft so they accumulate without cluttering proposals — and let Casey disposition them whenever he wants. This is the Change 10 discovery + disposition loop from `ROADMAP.md`.

## What Changes

- **New `fetch_rss_discoveries()` tool** — reads `feeds.toml`, fetches the configured RSS/Atom feeds, dedups candidates against the existing corpus (by `source:` URL), and returns a deduped **candidate pool** (`url`, `title`, `source`, `feed_weight`, `summary`). It does **not** compute a taste `score` — taste fit and the final 1–2 pick are LLM judgment in the menu flow.
- **New `import_recipe(url)` tool — parse-only.** Fetches the page, extracts schema.org `Recipe` JSON-LD, and **returns structured data** (`title`, `ingredients[]`, `instructions[]`, `servings`, times, `source`). It writes nothing and commits nothing. Structured errors on unreachable / no JSON-LD / not-a-recipe.
- **New `create_recipe(frontmatter, body)` write tool** — persists an LLM-assembled draft recipe as `recipes/<slug>.md` with one solo commit per recipe. The `## Ingredients` / `## Instructions` H2 contract is guaranteed by construction (the LLM assembles the body), so no tool-side H2 gate is needed.
- **`fetch_flyer_featured` is cut** (it was never built). Kroger's public API has no "featured"/circular primitive — only `promo > 0`. Ready-to-eat sale discovery instead rides the existing `kroger_flyer` call in the menu pre-pass: `flyer_terms.toml` gains ready-to-eat category terms, and the agent surfaces on-sale RTE items, dedups them against `ready_to_eat/*.toml` (LLM-side), and drafts the good ones via the existing `add_draft_ready_to_eat`.
- **`feeds.toml` is seeded** with 5–8 feeds known to emit schema.org `Recipe` JSON-LD (so `import_recipe` works on their links).
- **Menu-generation orchestration gains a discovery step** — every menu request surfaces ~1–2 recipe candidates and ~1–2 RTE candidates, imported in draft immediately (not gated on expressed interest), plus the conversational disposition patterns ("rate the Serious Eats one 4 stars", "remove that one").
- **Docs sync** — `docs/TOOLS.md` (drop `fetch_flyer_featured`; add the three tools), `AGENT_INSTRUCTIONS.md` (un-gate the discovery section), `ROADMAP.md` (record the cut + tool split).

## Capabilities

### New Capabilities
- `recipe-discovery`: RSS-driven recipe discovery and disposition — feed reads with corpus dedup (`fetch_rss_discoveries`), URL JSON-LD parsing (`import_recipe`, parse-only), draft-recipe creation with solo commits (`create_recipe`), the draft lifecycle (draft → active/rejected via existing write tools), and structured error/parsing behavior on `workerd`.

### Modified Capabilities
- `menu-generation`: the menu pre-pass gains a discovery step — surface ~1–2 recipe + ~1–2 ready-to-eat candidates per request, import in draft immediately, dedup RTE sales against catalogs, and disposition conversationally. (Replaces the placeholder text that gated discovery on "ships with Change 10.")

## Impact

- **New Worker code** (`worker/src/`): RSS fetch/parse (workerd-safe XML), JSON-LD extraction via `HTMLRewriter`, `create_recipe` write + solo commit reusing the Change 06 commit engine. New tool registrations in `tools.ts`.
- **New dependency**: a pure-JS XML parser for feeds (`fast-xml-parser`, workerd-compatible) — to be confirmed in design.
- **Possible KV usage**: a short-TTL cache for RSS fetches (discovery fires every menu request against weekly-changing feeds) — decision deferred to design.
- **Config/data**: `feeds.toml` seeded; `flyer_terms.toml` gains RTE terms.
- **Docs**: `docs/TOOLS.md`, `AGENT_INSTRUCTIONS.md`, `ROADMAP.md`.
- **No change** to `recipe-import` (ReciMe bulk migration) — distinct capability, distinct lifecycle (`status: active` vs `draft`).
