## Why

Members read genuinely good technique writing (ATK, Serious Eats) that they want the agent to *remember* and surface at the stove — e.g. browning meat: "spread in an even layer, don't disturb, break up after browning; brown meat, not gray meat." Today there is no home for general, cross-recipe, cross-ingredient cooking wisdom: recipe notes are per-recipe, and `storage_guidance/` covers put-away, is read-only, and is keyed by ingredient class. We want a curated-by-the-member, agent-distilled technique memory that gets referenced during a guided cook — the cooking-side sibling of storage guidance.

## What Changes

- **Introduce `guidance/` as the umbrella for curated reference corpora**, with two domains: `guidance/ingredient_storage/` (the relocated storage corpus) and `guidance/cooking_techniques/` (new). **BREAKING** (data layout + tool surface): see below.
- **Relocate the existing storage corpus** `storage_guidance/` → `guidance/ingredient_storage/` in the data repo and template. No behavior change to its content; it remains shared, curated, and effectively read-only.
- **Unify the read tools** into one generic pair over `guidance/<domain>/`: `list_guidance(domain?)` and `read_guidance(domain, slugs)`, **replacing** `list_storage_guidance` / `read_storage_guidance`. **BREAKING** tool rename.
- **Add a domain-gated write tool** `save_guidance(domain, slug, content, source?)` that creates or **refines** a memory (one file per slug — refine, don't append). A **writable-domain allowlist** permits `cooking_techniques` only; `ingredient_storage` writes are rejected (`validation_failed`), preserving its read-only guarantee via the allowlist instead of via tool absence.
- **Add `cooking_techniques/` corpus**: shared, agent-writable markdown keyed by technique slug (`browning-meat.md`, `searing.md`, …), each with `description` + optional `source` frontmatter and distilled prose. Mapping recipe steps → techniques is by agent world-knowledge over the slugs (no manifest), mirroring storage guidance.
- **Add a capture flow** (new skill): the member posts an article or distillation; the agent compresses it to imperative, non-obvious bullets and persists via `save_guidance`.
- **Surface at cook time**: the `cook` skill pulls relevant technique memories (one `list_guidance` + one batched `read_guidance` at cook start) and weaves the tip inline at the matching Prep/Cook step — non-obvious only, capped like storage's 2–3.

## Capabilities

### New Capabilities
- `cooking-techniques`: the shared, agent-writable cooking-technique corpus under `guidance/cooking_techniques/`; the generic guidance tool surface (`list_guidance` / `read_guidance` read pair and the `save_guidance` write tool with its writable-domain allowlist); the capture skill; and cook-time surfacing.

### Modified Capabilities
- `storage-guidance`: corpus relocates to `guidance/ingredient_storage/`; its bespoke `list_storage_guidance` / `read_storage_guidance` read tools are replaced by the unified `list_guidance(domain)` / `read_guidance(domain, slugs)`; the "no write tool exists" requirement is amended to "the `ingredient_storage` domain is excluded from the `save_guidance` writable allowlist" (read-only preserved, enforced differently).
- `repo-structure`: the data-repo root holds `guidance/` (with `ingredient_storage/` and `cooking_techniques/` subtrees) in place of the root-level `storage_guidance/`.
- `data-validation`: the curated-markdown path reference updates from `storage_guidance/*.md` to `guidance/**/*.md` (still existence-checked prose, not parse-checked as data).
- `data-read-tools`: the passing `storage_guidance/` path reference updates to `guidance/ingredient_storage/`.

## Impact

- **Code**: `src/storage-guidance.ts` (rename/generalize to a domain-keyed guidance module; `DIR` → `guidance/<domain>`), `src/tools.ts` (replace the two read tools with `list_guidance`/`read_guidance`, add `save_guidance` with allowlist + write path + validation), `src/errors.ts` usage for the rejected-domain error.
- **Tests**: `test/storage-guidance.test.ts` (path + tool rename), add coverage for the unified read tools, `save_guidance` create/refine, and the read-only-domain rejection.
- **Docs**: `docs/SCHEMAS.md` (the `guidance/` section + `cooking_techniques` shape), `docs/TOOLS.md` (tool contract: the new tool trio), `docs/ARCHITECTURE.md` (path reference), `AGENT_INSTRUCTIONS.md` (put-away flow tool names + slug examples; new capture skill; `cook` surfacing), and the regenerated `plugin/` bundle (`npm run build:plugin`).
- **Data repos**: `git mv storage_guidance/ → guidance/ingredient_storage/` in `groceries-agent-data` and `groceries-agent-data-template`; create `guidance/cooking_techniques/`; update both READMEs.
- **No D1 migration**: the corpus is GitHub-hosted curated markdown, not a D1 table.
