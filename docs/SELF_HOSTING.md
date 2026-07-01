---
update-when: the operator setup, deployment, or Claude.ai connection flow changes
---

# SELF_HOSTING — run your own grocery-agent

The operator's one-time setup. When you finish you'll have a **data repo** (your deploy control plane), a deployed **grocery-mcp Worker**, an **R2 corpus bucket** holding your recipes, and Claude.ai connected — with everything **driven from the web UI + GitHub Actions**. No required local command in the whole flow (a `wrangler`/`rclone` CLI is offered where it helps with seeding or bulk edits, but never required for setup).

> **How identity works.** The Worker is its own OAuth 2.1 provider (`@cloudflare/workers-oauth-provider`): members add the connector in Claude.ai, complete an **invite-code** consent page, and get a token whose tenant rides every request. Operator and friends use the same path — no Cloudflare Access, no third-party login, and friends need no GitHub or Kroger Developer account.

> **You don't fork the code repo to *run* it.** Your data repo is your single **deploy control plane** *and* your plugin marketplace — it holds your config, your one Actions secret, the Deploy workflow, and the published plugin bundle. It holds no recipe content: your recipes/guidance live in an **R2 bucket** the Worker reads directly (see [step 2](#2-the-r2-corpus-bucket--obsidian-authoring)). The workflows are thin callers of *reusable* workflows in the public code repo (`uses: …@main`), so the public repo holds **no secrets** and you take updates by pinning a ref — no fork to maintain. (Member management is the Cloudflare Access-gated `/admin` panel, not a workflow — so no invite code is ever printed into a CI log.)
>
> **Plugin distribution: your data repo *is* the marketplace.** Your deploy builds the plugin with **your** connector URL baked in and commits it to your data repo; because that repo is **public**, it's a Claude plugin marketplace your members add directly (`/plugin marketplace add <you>/groceries-agent-data`) and auto-update from — **no fork, no file to forward, and no GitHub account for members** (adding a public marketplace needs no auth). See [step 7](#7-get-the-agent-into-claudeai--kroger-consent).

## Mental model

| Piece | What it is | Yours? |
|---|---|---|
| **Code repo** (`caseyWebb/groceries-agent`) | the Worker source + build tooling + reusable workflows | **no fork** — your data repo references it (`@main` or a pinned tag); you take updates by bumping that ref |
| **Data repo** (`<you>/groceries-agent-data`, **public**) | **your `wrangler.jsonc` + the caller workflows + the one (encrypted) Actions secret + the published plugin bundle** — your deploy control plane *and* your plugin marketplace (per-tenant data lives in D1; recipe content lives in R2, not here) | you create it from the template, **public**; it is your control plane and marketplace |
| **R2 corpus bucket** (`grocery-corpus` on Cloudflare) | `recipes/*.md` + `guidance/**/*.md` — the authored corpus the Worker reads | auto-provisioned by the deploy; you author into it via Obsidian (step 2) |
| **Worker** (`grocery-mcp` on Cloudflare) | the MCP server Claude.ai talks to | you deploy it from your data repo's Actions |
| **Cookbook** (`<your-domain>/cookbook`, served by the Worker) | read-only recipe site, built from the D1 index + R2 bodies | always on; no separate hosting |
| **Source** (`<your-domain>/source`, served by the Worker) | AGPL §13 source offer — an open page linking to the code repo (the agent is AGPL-3.0) | always on; points upstream unless you run a genuine fork and set the `SOURCE_URL` var |

The Worker reads its corpus straight from the bound **R2 bucket** — no GitHub App, no PAT, no per-request token mint. A single **Kroger** public-tier app handles search/prices (app-level) and per-user cart consent.

## Prerequisites

- A **GitHub** account (for the data control repo + taking code/plugin updates — no GitHub App, no GitHub Pro).
- A **Cloudflare** account (Workers + KV + D1 + R2 are free-tier; the cookbook is served by the Worker, so no extra hosting).
- A **Kroger Developer** account.
- No local tooling is required for setup. **Optional CLIs:** `wrangler` (use it instead of the Cloudflare dashboard where noted) and, for authoring, an Obsidian sync plugin plus `rclone` for bulk edits/migration (step 2).

## 1. Create the data repo

