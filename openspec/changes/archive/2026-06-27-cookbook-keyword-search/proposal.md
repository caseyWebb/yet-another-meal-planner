## Why

The semantic search shipped on the open `/cookbook` browse surface is a poor fit. A friend-group corpus of a few hundred recipes does not need vibe-matching to be findable, yet the semantic tier dragged in a Workers AI call per uncached query, a KV query-vector cache, a similarity floor to tune, and a graceful-degradation path — real machinery for a marginal win, and ranking the visitor can't predict or explain. Keyword ranking over the metadata the D1 index *already* carries (title, tags, protein, cuisine, course, …) is simpler, deterministic, and explainable. While we're here, the full-page-reload GET form is replaced with a debounced client-side search against a server endpoint, so results update in place as you type.

## What Changes

- **Remove the semantic tier.** No query embedding, no cosine, no similarity floor, no `cookbook:qvec:` KV cache, and no graceful-degradation-to-substring path (there is nothing to degrade *from*). The cookbook stops calling Workers AI and `loadRecipeEmbeddings` entirely.
- **Replace it with a keyword ranker** over the metadata already in the index (`title`, `tags`, `protein`, `cuisine`, `course`, `dietary`, `season`, `ingredients_key`, `description`): field-weighted token scoring + a query-coverage factor + a deterministic tie-break. The field weights are tunable constants, kept out of the spec'd contract (the way the cosine floor was).
- **New JSON search endpoint** `GET /cookbook/search?q=` returning the ranked rows.
- **Debounced client-side search.** A small script served at `/cookbook/search.js` debounces the input, fetches the endpoint, drops stale in-flight responses, and patches the results list in place — no full-page re-render.
- **Progressive enhancement.** The server `/cookbook?q=` page still renders a full keyword-ranked results page (shareable URLs, no-JS fallback); the script enhances it. An empty query still renders today's alphabetical index.
- **CSP split.** The index/search page relaxes to `script-src 'self'; connect-src 'self'`; the recipe-body page `/cookbook/<slug>` — which renders untrusted author/agent markdown — keeps the strict no-script CSP unchanged.

Not user-breaking: `recipe_site_url` still resolves `<origin>/cookbook`, recipe links are unchanged, and onboarding still points members at the same place.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `cookbook-search`: replace the two-tier hybrid (substring + semantic) ranking, the query-vector cache, the embedding-dependent graceful degradation, and the no-script server-form contract with **keyword field-weighted ranking**, a **JSON search endpoint**, **debounced client-side search** (progressive enhancement over a server `?q=` page), and a **CSP split** that keeps the recipe-body render strict.

## Impact

- **Code**: `src/cookbook-search.ts` repurposed from the cosine merge into the pure keyword ranker; `src/cookbook.ts` loses the embedding/qvec wiring and gains the `/cookbook/search` JSON route, the `/cookbook/search.js` asset, the CSP split, and the client-enhanced index page; a new vanilla-JS client script; rewrites of `test/cookbook-search.test.ts` and `test/cookbook.test.ts`.
- **Storage**: removes the `cookbook:qvec:*` KV key family (orphaned keys self-expire via their TTL — no cleanup). **No D1 migration, no cron change.**
- **Workers AI**: the cookbook no longer touches the `AI` binding. The agent-facing `search_recipes` tool still uses it.
- **Untouched** (shared with `search_recipes`): `src/embedding.ts`, `src/semantic-search.ts`, the recipe-derived reconcile cron, the `recipe_derived.embedding` column, and `loadRecipeEmbeddings`.
- **Docs**: `docs/ARCHITECTURE.md` (the `/cookbook` route description) and `docs/SCHEMAS.md` (drop the `cookbook:qvec:` KV key family). No `docs/TOOLS.md` change — not an MCP tool.
