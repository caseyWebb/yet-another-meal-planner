# SELF_HOSTING — run your own grocery-agent

The operator's one-time setup. When you finish you'll have a private **data repo**, a deployed **grocery-mcp Worker**, and Claude.ai connected — with everything **driven from the web UI + GitHub Actions**. The only local command in the whole flow is one `openssl` line to convert a key.

> **How identity works.** The Worker is its own OAuth 2.1 provider (`@cloudflare/workers-oauth-provider`): members add the connector in Claude.ai, complete an **invite-code** consent page, and get a token whose tenant rides every request. Operator and friends use the same path — no Cloudflare Access, no third-party login, and friends need no GitHub or Kroger Developer account.

> **You do not fork the code repo.** Your **private data repo is your single control plane** — it holds your config, your one Actions secret, and the Deploy / Onboard / Revoke workflows. Those are thin callers of *reusable* workflows in the public code repo (`uses: …@main`), so the public repo holds **no secrets** and you take updates by pinning a ref — no fork to maintain. This is also what keeps invite codes private: onboarding runs in *your* private repo, so the code it prints is never in a public log.

## Mental model

| Piece | What it is | Yours? |
|---|---|---|
| **Code repo** (`caseyWebb/groceries-agent`) | the Worker source + build tooling + reusable workflows | **don't fork** — you reference it from your data repo (`@main` or a pinned tag) |
| **Data repo** (`<you>/groceries-agent-data`, **private**) | `recipes/` + reference data + `users/<username>/`, **plus your `wrangler.jsonc` + the caller workflows** | you create it from the template; it is your control plane |
| **Worker** (`grocery-mcp` on Cloudflare) | the MCP server Claude.ai talks to | you deploy it from your data repo's Actions |
| **Cookbook site** (GitHub Pages on the data repo) | public read-only recipe site | optional; needs GitHub Pro |

A single **GitHub App** (on your account, scoped to the data repo) gives the Worker read/write to the data repo — no PAT. A single **Kroger** public-tier app handles search/prices (app-level) and per-user cart consent.

## Prerequisites

- A **GitHub** account (+ **GitHub Pro**, ~$4/mo, *only* for the optional public cookbook site from a private repo).
- A **Cloudflare** account (Workers + KV are free-tier).
- A **Kroger Developer** account.
- `openssl` once (any machine), to convert the App key. No other local tooling required — though if you have the `wrangler` CLI you can use it instead of the Cloudflare dashboard where noted.

## 1. Create the data repo

