## MODIFIED Requirements

### Requirement: Cookbook browse and keyword search

The app SHALL serve a cookbook index endpoint (the shared recipe index projected to the compact hit shape — including `time_total` — title-sorted), a keyword search endpoint reusing the cookbook's field-weighted keyword ranking, and a new-for-me endpoint reusing the per-member discovery read with its last-planned watermark — every one of them over the caller's **visibility lens** (the shared enforcement point; under self-hosted this is the full attached corpus, today's behavior). Each index/search hit SHALL additionally carry its `provenance` for the caller's household — `own`, `friend`, or `curated`, the highest-precedence grant that admits it — so list surfaces can render curated (and later friend) provenance without a second read. Search SHALL be keyword-only — no request-time embedding — and SHALL keep the debounced-against-API behavior (the mock's in-memory keystroke search is a painted door, not a contract).

The browse page SHALL be **one unified, filterable list**: search bar → global filter bar → the promoted "Recommended for you" panel (see `member-app-differentiators`) → a single flat, title-sorted organic list over the caller's visible index. The page SHALL NOT render sectioned browse lists ("New & trending" / "Picked for you" / "All recipes"). Rows whose provenance is `curated` SHALL render a visible "Curated" badge on the shared RecipeRow (beside the facet chips, the promo-badge slot treatment).

**Filter bar.** A cuisine select and a protein select — options derived from the loaded (lens-visible) corpus (distinct non-null values, sorted, "All cuisines"/"All proteins" defaults), never from the authoring vocabulary — and a time segmented control (Any / ≤20 / ≤30 / ≤45). One global filter state SHALL apply to search results, the promoted panel (per-row), the organic list, and the favorites view. A recipe with no numeric `time_total` SHALL fail any active time filter — an unknown-time recipe is never claimed under a time budget. A "Clear" affordance and an "N of M match" count label SHALL render only while at least one filter is active; the filtered-empty states ("No recipes match these filters." / "None of your favorites match these filters.") SHALL repeat an inline "Clear filters" link.

**Search mode.** A non-empty query SHALL replace browse mode (the promoted panel hidden): a result-count line over the filtered results, the "No matches" empty state ("Nothing matches "{q}". Try a protein, a cuisine, or an ingredient."), and a clear button. Active filters SHALL remain visible and AND onto the search results.

**URL state.** All shareable page state — the query, the cuisine/protein/time filters, and the favorites view toggle — SHALL live in validated URL search params with default values stripped from the URL, so every combination is shareable and deep-linkable; loading such a URL SHALL reproduce the state. Transient input (the un-debounced search text) stays client-local.

#### Scenario: Search parity with the public cookbook

- **WHEN** a member searches the cookbook in the app
- **THEN** the results come from the same pure keyword ranker the public `/cookbook` search serves, returning the same hit shape — over the member's lens rather than the anonymous lens

#### Scenario: Browse renders only lens-visible rows

- **WHEN** a SaaS member browses the cookbook while a non-friend household holds recipes the member's household does not
- **THEN** those recipes appear nowhere on the page — not in the organic list, search results, filter option derivation, or the promoted panel

#### Scenario: Curated rows are badged

- **WHEN** the browse or search list renders a row whose only grant for the caller's household is the curated tenant's
- **THEN** the row carries the "Curated" provenance badge beside its facet chips

#### Scenario: One flat organic list replaces the browse sections

- **WHEN** the browse page renders with no query, no filters, and the default view
- **THEN** below the promoted panel there is exactly one flat, title-sorted recipe list over the visible index (minus rows displayed in the panel), with no section headings

#### Scenario: Filters narrow every surface with an honest time gate

- **WHEN** the member selects cuisine "italian" and time "≤30"
- **THEN** the organic list, the promoted panel's rows, the favorites view, and any search results show only italian recipes with a numeric `time_total` ≤ 30 — a recipe lacking `time_total` is excluded — and the "N of M match" count and Clear affordance render

#### Scenario: Filter and view state is shareable by URL

- **WHEN** a member loads a URL carrying query/filter/view search params (e.g. `/?cuisine=italian&time=30`)
- **THEN** the page renders with exactly that state applied, and interacting with the controls updates the URL params (defaults stripped) without a full reload

### Requirement: Whoami reports the deployment profile and operator identity

The whoami read (`GET /api/session`) SHALL additionally return `profile` — the deployment profile (`"self-hosted" | "saas"`) — and `operator: { name, repo }` — the operator's display name and plugin-marketplace repo slug — alongside the tenant identity, preserving the shared ETag contract. `profile` SHALL be resolved through the single Worker-side accessor that is the only site naming the profile source; the accessor SHALL read the `deployment_profile` value on the `operator_config` D1 singleton (the shipped configuration channel — see `shared-corpus`), resolving NULL/absent to `"self-hosted"`. `operator.name` SHALL come from the optional non-secret `OPERATOR_NAME` var, falling back to `OWNER_TENANT_ID`, else `null`; `operator.repo` from the optional non-secret `MARKETPLACE_REPO` var (stamped onto the deploy by the operator deploy workflow from the calling data repo — the data repo IS the marketplace), else `null`. Unset config SHALL yield explicit `null`s — never a fabricated slug or name.

#### Scenario: Whoami reflects the configured profile

- **WHEN** an authenticated member requests `GET /api/session` on a deployment whose `operator_config.deployment_profile` is `"saas"`
- **THEN** the response body carries `profile: "saas"` through the single accessor, and the response keeps its weak ETag / `If-None-Match` 304 behavior

#### Scenario: An unconfigured deployment reports self-hosted

- **WHEN** `GET /api/session` runs on a deployment that never wrote `deployment_profile`
- **THEN** whoami returns `profile: "self-hosted"` — the compiled default over the NULL column

#### Scenario: Unset operator config degrades to nulls

- **WHEN** `OPERATOR_NAME` and `MARKETPLACE_REPO` are unset (e.g. local dev) and `OWNER_TENANT_ID` is unset
- **THEN** whoami returns `operator: { name: null, repo: null }`, and with only `OWNER_TENANT_ID` set, `operator.name` is that tenant id

## ADDED Requirements

### Requirement: Cookbook cold-start onboarding states (SaaS)

Under the SaaS profile, the cookbook browse page SHALL render a cold-start onboarding treatment while the member's household owns zero non-curated imports and has not explicitly dismissed it (the deployment profile comes from whoami; the states never render under self-hosted):

- **Curated-floor state** (curated tier visible): an onboarding panel above the curated list with three compact action cards — "Add friends" (friends' recipes flow into your cookbook; links the People destination), "Import with the agent" (paste a recipe URL in a Claude chat and it lands here; opens the Connect-to-Claude modal when the member is not yet connected), and "Start from the curated set" (anchor-scrolls to the list; hearts and plan-toggles work on curated rows immediately). The curated rows below carry the "Curated" provenance badge.
- **True-zero state** (curated hidden by the household setting, or the curated tier empty): the same three cards carry the page with the fuller empty-illustration treatment consistent with the existing "No favorites yet" empty-state style, and no recipe list renders.
- In both states the "Recommended for you" panel and the filter bar SHALL be hidden.
- **Dismissal**: the panel SHALL disappear permanently once the household owns at least one non-curated import (a derived condition, no stored state), or on explicit dismiss — a persisted household-level flag written through the existing preferences path. A dismissed panel SHALL NOT return when the household later returns to zero own recipes unless the flag is cleared.

The states SHALL be covered by Playwright specs through the real seeded API: both variants, the badge, and dismiss persistence.

#### Scenario: A new SaaS household sees the curated-floor onboarding

- **WHEN** a member of a household with zero non-curated imports (curated visible) opens the cookbook on a SaaS deployment
- **THEN** the onboarding panel renders its three action cards above the curated list, curated rows are badged, and the Recommended panel and filter bar are absent

#### Scenario: The true-zero variant carries the page

- **WHEN** the same household has set curated-hide and owns no recipes
- **THEN** the page renders the three cards with the fuller empty treatment, no list, no filter bar, and no promoted panel

#### Scenario: The first own recipe retires the onboarding

- **WHEN** the household gains its first non-curated import (agent import, or later a sweep match)
- **THEN** the onboarding panel no longer renders and the standard browse page (filter bar, promoted panel when eligible) takes over

#### Scenario: Explicit dismiss persists for the household

- **WHEN** a member dismisses the onboarding panel and any household member reloads the cookbook later, still with zero own recipes
- **THEN** the panel stays dismissed (household-level persistence), and the curated list or true-zero empty state renders without it

#### Scenario: Self-hosted never sees onboarding

- **WHEN** any member opens the cookbook on a self-hosted deployment, regardless of corpus size
- **THEN** the cold-start states never render
