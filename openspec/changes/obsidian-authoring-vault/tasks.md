# Tasks

> Depends on `r2-recipe-corpus` for the sync target; composes with
> `ai-derived-recipe-metadata` (the vault schema omits derived fields).

## 1. Vault source + generator
- [x] 1.1 `vault-template/`: authored source — the `.obsidian/` config template, a Metadata Menu `fileClass` for `recipe`, a Templater/QuickAdd "New recipe" template (human-authored fields + body scaffold, no `description`), a "How to add a recipe" help note, CSS snippet(s).
- [x] 1.2 `scripts/build-vault.mjs`: deterministic build with a `--check` mode (mirrors `build-plugin.mjs`/`build-admin.mjs`). Reads `src/vocab.js` and emits the Metadata Menu Select/Multi options for `protein`/`cuisine`/`season`/`requires_equipment`/`course`. Vendors the pinned plugins into the built `.obsidian/` (`--fetch-plugins`, sha256-verified).
- [x] 1.3 Wire an `aubr build:vault` script; commit the built vault output; gitignore the vendored plugin binaries + the packaged zip.

## 2. Drift gate + tests
- [x] 2.1 CI runs `build-vault --check` (fails on drift between the vault dropdowns and `vocab.js`), the same gate style as the plugin/admin builds.
- [x] 2.2 Build-tooling test: given a fixture `vocab.js`, `build-vault` emits the expected fileClass options; a vocab change not reflected in the built vault fails `--check`.

## 3. Distribution + docs
- [x] 3.1 Package the built vault for distribution (`build:vault --fetch-plugins` + zip). Document the one-time author setup: open vault → trust plugins (Restricted Mode) → enter Remotely Save R2 credentials.
- [x] 3.2 `docs/SELF_HOSTING.md`: an "Authoring recipes in Obsidian" section (who it's for — operator + co-authors; not friends), the trust step, the R2 sync setup, and the new-recipe flow. `docs/ARCHITECTURE.md`: note the third generated artifact + the client-side-validation role + that the friend read-path is the cookbook, not this vault.

## 4. Verify
- [x] 4.1 `aubr typecheck`, `aubr test:tooling`, `aubr build:vault --check` green.
- [ ] 4.2 Open the built vault in Obsidian, trust plugins, create a recipe via the template, confirm: vocab fields are constrained dropdowns; an off-vocab value is not selectable; no `description` field is offered; the file syncs to R2 and the reconcile indexes it. **(MANUAL — not runnable headlessly. The artifact-level facts are verified by `tests/build-vault.test.mjs`: dropdowns are generated from `vocab.js`, off-vocab values are not offered, no `description` field exists, and dropdown values pass the real `validateRecipeContract`. The live Obsidian trust + R2 sync + reconcile round-trip still needs a human.)**
- [x] 4.3 `openspec validate obsidian-authoring-vault --strict` passes.
