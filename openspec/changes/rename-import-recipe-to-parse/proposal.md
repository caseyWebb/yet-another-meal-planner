## Why

The `import_recipe(url)` tool is **parse-only** — it fetches a page, extracts schema.org `Recipe` JSON-LD, and returns structured data. It writes nothing; the actual write into the corpus is `create_recipe`. The name "import" implies a write (bringing a recipe *into* the corpus), so the tool description has to lead with `PARSE-ONLY:` in all caps to counteract it. The name also collides with the `import-recipe` **skill**, which legitimately names the *whole* flow (parse → classify → write) — so one word, `import`, means two different scopes depending on whether you're looking at the skill or the tool. Renaming the tool to `parse_recipe` makes the tool name honest about its read-only behavior and resolves the skill/tool collision in one move.

## What Changes

- **BREAKING** (tool-contract): rename the MCP tool `import_recipe` → `parse_recipe`. Same signature (`url` → structured data), same behavior, same structured errors (`unreachable`, `no_jsonld`, `not_a_recipe`, `incomplete`), same `tools_hint` / `existing_slug` outputs. Name only.
- Update the sibling discovery-tool descriptions that reference the flow by name (`fetch_rss_discoveries`, `read_discovery_inbox`: "…then import_recipe + create_recipe each" → "…then parse_recipe + create_recipe each").
- Update the tool contract doc (`docs/TOOLS.md` — the `import_recipe` section + the cross-refs in the `create_recipe` notes and the `fetch_rss_discoveries` notes). (`docs/SCHEMAS.md` carries no reference to the tool by name, so it needs no edit.)
- Update the agent persona (`AGENT_INSTRUCTIONS.md` — the `import-recipe` flow body + the menu/onboarding mentions) and regenerate the plugin bundle (`npm run build:plugin`). The **skill keeps its name** (`import-recipe`) — importing is still the right verb for the whole flow.
- Update code comments that reference the tool by name (`jsonld.ts`, `http.ts`, `errors.ts`).
- **Out of scope (decided against):** merging `create_recipe` and `update_recipe`. They are disjoint by existence (create refuses an existing slug; update requires one) and carry different contracts (full write + dedup/section guards vs. partial merge + per-tenant overlay routing). They are complementary, not redundant.

## Capabilities

### New Capabilities

<!-- none — no new capability is introduced -->

### Modified Capabilities
- `recipe-discovery`: the requirements that name the parsing tool (`import_recipe parses JSON-LD and returns data without writing`, `import_recipe returns structured errors on bad input`) are reworded to `parse_recipe`. Behavior is unchanged; only the tool name in the contract changes.
- `recipe-import`: the requirement `Importer surfaces the schema.org tool list as a hint` names `import_recipe(url)` as the parse step; reworded to `parse_recipe(url)`. Behavior unchanged.

## Impact

- **Tool contract / agent surface:** `src/discovery-tools.ts` (tool registration + the `fetch_rss_discoveries` description + header comment), `docs/TOOLS.md` (the `import_recipe` section + cross-refs in the `create_recipe` and `fetch_rss_discoveries` notes), `AGENT_INSTRUCTIONS.md` (the `import-recipe` flow + the menu-gen / side-bootstrap / sparse-corpus mentions) → rebuild `plugin/`.
- **Code comments only (no behavior):** `src/jsonld.ts`, `src/http.ts`, `src/errors.ts`.
- **Not touched (verified no reference to the name):** `docs/SCHEMAS.md`, `src/discovery.ts`, and the test suite — the parse/JSON-LD tests exercise behavior, not the tool name, so no test edit is required.
- **No external consumers:** the agent discovers tools dynamically by name at connect time; there is no third-party caller pinned to `import_recipe`. The break is internal-consistency only, resolved in one pass.
- **Deployment:** Worker change → operator runs the data-repo deploy after merge to `main`.
