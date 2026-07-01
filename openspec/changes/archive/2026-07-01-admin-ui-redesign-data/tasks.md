## 1. Sequencing check

- [x] 1.1 Confirm `admin-ui-redesign-config`'s shared-corpus editors (`aliases`/`flyer_terms`/`feeds`/`senders`/`members`) are live (merged/archived) at `/admin/config/*` before removing `data.tsx`'s `/data/corpus` route to those tables — if not yet landed, sequence this change's route removal after it, or keep a temporary redirect
- [x] 1.2 Confirm `admin-ui-redesign-discovery`'s top-level Discovery area covers `discovery_candidates`/`discovery_senders`/`discovery_members`/`discovery_rejections` before removing `data.tsx`'s `/data/discovery` route — same sequencing caveat as 1.1

## 2. Recipes: hybrid search backend

- [x] 2.1 Add `searchRecipes(env, query, mode)` to `src/admin-data.ts`: keyword mode (AND-of-tokens over title/slug/protein/cuisine/course/tags/`ingredients_key`, joined against `recipeList`'s existing slug/title/status assembly); empty query returns the unranked corpus in either mode
- [x] 2.2 Add the hybrid branch: `embedText(env, query)` once per search (reuse `src/embedding.ts`, no new AI path), bulk-load `recipe_derived` rows with a non-null `embedding`, score via `cosineSimilarity` blended with keyword coverage, pick and document the blend weights and semantic-surfaced relevance floor as tunable constants (see design.md Open Questions for starting values)
- [x] 2.3 Return each hit as `{ slug, score, semantic }` (score/semantic `null`/`false` in keyword mode) for the list page to join against `recipeList`
- [x] 2.4 Unit tests: keyword-only matching (AND semantics, empty query), hybrid blending (semantic-surfaced flag, unembedded recipe excluded from hybrid but present in keyword), exactly one `embedText` call per hybrid search and zero AI calls for keyword mode

## 3. Recipes: list + detail presentation

- [x] 3.1 Rewrite the Recipes list SSR page: search input + Keyword/Hybrid segmented toggle (reusing the foundation's search/segmented pattern), paginated `Item`/`ItemGroup` rows with title, slug, `TierBadge` (projection status), facet chips (protein/cuisine/time), and — in Hybrid mode with a query — a relevance bar per row; wire pagination via the kit `Pager`
- [x] 3.2 Rewrite the Recipe detail SSR page: pipeline-state strip (index/description/embedding stage completion), derived description card, rendered body, attributed notes, `PrettyKV` renders of the R2 frontmatter and the D1 projection row, and a collapsible raw-markdown `<details>` panel — omitted entirely when `status === "orphaned"`
- [x] 3.3 Wire the cross-area recipe deep-link entry point (Members area's cooking-log/meal-plan/notes links to `/admin/data/recipes/<slug>`) to land directly on the Recipes tab with that slug's detail open — confirm this already works via the existing route shape, no new plumbing expected

## 4. Stores explorer

- [x] 4.1 Add `storeDetail(env, slug)` to `src/admin-data.ts`: the `stores` row by slug (chain/label/address/`location_id` unpacked from `extra`), `sku_cache` rows filtered to that store's `location_id` (empty when `location_id` is null), and `store_notes` grouped by first-tag (default `general`) into layout/location/stock/general buckets
- [x] 4.2 Add a `storeList(env)` (or extend an existing reader) returning every store with at least name/slug/chain/notes-count/SKU-count for the list rows
- [x] 4.3 Unit tests: identity unpacking from `extra`, SKU filtering by `location_id` (including the null/non-Kroger case), note grouping (including a note with no tags defaulting to `general`)
- [x] 4.4 Build the Stores list SSR page: `Item`/`ItemGroup` rows (store icon, name, slug, chain `Badge`, notes/SKU-count facet chips)
- [x] 4.5 Build the Store detail SSR page: `PrettyKV` identity block, a `DataTable` of cached SKUs (or the non-Kroger empty state), and note cards grouped under layout/location/stock/general headings

## 5. Guidance explorer

- [x] 5.1 Restyle the existing guidance browser (breadcrumb + folder/file rows, reusing `guidanceListing`/`guidanceObject` unchanged) with kit primitives and folder/file icons, matching `GuidanceScreen.jsx`'s structure — no new reader
- [x] 5.2 Confirm breadcrumb root-return and folder-descent still ride the existing `?gprefix=`/`?gpath=` query params (or migrate to path segments if cleaner — confirm against the rest of the Data area's routing convention)

## 6. Route cleanup

- [x] 6.1 Narrow `registerDataRoutes` in `src/admin/pages/data.tsx`: keep `/data` (→ Recipes), `/data/recipes`, `/data/recipes/:slug`, add `/data/stores`, `/data/stores/:slug`, keep/restyle the guidance routes; remove `/data/members`, `/data/members/:id`, `/data/corpus`, `/data/discovery`, `/data/system` (subject to the sequencing checks in section 1)
- [x] 6.2 Update the `DataShell`/`VIEWS` sub-nav constant to the three-tab Recipes/Stores/Guidance set
- [x] 6.3 Remove the now-dead `MembersListPage`/`MemberDetailPage`/`CorpusPage`/`TableViewPage`/`GuidanceBrowser`(old)/`TableTabs` components and their exports from `data.tsx` that no route reaches anymore; keep `DataTable`/`tierDetail` exports only if still used by a remaining page or its tests
- [x] 6.4 Prune `readTable`'s `TABLE_GROUPS`/`TABLE_SPECS` in `src/admin-data.ts` down to entries still reachable through a live route after this and the Config/Discovery redesigns (per design.md's Open Questions — leave `discovery`/`system` entries in place if inert rather than coupling this change to a System redesign; drop `corpus` group's `aliases`/`flyer_terms`/`feeds` only once confirmed redundant with Config's own reader path)

## 7. Docs & contract lockstep

- [x] 7.1 Update `docs/SCHEMAS.md` if `searchRecipes`/`storeDetail`'s shapes warrant documentation alongside the existing `recipeDetail`/`memberDetail` shapes (admin-internal readers, not MCP tool contracts — expect a short addition, not a new section)
- [x] 7.2 Confirm `docs/TOOLS.md` needs no change (no MCP tool contract is touched by this change)
- [x] 7.3 Update `src/admin/CLAUDE.md` only if a new presentational pattern is introduced beyond what's already documented (expect: none — SSR list/detail and kit composition are already-documented patterns)

## 8. Verification

- [x] 8.1 `aubr typecheck`
- [x] 8.2 `aubr test` covering `searchRecipes`, `storeDetail`, and the narrowed route set
- [x] 8.3 Manual check via `aubr dev`: Recipes Keyword/Hybrid toggle (including the semantic-surfaced badge and an unembedded recipe's keyword-only visibility), recipe detail's pipeline strip and raw-markdown collapse, Stores list/detail (including a non-Kroger store's empty SKU state), Guidance breadcrumb navigation, and that `/data/members`, `/data/corpus`, `/data/discovery`, `/data/system` are gone with no dead links pointing at them from elsewhere in the panel
