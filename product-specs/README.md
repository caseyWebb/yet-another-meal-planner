# Product specs — member app mockup (July 2026)

This directory is the **working product-spec set** distilled from the Claude Design mockup
bundle `Yet_Another_Meal_Planner.zip` (Member App + Grocery List / Meal Planning / Order
Review / Recipe Card / RecipeRow widgets, design system `@grocery-agent/ui`). It exists to
seed future OpenSpec changes; it is **not** part of the living contract in `openspec/specs/`
or the current-state docs in `docs/`. When a change ships, the relevant sections here are
superseded by the change's spec deltas — treat `openspec/specs/` as truth wherever the two
disagree.

## How to use this set

- **`00-overview.md`** — the full inventory: every mockup page, its delta classification
  (design tweak / in between / new feature), existing OpenSpec coverage, and a suggested
  sequencing with dependencies. Start here.
- **`stories/`** — cross-cutting features that emerge across pages. Each story is the
  shared model several pages depend on; page specs reference stories rather than
  re-deriving them. Stories carry the authoritative product decisions already made.
- **`pages/`** — one spec per mockup page/surface: functional requirements, delta vs. the
  shipped app, what existing specs already cover, resolved decisions, and open questions.
- **`screens/`** — renders of the mockup captured page-by-page (light theme, 1440px), the
  visual ground truth the specs cite. The interactive mockup source itself is not
  committed; re-request the design bundle if a surface needs re-inspection.

## Provenance and confidence

Functional behavior was extracted from the mockup's source (state logic, conditional
blocks, microcopy), not just screenshots — including states the screenshots don't show.
Where the mockup is internally inconsistent (mock bugs, vestigial code), the page spec
says so explicitly rather than speccing the bug. Open questions are genuinely open:
they need a product decision before or during proposal drafting, and are phrased so an
autonomous planning session can resolve them with a targeted question or a spike.

Four product steers from the operator (Casey, 2026-07-10) are baked in as decisions:

1. **Tenant becomes the household.** Productization direction: a tenant can hold multiple
   member accounts; per-tenant data (pantry, plan, grocery, stores) is household-shared
   because the tenant *is* the household. Friendships are tenant-to-tenant links.
2. **One monolithic corpus, visibility lenses, dedup + memoization everywhere.** Recipe
   visibility is an overlay, never data segmentation. Anything processed (fetch, parse,
   facet derivation, embeddings, match caches) is keyed by identity (URL/content hash) and
   computed once, no matter how many members touch it.
3. **Empty corpus on join, cushioned by the graph.** A new household starts with no
   inherited operator corpus. Friend links make existing recipes visible immediately, and
   a small product-maintained public curated recipe set is visible to everyone.
4. **The widgets are dual-use MCP Apps.** The standalone widgets (Meal Planning, Grocery
   List, Order Review, Recipe Card, RecipeRow) render both as member-app page components
   and as MCP Apps inside Claude conversations — one component, two hosts. The existing
   `meal-plan-widget` and `recipe-card-widget` specs are the precedent.

See `stories/01-households-and-friends.md` for the full social model and
`stories/06-dual-use-widgets.md` for the widget-hosting model.
