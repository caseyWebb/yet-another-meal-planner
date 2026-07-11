# cookbook-search Specification

## Purpose

Keyword search for the open, anonymous `/cookbook` browse site: a deterministic, field-weighted ranker over the indexed recipe metadata, exposed both as a server-rendered `?q=` page (the no-JS fallback) and a JSON endpoint that a debounced, first-party client script renders in place — under a Content-Security-Policy that keeps the untrusted recipe-body render script-free.
## Requirements
### Requirement: Cookbook search entry point

The `/cookbook` route SHALL accept an optional `q` query parameter. When `q` is absent or empty after trimming, the route SHALL render the existing alphabetical index unchanged. When `q` is non-empty, the route SHALL render a server-rendered, keyword-ranked results page for that query. The route SHALL remain open (no authentication) and read-only (GET/HEAD only). The search control SHALL be a server-rendered text input that functions without client-side script (submitting to `/cookbook?q=`), progressively enhanced by a first-party script into debounced, in-place search; the recipe-body page's strict no-script `Content-Security-Policy` SHALL be preserved (see "Content-Security-Policy posture").

#### Scenario: Empty query renders the full index

- **WHEN** `/cookbook` is requested with no `q`, or an all-whitespace `q`
- **THEN** the full alphabetical recipe index is rendered, as it is today

#### Scenario: Non-empty query renders keyword results

- **WHEN** `/cookbook?q=tacos` is requested
- **THEN** a keyword-ranked results page for "tacos" is rendered server-side, reusing the recipe-list UI

#### Scenario: Search works without client script

- **WHEN** the page is loaded with JavaScript disabled and the search input is submitted with `q=tacos`
- **THEN** the browser navigates to `/cookbook?q=tacos` and the server renders the ranked results

### Requirement: Anonymous relevance-only ranking

Because the cookbook is an open, cross-tenant surface with no caller identity, cookbook search ranking SHALL use the keyword relevance score alone, with none of the per-tenant favourite, freshness, or pantry-overlap boosts applied by the agent-facing `search_recipes` tool. Every visitor SHALL receive the same ranking for the same query.

#### Scenario: No per-tenant boosts

- **WHEN** two different visitors search the same query
- **THEN** they receive the same ranking, independent of any tenant's favourites, cooking history, or pantry

### Requirement: Keyword field-weighted ranking

A non-empty query SHALL be answered by a deterministic keyword ranker over the recipe's indexed metadata fields — at least `title`, `tags`, `protein`, `cuisine`, `course`, `dietary`, `season`, `ingredients_key`, and `description`. The query SHALL be tokenized (lowercased, whitespace-split, stopwords dropped). Each token SHALL contribute a field-weighted score where higher-signal fields (title, tags, the `protein`/`cuisine` facets) weigh more than lower-signal prose (`description`), and an exact facet match weighs more than a substring match. A recipe's total score SHALL reflect how many distinct query tokens it matched across all fields (query coverage), so a recipe matching all query tokens ranks above one matching only some. Results SHALL be ordered by descending score and tie-broken deterministically (by title, then slug). A recipe that matches no query token SHALL be excluded. The specific field weights and match-kind multipliers are tunable constants and are NOT part of this contract.

#### Scenario: Named dish ranks first

- **WHEN** a query names a dish that exists by title, e.g. "tacos"
- **THEN** the recipe whose title matches appears ahead of recipes that merely mention the term in a lower-weight field

#### Scenario: Coverage orders full matches above partial

- **WHEN** a two-token query is run and recipe A matches both tokens while recipe B matches only one (with otherwise comparable field hits)
- **THEN** recipe A is ranked above recipe B

#### Scenario: Facet keyword is matched

- **WHEN** a query is "thai" and a recipe carries `cuisine: thai`
- **THEN** that recipe is surfaced via the cuisine facet even if "thai" does not appear in its title

#### Scenario: Zero-match recipe is excluded

- **WHEN** a recipe matches none of the query tokens in any indexed field
- **THEN** it does not appear in the results

#### Scenario: Deterministic ordering

- **WHEN** two recipes earn the same score for a query
- **THEN** they are ordered by title then slug, identically on every request

### Requirement: Keyword search endpoint and debounced client search

The route SHALL expose `GET /cookbook/search?q=` that returns the keyword-ranked results for `q` as JSON (an ordered list of result rows). The index/search page SHALL load a first-party script that, as the visitor types, debounces input, requests the JSON endpoint, discards stale or out-of-order responses, and updates the results list in place WITHOUT a full-page re-render. Clearing the query SHALL restore the alphabetical index view. The script SHALL render rows from the JSON data without using `innerHTML` for untrusted values.

