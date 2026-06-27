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
- [ ] 3.1 One-time copy of the git corpus → R2 (`rclone`/script). Document the `rclone sync` round-trip for operator bulk edits.
- [ ] 3.2 Parity check: `read_recipe`/`list_guidance` return identical content from R2 vs git across the whole corpus; index projected from R2 matches the CI-built index.

## 4. Retarget writes + report_bug
- [x] 4.1 `create_recipe`/`update_recipe`/`save_guidance` write through the corpus store to R2 (single-file atomic, validated first). Guidance multi-file handling: the write surface is entirely single-file (one object per slug), so multi-file atomicity does not arise — a single-object `R2.put` is atomic. (Design Decision 4: no multi-file batch to sequence.)
- [x] 4.2 `report_bug` → a D1 `bug_reports` table (migration 0015; `src/bug-reports.ts`), surfaced by the admin panel (`GET /admin/api/bug-reports`); the GitHub issues path is removed from the tool. Tool contract updated (returns `{ filed: true }`; server-side attribution + timestamp).

## 5. Cookbook off GitHub Pages
- [x] 5.1 Serve the cookbook from the Worker (`src/cookbook.ts`, route `/cookbook`), server-rendered from the D1 index (list) + the R2 corpus (bodies) — no GitHub Pages, no GitHub Pro. `recipe_site_url` resolves `<origin>/cookbook` (origin threaded into `buildServer` from the MCP handler). The data-repo `build-site` workflow + `build-site.mjs` retire in §6.1.

## 6. Remove GitHub from the data path (LAST — after parity)
- [ ] 6.1 Retire `scripts/build-indexes.mjs` + `scripts/d1-rest.mjs` and the data-repo `build-indexes.yml` (no CI D1 writes).
- [ ] 6.2 Remove the dual-read git fallback; remove `src/github.ts`/`gh-read.ts`/`commit.ts` corpus use and `src/github-app.ts` + the installation-token resolver from the data path.
- [ ] 6.3 Retire the Node build validator; `validate.ts` is the sole validator.

## 7. Docs (lockstep)
- [ ] 7.1 `docs/ARCHITECTURE.md`: three-tier boundary (R2 corpus), reconcile-owns-projection, validation consolidation, eventual human-edit feedback.
- [ ] 7.2 `docs/SCHEMAS.md`: corpus tier is R2. `docs/SELF_HOSTING.md`: drop the GitHub App + Pro steps; add R2 + Obsidian authoring + cookbook host. `docs/TOOLS.md`: `report_bug` sink, `recipe_site_url`.

## 8. Verify
- [ ] 8.1 `aubr typecheck`, `aubr test`, `aubr test:tooling` green; merge test asserts `r2_buckets` survives.
- [ ] 8.2 Local: `wrangler dev` with a local R2; create/read a recipe, run the reconcile, confirm the index; sync a malformed recipe, confirm it's skipped + recorded; confirm reads need no GitHub.
- [ ] 8.3 `openspec validate r2-recipe-corpus --strict` passes.
