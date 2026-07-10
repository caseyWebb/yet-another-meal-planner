# Page 01 — Cookbook

Screens: `screens/nav-cookbook.png`, `screens/cookbook-search.png`.
Stories: 01 (friends lens, curated set), 06 (RecipeRow primitive).

## 1. Design summary

One unified, filterable list replaces today's three browse sections (New & trending /
Picked for you / All recipes) and the separate `/favorites` route. Page = search bar →
global filter bar → "Recommended for you" promoted panel → flat organic list. Favorites
becomes an in-page toggle. Every row is the shared RecipeRow.

## 2. Functional requirements

**Search.** In-place search over title / description / protein / cuisine; result count
line (`N results for "q"`); "No matches" empty state ("Nothing matches "{q}". Try a
protein, a cuisine, or an ingredient."); clear button. Search mode replaces browse mode
(promoted panel hidden). Filters remain visible and AND onto search results. Keep the
current debounce-against-API behavior (mock's keystroke-search is in-memory only).

**Filter bar** (new). Cuisine select + Protein select (options derived from the visible
corpus — "All cuisines"/"All proteins" defaults) + Time segmented control (Any / ≤20 /
≤30 / ≤45). One global filter state applies to search results, the promoted panel
(per-row), the organic list, and the favorites view. "Clear" button appears only when a
filter is active; the filtered-empty state ("No recipes match these filters." /
"None of your favorites match these filters.") repeats an inline "Clear filters" link.
Recipes with no `time_total` fail any active time filter (confirm — open question).

**Recommended for you panel** (new packaging of existing signals). A visually distinct
panel captioned "Recommended for you", each row an ordinary RecipeRow plus an uppercase
**reason badge**: "Popular with Friends" (friend-lens cook activity — story 01), "Picked
for You" (favorites-centroid — exists), "Just Added" (new-for-me watermark — exists).
Promoted slugs are deduped out of the organic list below. Panel hides in search mode, in
favorites-only mode, and when zero promoted rows survive the filters (partial panels are
fine). Row count/refresh cadence: not fixed by the mock (hardcoded 3) — spec decides.
"Just Added" rule: new-for-me stays discovery-attribution-based (discovered_at +
discovery_matches), unchanged by visibility events — recipes newly visible through a
friend link surface via Popular-with-Friends/browse provenance, never as Just Added; the
curated set's initial landing carries real discovered_at and no member matches, so it
cannot flood the panel.

**Favorites-only toggle** (new; **control missing from mock markup** — logic, CSS, and
empty states all exist, and a comment says "Favorites now lives as a Cookbook tab").
Decide the control's form (filter-bar pill vs tab). Behavior: replaces the organic list
with filtered favorites, hides the promoted panel, swaps empty copy; zero favorites
overall → "No favorites yet / Tap the heart on any recipe to save it here." The
`/favorites` route retires (redirect).

**RecipeRow** (shared primitive, story 06). Body = title, optional description, facet
chips (protein kind-colored, cuisine, "{n} min"), optional promo badge slot, optional
trend chip slot — trend chips ship (D31), rendered only from the D31-guarded read with
household-counted copy ("cooked by N friend households"), never "cooked by 1 friend"
under SaaS. Actions: favorite heart (aria-pressed), plan
toggle (calendar icon; titles 'Add to my "Want To Cook" list' / 'On your "Want To Cook"
list — remove') adding an unscheduled dinner row (story 02 default).

**Cold-start / onboarding** (story 01 — not in mock; SaaS profile only per D9): an empty
cookbook must sell the three ways in — add friends, import with the agent, browse the
public curated set. Curated-set rows need visible provenance; a household-level setting
can suppress the entire curated tier from the household's lens (D13 amendment — one lens
rule + one setting), in addition to per-member `toggle_reject`. Under the self-hosted
profile "Popular with Friends" reads the friend lens over the implicit all-to-all graph,
i.e. it equals today's deployment-wide trending — one implementation, both profiles.
Browse and search consume the single D11 lens enforcement point — never a per-surface
visibility reimplementation.

## 3. Delta vs today

| Feature | Status |
|---|---|
| Search + empty states | exists (copy/count-line tweaks) |
| Filter bar (cuisine/protein/time) + clear | **new** |
| One flat list replacing browse sections | restructure |
| Promoted panel w/ per-row reason badges | **new packaging** of existing new-for-me/trending/picked-for-you |
| "Popular with Friends" reason | **new** (friend lens — story 01) |
| Favorites-only toggle replacing /favorites route | **new** |
| RecipeRow time chip, promo/trend slots, "Want To Cook" copy | tweaks/new slots |
| Reject/hide control | still absent (unchanged) |

Existing spec coverage: `member-app-differentiators` (browse slots ≈ reasons),
`cookbook-search`, `member-app-core`. Not specced: filter bar, favorites toggle, friends
reason, curated-set provenance.

## 4. Open questions

1. Favorites control form: filter-bar pill or tab row? (Mock comment says tab.)
2. Promoted panel sourcing: N rows, refresh cadence, one-per-reason or variable mix?
   Dismissability (mock has none)?
3. ~~Trend chips ("cooked by N friends") — ship or drop the slot?~~ — decided (D31):
   ship, from the guarded read with household-counted copy (§2).
4. Filter options: corpus-derived (mock) vs `src/vocab.js` canonical; hide empty options?
5. Time-filter behavior for recipes lacking `time_total` (mock: excluded).
6. URL state: which of query/filters/favorites-toggle live in search params (repo
   convention says all shareable state).
7. Unrendered "N of M match" count label — in or out?
