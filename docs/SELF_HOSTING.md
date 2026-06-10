# SELF_HOSTING — run your own grocery-agent

This is the operator's one-time setup. When you finish you'll have: a private **data repo**, a deployed **grocery-mcp Worker**, and (optionally) a public **cookbook site** — all wired together, and Claude.ai connected.

> **Status note.** The Worker is its own OAuth 2.1 provider (`@cloudflare/workers-oauth-provider`): members connect their Claude.ai, complete an **invite-code** consent page, and get a token whose tenant rides every request. Operator and friends use the same path — no Cloudflare Access, no third-party login, no GitHub/Kroger Developer account for friends.

## Mental model

| Piece | What it is | Yours? |
|---|---|---|
| **Code repo** (`caseyWebb/groceries-agent`) | the Worker + build tooling + reusable CI | clone it; don't fork-and-diverge — `git pull` to update |
| **Data repo** (`<you>/groceries-agent-data`, **private**) | `recipes/` + reference data + `users/<username>/` | you create it from the template |
| **Worker** (`grocery-mcp` on Cloudflare) | the MCP server Claude.ai talks to | you deploy it |
| **Cookbook site** (GitHub Pages on the data repo) | public read-only recipe site | optional; needs GitHub Pro |

A single **GitHub App** (on your account, scoped to the data repo) gives the Worker read/write to the data repo — no PAT. A single **Kroger** public-tier app handles search/prices (app-level) and per-user cart consent.

## Prerequisites

- A **GitHub** account (+ **GitHub Pro**, ~$4/mo, *only* if you want the public cookbook site from the private repo).
- A **Cloudflare** account (Workers + KV are free-tier).
- A **Kroger Developer** account → register one app (public tier).
- Local tools: `git`, `gh`, Node 22 (via `mise`), `npx wrangler`, `openssl`.

## 1. Create the data repo

```bash
gh repo create <you>/groceries-agent-data --private \
  --template caseyWebb/groceries-agent-data-template
```

Seed it: add your recipes under `recipes/`, your reference data (`aliases.toml`, etc.), and your personal subtree `users/<username>/` (pantry, preferences, taste, diet_principles, stockup, grocery_list, an empty `overlay.toml`, `notes/`). Push. The repo's CI (inherited from the template) regenerates `_indexes/` on every recipe change.

> Migrating an existing single-repo install instead? See [MIGRATION.md](MIGRATION.md).

## 2. Register the GitHub App

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App** (on your account):

- **Homepage URL**: anything (your Worker URL or the repo).
- **Callback URL / "Request user authorization (OAuth)"**: leave blank / unchecked — identity is not GitHub login.
- **Webhook**: uncheck **Active** (the Worker receives nothing).
- **Repository permissions → Contents: Read and write** — this one permission covers the Contents API *and* the Git Data API the commit engine uses. Everything else: No access.
- **Where can this GitHub App be installed?**: Only on this account.

Create it, then capture three things:

1. **App ID** (General page) → `GITHUB_APP_ID`.
2. **Private key** → "Generate a private key" downloads a PKCS#1 PEM. The Worker needs **PKCS#8**, so convert:
   ```bash
   openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
     -in your-app.private-key.pem -out app-pkcs8.pem
   ```
3. **Installation ID** → "Install App" → your account → **Only select repositories** → `groceries-agent-data` → Install. The URL is `…/settings/installations/<INSTALLATION_ID>` → `GITHUB_INSTALLATION_ID`.

> If you ever delete and recreate the data repo, re-add it under the App's "Repository access" — the installation tracks repos by internal id, so the new repo isn't auto-included.

## 3. Register the Kroger app

