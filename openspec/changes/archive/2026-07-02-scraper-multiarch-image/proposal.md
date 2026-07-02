## Why

The walled-source scraper is published as a single-arch container image: `scraper-release.yml` builds on `ubuntu-latest` with `docker/build-push-action` and no platform matrix, so `ghcr.io/caseywebb/groceries-scraper` is **linux/amd64 only**. The operator's home-network host is an Apple-Silicon Mac mini (`luna`, arm64, OrbStack). An amd64-only image runs there only under emulation, and the scraper's whole reason to exist off-cloud is the **browser tier** — headless Chromium replaying the operator's own subscription session for sources that need a rendered DOM (NYT Cooking). Chromium under CPU emulation is the classic breakage; the HTTP tier might limp along, the browser tier does not.

No `scraper-v*` release has been cut yet, so this is also the first release. Making the image **multi-arch (amd64 + arm64)** before cutting it means the arm64 variant runs natively on `luna` — browser tier included — and the amd64 variant still serves any x86 home server. The base image (`mcr.microsoft.com/playwright:v1.61.1-jammy`) is already published multi-arch and the rest of the build (mise + `aube ci` + tsx, Chromium from the per-arch base) is architecture-agnostic, so this is a small workflow change, not a rebuild.

## What Changes

- **`scraper-release.yml` builds a multi-arch manifest.** Add `docker/setup-qemu-action` + `docker/setup-buildx-action` and set `platforms: linux/amd64,linux/arm64` on the `build-push-action` step, so a `scraper-v*` tag publishes a **manifest list** covering both architectures under the existing `:<version>` and `:latest` tags. `SCRAPER_VERSION`/`CONTRACT_VERSION` build-args and the GitHub Release step are unchanged.
- **Cut the first release, `scraper-v1`** (a post-merge operator action, not a code change), producing the multi-arch image the `dirtbags` deployment pulls.
- **Docs describe the image as multi-arch.** `docs/SELF_HOSTING.md` (the run-the-scraper section) and `packages/scraper/README.md` state the published image runs natively on amd64 and arm64 (so an Apple-Silicon home host needs no emulation), matching current state once the release is cut.

## Capabilities

### Modified Capabilities

- `build-automation`: the scraper-release requirement gains a multi-arch mandate — a `scraper-v*` tag SHALL publish a manifest-list image covering `linux/amd64` and `linux/arm64`, so the image runs natively on both x86 and Apple-Silicon/arm64 home hosts (browser tier included). Everything else about the release (GHCR, GitHub Release, `GITHUB_TOKEN`-only, independent of the Worker deploy, embedded build/contract versions) is unchanged.

## Impact

- **CI/CD:** `.github/workflows/scraper-release.yml` — add QEMU + Buildx setup, add `platforms:` to the build step. arm64 is cross-built under QEMU on the amd64 runner: slower at release time, but a release is infrequent and this is the sanctioned cross-arch path.
- **Docs:** `docs/SELF_HOSTING.md`, `packages/scraper/README.md`.
- **Spec:** `build-automation` (one MODIFIED requirement).
- **No Worker or contract change** — this touches only scraper-release + docs, so it does **not** trigger the Worker deploy control plane (the deploy-trigger path filters are scoped to the Worker package) and does not rebuild anything on a normal merge; the image is produced only by pushing the `scraper-v*` tag.
- **Downstream dependency:** the `dirtbags` `grocery-scraper-luna` change pulls the resulting image; it cannot deploy on `luna` until this release is cut.
- **Out of scope:** the `dirtbags` Ansible deployment (separate repo/proposal), any per-site adapter work (the four sources use the built-in `jsonld` adapter), and any change to the scraper's runtime behavior.
