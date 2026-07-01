## Context

The Members area (`src/admin/pages/members.tsx` + `src/admin/client/members.tsx`) is the original thin implementation: SSR renders a one-column `<table>` of member ids from `listTenants` (`src/admin.ts`), and the island hydrates that table with inline onboard/rotate/kroger-link/revoke buttons. There is no roster presentation (badges, avatars, activity) and no member-detail view — an operator cannot see one member's pantry/meal-plan/grocery/cooking-log/notes from the panel today.

The mock (`MembersScreen.jsx`, `MemberDetail.jsx`, `members-data.jsx`) establishes the target UX: summary stat tiles, an `Item`/`ItemGroup` roster with avatar/badges/activity/actions-menu, a `Dialog`-based invite flow with a shown-once banner, and a clicked-through member-detail view with a six-section pills sub-nav (Profile/Pantry/Meal plan/Grocery/Cooking log/Notes). The foundation change already landed the kit primitives this composes from (`src/admin/ui/kit.tsx`: `Item`/`ItemGroup`, `Avatar`, `StatCardGrid`/`StatCard`, `DropdownMenu`, `Dialog`, `Field`, `DataTable`) and a global health dock; this change is presentation + the minimal data plumbing to drive it, not new kit primitives.

`memberDetail(env, tenantId)` in `src/admin-data.ts` already returns `{ id, profile, pantry, meal_plan, grocery_list, overlay, cooking_log, recipe_notes, store_notes }` — built for the Data explorer's per-tenant drill-down, reused here for the member-detail sub-nav's Profile/Pantry/Meal plan/Grocery/Cooking log/Notes sections. The roster itself, however, has a real data gap: `listTenants` returns only `{ tenants: string[] }` (canonical lowercase ids, alphabetically sorted) — no owner flag, no active/pending status, no Kroger-linked status, no activity timestamps or counts. The mock's roster and stat tiles need all of these.

## Goals / Non-Goals

**Goals:**
- Redesign the Members roster (stat tiles, `Item`/`ItemGroup` rows, dialog invite flow) using existing kit primitives, with the existing onboard/rotate/kroger-login/revoke routes unchanged.
- Add a member-detail surface (header + pills sub-nav over the six `memberDetail()`-backed sections) reachable by clicking a roster row.
- Identify and close the minimal data gap needed to drive the roster's status/activity fields — extending `listTenants`/the tenant directory rather than inventing a parallel data source.
- Decide and justify SSR-vs-island for the member-detail sub-nav, consistent with the panel's existing SSR-for-reads / island-for-interactivity boundary.

**Non-Goals:**
- No change to the onboard/rotate/revoke/kroger-consent **operation** semantics (`src/admin.ts`) — the allowlist write, invite mapping, purge list, and consent-nonce minting are unchanged.
- No new kit primitives — `Item`/`ItemGroup`/`Avatar`/`StatCard`/`DropdownMenu`/`Dialog`/`Field`/`DataTable` already exist and are reused as-is.
- No redesign of other areas (Status, Data, Usage, Discovery, Logs, Config) — out of scope for this change.
- No notion of a real name or email per member — the system stays username-only (a tenant id), matching the existing model; "activity" is derived from existing per-tenant tables, not a new identity field.

## Decisions

### 1. Roster fields: extend `listTenants` into a structured per-member roster row, sourced from existing storage — no new schema

The mock's stat tiles and roster rows need, per member: `owner` (bool), `status` (`active` | `pending`), `kroger` (`linked` | `unlinked`), `joined`/`invited` timestamp, `lastActive` timestamp, and `cooked`/`favorites` counts. None of this is a new domain concept — it is derivable from data the Worker already has, plus one genuinely new signal (an owner flag) that needs an explicit source:

