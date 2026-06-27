# Tasks

> Depends on `r2-recipe-corpus` for the sync target; composes with
> `ai-derived-recipe-metadata` (the vault schema omits derived fields).

## 1. Vault source + generator
- [ ] 1.1 `vault-template/`: authored source — the `.obsidian/` config template, a Metadata Menu `fileClass` for `recipe`, a Templater/QuickAdd "New recipe" template (human-authored fields + body scaffold, no `description`), a "How to add a recipe" help note, CSS snippet(s).
- [ ] 1.2 `scripts/build-vault.mjs`: deterministic build with a `--check` mode (mirrors `build-plugin.mjs`/`build-admin.mjs`). Reads `src/vocab.js` and emits the Metadata Menu Select/Multi options for `protein`/`cuisine`/`season`/`requires_equipment`/`course`. Vendors the pinned plugins into the built `.obsidian/`.
- [ ] 1.3 Wire an `aubr build:vault` script; commit the built vault output; gitignore any source maps/caches.

## 2. Drift gate + tests
- [ ] 2.1 CI runs `build-vault --check` (fails on drift between the vault dropdowns and `vocab.js`), the same gate style as the plugin/admin builds.
- [ ] 2.2 Build-tooling test: given a fixture `vocab.js`, `build-vault` emits the expected fileClass options; a vocab change not reflected in the built vault fails `--check`.

## 3. Distribution + docs
- [ ] 3.1 Package the built vault for distribution (zip/repo). Document the one-time author setup: open vault → trust plugins (Restricted Mode) → enter Remotely Save R2 credentials.
- [ ] 3.2 `docs/SELF_HOSTING.md`: an "Authoring recipes in Obsidian" section (who it's for — operator + co-authors; not friends), the trust step, the R2 sync setup, and the new-recipe flow. `docs/ARCHITECTURE.md`: note the third generated artifact + the client-side-validation role + that the friend read-path is the cookbook, not this vault.

## 4. Verify
- [ ] 4.1 `aubr typecheck`, `aubr test:tooling`, `aubr build:vault --check` green.
- [ ] 4.2 Open the built vault in Obsidian, trust plugins, create a recipe via the template, confirm: vocab fields are constrained dropdowns; an off-vocab value is not selectable; no `description` field is offered; the file syncs to R2 and the reconcile indexes it.
- [ ] 4.3 `openspec validate obsidian-authoring-vault --strict` passes.
