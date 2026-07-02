# The walled-source scraper container. It runs OFF-CLOUD on the operator's own network.
#
# Base image: the official Playwright image, which ships Chromium + all its system libraries
# preinstalled at a known PLAYWRIGHT_BROWSERS_PATH — so the browser tier and the `login` verb
# work with no runtime download. If you only ever use the plain-HTTP tier you could slim this
# to node:22-slim, but the Playwright base keeps `login`/browser sources working out of the box.
# Use the `noble` (Ubuntu 24.04, glibc 2.39) variant, NOT `jammy` (22.04, glibc 2.35): the arm64
# `aube` binary links against glibc 2.38/2.39, so `aube ci` fails on jammy for the linux/arm64
# leg of the multi-arch build. noble satisfies both arches.
FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

# --- toolchain ----------------------------------------------------------------
# The monorepo installs with aube (the workspace package manager), not npm: the packages use
# the `workspace:*` protocol npm can't resolve, and the lockfile is aube's `aube-lock.yaml`.
# mise provides the pinned Node + aube exactly as in CI/dev (mise.toml is the single source).
ENV MISE_YES=1
RUN curl -fsSL https://mise.run | sh
ENV PATH="/root/.local/bin:/root/.local/share/mise/shims:${PATH}"
COPY mise.toml ./
RUN mise install

# --- dependencies -------------------------------------------------------------
# Copy the workspace manifests + lockfile first for a cached install layer. All three workspace
# manifests are copied so the frozen `aube ci` matches `aube-lock.yaml` (which records every
# importer); the scraper image thus also carries the worker's dev deps — a size cost accepted in
# exchange for a lockfile-faithful, npm-free install. `@grocery-agent/contract` resolves at
# runtime via tsx, so no build step is needed.
COPY pnpm-workspace.yaml package.json aube-lock.yaml ./
COPY packages/contract/package.json packages/contract/package.json
COPY packages/scraper/package.json packages/scraper/package.json
COPY packages/worker/package.json packages/worker/package.json
RUN mise exec -- aube ci

# --- source -------------------------------------------------------------------
# The scraper + the shared contract source (both run as TS via tsx — no build step).
COPY packages/contract packages/contract
COPY packages/scraper packages/scraper

WORKDIR /app/packages/scraper

# The config/session/state volume the operator mounts. Holds scraper.toml, sessions/, state/.
ENV SCRAPER_CONFIG_DIR=/config
VOLUME ["/config"]

# The ingest key is supplied at run time via the environment, never baked into the image:
#   docker run -e INGEST_API_KEY=... -v ./config:/config <image> run --watch

# Default: run the recurring daemon. Override the CMD for one-off verbs, e.g.:
#   docker run ... <image> test example-paid-http https://paid.example/recipes/one
#   docker run ... <image> backfill example-paid-http
ENTRYPOINT ["mise", "exec", "--", "npx", "tsx", "src/cli.ts"]
CMD ["run", "--watch"]

# NOTE on `login`: it opens a HEADFUL browser and therefore needs a display, which a headless
# server container does not have. Two supported paths for capturing a session:
#   1. cookie-import — capture the storageState in a browser on your desktop and import it:
#        docker run ... <image> cookie-import example-paid-http /config/exported-state.json
#   2. a noVNC / X-forwarding sidecar that gives the container a display for the headful login.
# The recurring `run` daemon itself never needs a display and stays headless.
