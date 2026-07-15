## MODIFIED Requirements

### Requirement: Cookbook search entry point

The `/cookbook` route SHALL accept an optional `q` query parameter. When `q` is absent or empty after trimming, the route SHALL render the alphabetical index of the **anonymous lens position** — the full attached corpus under the self-hosted profile, exactly the curated tier under SaaS — resolved through the shared lens enforcement point, never a per-surface visibility computation. When `q` is non-empty, the route SHALL render a server-rendered, keyword-ranked results page for that query over the same anonymously-visible set. The route SHALL remain open (no authentication) and read-only (GET/HEAD only). The search control SHALL be a server-rendered text input that functions without client-side script (submitting to `/cookbook?q=`), progressively enhanced by a first-party script into debounced, in-place search; the recipe-body page's strict no-script `Content-Security-Policy` SHALL be preserved (see "Content-Security-Policy posture").

#### Scenario: Empty query renders the anonymously-visible index

- **WHEN** `/cookbook` is requested with no `q` on a SaaS deployment
- **THEN** the alphabetical index contains exactly the curated-tier recipes; on a self-hosted deployment it contains the full attached corpus, as today

#### Scenario: Non-empty query renders keyword results within the lens

- **WHEN** `/cookbook?q=tacos` is requested
- **THEN** a keyword-ranked results page is rendered server-side over only anonymously-visible recipes, reusing the recipe-list UI

#### Scenario: Search works without client script

- **WHEN** the page is loaded with JavaScript disabled and the search input is submitted with `q=tacos`
- **THEN** the browser navigates to `/cookbook?q=tacos` and the server renders the ranked results

### Requirement: Anonymous relevance-only ranking

Because the cookbook is an open surface with no caller identity, cookbook search ranking SHALL use the keyword relevance score alone, with none of the per-tenant favourite, freshness, or pantry-overlap boosts applied by the agent-facing `search_recipes` tool — and its candidate membership SHALL be exactly the anonymous lens position (curated-only under SaaS; the full attached corpus under self-hosted). Every visitor SHALL receive the same ranking for the same query on a given deployment, and no query SHALL surface, count, or rank a recipe outside the anonymous lens.

#### Scenario: No per-tenant boosts

- **WHEN** two different visitors search the same query
- **THEN** they receive the same ranking, independent of any household's favourites, cooking history, or pantry

#### Scenario: Out-of-lens recipes cannot be surfaced by search

- **WHEN** a SaaS deployment holds a household-only recipe whose title exactly matches a visitor's query
- **THEN** neither the server `?q=` page nor the `/cookbook/search` JSON endpoint returns it, counts it, or reveals its existence in any way

## ADDED Requirements

### Requirement: Out-of-lens cookbook pages are indistinguishable from nonexistent

`/cookbook/<slug>` for a recipe outside the anonymous lens SHALL return a 404 byte-indistinguishable from the nonexistent-slug 404 — same status, same page, same response class — and SHALL perform no body read for the out-of-lens slug, so response behavior cannot become a slug-probing oracle. The same rule SHALL hold for every anonymous cookbook sub-resource addressed by slug (the body page and its Similar Recipes section).

#### Scenario: Hidden and missing slugs answer identically

- **WHEN** an unauthenticated visitor requests `/cookbook/<slug>` for an existing but anonymously-invisible recipe, and for a slug that has never existed
- **THEN** both requests produce indistinguishable 404 responses and neither reads a recipe body
