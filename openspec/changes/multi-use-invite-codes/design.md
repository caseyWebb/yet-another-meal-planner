## Context

Today identity is flat and serial: `tenant` = user = person = one lowercase username. The operator mints the username and a single-use bootstrap code together (`onboard()`, `src/admin.ts`), so onboarding a friend group is N manual steps and the operator chooses every name. Invites live in KV (`invite:<code>` → existing tenant); tenants have **no** strongly-consistent registry (the `tenant:<id>` allowlist is KV, written serially by the operator). The passkey change already demoted the invite code to a single-use bootstrap consumed on enrollment and made the passkey the durable credential — which is exactly what makes a *shared* code safe now: it admits people to *create their own accounts*, not to share one.

Constraints: `workerd` (pure JS / WebCrypto, no Node internals). Three KV namespaces; all durable relational per-tenant data is D1, isolated by a `tenant` column, reached only through `src/db.ts` (throw-free `storage_error`). The `multi-tenancy` spec currently says the allowlist is "not a self-service signup" — this change amends that to *operator-authorized, bounded* self-service.

## Goals / Non-Goals

**Goals:**
- An operator-issued group invite code, capped + optionally expiring + labeled, that a friend redeems to self-provision their **own isolated tenant** under a self-chosen username.
- Exact cap enforcement and username uniqueness under concurrency — no over-spend, no two people in one tenant.
- Keep the passkey credential model, the `/authorize` cross-device approval, and per-tenant isolation untouched.
- Converge existing tenants into the new registry organically (no manual data surgery).

**Non-Goals:**
- A shared-household tenant / any per-user identity *within* a tenant (that is an identity re-platform, not this change).
- Multi-use signup on the Claude.ai `/authorize` surface (signup is web-app-only; connect happens afterward, unchanged).
- Seeding a new tenant from a template corpus (v1 starts blank).
- Reaping abandoned never-enrolled accounts (operator revokes them; automated cleanup is future work).

## Decisions

### D1 — Self-service creates a new isolated tenant, not a shared household

Redeeming a group code creates a brand-new tenant (own recipes/pantry/Kroger/plans), exactly like an operator-onboarded member but self-service; the chosen username becomes the tenant id. **Why:** yamp is a *personal* meal planner — per-tenant Kroger, pantry, meal plans — so "sign up and pick a username" means *make your own account*. **Alternative (shared household):** everyone joins one shared tenant with usernames as sub-identities — rejected: it requires a per-user identity layer that does not exist and would touch every per-tenant table, the session model, and the passkey handle (currently = tenant id). An identity re-platform, out of scope.

### D2 — Group codes and a tenant registry live in D1, not KV

A group code is a **counted, listed, enforced, revocable** artifact, and self-chosen names need a uniqueness authority. KV has no atomic increment and is eventually consistent, and can't cheaply list codes with live usage. So `signup_invites`, `signup_redemptions`, and a `tenants` registry go in D1. **Why:** matches the pattern the passkey change set — durable relational truth that needs strong read-after-write → D1; ephemeral ceremony state → KV. **Alternative (KV-only):** simpler, no new tables, but the cap over-spends under concurrency, there's no cheap list-with-usage, and brand-new-name claims race. Rejected.

### D3 — Redemption is one atomic D1 transaction

Redemption runs a guarded cap decrement + tenant-registry insert + provenance insert as **all-or-nothing**: `UPDATE signup_invites SET used = used + 1 WHERE code = ? AND used < max AND not expired AND not revoked` (must affect exactly one row) together with `INSERT INTO tenants(id) …` (fails if taken) and the `signup_redemptions` insert. The slot is spent **iff** the create commits; a username collision or an exhausted code rolls the whole thing back. **Why:** one moment of truth closes every race. **Alternative (separate steps + compensation):** rejected — partial states, refund logic, and windows where a slot is spent on a failed claim.

### D4 — Two invite systems, cleanly separate

The KV `invite:<code>` bootstrap path (**resolve** an existing tenant; `onboard`/`rotate`/recovery; consumed on passkey enrollment) is unchanged. The D1 group-code path (**create** a new tenant; capped/expiring/revocable) is new. Different entry points — `POST /api/session` resolves, `POST /api/signup` creates — with no shared namespace or redemption path. **Why:** the two have opposite semantics and lifetimes; overloading `resolveInvite`/the invite union would force the KV path to carry a counter it can't enforce and blur resolve-vs-create. **Alternative (one unified invite union):** rejected for that conflation.

### D5 — Uniqueness enforced at two layers

A self-service claim rejects a username that is (a) already in the KV `tenant:<id>` allowlist — catches collisions with already-onboarded members — **and** (b) already in the D1 `tenants` registry via `INSERT … ON CONFLICT` — catches the atomic race between concurrent brand-new-name claims. The KV `tenant:<id>` entry is written **only after** the D1 claim wins, so a losing claim never leaves an allowlist entry behind. **Why both:** the KV check covers existing names even before backfill; the D1 insert is the only strongly-consistent tiebreaker for a name that doesn't exist yet. **Alternative (KV alone):** rejected — eventual consistency lets two brand-new `bob` claims both pass the read.

