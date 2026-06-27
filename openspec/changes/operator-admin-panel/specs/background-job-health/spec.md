## REMOVED Requirements

### Requirement: Health endpoint is token-gated and opt-in

**Reason**: The `HEALTH_TOKEN` secret is retired. The `/health` payload is tenant-data-free by construction (counts, timestamps, and error classes only), so it carries no secret-worthy data and needs no app-level gate. Unifying operator auth on Cloudflare Access for the admin surface left `HEALTH_TOKEN` as a lone bespoke scheme guarding non-sensitive data; removing it is one less thing to manage.

**Migration**: See the new requirement "Health endpoint is unauthenticated and safe to expose". `/health` becomes open and tenant-clean by default; an operator who wants to restrict reads does so at the edge (a Cloudflare Access app or WAF rule) with no Worker code. The `HEALTH_TOKEN` secret is dropped from `src/env.ts` and the deployed Worker.

## ADDED Requirements

### Requirement: Health endpoint is unauthenticated and safe to expose

`/health` SHALL be served without any Worker-enforced authentication, and its response SHALL be safe to expose publicly: tenant-data-free (no usernames, tenant ids, or other per-tenant identifiers) and free of raw internal error strings. In particular, the D1 reachability probe SHALL report a boolean reachability status, not the raw `storage_error` message. Restricting who may read `/health` SHALL be an **edge** concern (e.g. Cloudflare Access or a WAF rule) requiring no Worker code; the Worker SHALL NOT carry a `HEALTH_TOKEN` or equivalent application secret for `/health`. The endpoint SHALL keep its existing aggregate shape, its independence from the `scheduled` path, and its `200`-when-ok / `503`-when-failing status split.

#### Scenario: Endpoint is reachable without a token

- **WHEN** a request hits `/health` with no credentials
- **THEN** the Worker returns the aggregate health payload (`200` when ok, `503` when a job is failing), with no token required

#### Scenario: Response carries no raw internal error strings

- **WHEN** the D1 reachability probe fails
- **THEN** `/health` reports D1 as not-ok via a boolean status and does not include the raw `storage_error` message or any per-tenant identifier

#### Scenario: Restricting reads is an edge choice, not Worker code

- **WHEN** an operator wants `/health` reachable only by themselves or a monitor
- **THEN** they place a Cloudflare Access app or WAF rule in front of `/health` at the edge, and the Worker requires no change and carries no health secret
