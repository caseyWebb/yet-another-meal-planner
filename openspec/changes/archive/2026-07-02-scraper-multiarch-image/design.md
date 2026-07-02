## Context

`packages/scraper` ships as a GHCR container image cut by `scraper-release.yml` on a `scraper-v*` tag. The image is built on the official Playwright base so Chromium (the browser tier + the `login` verb) is preinstalled. The build step is `docker/build-push-action@v6` with `context: .` and no `platforms:` — it therefore builds only for the runner's architecture (amd64 on `ubuntu-latest`). No release tag has been pushed, so no image exists yet.

The consumer that motivates this change is the `dirtbags` homelab: the scraper is meant to run on the operator's own network, and that host is `luna`, an Apple-Silicon Mac mini running OrbStack. OrbStack runs a native linux/arm64 VM; an arm64 image runs natively, an amd64 image runs under Rosetta/QEMU emulation.

## Decision

Publish the scraper image as a **multi-arch manifest list covering `linux/amd64` and `linux/arm64`**, then cut `scraper-v1`.

**Why multi-arch and not amd64-under-emulation.** The scraper's browser tier is headless Chromium driven by Playwright. Chromium is the component most likely to misbehave under CPU emulation (sandbox + JIT + threading), and NYT Cooking — one of the four target sources — is the case that most needs the browser tier (hard paywall, rendered DOM, browser-only session). Betting the highest-value source on emulated Chromium is the wrong trade when a native arm64 variant is nearly free to produce. The amd64 variant is retained so any x86 home server can also run it.

**Why this is small.** The build has three arch-sensitive inputs, all already multi-arch or arch-agnostic:
- Base image `mcr.microsoft.com/playwright:v1.61.1-jammy` — published for amd64 and arm64; Buildx selects the matching base per target platform, so Chromium comes from the correct arch automatically.
- Toolchain — mise installs a per-arch Node; `aube ci` + `tsx` run TypeScript directly (no native build step, no compiled addon in the scraper's own deps).
- Source — pure TS, arch-independent.

So the change is: add `docker/setup-qemu-action` (register the arm64 emulation handlers for the cross-build) + `docker/setup-buildx-action` (a builder that can emit a manifest list) and set `platforms: linux/amd64,linux/arm64` on the existing `build-push-action` step. `build-push-action` already handles pushing a manifest list when `platforms` lists more than one target.

## Alternatives considered

- **amd64-only + OrbStack emulation, HTTP tier only.** No workflow change, but constrains the deployment to plain-HTTP sources and bets NYT Cooking on emulated Chromium. Rejected — it pushes a latent fragility onto the `dirtbags` side and defeats the point of running the scraper off-cloud.
- **Build the arm64 image locally on `luna`.** OrbStack can build arm64 from a monorepo checkout, but it puts a build toolchain + a checkout of this repo on the box, off-pattern for a homelab that pulls pinned published images. Rejected.

## Cost & risk

- **Release-time cost:** the arm64 variant cross-builds under QEMU on the amd64 runner (slower — minutes, not seconds). A release is infrequent and manual; acceptable. If it ever becomes painful, a native arm64 runner is the escape hatch, out of scope here.
- **Risk:** low. If the arm64 build surfaces a base-image or dependency gap, it fails at release time (before any tag consumer sees it), not at runtime on `luna`.

## Rollout

1. Merge the workflow + docs + spec change.
2. Cut `scraper-v1` (push the tag / `workflow_dispatch`). The workflow publishes `ghcr.io/caseywebb/groceries-scraper:1` + `:latest` as a manifest list and cuts the GitHub Release.
3. Verify the manifest list carries both platforms (`docker buildx imagetools inspect ghcr.io/caseywebb/groceries-scraper:1`).
4. The `dirtbags` `grocery-scraper-luna` change consumes the published image (digest-pinned via Renovate on that side).

## Out of scope

The `dirtbags` deployment, ingest-key minting, per-site source vetting, and any runtime behavior of the scraper. This change only makes the published artifact runnable natively on arm64 and cuts the first release.
