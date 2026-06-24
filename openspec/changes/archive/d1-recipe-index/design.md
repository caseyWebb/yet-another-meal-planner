## Context

The recipe index is a derived projection: `build-indexes.mjs` parses `recipes/*.md`, validates, and emits a deterministic map that today is published to `DATA_KV` as `index:recipes`. The Worker reads the whole blob and filters in JS (`filterRecipes` in `src/recipes.ts`). Per-tenant subjective fields (`status`/`rating`/`last_cooked`) are already stripped from the shared index and merged at read time from the overlay (KV bundle) and cooking log (GitHub). This slice moves the shared projection from a KV blob to a D1 table; the per-tenant merge inputs move in slices 2 (cooking log) and 4 (overlay).

## Goals / Non-Goals

**Goals:**
- The shared recipe index lives in a queryable D1 table, rebuilt by the build; the Worker reads it from D1.
- No behavior change to `list_recipes` filtering/output — same `RecipeIndex`, different source.
- Discovery's source-URL idempotency check becomes an indexed query, not a whole-index scan.
- Cleaner error semantics: empty corpus ≠ missing index.

**Non-Goals:**
- Pushing `filterRecipes` into SQL. Several filter inputs (`status`, `exclude_cooked_within_days`) are per-tenant and still external this slice; SQL-filtering arrives once overlay + cooking log are also in D1 (then `list_recipes` becomes one JOIN). Premature SQL filtering on half the inputs is the wrong sequencing.
- Moving recipe *content* — `recipes/*.md` and `read_recipe` stay on GitHub (the Obsidian premise).
- Removing `DATA_KV` — it still holds profile/session keys until later slices.

## Decisions

### Decision: derived projection → rebuild, not backfill

The build owns the table's contents and rebuilds them wholesale every recipe push, so there is **no `.mjs` data-backfill migration**. The schema is a `migrations/d1/*.sql` file; population is the existing build. The deploy already runs `build-indexes` immediately after deploy (the bootstrap guarantee from `recipe-index-kv`), so D1 is populated by the end of the first deploy exactly as KV was. This is the model for every *derived* slice (vs. *authored/operational* data, which needs a one-time backfill).

**Replace-all transaction:** `DELETE FROM recipes` + batched `INSERT` in one D1 transaction (`d1-rest` `exec`/batch) — atomic, matches the current "write the whole blob" semantics, and a removed recipe disappears (a UPSERT-only approach would leak deleted recipes). Deterministic input → deterministic rows.

### Decision: scalar columns + JSON columns + `extra`

```sql
CREATE TABLE recipes (
  slug                   TEXT PRIMARY KEY,
  title                  TEXT NOT NULL,
  protein                TEXT,
  cuisine                TEXT,
  time_total             INTEGER,
  ingredients_key        TEXT,
  source_url             TEXT,
  tags                   TEXT,   -- JSON array
  course                 TEXT,   -- JSON array
  season                 TEXT,   -- JSON array
  dietary                TEXT,   -- JSON array
  pairs_with             TEXT,   -- JSON array
  perishable_ingredients TEXT,   -- JSON array
  requires_equipment     TEXT,   -- JSON array
  extra                  TEXT    -- JSON object: any other objective frontmatter
);
CREATE INDEX idx_recipes_source_url ON recipes(source_url);
```

**Rationale:** scalar columns for the facets an admin UI sorts/filters on and that a future JOIN query needs; JSON columns for arrays (SQLite `json_each` can query them when slice 4 wants SQL containment filters, without a schema change now); `extra` keeps the projection lossless as objective frontmatter fields are added, so a new recipe field doesn't require a migration until it's promoted to a queryable column. No subjective fields — the shared/per-tenant split from `multi-tenant-friend-group §6.1` is preserved.

**Alternative considered:** fully normalized child tables (`recipe_tags`, `recipe_course`, …) for first-class containment/ALL-match queries. Deferred — more tables and join bookkeeping than this slice's read pattern (load-all-then-JS-filter) needs. JSON columns + `json_each` cover the future SQL-filter case; promote to child tables only if a measured query pattern demands it.

### Decision: `loadRecipeIndex` reconstructs `RecipeIndex`; targeted helpers for point reads

`list_recipes` still wants the whole set (it filters across everything), so `loadRecipeIndex(env)` does `SELECT * FROM recipes` and rebuilds the `RecipeIndex` map — a drop-in for `JSON.parse(blob)`, leaving the overlay merge and `filterRecipes` untouched. But `retrospective` (needs protein/cuisine per cooked slug) and discovery (needs `source_url → slug`) don't need the whole index — they get targeted queries (`recipeSourceMap`, per-slug lookups), which is strictly more efficient than today's whole-blob load. All live in `src/recipe-index.ts`, built on `src/db.ts`.

### Decision: error semantics

A provisioned-but-empty `recipes` table is a valid empty corpus → `list_recipes` returns `{ recipes: [] }`, not an error. `index_unavailable` is reserved for the table being unreadable (D1 unreachable / not migrated) — surfaced via `src/db.ts`'s `storage_error` mapping. This splits two cases the KV key-presence check conflated (absent key = both "empty" and "not built yet").

## Resolved Decisions

- **Drop `_indexes/recipes.json`.** Confirmed vestigial: the Worker reads D1 (not the file), and the static site reads `recipes/*.md` + `_indexes/components.json` directly — nothing reads `recipes.json`. The build stops writing it and the committed file is deleted; `discovery.ts`'s comments that reference it as the source are updated to point at D1. (`_indexes/` stays for the site's `components.json`.)
- **Rename the capability now:** `recipe-index-kv` → `recipe-index`. The `-kv` suffix is actively misleading once the index is D1-served, and this is the change that makes that true — so the rename belongs here, not deferred. Applying renames the live `openspec/specs/recipe-index-kv/` directory.
