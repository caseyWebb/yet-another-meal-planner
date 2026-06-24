# D1 migration — operator playbook

The `cloudflare-storage-architecture` roadmap moves the grocery-agent's data to a
three-tier boundary:

```
GitHub   recipes/*.md          authored markdown (Obsidian/mobile) — source of truth
D1       all domain data       recipe index · profile · session · cooking log · corpus
KV       ephemeral infra       KROGER_KV · OAUTH_KV · TENANT_KV  (DATA_KV retired at the end)
```

This document is the **manual, run-by-the-operator** half. The code is implemented and
unit-tested in this PR, but nothing here was run against a live Cloudflare account in the
build environment — D1 provisioning, remote migrations, and deploy verification are yours
to run, in the order below.

> **Why manual pinning instead of auto-provision:** the deploy can auto-provision id-less
> bindings, but it then commits the assigned ids back to your *data* repo. An **Actions-only
> GitHub token cannot do that write-back**, so we pre-provision D1 and pin its id by hand,
> once. This also side-steps the unverified question of whether `wrangler-action` auto-
> provisions D1 the way it does KV (`d1-foundation` design risk 6.3) — by creating the DB
> yourself, parity never matters.

---

## One-time setup (do this before the first deploy on the new code)

1. **Add D1 to the Cloudflare API token.** Edit `CLOUDFLARE_API_TOKEN` (the data repo's
   Actions secret) to include **Account → D1 → Edit**, alongside the existing Workers Scripts
   edit and Workers KV Storage edit. An under-scoped token fails loudly at the
   `wrangler d1 migrations apply` step.

2. **Pre-create the D1 database:**
   ```bash
   npx wrangler d1 create grocery-mcp
   # → database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
   ```

3. **Pin the id in your *data* repo's `wrangler.jsonc`** (the operator config the deploy
   merges with the code config). Add:
   ```jsonc
   "d1_databases": [
     { "binding": "DB", "database_name": "grocery-mcp",
       "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" }
   ]
   ```
   While here: if your **KV** namespace ids were never pinned (same write-back limitation —
   symptom: KV re-provisions on every deploy), paste those in too from
   `npx wrangler kv namespace list`.

