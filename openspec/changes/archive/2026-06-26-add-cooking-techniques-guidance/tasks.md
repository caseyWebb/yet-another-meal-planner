## 1. Worker: generalize the guidance module

- [x] 1.1 Rename/generalize `src/storage-guidance.ts` into a domain-keyed guidance module: a `DOMAINS` controlled vocabulary (`ingredient_storage`, `cooking_techniques`) mapping each to its `guidance/<domain>/` directory, with domain validation that rejects unknown/path-unsafe domains via a structured error.
- [x] 1.2 Keep the slug-safety regex and `slugFromFile` helper; apply the existing absent-tree-is-empty behavior per domain.
- [x] 1.3 Implement `listGuidance(gh, domain?)` — single domain when given, all domains grouped when omitted (slug + optional `description` from frontmatter).
- [x] 1.4 Implement `readGuidance(gh, domain, slugs)` — named entries' content; unknown slug → structured `not_found`.
- [x] 1.5 Implement `saveGuidance(gh, domain, slug, content, source?)` — enforce the WRITABLE-domain allowlist (`cooking_techniques` only); reject `ingredient_storage` and any non-allowlisted domain with `validation_failed`; create-or-overwrite the single slug file (refine, not append); write `source`/`description` frontmatter.

## 2. Worker: tool surface

- [x] 2.1 In `src/tools.ts`, remove `list_storage_guidance` / `read_storage_guidance` and register `list_guidance(domain?)` and `read_guidance(domain, slugs)`.
- [x] 2.2 Register `save_guidance(domain, slug, content, source?)` wired to `saveGuidance`, returning structured errors from `src/errors.ts` (incl. the read-only-domain rejection).
- [x] 2.3 Confirm the write goes through the same GitHub commit path used by other agent-writable corpora (e.g. `stores`/`feeds`), with a clear commit message.

## 3. Worker: validation

- [x] 3.1 Update any build/Worker validation path that references `storage_guidance/` to glob `guidance/**/*.md`, keeping it existence-only (no data parse-check) for both domains.

## 4. Tests

- [x] 4.1 Update `test/storage-guidance.test.ts` (and `test/github.test.ts`) for the new path (`guidance/ingredient_storage/`) and the renamed read tools.
- [x] 4.2 Add tests for `list_guidance` (single-domain and all-domains-grouped) and `read_guidance` (content + unknown-slug `not_found`).
- [x] 4.3 Add tests for `save_guidance`: create new slug, refine existing slug (no duplicate file), and the `ingredient_storage` (read-only) rejection.
- [x] 4.4 Run `npm test` green.

## 5. Docs (same-pass, no drift)

- [x] 5.1 `docs/SCHEMAS.md`: replace the `storage_guidance/` section with a `guidance/` section documenting both domains and the `cooking_techniques` file shape (`description` + `source` frontmatter + distilled prose).
- [x] 5.2 `docs/TOOLS.md`: document `list_guidance` / `read_guidance` / `save_guidance` (params, returns, the writable-domain allowlist + read-only-domain rejection); remove the old storage tool entries.
- [x] 5.3 `docs/ARCHITECTURE.md`: update the storage-guidance/path references to the `guidance/` umbrella.

## 6. Agent persona

- [x] 6.1 `AGENT_INSTRUCTIONS.md`: update the put-away flow to call `list_guidance("ingredient_storage")` / `read_guidance("ingredient_storage", …)` and refresh slug examples.
- [x] 6.2 Add a new capture skill: member posts an article/URL/distillation → distill to imperative non-obvious bullets → read-existing-then-merge → `save_guidance("cooking_techniques", …)` with `source`; best-effort fetch, accept pasted text.
- [x] 6.3 Extend the `cook` skill: at cook start `list_guidance("cooking_techniques")`, map steps→techniques by world-knowledge, `read_guidance` the few that fit, weave non-obvious tips inline at the matching step (capped ~2, silence when nothing matches).
- [x] 6.4 Rebuild the plugin bundle: `npm run build:plugin` (never hand-edit `plugin/`).

## 7. Data repos (relocation + seed)

- [x] 7.1 In `groceries-agent-data` and `groceries-agent-data-template`: `git mv storage_guidance/ guidance/ingredient_storage/` (no content change).
- [x] 7.2 Create `guidance/cooking_techniques/` and seed `browning-meat.md` as the worked example (description + source + distilled prose).
- [x] 7.3 Update both data repos' `README.md` references from `storage_guidance/` to `guidance/`.

## 8. Verify & land

- [x] 8.1 Confirm `openspec validate "add-cooking-techniques-guidance"` passes and no `storage_guidance` references remain in code/docs/persona (grep).
- [x] 8.2 Merge the Worker change to `main` (CI auto-dispatches the data-repo deploy; no D1 migration); land the data-repo move close in time so reads don't 404 on the old path.
