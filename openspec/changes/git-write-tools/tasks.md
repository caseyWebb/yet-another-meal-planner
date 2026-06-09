## 1. Atomic commit engine (GitHub Git Data API)

- [x] 1.1 Add write methods to the GitHub client (`worker/src/github.ts` or a new `github-write.ts`): create blob, create tree, create commit, get ref, update ref — authenticated with the existing `contents:read+write` PAT
- [x] 1.2 Implement `buildTreeAndCommit(changeset)`: read base ref/commit/tree, create blobs+tree for the changeset, create one commit (parent = base), update ref
- [x] 1.3 Implement optimistic ref-update with bounded retry: on non-fast-forward rejection, re-read base, replay the changeset, retry; surface `conflict`/`upstream_unavailable` on exhaustion
- [x] 1.4 Map all write failures to the structured-error convention (no raw throws)

## 2. Structural pre-commit validation (workerd-safe)

- [x] 2.1 Implement a TS validation module: TOML parse (`smol-toml`), frontmatter/YAML parse (`js-yaml`), and enum/status checks (recipe `status`, pantry `category`, grocery `status`/`kind`)
- [x] 2.2 Gate `buildTreeAndCommit` on validation; reject with structured `validation_failed` and make no commit on failure

## 3. Repo-data write tools

- [x] 3.1 Implement `update_recipe(slug, updates)` — merge frontmatter, validate, commit, return `{ slug, updated_fields }`
- [x] 3.2 Implement `update_pantry(operations)` and `mark_pantry_verified(items)`
- [x] 3.3 Implement `add_draft_ready_to_eat(items)` and `update_ready_to_eat(slug, updates)`
- [x] 3.4 Implement the user-curated `update_*` tools (`preferences`, `taste`, `diet_principles`, `substitutions`, `aliases`) as content-faithful writers
- [x] 3.5 Implement `commit_changes(payload)` — batch recipe/pantry/ready-to-eat/config updates into one commit via the engine; return sha + summary
- [x] 3.6 Register all write tools on the MCP server (`worker/src/tools.ts`) with Zod input schemas

## 4. Grocery list

- [x] 4.1 Add the `grocery_list.toml` schema to `docs/SCHEMAS.md` (fields, enums, lifecycle) and create the stub file with header comments + commented examples
- [x] 4.2 Implement `read_grocery_list` and `add_to_grocery_list` (merge-on-add by normalized `name`; new items `status: active`, `added_at` set)
- [x] 4.3 Implement `update_grocery_list` and `remove_from_grocery_list`
- [x] 4.4 Register grocery-list tools; include grocery `status`/`kind` in structural validation

## 5. Cloudflare Access gate

- [x] 5.1 Configure Cloudflare Access in front of the Worker via Managed OAuth with an only-Casey policy — done in the Zero Trust dashboard (self-hosted Public DNS app, Managed OAuth on, email policy); AUD tag captured in wrangler.jsonc
- [x] 5.2 (Defense-in-depth) Validate the `Cf-Access-Jwt-Assertion` header in the Worker — `src/access.ts` (jose), enforced in `src/index.ts`, config-gated on `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD`, tested. **Activation:** fill `ACCESS_TEAM_DOMAIN` in wrangler.jsonc with the Zero Trust team domain (AUD already set).
- [x] 5.3 Document the Access setup + the Managed-OAuth-beta fallback (`workers-oauth-provider`) in `worker/README.md`

## 6. Docs sync

- [x] 6.1 Update `docs/TOOLS.md`: grocery-list tool contracts; re-cut `write_cart_and_commit` into `commit_changes` (this change) + `place_order` (06b)
- [x] 6.2 Update `CLAUDE.md`: capture/flush behavior, three-file state model, prompted-promotion rules, grocery_list in the side-effect-files list, and the granular-vs-`commit_changes` batching discipline

## 7. Tests

- [x] 7.1 Atomic-commit tests: single-commit batching, ref-retry on non-fast-forward, structured error on exhaustion (mocked GitHub)
- [x] 7.2 Structural-validation tests: malformed TOML/frontmatter and out-of-enum values are rejected pre-commit; valid writes pass
- [x] 7.3 Grocery-list tests: merge-on-add, new-item defaults, read shape
- [x] 7.4 Write-tool tests: `update_recipe` happy path + `not_found`; `commit_changes` batches to one commit

## 8. Deploy + verify

- [x] 8.1 Deploy via CD — pushed to `main`; CD typecheck + test + deploy all green (run 27225774832). Worker live, `workers.dev` disabled, in-Worker JWT check active. Live unauthenticated-rejection `curl` against the custom domain is a quick optional confirm.
- [ ] 8.2 Authenticated `commit_changes` end-to-end — **folds into Change 07**: with Access enforced, the authorized path is the OAuth flow, which Claude.ai drives (MCP Inspector can't easily). Verify the real write when connecting Claude.ai.
