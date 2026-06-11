## 1. Schema & docs

- [x] 1.1 In `docs/SCHEMAS.md`, move ready-to-eat out of the shared-corpus section: replace the three `ready_to_eat/{breakfast,lunch,dinner}.toml` entries with a single per-tenant `users/<username>/ready_to_eat.toml` documented under the per-user files. Add `slug` (generated, stable key) and `rating` (optional int) to the item shape; add a `meal` field per item; express `variety_rules` per meal within the one file.
- [x] 1.2 Fix the surrounding wording: the line-9 "shared corpus" list (drop `ready_to_eat/*.toml`), and the on-hand-stock note (the catalog is per-tenant options, pantry still holds stock).
- [x] 1.3 Update `docs/TOOLS.md`: `add_draft_ready_to_eat` (now per-tenant; optional `status`), `update_ready_to_eat` (addressed by `slug`; `rating`), `ready_to_eat_available` (reads the caller's per-tenant catalog), and remove `_indexes/ready_to_eat.json` from any index listing.
- [x] 1.4 Update `docs/PROJECT.md` architecture narrative: RTE is a per-tenant profile dimension, not a shared catalog; no RTE index.

## 2. Worker (`src/`)

- [x] 2.1 Add a `slug` generator for RTE items (reuse the recipe slugify; de-dupe with a numeric suffix within the caller's file).
- [x] 2.2 `add_draft_ready_to_eat` (`src/discovery-tools.ts` / `src/write-tools.ts` as appropriate): read/write the caller's `users/<id>/ready_to_eat.toml`; generate `slug`; accept optional `status` (default `draft`); accept `meal`.
- [x] 2.3 `update_ready_to_eat`: address items by `slug` in the caller's file; support `rating` and `status`; return a structured error for an unknown `slug`.
- [x] 2.4 `ready_to_eat_available` (`src/tools.ts`): cross-reference the caller's per-tenant catalog; treat an absent/empty file as an empty result (no throw).
- [x] 2.5 ~~Carry `slug` in the cooking-log RTE path~~ **TRIMMED during apply.** `ready_to_eat_favorites` and the restock cross-reference already key on `name` end-to-end ([retrospective.ts:104](../../../src/retrospective.ts)); carrying a catalog slug into the log would touch the cooking-history capability the proposal leaves untouched, for no correctness gain. Consumption stays by-name; `slug` is catalog-only.
- [x] 2.6 `src/validate.ts`: validate the per-tenant `ready_to_eat.toml` — `meal`/`status` enums, required `name`+`slug`, optional integer `rating`, slug uniqueness within the file.

## 3. Build tooling (`scripts/`)

- [x] 3.1 `scripts/build-indexes.mjs`: stop emitting `_indexes/ready_to_eat.json`; remove the shared `ready_to_eat/` walk. Keep the per-tenant RTE structural validation available to the Node validator path.
- [x] 3.2 Update fixtures and tests under `tests/` that assert the RTE index or the shared catalog walk.

## 4. Agent instructions & plugin

- [x] 4.1 `AGENT_INSTRUCTIONS.md` — `configure-grocery-profile`: add the 5th setup area (heat-and-eat acceptance: which kinds, which meals, variety tolerance), persisted via `add_draft_ready_to_eat` with `status: active`.
- [x] 4.2 `AGENT_INSTRUCTIONS.md` — `add-ready-to-eat-feedback`: rating is now a real field; address by `slug`.
- [x] 4.3 `AGENT_INSTRUCTIONS.md` — `meal-plan`: RTE discovery dedups against and drafts into the caller's per-tenant catalog (not `ready_to_eat/*.toml`).
- [x] 4.4 Rebuild the plugin: `npm run build:plugin`; confirm the regenerated `plugin/` reflects 4.1–4.3 (do not hand-edit `plugin/`).

## 5. Data template (via the `docs/data-template/` submodule)

> Depends on `vendor-data-template-submodule` landing first, so this is editable in-repo.

- [x] 5.1 In the `docs/data-template/` submodule: removed root `ready_to_eat/{breakfast,lunch,dinner}.toml`, dropped the `ready_to_eat/**` trigger from `build-indexes.yml`, and updated the README. Committed + pushed to the template repo (`5a5e8dd`); submodule pointer bumped here. **Note:** the template ships no per-user stub *files* (`users/` is just `.gitkeep`) — per-user files including `ready_to_eat.toml` are created on first use by `add_draft_ready_to_eat`, so no static `users/<username>/ready_to_eat.toml` stub is added (consistent with `pantry.toml` et al.). Net template change = the root-dir removal.

## 6. Verification

- [x] 6.1 `npm run typecheck`, `npm test` (316 pass), `npm run test:tooling` (57 pass) all green.
- [x] 6.2 `openspec validate "relocate-ready-to-eat-to-profile"` passes.
- [ ] 6.3 Manual smoke via local `npm run dev` + MCP Inspector (needs a running worker + a data repo; interactive). Behaviors are covered by automated tests: slug generation + status (write-tools.test.ts), validation incl. empty/duplicate/bad-meal (validate.test.ts, build-indexes.test.mjs), and absent-catalog → empty (`ready_to_eat_available` guards `readOptional`). Left unchecked as it's a manual step.
