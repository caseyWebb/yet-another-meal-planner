## Status — ABSORBED into `cloudflare-storage-architecture`

This stub's scope now lives in the **`cloudflare-storage-architecture`** umbrella, with one change of destination: **cooking_log goes to D1, not KV.** The retrospective/`last_cooked` simplification (`GROUP BY`, `MAX(date)`) is one of the strongest D1 arguments, so the relocation belongs in that roadmap:
- cooking_log → D1 = roadmap **slice 2** (`d1-cooking-log`)
- retire `commit_changes` + the `update_recipe`-vs-`rate_recipe` decision = roadmap **slice 3** (`retire-commit-changes`)

The original KV-flavored sketch is kept below for continuity; treat it as superseded — the write-time-validation-via-recipe-index insight and the `commit_changes` analysis still hold verbatim, only the storage target changes from KV to D1.

---

**Original draft stub** — scope parked for after `json-profile-bundle` lands. Captured here so the thinking isn't lost; not yet fleshed into design/specs/tasks.

## Why

`unified-user-profile-kv` moved most per-tenant state to DATA_KV but left **`cooking_log.toml` in GitHub** — the last per-tenant *volatile* artifact still git-backed. It is appended on every cook, feeds `retrospective`, and derives each recipe's `last_cooked`. Meanwhile `commit_changes` has decayed into two unrelated tools wearing one coat: (a) a batch-combiner that duplicates ~5 standalone tools purely for one-git-commit atomicity, and (b) the *only* writer for two capabilities — cooking-log append and recipe overlay rating/status.

`commit_changes`' sole real value is git-commit atomicity for GitHub writes; every KV field it touches already gets an independent, non-transactional `kv.put`. As volatile state moved to KV, the GitHub-backed surface shrank to shared, curatorial, low-frequency edits (recipes, aliases, stores) plus the cooking-log straggler. Moving the cooking log to KV completes the migration thesis — **GitHub becomes 100% shared corpus, per-tenant state 100% KV (all JSON)** — and removes the last reason `commit_changes` must exist.

Bonus: `validateNewEntry` in `src/cooking-log.ts` is structural-only with the note "recipe-slug resolution is the build Action's job (the Worker has no corpus access on workerd)." That is **stale** since `recipe-index-kv` — the Worker now has `index:recipes` in KV and can resolve slugs at write time. Moving the log to KV upgrades validation from build-time to write-time rather than losing it.

## What Changes (sketch)

- `cooking_log` moves from `users/<username>/cooking_log.toml` (GitHub) to `state:<username>:cooking_log` (DATA_KV) as a JSON array of entries. The pure helpers (`entriesOf`, `appendEntries`, `deriveLastCooked`) already operate on an entries array — near-zero logic change.
- New standalone **`log_cooked`** tool — the cooking-log writer: validate the entry (including recipe-slug resolution against `index:recipes`), append to KV, and clear cooked recipes from the KV meal plan (the side effect `commit_changes` does today).
- Recipe **rating/status** (overlay) writes — `commit_changes`' other unique capability — get a home (see open decision).
- `retrospective`, the `last_cooked` derivation in `src/recipes.ts`, and the read wiring in `src/tools.ts` read the cooking log from KV instead of GitHub.
- Build-time `validateCookingArtifacts` (`scripts/build-indexes.mjs`) is dropped — the log no longer lives in GitHub; validation is write-time in the Worker.
- **`commit_changes` is deleted entirely.** Recipe content → `update_recipe`/`create_recipe`; cooking-log → `log_cooked`; rating/status → see open decision; ready-to-eat → standalone tools; config → standalone tools (already removed in `json-profile-bundle`). Accept the loss of atomic N-recipe-in-one-commit (rare, curatorial).
- Migration **`0003-cooking-log-kv.mjs`**: `cooking_log.toml` → `state:<username>:cooking_log` JSON, idempotent.
- `AGENT_INSTRUCTIONS.md` rework (the cooking / meal-plan flows lean on `commit_changes`) + plugin rebuild. `docs/ARCHITECTURE.md`: record the now-complete GitHub-vs-KV boundary.

## Open Decision

**Where do recipe rating/status writes go once `commit_changes` is gone?**

- **(A) Fold into `update_recipe`** — let it accept `rating`/`status` and route them to the KV overlay (objective frontmatter → GitHub, subjective → KV), keeping one "edit a recipe" mental model for the agent. Re-creates the existing split-routing logic inside `update_recipe`.
- **(B) New `rate_recipe` tool** — a dedicated KV-overlay writer, leaving `update_recipe` purely objective/GitHub. Cleaner separation of concerns; one more tool on the surface.

Lean: **(A)** — fewer tools, and the agent already thinks of rating as "editing the recipe." Decide before writing design/specs/tasks.

## Depends On

- `json-profile-bundle` (TOML→JSON for the profile bundle, `config_updates` already removed from `commit_changes`). This change deletes the slimmed-down `commit_changes` and moves the cooking log.
