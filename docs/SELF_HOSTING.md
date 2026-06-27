---
update-when: the operator setup, deployment, or Claude.ai connection flow changes
---

# SELF_HOSTING — run your own grocery-agent

The operator's one-time setup. When you finish you'll have a private **data repo**, a deployed **grocery-mcp Worker**, and Claude.ai connected — with everything **driven from the web UI + GitHub Actions**. The only *required* local command in the whole flow is one `openssl` line to convert a key (a `wrangler` CLI alternative is offered where it helps, but never required).

> **How identity works.** The Worker is its own OAuth 2.1 provider (`@cloudflare/workers-oauth-provider`): members add the connector in Claude.ai, complete an **invite-code** consent page, and get a token whose tenant rides every request. Operator and friends use the same path — no Cloudflare Access, no third-party login, and friends need no GitHub or Kroger Developer account.

> **You don't fork the code repo to *run* it.** Your **private data repo is your single control plane** — it holds your config, your one Actions secret, and the Deploy / Onboard / Revoke workflows. Those are thin callers of *reusable* workflows in the public code repo (`uses: …@main`), so the public repo holds **no secrets** and you take updates by pinning a ref — no fork to maintain. This is also what keeps invite codes private: onboarding runs in *your* private repo, so the code it prints is never in a public log.
>
> **Plugin distribution is the one wrinkle.** The plugin in this repo's marketplace bakes in a connector URL — *mine*, which isn't open for signups (claude.ai doesn't honor a configurable plugin variable, so the URL is fixed at build time). To get **your** Worker connected you pick one of three options in [step 7](#7-get-the-agent-into-claudeai--kroger-consent): **(1, recommended)** a CI Action mints you a baked bundle you upload — **no fork**; **(2)** fork to publish your own auto-updating marketplace; or **(3)** paste the instructions into a Claude project. Only option 2 needs a fork.

## Mental model

| Piece | What it is | Yours? |
|---|---|---|
| **Code repo** (`caseyWebb/groceries-agent`) | the Worker source + build tooling + reusable workflows | **no fork to run it** — your data repo references it (`@main` or a pinned tag). A fork is needed *only* for plugin Option 2 (your own auto-updating marketplace); Options 1 & 3 need no fork (step 7) |
| **Data repo** (`<you>/groceries-agent-data`, **private**) | `recipes/` + `guidance/` markdown, **plus your `wrangler.jsonc` + the caller workflows** (per-tenant and shared-corpus data live in D1, not here) | you create it from the template; it is your control plane |
| **Worker** (`grocery-mcp` on Cloudflare) | the MCP server Claude.ai talks to | you deploy it from your data repo's Actions |
| **Cookbook site** (GitHub Pages on the data repo) | public read-only recipe site | optional; needs GitHub Pro |

A single **GitHub App** (on your account, scoped to the data repo) gives the Worker read/write to the data repo — no PAT. A single **Kroger** public-tier app handles search/prices (app-level) and per-user cart consent.

## Prerequisites

- A **GitHub** account (+ **GitHub Pro**, ~$4/mo, *only* for the optional public cookbook site from a private repo).
- A **Cloudflare** account (Workers + KV + D1 are free-tier).
- A **Kroger Developer** account.
- `openssl` once (any machine), to convert the App key. No other local tooling required — though if you have the `wrangler` CLI you can use it instead of the Cloudflare dashboard where noted.

## 1. Create the data repo

On the [`groceries-agent-data-template`](https://github.com/caseyWebb/groceries-agent-data-template) → **Use this template** → create `<you>/groceries-agent-data`, **Private**. Add your recipes under `recipes/`. The template's CI projects the D1 `recipes` table from `recipes/*.md` on every recipe push (and regenerates `_indexes/` for the optional static site).

This repo is your **control plane**. From the template it carries these thin `.github/workflows/` — each a tiny caller (`uses: caseyWebb/groceries-agent/...@main`) of a *reusable* workflow in the public code repo, so the logic and the no-secrets posture live upstream while your private repo holds the config and the one Actions secret. Running them here (not in a fork of the public repo) is what keeps invite codes out of public logs.

| Caller (in your data repo) | Calls (code repo) | Does |
|---|---|---|
| `deploy.yml` | `data-deploy.yml` | deploy the Worker (overlays your `wrangler.jsonc`) |
| `onboard.yml` | `data-onboard.yml` | mint a member's invite code + allowlist entry |
| `revoke.yml` | `data-revoke.yml` | remove a member's allowlist entry + invite code |
| `build-indexes.yml` | `data-build-indexes.yml` | project D1 `recipes` table from `recipes/`; rebuild `_indexes/` for the static site |
| `build-site.yml` | `data-build-site.yml` | build + deploy the optional cookbook site |
| `build-plugin.yml` | `data-build-plugin.yml` | build your plugin bundle (your Worker URL baked in) as a downloadable artifact to upload to claude.ai |

A live, versioned copy of these callers (and the whole data-repo layout) lives in the [`groceries-agent-data-template`](https://github.com/caseyWebb/groceries-agent-data-template) repo — see its `.github/workflows/` for the canonical thin callers.

## 2. Register the GitHub App

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App** (on your account):

- **Homepage URL**: anything. **Webhook**: uncheck **Active**. **"Request user authorization (OAuth)"**: leave off (identity is not GitHub login).
- **Repository permissions → Contents: Read and write** — covers both the Contents API and the Git Data API the commit engine uses.
- **Repository permissions → Issues: Read and write** — lets the agent file bug reports on your behalf (`report_bug`), as `agent-reported`-labeled issues in your data repo, for members who have no GitHub account. Without it, `report_bug` returns `insufficient_permission` and the agent simply tells the user it couldn't file. (If you add this to an existing App, GitHub will ask you to **approve the new permission** on the installation.)
- **Repository permissions → Pages: Read** — lets `recipe_site_url` resolve your hosted recipe-site URL (the static browse view) from the repo's GitHub Pages config, so onboarding can point members at the full corpus. Without it, `recipe_site_url` returns `insufficient_permission`; if Pages simply isn't enabled, it returns `{ enabled: false }` and the agent tells the member to ask you to turn it on. (Adding it to an existing App requires **approving the new permission** on the installation.)
- Everything else: No access.
- **Where can this be installed?**: Only on this account.

Then capture two things and install the App:

1. **App ID** (General page).
2. **Private key** → "Generate a private key" downloads a PKCS#1 PEM. Convert it to **PKCS#8** (the one local step):
   ```bash
   openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
     -in your-app.private-key.pem -out app-pkcs8.pem
   ```
3. **Install the App** → "Install App" → your account → **Only select repositories** → `groceries-agent-data` → Install.

> If you ever delete and recreate the data repo, re-add it under the App's "Repository access" — installations track repos by internal id, so a recreated repo isn't auto-included.

## 3. Register the Kroger app

At [developer.kroger.com](https://developer.kroger.com), register one **public-tier** app:

- Scopes: `product.compact` (search/prices) + `cart.basic:write` (cart).
- Redirect URI: `https://<worker-host>/oauth/callback`.
- Capture the **client id** + **secret**.

## 4. Configure the data repo

**a. Set your `GITHUB_APP_ID`** in `wrangler.jsonc` at the data repo root (it's there from the template):

```jsonc
"vars": { "GITHUB_APP_ID": "<app id>" }
```

That's the only value you set; the template's defaults handle everything else. You get a `grocery-mcp.<your-subdomain>.workers.dev` URL by default — set a custom domain in `wrangler.jsonc` if you prefer.

**b. Add your secrets** (data repo → Settings → Secrets and variables → Actions):

- Secret **`CLOUDFLARE_API_TOKEN`** — a Cloudflare token with Workers + KV + **D1 edit**, used by Deploy / Onboard / Revoke. (D1 edit is needed to auto-provision your database and apply its schema migrations on deploy; an under-scoped token surfaces as a clear failure on the *Apply D1 schema migrations* step.) **This is why the data repo is private** — it holds your credentials and the invite codes onboarding prints.
- Secrets **`KROGER_CLIENT_ID`** + **`KROGER_CLIENT_SECRET`** *(optional as Actions secrets)* — when present, the deploy sets them as your Worker's secrets; you can instead add them directly as Worker secrets in the Cloudflare dashboard (like the App key in step 5). Either way the Worker needs them for Kroger search/prices.
- Variable **`WORKER_NAME`** (or **`WORKER_HOST`**) *(optional)* — so Onboard can show the connector URL in its summary. With `WORKER_NAME` set, Onboard auto-resolves the host via Cloudflare's custom-domain API; `WORKER_HOST` pins it explicitly.

## 5. Deploy + set the App key

Run the **Deploy Worker** Action (your data repo → Actions → Run) — it builds, tests, and deploys your Worker, billed to your account.

Then add the **GitHub App private key** as a Worker secret in the Cloudflare dashboard → your Worker → **Settings → Variables and Secrets → Add (encrypted)**. It's the master key to your data repo, so it lives only in Cloudflare, never in a repo:

- `GITHUB_APP_PRIVATE_KEY` — paste the `app-pkcs8.pem` contents (the dashboard accepts multi-line).
- *(optional)* `KROGER_OAUTH_CLIENT_ID` + `KROGER_OAUTH_CLIENT_SECRET` — only if you register a **separate** Kroger app for cart writes; left unset, cart writes reuse `KROGER_CLIENT_ID/SECRET` (step 3).

*(CLI alternative: `npx wrangler secret put GITHUB_APP_PRIVATE_KEY < app-pkcs8.pem`.)* Delete `app-pkcs8.pem` when done.

**A background flyer warm runs on a cron — automatically, no config from you.** The deploy **merges** code-level wrangler config (the `triggers.crons` block, `compatibility_*`, `main`, `observability`) from the upstream Worker into your deployed config, so the cron registers on deploy without you touching your `wrangler.jsonc`. (Your `wrangler.jsonc` owns only *your* values — `GITHUB_APP_ID`, optional `name`/custom domain, and KV ids that auto-provision and pin back; see *What your `wrangler.jsonc` owns* below.) Once registered, a scheduled sweep periodically pre-computes the Kroger sale flyer for each member's store into the existing `KROGER_KV` namespace, so `kroger_flyer` is a fast cache read instead of a live scan. It reuses your Kroger credentials (step 3) and is **comfortably within the Cloudflare free tier** (a single trigger; each tick does a small bounded batch and most ticks are an idle no-op). It's driven by the `flyer_terms` table (broad sale-scan categories); empty, the flyer just comes back empty. Cron invocations are billed to your account like any request.

**What your `wrangler.jsonc` owns.** The deploy merges code-level config from upstream, so your data-repo `wrangler.jsonc` only needs *operator-owned* keys:
- `vars.GITHUB_APP_ID` (the one required value), and optionally `name` or `workers_dev: false` + `routes` for a custom domain;
- id-less KV bindings (or omit `kv_namespaces` entirely) and the id-less D1 `DB` binding (or omit `d1_databases` entirely) — they auto-provision on first deploy; persist their ids one of two ways (see *Persisting your namespace + database ids* below).

Do **not** set `main`, `compatibility_date`, `compatibility_flags`, `triggers`, or `observability` here — those come from the upstream Worker at deploy, and a stale copy would just be ignored. New operators start from the template with exactly this minimal shape.

**Persisting your namespace + database ids (pick one).** KV bindings and the D1 `DB` binding start id-less and auto-provision on first deploy, but the **ids must persist** to your `wrangler.jsonc` or the *next* deploy provisions **new** namespaces / a new database and orphans all your state (tenant directory, Kroger/OAuth tokens, the flyer cache, and your D1 data). The same pin step handles both binding types. Two ways to make that durable — you don't have to grant write access if you'd rather not:

- **Auto-pin (grant write).** Give your data-repo `deploy.yml` caller `permissions: contents: write` so the deploy commits the provisioned KV + D1 ids back into your `wrangler.jsonc` automatically. Without it, the deploy still succeeds but logs a warning that it couldn't push the ids.
- **Manual (no write access needed).** Create the resources yourself once — `npx wrangler kv namespace create KROGER_KV` (and `TENANT_KV`, `OAUTH_KV`) and `npx wrangler d1 create grocery-mcp` — and paste each returned id into your `wrangler.jsonc` bindings (`id` for KV, `database_id` for D1). The deploy then reuses them, and the pin step sees no change and stays **silent** (no commit, no warning). Best if you keep your `wrangler.jsonc` hand-maintained.

Either way, once your ids are set the pin step is a no-op on every subsequent deploy.

**Monitoring the background jobs (optional).** The warm and the inbound-email handler run with no one watching, so the Worker exposes an **open, tenant-clean** `/health` endpoint that reports each background job's last-run/freshness. To use it:

- Call `https://<your-worker-host>/health` — it returns JSON (`200` healthy, `503` when a job is failing). It's **open (no token)**: the payload is tenant-data-free by construction (counts, timestamps, error classes; the D1 probe is just a boolean), so there's nothing secret to gate. If you'd rather not expose it at all, restrict `/health` at the **edge** — a Cloudflare Access app or a WAF rule — needing no Worker change. (There's no `HEALTH_TOKEN` any more; it was retired with the admin panel.)
- Point an uptime monitor at that URL and route alerts to **ntfy** (or wherever). **Uptime Kuma** works well (native ntfy); any URL monitor with a webhook does. Assert on the `200`/`503` status, or on `ok: true` + freshness. Because `/health` is on the fetch path (separate from the cron), it still answers when the cron is dead — so a stalled warm shows up as stale/`503`.
- *(Optional)* set **`NTFY_URL`** (+ `NTFY_TOKEN` for a protected topic) as Worker secrets — a *failed* background job then pushes a tenant-clean alert to that ntfy topic directly from the Worker, an independent backstop that fires even if your monitor is offline. Unset → no push.
- To **debug** a failure, the warm's structured logs (and any `tick failed`) live in Workers Logs; the **Cloudflare Workers Observability MCP** lets an AI agent query them directly. Cloudflare's own **Workers → Cron Events** view also shows recent cron runs (now honest about failures — the handler rethrows).

## 6. Set up the admin panel + onboard yourself

Member management — onboard / revoke / rotate-invite / list — is an **admin panel** the Worker serves at `https://<your-worker-host>/admin`, gated by **Cloudflare Access** (so minted invite codes never touch a git-hosted log). One-time setup:

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

## 9. Cookbook site (optional)

On the data repo: upgrade to **GitHub Pro** and enable **Pages → Source: GitHub Actions**. The template's `build-site.yml` builds the public cookbook from `recipes/` (never `users/`) and deploys it. Runs are billed to your account.

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
- **GitHub Pro** is required only for the public cookbook site.
- **Secrets live in one place.** The GitHub App private key is the one high-value secret and lives only as a Cloudflare secret, never in any repo. Your `CLOUDFLARE_API_TOKEN` is the only Actions secret, and it stays **encrypted** even if the repo is made public — a visibility flip doesn't expose it (keep workflows `workflow_dispatch`/push-triggered, not fork-PR-triggered). Invite codes are now minted in the **Cloudflare Access-gated admin panel** (`/admin`) and shown once in that authenticated UI — never written to a git log — which removes the last reason the data repo had to stay private (the public flip itself is a separate, later step; rotate any code that appeared in an old Actions run first).
