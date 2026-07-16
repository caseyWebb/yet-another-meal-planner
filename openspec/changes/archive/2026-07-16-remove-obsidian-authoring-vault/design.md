## Context

Obsidian appears in this repo as an **optional, client-side recipe-authoring surface** layered on the R2 corpus bucket, not as a subsystem the Worker talks to. The bucket is the source of truth; the Worker reads and reconciles `recipes/*.md` directly through `src/corpus-store.ts`. The vault is a generated, committed artifact (the third alongside the plugin bundle and the admin panel) built by `scripts/build-vault.mjs` from `vault-template/` + `src/vocab.js`, whose Metadata Menu `recipe` fileClass turns vocab-bound facets into dropdowns and whose plugin binaries are fetched-and-verified at build. A CI step runs `build-vault --check` to gate drift between the dropdowns and `src/vocab.js`.

The retirement decision is: **keep human authoring, drop the Obsidian-specific machinery.** Corpus editing becomes tool-agnostic — any S3-compatible client (e.g. `rclone`, already documented for bulk edits) against the R2 bucket.

## Goals / Non-Goals

**Goals**
- Remove all Obsidian *code* (build script, tests, template, generated vault, build/CI/gitignore hooks).
- Remove all Obsidian *references* from living docs, code comments, the persona source, and living specs.
- Preserve the human-edits-onto-R2 concept and the correctness backstop it relies on.

**Non-Goals**
- Changing how recipes are authored *through the agent* (`create_recipe` / `parse_recipe` are untouched).
- Changing the R2 corpus store, the reconcile, the recipe index, or any runtime behavior.
- Re-homing the controlled vocabulary: `src/vocab.js` stays the single source of truth for the server validator; only the vault's consumption of it goes away.

## Key Decisions

### 1. Zero runtime coupling → this is a deletion, not a refactor
No file under `packages/worker/src/` imports the vault or the build script; the only non-doc touchpoints are `package.json` scripts, one CI step, and two `.gitignore` blocks. Removing the vault therefore cannot change Worker behavior. This is the core safety argument and the reason the change carries no runtime spec deltas.

### 2. What replaces the vault: tool-agnostic R2 editing
Docs reframe authoring around editing `recipes/*.md` in R2 with any S3-compatible client. `rclone` is already the documented bulk-edit/migration path, so the "how do I author?" story does not go dark — it loses a turnkey GUI, not the capability. The member/agent read paths (search, cookbook, `display_recipe`) are unaffected.

### 3. The one accepted loss, and why it is safe
The vault's client-side vocab dropdowns (preventing an author typing `poltry`) disappear. The `recipe-authoring-vault` spec already declared this a *convenience*, not a guarantee: "Client-side validation complements, not replaces, the server validator." The authoritative gate is the reconcile's `validate.ts`, and malformed edits are surfaced four ways (D1 `reconcile_errors`, `/health`, the `read_reconcile_errors` MCP tool, an ntfy push). Nothing that guards index integrity is removed.

### 4. The authored-vs-derived boundary is not orphaned
`recipe-authoring-vault` encoded "the authoring schema exposes only human-authored fields; derived facets are absent." That invariant is independently owned by `recipe-facet-derivation` ("Descriptive facets are derived; the hard gates and identity stay authored") and `src/recipe-contract.js`. Retiring the vault spec loses no unique invariant.

### 5. Spec-delta mechanics
- `recipe-authoring-vault` → `## REMOVED Requirements` for all four requirements (each with Reason + Migration). After archive, the now-empty capability directory under `openspec/specs/recipe-authoring-vault/` is removed so no purpose-only stub lingers.
- `r2-corpus-store`, `cloudflare-data-platform`, `recipe-facet-derivation` → `## MODIFIED Requirements` that restate the affected requirement in full with Obsidian genericized to "an S3-compatible client / file tool". These are wording-only; the SHALL behavior is identical, but they are expressed as deltas because the requirement text itself changes (and two `r2-corpus-store` scenario titles literally contain "Obsidian").

### 6. Docs reword to current-state, not history
Per the living-docs rule, rewrites describe the tool-agnostic path directly; they do not narrate "previously used Obsidian." `docs/SELF_HOSTING.md` step 2 is renamed from "The R2 corpus bucket + Obsidian authoring" to a corpus-authoring step centered on R2 + an S3 client. The ARCHITECTURE ASCII diagram's "Obsidian vault syncs to this same bucket" annotation becomes a generic "S3-compatible client syncs to this bucket."

## Risks / Trade-offs

- **Loss of editing-time vocab guardrails** — accepted; mitigated by unchanged server validation + `read_reconcile_errors` (Decision 3).
- **Operators currently using the vault** — this is a personal-scale project; the corpus stays plain markdown in R2, so an existing Obsidian user can keep pointing their own Obsidian at the bucket. The repo simply stops shipping and gating the preconfigured vault. Docs note the R2 path rather than forbidding any particular editor.
- **Plugin binaries in history** — the heavy `main.js`/`styles.css` were gitignored and never committed, so removal touches only committed config/manifests; no history rewrite is needed.

## Migration Plan

1. Delete code/artifacts and unwire build/test/CI/gitignore hooks.
2. Regenerate the plugin bundle after editing `AGENT_INSTRUCTIONS.md` (`aubr build:plugin`) — the bundle is generated, never hand-edited.
3. Reword docs, comments, and specs.
4. `aubr typecheck && aubr test:tooling && aubr test` — the tooling suite must pass with `build-vault.test.mjs` gone; CI must be green without the drift-gate step.
5. On archive, apply the spec deltas and delete the emptied `recipe-authoring-vault` capability directory.

## Open Questions

None blocking. If a co-author relies on the generated vault today, they retain a working corpus (plain markdown in R2) and any Obsidian client of their own; only the repo-shipped, CI-gated vault product is retired.
