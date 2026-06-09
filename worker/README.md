# grocery-mcp Worker

Cloudflare Worker hosting the grocery agent's custom MCP server. Change 04
implemented the **read-only, repo-data-backed** tools; Change 05 added the
**Kroger-facing reads** and the ingredient→SKU matching pipeline; Change 06 added
the **repo-data write tools**, the `grocery_list.toml` buy list, the atomic
batched-commit engine, and the **Cloudflare Access** identity gate; Change 06b
adds **`place_order`** — the order-time cart flush — plus the Kroger
`authorization_code` + PKCE user-context auth it needs and a **KV namespace**
holding the rotating refresh token (the Worker's only persistent state). The
Worker is no longer authless or stateless.

## Tools

### Repo-data reads (Change 04)

All read only the GitHub repo and return structured JSON:

| Tool | Reads | Notes |
|------|-------|-------|
| `list_recipes(filters)` | `_indexes/recipes.json` | AND on array filters; `status` defaults to `active`, `"all"` opts out; `exclude_cooked_within_days` is a param |
| `read_recipe(slug)` | `recipes/<slug>.md` | returns `{ slug, frontmatter, body }` |
| `read_pantry(filter)` | `pantry.toml` | `category` + `prepared_only`; `stale_only` is `unsupported` until `ingredients.toml` (Change 12) |
| `read_preferences()` | `preferences.toml` | parsed |
| `read_taste()` | `taste.md` | raw markdown |
| `read_diet_principles()` | `diet_principles.md` | raw markdown |

### Kroger reads + matching (Change 05)

| Tool | Notes |
|------|-------|
| `kroger_prices(ingredients)` | per-ingredient `{ regular, promo }` price + curbside/delivery availability |
| `kroger_flyer(filter)` | synthesized sale scan: precise terms + broad `flyer_terms.toml`, keeps `promo > 0`, deduped by `productId` |
| `ready_to_eat_available()` | cross-references `ready_to_eat/*.toml` against curbside/delivery fulfillment |
| `compare_unit_price(items)` | deterministic price-per-unit, dimension-bucketed; the LLM never does the arithmetic |
| `match_ingredient_to_kroger_sku(ingredient, context)` | resolve-only 7-step pipeline → confident / `ambiguous` / `unavailable`; never writes the cache, never substitutes |

`kroger_search` is an **internal** helper (term + `locationId` + fulfillment) that
the Kroger tools and the matcher call; it is deliberately **not** registered as
an MCP tool.

### Repo-data writes (Change 06)

All persist via the atomic commit engine (`src/commit.ts`) — one tool call → one
commit, structurally validated first. No tool here writes a Kroger cart.

| Tool | Writes | Notes |
|------|--------|-------|
| `update_recipe(slug, updates)` | `recipes/<slug>.md` | merge frontmatter |
| `update_pantry(operations)` | `pantry.toml` | add/remove/verify; returns `{ applied, conflicts }` |
| `mark_pantry_verified(items)` | `pantry.toml` | reset `last_verified_at` |
| `add_draft_ready_to_eat(items)` | `ready_to_eat/<meal>.toml` | each item needs a `meal` |
| `update_ready_to_eat(name, updates)` | `ready_to_eat/<meal>.toml` | matched by name across meals |
| `update_{preferences,taste,diet_principles,substitutions,aliases}(content)` | the curated file | content-faithful; call only when the user directs an edit |
| `read/add/update/remove_grocery_list` | `grocery_list.toml` | SKU-free buy list; `add` merges by normalized name |
| `commit_changes(payload)` | many | batches a whole session into one commit |

### Order placement (Change 06b)

| Tool | Writes | Notes |
|------|--------|-------|
| `place_order(payload)` | Kroger cart + `skus/kroger.toml` + `grocery_list.toml` | the **only** cart write; resolves `grocery_list ∪ menu_needs − pantry_has`, `PUT /v1/cart/add`, appends learned SKUs, advances list to `in_cart` |

`place_order` resolves the whole to-buy set against *current* Kroger availability
via the Change 05 matcher, batches `ambiguous`/`unavailable` items into a single
`checkpoint` (never added unilaterally) and pantry overlaps into `partials` (to
prompt on). The SKU-cache commit and the cart write are **independent
best-effort**: it commits the cache, writes the cart, then advances the list to
`in_cart` *only after a successful cart write* — so a cart failure is never
reported as a populated cart, and `cart.code = "reauth_required"` signals the
Kroger refresh token was rejected (re-run `/oauth/init`). Lifecycle past
`in_cart` (`ordered`, `received`) is **user-asserted** — see `docs/TOOLS.md`.

The cart write rides the **user-context** Kroger client (`src/kroger-user.ts`,
`authorization_code` + PKCE), distinct from the read-side `client_credentials`
client. Its rotating refresh token lives in the `KROGER_KV` namespace.

Failures return a structured `{ error, message, ... }` (codes: `not_found`,
`index_unavailable`, `upstream_unavailable`, `malformed_data`, `unsupported`,
`validation_failed`, `conflict`, `reauth_required`) — never a raw throw.
`reauth_required` (surfaced in `place_order`'s `cart.code`) means the Kroger
refresh token was rejected — re-run the one-time `/oauth/init`. `validation_failed` means a
staged write didn't pass structural validation (nothing committed);
`conflict` means the branch kept advancing past the commit-engine retry bound.
The matcher's `unavailable` is a tool **result**, not an error.

## Architecture

- **Transport:** `createMcpHandler` (from `agents/mcp`) over Streamable HTTP —
  no Durable Objects. MCP endpoint is `POST /mcp`; `GET /` returns a health
  line; `GET /oauth/*` drives the one-time Kroger consent (ungated — see below).
- **State:** one **KV namespace** (`KROGER_KV`) holding the rotating Kroger
  refresh token (`kroger:refresh_token`) and short-lived PKCE verifiers
  (`kroger:pkce:<state>`). The Worker's only persistent state; access tokens are
  held in isolate memory and re-minted on expiry.
- **Data access:** one authenticated GitHub client (`src/github.ts`) reads files
  at `GITHUB_REF` via the Contents API (raw media type), with retry/backoff.
- **Parsing:** `js-yaml` + a manual frontmatter split, `smol-toml` for TOML
  (`src/parse.ts`). No `gray-matter`. The `nodejs_compat` flag is enabled because
  the `agents` SDK needs it — our parsing code does not.

## Configuration

Non-secret repo coordinates are `vars` in `wrangler.jsonc`
(`GITHUB_OWNER`, `GITHUB_REPO`, `GITHUB_REF`). The secrets are:

- **`GITHUB_TOKEN`** — a fine-grained PAT scoped to the repo
  (`contents:read+write`; the write tools use the write scope via the Git Data API).
- **`KROGER_CLIENT_ID`** / **`KROGER_CLIENT_SECRET`** — a Kroger Developer
  (**public tier**) app's `client_credentials` credentials. Used by the Kroger
  client to mint access tokens for the public Products/Locations APIs.
- **`KROGER_OAUTH_CLIENT_ID`** / **`KROGER_OAUTH_CLIENT_SECRET`** — the Kroger
  `authorization_code` app credentials (user context: cart writes). May be the
  **same** app as the `client_credentials` one if it carries a registered
  redirect URI and the `cart.basic:write` scope, or a separate app.

There is also one **binding** (not a secret), `KROGER_KV` — the KV namespace for
the rotating refresh token (see [Kroger OAuth + KV setup](#kroger-oauth--kv-setup-change-06b)).

Secrets are **never** committed. Set once via `wrangler secret put`; they persist
across deploys.

### One-time Kroger setup

1. Create an app at the [Kroger Developer portal](https://developer.kroger.com/)
   on the **public** tier. Note its **Client ID** and **Client Secret**.
2. Push the credentials as Worker secrets (production):

   ```sh
   npx wrangler secret put KROGER_CLIENT_ID
   npx wrangler secret put KROGER_CLIENT_SECRET
   ```
3. Add them to `.dev.vars` for local runs (gitignored — see below).

The preferred store is read from `preferences.toml` (`[stores].preferred_location`,
e.g. `"Kroger - 76104"`); the Worker resolves its ZIP to a Kroger `locationId`
via the Locations API and caches it. Pricing requires a `locationId`, so this
must be set for any priced tool to work.

### Kroger OAuth + KV setup (Change 06b)

A Kroger **cart write** needs user context (the read tools only need
`client_credentials`), so `place_order` rides an `authorization_code` + PKCE
flow. Kroger refresh tokens are **single-use/rotating**, so the refresh token is
the Worker's one piece of persistent state, held in a **KV namespace**.

1. **Kroger app.** Reuse the public-tier app or create a second one. It must have
   the **redirect URI** `https://<your-worker-host>/oauth/callback` registered and
   the **`cart.basic:write`** scope granted. Set its credentials as secrets:

   ```sh
   npx wrangler secret put KROGER_OAUTH_CLIENT_ID
   npx wrangler secret put KROGER_OAUTH_CLIENT_SECRET
   ```

2. **KV namespace.** Create it and paste the returned id into `wrangler.jsonc`
   (`kv_namespaces[0].id`, replacing `REPLACE_WITH_KV_NAMESPACE_ID`):

   ```sh
   npx wrangler kv namespace create KROGER_KV
   ```

3. **Access carve-out.** Kroger's redirect to `/oauth/callback` carries **no**
   Cloudflare Access JWT, so it would be blocked by the gate. Add an Access
   **Bypass** policy scoped to the path `/oauth/*` on the gated hostname (Zero
   Trust dashboard → the grocery-mcp application → add a policy: **Bypass**,
   include **Everyone**, with a path match on `/oauth`). The carve-out is secured
   instead by OAuth `state` + PKCE: the per-flow verifier is held in KV keyed by
   `state`, so a callback whose `state` has no stored verifier is rejected with no
   token exchange. `/mcp` and everything else stay gated. In-Worker, `index.ts`
   also routes `/oauth/*` **before** the JWT check for the same reason.

4. **One-time authorization.** After deploy, visit `https://<your-worker-host>/oauth/init`
   in a browser, approve at Kroger, and the `/oauth/callback` exchange stores the
   refresh token in KV. This is a one-time act; tokens refresh automatically
   thereafter. If a refresh is ever rejected, `place_order` returns
   `cart.code: "reauth_required"` — just re-run `/oauth/init`.

## Local development

```sh
npm install

# Provide secrets for local runs. .dev.vars is gitignored — never commit it.
cat > .dev.vars <<'EOF'
GITHUB_TOKEN = "github_pat_..."
KROGER_CLIENT_ID = "..."
KROGER_CLIENT_SECRET = "..."
KROGER_OAUTH_CLIENT_ID = "..."
KROGER_OAUTH_CLIENT_SECRET = "..."
EOF

npm run dev          # wrangler dev (local Worker)
npm run typecheck    # tsc --noEmit
npm test             # vitest (pure logic: unit-price, matching, Kroger client, parsing, errors)
```

Point the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) at
the local URL's `/mcp` endpoint and call `list_recipes({ status: "active" })`.

> Gitignored-but-needed-to-run: **`.dev.vars`** (local secrets). Add any future
> local-only files to this list as they're introduced.

## First deploy (one-time, manual)

Requires a Cloudflare account and a `workers.dev` subdomain.

```sh
npx wrangler deploy                       # creates the Worker
npx wrangler secret put GITHUB_TOKEN        # paste the PAT
npx wrangler secret put KROGER_CLIENT_ID    # paste the Kroger client ID
npx wrangler secret put KROGER_CLIENT_SECRET # paste the Kroger client secret
npx wrangler secret put KROGER_OAUTH_CLIENT_ID     # cart-write (authorization_code) app
npx wrangler secret put KROGER_OAUTH_CLIENT_SECRET
```

The KV namespace + Access `/oauth/*` bypass + the one-time `/oauth/init` are a
separate one-time step — see
[Kroger OAuth + KV setup](#kroger-oauth--kv-setup-change-06b).

After this, **CD owns every deploy**: a push to `worker/**` on `main` runs
[`.github/workflows/deploy-worker.yml`](../.github/workflows/deploy-worker.yml),
which typechecks, tests, and deploys using the `CLOUDFLARE_API_TOKEN` Actions
secret. The Worker's own secrets are not touched by CD — they persist.

## Cloudflare Access gate (Change 06)

The Worker exposes write tools, so the MCP endpoint must not be public. It sits
behind **Cloudflare Access** with a policy that authorizes **only the owner's
identity**. Because the Claude.ai **web** client is OAuth-only (it can't send
custom headers, so Access **service tokens won't work**), use **Managed OAuth**:
Access becomes the OAuth authorization server, so the Worker needs no MCP-facing
OAuth code.

No custom domain needed — Access can protect the `*.workers.dev` URL directly.
Prereqs: a (free) **Zero Trust** organization and an identity method
(**One-time PIN** works for a single user — no external IdP).

One-time setup (Cloudflare **Zero Trust** dashboard, **manual** — not in CD):

1. **Access controls → Applications → Create new application → Self-hosted and
   private.**
2. **Add public hostname** → enter `grocery-mcp.<subdomain>.workers.dev` (root
   host only, **not** `/mcp`).
3. Add a **policy**: Allow, Emails = your email only.
4. **Advanced settings → enable Managed OAuth** (Access emits `WWW-Authenticate`
   → `/.well-known/oauth-authorization-server` and runs registration + PKCE +
   token issuance). Copy the **AUD tag** from Additional settings.
5. **Advanced settings → Allowed redirect URIs** → add the MCP client's callback,
   `https://claude.ai/api/mcp/auth_callback` (or `https://claude.ai/api/mcp/*`).
   **Required even with DCR:** dynamic client registration stores a client's
   redirect URI, but the authorize endpoint *also* validates it against this
   app-level allowlist. Without it the authorize request is rejected pre-login
   with `invalid_request: Redirect URI not allowed by application configuration`,
   and the connector reports "Authorization with the MCP server failed" with no
   login screen ever shown.

Access protects the whole hostname **except `/oauth/*`**, which is carved out by a
Bypass policy so the Kroger OAuth callback (which carries no Access JWT) can reach
the Worker — secured instead by OAuth `state` + PKCE. See
[Kroger OAuth + KV setup](#kroger-oauth--kv-setup-change-06b). `/mcp` and
everything else are validated like normal.

**In-Worker JWT validation (defense-in-depth, implemented).** `src/access.ts`
revalidates the `Cf-Access-Jwt-Assertion` header that Access injects, using `jose`
against the team's signing keys. This closes the gap if a request ever reaches
the Worker without passing Access (e.g. the un-gated `workers.dev` URL). It is
**config-gated**: enforced only when both `ACCESS_AUD` and `ACCESS_TEAM_DOMAIN`
(`vars` in `wrangler.jsonc`, both non-secret) are set — so local dev is
unaffected. `ACCESS_AUD` is the application's AUD tag; `ACCESS_TEAM_DOMAIN` is the
Zero Trust team domain, e.g. `casey.cloudflareaccess.com`. Leave
`ACCESS_TEAM_DOMAIN` blank to disable the in-Worker check (the edge gate still
applies).

> **Managed OAuth is in open beta.** Re-verify availability before wiring
> Claude.ai (Change 07). Fallback: [`workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider)
> implements the OAuth endpoints in the Worker itself (more code, not
> beta-dependent, still standard-OAuth so Claude.ai web works).
>
> The Kroger OAuth callback at `/oauth/*` (Change 06b) **bypasses** Access
> (Kroger's redirect carries no Access JWT) — protected by OAuth `state`/PKCE
> instead. It lives under `/oauth/*`, distinct from Access's own Managed-OAuth
> endpoints under `/.well-known/` and `/cdn-cgi/access/`, so they don't collide.

## Observability

`observability.enabled` is on in `wrangler.jsonc`. Tail live logs with:

```sh
npx wrangler tail
```
