---
update-when: the operator setup, deployment, or Claude.ai connection flow changes
---

# SELF_HOSTING — run your own grocery-agent

The operator's one-time setup. When you finish you'll have a **data repo** (your deploy control plane), a deployed **grocery-mcp Worker**, an **R2 corpus bucket** holding your recipes, and Claude.ai connected — with everything **driven from the web UI + GitHub Actions**. No required local command in the whole flow (a `wrangler`/`rclone` CLI is offered where it helps with seeding or bulk edits, but never required for setup).

> **How identity works.** The Worker is its own OAuth 2.1 provider (`@cloudflare/workers-oauth-provider`): members add the connector in Claude.ai, complete an **invite-code** consent page, and get a token whose tenant rides every request. Operator and friends use the same path — no Cloudflare Access, no third-party login, and friends need no GitHub or Kroger Developer account.

> **You don't fork the code repo to *run* it.** Your data repo is your single **deploy control plane** — it holds your config, your one Actions secret, and the Deploy workflow (plus the plugin caller). It no longer holds recipe content: your recipes/guidance live in an **R2 bucket** the Worker reads directly (see [step 2](#2-the-r2-corpus-bucket--obsidian-authoring)). Those workflows are thin callers of *reusable* workflows in the public code repo (`uses: …@main`), so the public repo holds **no secrets** and you take updates by pinning a ref — no fork to maintain. (Member management is no longer a workflow — it's the Cloudflare Access-gated `/admin` panel — so no invite code is ever printed into a CI log.)
>
> **Plugin distribution is the one wrinkle.** The plugin in this repo's marketplace bakes in a connector URL — *mine*, which isn't open for signups (claude.ai doesn't honor a configurable plugin variable, so the URL is fixed at build time). To get **your** Worker connected you pick one of three options in [step 7](#7-get-the-agent-into-claudeai--kroger-consent): **(1, recommended)** a CI Action mints you a baked bundle you upload — **no fork**; **(2)** fork to publish your own auto-updating marketplace; or **(3)** paste the instructions into a Claude project. Only option 2 needs a fork.

## Mental model

| Piece | What it is | Yours? |
|---|---|---|
| **Code repo** (`caseyWebb/groceries-agent`) | the Worker source + build tooling + reusable workflows | **no fork to run it** — your data repo references it (`@main` or a pinned tag). A fork is needed *only* for plugin Option 2 (your own auto-updating marketplace); Options 1 & 3 need no fork (step 7) |
| **Data repo** (`<you>/groceries-agent-data`, private) | **your `wrangler.jsonc` + the caller workflows + the one Actions secret** — the deploy control plane only (per-tenant data lives in D1; recipe content lives in R2, not here) | you create it from the template; it is your control plane |
| **R2 corpus bucket** (`grocery-corpus` on Cloudflare) | `recipes/*.md` + `guidance/**/*.md` — the authored corpus the Worker reads | auto-provisioned by the deploy; you author into it via Obsidian (step 2) |
| **Worker** (`grocery-mcp` on Cloudflare) | the MCP server Claude.ai talks to | you deploy it from your data repo's Actions |
| **Cookbook** (`<your-domain>/cookbook`, served by the Worker) | read-only recipe site, built from the D1 index + R2 bodies | always on; no separate hosting |

The Worker reads its corpus straight from the bound **R2 bucket** — no GitHub App, no PAT, no per-request token mint. A single **Kroger** public-tier app handles search/prices (app-level) and per-user cart consent.

## Prerequisites

- A **GitHub** account (for the data control repo + taking code/plugin updates — no GitHub App, no GitHub Pro).
- A **Cloudflare** account (Workers + KV + D1 + R2 are free-tier; the cookbook is served by the Worker, so no extra hosting).
- A **Kroger Developer** account.
- No local tooling is required for setup. **Optional CLIs:** `wrangler` (use it instead of the Cloudflare dashboard where noted) and, for authoring, an Obsidian sync plugin plus `rclone` for bulk edits/migration (step 2).

## 1. Create the data repo

On the [`groceries-agent-data-template`](https://github.com/caseyWebb/groceries-agent-data-template) → **Use this template** → create `<you>/groceries-agent-data`, **Private**. This is your **deploy control plane** — config + workflows only; your recipes live in the R2 corpus bucket (step 2), and the Worker's scheduled reconcile projects the D1 `recipes` index from R2 (no CI recipe build).

This repo is your **control plane**. From the template it carries these thin `.github/workflows/` — each a tiny caller (`uses: caseyWebb/groceries-agent/...@main`) of a *reusable* workflow in the public code repo, so the logic and the no-secrets posture live upstream while your data repo holds the config and the one Actions secret. (Member management is no longer a workflow — it's the Cloudflare Access-gated `/admin` panel.)

| Caller (in your data repo) | Calls (code repo) | Does |
|---|---|---|
| `deploy.yml` | `data-deploy.yml` | ensure the `grocery-corpus` R2 bucket exists, then deploy the Worker (overlays your `wrangler.jsonc`) |
| `build-plugin.yml` | `data-build-plugin.yml` | build your plugin bundle (your Worker URL baked in) as a downloadable artifact to upload to claude.ai |

A live, versioned copy of these callers (and the whole data-repo layout) lives in the [`groceries-agent-data-template`](https://github.com/caseyWebb/groceries-agent-data-template) repo — see its `.github/workflows/` for the canonical thin callers.

## 2. The R2 corpus bucket + Obsidian authoring

Your recipes (`recipes/*.md`) and guidance (`guidance/**/*.md`) live in a Cloudflare **R2 bucket** bound to the Worker as `CORPUS` — there's **no GitHub App**, no private key, no per-request token; the Worker reads the corpus through a native binding.

**Provision the bucket — done by the deploy.** You don't create it by hand: the Deploy workflow runs an idempotent `wrangler r2 bucket create grocery-corpus` before it deploys, and the bucket id-less binding auto-provisions and pins back like KV/D1 (see *Persisting your namespace + database ids* in [step 5](#5-deploy)). So the bucket exists after your first deploy; this section is about how you put recipes *into* it and edit them.

> **⚠ Pin the bucket name back.** As with KV/D1, the provisioned `grocery-corpus` binding must persist to your `wrangler.jsonc` (the same pin step handles it). A second deploy that re-provisions a *new* bucket would orphan your **entire recipe corpus**, not just cached state — so don't skip the pin (auto-pin via `contents: write`, or create the bucket and paste its binding yourself; see [step 5](#5-deploy)).

**Author with Obsidian (recommended).** Authoring is Obsidian-native: point an Obsidian vault at the bucket and edit markdown directly.

1. Install an **S3-compatible sync plugin** in Obsidian — e.g. [Remotely Save](https://github.com/remotely-save/remotely-save) — and configure it for **R2** (S3 endpoint = your account's R2 endpoint, bucket = `grocery-corpus`).
2. **Mint a scoped per-author R2 API token** (Cloudflare dashboard → R2 → Manage API Tokens) — one per author, scoped to this bucket, so you can revoke a single author without rotating everyone. Paste its credentials into the sync plugin.
3. Edit recipes in the vault; the plugin syncs them up to R2. The Worker's next reconcile validates and indexes each one (a malformed edit is skipped and surfaced via `/health` + the agent, not by CI — see [step 5](#5-deploy)).

**Bulk edits / migration with `rclone`.** R2 is S3-compatible, so `rclone` gives you the old "all my recipes in one local folder" ergonomic — the mechanism just changes from `git pull/push` to `rclone sync`:

- **Seed the corpus** (one-time, e.g. migrating an existing `recipes/` folder up): `rclone sync ./data r2:grocery-corpus`.
- **Round-trip a bulk edit:** `rclone sync r2:grocery-corpus ./data` → edit locally (your editor / Claude Code) → `rclone sync ./data r2:grocery-corpus`.

(Configure an `rclone` remote named `r2` for your account's R2 endpoint + an API token, per the [rclone S3/R2 docs](https://rclone.org/s3/#cloudflare-r2).)

## 3. Register the Kroger app

At [developer.kroger.com](https://developer.kroger.com), register one **public-tier** app:

- Scopes: `product.compact` (search/prices) + `cart.basic:write` (cart).
- Redirect URI: `https://<worker-host>/oauth/callback`.
- Capture the **client id** + **secret**.

## 4. Configure the data repo

**a. Check `wrangler.jsonc`** at the data repo root (it's there from the template). There's **no required value to set** — the template's defaults handle everything, and the corpus/KV/D1 bindings auto-provision on first deploy. You get a `grocery-mcp.<your-subdomain>.workers.dev` URL by default — set a custom domain in `wrangler.jsonc` if you prefer.

**b. Add your secrets** (data repo → Settings → Secrets and variables → Actions):

- Secret **`CLOUDFLARE_API_TOKEN`** — a Cloudflare token with Workers + KV + **D1 edit**, used by the Deploy workflow. (D1 edit is needed to auto-provision your database and apply its schema migrations on deploy; an under-scoped token surfaces as a clear failure on the *Apply D1 schema migrations* step.) It's an **encrypted** Actions secret — a repo-visibility flip doesn't expose it — and now that member management has moved to the `/admin` panel, it's the only sensitive thing the data repo holds.
- Secrets **`KROGER_CLIENT_ID`** + **`KROGER_CLIENT_SECRET`** *(optional as Actions secrets)* — when present, the deploy sets them as your Worker's secrets; you can instead add them directly as Worker secrets in the Cloudflare dashboard (step 5). Either way the Worker needs them for Kroger search/prices.
- Variable **`WORKER_NAME`** (or **`WORKER_HOST`**) *(optional)* — so Onboard can show the connector URL in its summary. With `WORKER_NAME` set, Onboard auto-resolves the host via Cloudflare's custom-domain API; `WORKER_HOST` pins it explicitly.

## 5. Deploy

Run the **Deploy Worker** Action (your data repo → Actions → Run) — it ensures the `grocery-corpus` R2 bucket exists, then builds, tests, and deploys your Worker, billed to your account. There's no key to paste afterward (the GitHub App is gone; the Worker reads the corpus via its R2 binding).

*(Optional)* If you register a **separate** Kroger app for cart writes, add `KROGER_OAUTH_CLIENT_ID` + `KROGER_OAUTH_CLIENT_SECRET` as Worker secrets in the Cloudflare dashboard → your Worker → **Settings → Variables and Secrets → Add (encrypted)**. Left unset, cart writes reuse `KROGER_CLIENT_ID/SECRET` (step 3).

**A background flyer warm runs on a cron — automatically, no config from you.** The deploy **merges** code-level wrangler config (the `triggers.crons` block, `compatibility_*`, `main`, `observability`, and the `assets` + `r2_buckets` bindings) from the upstream Worker into your deployed config, so the cron registers on deploy without you touching your `wrangler.jsonc`. (Your `wrangler.jsonc` owns only *your* values — optional `name`/custom domain, and the KV/D1/R2 ids that auto-provision and pin back; see *What your `wrangler.jsonc` owns* below.) Once registered, a scheduled sweep periodically pre-computes the Kroger sale flyer for each member's store into the existing `KROGER_KV` namespace, so `kroger_flyer` is a fast cache read instead of a live scan. It reuses your Kroger credentials (step 3) and is **comfortably within the Cloudflare free tier** (a single trigger; each tick does a small bounded batch and most ticks are an idle no-op). It's driven by the `flyer_terms` table (broad sale-scan categories); empty, the flyer just comes back empty. Cron invocations are billed to your account like any request.

**What your `wrangler.jsonc` owns.** The deploy merges code-level config from upstream (including the `CORPUS` R2 binding), so your data-repo `wrangler.jsonc` needs **no required value** — only optional *operator-owned* keys:
- optionally `name` or `workers_dev: false` + `routes` for a custom domain;
- id-less KV bindings (or omit `kv_namespaces` entirely), the id-less D1 `DB` binding (or omit `d1_databases` entirely), and the id-less `grocery-corpus` R2 bucket — they auto-provision on first deploy; persist their ids one of two ways (see *Persisting your namespace + database ids* below).

Do **not** set `main`, `compatibility_date`, `compatibility_flags`, `triggers`, or `observability` here — those come from the upstream Worker at deploy, and a stale copy would just be ignored. New operators start from the template with exactly this minimal shape.

**Persisting your namespace + database ids (pick one).** KV bindings, the D1 `DB` binding, and the `grocery-corpus` R2 bucket start id-less and auto-provision on first deploy, but the **ids must persist** to your `wrangler.jsonc` or the *next* deploy provisions **new** namespaces / a new database / a new bucket and orphans all your state (tenant directory, Kroger/OAuth tokens, the flyer cache, your D1 data, and — for the bucket — your **entire recipe corpus**). The same pin step handles all three binding types. Two ways to make that durable — you don't have to grant write access if you'd rather not:

- **Auto-pin (grant write).** Give your data-repo `deploy.yml` caller `permissions: contents: write` so the deploy commits the provisioned KV + D1 + R2 ids back into your `wrangler.jsonc` automatically. Without it, the deploy still succeeds but logs a warning that it couldn't push the ids. (The same `contents: write` is what lets the deploy stamp the README health badge, above.)
- **Manual (no write access needed).** Create the resources yourself once — `npx wrangler kv namespace create KROGER_KV` (and `TENANT_KV`, `OAUTH_KV`), `npx wrangler d1 create grocery-mcp`, and `npx wrangler r2 bucket create grocery-corpus` — and paste each returned id into your `wrangler.jsonc` bindings (`id` for KV, `database_id` for D1; the R2 binding pins by `bucket_name`). The deploy then reuses them, and the pin step sees no change and stays **silent** (no commit, no warning). Best if you keep your `wrangler.jsonc` hand-maintained. (Likewise the health badge isn't committed without write access — paste it once from the deploy's run summary, as above.)

Either way, once your ids are set the pin step is a no-op on every subsequent deploy.

**Monitoring the background jobs (optional).** The warm and the inbound-email handler run with no one watching, so the Worker exposes an **open, tenant-clean** `/health` endpoint that reports each background job's last-run/freshness. To use it:

- Call `https://<your-worker-host>/health` — it returns JSON (`200` healthy, `503` when a job is failing). It's **open (no token)**: the payload is tenant-data-free by construction (counts, timestamps, error classes; the D1 probe is just a boolean), so there's nothing secret to gate. If you'd rather not expose it at all, restrict `/health` at the **edge** — a Cloudflare Access app or a WAF rule — needing no Worker change. (There's no `HEALTH_TOKEN` any more; it was retired with the admin panel.)
- *(Optional)* **README status badge.** With the `WORKER_HOST` repo variable set, the Deploy workflow stamps the Worker's open `/health.svg` card into your data-repo README (inside a `<!-- health-badge:start -->` / `<!-- health-badge:end -->` block) and re-stamps it each deploy. It refreshes on a short TTL when the README is viewed — a glance, not an alarm (keep the monitor below for alerting). **No `contents: write` on your `deploy.yml`?** The deploy can't commit it, but it **always prints the ready-to-paste snippet in its run summary** — copy that `![grocery-mcp health](…/health.svg)` line into your README once (the host is stable, so it's a one-time paste).
- Point an uptime monitor at that URL and route alerts to **ntfy** (or wherever). **Uptime Kuma** works well (native ntfy); any URL monitor with a webhook does. Assert on the `200`/`503` status, or on `ok: true` + freshness. Because `/health` is on the fetch path (separate from the cron), it still answers when the cron is dead — so a stalled warm shows up as stale/`503`.
- *(Optional)* set **`NTFY_URL`** (+ `NTFY_TOKEN` for a protected topic) as Worker secrets — a *failed* background job then pushes a tenant-clean alert to that ntfy topic directly from the Worker, an independent backstop that fires even if your monitor is offline. Unset → no push.
- To **debug** a failure, the warm's structured logs (and any `tick failed`) live in Workers Logs; the **Cloudflare Workers Observability MCP** lets an AI agent query them directly. Cloudflare's own **Workers → Cron Events** view also shows recent cron runs (now honest about failures — the handler rethrows).

## 6. Set up the admin panel + onboard yourself

Member management — onboard / revoke / rotate-invite / list — is an **admin panel** the Worker serves at `https://<your-worker-host>/admin`, gated by **Cloudflare Access** (so minted invite codes never touch a git-hosted log). It's also where you **review bug reports**: `report_bug` now writes a D1 `bug_reports` table (no GitHub issues) that you read in the panel (`GET /admin/api/bug-reports`). One-time setup:

1. **Create a Cloudflare Access application** (Zero Trust dashboard → Access → Applications → Add → Self-hosted) scoped to **`<your-worker-host>/admin`** — the path **`/admin*` only, never the bare host** (a host-wide app would gate `/mcp` and break every member's connector). Add a policy allowing **your** identity (email one-time-PIN is the zero-IdP option; Google/GitHub also work). Copy the application's **Application Audience (AUD) tag**.
2. **Set two vars** in your data repo's `wrangler.jsonc` (non-secret identifiers): `ACCESS_TEAM_DOMAIN` (e.g. `yourteam.cloudflareaccess.com`) and `ACCESS_AUD` (the AUD tag). Redeploy. Until **both** are set, `/admin` is `404` (opt-in, fails closed). `workers_dev:false` (shipped in code) ensures the only way in is your Access-protected custom domain.
3. **Open `https://<your-worker-host>/admin`**, complete the Access login, and **onboard yourself**: enter your `username` (leave the invite code blank to auto-generate). It writes your allowlist entry + invite to KV and shows the invite code **once** plus your connector URL. Per-tenant state (preferences, pantry, etc.) is created in D1 by the agent tools as you use the agent.

> The panel replaces the old **Onboard/Revoke member** GitHub Actions — moving invite minting out of Actions logs is the change that lets your data repo be public (rotate any code that ever appeared in an old run first; see *Onboard a friend*).

## 7. Get the agent into Claude.ai + Kroger consent

> **The shipped plugin points at *my* Worker — not yours.** The plugin in this repo's marketplace (`caseyWebb/groceries-agent`) bakes **my** connector URL into its `.mcp.json`, because claude.ai won't override a plugin's connector URL at install time (no `userConfig` support). My Worker only admits tenants I've onboarded — **it isn't open for signups** — so installing my plugin as-is points you at a server you can't use. The **skills** are URL-free and identical for everyone; only *how you supply your own connector* differs. Three ways, easiest first:

**Option 1 — build your own bundle via CI (no fork). Recommended.** Your data repo's **Build plugin** Action mints a plugin bundle with *your* Worker URL baked in, as a downloadable file you upload to claude.ai. One bundle — connector + skills together — no fork, no marketplace.

1. Your data repo → **Actions** → **Build plugin** → **Run** (it defaults `mcp_url` from your `WORKER_HOST` var; or type it in). Download the **grocery-agent-plugin** artifact — it's a `.zip`.
2. claude.ai → **Customize → upload a custom plugin file** → pick that `.zip`. Open a **fresh chat** afterward (uploaded skills sync to the sandbox only on a new chat).
3. On a later update, re-run **Build plugin** and re-upload — see *Taking upstream updates* for the Worker-first ordering. No GitHub account is needed to *use* the bundle, so friends just need the file.

**Option 2 — fork + your own marketplace (only if you want pull-based auto-update).** Fork the code repo to `<you>/groceries-agent`, rebuild with your URL (`aubr build:plugin --mcp-url https://<worker-host>/mcp` — the script already targets `plugin/grocery-agent`, and the build refuses to write the placeholder URL into that committed bundle, so passing `--mcp-url` is required), push, and install from your marketplace (`/plugin marketplace add <you>/groceries-agent`). This is the **only** path with `/plugin marketplace update` auto-pull; it costs a fork to maintain and a GitHub account to sync. If you also changed the reusable CI workflows, repoint your data repo's callers at your fork (`uses: <you>/groceries-agent/...@main`).

**Option 3 — paste into a Claude project (no plugin).** Paste [`AGENT_INSTRUCTIONS.md`](../AGENT_INSTRUCTIONS.md) into a Claude project's custom instructions and add your Worker (`https://<worker-host>/mcp`) as that project's connector. No marketplace, no upload — but it's scoped to that one project and the skills arrive as one blob rather than the split, self-triggering set.

**Then connect (every option):** the first time your connector is added, claude.ai discovers its OAuth endpoints and sends you to `/authorize` — **enter your invite code**; the token then carries your tenant on every request. Then do **Kroger consent** (one-time): visit `https://<worker-host>/oauth/init?tenant=<you>` and approve at Kroger (re-run if a cart write ever returns `reauth_required`).

## 8. Newsletter discovery via email (optional)

A *push* discovery source that reaches the bot-walled/paywalled sites RSS can't (Serious Eats, Food52, NYT). The Worker already exports an `email()` handler — you just point Cloudflare Email Routing at it.

1. **Add a dedicated spare domain to Cloudflare** (Email Routing manages the zone's MX records, so don't use a domain whose mail you rely on — e.g. not your ProtonMail domain). Cloudflare dashboard → **Email** → **Email Routing** → enable.
2. **Route to the Worker.** Add a custom address (or catch-all) for `groceries-agent@<your-spare-domain>` with action **Send to a Worker** → your `grocery-mcp` Worker. (No `wrangler.jsonc` change — Email Routing binds the address to the Worker in the dashboard.)
3. **Seed the allowlist.** Use the `update_discovery_sources` tool (say "add me as a discovery source" to the agent, or "add \<newsletter\> as a discovery sender") — it writes your member entry and any newsletter sender entries directly to D1. There is no `discovery_sources.toml` to hand-edit.
4. **Feed it — forwarder-only.** Never subscribe `groceries-agent@` directly (confirm-links + paywalls). Instead, from your own inbox set an **auto-forward rule** to `groceries-agent@<domain>` for newsletters you want indexed (your inbox handles the signup/confirm/paywall), or just hit **Forward** on a one-off. Both work: auto-forward keeps the newsletter `From` (allowlist it as a `sender`); manual forward arrives as you (you're a trusted `member`). The handler authenticates (DKIM) before processing and drops everything else silently.

Emails land in the D1 `discovery_candidates` table with their full body text. The agent reads the body at menu time via `read_discovery_inbox`, scans it for recipe titles and links, and calls `parse_recipe` on the promising ones. Full-recipe import still hits the walls — the agent presents the clean link and you paste the recipe to import.

## 9. Cookbook

The cookbook is served by the **Worker itself** at `<your-domain>/cookbook` — a read-only recipe site built on the fly from the D1 index (the list) and the R2 corpus (the bodies). There's **nothing to set up**: no GitHub Pages, no GitHub Pro, no separate build. It's live once the Worker is deployed, and `recipe_site_url` resolves `<origin>/cookbook` automatically so onboarding can point members at the full corpus.

## Taking upstream updates

There's no fork to sync (unless you took Option 2). Your data repo's caller workflows reference the code repo at `@main` (latest) or a pinned tag/sha. To control *when* you take updates, pin `code_ref` in your `deploy.yml` (and the `@…` ref in the other callers) to a release tag, and bump it when you're ready.

**Worker and skills are one contract — advance the Worker first.** The plugin's skills call MCP tools *by name*, and those tools live in the Worker. If skills move ahead of a Worker you haven't redeployed, a skill can call a tool that isn't live yet. So on any update that touches tools:

1. **Re-run Deploy Worker** (deploys from your pinned `code_ref` / `@main`) so the new tools are live.
2. **Then rebuild and redistribute the plugin** so the matching skills ship — *Option 1:* re-run **Build plugin**, download, re-upload; *Option 2:* rebuild + push to your marketplace. Never the reverse.

This coupling is also why self-hosters don't ride *my* marketplace for skills: my pushes would advance their skills independently of their deploys — the exact skew above, out of their hands.

## Onboard a friend

A friend needs only a Claude.ai account and a Kroger account — no GitHub, no Kroger Developer app, and nothing local on your end.

1. Open your **admin panel** (`https://<your-worker-host>/admin`) and onboard them: enter their `username`. It allowlists them and shows their invite code **once** (copy it now — it's never logged). Per-tenant state (preferences, pantry, etc.) is written to D1 by the agent tools as they use the agent.
2. **Hand them the plugin + invite code, matching whichever option you took in [step 7](#7-get-the-agent-into-claudeai--kroger-consent).** *Option 1 (recommended):* send them the `.zip` from your latest **Build plugin** run + their invite code — they upload the file to claude.ai, no GitHub account needed. *Option 2:* send them your marketplace + the invite code (the bundle carries your URL). *Option 3:* send them your **connector URL** (`https://<worker-host>/mcp`) + the invite code + [`AGENT_INSTRUCTIONS.md`](../AGENT_INSTRUCTIONS.md) for a project.
3. They install (upload the `.zip` / add your marketplace / set up the project), **enter the code at `/authorize`**, then run their Kroger consent (`/oauth/init?tenant=<username>`). On a later update you ship, you re-send the new `.zip` (Option 1) or they `/plugin marketplace update` (Option 2, if they have a GitHub account).

They share the recipe corpus (with their own favorites/rejects/notes) and have their own pantry, preferences, and Kroger cart — fully isolated from yours. To remove someone, open `/admin` and **Revoke** them — it removes their allowlist entry + invite(s), purges their per-tenant D1 data, and deletes their Kroger token, so their issued token stops resolving. **Rotate** mints a fresh invite without touching their data (use it for any code that ever appeared in an old Actions log before making the data repo public).

## Known unknowns / caveats

- **Kroger Acceptable-Use** (unverified): the public tier's clause on serving non-owner users wasn't confirmable (JS-rendered docs). Low blast radius at friend-group scale; skim the policy (or email Kroger dev support) before inviting non-owner friends.
- **Kroger cart cap**: 5,000 cart calls/day **per app**, shared across all members — far above friend-group need.
- **Corpus has no version history.** R2 is a flat object store, not git — there's no recipe commit history (the operator confirmed history isn't load-bearing here). Pin the `grocery-corpus` bucket name so a redeploy never orphans it (step 5), and keep a local `rclone` mirror if you want your own backups.
- **Secrets live in one place.** With the GitHub App gone, there's no longer a private key to hold — your `CLOUDFLARE_API_TOKEN` is the only Actions secret, and it stays **encrypted** even if the repo is made public — a visibility flip doesn't expose it (keep workflows `workflow_dispatch`/push-triggered, not fork-PR-triggered). Per-author **R2 sync tokens** (step 2) are scoped to the corpus bucket and revocable one at a time. Invite codes are minted in the **Cloudflare Access-gated admin panel** (`/admin`) and shown once in that authenticated UI — never written to a git log — which removes the last reason the data repo had to stay private (the public flip itself is a separate, later step; rotate any code that appeared in an old Actions run first).
