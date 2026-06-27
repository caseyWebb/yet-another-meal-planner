## Context

The Worker already serves `/health` (added by `background-job-health`): a token-gated, aggregate-only JSON payload (`{ ok, generated_at, jobs[], d1 }`) that is **tenant-data-free by construction** — counts, timestamps, and error classes only. It returns `200` healthy / `503` degraded for plain HTTP monitors, and stays answerable on the fetch path even when the cron is dead.

The operator's data repo is **private** and is their control plane (deploy/onboard/revoke run there). Its README is the natural home for a glanceable status, and "private" is what unlocks this: the `HEALTH_TOKEN` can sit in the repo without leaking to the world, so the Worker can render its own status as an image the README embeds — no third-party badge service.

The deploy already "posts back" to the data repo: `data-deploy.yml` commits auto-provisioned KV/D1 ids into the operator's `wrangler.jsonc` (`merge-wrangler-config.mjs pin`), guarded by a graceful `git push` warn when `contents: write` is absent. The host the badge URL needs already exists as the `WORKER_HOST` repo Actions variable, which `build-plugin.yml` and onboard already consume. So the building blocks are all present; this change wires them together.

The dominant external constraint is **GitHub's Camo image proxy**, which reshapes what "dynamic" can mean and drives most decisions below.

## Goals / Non-Goals

**Goals:**
- A glanceable, self-rendered health **card** embedded in the data repo README, showing the actual health info (per-job ok/fail/never-run + freshness, D1), not just a binary pill.
- Zero new external dependencies and zero new secrets stores: render in the Worker from the existing payload; source the token and host from where they already live.
- A fully supported **manual** setup path for operators whose data repo cannot (or chooses not to) auto-commit — pin-back is optional, not required.

**Non-Goals:**
- Real-time/live status. Camo caches README images; the badge is TTL-refreshed and glanceable. Real alerting stays the uptime monitor's job (`/health` JSON + ntfy, per SELF_HOSTING).
- A public, token-less badge variant. The card exposes operational posture (which job is failing); it stays behind the token, visible only to repo members.
- A staleness policy inside the badge. The badge reports each job's last-run; deciding "too stale" stays the monitor's concern (the badge has no expected-cadence knowledge).
- Changing the `/health` JSON contract (it keeps `200`/`503`) or the merge/secret model.

## Decisions

### D1 — Render the SVG in the Worker, not via a third-party badge service
shields.io's `endpoint` badge would fetch our URL server-side — putting `HEALTH_TOKEN` in a shields.io query string (token transits a third party) and adding an external dependency and failure domain. We already hold the data and can template an SVG string in pure JS (fits the workerd/no-Node-deps convention). **Self-render.** Alternative (shields endpoint) rejected on token-exposure + dependency grounds.

### D2 — A card, not a pill
The operator asked to "display the health information itself." A card shows a headline plus one row per job (ok / fail / never-run + relative last-run like "2h ago") and a D1 row. Rendering uses a **monospace font with fixed columns** so we avoid shields-style font-metric width math entirely — character count drives layout. A minimal pill is a possible future `?style=` escape hatch, not built now.

### D3 — The SVG returns `200` always; color carries status
GitHub's Camo proxy may not render a non-`200` upstream as an image. So `/health.svg` returns **`200` regardless of health**, encoding healthy/degraded by color (headline mirrors `payload.ok`; rows: ok=green, fail=red, never-run=amber so a fresh deploy reads as "pending," not "broken"). The JSON `/health` keeps `200`/`503` for monitors. **Consequence to document:** an HTTP-status monitor must point at `/health` (JSON), never `/health.svg` — the SVG is for eyes, the JSON is for machines.

### D4 — The GitHub Camo constraint (the "why" behind D3 and caching)
All README images are proxied through `camo.githubusercontent.com`, fetched **server-side and anonymously**, then cached:
- *Anonymous fetch* → the Worker can't see GitHub auth, so the credential **must be in the URL** (`?token=`). This is exactly why the private-repo placement matters: the raw markdown (and the token) is visible only to repo members.
- *Caching* → "dynamic" means **TTL-refreshed when viewed**, never live. We send a short `Cache-Control` (≈120s, shields.io-style) so the badge re-fetches periodically. A health badge that is minutes-stale is fine; that's what the monitor is for.
- *SVG-over-Camo works* → shields.io badges are SVG served through Camo; the requirement is a correct `content-type: image/svg+xml`. We set it.

### D5 — `HEALTH_TOKEN` becomes an optional operator `var` (additive)
To put the token in the badge URL the deploy must know it. Options:
- **(a) operator `var` in `wrangler.jsonc`** — chosen. Vars are already operator-only in the merge (no merge change), already flow to the Worker as `env.HEALTH_TOKEN` (no `env.ts` change), and the deploy already parses `wrangler.jsonc` (can read it). One value, one source of truth, no secret read-back.
- (b) keep it a secret and store a second copy in the repo — dual source of truth, drift-prone; Cloudflare secrets can't be read back, so the repo copy becomes authoritative anyway.
- (c) deploy generates a random token, sets the secret, and pins it back — same read-back problem as (b), more moving parts.