### D6 — Signup is web-app-only; `/authorize` is untouched

A self-service member signs up and enrolls a passkey in the web app, then connects Claude.ai through the existing cross-device approval. **Why:** enrollment already runs only in the web app (the reliable browser); keeping signup there too dissolves the webview-WebAuthn question and leaves the OAuth surface unchanged. **Alternative (accept a group code at `/authorize`):** rejected — reintroduces typing a secret into the OAuth webview for no gain, since connect-after-signup already works.

### D7 — Spend the slot at account creation, not at enrollment

Claiming the username creates the tenant and spends the slot atomically (D3); passkey enrollment follows in the same session. **Why:** the name claim IS the atomic point, so the collision window never opens; an abandoned never-enrolled account is just a blank tenant the operator revokes. A half-onboarded member (created, no passkey) resumes from the ~90-day session cookie, or the operator `rotate()`s a single-use bootstrap. **Alternative (spend at enrollment, mirroring bootstrap):** rejected — it reopens a claim→enroll collision window, the exact race D3/D5 close.

### D8 — Backfill existing tenants by convergence, not surgery

An **idempotent** pass inserts every KV-allowlist tenant into the `tenants` registry. Correctness of collision-prevention does **not** depend on it completing first (D5's KV check already covers existing names); the backfill just makes the registry the complete forward record. Existing members are the acceptance fixture, verified against production after deploy. **Why:** the repo's "data converges through the pipeline, never manual surgery" rule — and KV isn't reachable from a SQL migration anyway. **Alternative (one-time SQL data migration):** impossible and against the rule.

### D9 — "Username taken" is a deliberate, bounded disclosure

Signup must tell the redeemer a name is taken (necessary UX), unlike the login surfaces which must be non-oracles. Tenant ids aren't secret within the group, so this is acceptable; every *other* failure (unknown/exhausted/expired/revoked code) stays uniform. Redemption is rate-limited per IP (shared fixed-window limiter, fail-open); the cap and expiry are the standing abuse bounds.

### D10 — Admin Invite-codes UI built directly here (one-time exception)

The companion Claude Design project is being rebuilt from scratch, so this once the Invite-codes section is built directly on the shared shadcn/ui + operator theme and then **exported to seed** that project, rather than authored there first. It still ships with its Playwright page object + specs. Recorded as a deliberate, one-time exception to the repo's design-process rule.

## Risks / Trade-offs

- **[A group code posted in a chat is a bearer secret]** → but a fundamentally weaker one than the pre-passkey standing code: it only lets someone *create a new blank account* (bootstrap + their own passkey), never access an existing tenant; bounded by cap + expiry + revocation + per-IP rate-limit. The operator revokes the code and any rogue blank tenant.
- **[D1 atomicity assumption]** → the guarded `UPDATE` + `INSERT … ON CONFLICT` + provenance insert must be genuinely all-or-nothing. First implementation task smoke-tests D1 `batch()`/transaction semantics on `workerd`; if a batch can't guarantee it, wrap in an explicit transaction. (Open Question.)
- **[KV propagation on the post-claim allowlist write]** → harmless: the D1 registry is the uniqueness authority, so the KV `tenant:<id>` write is a cache of an already-decided claim; a brief propagation delay cannot mint a second winner, and `resolveTenant` already tolerates KV.
- **[A signup lands before backfill runs]** → the dual-layer check (D5) still catches a collision with an existing name via KV; backfill idempotency makes ordering irrelevant.
- **[Never-enrolled accounts squat names and spend slots]** → operator revokes them (ordinary tenants); acceptable at friend-group scale. Automated reaping is deferred.
- **[Admin UI diverging from the rebuilt design project]** → the direct build is exported as that project's starting point, keeping them in sync from the reset rather than drifting.

## Migration Plan

1. Migration `0047_self_service_signup.sql` creates `tenants`, `signup_invites`, `signup_redemptions` (empty); the deploy applies it `--remote`. No new binding type → no `merge-wrangler-config.mjs` change. No `run_worker_first` change (`/api/signup*` and `/admin/api/*` nest under existing `/api/*` and `/admin/*`).
2. An idempotent tenant-registry backfill converges existing KV-allowlist tenants into `tenants`; existing members are the acceptance fixture verified against production after deploy.
3. The feature is inert until the operator mints a code — no group codes minted means no behavior change, so rollout is safe by default.
4. **Rollback:** additive and gated by the presence of a group code. Reverting the Worker removes the endpoints; the empty/idle tables are harmless and need no data rollback.

## Open Questions

- **D1 transaction shape:** confirm D1 `batch()` gives all-or-nothing for the guarded `UPDATE` + `INSERT … ON CONFLICT` + provenance insert on `workerd`; if not, adopt an explicit transaction wrapper. (First implementation task — a code/platform question, not a data one.)
- **Where the backfill runs:** a dedicated reconcile step, folded into the existing `scheduled()` reconcile, or a lazy on-demand convergence. Lean toward an idempotent pass in the existing reconcile so no new cron is added; settle during implementation.
- **Code format:** reuse `randomInviteCode()`'s 16-hex, or a friendlier grouped format for pasting into a chat. Minor; decide in implementation.