At [developer.kroger.com](https://developer.kroger.com), register one **public-tier** app:

- Scopes: `product.compact` (search/prices) and `cart.basic:write` (cart).
- Add a **redirect URI**: `https://<worker-host>/oauth/callback`.
- Capture the **client id** + **secret** → `KROGER_CLIENT_ID` / `KROGER_CLIENT_SECRET` (the cart flow falls back to these unless you set a separate `KROGER_OAUTH_*` app).

## 4. Deploy the Worker

```bash
git clone git@github.com:caseyWebb/groceries-agent.git && cd groceries-agent/worker

# KV namespaces (paste each returned id into wrangler.jsonc kv_namespaces):
npx wrangler kv namespace create KROGER_KV    # Kroger refresh tokens + PKCE verifiers
npx wrangler kv namespace create TENANT_KV    # allowlist (tenant:<id>) + invite codes (invite:<code>)
npx wrangler kv namespace create OAUTH_KV     # OAuth provider state (required binding name)
```

Edit `worker/wrangler.jsonc` `vars` (all non-secret):

```jsonc
"GITHUB_APP_ID": "<app id>",
"GITHUB_INSTALLATION_ID": "<installation id>",
"DATA_OWNER": "<you>",
"DATA_REPO": "groceries-agent-data",
"DATA_REF": "main"
```

(The tenant id and `users/<username>/` prefix are derived per request from the OAuth grant — no env var.)

Set the secrets (the PEM is multi-line — pipe it, don't paste):

```bash
npx wrangler secret put GITHUB_APP_PRIVATE_KEY < app-pkcs8.pem
npx wrangler secret put KROGER_CLIENT_ID
npx wrangler secret put KROGER_CLIENT_SECRET
rm app-pkcs8.pem          # the key lives in Cloudflare now — don't leave it on disk
```

Seed the allowlist + your own invite code in KV:

```bash
# Allowlist your username, and mint an invite code that maps to it:
npx wrangler kv key put --binding=TENANT_KV --remote "tenant:<username>" '{"id":"<username>"}'
npx wrangler kv key put --binding=TENANT_KV --remote "invite:<your-code>" "<username>"
```

Deploy: push `worker/**` to the code repo (CD, needs a `CLOUDFLARE_API_TOKEN` Actions secret), or `npx wrangler deploy` locally. `wrangler.jsonc` is committed and carries **no secrets** — only the non-secret ids above — so either path works.

## 5. Cookbook site (optional)

On the data repo: upgrade to **GitHub Pro** and enable **Pages → Source: GitHub Actions**. The inherited `build-site.yml` builds the public cookbook from `recipes/` (never `users/`) and deploys it. Runs are billed to *your* account, not the code repo's.

## 6. Connect Claude.ai + Kroger consent

- **Claude.ai**: add the Worker (`https://<worker-host>/mcp`) as a custom connector. Claude.ai discovers the OAuth endpoints, registers itself, and sends you to the Worker's `/authorize` page — **enter your invite code** to approve. The issued token carries your tenant on every request. No Cloudflare Access.
- **Kroger cart consent** (one-time): visit `https://<worker-host>/oauth/init?tenant=<username>` and approve at Kroger. The refresh token lands under `kroger:refresh:<username>`. Re-run this if a cart write ever returns `reauth_required`.

Paste [`AGENT_INSTRUCTIONS.md`](../AGENT_INSTRUCTIONS.md) into your Claude.ai Project so the agent behaves as intended.

## Onboard a friend

A friend needs only a Claude.ai account and a Kroger account — no GitHub, no Kroger Developer app. As operator:

```bash
# 1. Create their personal subtree in the data repo (seed from the template stubs):
#    users/<friend>/{pantry,preferences,stockup,grocery_list,taste,diet_principles,
#                    cooking_log,meal_plan,feeds}.toml + overlay.toml + notes/

# 2. Allowlist them and mint their invite code:
npx wrangler kv key put --binding=TENANT_KV --remote "tenant:<friend>" '{"id":"<friend>"}'
npx wrangler kv key put --binding=TENANT_KV --remote "invite:<friend-code>" "<friend>"
```

3. Hand them the connector URL (`https://<worker-host>/mcp`) + their invite code, and [`AGENT_INSTRUCTIONS.md`](../AGENT_INSTRUCTIONS.md) to paste into their Claude.ai Project.
4. They connect Claude.ai → enter the invite code at `/authorize` → run their own Kroger consent (`/oauth/init?tenant=<friend>`).

They now share the recipe corpus (with their own ratings/notes) and have their own pantry, preferences, and Kroger cart — fully isolated from yours. To remove someone, delete their `tenant:<id>` + `invite:<code>` keys (and, if you like, their `users/<id>/` subtree).

## Known unknowns / caveats

- **Kroger Acceptable-Use** (unverified): the public tier's clause on serving non-owner users wasn't confirmable (JS-rendered docs). Low blast radius at friend-group scale; skim the policy (or email Kroger dev support) before inviting non-owner friends.
- **Kroger cart cap**: 5,000 cart calls/day **per app**, shared across all members. Far above friend-group need; would wall an open-signup model.
- **GitHub Pro** is required only for the public cookbook site (public Pages from a private repo). Everything else is free-tier.
- The GitHub App private key is the one high-value secret — Cloudflare secret only, never in the repo.