The secret form **keeps working** (the Worker reads `env.HEALTH_TOKEN` identically) — this is purely additive. **Trade-off:** a `var` is plaintext in the deployed config and visible in the Cloudflare dashboard. Accepted: it gates an already-tenant-clean, read-only endpoint, and the operator explicitly accepts exposing it in their private repo. Rotation = change the var and redeploy (and re-stamp/re-paste).

### D6 — Host from `WORKER_HOST`, passed through the thin caller
The badge markdown needs an absolute host. `WORKER_HOST` already exists as a repo variable and is already consumed by `build-plugin.yml` via the thin-caller pattern (`worker_host`/`mcp_url` input). We mirror it exactly: the data repo's `deploy.yml` caller passes `worker_host: ${{ vars.WORKER_HOST }}` into the reusable `data-deploy.yml`. **No Cloudflare API host resolution, no guessing.** Alternative (resolve via the CF `workers/domains` API as onboard optionally does) rejected as unnecessary complexity given the existing variable.

### D7 — Idempotent marker block, replace-or-insert
The deploy stamps:
```
<!-- health-badge:start -->
![grocery-mcp health](https://<WORKER_HOST>/health.svg?token=<HEALTH_TOKEN>)
<!-- health-badge:end -->
```
If the markers exist → replace between them (idempotent; survives operator README edits elsewhere). If absent → insert the block **immediately after the README's first heading** and add the markers, so existing data repos (created from an older template) get the badge without a manual paste. The template README ships with the markers in place.

### D8 — Pin-back is optional; the manual path is first-class
The commit-back reuses the existing id-pin step's posture: it needs `contents: write`, and degrades gracefully when absent. This change makes that an **explicitly supported workflow**, not just a warning:
- The deploy **always** writes the exact ready-to-paste badge snippet to `$GITHUB_STEP_SUMMARY` (as onboard surfaces the invite code), whether or not it could commit.
- SELF_HOSTING documents the manual runbook and frames pin-back (README badge **and** KV/D1 ids) as optional. The operator's own data repo lacks `contents: write`, so this path is the real one for them: paste once (token + host are stable, so it never needs re-pinning).

## Risks / Trade-offs

- **Token visible in the rendered Camo URL** → Mitigation: repo is private (URL + raw markdown visible only to members); the endpoint is read-only and tenant-clean; rotation is a var change + redeploy. Net new exposure over status quo is minimal and operator-accepted.
- **`var` is plaintext in deployed config / CF dashboard** → Mitigation: low-value gate on a tenant-clean endpoint; secret form still available for operators who don't want the badge.
- **Camo caching makes the badge stale** → Mitigation: short `Cache-Control`; explicitly positioned as glanceable, not an alarm; the uptime monitor remains the alerting path.
- **`200`-always SVG could fool a naive monitor** → Mitigation: document that monitors target `/health` (JSON, `200`/`503`); `/health.svg` is for humans.
- **Auto-insert mutates the README at a guessed location** → Mitigation: insert only when markers are absent, only after the first heading, idempotent thereafter; the manual path avoids it entirely.
- **SVG text injection** → Mitigation: escape all interpolated text; inputs are controlled (fixed job names, numeric/timestamp values), but escape regardless.
- **Cross-repo drift** (template repo holds the caller wiring + README markers + example var) → Mitigation: call these out as explicit cross-repo tasks on the same branch; keep the contract docs in lockstep per CLAUDE.md.

## Migration Plan

Worker-first ordering (skills/config must not get ahead of the deployed Worker):
1. Land + deploy the Worker so `/health.svg` exists.
2. Operator sets `vars.HEALTH_TOKEN` in `wrangler.jsonc` (and ensures `WORKER_HOST` is set) and redeploys.
3. Auto path (`contents: write`): the deploy stamps + commits the README badge. Manual path: copy the snippet from the job summary into the README once.

Rollback: remove the marker block from the README (badge disappears) and/or unset `HEALTH_TOKEN` (the endpoint 404s, fully disabling `/health` and `/health.svg`). No data migration; nothing persisted beyond the README text and the config var.

## Open Questions

- **Light/dark theming.** ~~A plain `![](…)` image can't switch on `prefers-color-scheme` the way a `<picture>` can.~~ **Resolved (theme-neutral):** the card draws its own opaque dark panel (`#1b1f24`) with light text, so it renders identically and legibly on both GitHub themes — verified by rasterizing the healthy/degraded/never-run states on light and dark panels. No in-SVG media query needed.
- **Exact `Cache-Control` value** (≈120s vs a touch longer) — tune against observed Camo refresh behavior; not load-bearing.