4. **Template repo** (`groceries-agent-data-template`): add the same id-less `DB` binding
   (no `database_id`) to its `wrangler.jsonc` so new operators inherit it. (Out of this PR's
   commit scope — it's a separate repo / submodule.)

## Deploy & migrate

5. Deploy as usual. The merge keeps your pinned `database_id`; the new
   **Apply D1 schema migrations** step runs `wrangler d1 migrations apply DB --remote`
   (creating tables + Cloudflare's `d1_migrations` ledger); then `run-migrations.mjs` runs
   the `.mjs` **data backfills**. Both tracks are idempotent.

6. **Verify** `/health` reports D1 reachable (the deploy adds a `d1` probe row; a failed probe
   flips overall `ok` → 503). Local smoke before deploying:
   ```bash
   npx wrangler d1 migrations apply DB --local
   npm run dev   # exercise a read tool; confirm no storage_error
   ```

## Migration mechanics (reference)

- **Schema** → `migrations/d1/*.sql`, applied by `wrangler d1 migrations apply`, tracked in
  D1's own `d1_migrations` table. Applied **before** data backfills.
- **Data backfill** → `migrations/*.mjs`, run by `scripts/run-migrations.mjs`, tracked in the
  `migrations:applied` KV ledger. Each reads the data-repo checkout / KV and writes D1 rows;
  idempotent (delete-then-insert or reload per tenant/table), and deletes the migrated KV keys.
- Backfills are ordered by filename and run once; a re-run is a no-op.

---

## Per-slice rollout

Each slice is an independent, deployable step. Apply and verify in order.

### Slice 0 — d1-foundation  ✅ implemented
Rails only; no data moves. Stands up the `DB` binding, `src/db.ts`, both migration tracks,
provisioning, and the `/health` D1 probe. `migrations/d1/0001_init.sql` creates only
`schema_meta`.
- **Live to verify:** the one-time setup above; deploy applies `0001_init.sql`; `/health` D1
  row is `ok`. (Build-env tests: typecheck clean, 514 vitest + 107 tooling passing.)

### Slice 1 — d1-recipe-index  ✅ implemented
Recipe index KV blob → D1 `recipes` table (a derived projection — rebuilt by the build, no
backfill). `build-indexes` now does `DELETE FROM recipes` + batched `INSERT` instead of the
KV publish; `list_recipes`/`retrospective`/discovery read D1; the committed
`_indexes/recipes.json` is removed (in the **data** and **template** repos too). Capability
renamed `recipe-index-kv` → `recipe-index`. Build-env: typecheck ✅, 530 vitest + 113 tooling ✅.
- **Live to verify:**
  - `migrations/d1/0002_recipes.sql` applies (deploy step, or `wrangler d1 migrations apply DB --local`).
  - After deploy, the post-deploy `build-indexes` populates `recipes`; `list_recipes` returns
    results without a recipe push; `npx wrangler d1 execute DB --remote --command "SELECT count(*) FROM recipes"`
    is non-zero.
  - The data/template repos drop `_indexes/recipes.json` (already committed on the branch).
- **Cleanup tracked:** `openspec/specs/data-indexing/spec.md` still describes the old KV index
  publish — stale, to be corrected in the final pass (it was outside this slice's deltas).

### Slice 2 — d1-cooking-log  ✅ implemented
Cooking log GitHub TOML → per-tenant D1 `cooking_log` table. `last_cooked` and `retrospective`
are now SQL (the latter a `cooking_log LEFT JOIN recipes`). New `log_cooked` tool with
write-time slug validation against `recipes`; `commit_changes` drops `cooking_log_entries`.
First **data-backfill** migration (`migrations/0002-cooking-log-d1.mjs`). Build-env: typecheck ✅,
521 vitest + tooling ✅ (incl. 7 backfill tests). Plugin rebuilt.
- **Live to verify:**
  - `migrations/d1/0003_cooking_log.sql` applies; then the backfill runs
    (`run-migrations.mjs` → `0002-cooking-log-d1.mjs`) and populates `cooking_log` from each
    `users/<u>/cooking_log.toml`.
  - `log_cooked` of a real slug logs + clears the meal plan; an unknown slug → `not_found`.
  - `list_recipes` shows correct `last_cooked`; `retrospective` returns correct mixes.
- **Cleanup tracked:** the old `users/<u>/cooking_log.toml` files are now vestigial (the runner
  can't `git rm` them) — delete them from the data repo once D1 is confirmed authoritative.

### Slice 3 — retire-commit-changes  ✅ implemented
No migration — tool refactor + persona rework. New `rate_recipe(slug,{rating?,status?})`
(subjective overlay writer, slug-validated against `recipes`, writes the **KV** overlay until
slice 4); `update_recipe` is objective-only (rejects rating/status → `rate_recipe`,
last_cooked → `log_cooked`); `commit_changes` **deleted**. `AGENT_INSTRUCTIONS.md` reworked off
`commit_changes` (and the pre-existing stale `grocery_list_ops`/`pantry_operations` →
`remove_from_grocery_list`/`update_pantry`); plugin rebuilt. Build-env: typecheck ✅, 526 vitest
+ 116 tooling ✅.
- **Live to verify:** `rate_recipe` updates the overlay and shows in `list_recipes`;
  `update_recipe` with `status`/`rating` errors toward `rate_recipe`; `commit_changes` is gone
  from the tool list.

### Slice 4 — d1-profile  ✅ implemented
The whole per-tenant profile (preferences, taste, diet_principles, kitchen, staples, overlay,
ready_to_eat, stockup) → normalized D1 tables (`profile`, `brand_prefs`, `kitchen_equipment`,
`staples`, `overlay`, `ready_to_eat`, `stockup`). `update_preferences` is now a deep
**merge-patch** (RFC 7396; brands tri-state = `brand_prefs` UPSERT/`[]`/DELETE); group ratings
in `read_recipe_notes` are one `SELECT … FROM overlay WHERE recipe=?` (no tenant scan);
`rate_recipe` writes the D1 `overlay`. KV profile-bundle layer deleted (`smol-toml` now only on
the GitHub-corpus path). Backfill `migrations/0003-profile-d1.mjs` (KV bundle → rows, deletes
the key). Build-env: typecheck ✅, 551 vitest + 121 tooling ✅. Plugin rebuilt.
- **Live to verify:** `0004_profile.sql` applies; backfill populates the profile tables and
  removes `profile:<u>` KV keys; `read_user_profile` returns the same shape; a partial
  `update_preferences` patch doesn't clobber siblings; brands tri-state behaves (set/[]/null);
  "rated 4+ by others" works via the overlay query.

<!-- Subsequent slices appended as they are implemented. -->
