## Why

The corpus is meant to grow — week over week, driven by what each member actually likes — but the current meal-plan flow loads the **whole active corpus** into context (`list_recipes({status:"active"})`) and lets the LLM reason over all of it. That is `O(corpus)` tokens on every menu turn: it does not scale as the corpus grows, and it is hostile to **free-tier Claude users** on tighter budgets and smaller, faster models (which also reason worse over a large undifferentiated dump). At the same time, today's only recipe text search is token-AND substring over title+tags — it cannot match on *vibe* ("cozy, warming, something for a rainy night"), which is exactly how menu requests are phrased.

We want to flip recipe selection from **dump-and-reason** to **distill → retrieve → compose**: the LLM reads the (bounded) context, distills it into a handful of searches, deterministic code retrieves a small ranked candidate set, and the LLM composes the plate over that. The expensive matching moves into the Worker (Workers AI embeddings + cosine), *off* Claude's token budget — so the determinism boundary doubles as a token boundary. This is delivered as an **experimental, invoke-by-name skill that runs beside the existing flow**, so it can be A/B'd against dump-and-reason before anything core changes.

## What Changes

- **New experimental meal-plan skill** (`semantic-meal-plan`, invoke-by-name; the production menu flow is unchanged) that: distills loaded context into K search specs, runs them, and composes a plate over the union of compact candidate lists. Each spec splits **vibe** (semantic) from **constraints** (facets), because variety/contrast is anti-similarity and cannot be a cosine query.
- **Embeddings-in-D1 semantic search** (option B): an `embedding` column on the D1 recipe table, populated by the build from an AI-written description; a `recipe_semantic_search` tool that **facet-prefilters in SQL, then cosines over the survivors**. The tool contract is **backend-agnostic** so a later swap to Cloudflare Vectorize is invisible to skills. Vectorize and fully-autonomous import are explicitly **deferred** behind measured triggers.
- **AI-generated brief description field** on recipe frontmatter (written in-session by the agent at import, human-editable in Obsidian) — NOT the scraped marketing copy. It is the single source of a recipe's "semantic identity": the embed source, the compact per-candidate context representation, the user-facing "why this dish," and the dedup signal.
- **Memoized `side_search_terms`** on recipe frontmatter (AI-written at import): the LLM captures *what side complements this main* once, so side selection becomes a plain semantic search (complementarity in the terms, similarity in the retrieval). Curated `pairs_with` stays as the deterministic high-confidence tier.
- **Aggressive in-session import** during meal planning: when a discovery matches the member's preferences, the agent imports it (with description) on the spot — riding the Claude subscription, **no API and no headless cron**. This keeps fresh material flowing and collapses disposition: **import = the "yes"**, no-import = stays a discovery, explicit "no" = suppress that URL.
- **Favorites k-NN taste re-rank**: retrieved candidates are re-ranked by max cosine similarity to the member's favorited recipes (multimodal-safe — nearest-liked, not a single centroid). Favorites also feed import-match judgment and the group signal.
- **BREAKING — replace the 1–5 star `rating` with a `favorite` boolean.** A crisp anchor set for k-NN, lower disposition friction, and a simpler group signal (`COUNT(favorites)` not `AVG(★≥4)`). Lost granularity is recovered from revealed preference (cook frequency in the cooking log). This **dissolves** the open `update_recipe`-vs-`rate_recipe` question into a trivial `toggle_favorite`.
- **Freshness/novelty boost** in retrieval: never-cooked (and not-cooked-recently) recipes are boosted so imported-but-untried recipes get their shot; window is **user-configurable** in preferences. Plus a "bit outside your usual" allowance in import/surface judgment to keep the loop from tightening into a filter bubble.

## Capabilities

### New Capabilities
- `semantic-recipe-search`: the embeddings-in-D1 layer — description/`side_search_terms`/`embedding` fields, the build-time embed projection, the backend-agnostic `recipe_semantic_search` tool (facet-prefilter → cosine), favorites k-NN re-rank, freshness boost, and the deferred Vectorize promotion trigger.
- `experimental-meal-planning`: the invoke-by-name distill → retrieve → compose skill, including aggressive in-session import with disposition-collapse, the vibe/facet split, the holistic-plate constraint, and the exploration allowance.

### Modified Capabilities
- `recipe-import`: import additionally generates the AI brief description and `side_search_terms`; supports aggressive in-session import of preference-matched discoveries.
- `recipe-discovery`: disposition collapses — the `draft` state is removed, import is the positive disposition, and "reject" becomes a per-tenant discovery-URL suppression.
- `data-write-tools`: **BREAKING** `rating` (1–5) → `favorite` (boolean); `toggle_favorite` replaces rating writes; per-tenant overlay shrinks toward a single boolean.
- `data-read-tools`: `list_recipes` favorite filter/return; the new semantic-search read surface and compact candidate shape.

## Impact

- **Depends on `d1-recipe-index`** (the D1 recipe table) — the `embedding` column and SQL facet-prefilter ride that slice; this change is sequenced **after** it. Pre-D1, the embedding has no clean home (a KV blob can't facet-prefilter), so this is gated on that landing.
- **Affected code:** `src/recipes.ts` (search path), `src/matching.ts` (relevance — unchanged, parallel path), a new `recipe_semantic_search` + embedding helper, `src/tools.ts` (tool registration), `scripts/build-indexes.mjs` (embed projection), recipe frontmatter schema, the D1 overlay table, `AGENT_INSTRUCTIONS.md` (the experimental skill + import flow).
- **New dependency:** Workers AI binding (`@cf/baai/bge-base-en-v1.5`, 768-dim) for in-Worker embeddings. No external embedding key, no Anthropic API spend (descriptions are written in the agent's session).
- **Docs:** `docs/ARCHITECTURE.md` (retrieve-first selection + the token boundary), `docs/SCHEMAS.md` (description/`side_search_terms`/favorite; drop rating), `docs/TOOLS.md` (`recipe_semantic_search`, `toggle_favorite`).
- **Migration:** existing `rating` → `favorite` (e.g. `★≥4 ⇒ true`), folded into the `d1-profile` overlay slice.
- **Deferred (explicit non-goals):** fully-autonomous cron import (the in-session path covers growth for now); the Vectorize backend (brute-force-in-D1 until a query is *measured* to need ANN); any negative/dislike anchor (favorite-only).
