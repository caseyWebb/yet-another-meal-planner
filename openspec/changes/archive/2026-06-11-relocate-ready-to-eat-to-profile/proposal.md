## Why

Ready-to-eat (RTE) was modeled as a parallel recipe corpus — shared `ready_to_eat/{breakfast,lunch,dinner}.toml` catalogs at the data-repo root, a discovery feed, and a draft/disposition lifecycle — but it never got the multi-tenant split recipes got. As a result a per-member disposition (`status = active|draft|rejected`) and a per-member SKU cache sit on a **shared** file: one member rejecting an item, or one member's discovery draft, leaks to the whole friend group. That's the exact problem the recipe overlay was created to fix, left unsolved for RTE.

The deeper observation: a recipe is shared because it carries objective content worth sharing (ingredients, steps, a body). An RTE item is just a Kroger SKU plus "I'm willing to eat this, for this meal, this often" — pure personal taste with no shared content. It belongs in the **personal profile**, not the shared corpus. Moving it there fixes the multi-tenancy leak for free and lets onboarding seed it instead of waiting weeks for discovery to fill an empty catalog.

## What Changes

- **BREAKING (data layout):** RTE moves from three shared root files `ready_to_eat/{breakfast,lunch,dinner}.toml` to a single per-tenant file `users/<id>/ready_to_eat.toml`. Items carry a `meal` field (`breakfast|lunch|dinner`); `variety_rules` are expressed per meal within the one file.
- Add a generated **`slug`** as each item's stable key (mirroring recipes); `name` becomes display-only. This resolves the existing slug-vs-name drift where `update_ready_to_eat` takes a slug but `add_draft_ready_to_eat` and `cooking_log` entries match by name.
- Add a **`rating`** field to RTE items, closing the drift where the `add-ready-to-eat-feedback` skill writes a rating the schema never defined.
- **Drop the `_indexes/ready_to_eat.json` aggregate index.** A single member's RTE list is tiny; the Worker reads `users/<id>/ready_to_eat.toml` directly, the same way it reads pantry/overlay.
- The RTE tools — `add_draft_ready_to_eat`, `update_ready_to_eat`, `ready_to_eat_available` — now read/write the **caller's** per-tenant file rather than the shared root.
- `configure-grocery-profile` (onboarding) gains a fifth setup area: **heat-and-eat acceptance** — which kinds, which meals, variety tolerance — so a new member's catalog is seeded conversationally instead of starting empty.
- Menu-flow RTE discovery now writes **per-tenant** drafts.
- **Clean break, no migration:** there is no real RTE data anywhere yet (operator cutover is still pending), so the shared catalogs are removed outright and the data template ships the file under `users/<id>/`.
- **Unchanged:** the consumption side is already correct and per-tenant — `cooking_log` `type=ready_to_eat`, the cook-vs-convenience split, and `ready_to_eat_favorites` in `retrospective` are untouched. This change only touches the catalog/preference side.

## Capabilities

### New Capabilities
<!-- None — this relocates and corrects existing behavior. -->

### Modified Capabilities
- `repo-structure`: RTE catalog relocates from the shared root (`ready_to_eat/*.toml`) to a per-tenant file (`users/<id>/ready_to_eat.toml`).
- `data-write-tools`: `add_draft_ready_to_eat` / `update_ready_to_eat` operate on the caller's per-tenant file; items gain a generated `slug` (stable key) and a `rating` field.
- `kroger-integration`: `ready_to_eat_available()` cross-references the **caller's** per-tenant catalog instead of the shared root catalogs.
- `data-indexing`: the `_indexes/ready_to_eat.json` aggregate index is removed; RTE is read directly from the per-tenant TOML.
- `data-validation`: validation targets the per-tenant path and the new `slug` + `rating` fields.
- `menu-generation`: on-sale RTE discovery drafts are written to the caller's per-tenant catalog.
- `guided-onboarding`: `configure-grocery-profile` gains a heat-and-eat acceptance setup area.
- `build-automation`: `build-indexes.yml` no longer triggers on `ready_to_eat/**` or regenerates an RTE index.

## Impact

- **Schema/docs:** `docs/SCHEMAS.md` (move RTE from the shared-corpus section to per-tenant `users/<id>/`, add `slug` + `rating`, fix the §line-9 / on-hand-stock wording), `docs/TOOLS.md` (tool contract), `docs/PROJECT.md` (architecture narrative).
- **Worker:** `src/discovery-tools.ts`, `src/write-tools.ts`, `src/tools.ts` (per-tenant read/write + slug), `src/validate.ts` (path + `slug`/`rating`), and the corresponding tests under `test/`.
- **Tooling:** `scripts/build-indexes.mjs` (drop the RTE index) and its fixtures/tests under `tests/`.
- **Agent (canonical → rebuilt plugin):** `AGENT_INSTRUCTIONS.md` is the source of truth — edit it then `npm run build:plugin`; never hand-edit `plugin/`. Affected sections: `configure-grocery-profile` (5th area), `add-ready-to-eat-feedback` (rating now real), `meal-plan` (per-tenant discovery drafts).
- **Data template:** `groceries-agent-data-template` ships `users/<id>/ready_to_eat.toml` instead of root `ready_to_eat/*.toml`.
