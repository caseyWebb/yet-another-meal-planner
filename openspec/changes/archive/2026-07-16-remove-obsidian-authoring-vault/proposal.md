## Why

The Obsidian authoring vault is a large, committed, generated artifact — a hand-rolled build script, an authored template tree, the generated `vault/` output, a CI drift gate, and pinned third-party plugin binaries — whose entire reason to exist is one optional recipe-editing client. R2 is the source of truth for the authored corpus and is editable by any S3-compatible tool, so nothing at runtime depends on the vault: the Worker never reads it. Retiring it removes a whole build/CI/docs surface (a third generated artifact, a vocab-drift gate, vendored plugin fetching) while losing no data-integrity guarantee — the server-side reconcile validation stays authoritative.

## What Changes

- **Delete the vault build pipeline and its artifacts**: `packages/worker/scripts/build-vault.mjs`, `packages/worker/tests/build-vault.test.mjs`, the authored source `packages/worker/vault-template/`, and the generated committed `packages/worker/vault/`.
- **Unwire the build/test/CI hooks**: drop `build:vault` from the root and worker `package.json`, remove `build-vault.test.mjs` from the worker `test:tooling` list, and delete the `build-vault.mjs --check` drift-gate step from `.github/workflows/ci.yml`.
- **Remove the vault `.gitignore` entries** (root and `packages/worker`).
- **Reframe corpus authoring as a tool-agnostic R2 path** in the docs — any S3-compatible client (e.g. `rclone`) editing `recipes/*.md`, dropping the recommended-vault walkthrough: `docs/SELF_HOSTING.md` (its "R2 corpus bucket + Obsidian authoring" step), `docs/ARCHITECTURE.md`, `docs/SCHEMAS.md`, `docs/TOOLS.md`, `CONTRIBUTING.md`.
- **Scrub Obsidian-specific language** from code comments and the persona source while keeping the human-edits-onto-R2 concept: `packages/worker/src/env.ts`, `src/recipe-projection.ts`, `src/tools.ts`, `wrangler.jsonc`, the `migrations/d1/0014_reconcile_errors.sql` comment, and `AGENT_INSTRUCTIONS.md` (regenerates the plugin bundle).
- **Remove the now-dead `COURSE_SUGGESTIONS` vocab** from `src/vocab.js` (plus its `vocab.d.ts` declaration and `vocab.test.ts` assertions): its only consumer was the vault's `course` dropdown (`build-vault.mjs`); the classifier and the server validator never read it, so with the vault gone it is orphaned code. `course` stays open-vocabulary. Also removes the vault-only "Client-side validation at the editing surface" paragraph from `docs/ARCHITECTURE.md`.
- **Retire the `recipe-authoring-vault` capability** and genericize the incidental Obsidian mentions in three other living specs.
- **Not breaking**: no runtime, API, or data-shape change. The only thing lost is the vault's client-side vocab dropdowns (the editing-time "you can't type `poltry`" convenience), which the specs already declare non-authoritative — the reconcile validator and `read_reconcile_errors` remain the backstop.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `recipe-authoring-vault`: **Retired.** All of its requirements are REMOVED — the generated vault, the vocab-derived dropdowns, the authored-only schema, and the client-side-validation-complements-server requirement. The authored-vs-derived field boundary those requirements encoded is already held independently by `recipe-facet-derivation` ("Descriptive facets are derived; the hard gates and identity stay authored") and `src/recipe-contract.js`, so it is not orphaned.
- `r2-corpus-store`: The "Human-direct edits get eventual, surfaced feedback" requirement is genericized — a corpus edit made outside the Worker via any S3-compatible client (not specifically Obsidian) is validated by the reconcile and surfaced, not silently dropped. Behavior is unchanged; only the illustrative mechanism wording changes.
- `cloudflare-data-platform`: The "D1 is the system of record for domain data" requirement drops the Obsidian illustration — the R2 corpus is hand-edited via any S3-compatible file tool. Behavior unchanged.
- `recipe-facet-derivation`: Two requirements are genericized. "Derived facets are seeded synchronously at import" has its direct-edit scenario refer to the R2 corpus rather than "the Obsidian/R2 corpus". "Component sub-recipes classify as `component`" drops the clause requiring the vault dropdown to offer `component` (and its vault-dropdown scenario) — `component` stays a named classifier value and `course` stays open-vocabulary. Behavior unchanged.

## Impact

- **Code/tooling**: `packages/worker/scripts/`, `packages/worker/tests/`, `packages/worker/vault-template/`, `packages/worker/vault/`, `src/vocab.js` + `src/vocab.d.ts` + `test/vocab.test.ts` (drop `COURSE_SUGGESTIONS`), both `package.json` files, `.github/workflows/ci.yml`, two `.gitignore` files.
- **Docs/comments**: `docs/SELF_HOSTING.md`, `docs/ARCHITECTURE.md`, `docs/SCHEMAS.md`, `docs/TOOLS.md`, `CONTRIBUTING.md`, `packages/worker/AGENT_INSTRUCTIONS.md` (+ regenerated plugin bundle), `src/env.ts`, `src/recipe-projection.ts`, `src/tools.ts`, `wrangler.jsonc`, `migrations/d1/0014_reconcile_errors.sql`.
- **Runtime/API/data**: none. The Worker has no code path that reads the vault; the R2 corpus and its reconcile are untouched.
- **Accepted loss**: the vault's client-side vocab dropdowns. Mitigated by the unchanged server-side reconcile validation and the agent-readable `read_reconcile_errors` surface; the controlled vocabulary remains defined in `src/vocab.js`.
