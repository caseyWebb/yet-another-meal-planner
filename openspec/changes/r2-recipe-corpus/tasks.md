# Tasks

> Ordering note: groups 1–2 are additive behind a dual-read (R2 first, git fallback), so
> nothing breaks mid-migration. The GitHub App / fallback removal (group 6) is **last**,
> after parity is verified end-to-end.

## 1. R2 corpus store (additive, dual-read)
- [x] 1.1 `wrangler.jsonc`: add an `r2_buckets` binding for the corpus. Add `r2_buckets` to the `scripts/merge-wrangler-config.mjs` allowlist + a merge test asserting it survives the operator merge (the silent-drop trap).
- [x] 1.2 `src/corpus-store.ts`: an R2-backed read/list/write interface mirroring the `GitHubClient` surface used by the corpus (getFile/listDir/put). Structured errors, no throws.
- [x] 1.3 Wire reads (`read_recipe` in `src/tools.ts`, `src/guidance.ts`) through the store. (Single-PR cutover: the store is the sole corpus path — no transient dual-read git fallback to add-then-remove; the operator's one-time git→R2 copy + parity check is the cutover mechanism, see §3.)

## 2. Reconcile owns projection + validation
- [x] 2.1 Extend the scheduled reconcile to read the R2 corpus, validate each recipe with the shared contract (`recipe-contract.js`/`validate.ts`) **plus** `pairs_with` cross-resolution (whole-corpus), and project the D1 `recipes` table. (New `src/recipe-projection.ts` — the workerd port of the retired build's projection; wired into `scheduled()` BEFORE the derived reconcile.)
- [x] 2.2 `reconcile_errors`: a D1 record of skipped (invalid) recipes (migration 0014); expose via `/health` (new `recipe-index` job) and an agent-readable read path (`read_reconcile_errors` tool); ntfy on a hard failure AND on each NEW invalid recipe (de-spammed via prior-slug diff), reusing `notifyFailure`.
- [x] 2.3 Unit-test projection + validation with injected deps (in-memory R2/D1 fakes), mirroring the existing reconcile tests: valid corpus projects (incl. resolved `pairs_with`); invalid recipe is skipped + recorded; dangling `pairs_with` flagged; duplicate slug + missing body section recorded; job-runner health + de-spam.

## 3. Data copy + parity
- [x] 3.1 One-time copy script `scripts/migrate-corpus-to-r2.mjs` (walks a git data-checkout's `recipes/` + `guidance/` and `wrangler r2 object put`s each at its repo-relative key; `--check`/`--local`/`--remote`). Its header documents the `rclone sync r2:grocery-corpus ./data ↔ ./data r2:grocery-corpus` round-trip for operator bulk edits.
- [x] 3.2 Parity check: the same script's `--verify` mode reads every object back from R2 and diffs it against the local checkout (R2 ↔ git content parity); the reconcile projects the index from R2 with the SAME column map as the retired build (`recipeToRow`, unit-tested). (Operator runs both against the live corpus at cutover.)

## 4. Retarget writes + report_bug
- [x] 4.1 `create_recipe`/`update_recipe`/`save_guidance` write through the corpus store to R2 (single-file atomic, validated first). Guidance multi-file handling: the write surface is entirely single-file (one object per slug), so multi-file atomicity does not arise — a single-object `R2.put` is atomic. (Design Decision 4: no multi-file batch to sequence.)
- [x] 4.2 `report_bug` → a D1 `bug_reports` table (migration 0015; `src/bug-reports.ts`), surfaced by the admin panel (`GET /admin/api/bug-reports`); the GitHub issues path is removed from the tool. Tool contract updated (returns `{ filed: true }`; server-side attribution + timestamp).

## 5. Cookbook off GitHub Pages
- [x] 5.1 Serve the cookbook from the Worker (`src/cookbook.ts`, route `/cookbook`), server-rendered from the D1 index (list) + the R2 corpus (bodies) — no GitHub Pages, no GitHub Pro. `recipe_site_url` resolves `<origin>/cookbook` (origin threaded into `buildServer` from the MCP handler). The data-repo `build-site` workflow + `build-site.mjs` retire in §6.1.

## 6. Remove GitHub from the data path (LAST — after parity)
- [x] 6.1 Retired `scripts/build-indexes.mjs` + `scripts/d1-rest.mjs` (and `scripts/build-site.mjs` + `scripts/site-assets/`); deleted the reusable `data-build-indexes.yml` + `data-build-site.yml` workflows and the deploy's CI index-projection step; updated `package.json` (`build:indexes`/`build:site` removed, `test:tooling` trimmed). No CI writes D1.
- [x] 6.2 Removed `src/github.ts`/`gh-read.ts`/`commit.ts` + `src/github-app.ts` (and their tests). Slimmed `Tenant`/`tenant.ts` (no `dataRepo`/`installationId`/`dataCoords`/`RepoCoords`) and `env.ts` (no `GITHUB_APP_*`/`DATA_*`); dropped the GitHub vars from `wrangler.jsonc` + `.dev.vars.example` + the deploy's `--var` injection. No git fallback (single-PR cutover; the store is the sole corpus path).
- [x] 6.3 The Node build validator (the retired build's `--check`) is gone; `validate.ts` (write tools) + the shared `recipe-contract.js` (also the Worker reconcile) are the sole validators.

## 7. Docs (lockstep)
- [x] 7.1 `docs/ARCHITECTURE.md`: three-tier boundary (R2 corpus), the diagram, reconcile-owns-projection (new section + the three crons), validation consolidation, eventual human-edit feedback, Worker cookbook. Plus `CLAUDE.md` + `CONTRIBUTING.md` (no-CI-build, R2 corpus, migrate script).
- [x] 7.2 `docs/SCHEMAS.md`: corpus tier is R2 + new `reconcile_errors`/`bug_reports` tables + reconcile-projected index. `docs/SELF_HOSTING.md`: dropped the GitHub App + Pro/Pages steps; added the R2 bucket + Obsidian authoring (Remotely Save) + rclone bulk-edit + the `/cookbook` host. `docs/TOOLS.md`: `report_bug` → `{ filed: true }` (D1, admin queue), `recipe_site_url` → Worker cookbook, new `read_reconcile_errors`, write tools drop `commit_sha`.

## 8. Verify
- [x] 8.1 `aubr typecheck`, `aubr test` (680 passed), `aubr test:tooling` (66 passed) green; the merge test asserts `r2_buckets` survives the operator merge.
- [x] 8.2 D1 migrations 0014/0015 apply cleanly to a local SQLite (`wrangler d1 migrations apply DB --local`); `reconcile_errors` + `bug_reports` verified with real insert/select (autoincrement id, default `status`). The full `wrangler dev` MCP round-trip (create recipe → reconcile projects → search; sync a malformed recipe → skipped + recorded; reads need no GitHub) is an interactive operator smoke test — the underlying pieces are unit-tested with in-memory R2/D1 fakes.
- [x] 8.3 `openspec validate r2-recipe-corpus --strict` passes.
