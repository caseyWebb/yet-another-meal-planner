# SELF_HOSTING — run your own grocery-agent

This is the operator's one-time setup. When you finish you'll have: a private **data repo**, a deployed **grocery-mcp Worker**, and (optionally) a public **cookbook site** — all wired together, and Claude.ai connected.

> **Status note.** The single-operator path below is built and works today. **Multi-member onboarding (friends connecting their own Claude.ai via invite codes) is not built yet** — it needs the OAuth-provider + allowlist work tracked as §3 of the `multi-tenant-friend-group` change. Until then, the Worker's MCP surface is gated by Cloudflare Access for one operator. The "Onboard a friend" section marks what's pending.

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
npx wrangler kv namespace create KROGER_KV
npx wrangler kv namespace create TENANT_KV
```

Edit `worker/wrangler.jsonc` `vars` (all non-secret):

```jsonc
"GITHUB_APP_ID": "<app id>",
"GITHUB_INSTALLATION_ID": "<installation id>",
"DATA_OWNER": "<you>",
"DATA_REPO": "groceries-agent-data",
"DATA_REF": "main",
"DATA_TENANT_ID": "<username>",        // your tenant id (keys kroger:refresh:<id>)
"DATA_USER_PREFIX": "users/<username>" // where your personal files live
```

Set the secrets (the PEM is multi-line — pipe it, don't paste):

```bash
npx wrangler secret put GITHUB_APP_PRIVATE_KEY < app-pkcs8.pem
npx wrangler secret put KROGER_CLIENT_ID
npx wrangler secret put KROGER_CLIENT_SECRET
rm app-pkcs8.pem          # the key lives in Cloudflare now — don't leave it on disk
```

Seed the tenant directory (the allowlist) in KV:

```bash
npx wrangler kv key put --binding=TENANT_KV --remote "tenant:<username>" '{"id":"<username>"}'
```

Deploy: push `worker/**` to the code repo (CD, needs a `CLOUDFLARE_API_TOKEN` Actions secret), or `npx wrangler deploy` locally. `wrangler.jsonc` is committed and carries **no secrets** — only the non-secret ids above — so either path works.

## 5. Cookbook site (optional)

On the data repo: upgrade to **GitHub Pro** and enable **Pages → Source: GitHub Actions**. The inherited `build-site.yml` builds the public cookbook from `recipes/` (never `users/`) and deploys it. Runs are billed to *your* account, not the code repo's.

## 6. Connect Claude.ai + Kroger consent

- **Claude.ai**: add the Worker as a custom connector. *Today* the MCP surface is gated by Cloudflare Access for the operator; you authenticate through the Access flow. (Per-friend invite-code OAuth is §3, pending.)
- **Kroger cart consent** (one-time): visit `https://<worker-host>/oauth/init?tenant=<username>` and approve at Kroger. The refresh token lands under `kroger:refresh:<username>`. Re-run this if a cart write ever returns `reauth_required`.

Paste [`AGENT_INSTRUCTIONS.md`](../AGENT_INSTRUCTIONS.md) into your Claude.ai Project so the agent behaves as intended.

## Onboard a friend (PENDING §3)

The collaborative end-state — a friend connects *their* Claude.ai with an operator-issued invite code, no GitHub/Kroger Developer account of their own — needs the OAuth-provider + allowlist (§3 of `multi-tenant-friend-group`). When built, onboarding will be: create `users/<friend>/` in the data repo, add `tenant:<friend>` to `TENANT_KV`, hand them an invite code + the connector URL, and they run their own Kroger consent. The data model, per-tenant repo paths, and per-tenant Kroger keys are already in place; only the identity step remains.

## Known unknowns / caveats

- **Kroger Acceptable-Use** (unverified): the public tier's clause on serving non-owner users wasn't confirmable (JS-rendered docs). Low blast radius at friend-group scale; skim the policy (or email Kroger dev support) before inviting non-owner friends.
- **Kroger cart cap**: 5,000 cart calls/day **per app**, shared across all members. Far above friend-group need; would wall an open-signup model.
- **GitHub Pro** is required only for the public cookbook site (public Pages from a private repo). Everything else is free-tier.
- The GitHub App private key is the one high-value secret — Cloudflare secret only, never in the repo.
