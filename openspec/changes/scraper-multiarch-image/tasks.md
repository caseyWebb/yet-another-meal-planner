## 1. Multi-arch release workflow

- [ ] 1.1 In `.github/workflows/scraper-release.yml`, add `docker/setup-qemu-action` and `docker/setup-buildx-action` steps before the build (SHA-pin or version-tag consistent with the file's existing `docker/*` action pinning).
- [ ] 1.2 Add `platforms: linux/amd64,linux/arm64` to the `docker/build-push-action@v6` step; leave `context`, `file`, `tags`, and `build-args` (`SCRAPER_VERSION`, `CONTRACT_VERSION`) unchanged.
- [ ] 1.3 Confirm the GHCR login + GitHub Release steps are untouched and still `GITHUB_TOKEN`-only (no new stored secret).

## 2. Spec

- [ ] 2.1 `specs/build-automation/spec.md`: MODIFIED "The scraper is published as a container image on a tagged release" — add the multi-arch (amd64 + arm64 manifest list) mandate + a scenario; keep the GHCR / GitHub Release / `GITHUB_TOKEN` / deploy-independence / embedded-version clauses.

## 3. Docs (in lockstep)

- [ ] 3.1 `docs/SELF_HOSTING.md` (run-the-scraper section): state the published image is multi-arch (runs natively on amd64 and arm64, so an Apple-Silicon home host needs no emulation).
- [ ] 3.2 `packages/scraper/README.md`: same note where it describes the Docker image / `docker pull`.

## 4. Verification

- [ ] 4.1 `aubr typecheck` + `aubr test` + `aubr test:tooling` green (no code change expected; confirm nothing regressed). Lint/parse the workflow YAML.
- [ ] 4.2 `openspec validate "scraper-multiarch-image" --strict` passes; run `/code-review` on the diff before opening a PR.
- [ ] 4.3 **Post-merge:** cut `scraper-v1` (push tag or `workflow_dispatch`). Confirm `docker buildx imagetools inspect ghcr.io/caseywebb/groceries-scraper:1` lists both `linux/amd64` and `linux/arm64`, and that the GitHub Release was created. This is the artifact the `dirtbags` `grocery-scraper-luna` change pulls.
