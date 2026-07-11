## Why

The app shell's sidebar badges are computed inline in the shell frame from a different
read than the pages they mirror, so they can silently disagree with the page. Two defects
follow from band 1's meal dimension and the derived to-buy view:

- The meal-plan badge counts every planned row, so project rows (`meal: 'project'`, added
  in band 1) now inflate it — it should count schedulable meals only (D26).
- The grocery badge filters the raw stored list by `status`, not the derived to-buy view
  the grocery page renders, so a plan-derived need the page shows is never counted (D28).

Band 2's redesigns lean on the sidebar reading true, so the counts are lifted into one
shared derivation.

## What Changes

- Define the sidebar badge counts once, in a shared `useSidebarCounts()` derivation the
  shell consumes: the meal-plan badge counts meal rows only (`meal != 'project'`); the
  grocery badge is the derived to-buy line count — the same read the grocery page renders,
  with in-flight rows (`in_cart`/`ordered`) already excluded by the derivation.
- Reserve the people badge (pending inbound requests) for band 5 with the People
  destination — the mock's friend-count badge is a listed bug (D5), not implemented here.
- Checked-row subtraction from the grocery badge activates with band 3's `checked_at`
  (D28); the derivation is written so it drops in without another badge rework.
- Both source reads are on the offline persist allowlist, so the badges keep rendering
  from the persisted cache offline.

## Capabilities

### Modified Capabilities

- `member-app-core`: pins the sidebar badge counts to one shared derivation with the
  project-exclusion and derived-to-buy semantics.
- `member-app-offline`: records that the badge derivation reads only allowlisted persisted
  queries, so the badges render offline.

## Impact

- Affected code: `packages/app/src/lib/data.ts` (the shared `useSidebarCounts()`
  derivation), `packages/app/src/routes/_app.tsx` (the shell consumes it).
- Affected tests: `packages/worker/app/visual/` — a sidebar-counts spec plus a shell
  page-object badge helper.
- No Worker route, MCP tool, D1 schema, docs contract, or `@yamp/contract` payload shape
  changes: this is a client-side count derivation over reads that already exist.
