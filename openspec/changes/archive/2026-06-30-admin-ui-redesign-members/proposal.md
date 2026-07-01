## Why

The Members area is still the original thin SSR table plus a bare onboard/rotate/revoke form — it predates the Basecoat kit and the redesign's roster/detail patterns already shipped elsewhere in the panel. Operators managing a friend group need an at-a-glance roster (who's active, who's pending, who's linked to Kroger) and a way to drill into one member's pantry, meal plan, grocery list, cooking log, and notes without leaving the admin panel — today there is no member-detail view at all, only the flat member-id list.

## What Changes

- Add a Members summary stat-tile row (Members / Active / Pending / Kroger linked) above the roster, composed from the kit's `StatCardGrid`/`StatCard`.
- Replace the bare `<table>` member list with a roster of kit `Item`/`ItemGroup` rows: an `Avatar` (initials), `@username`, owner/active/pending `Badge`s, a Kroger-linked badge, an activity meta line, and a per-row `DropdownMenu` (Rotate invite / Link Kroger / Revoke) — reusing the existing onboard/rotate/kroger-login/revoke routes unchanged.
- Replace the inline onboard `<form>` with a `Dialog`-based invite flow (mint an invite for a new username) and a shown-once banner for the resulting invite code + connector URL, or the single-use Kroger consent link variant — same underlying routes, redesigned presentation.
- Add a member-detail surface reached by clicking a roster row: a header (`@user` + badges + activity stats) and a pills sub-nav over Profile / Pantry / Meal plan / Grocery / Cooking log / Notes, each rendering from `memberDetail()` (`PrettyKV` for profile, `DataTable` for pantry/cooking-log, custom rows for meal plan + grocery, note cards for notes), with a not-yet-connected empty state for a pending member.
- Extend `listTenants`/the tenant directory read to return the roster fields the redesign needs (owner flag, active/pending status, Kroger-linked status, joined/last-active timestamps, cooked/favorites counts) instead of a bare `string[]` — see `design.md` for the precise shape and storage approach.
- Add the typed route(s) and `MembersIslandProps` fields needed to seed the roster + member-detail island with this richer data, and a route (or extension of `memberDetail`) the island calls to fetch one member's detail view.

No change to the onboard/rotate/revoke/kroger-consent **operations** themselves (`src/admin.ts`) — only to what the Members surface reads and how it presents both the roster and the operations.

## Capabilities

### New Capabilities

(none — this extends the existing `operator-admin` capability)

### Modified Capabilities

- `operator-admin`: adds member-roster presentation requirements (summary stat tiles, the `Item`/`ItemGroup` roster with per-member actions, the dialog-based invite flow) and a new member-detail sub-nav requirement, as **ADDED** requirements alongside the unchanged onboard/rotate/revoke/listing/kroger-consent requirements. The existing "Tenant listing is operational-only" requirement is **MODIFIED** only to the extent the listing's returned fields grow (still operational metadata, no domain data) to support the roster's status/activity badges.

## Impact

- `src/admin/pages/members.tsx`, `src/admin/client/members.tsx` — redesigned SSR page + island.
- `src/admin/shared.ts` — `MembersIslandProps` grows; a new island-props shape for member detail.
- `src/admin/app.tsx` — `/members` SSR route gains roster fields; a new SSR (or island-fetched) route for member detail.
- `src/admin.ts` — `listTenants` (and/or the tenant directory in `src/tenant.ts`) extended to surface status/activity fields; no change to onboard/rotate/revoke/kroger-consent logic.
- `src/admin-data.ts` — `memberDetail()` is reused as-is for the detail sub-nav's data; any new fields it needs (see data-gap analysis in `design.md`) are additive.
- `src/admin/ui/kit.tsx` — no new primitives expected (Item/ItemGroup/Avatar/StatCard/DropdownMenu/Dialog/Field/DataTable already exist); composition only.
