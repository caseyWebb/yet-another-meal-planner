## 1. Reusable release workflow + bug fixes

- [x] 1.1 Refactor `.github/workflows/scraper-release.yml` triggers: `on: workflow_call` with a required `version` input (the auto path) + `workflow_dispatch` with **no** `version` input (manual fallback). Dropped `on: push: tags: ["scraper-v*"]` (a human tag reintroduces tag/version drift; the fallback is `workflow_dispatch`). Kept `permissions: { contents: write, packages: write }`.
- [x] 1.2 Derive/verify version from `packages/scraper/package.json` `version` (the single source of truth). When a `version` input is provided (workflow_call), assert it equals the `package.json` version and fail fast on mismatch. Tag constructed as `scraper-v<version>`. Retained the `CONTRACT_VERSION` grep from `packages/contract/src/ingest.ts` for the Release-notes body only.
- [x] 1.3 Fixed the `tag_name` bug: `softprops/action-gh-release` `tag_name` is the derived `scraper-v<version>` (`steps.v.outputs.tag`), never `${{ github.ref_name }}`.
- [x] 1.4 Removed the dead `build-args:` block (`SCRAPER_VERSION`/`CONTRACT_VERSION`) from the `docker/build-push-action` step — the Dockerfile declares no matching `ARG` and the running scraper derives both at runtime. Kept the multi-arch `platforms: linux/amd64,linux/arm64`, QEMU/Buildx setup, GHCR login, `:latest`, and the embedded-version guarantee (via the copied `package.json` + contract source). **Dockerfile unchanged.**

## 2. Idempotence guard

- [x] 2.1 Added the `guard` step to the `publish` job: `gh release view "scraper-v$version"` (with `GH_TOKEN: ${{ github.token }}`) → sets `already`; every publish step (`setup-qemu`, `setup-buildx`, GHCR login, build-push, Release) is `if: steps.guard.outputs.already == 'false'`, so an existing release makes the job a no-op. Safe against re-runs, `workflow_dispatch` at an already-published version, and accidental double-fires.

## 3. Main-push version-change detector (ci.yml)

- [x] 3.1 Added the push-only `detect-scraper-version` job (`if: github.event_name == 'push'`), `actions/checkout` with `fetch-depth: 2`, reading `packages/scraper/package.json` `version` at `HEAD` and at `HEAD^` (`git show HEAD^:...`), emitting `changed` + `version` outputs. If `HEAD^` lacks the file or it does not parse, `old=""` → treated as changed (the idempotence guard prevents an actual double-publish).
- [x] 3.2 Added the `release-scraper` job: `uses: ./.github/workflows/scraper-release.yml`, `needs: [detect-scraper-version, test, no-open-changes]`, `if: github.event_name == 'push' && needs.detect-scraper-version.outputs.changed == 'true'`, `with: { version: <detected> }`, `permissions: { contents: write, packages: write }`. `admin-ui` is deliberately NOT in the gate — it is the Worker admin-panel browser gate, unrelated to the scraper; `test` (workspace-aware) is the scraper's build/typecheck gate.
- [x] 3.3 Confirmed `trigger-deploy`'s path filter is **unchanged** — still excludes `packages/scraper/**`, so a scraper version bump publishes the image without deploying the Worker, and a Worker change never publishes a scraper image (independent control planes).

## 4. Docs + spec (in lockstep)

- [x] 4.1 `CONTRIBUTING.md` › **Scraper versioning**: added the "releasing is automatic on merge" paragraph (detector → reusable release, derived tag, GHCR + Release, idempotence, `workflow_dispatch` fallback, deploy-independence). The operator-facing "pull the image from GHCR" text in `docs/SELF_HOSTING.md` and `packages/scraper/README.md` is unchanged (accurate as-is — a `scraper-v*` release still publishes the multi-arch image; neither instructs pushing a tag).
- [x] 4.2 `openspec/specs/build-automation/spec.md`: the "published as a container image on a tagged release" requirement replaced with the MODIFIED text (package.json = published-version SoT, derived tag, auto-publish on version change, idempotent, `workflow_dispatch` fallback), layered on the multi-arch text and complementary to the untouched "Scraper version is single-sourced…" requirement (A owns *reported* version; this owns *published* version).

## 5. Self-consistency (this change's own PR)

- [x] 5.1 This change touches `ci.yml`/`scraper-release.yml`/spec/CONTRIBUTING/openspec but NOT `packages/scraper/**` or `packages/contract/**`, so (a) the live `scraper-version` PR gate no-ops on this PR (no bump required), and (b) after merge the `detect-scraper-version` job sees an unchanged version on that push → `release-scraper` is skipped → nothing publishes. Both verified by reading the gate's three-dot diff and the detector's `HEAD^` compare.

## 6. Verification

- [x] 6.1 Both workflow YAMLs parse (validated with a YAML loader); reusable `workflow_call` signature + `uses:`/`needs:`/`if:` wiring and the caller's `permissions` block checked.
- [x] 6.2 Static trigger-matrix walkthrough: (a) push to `main` with a version bump + green CI → publishes once; (b) push with no version change → publishes nothing; (c) a re-run whose `scraper-v<version>` release already exists → guard no-ops; (d) PR → detector is `if: push`-gated, release-scraper skipped; (e) `workflow_dispatch` at the current version → publishes iff not already published; (f) confirmed no `packages/scraper/**` entry in the deploy path filter.
- [ ] 6.3 **End-to-end is verifiable only by a real merge to `main` that bumps `packages/scraper/package.json` `version`** — this is CD; the publish path has no pre-merge dry-run. Expected on that merge: CI cuts `scraper-v<version>`, pushes the multi-arch image to GHCR, and the Worker deploy does not fire. This is the post-merge acceptance step to watch.
- [ ] 6.4 Run `/code-review` on the diff before opening the PR.
- [x] 6.5 Archived: MODIFIED requirement folded into the living `build-automation` spec; the change dir moved under `openspec/changes/archive/`, so `ci.yml`'s `no-open-changes` gate is satisfied.

## Notes

- **Sequencing:** built on a `main` carrying `scraper-multiarch-image` (multi-arch workflow + spec) and `scraper-version-gate` (the `scraper-version` PR gate + the "Scraper version is single-sourced…" requirement). The modified requirement is layered on that text.
- **No repo mutation on publish:** no version-bump commit, no committed tag on a branch; the `scraper-v<version>` tag is created only as part of the Release.
