## MODIFIED Requirements

### Requirement: Worker is a multi-tenant OAuth 2.1 provider

The Worker SHALL act as an OAuth 2.1 authorization server for the MCP surface so that each member of the friend group connects their own Claude.ai account to the one shared Worker. The Worker SHALL support the dynamic client registration + authorization-code + PKCE flow that the Claude.ai custom-connector requires, and SHALL issue an access token whose presentation on a later MCP request resolves to exactly one tenant. OAuth provider state (registered clients, authorization codes, grants/tokens) SHALL be stored in KV — no SQL database. The access token SHALL be the sole tenant identifier carried on MCP calls; the Worker SHALL NOT rely on Cloudflare Access for MCP-surface identity. A malformed `/authorize` request SHALL render a clean error page with an HTTP 400 status — not a generic 500 — on both the GET and POST paths, consistent with the repo's "structured errors, not throws" convention at user-facing boundaries; `redirect_uri` validation remains unchanged (no open redirect).

#### Scenario: A friend connects their own Claude.ai

- **WHEN** a friend adds the connector in their Claude.ai account and completes the OAuth flow
- **THEN** the Worker issues an access token bound to that friend's tenant, and subsequent MCP calls carrying it are served in that tenant's context

#### Scenario: Provider state lives in KV

- **WHEN** the OAuth provider persists a registered client, an authorization code, or an issued grant
- **THEN** it is stored in a KV namespace and no relational/SQL store is introduced

#### Scenario: Malformed authorization request yields a 400, not a 500

- **WHEN** a malformed or invalid `/authorize` GET request fails to parse
- **THEN** the Worker renders the malformed-request error page with HTTP 400, the same as the POST path, rather than surfacing an uncaught 500

### Requirement: Tenant usernames are case-insensitive (canonical lowercase)

Tenant usernames SHALL be case-insensitive: a member is one identity regardless of the casing presented. The Worker SHALL define a single canonical form — **lowercase** — and SHALL apply it at every boundary that derives a key from the username, so the directory key, the invite target, the grant prop, the D1 tenant id, and the Kroger token key all agree. Specifically:

- The Worker SHALL normalize the grant's `tenantId` to its canonical lowercase form **before** the allowlist (tenant directory) lookup and before constructing any `tenant:<id>` directory key, D1 tenant id, or `kroger:refresh:<id>` token key. Normalization before the lookup is the single defensive point: a mixed-case grant SHALL resolve to the same tenant — and the same D1 rows — as the lowercase form, never to a distinct or empty identity.
- Member provisioning SHALL mint the `tenant:<id>` allowlist entry, the stored record `id`, and the `invite:<code>` target in canonical lowercase form, so the directory key and the D1 tenant id agree at the source.
- The invite-code identity step SHALL return the canonical lowercase username, so the grant prop derived from it is already normalized.
- Tenant **directory enumeration** (`TenantStore.list()`) SHALL return canonical lowercase ids, matching `get()`, so cross-tenant group-aggregation consumers that derive `users/<id>/...` GitHub paths or `profile:<id>` KV keys from the enumerated ids never inherit stored casing.
- Shared-root data (recipes, reference data, discovery sources) does NOT use the username and SHALL be unaffected by this normalization.

A consequence is that a username that differs only by case is NOT a distinct tenant; the directory SHALL NOT hold two entries that collide under canonicalization.

#### Scenario: Mixed-case grant resolves to the lowercase tenant id and allowlist entry

- **WHEN** an MCP request arrives whose grant `tenantId` is `Casey` (or `CASEY`) and the allowlist holds the canonical entry `casey`
- **THEN** the Worker normalizes the id to `casey`, confirms it against the allowlist, and resolves the tenant to the canonical id `casey` — the same result as a grant of `casey`

#### Scenario: Directory enumeration returns canonical ids

- **WHEN** `TenantStore.list()` enumerates a directory key stored with non-canonical casing (e.g. `tenant:Casey`)
- **THEN** it returns the canonical id `casey`, so group-aggregation paths and keys derived from it match the member's own normalized writes
