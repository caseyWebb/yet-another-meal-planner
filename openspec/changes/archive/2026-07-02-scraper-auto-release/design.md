## Context

The scraper release workflow (`.github/workflows/scraper-release.yml`, post-`scraper-multiarch-image`) triggers on `push: tags: ["scraper-v*"]` + `workflow_dispatch(version)`. It derives the version from `inputs.version` else `${GITHUB_REF_NAME#scraper-v}`, greps `CONTRACT_VERSION` out of `packages/contract/src/ingest.ts`, sets up QEMU + Buildx, builds a multi-arch (`linux/amd64,linux/arm64`) image via `docker/build-push-action@v6` (context `.`, `packages/scraper/Dockerfile`), pushes `ghcr.io/<owner>/groceries-scraper:<version>` + `:latest`, and cuts a Release via `softprops/action-gh-release@v2`. Permissions are `contents: write` + `packages: write`; auth is the built-in `GITHUB_TOKEN` only.

Three facts shape the design:

1. **The running scraper already treats `packages/scraper/package.json` `version` as authoritative.** `src/push.ts` reads it at module load (`readFileSync(../package.json)`) and stamps `scraper_version` on every ingest batch; the contract version comes from the `CONTRACT_VERSION` import (`packages/contract/src/ingest.ts` = `"v1"`). Nothing at runtime consults the git tag. So the tag is a redundant, drift-prone second home for the version.
2. **The Dockerfile declares no `ARG SCRAPER_VERSION`/`ARG CONTRACT_VERSION`.** The `build-args:` the workflow passes are dead — they feed nothing. The image "embeds" the versions only in the sense that `package.json` and the contract source are `COPY`'d in and read at runtime.
3. **A tag pushed by the built-in `GITHUB_TOKEN` does not trigger `on: push` workflows** (GitHub's loop-prevention rule). This is the load-bearing constraint for the whole trigger topology.

`ci.yml` already runs `on: push: branches: [main]` (plus PR + dispatch), tests every workspace package including the scraper, and has a push-only `trigger-deploy` job gated on `needs: [no-open-changes, test]` whose path filter deliberately excludes `packages/scraper/**`. That job is the template for how a push-triggered, CI-gated, control-plane-independent job is wired here.

## Goals / Non-Goals

**Goals:**
- Make `packages/scraper/package.json` `version` the single source of truth; derive the tag and the published label from it so they cannot drift.
- Publish automatically on merge to `main` when (and only when) the scraper version changed — no human tag, no commit-back, no stored secret.
- Be safe to re-run: never double-publish an already-released version.
- Fix the `tag_name` bug and the dead build-args in the same pass.
- Keep everything the `build-automation` spec already mandates: GHCR, a GitHub Release, `GITHUB_TOKEN`-only, multi-arch, embedded version, independence from the Worker deploy.

**Non-Goals:**
- No change to *when a version bump is required* — that is `scraper-version-gate`'s job (this change assumes it).
- No automatic version bumping (no `npm version`, no bot commit). The human bumps the version in the PR; CI only reacts to it.
- No change to the scraper runtime, the Dockerfile, the contract, or the Worker.
- No new stored secret, no PAT, no cross-repo dispatch for the scraper release.

## Decisions

### 1. Version source of truth = `packages/scraper/package.json`; tag is derived

The release reads the version from `packages/scraper/package.json` `version` and constructs the tag as `scraper-v<version>`. The reusable workflow accepts a `version` input (what the detector computed) but **re-reads `package.json` at checkout and fails fast if the two disagree** — a belt-and-suspenders guard against `main` advancing between detect and release. `package.json` is always authoritative; the input is a cross-check, not an override. This closes the drift the `${GITHUB_REF_NAME#scraper-v}` derivation opened: the label the image reports and the tag it ships under are the same value the running scraper reports.

*Alternatives considered:* keep deriving from the tag/input — rejected, it is the drift source; a `scraper_version` build-arg baked at build time — rejected, the runtime already reads `package.json` and a build-arg would be a second source to keep in sync.

### 2. Trigger topology — reusable release + main-push detector, published inline

`scraper-release.yml` becomes a **reusable** workflow:

- `on: workflow_call` with a required `version` input (the auto path), plus `workflow_dispatch` (manual fallback; **no** `version` input — it derives from `package.json`).
- One `publish` job: derive/verify version → idempotence guard → QEMU/Buildx → GHCR login → multi-arch build-push → create Release with `tag_name: scraper-v<version>`.

The detector lives in `ci.yml` (the existing `on: push: branches: [main]` workflow), as a pair of jobs modeled on `trigger-deploy`:

```yaml
detect-scraper-version:
  if: github.event_name == 'push'
  runs-on: ubuntu-latest
  outputs:
    changed: ${{ steps.detect.outputs.changed }}
    version: ${{ steps.detect.outputs.version }}
  steps:
    - uses: actions/checkout@... # v7.0.0 (SHA-pinned as elsewhere)
      with: { fetch-depth: 2 }
    - id: detect
      run: |
        new=$(node -p "require('./packages/scraper/package.json').version")
        old=$(git show HEAD^:packages/scraper/package.json 2>/dev/null \
              | node -p "JSON.parse(require('fs').readFileSync(0)).version" 2>/dev/null || echo "")
        if [ "$new" != "$old" ]; then
          echo "changed=true"  >> "$GITHUB_OUTPUT"
        else
          echo "changed=false" >> "$GITHUB_OUTPUT"
        fi
        echo "version=$new" >> "$GITHUB_OUTPUT"

release-scraper:
  needs: [detect-scraper-version, test, no-open-changes]
  if: needs.detect-scraper-version.outputs.changed == 'true'
  uses: ./.github/workflows/scraper-release.yml
  with:
    version: ${{ needs.detect-scraper-version.outputs.version }}
  permissions:
    contents: write
    packages: write
```

(Exact parsing is the implementer's to finalize; the shape is: read `version` at HEAD and HEAD^, compare, emit `changed` + `version`.)

**Why inline, not "push a tag and let the tag trigger fire":** a `scraper-v<version>` tag pushed by the built-in `GITHUB_TOKEN` would NOT trigger `on: push: tags` (GitHub suppresses workflow triggers for token-pushed refs). Relying on that would silently never publish. Instead the detector calls the reusable release **in the same run** via `uses:`, and the `softprops/action-gh-release` step creates the `scraper-v<version>` tag *as part of* cutting the Release — one run, no cross-workflow retrigger, no loop.

**Why the detector lives in `ci.yml`, not a standalone workflow:** the release must be gated on green CI (never publish a broken image), and reusing `ci.yml`'s existing `test` + `no-open-changes` jobs as `needs:` is the simplest correct way to get that gate — exactly how `trigger-deploy` is gated. A standalone `scraper-auto-release.yml` would have to re-establish the gate via `workflow_run` choreography, which runs against the *default-branch* workflow definition and complicates correlating the run with the pushed SHA/version. Co-locating the jobs does **not** couple the two control planes: independence (per the spec) means neither *triggers* the other, and that still holds — the Worker deploy's path filter excludes `packages/scraper/**`, and the scraper release fires only on a scraper-version change. Sharing the `test`/`no-open-changes` gate jobs is a shared quality gate, not a shared control plane.

*Alternative considered:* standalone `scraper-auto-release.yml` with `on: push: [main]` doing detect + `uses:` in one file — viable and arguably "cleaner" as a separate file, but then gating on green CI needs `workflow_run` (heavier, default-branch-definition semantics). Recommended path is the `ci.yml` jobs; the standalone file is the fallback if co-location is judged to muddy `ci.yml`.

### 3. Keep or drop `on: push: tags: scraper-v*` — recommend DROP

**Recommendation: drop it.** With `package.json` as the source of truth and auto-release on merge, a human-pushed tag is a redundant third path whose only distinct behavior is *reintroducing drift*: a human could push `scraper-v0.2.0` while `package.json` says `0.1.0`, publishing a mislabeled image (the exact failure this change eliminates). A human-pushed tag *does* trigger `on: push` (only `GITHUB_TOKEN`-pushed tags are suppressed), so keeping it would be a live, drift-prone entry point. Everything a human needs is covered by `workflow_dispatch` (which derives from `package.json` and is therefore drift-proof). Dropping the tag trigger also has no effect on the inline tag the Release step creates — that tag is made by `GITHUB_TOKEN` and would not have re-triggered the workflow anyway.

### 4. Idempotence — guard against double-publish

Before building, the `publish` job checks whether a Release for `scraper-v<version>` already exists (`gh release view "scraper-v$version"` with `GH_TOKEN: ${{ github.token }}`; a non-zero exit means "not published"). If it exists, the job skips the build/push/release steps and succeeds as a no-op. This makes the publish safe against: a workflow re-run of the version-bump push, a `workflow_dispatch` fired at an already-published version, and any accidental double-fire. The check keys on the Release/tag existence rather than the GHCR image, because the Release/tag is the atomic "this version shipped" marker and GHCR tags are mutable (re-pushing an image is wasteful but the real double-publish hazard is a second Release / re-created tag).

### 5. Fix the `tag_name` bug and drop the dead build-args

- **`tag_name`:** set it explicitly to `scraper-v${{ steps.<derive>.outputs.version }}`, never `${{ github.ref_name }}`. On `workflow_call`/`workflow_dispatch` (both running with `github.ref_name == main`) the old value would tag the Release `main`. With the tag derived from `package.json`, the Release, the tag, and the image label are one value.
- **Dead build-args:** remove the `build-args:` block (`SCRAPER_VERSION`/`CONTRACT_VERSION`) from the build-push step. The Dockerfile declares no matching `ARG`, so they feed nothing; the running scraper reports its version from `package.json` and its contract version from the `@grocery-agent/contract` import at runtime. The image still "embeds" both because `package.json` and the contract source are `COPY`'d in — the spec's embedded-version requirement stays satisfied without the build-args. The **Dockerfile needs no edit**; the dead args exist only in the workflow. The contract-version grep is retained for the Release notes body.

## Risks / Trade-offs

- **A version bump that breaks the build still publishes** → Mitigation: the `release-scraper` job `needs: [test, no-open-changes]`, so it never runs on red CI; `test` typechecks/tests the scraper package (workspace-aware CI).
- **`HEAD^` has no `packages/scraper/package.json` (first import / shallow history)** → Mitigation: `fetch-depth: 2`; if the old file is absent or unparseable, treat the version as changed and let the idempotence guard (Decision 4) prevent an actual double-publish. This degrades safely toward "publish once."
- **A squash-merge vs a true merge commit** → both work: `HEAD^` is the prior `main` tip (first parent), which is the correct baseline; the repo merges PRs as single commits and as merge commits, both handled by `fetch-depth: 2`.
- **Co-locating the detector in `ci.yml` reads as "coupled to the Worker deploy"** → Mitigation: documented in Decision 2 and asserted in the spec — independence is *no cross-triggering*, which holds; the shared jobs are a quality gate. If a reviewer prefers stricter file-level separation, the standalone-workflow fallback is available.
- **`workflow_dispatch` fallback fires at a stale `package.json`** → acceptable: it derives from whatever `main` currently declares and is guarded by idempotence; its purpose is re-running a transiently-failed publish for the current version.

## Rollout

1. Refactor `scraper-release.yml` → `on: workflow_call(version)` + `workflow_dispatch`; derive/verify version from `package.json`; add the idempotence guard; fix `tag_name`; drop the dead build-args; drop `on: push: tags: scraper-v*`.
2. Add the `detect-scraper-version` + `release-scraper` jobs to `ci.yml` (push-only, gated on `test` + `no-open-changes`, `uses:` the reusable release).
3. Reword any maintainer-facing "push a `scraper-v*` tag" release instruction in docs.
4. Update the `build-automation` spec (the modified requirement).

**Rollback:** revert the workflow changes; the manual `scraper-v*` tag / `workflow_dispatch` path is the prior behavior. Nothing published is retroactively affected (Releases/images already on GHCR stand).

## Open Questions

- **Detector home — `ci.yml` jobs vs standalone `scraper-auto-release.yml`.** Recommended: `ci.yml` jobs (green-CI gate via existing `needs:`). Confirm at apply; the standalone-file fallback is documented.
- **Idempotence probe — `gh release view` vs `git ls-remote --tags`.** Both work; `gh release view` is preferred (the Release is the canonical shipped-marker). Implementer's call.
- **Docs depth.** Whether `CONTRIBUTING.md` carries an explicit "cutting a scraper release" section that needs rewording, or the operator-facing GHCR-pull text is the only mention — resolve while touching docs (the operator-facing text is unaffected either way).
