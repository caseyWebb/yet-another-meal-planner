# SELF_HOSTING — run your own grocery-agent

The operator's one-time setup. When you finish you'll have a private **data repo**, a deployed **grocery-mcp Worker**, and Claude.ai connected — with everything **driven from the web UI + GitHub Actions**. The only local command in the whole flow is one `openssl` line to convert a key.

> **How identity works.** The Worker is its own OAuth 2.1 provider (`@cloudflare/workers-oauth-provider`): members add the connector in Claude.ai, complete an **invite-code** consent page, and get a token whose tenant rides every request. Operator and friends use the same path — no Cloudflare Access, no third-party login, and friends need no GitHub or Kroger Developer account.

## Mental model

| Piece | What it is | Yours? |
|---|---|---|
| **Code repo** (`caseyWebb/groceries-agent`) | the Worker + build tooling + CI | **fork it** — your fork is your control plane (deploy + provision via Actions); `git pull` upstream to update |
| **Data repo** (`<you>/groceries-agent-data`, **private**) | `recipes/` + reference data + `users/<username>/` | you create it from the template |
| **Worker** (`grocery-mcp` on Cloudflare) | the MCP server Claude.ai talks to | you deploy it (from your fork's Actions) |
| **Cookbook site** (GitHub Pages on the data repo) | public read-only recipe site | optional; needs GitHub Pro |

A single **GitHub App** (on your account, scoped to the data repo) gives the Worker read/write to the data repo — no PAT. A single **Kroger** public-tier app handles search/prices (app-level) and per-user cart consent.

## Prerequisites

- A **GitHub** account (+ **GitHub Pro**, ~$4/mo, *only* for the optional public cookbook site from a private repo).
- A **Cloudflare** account (Workers + KV are free-tier).
- A **Kroger Developer** account.
- `openssl` once (any machine), to convert the App key. No other local tooling required — though if you have the `wrangler` CLI you can use it instead of the Cloudflare dashboard where noted.

## 1. Fork the code repo

**Fork** `caseyWebb/groceries-agent` to your account and **enable Actions** on the fork (Actions tab → enable). Your fork holds your `wrangler.jsonc` config and runs your *Deploy* / *Onboard* / *Revoke* workflows. To take upstream updates later, `git pull` (or sync the fork in the GitHub UI).

## 2. Create the data repo

On the [`groceries-agent-data-template`](https://github.com/caseyWebb/groceries-agent-data-template) → **Use this template** → create `<you>/groceries-agent-data`, **Private**. Add your recipes under `recipes/`, reference data (`aliases.toml`, …), and your own `users/<username>/` (or let the *Onboard* Action seed it in step 8). The template's CI regenerates `_indexes/` on every recipe change.

## 3. Register the GitHub App

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App** (on your account):

- **Homepage URL**: anything. **Webhook**: uncheck **Active**. **"Request user authorization (OAuth)"**: leave off (identity is not GitHub login).
- **Repository permissions → Contents: Read and write** — covers both the Contents API and the Git Data API the commit engine uses. Everything else: No access.
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

## 4. Register the Kroger app

At [developer.kroger.com](https://developer.kroger.com), register one **public-tier** app:

- Scopes: `product.compact` (search/prices) + `cart.basic:write` (cart).
- Redirect URI: `https://<worker-host>/oauth/callback`.
- Capture the **client id** + **secret**.

## 5. Create the KV namespaces

Cloudflare dashboard → **Workers & Pages → KV → Create namespace** (×3): `KROGER_KV`, `TENANT_KV`, `OAUTH_KV`. Note each namespace **id**. *(CLI alternative: `npx wrangler kv namespace create <NAME>`.)*

## 6. Configure your fork

Edit `wrangler.jsonc` **in your fork** (GitHub's web editor is fine) — all non-secret:

```jsonc
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

(The tenant id and `users/<username>/` prefix are derived per request from the OAuth grant — no env var.)

Then set two **Actions secrets** on the fork (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — a Cloudflare token with Workers + KV edit; used by *Deploy*, *Onboard*, *Revoke*.
- `GH_APP_PRIVATE_KEY` — paste the contents of `app-pkcs8.pem`; used by *Onboard*/*Revoke* to write the data repo.

## 7. Deploy + set the Worker's runtime secrets

Run the **Deploy Worker** Action (Actions tab → Run), or push any change to `src/`. It typechecks, tests, and `wrangler deploy`s.

Once deployed, add the Worker's runtime secrets in the Cloudflare dashboard → your Worker → **Settings → Variables and Secrets → Add (encrypted)**:

- `GITHUB_APP_PRIVATE_KEY` — paste the `app-pkcs8.pem` contents (the dashboard accepts multi-line).
- `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET`.

*(CLI alternative: `npx wrangler secret put GITHUB_APP_PRIVATE_KEY < app-pkcs8.pem`, etc.)* Delete `app-pkcs8.pem` when done — the key lives in Cloudflare + the Actions secret now.

## 8. Onboard yourself

Run the **Onboard member** Action with `username: <you>` (leave `invite_code` blank to auto-generate). It allowlists you in KV, mints your invite code (shown in the run summary), and seeds `users/<you>/` in the data repo if absent.

## 9. Connect Claude.ai + Kroger consent

- **Claude.ai**: add the Worker (`https://<worker-host>/mcp`) as a custom connector. Claude.ai discovers the OAuth endpoints, registers itself, and sends you to `/authorize` — **enter your invite code**. The token then carries your tenant on every request.
- **Kroger consent** (one-time): visit `https://<worker-host>/oauth/init?tenant=<you>` and approve at Kroger. Re-run if a cart write ever returns `reauth_required`.
- Paste [`AGENT_INSTRUCTIONS.md`](../AGENT_INSTRUCTIONS.md) into your Claude.ai Project.

## 10. Cookbook site (optional)

On the data repo: upgrade to **GitHub Pro** and enable **Pages → Source: GitHub Actions**. The template's `build-site.yml` builds the public cookbook from `recipes/` (never `users/`) and deploys it. Runs are billed to your account.

## Onboard a friend

A friend needs only a Claude.ai account and a Kroger account — no GitHub, no Kroger Developer app, and nothing local on your end.

1. On your fork's **Actions** tab → **Onboard member** → Run, enter their `username`. It allowlists them, mints their invite code (in the run summary), and seeds `users/<username>/` in the data repo — one run.
2. Send them the connector URL (`https://<worker-host>/mcp`) + the invite code + `AGENT_INSTRUCTIONS.md`.
3. They connect Claude.ai → enter the code at `/authorize` → run their Kroger consent (`/oauth/init?tenant=<username>`).

They share the recipe corpus (with their own ratings/notes) and have their own pantry, preferences, and Kroger cart — fully isolated from yours. To remove someone, run **Revoke member** (optionally deleting their `users/<username>/` subtree).

## Known unknowns / caveats

- **Kroger Acceptable-Use** (unverified): the public tier's clause on serving non-owner users wasn't confirmable (JS-rendered docs). Low blast radius at friend-group scale; skim the policy (or email Kroger dev support) before inviting non-owner friends.
- **Kroger cart cap**: 5,000 cart calls/day **per app**, shared across all members — far above friend-group need.
- **GitHub Pro** is required only for the public cookbook site.
- The GitHub App private key is the one high-value secret — it lives only as a Cloudflare secret + a GitHub Actions secret, never in the repo. The invite code shown in an Onboard run is visible to anyone with repo access (fine for a trusted group; rotate by re-running with a new code).