- **`status` (active vs. pending)**: derivable today. A tenant is `pending` if it has an allowlist entry but has never completed an MCP OAuth exchange (no token has resolved to it); `active` otherwise. The admin's `tenant:<id>` KV record (currently `{ id }`, written by `onboard`/visible in `src/admin.ts`) gains an `activatedAt` timestamp, set the first time tenant resolution succeeds for that id (in `src/tenant.ts`'s resolution path) — analogous to how `joined`/`invited` is computed in the mock. Until set, the member is `pending`.
- **`kroger` (linked vs. unlinked)**: derivable from whether `kroger:refresh:<id>` exists in `KROGER_KV` — no schema change, just a read `listTenants` doesn't currently do.
- **`lastActive`**: the most recent `cooking_log`/`grocery_list`/`meal_plan` write timestamp for the tenant (already-existing columns), or the `tenant:<id>` record's last-resolved timestamp if simpler — see Open Questions.
- **`cooked`/`favorites`**: `COUNT(*)` over `cooking_log` and `overlay WHERE favorite = 1` respectively, scoped by tenant — both tables already exist and are already read per-tenant by `memberDetail`.
- **`owner`**: there is no existing "owner" concept in the tenant model (the allowlist is flat). This is a genuine new signal, not a derivation. Recommend marking the **first-onboarded tenant** (oldest `tenant:<id>` record, or an explicit operator-set flag) as owner — see Open Questions; this is the one field the apply step must make an explicit call on rather than just wiring through.

These become a `ListTenantsRow` (or similarly named) struct returned by an extended `listTenants`, replacing the bare `string[]` — `{ tenants: ListTenantsRow[] }` — read by both the SSR `/members` route (seeding `MembersIslandProps`) and the existing `GET /api/tenants` route the island already refetches after a mutation. This keeps "one source of truth per operation regardless of transport" (the panel's existing rule) — no second roster-reading code path.

**Alternative considered**: keep `listTenants` as-is (ids only) and have the island join in status/Kroger/activity via a second fetch per member. Rejected — N+1 fetches against `/admin/api/*` on every roster render, and it duplicates "what counts as active" logic between SSR and the island instead of computing it once server-side.

### 2. Member-detail sub-nav: SSR sub-routes, not client-side island state

The mock implements the Profile/Pantry/Meal plan/Grocery/Cooking log/Notes sub-nav as in-island `useState` (a single-page component swap, no URL change) and member-detail itself as an in-island `selected` swap over the roster (`MembersScreen` conditionally renders `MemberDetail` instead of navigating).

This change recommends **SSR sub-routes** instead, for both the roster→detail transition and the detail's own pills sub-nav:
- `/admin/members/<id>` for the member-detail header + default (Profile) section, and `/admin/members/<id>/<section>` for each pill (`pantry`, `meal-plan`, `grocery`, `cooking-log`, `notes`).
- Each route SSRs from `memberDetail(env, tenantId)` directly (a pure read, no island needed for the data) — matching rule 8 in `src/admin/CLAUDE.md` ("a page that only *reads* is pure SSR... no island, no client fetch").
- The pills themselves are plain links (`<a href="/admin/members/casey/pantry">`) styled as the existing `.data-nav`/pill pattern (already used by the Data area's own sub-nav, see `operator-admin`'s "Deep link to a data view" scenario), not client-routed state.

**Why this over the mock's client-state approach**: the existing `operator-admin` spec's "Admin panel is organized into top-level areas with client-side routing" requirement already establishes the precedent for this exact shape — Data, Logs, and Config all reach their drill-down/sub-view as its own **server-rendered URL** ("a deep link or refresh to a surface's URL SHALL load that surface directly"), explicitly contrasted with in-page state. The Data area's `/admin/data/recipes/<slug>` is the closest existing analog to "click a roster row, see a detail view with sub-sections" — member detail should follow the same pattern instead of introducing a one-off island-state exception. SSR sub-routes also mean a shared link to "casey's grocery list" works, and a refresh doesn't bounce the operator back to the roster (the mock's `useState`-based `selected` is lost on refresh).

The roster itself stays an island (it has real interactivity: the invite dialog, the per-row dropdown menu, optimistic refetch after mutation) — only the *navigation* from roster row → detail page, and *within* detail across its six sections, is converted from in-island state to real routes. A roster row is an `<a href="/admin/members/<id>">` styled as a clickable `Item` (kit already supports `Item` as a clickable row); the per-row `DropdownMenu`'s actions remain in-island (they're mutations, not navigation) and stop propagation so clicking the menu doesn't also navigate.

**Alternative considered**: keep the mock's client-state swap (one island owns roster + detail + sub-nav, no new routes). Rejected per the precedent above, and because it does not deep-link or survive refresh, which the rest of the panel treats as a hard requirement for every drill-down surface.

### 3. Member-detail's interactive surface is the per-section content only where genuinely interactive — otherwise pure SSR

