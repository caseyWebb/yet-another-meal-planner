## 0. Prerequisite

- [x] 0.1 Archive `menu-generation-flow` first so the `query` requirement is synced into the live `data-read-tools` spec (this change modifies it) — done; live specs validate

## 1. Remove tags filter + add stopwords (code)

- [x] 1.1 In `worker/src/recipes.ts`, remove `tags` from `RecipeFilters` and delete the `tags` AND-match block in `filterRecipes`
- [x] 1.2 Add a `QUERY_STOPWORDS` set (`and`, `or`, `with`, `the`, `a`, `an`, `of`, `in`, `on`, `for`, `&`) + an exported `queryTokens()` that drops them; an all-stopword query reduces to zero tokens → no text narrowing
- [x] 1.3 In `worker/src/tools.ts`, remove `tags` from `recipeFiltersShape`; update the `list_recipes` description — name/keyword search is via `query` (title+tags, stopwords dropped); there is no tag filter
- [x] 1.4 `npm run typecheck` in `worker/` clean

## 2. Tests

- [x] 2.1 Replaced the `tags`-filter test with a `dietary`/`season` AND-match test; added a test that a passed `tags` is ignored (equals no-`tags`)
- [x] 2.2 `query: "chicken and rice"` returns the title-only "Chicken and Rice" + the tag-matched dish; the `and` stopword is dropped (without stripping, the tag-matched dish would be wrongly excluded)
- [x] 2.3 `query: "rice"` finds a title-only match (recipe titled "...Rice" with no `rice` tag)
- [x] 2.4 Stopword-only query (`"and the"`) applies no narrowing
- [x] 2.5 Passing `tags` is ignored (stripped) — result equals no-`tags` (covered by 2.1)
- [x] 2.6 `npm test` in `worker/` green — 160 passed / 4 skipped, recipes suite 17 tests

## 3. Docs + instructions sync

- [x] 3.1 `docs/TOOLS.md` `list_recipes`: dropped `tags` from the params object; updated the `query` note (single title+tags text search, stopwords dropped, deterministic)
- [x] 3.2 `AGENT_INSTRUCTIONS.md` named-dish guidance: search by `query` (no tag filter exists); title-only keyword findable; phrasing-robust via stopword dropping

## 4. Verify (optional live)

- [ ] 4.1 After deploy, `list_recipes({ query: "chicken and rice" })` returns Chicken and Rice + Arroz Caldo + Galinhada Mineira
