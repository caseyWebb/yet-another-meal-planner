## Why

Roadmap slice 6 — the last — of `cloudflare-storage-architecture`. It moves the remaining shared, tool-written GitHub TOML to D1, leaving GitHub holding **only `recipes/*.md`**. These artifacts are config, caches, registries, and attributed multi-author notes — none Obsidian-edited, all tool-written — so they fail the "is this hand-edited markdown?" test and belong in the queryable, admin-editable, strongly-consistent store.

Completing this slice realizes the full thesis:

```
  GitHub   recipes/*.md          (authored markdown — the only thing left)
  D1       everything domain     (recipe index, profile, session, cooking log,
                                   + ALL shared corpus/config/cache/notes)
  KV       ephemeral infra       (KROGER_KV, OAUTH_KV, TENANT_KV; DATA_KV empty)
```

And it lets the build collapse to "validate recipes + project the recipe index," with every other validator moving to Worker write-time — and `smol-toml` leaving the codebase entirely.

## What Changes

- **NEW** schema `migrations/d1/0006_shared_corpus.sql` — shared (non-tenant) tables:
  - `aliases(variant PK, canonical)` — ingredient name variants.
  - `feeds(url PK, title, …)` — RSS discovery feeds.
  - `discovery_senders(address PK)` / `discovery_members(address PK)` — the newsletter allowlist.
  - `flyer_terms(term PK)` — flyer warm terms.
  - `sku_cache(ingredient, location_id, sku, brand, size, last_used, PK(ingredient, location_id))` — the Kroger SKU resolution cache.
  - `discovery_candidates(id PK, url UNIQUE, source, discovered_at, status, …)` — the email discovery inbox (dedup via `UNIQUE(url)`).
  - `stores(slug PK, name, domain)` — the store registry.
  - `store_notes(id PK, store, author, body, created_at, private)` — attributed store layout notes.
  - `recipe_notes(id PK, recipe, author, body, tags /*json*/, private, created_at)` — attributed recipe notes.
- **NEW** data backfill `migrations/0005-shared-corpus-d1.mjs` — read the data-repo checkout's TOML (`aliases.toml`, `feeds.toml`, `discovery_sources.toml`, `flyer_terms.toml`, `skus/kroger.toml`, `discoveries_inbox.toml`, `stores/*.toml`, `store_notes/*.toml`, `notes/*.toml`) and INSERT into the tables. Idempotent.
- **Reads → D1**: the matcher's aliases + SKU cache, `list_stores`/`read_store`, `read_store_notes`, `read_recipe_notes` (now **fully** D1 — notes half joins the ratings half moved in slice 4), `read_discovery_inbox`, the feeds/flyer-terms readers.
- **Writes → D1**: `update_aliases`, `update_feeds`, `update_discovery_sources`, `add/update/remove_store`, `add/update/remove_store_note`, `add/update/remove_recipe_note`, the SKU-cache writer (`order-tools.ts`), and the email-ingest inbox writer — all row upsert/delete, validated at write time.
- **Build collapses to recipes-only**: drop `validateStore`, `validateDiscoveriesInbox`, `validateDiscoverySources`, and the whole-repo TOML parse-check from `scripts/build-indexes.mjs`; the shared-corpus validation moves to the Worker write tools. The build now only validates recipe markdown and projects the recipe index (slice 1).
- **`smol-toml` removed** from the Worker and build (no TOML remains in the data path; recipe frontmatter is YAML via gray-matter). Drop the dependency.
- The vestigial GitHub TOML files (and the slice-2 `cooking_log.toml` leftovers) are removed from the data repo as a final cleanup.

## Capabilities

### Modified Capabilities

- `shared-corpus`: aliases, stores, store-notes, recipe-notes, feeds, discovery sources/inbox, SKU cache, flyer terms live in D1; written and validated at the Worker, read by query.
- `build-automation`: the build validates recipes and projects the recipe index only; all other validators move to write-time.
- `ingredient-matching`: aliases and the SKU cache are D1 tables (the cache an indexed `(ingredient, location_id)` lookup).
- `newsletter-discovery`: feeds, sender/member allowlist, and the inbox are D1 (inbox dedup via `UNIQUE(url)`).
- `recipe-notes`: notes are a D1 table; `read_recipe_notes` is fully D1 (notes + ratings).

## Impact

- New `migrations/d1/0006_shared_corpus.sql`, `migrations/0005-shared-corpus-d1.mjs`.
- `src/gh-read.ts`, `src/matching.ts`/`tools.ts` (aliases, sku cache), `src/stores.ts`/`stores-tools.ts`, `src/notes.ts`/`notes-tools.ts`, `src/feeds.ts`, `src/email.ts`/`discovery.ts`/`discovery-tools.ts`, `src/order-tools.ts` (sku cache write), `src/flyer-warm.ts` (flyer terms + preferences already D1).
- `scripts/build-indexes.mjs` (drop the non-recipe validators + TOML walk), `src/validate.ts` (write-time validators for stores/discovery), `src/parse.ts`/`src/serialize.ts` (remove if only TOML), `package.json` (drop `smol-toml`).
- `docs/SCHEMAS.md` (D1 tables replace every remaining TOML schema), `docs/ARCHITECTURE.md` (the completed three-tier boundary), `CONTRIBUTING.md` (no TOML data tooling).

## Depends On

- `d1-foundation` (rails), `d1-recipe-index` (recipe-notes/store-notes reference recipes; slug validation), `d1-profile` (the ratings half of `read_recipe_notes`).