On the [`groceries-agent-data-template`](https://github.com/caseyWebb/groceries-agent-data-template) → **Use this template** → create `<you>/groceries-agent-data`, **Public**. This is your **deploy control plane** *and* your plugin marketplace — config + workflow + the published bundle; your recipes live in the R2 corpus bucket (step 2), and the Worker's scheduled reconcile projects the D1 `recipes` index from R2 (no CI recipe build). Public is safe: nothing here is secret (see [Secrets live in one place](#known-unknowns--caveats)) — and public is what lets members add your marketplace without a GitHub account.

This repo is your **control plane**. From the template it carries one thin `.github/workflows/` caller (`uses: caseyWebb/groceries-agent/...@main`) of a *reusable* workflow in the public code repo, so the logic and the no-secrets posture live upstream while your data repo holds the config and the one Actions secret. (Member management is the Cloudflare Access-gated `/admin` panel, not a workflow.)

| Caller (in your data repo) | Calls (code repo) | Does |
|---|---|---|
| `deploy.yml` | `data-deploy.yml` | ensure the `grocery-corpus` R2 bucket exists, deploy the Worker (overlays your `wrangler.jsonc`), then build the plugin with your URL baked in and publish it to your marketplace |

A live, versioned copy of this caller (and the whole data-repo layout) lives in the [`groceries-agent-data-template`](https://github.com/caseyWebb/groceries-agent-data-template) repo — see its `.github/workflows/` for the canonical thin caller.

## 2. The R2 corpus bucket + Obsidian authoring

Your recipes (`recipes/*.md`) and guidance (`guidance/**/*.md`) live in a Cloudflare **R2 bucket** bound to the Worker as `CORPUS` — there's **no GitHub App**, no private key, no per-request token; the Worker reads the corpus through a native binding.

**Provision the bucket — done by the deploy.** You don't create it by hand: the Deploy workflow runs an idempotent `wrangler r2 bucket create grocery-corpus` before it deploys, and the bucket id-less binding auto-provisions and pins back like KV/D1 (see *Persisting your namespace + database ids* in [step 5](#5-deploy)). So the bucket exists after your first deploy; this section is about how you put recipes *into* it and edit them.

> **⚠ Pin the bucket name back.** As with KV/D1, the provisioned `grocery-corpus` binding must persist to your `wrangler.jsonc` (the same pin step handles it). A second deploy that re-provisions a *new* bucket would orphan your **entire recipe corpus**, not just cached state — so don't skip the pin (auto-pin via `contents: write`, or create the bucket and paste its binding yourself; see [step 5](#5-deploy)).

**Author with the preconfigured Obsidian vault (recommended).** This repo generates a turnkey authoring vault (`vault/`, built by `scripts/build-vault.mjs`) — the third generated artifact alongside `plugin/` and `admin/dist/`. Its **Metadata Menu** `recipe` fileClass turns each controlled-vocabulary facet (`protein` / `cuisine` / `season` / `requires_equipment`, plus the open `course` set) into a **dropdown generated from `src/vocab.js`** — the same vocabulary the Worker reconcile validates — so an author *cannot type* an off-vocab value like `poltry`, and the editing-time constraint can never disagree with the server gate. The vault is for **you and any co-authors** who write the shared corpus; friends never open it (they read recipes through the agent and the cookbook).

1. **Get the vault.** Either download the packaged distributable, or build it from this repo: `aubr build:vault --fetch-plugins` vendors the pinned Metadata Menu / Templater / Remotely Save bundles into the committed `vault/` (the binaries are fetched + sha256-verified, never committed; `vault/` ships everything else). To hand a co-author a single file, zip it: `(cd vault && zip -r ../grocery-authoring-vault.zip .)`.
2. **Open it and trust the plugins.** Open `vault/` (or the unzipped distributable) in Obsidian; it opens in *Restricted Mode*, so **Settings → Community plugins → Turn on community plugins** to trust the bundled, pinned set. (One-time, per the vault's "How to add a recipe" note.)
3. **Enter your R2 sync credentials.** **Mint a scoped per-author R2 API token** (Cloudflare dashboard → R2 → Manage API Tokens) — one per author, scoped to this bucket, so you can revoke a single author without rotating everyone. In **Settings → Remotely Save**, pick the **S3-compatible** remote and paste the endpoint, bucket (`grocery-corpus`), and your token's key + secret. The token is the one thing the vault does **not** ship.
4. **Author.** Create a note in `recipes/` (the *New recipe* template applies), fill the facet dropdowns, write the `## Ingredients` / `## Instructions` body, and save. Remotely Save pushes it to R2; the Worker's next reconcile validates and indexes it (a malformed edit is skipped and surfaced via `/health` + the agent, not by CI — see [step 5](#5-deploy)). `description` is **Worker-generated** from the facets — the template offers no field for it.

**Bulk edits / migration with `rclone`.** R2 is S3-compatible, so `rclone` gives you an "all my recipes in one local folder" ergonomic — `rclone sync` moves the whole corpus between R2 and a local folder:

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

- Secret **`CLOUDFLARE_API_TOKEN`** — a Cloudflare token with Workers + KV + **D1 edit**, used by the Deploy workflow. (D1 edit is needed to auto-provision your database and apply its schema migrations on deploy; an under-scoped token surfaces as a clear failure on the *Apply D1 schema migrations* step.) It's an **encrypted** Actions secret — a repo-visibility flip doesn't expose it — and with member management in the `/admin` panel, it's the only sensitive thing the data repo holds.
- Secrets **`KROGER_CLIENT_ID`** + **`KROGER_CLIENT_SECRET`** *(optional as Actions secrets)* — when present, the deploy sets them as your Worker's secrets; you can instead add them directly as Worker secrets in the Cloudflare dashboard (step 5). Either way the Worker needs them for Kroger search/prices.
- Variable **`WORKER_HOST`** (e.g. `grocery-mcp.<you>.workers.dev`) — your connector host. The deploy passes it through to **bake `https://<WORKER_HOST>/mcp` into your published plugin bundle** and to stamp the README health badge. **Set this before deploying** — without it the deploy skips the plugin publish (you'd have no marketplace) and the badge.

## 5. Deploy

Run the **Deploy Worker** Action (your data repo → Actions → Run) — it ensures the `grocery-corpus` R2 bucket exists, then builds, tests, and deploys your Worker, and finally **builds your plugin (your `WORKER_HOST` baked in) and publishes it to your data-repo marketplace** — all billed to your account. There's no key to paste afterward (there is no GitHub App; the Worker reads the corpus via its R2 binding). The publish is the deploy's **tail** — it runs only after the Worker is live, so your skills never get ahead of the tools the Worker serves.

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

- Call `https://<your-worker-host>/health` — it returns JSON (`200` healthy, `503` when a job is failing). It's **open (no token)**: the payload is tenant-data-free by construction (counts, timestamps, error classes; the D1 probe is just a boolean), so there's nothing secret to gate. If you'd rather not expose it at all, restrict `/health` at the **edge** — a Cloudflare Access app or a WAF rule — needing no Worker change. (There's no `HEALTH_TOKEN` — health is non-sensitive, so the endpoint is simply open.)
- *(Optional)* **README status badge.** With the `WORKER_HOST` repo variable set, the Deploy workflow stamps the Worker's open `/health.svg` card into your data-repo README (inside a `<!-- health-badge:start -->` / `<!-- health-badge:end -->` block) and re-stamps it each deploy. It refreshes on a short TTL when the README is viewed — a glance, not an alarm (keep the monitor below for alerting). **No `contents: write` on your `deploy.yml`?** The deploy can't commit it, but it **always prints the ready-to-paste snippet in its run summary** — copy that `![grocery-mcp health](…/health.svg)` line into your README once (the host is stable, so it's a one-time paste).
- Point an uptime monitor at that URL and route alerts to **ntfy** (or wherever). **Uptime Kuma** works well (native ntfy); any URL monitor with a webhook does. Assert on the `200`/`503` status, or on `ok: true` + freshness. Because `/health` is on the fetch path (separate from the cron), it still answers when the cron is dead — so a stalled warm shows up as stale/`503`.
- *(Optional)* set **`NTFY_URL`** (+ `NTFY_TOKEN` for a protected topic) as Worker secrets — a *failed* background job then pushes a tenant-clean alert to that ntfy topic directly from the Worker, an independent backstop that fires even if your monitor is offline. Unset → no push.
- *(Optional)* set **`CF_ACCOUNT_ID`** (your Cloudflare account id — `wrangler whoami` shows it — as a non-secret `vars` entry in your data-repo `wrangler.jsonc`) and **`CF_ANALYTICS_TOKEN`** (a Worker secret: `wrangler secret put CF_ANALYTICS_TOKEN`) to light up the admin **Usage** page (`/admin/usage`): the current day's KV-operation and Workers AI neuron usage against the daily free-tier limits — plus a trailing 30-day per-namespace KV history — so you can see what's eating which budget (e.g. when Cloudflare emails you about approaching a KV limit). `CF_ANALYTICS_TOKEN` should be a **read-only** API token — create one at *My Profile → API Tokens* with **Account Analytics: Read** (it needs no write scope and touches no data). Reading usage costs **no KV** — the snapshot AND the 30-day history. Unset → the page shows "not configured" (no request made). The same page's **Trends** panel adds each background job's run count + duration over the last 30 days, read from the **Workers Analytics Engine SQL API** over the `grocery_usage` dataset — the per-run history the snapshot can't show. Its `USAGE_AE` binding is **code-level** (no operator config — the deploy propagates it automatically, like the `AI`/`ASSETS` bindings), so nothing extra to set up; the jobs emit data points to it at **zero KV/D1 cost**. It reuses the same `CF_ACCOUNT_ID`/`CF_ANALYTICS_TOKEN`; the **Account Analytics: Read** scope above is expected to cover the AE SQL read as well (verify against your account — if the trends panel reports an upstream error while the snapshot works, widen the token's analytics scope). Unset → the panel shows "trends not available".
- *(Optional)* set **`KV_NAMESPACE_LABELS`** (a non-secret `vars` entry, e.g. `wrangler.jsonc`) so the Usage page's per-namespace KV meters show a friendly label (`KROGER_KV`/`TENANT_KV`/`OAUTH_KV`) instead of a raw Cloudflare namespace id — a Worker has no runtime API to resolve its own binding's id back to its name, so this is a one-time, operator-pasted mapping: `id:BINDING,id:BINDING` (the ids are the same ones `wrangler kv namespace create` printed when you pinned them into `wrangler.jsonc` above, e.g. `a1b2…:KROGER_KV,c3d4…:OAUTH_KV,e5f6…:TENANT_KV`). Resolving a label makes **no additional Cloudflare API call** — it's a static lookup against this var. Left unset (or an id with no entry), that namespace's meters still show correct totals, just labeled generically by its raw id rather than its binding name.
- To **debug** a failure, the warm's structured logs (and any `tick failed`) live in Workers Logs; the **Cloudflare Workers Observability MCP** lets an AI agent query them directly. Cloudflare's own **Workers → Cron Events** view also shows recent cron runs (honest about failures — the handler rethrows).

## 6. Set up the admin panel + onboard yourself

Member management — onboard / revoke / rotate-invite / list — is an **admin panel** the Worker serves at `https://<your-worker-host>/admin`, gated by **Cloudflare Access** (so minted invite codes never touch a git-hosted log). It's also where you **review bug reports**: `report_bug` writes a D1 `bug_reports` table (no GitHub issues) that you read in the panel (`GET /admin/api/bug-reports`). One-time setup:

1. **Create a Cloudflare Access application** (Zero Trust dashboard → Access → Applications → Add → Self-hosted) scoped to **`<your-worker-host>/admin`** — the path **`/admin*` only, never the bare host** (a host-wide app would gate `/mcp` and break every member's connector). Add a policy allowing **your** identity (email one-time-PIN is the zero-IdP option; Google/GitHub also work). Copy the application's **Application Audience (AUD) tag**.
2. **Set two vars** in your data repo's `wrangler.jsonc` (non-secret identifiers): `ACCESS_TEAM_DOMAIN` (e.g. `yourteam.cloudflareaccess.com`) and `ACCESS_AUD` (the AUD tag). Redeploy. Until **both** are set, `/admin` is `404` (opt-in, fails closed). `workers_dev:false` (shipped in code) ensures the only way in is your Access-protected custom domain.
   - *(Recommended, optional)* also set **`ACCESS_ALLOWED_EMAILS`** (comma-separated) to your operator email(s) — **as a Worker secret, not a committed `wrangler.jsonc` var**, since it's an email and your data repo is public (`npx wrangler secret put ACCESS_ALLOWED_EMAILS`, or the Cloudflare dashboard → your Worker → Settings → Variables and Secrets → Add → Secret). The Worker then admits `/admin` only when the verified Access `email` claim is on that list — defense-in-depth so a too-loose Access policy (or a wrong/pasted `ACCESS_AUD`) can't let a stranger into a surface that mints invites and purges data. Leave it unset and any valid Access session is admitted; either way `GET /health` reports `admin.email_allowlist` so you can see which posture you're in.
   - **Confirm the gate is live** after deploying: `curl https://<your-worker-host>/health` and check the `admin` block — you want `access_configured: true` and `exposed: false`. An `exposed: true` (which also flips `/health` to `503` and turns the README badge's `admin` row red) means the dev bypass is the only thing protecting the panel — never deploy with `ADMIN_DEV_BYPASS` set (it's loopback-only and inert in production, but the badge will still flag it so you fix the stray flag).
3. **Open `https://<your-worker-host>/admin`**, complete the Access login, and **onboard yourself**: enter your `username` (leave the invite code blank to auto-generate). It writes your allowlist entry + invite to KV and shows the invite code **once** plus your connector URL. Per-tenant state (preferences, pantry, etc.) is created in D1 by the agent tools as you use the agent.
   - *(Optional)* set **`OWNER_TENANT_ID`** in `wrangler.jsonc` (a plain, non-secret var — your own tenant id) so the **Members** roster badges your row as "owner". Leave it unset and no member is badged owner; it is never inferred from onboarding order.

> Minting invites in this Access-gated panel — not in Actions logs — is what lets your data repo be public (rotate any code that ever appeared in an old run first; see *Onboard a friend*).

The panel also has a **Dev** area with an **MCP tool console** (`/admin/dev/tools`): pick any member from the **acting as** dropdown and inspect or run the full tool surface as them — the credential-free, in-panel version of pointing the MCP Inspector at `/mcp` (you're already Access-authenticated, so "acting as" replaces the OAuth dance). It runs the exact same tools the agent does, so it's the fastest way to reproduce a member's behavior or build up a **test persona**: onboard a throwaway like `test-vegan`, act as it, and seed its profile/pantry by calling the write tools right in the console. **Two things to know:** (1) this lets you, the operator, read any member's data and fire **real** write tools as them (`place_order` reaches a real Kroger cart) — appropriate for a self-hosted host, and the console makes the acting-as member prominent and **confirms before running as a real member** (a `test-`/`sandbox-` persona skips the confirm); (2) a fresh persona has no linked Kroger account, so Kroger tools return their normal auth error until that member completes the `/oauth/init` consent — everything D1-backed (profile, recipes, meal plan, notes) works immediately. The console is behind the same Access gate, so it's `404` until `ACCESS_*` are set, just like the rest of `/admin`.

The panel's **Config** area (`/admin/config`) is your group-wide tuning surface. Its default sub-view is the discovery **calibration** console (the sweep's thresholds and processing limits); the **Ranking** tab tunes the semantic-search re-ranking weights (favorite, novelty, pantry, perish, key weights + overlap cap); the **Flyer** tab sets the flyer minimum discount, refresh interval, and batch size. The remaining sub-views are **add/remove editors** for the five shared-corpus lookup tables — ingredient **aliases**, **flyer terms**, discovery **feeds**, and the newsletter-**senders** / **members** allowlist (e.g. `/admin/config/feeds`). These are the curation surface for tables the agent can only *add* to: the agent keeps appending (a learned alias, a forwarded feed), and you prune from here — **removal is operator-only** (no agent tool deletes these). Like the rest of `/admin`, it rides the same Access gate.

The **Feeds** editor has a **Test** button (per feed and on the add form) that probes a feed **from the Worker's edge** — it fetches the feed and a sample of its entry pages and reports whether they're actually reachable/parseable from your egress (which differs from your browser), so you can tell a viable source from one that's bot-walled or carries no parseable recipes before committing it. The parked candidates themselves are visible in the **Discovery** area (`/admin/discovery` — each card's expanded detail shows its specific stage and reason). Candidates with `error` or `failed` outcomes have per-candidate **Retry** and **Delete** actions: **Retry** re-runs the full acquisition pipeline immediately, bypassing the attempt cap (operator intent); **Delete** writes a permanent group-wide rejection for the URL and removes the row, so it won't re-enter intake or the retry stream.

## 7. Get the agent into Claude.ai + Kroger consent

Your **deploy already published your marketplace** (step 5): it built the plugin with *your* connector URL baked into `.mcp.json` and committed it to your **public** data repo. The skills are URL-free and identical for everyone; the bundle just carries your Worker URL. So getting the agent into Claude.ai is one step:

**Add your marketplace and install.**

1. In claude.ai: `/plugin marketplace add <you>/groceries-agent-data`, then `/plugin install grocery-agent@groceries-agent-data`. (No GitHub account needed — adding a public marketplace requires no auth.)
2. **Connect:** the first time the connector is added, claude.ai discovers its OAuth endpoints and sends you to `/authorize` — **enter your invite code**; the token then carries your tenant on every request.
3. **Updates pull automatically.** When you redeploy (which republishes the bundle with a higher version), claude.ai re-pulls the new skills on `/plugin marketplace update` — no re-copy, no re-upload.

> **Fallbacks (rarely needed).** A member who'd rather not add a marketplace can **upload a file** — download the `plugin/grocery-agent/` bundle from your public repo and use claude.ai → *Customize → upload a custom plugin file* (open a fresh chat after). Or **paste [`AGENT_INSTRUCTIONS.md`](../AGENT_INSTRUCTIONS.md)** into a Claude project's custom instructions and add your Worker (`https://<worker-host>/mcp`) as that project's connector — scoped to that one project, skills as one blob rather than the split, self-triggering set.

**Then do Kroger consent** (one-time): open your **admin panel** (`https://<worker-host>/admin`) → **Members**, click **Kroger link** for your own member, open the minted link, and approve at Kroger. (Once you're connected you can instead just ask the agent to set up Kroger ordering — it calls `kroger_login_url` and hands you the same link.) Re-mint a fresh link if a cart write ever returns `reauth_required`.

## 8. Newsletter discovery via email (optional)

A *push* discovery source that reaches the bot-walled/paywalled sites RSS can't (Serious Eats, Food52, NYT). The Worker already exports an `email()` handler — you just point Cloudflare Email Routing at it.

1. **Add a dedicated spare domain to Cloudflare** (Email Routing manages the zone's MX records, so don't use a domain whose mail you rely on — e.g. not your ProtonMail domain). Cloudflare dashboard → **Email** → **Email Routing** → enable.
2. **Route to the Worker.** Add a custom address (or catch-all) for `groceries-agent@<your-spare-domain>` with action **Send to a Worker** → your `grocery-mcp` Worker. (No `wrangler.jsonc` change — Email Routing binds the address to the Worker in the dashboard.)
3. **Seed the allowlist.** Use the `update_discovery_sources` tool (say "add me as a discovery source" to the agent, or "add \<newsletter\> as a discovery sender") — it writes your member entry and any newsletter sender entries directly to D1. There is no `discovery_sources.toml` to hand-edit.
4. **Feed it — forwarder-only.** Never subscribe `groceries-agent@` directly (confirm-links + paywalls). Instead, from your own inbox set an **auto-forward rule** to `groceries-agent@<domain>` for newsletters you want indexed (your inbox handles the signup/confirm/paywall), or just hit **Forward** on a one-off. Both work: auto-forward keeps the newsletter `From` (allowlist it as a `sender`); manual forward arrives as you (you're a trusted `member`). The handler authenticates (DKIM) before processing and drops everything else silently.

Emails land in the D1 `discovery_candidates` table with their full body text. The **background discovery sweep** drains that inbox (alongside the RSS feeds): it scans each body for recipe links, classifies and taste-matches them, and auto-imports the matches — you don't triage an inbox by hand. Imported newsletter recipes then surface to a member at menu time through `list_new_for_me`. Walled link-only candidates the sweep can't fetch are skipped (no member is present to paste); to import one of those, hand the agent the URL or paste the text yourself (the manual `parse_recipe` → `create_recipe` path).

## 9. Cookbook

The cookbook is served by the **Worker itself** at `<your-domain>/cookbook` — a read-only recipe site built on the fly from the D1 index (the list) and the R2 corpus (the bodies). There's **nothing to set up**: no GitHub Pages, no GitHub Pro, no separate build. It's live once the Worker is deployed, and `recipe_site_url` resolves `<origin>/cookbook` automatically so onboarding can point members at the full corpus.

## Taking upstream updates

There's no fork to sync. Your data repo's `deploy.yml` references the code repo at `@main` (latest) or a pinned tag/sha. To control *when* you take updates, pin `code_ref` in your `deploy.yml` to a release tag and bump it when you're ready.

**Worker and skills are one contract — and the deploy advances them in the right order for you.** The plugin's skills call MCP tools *by name*, and those tools live in the Worker; if skills moved ahead of a Worker you hadn't redeployed, a skill could call a tool that isn't live yet. The deploy makes this safe **structurally**: a single **Re-run Deploy Worker** deploys the Worker first and *then* builds and publishes the matching plugin to your marketplace — never the reverse. So taking an update is one action, and members auto-pull the new skills once it finishes.

This Worker-first publish is also why self-hosters don't ride *my* marketplace for skills: my pushes would advance their skills independently of their own deploys — the exact skew the ordering prevents, out of their hands.

## Onboard a friend

A friend needs only a Claude.ai account and a Kroger account — no GitHub, no Kroger Developer app, and nothing local on your end.

1. Open your **admin panel** (`https://<your-worker-host>/admin`) and onboard them: enter their `username`. It allowlists them and shows their invite code **once** (copy it now — it's never logged). Per-tenant state (preferences, pantry, etc.) is written to D1 by the agent tools as they use the agent.
2. **Send them your marketplace name + their invite code:** `/plugin marketplace add <you>/groceries-agent-data`, then `/plugin install grocery-agent@groceries-agent-data`. The bundle carries your connector URL; adding a public marketplace needs no GitHub account.
3. They **enter the code at `/authorize`**, then set up Kroger consent: once connected, they ask the agent to set up Kroger ordering — it calls `kroger_login_url` and gives them a personal consent link to open and approve at Kroger. (To bootstrap a friend who isn't connected yet, mint the link for them from your `/admin` → **Members** → **Kroger link**.) On a later update you ship, they auto-pull it (`/plugin marketplace update`) — nothing to re-send. (Prefer not to use a marketplace? The [step 7](#7-get-the-agent-into-claudeai--kroger-consent) upload/paste fallbacks work for them too.)

They share the recipe corpus (with their own favorites/rejects/notes) and have their own pantry, preferences, and Kroger cart — fully isolated from yours. To remove someone, open `/admin` and **Revoke** them — it removes their allowlist entry + invite(s), purges their per-tenant D1 data, and deletes their Kroger token, so their issued token stops resolving. **Rotate** mints a fresh invite without touching their data (use it for any code that may have appeared in an Actions log before making the data repo public).

## Known unknowns / caveats

- **Kroger Acceptable-Use** (unverified): the public tier's clause on serving non-owner users wasn't confirmable (JS-rendered docs). Low blast radius at friend-group scale; skim the policy (or email Kroger dev support) before inviting non-owner friends.
- **Kroger cart cap**: 5,000 cart calls/day **per app**, shared across all members — far above friend-group need.
- **Corpus has no version history.** R2 is a flat object store, not git — there's no recipe commit history (the operator confirmed history isn't load-bearing here). Pin the `grocery-corpus` bucket name so a redeploy never orphans it (step 5), and keep a local `rclone` mirror if you want your own backups.
- **Secrets live in one place — which is why the data repo can be public.** There's no GitHub App private key to hold — your `CLOUDFLARE_API_TOKEN` is the only Actions secret, and it stays **encrypted** when the repo is public (a visibility flip doesn't expose it; keep workflows `workflow_dispatch`/push-triggered, not fork-PR-triggered). Per-author **R2 sync tokens** (step 2) are scoped to the corpus bucket and revocable one at a time. Invite codes are minted in the **Cloudflare Access-gated admin panel** (`/admin`) and shown once in that authenticated UI — never written to a git log. The `wrangler.jsonc` ids (KV/D1) and the `ACCESS_AUD` + team domain are **non-secret identifiers** — security rests on the Cloudflare API token, the Access JWT signature, and your `ACCESS_ALLOWED_EMAILS` allowlist (set it, step 6). **Before flipping to public**, confirm `.wrangler/` is gitignored and not committed (it caches your Cloudflare account id + email), and scan history for any invite code that appeared in a pre-`/admin` Actions run or commit — rotate it in `/admin` if so.
