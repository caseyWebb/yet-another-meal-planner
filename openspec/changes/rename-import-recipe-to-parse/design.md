## Context

`import_recipe(url)` is registered in [src/discovery-tools.ts](../../../src/discovery-tools.ts) and is **parse-only**: fetch → extract schema.org `Recipe` JSON-LD → return structured data (plus `tools_hint` and an idempotency `existing_slug`). It writes nothing; `create_recipe` is the corpus write. The name implies a write, so the tool description opens with `PARSE-ONLY:` to fight it, and the word `import` also names the `import-recipe` *skill* (the whole parse→classify→write flow) — so "import" means two scopes depending on whether you read the skill or the tool.

The agent discovers MCP tools by name at connect time; there is no external caller pinned to the old name. This is a mechanical, behavior-preserving rename whose only real cost is touching every place the name appears in one pass (the repo's no-drift rule between code, `docs/TOOLS.md`, `docs/SCHEMAS.md`, and `AGENT_INSTRUCTIONS.md`).

## Goals / Non-Goals

**Goals:**
- Rename the MCP tool `import_recipe` → `parse_recipe` with identical signature, behavior, outputs, and structured errors.
- Keep code, the tool contract (`docs/TOOLS.md`), the agent persona (`AGENT_INSTRUCTIONS.md` → regenerated `plugin/`), and comments consistent in the same pass. (`docs/SCHEMAS.md`, `src/discovery.ts`, and the test suite carry no reference to the tool name — verified — so they need no edit.)
- Drop the now-redundant `PARSE-ONLY:` crutch language to whatever extent the name now carries it (keep a short "writes nothing" clause for precision).

**Non-Goals:**
- **Not** merging `create_recipe` and `update_recipe` (explicitly decided against — see Decisions).
- **Not** renaming the `import-recipe` skill — "import" is the right verb for the end-to-end flow.
- **No** behavior change: no new params, no changed error codes, no change to `tools_hint` / `existing_slug` / idempotency.
- **No** backward-compatible alias of the old tool name.

## Decisions

### Decision: rename to `parse_recipe` (over `fetch_recipe` / `extract_recipe` / `scrape_recipe`)
The tool does more than fetch (it extracts + normalizes JSON-LD) and "scrape" overstates it (it reads structured JSON-LD, not arbitrary HTML). `parse_recipe` matches the existing "parse-then-classify-then-create" language in the docs and the `PARSE-ONLY` description, and reads naturally as "parse a recipe page." Returning `existing_slug` is a read-side idempotency hint, so it sits comfortably under a "parse" name without implying a write.

### Decision: keep `create_recipe` and `update_recipe` separate
Considered and rejected merging them into one upsert. They are **disjoint by existence** — `update_recipe` reads the target file first (`buildRecipeUpdate` → `not_found` if absent) and `create_recipe` refuses an existing slug — so they cover mutually exclusive cases rather than overlapping ones. They also carry different contracts: `create_recipe` takes a *full* frontmatter + body with a `## Ingredients`/`## Instructions` section guard and a source-dedup guard; `update_recipe` takes a *partial* merge and routes `rating`/`status` to the caller's per-tenant overlay (D5) while refusing `last_cooked`. Fusing them yields a mode-flagged tool that re-implements both branches and loses the create-side dedup guardrail (an agent meaning to create but reusing a slug would silently overwrite a *shared* recipe). POST-with-uniqueness vs. PATCH — keep them split.

### Decision: no compatibility alias
The MCP client rebuilds its tool list from the server on each connect; nothing persists a reference to `import_recipe`. A dual-registration alias would add surface area and a deprecation tail for zero benefit. Hard rename in one pass.

### Decision: keep the rename atomic across code + docs + persona
Per the repo's no-drift rule, the tool registration, `docs/TOOLS.md` (contract), `AGENT_INSTRUCTIONS.md` (the `import-recipe` flow), and comments all change together; `npm run build:plugin` regenerates `plugin/` (never hand-edited). The build's plugin test and the existing tool/jsonld tests are the gate — they assert behavior, which the rename preserves, so a green suite plus an empty `rg` sweep is the bar.

## Risks / Trade-offs

- **Stale reference left behind in prose** (a doc or comment still saying `import_recipe`) → Mitigation: a final `rg -n 'import_recipe'` across `src/`, `docs/`, `AGENT_INSTRUCTIONS.md`, `test*/` must come back empty (allowing only intentional changelog/history mentions); the generated `plugin/` is rebuilt, not grepped for source-of-truth.
- **A live Claude.ai session mid-flow** still holds the old tool list and calls `import_recipe` after deploy → Mitigation: low-impact and self-healing — the tool list refreshes on the next connect; the call simply errors as unknown-tool for the brief window. No data risk (the tool is read-only).
- **Skill name vs. tool name now intentionally differ** (`import-recipe` skill, `parse_recipe` tool) → this is the point, not a risk, but the persona copy must state the flow as "parse_recipe → create_recipe" so the agent doesn't look for a tool matching the skill name.

## Migration Plan

1. Rename the registration in `src/discovery-tools.ts`; update the `fetch_rss_discoveries` description and the file header comment.
2. Update comments in `src/jsonld.ts`, `src/http.ts`, `src/errors.ts`.
3. Update `docs/TOOLS.md` (the `import_recipe` section + the `create_recipe` / `fetch_rss_discoveries` cross-refs).
4. Update `AGENT_INSTRUCTIONS.md`; run `npm run build:plugin`.
5. Run the suite + an `rg -n 'import_recipe'` sweep (expect empty across `src/`, `docs/`, `AGENT_INSTRUCTIONS.md`, `test*/`).
6. Merge to `main`; operator runs the data-repo deploy workflow.

**Rollback:** revert the commit; redeploy. No data migration, so rollback is a plain code revert with no state to unwind.