Within a detail section, Pantry/Cooking log render via the kit's `DataTable` from `memberDetail()`'s arrays — pure SSR, no fetch. Meal plan and Grocery need the mock's custom row layout (planned-for date formatting, sides, in-cart status, source badges) — also pure SSR, computed from `memberDetail()`'s `meal_plan`/`grocery_list` at render time (date formatting is a pure function, not client state). Notes render as static note cards. None of these sections have a mutation in this change's scope (no edit-from-admin-panel), so none need an island — consistent with rule 8.

### 4. Invite dialog uses `<dialog>` + kit `Dialog`/`Field`, banner stays in island state

The invite flow (mint dialog → shown-once banner) and the per-row actions menu are the only genuine interactivity in the roster, so they stay in the existing Members island, extended (not rewritten) to use the kit's `Dialog`/`Field`/`DropdownMenu` instead of the bare `<form>`/buttons. The `Banner`/`ActionState`/`Op` discriminated unions already in `client/members.tsx` are reused as-is — they already satisfy the panel's impossible-states discipline (one union for in-flight op + target + failure, one union for the two banner variants).

## Risks / Trade-offs

- **[Risk]** The `owner` flag has no existing source of truth, and "first-onboarded = owner" is a guess that may not match the operator's mental model (e.g. the operator might not be the first tenant onboarded). → **Mitigation**: flagged as an Open Question for the apply step; the safest interim approach is to source it from a single `OWNER_TENANT_ID` env var (analogous to `ACCESS_ALLOWED_EMAILS`) rather than inferring it from KV write order, since the operator's identity is already known out-of-band (Cloudflare Access email) — apply should confirm this against how the operator's own tenant id is determined elsewhere, if at all.
- **[Risk]** Computing `lastActive`/`cooked`/`favorites` per member on every roster SSR is N additional small D1 queries (one set per member) where today `listTenants` is a single KV list. → **Mitigation**: these are indexed, tenant-scoped, small-table aggregates (`cooking_log`, `overlay`) on a friend-group-sized roster (tens of members, not thousands) — acceptable, but apply should batch them (one query with `GROUP BY tenant` across all tenants, not N per-tenant queries) rather than looping `memberDetail`-style per-row reads.
- **[Trade-off]** Converting the mock's client-state detail view into SSR sub-routes is more files/routes than the mock's single-component swap, but buys deep-linkability and refresh-safety consistent with every other drill-down area in the panel (Data, Logs, Config) — judged worth the extra route surface.
- **[Risk]** `activatedAt` (for active-vs-pending) requires a write at tenant-resolution time (`src/tenant.ts`), a hot path for every MCP tool call — must be a cheap, fire-and-forget-safe write (e.g. only written once, guarded so it doesn't re-write on every call) so it doesn't add latency or KV write volume to the MCP surface. → **Mitigation**: apply should write it only when absent (read-check-then-write, or accept "eventually consistent" if two near-simultaneous first calls race) and treat it as best-effort (a KV write failure here must not fail the tool call).

## Migration Plan

No data migration: `tenant:<id>` KV records gain an optional `activatedAt` field (absent on existing records until their tenant next resolves, meaning every existing active member appears "pending" once and self-heals on their next tool call — acceptable for a friend-group-scale roster). No D1 schema change — all aggregates read existing columns. Deploys as a normal panel change; no feature flag needed since the roster/detail routes are new surfaces and the underlying mutation routes are untouched.

## Open Questions

- Where does `owner` come from — a new env var, an explicit per-tenant KV flag the operator sets via the panel, or inferred from onboarding order? (Recommend env var; see Risks.)
- Is `lastActive` best sourced as "last per-tenant D1 write across cooking_log/grocery_list/meal_plan" or a simpler "last tool-call timestamp" written once per tenant by the MCP request path (same mechanism as `activatedAt`)? The latter is cheaper (one timestamp, one write site) and answers both `status` and `lastActive` from the same field — apply should evaluate folding these into one `lastSeenAt` field rather than two.
- Should the roster's `cooked`/`favorites` counts be exact (`COUNT(*)`) or capped/sampled for very large cooking logs? Given the friend-group scale this is likely a non-issue, but worth a sanity check against `DEFAULT_ROW_LIMIT` (`src/admin-data.ts`) conventions used elsewhere.