On the [`groceries-agent-data-template`](https://github.com/caseyWebb/groceries-agent-data-template) → **Use this template** → create `<you>/groceries-agent-data`, **Private**. Add your recipes under `recipes/`, reference data (`aliases.toml`, …), and your own `users/<username>/` (or let the *Onboard* Action seed it in step 7). The template's CI regenerates `_indexes/` on every recipe change.

This repo is your **control plane**. From the template it carries these thin `.github/workflows/` — each a tiny caller (`uses: caseyWebb/groceries-agent/...@main`) of a *reusable* workflow in the public code repo, so the logic and the no-secrets posture live upstream while your private repo holds the config and the one Actions secret. Running them here (not in a fork of the public repo) is what keeps invite codes out of public logs.

| Caller (in your data repo) | Calls (code repo) | Does |
|---|---|---|
| `deploy.yml` | `data-deploy.yml` | deploy the Worker (overlays your `wrangler.jsonc`) |
| `onboard.yml` | `data-onboard.yml` | mint a member's invite code + allowlist entry |
| `revoke.yml` | `data-revoke.yml` | remove a member's allowlist entry + invite code |
| `build-indexes.yml` | `data-build-indexes.yml` | rebuild `_indexes/` from `recipes/` |
| `build-site.yml` | `data-build-site.yml` | build + deploy the optional cookbook site |

A live, versioned copy of these callers (and the whole data-repo layout) is vendored in this code repo as a submodule at [`docs/data-template/`](data-template/) — see `docs/data-template/.github/workflows/`. Run `git submodule update --init` to populate it after a fresh clone.

## 2. Register the GitHub App

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App** (on your account):

- **Homepage URL**: anything. **Webhook**: uncheck **Active**. **"Request user authorization (OAuth)"**: leave off (identity is not GitHub login).
- **Repository permissions → Contents: Read and write** — covers both the Contents API and the Git Data API the commit engine uses.
- **Repository permissions → Issues: Read and write** — lets the agent file bug reports on your behalf (`report_bug`), as `agent-reported`-labeled issues in your data repo, for members who have no GitHub account. Without it, `report_bug` returns `insufficient_permission` and the agent simply tells the user it couldn't file. (If you add this to an existing App, GitHub will ask you to **approve the new permission** on the installation.)
- Everything else: No access.
- **Where can this be installed?**: Only on this account.

Then capture three things:

1. **App ID** (General page).
2. **Private key** → "Generate a private key" downloads a PKCS#1 PEM. Convert it to **PKCS#8** (the one local step):
   ```bash
   openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
     -in your-app.private-key.pem -out app-pkcs8.pem
   ```
3. **Installation ID** → "Install App" → your account → **Only select repositories** → `groceries-agent-data` → Install. The URL ends `…/settings/installations/<INSTALLATION_ID>`.

> If you ever delete and recreate the data repo, re-add it under the App's "Repository access" — installations track repos by internal id, so a recreated repo isn't auto-included.

## 3. Register the Kroger app

At [developer.kroger.com](https://developer.kroger.com), register one **public-tier** app:

- Scopes: `product.compact` (search/prices) + `cart.basic:write` (cart).
- Redirect URI: `https://<worker-host>/oauth/callback`.
- Capture the **client id** + **secret**.

## 4. Create the KV namespaces

Cloudflare dashboard → **Workers & Pages → KV → Create namespace** (×3): `KROGER_KV`, `TENANT_KV`, `OAUTH_KV`. Note each namespace **id**. *(CLI alternative: `npx wrangler kv namespace create <NAME>`.)*

## 5. Configure the data repo

**a. Add your `wrangler.jsonc`.** Copy [the code repo's `wrangler.jsonc`](../wrangler.jsonc) to the **root of your data repo** and edit the parts that are yours — all non-secret:

```jsonc
"name": "<your worker name>",        // e.g. grocery-mcp; this is your worker host
"vars": {
  "GITHUB_APP_ID": "<app id>",
  "GITHUB_INSTALLATION_ID": "<installation id>",
  "DATA_OWNER": "<you>",
  "DATA_REPO": "groceries-agent-data",
  "DATA_REF": "main"
},
"kv_namespaces": [
  { "binding": "KROGER_KV", "id": "<KROGER_KV id>" },
  { "binding": "TENANT_KV", "id": "<TENANT_KV id>" },
  { "binding": "OAUTH_KV",  "id": "<OAUTH_KV id>" }
]
```

Leave `main`, `compatibility_date`, `compatibility_flags`, and `observability` as-is — they belong to the source. At deploy time this file is overlaid onto the upstream Worker source. (The tenant id and `users/<username>/` prefix are derived per request from the OAuth grant — no env var.)

**b. Set one Actions secret + a few variables** on the data repo (Settings → Secrets and variables → Actions):

- Secret **`CLOUDFLARE_API_TOKEN`** — a Cloudflare token with Workers + KV edit. The *only* secret, used by Deploy / Onboard / Revoke. **This is why the data repo is private** — it holds your credentials and the invite codes onboarding prints.
- Variable **`TENANT_KV_ID`** — your `TENANT_KV` namespace id (Onboard/Revoke write KV by id, since they don't read `wrangler.jsonc`).
- Variable **`WORKER_NAME`** (optional) — your worker `name`, so Onboard can auto-resolve the connector host for its summary. Or set **`WORKER_HOST`** directly (e.g. `grocery.example.com`).

## 6. Deploy + set the Worker's runtime secrets

Run the **Deploy Worker** Action (your data repo → Actions → Run). It checks out the upstream Worker source, overlays your `wrangler.jsonc`, typechecks, tests, and `wrangler deploy`s — billed to your account.

Once deployed, add the Worker's runtime secrets in the Cloudflare dashboard → your Worker → **Settings → Variables and Secrets → Add (encrypted)**:

- `GITHUB_APP_PRIVATE_KEY` — paste the `app-pkcs8.pem` contents (the dashboard accepts multi-line).
- `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET`.

*(CLI alternative: `npx wrangler secret put GITHUB_APP_PRIVATE_KEY < app-pkcs8.pem`, etc.)* These persist across deploys — set once. Delete `app-pkcs8.pem` when done — the key lives in Cloudflare now.

## 7. Onboard yourself

Run the **Onboard member** Action (your data repo → Actions) with `username: <you>` (leave `invite_code` blank to auto-generate). It allowlists you in KV and mints your invite code (shown in the run summary — **visible only to you**, since this is your private repo). Your `users/<you>/` subtree is created automatically on your first write (e.g. setting your Kroger store) — the commit engine creates files at any path.

## 8. Connect Claude.ai + Kroger consent

- **Bake your Worker URL into the bundle first.** The connector URL is hard-coded in the plugin's `.mcp.json` — claude.ai does **not** honor a plugin `userConfig` variable (we tried; it reaches the connector literally). So in **your fork**, rebuild and push: `npm run build:plugin -- --mcp-url https://<worker-host>/mcp --out plugin/grocery-agent`. The skills come from [`AGENT_INSTRUCTIONS.md`](../AGENT_INSTRUCTIONS.md) and are CI-drift-guarded; only this URL differs per operator.
- **Claude.ai**: add your marketplace (`/plugin marketplace add <you>/groceries-agent`) and install the **grocery-agent** plugin — it bundles the connector (with your baked-in URL) *and* all the skills, so there's **nothing to paste**. Claude.ai discovers the connector's OAuth endpoints and sends you to `/authorize` — **enter your invite code**. The token then carries your tenant on every request. (Note: adding a marketplace in claude.ai clones the repo locally and needs GitHub access to sync — so plugin **auto-updates** effectively require a GitHub account. Members without one install the bundle and re-pull manually on changes — no worse than the old paste-the-doc flow.)
- **Kroger consent** (one-time): visit `https://<worker-host>/oauth/init?tenant=<you>` and approve at Kroger. Re-run if a cart write ever returns `reauth_required`.

## 9. Cookbook site (optional)

On the data repo: upgrade to **GitHub Pro** and enable **Pages → Source: GitHub Actions**. The template's `build-site.yml` builds the public cookbook from `recipes/` (never `users/`) and deploys it. Runs are billed to your account.

## Taking upstream updates

There's no fork to sync. Your data repo's caller workflows reference the code repo at `@main` (latest) or a pinned tag/sha. To control *when* you take updates, pin `code_ref` in your `deploy.yml` (and the `@…` ref in the other callers) to a release tag, and bump it when you're ready. After an update that changes Worker config, reconcile your `wrangler.jsonc` against [the upstream one](../wrangler.jsonc) (new bindings/vars) and re-run **Deploy Worker**.

## Onboard a friend

A friend needs only a Claude.ai account and a Kroger account — no GitHub, no Kroger Developer app, and nothing local on your end.

1. Your data repo → **Actions** → **Onboard member** → Run, enter their `username`. It allowlists them and mints their invite code (in the run summary, private to you). Their `users/<username>/` subtree is created on their first write.
2. Send them the marketplace + the invite code — that's it. The plugin bundles the connector and skills, so there's no URL to paste and no instructions to copy.
3. They add your marketplace (`/plugin marketplace add <you>/groceries-agent`) and install the **grocery-agent** plugin (your Worker URL is already baked in) → enter the code at `/authorize` → run their Kroger consent (`/oauth/init?tenant=<username>`). On a later change you push, they re-pull via `/plugin marketplace update` if they have a GitHub account; otherwise re-install the bundle.

They share the recipe corpus (with their own ratings/notes) and have their own pantry, preferences, and Kroger cart — fully isolated from yours. To remove someone, run **Revoke member** (optionally deleting their `users/<username>/` subtree).

## Known unknowns / caveats

- **Kroger Acceptable-Use** (unverified): the public tier's clause on serving non-owner users wasn't confirmable (JS-rendered docs). Low blast radius at friend-group scale; skim the policy (or email Kroger dev support) before inviting non-owner friends.
- **Kroger cart cap**: 5,000 cart calls/day **per app**, shared across all members — far above friend-group need.
- **GitHub Pro** is required only for the public cookbook site.
- **Secrets live in one place — your private data repo.** The GitHub App private key is the one high-value secret and lives only as a Cloudflare secret, never in any repo. Your `CLOUDFLARE_API_TOKEN` is the only Actions secret, on the private data repo. Invite codes are minted and printed only inside that private repo's Actions runs, so they're never world-readable. **Never copy these workflows or secrets into the public code repo or a fork of it** — a fork of a public repo is itself public, and its Actions logs would expose the invite codes.
