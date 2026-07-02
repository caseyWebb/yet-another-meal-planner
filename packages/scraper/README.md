# @grocery-agent/scraper — the home-network walled-source recipe scraper

A small daemon you run **on your own network** (not in the cloud, not in the Worker) to feed
recipes from **paid recipe sites you subscribe to** into your grocery-agent. One machine holds
**one ingest key** and can be configured with **many sources**. For each source it authenticates
with **your own subscription session**, extracts only the **functional recipe facts**, and POSTs
them per-source to your grocery-mcp Worker's `POST <connector>/admin/api/ingest`. The Worker feeds
those pushes into its discovery sweep.

## Legal / ethical posture

This tool is deliberately narrow so it stays on the right side of the line:

- **Your own session, your own subscription.** The scraper never creates accounts, never
  automates a login, and never defeats bot detection. You capture your *own* logged-in session
  (a headful `login` on a machine with a display, or by importing cookies from your own browser)
  and the daemon replays it read-only. There is no credential handling and no login automation.
- **Functional facts only.** Only title, ingredients, instructions, times, servings, and the
  canonical source URL cross the wire — enforced by the shared contract. Publisher prose
  (headnotes) and images are **never** extracted or pushed. The contract has no field for them.
- **A source you already pay for.** A walled source is one you subscribe to; the scraper is the
  sole intake path for it (it is not registered as a Worker-polled public feed).

## How it works

- **Generic engine.** The built-in `jsonld` adapter needs no code: it discovers candidate URLs
  from a source's **sitemap** or **RSS/Atom feed** and extracts recipes from the **schema.org
  JSON-LD** the authenticated pages carry, reusing the *same* parse the Worker uses. Site-specific
  extraction (a source without usable structured data) is an operator-authored adapter dropped in
  a mounted `adapters_dir` — no image rebuild.
- **Tiered fetch.** Plain **HTTP** (session-cookie replay) is the default and never launches a
  browser. A source can opt into the **browser** tier (headless Chromium via Playwright) when it
  needs a rendered DOM or a browser-only session; all browser sources share one Chromium process.
- **Dedup + backoff.** A local cursor skips URLs it already pushed (an optimization — the Worker
  dedups authoritatively), and pushes retry with exponential backoff on network/5xx/429.

## Quick start

1. **Mint an ingest key** in your Worker's `/admin` panel. Keep it secret; supply it via the
   `INGEST_API_KEY` environment variable (never in the config file).

2. **Configure your sources.** Copy `scraper.example.toml` to `./config/scraper.toml` and edit
   `connector_url` and the `[[sources]]` entries (each references the `jsonld` adapter with a
   `sitemap_url` or `feed_url`, and a `fetch_tier` of `http` or `browser`).

3. **Capture a session** for each source (one of):
   - **`login`** — on a machine with a display, opens a headful browser; log in with your own
     subscription, press Enter, and the session is saved to `config/sessions/<id>.json`:
     ```
     npx tsx src/cli.ts login <sourceId>
     ```
   - **cookie-import** — export your logged-in browser's `storageState` JSON and import it (the
     container-friendly path, since a server has no display):
     ```
     npx tsx src/cli.ts cookie-import <sourceId> /config/exported-state.json
     ```

4. **Dry-run one URL** to confirm extraction before going live (prints the item it *would* push,
   no POST):
   ```
   npx tsx src/cli.ts test <sourceId> https://paid.example/recipes/one
   ```

5. **Run it.** One tick over all sources, or the recurring daemon:
   ```
   npx tsx src/cli.ts run            # one pass
   npx tsx src/cli.ts run --watch    # loop on the schedule
   ```

### With Docker

Copy `docker-compose.example.yml` to `docker-compose.yml`, set `INGEST_API_KEY` in your shell or
a `.env` file, and:

```
INGEST_API_KEY=… docker compose run --rm scraper run     # one tick
INGEST_API_KEY=… docker compose up -d scraper            # the --watch daemon
```

The container mounts `./config` at `/config` (holding `scraper.toml`, `sessions/`, `state/`).
The image is built on the Playwright base, so Chromium (browser tier + `login`) is preinstalled.
`login` needs a display — on a headless server use **cookie-import** or attach a noVNC/X sidecar.

Each `scraper-v*` release publishes a prebuilt **multi-arch** image (`linux/amd64` + `linux/arm64`)
to GHCR at `ghcr.io/<owner>/groceries-scraper`, so an Apple-Silicon home host runs it natively
without emulation — reference that tag in place of the compose `build:` block to skip building.

## CLI verbs

| Verb | What it does |
| --- | --- |
| `run [--watch]` | One scrape tick over all sources; `--watch` loops on the schedule. |
| `test <source> <url>` | Dry-run: fetch + extract + validate one URL, print the item, **no POST**. |
| `login <source>` | Headful browser to capture + save the source's session (needs a display). |
| `cookie-import <source> <file>` | Import an exported `storageState` JSON as the source's session. |
| `backfill <source>` | Discover + push the whole archive for one source. |

## Configuration reference

See `scraper.example.toml`. Top-level: `connector_url` (required), `adapters_dir`, `schedule`.
Each `[[sources]]`: `id`, `adapter` (`jsonld` or an operator adapter name), `fetch_tier`
(`http` default | `browser`), `sitemap_url` **or** `feed_url`, `mode` (`incremental` | `backfill`).

When a source's session is missing or has expired (a login/paywall bounce), the scraper surfaces
an **`auth_expired`** signal for that source so your operator liveness view prompts a re-capture,
rather than silently dropping the source.
