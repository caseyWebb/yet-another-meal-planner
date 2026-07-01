# The walled-source scraper container. It runs OFF-CLOUD on the operator's own network.
#
# Base image: the official Playwright image, which ships Chromium + all its system libraries
# preinstalled at a known PLAYWRIGHT_BROWSERS_PATH — so the browser tier and the `login` verb
# work with no runtime download. If you only ever use the plain-HTTP tier you could slim this
# to node:22-slim, but the Playwright base keeps `login`/browser sources working out of the box.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

# The image is monorepo-aware: it vendors the workspace so @grocery-agent/contract (a
# workspace TS package resolved at runtime via tsx) is present alongside the scraper.
WORKDIR /app

# --- dependencies -------------------------------------------------------------
# Copy the lockfile + the two workspace package manifests first for a cached install layer.
COPY package.json package-lock.json ./
COPY packages/contract/package.json packages/contract/package.json
COPY packages/scraper/package.json packages/scraper/package.json
# NOT --omit=dev: the runtime executes TypeScript via `tsx` (a devDependency), and the ENTRYPOINT
# is `npx tsx`. Scoped to the scraper workspace (+ root) so the Worker's deps aren't pulled in.
# The lockfile is standard npm format (lockfileVersion 3, kept in sync by aube).
RUN npm ci --workspace @grocery-agent/scraper --include-workspace-root

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
ENTRYPOINT ["npx", "tsx", "src/cli.ts"]
CMD ["run", "--watch"]

# NOTE on `login`: it opens a HEADFUL browser and therefore needs a display, which a headless
# server container does not have. Two supported paths for capturing a session:
#   1. cookie-import — capture the storageState in a browser on your desktop and import it:
#        docker run ... <image> cookie-import example-paid-http /config/exported-state.json
#   2. a noVNC / X-forwarding sidecar that gives the container a display for the headful login.
# The recurring `run` daemon itself never needs a display and stays headless.
