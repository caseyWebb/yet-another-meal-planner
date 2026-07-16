## 1. Delete the vault build pipeline and artifacts

- [x] 1.1 Delete `packages/worker/scripts/build-vault.mjs`
- [x] 1.2 Delete `packages/worker/tests/build-vault.test.mjs`
- [x] 1.3 Delete the authored source tree `packages/worker/vault-template/` (files, `.obsidian/` config, `plugin-pins.json`, fileClass, templates)
- [x] 1.4 Delete the generated committed vault `packages/worker/vault/`

## 2. Unwire build, test, and CI hooks

- [x] 2.1 Remove the `build:vault` script from root `package.json`
- [x] 2.2 Remove the `build:vault` script from `packages/worker/package.json`
- [x] 2.3 Remove `tests/build-vault.test.mjs` from the `test:tooling` node --test list in `packages/worker/package.json`
- [x] 2.4 Remove the `node scripts/build-vault.mjs --check` drift-gate step from `.github/workflows/ci.yml` (and any now-orphaned surrounding step/name)
- [x] 2.5 Remove the `vault/.obsidian/plugins/*` (and `grocery-authoring-vault*.zip`) entries from the root `.gitignore` and `packages/worker/.gitignore`

## 3. Reframe corpus authoring in the docs (tool-agnostic R2)

- [x] 3.1 `docs/SELF_HOSTING.md`: retitle and rewrite the "R2 corpus bucket + Obsidian authoring" step around editing `recipes/*.md` in R2 with any S3-compatible client (`rclone`); drop the vault build/open/trust-plugins walkthrough and the "Optional CLIs" Obsidian mention; fix the intro anchor link; keep the corpus/bucket table row accurate
- [x] 3.2 `docs/ARCHITECTURE.md`: genericize the ASCII-diagram sync annotation (width-preserving) and the seven Obsidian mentions to "S3-compatible client / file tool" while preserving the human-edits-onto-R2 and eventual-feedback narrative; drop the standalone "Obsidian (optional)" dependency bullet
- [x] 3.3 `docs/SCHEMAS.md`: genericize the three Obsidian mentions (authored-markdown tier, `reconcile_errors` description, read-only guidance domain)
- [x] 3.4 `docs/TOOLS.md`: genericize the `read_reconcile_errors` "e.g. via Obsidian" note
- [x] 3.5 `CONTRIBUTING.md`: remove the `build-vault.mjs`/`vault-template/`/`vault/` rows from the `scripts/` and layout tables, delete the "Building the authoring vault" section, and drop the Obsidian aside from the YAML-frontmatter conventions note

## 4. Scrub Obsidian from code comments and the persona source

- [x] 4.1 `packages/worker/src/env.ts`: reword the `CORPUS` binding comment (hand-edited via an S3-compatible client, not Obsidian)
- [x] 4.2 `packages/worker/src/recipe-projection.ts`: reword the "human/Obsidian edit" comment
- [x] 4.3 `packages/worker/src/tools.ts`: reword the `read_reconcile_errors` description's "(e.g. via Obsidian)" aside
- [x] 4.4 `packages/worker/wrangler.jsonc`: reword the `CORPUS` bucket comment mentioning Obsidian sync
- [x] 4.5 `packages/worker/migrations/d1/0014_reconcile_errors.sql`: reword the "human/Obsidian edit" comment
- [x] 4.6 `packages/worker/AGENT_INSTRUCTIONS.md`: reword the `description` field guidance ("I can edit it later in Obsidian") to a tool-agnostic phrasing; `build-plugin --check` confirms the persona still parses (the bundle is generated, not committed). Also scrubbed the two `AGENTS.md` build-vault references and the worker `package.json` description.
- [x] 4.7 Remove the now-dead `COURSE_SUGGESTIONS` vocab (vault-dropdown-only; classifier/validator never read it): drop it from `src/vocab.js`, `src/vocab.d.ts`, and `test/vocab.test.ts`; drop the vault-only "Client-side validation at the editing surface" paragraph from `docs/ARCHITECTURE.md`; and drop the vault-dropdown clause + scenario from the `recipe-facet-derivation` "Component sub-recipes classify as `component`" requirement (found via a vault-term sweep, not just the `obsidian` grep)

## 5. Apply the spec deltas (at archive)

- [ ] 5.1 On archive, apply the four delta files: `recipe-authoring-vault` (all requirements REMOVED), `r2-corpus-store`, `cloudflare-data-platform`, `recipe-facet-derivation` (MODIFIED, genericized). The change validates with `openspec validate remove-obsidian-authoring-vault --strict`.
- [ ] 5.2 After archive removes its requirements, delete the emptied `openspec/specs/recipe-authoring-vault/` capability directory so no purpose-only stub remains

## 6. Verify

- [x] 6.1 `aubr typecheck` passes (exit 0, all packages)
- [x] 6.2 `aubr test:tooling` passes with `build-vault.test.mjs` gone (94/94, no missing-file error in the node --test list)
- [x] 6.3 `aubr test` (worker vitest) passes: 2793 passed, 16 skipped, 0 failed
- [x] 6.4 Repo-wide sweep for `obsidian` **and** vault-feature terms (`authoring vault`, `build-vault`, `vault-template`, `metadata menu`, `templater`, `remotely save`, `COURSE_SUGGESTIONS`, `fileClass`, `recipe-authoring-vault`) is clean outside `openspec/changes/archive/**`, this change dir, and the retired `openspec/specs/recipe-authoring-vault/` — no matches in source, docs, comments, or the generated plugin bundle
- [ ] 6.5 CI is green without the `build-vault --check` step (verified after push)
