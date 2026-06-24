## Context

After slices 1–5, GitHub still holds the shared, tool-written TOML: ingredient aliases, the store registry + store notes, recipe notes, RSS feeds, the newsletter allowlist + discovery inbox, the SKU resolution cache, and flyer terms. None is hand-edited markdown; all have agent write tools; several are caches or attributed multi-author data that never wanted to be in a personal vault. This slice moves them to D1 and shrinks the build to recipes-only — the final step of the migration.

## Goals / Non-Goals

**Goals:**
- All remaining shared corpus/config/cache/notes in D1; GitHub holds only `recipes/*.md`.
- Validation moves from the build to Worker write-time; the build validates recipes + projects the index only.
- `read_recipe_notes` fully D1 (notes + ratings); the SKU cache an indexed lookup.
- `smol-toml` removed from the codebase.

**Non-Goals:**
- Touching recipe markdown or the recipe index (slices done).
- Re-litigating attribution/privacy semantics — preserve them (author = tenant subtree → an `author` column; `private` flag).

## Decisions

### Decision: shared vs. attributed tables

Most of these are global shared config (no tenant column): `aliases`, `feeds`, `discovery_senders`/`discovery_members`, `flyer_terms`, `sku_cache`, `discovery_candidates`, `stores`. The two attributed kinds carry an `author` (the writing tenant) and a `private` flag: `store_notes` and `recipe_notes`. `read_recipe_notes` returns the caller's own private notes plus everyone's shared notes — a `WHERE recipe=? AND (private=0 OR author=?)`, joined with the slice-4 `overlay` ratings query. This is what makes the collaborative-cookbook read one query instead of a tenant-directory scan over GitHub files.

### Decision: caches and inbox get the indexes their access pattern wants

`sku_cache` is keyed `(ingredient, location_id)` and revalidated/pruned by `last_used` — exactly the indexed lookup the matcher does today by scanning a parsed blob. `discovery_candidates` dedups by URL via `UNIQUE(url)` (replacing the in-memory "already seen?" set built from the inbox file). These are the cases where D1's indexing is a strict improvement over parse-the-whole-file.

### Decision: validation moves to the Worker

`build-indexes.mjs` drops `validateStore`, `validateDiscoveriesInbox`, `validateDiscoverySources`, and the whole-repo `parseCheckToml`. Each becomes a write-time check in the corresponding tool (`add_store`/`update_store`, the discovery-source writer, the inbox writer) via `src/validate.ts`. The build is then: validate recipe markdown + project the recipe index (slice 1). This is the same write-time-validation trajectory every prior slice followed; with no corpus left in GitHub except recipes, the build has nothing else to check.

### Decision: drop `smol-toml`

Once these reads/writes are D1 and the build no longer parse-checks TOML, no code path parses TOML (recipe frontmatter is YAML via gray-matter). Remove `src/parse.ts`/`src/serialize.ts` TOML helpers (or the files), drop the `smol-toml` dependency, and delete the now-orphaned `.toml` files from the data repo (including the slice-2 `cooking_log.toml` leftovers).

### Decision: one backfill migration, reads the checkout

`migrations/0005-shared-corpus-d1.mjs` reads the data-repo checkout (`dataRoot`) — `aliases.toml`, `feeds.toml`, `discovery_sources.toml`, `flyer_terms.toml`, `skus/kroger.toml`, `discoveries_inbox.toml`, and the `stores/`, `store_notes/`, `notes/` trees — parses each, and inserts rows. Idempotent (truncate-and-reload per table is safe here: these are shared singletons, and the checkout is the authoritative pre-migration source). Runs once via the ledger.

## Risks / Open Questions

- **Largest tool surface of any slice.** Many read/write paths change. Mitigate by doing it artifact-by-artifact (each table + its tools + its tests is an independent unit within the slice); the spec deltas here capture the architecture, with per-tool deltas enumerated in `tasks.md` and finalized at apply.
- **Attribution/privacy parity.** The `author`/`private` semantics must match exactly (own-private + everyone-shared). Cover with tests mirroring the current `notes-tools` behavior.
- **Backfill of trees.** `stores/`, `store_notes/`, `notes/` are per-file; the migration walks them. Confirm slug/author derivation matches the current path-based scheme.
- **Final cleanup.** Deleting the data repo's `.toml` files is a data-repo change (the runner can't `git rm`); do it as an explicit data-repo commit once D1 is confirmed authoritative.
