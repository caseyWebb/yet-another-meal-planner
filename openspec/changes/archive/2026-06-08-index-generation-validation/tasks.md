## 1. Toolchain setup

- [x] 1.1 Add `mise.toml` pinning Node 22 LTS
- [x] 1.2 Add `package.json` with `gray-matter` + `smol-toml` deps, a `build:indexes` script, and a `prepare` script that sets `core.hooksPath` to `scripts/githooks`
- [x] 1.3 Run `npm install`, commit `package-lock.json`, and confirm `node_modules/` is gitignored
- [x] 1.4 Verify `prepare` wired `core.hooksPath` to the committed hooks dir on install

## 2. Build script — walk & emit

- [x] 2.1 Create `scripts/build-indexes.mjs` with a core walk function taking `inputDir` (default `recipes/`)
- [x] 2.2 Parse recipe frontmatter with `gray-matter`; derive `slug` from filename; inject `slug` into each record
- [x] 2.3 Build `recipes.json` as a slug-keyed object carrying all statuses
- [x] 2.4 Build `components.json` as a component-keyed adjacency of `produced_by` / `used_by`
- [x] 2.5 Build `ready_to_eat.json` as a meal-keyed object with `items` + `variety_rules`, parsing the three TOMLs with `smol-toml`
- [x] 2.6 Normalize date-typed frontmatter fields to `YYYY-MM-DD` strings before serialization
- [x] 2.7 Sort object keys and use stable formatting so output is byte-identical run-to-run
- [x] 2.8 Handle an empty `recipes/` directory by emitting `{}` and exiting successfully

## 3. Validation gate

- [x] 3.1 Hard-fail on unparseable YAML frontmatter or unparseable `.toml`, reporting the offending file
- [x] 3.2 Hard-fail on `status` outside `active|draft|rejected|archived` and on missing/empty `title`
- [x] 3.3 Hard-fail on duplicate slugs, naming the conflicting files
- [x] 3.4 Hard-fail on unresolved `uses_components` / `produces_components` references
- [x] 3.5 Warn (no failure) on missing recommended optional fields; default optional arrays to `[]`
- [x] 3.6 Parse-check all tracked `.toml` files without deep schema validation of user-data TOMLs
- [x] 3.7 Exit non-zero on any hard failure; print a readable summary of failures and warnings

## 4. Fixtures & tests

- [x] 4.1 Add `tests/fixtures/` with 2-3 dummy recipes including one `status: draft` and one `produces`/`uses` component pair
- [x] 4.2 Add a test that runs the walk against `tests/fixtures/` and asserts the three index shapes
- [x] 4.3 Add a determinism test: run the build twice and assert byte-identical output (covers date normalization + key sorting)
- [x] 4.4 Add a validation test asserting each hard-fail rule trips and that soft cases only warn

## 5. Pre-commit hook

- [x] 5.1 Add `scripts/githooks/pre-commit` that runs validation only and aborts the commit on failure
- [x] 5.2 Confirm the hook never regenerates or stages `_indexes/` (leaves the tree unmodified)
- [x] 5.3 Manually verify a malformed recipe blocks the commit and a clean one passes

## 6. GitHub Action

- [x] 6.1 Add `.github/workflows/build-indexes.yml` triggered on push to `recipes/**` and `ready_to_eat/**`
- [x] 6.2 Install mise/Node, run validation, and regenerate indexes in the job
- [x] 6.3 Grant `contents: write`; commit regenerated indexes back with `[skip ci]` in the message
- [x] 6.4 Skip the commit entirely when regenerated output is unchanged
- [x] 6.5 Add `concurrency` grouping per ref to serialize overlapping runs

## 7. Documentation

- [x] 7.1 Add a validation-failure-modes section to `README.md` (hard-fail vs warn, how to run the build locally)
- [x] 7.2 Note the fresh-clone setup sequence (mise install → npm install wires the hook)

## 8. Verification

- [x] 8.1 Run `npm run build:indexes` against the empty corpus and confirm clean empty indexes
- [x] 8.2 Push a fixture-derived recipe on a branch and confirm the Action regenerates, validates, and commits with `[skip ci]` without re-triggering — verified on PR #1: run 27169891237 succeeded, bot commit 3c01647 "Regenerate indexes [skip ci]" pushed, no re-trigger (total runs stayed 1)
- [x] 8.3 Confirm `openspec validate` passes for the change