#### Scenario: Endpoint returns ranked JSON

- **WHEN** `GET /cookbook/search?q=tacos` is requested
- **THEN** the response is JSON containing the keyword-ranked result rows in score order

#### Scenario: Typing updates results in place

- **WHEN** the visitor types a query on the enhanced page
- **THEN** the results list updates from the JSON endpoint without reloading the page

#### Scenario: Clearing the query restores the index

- **WHEN** the visitor clears the search input
- **THEN** the full alphabetical index is shown again

#### Scenario: Stale responses are discarded

- **WHEN** a newer query's request resolves before an older in-flight request
- **THEN** the older response is ignored and does not overwrite the newer results

### Requirement: No-JS progressive-enhancement fallback

The server-rendered `/cookbook?q=` results page SHALL be a complete keyword-ranked page, so search functions with client JavaScript disabled and the `?q=` URL is shareable. The client enhancement SHALL augment this page rather than replace it. The server page and the JSON endpoint SHALL use the same ranking, so their ordering for a given query agrees.

#### Scenario: No-JS results page

- **WHEN** `/cookbook?q=tacos` is requested with no client script running
- **THEN** the server renders the same keyword-ranked results that the JSON endpoint would return for "tacos"

#### Scenario: Server page and endpoint agree

- **WHEN** the same query is served by the server `?q=` page and by `/cookbook/search`
- **THEN** the two produce the same ordered set of recipes

### Requirement: Empty results state

When a non-empty query matches no recipe, the server `/cookbook?q=` page SHALL render a clean "no matches" state at HTTP 200 with a link back to the full index, and the `/cookbook/search` endpoint SHALL return an empty result list (HTTP 200), never an error.

#### Scenario: No matches renders an empty state

- **WHEN** a query matches no recipe in any indexed field
- **THEN** the server page renders a "no matches" message at HTTP 200 with a link back to the full cookbook, not an error

#### Scenario: Endpoint returns an empty list

- **WHEN** `/cookbook/search?q=` matches no recipe
- **THEN** the endpoint returns an empty JSON list at HTTP 200

### Requirement: Content-Security-Policy posture

The recipe-body page `/cookbook/<slug>`, which renders untrusted author/agent markdown to HTML, SHALL retain the strict no-script `Content-Security-Policy` (`default-src 'none'`, no `script-src`). The index/search page SHALL relax its CSP only enough to run first-party search: `script-src 'self'` (no `'unsafe-inline'` for scripts) and `connect-src 'self'`, admitting no third-party origins. The search script SHALL be served first-party (e.g. `/cookbook/search.js`).

#### Scenario: Body page stays script-free

- **WHEN** `/cookbook/<slug>` is rendered
- **THEN** its CSP contains no `script-src` allowance and the page contains no `<script>`

#### Scenario: Search page allows only first-party script and fetch

- **WHEN** the index/search page is rendered
- **THEN** its CSP allows `script-src 'self'` and `connect-src 'self'` with no `'unsafe-inline'` script and no third-party origins

#### Scenario: Injected inline script cannot execute

- **WHEN** a recipe title or description contains an inline `<script>` and is shown on the search page
- **THEN** the value is rendered inert (escaped / as text) and the CSP would block inline script execution regardless

### Requirement: Result rows carry the compact facet fields

The keyword ranker's compact result row SHALL carry the compact facet fields — the
shape shared by the anonymous `/cookbook/search` JSON endpoint and the member app's
cookbook index/search reads: `slug`, `title`, `description`, `protein`, `cuisine`, and `time_total`
(minutes, or `null` when the recipe has no authored total time — never fabricated), so
list surfaces can render facet and time chips and apply client-side facet filters
without a second read. This is additive: ranking, ordering, the no-JS fallback, and the
Content-Security-Policy posture are unchanged.

#### Scenario: A hit row carries its time facet

- **WHEN** a recipe with `time_total: 25` is returned by the search endpoint or the
  member cookbook index read
- **THEN** its row carries `time_total: 25` alongside `slug`/`title`/`description`/
  `protein`/`cuisine`

#### Scenario: Missing time is null, never invented

- **WHEN** a recipe has no `time_total` in the index
- **THEN** its row carries `time_total: null` and downstream time filters treat it as
  failing any time cap

