## 1. Shared derivation

- [x] 1.1 Add `useSidebarCounts()` to `packages/app/src/lib/data.ts`: meal-plan count over
      `planned` filtering `meal != 'project'`; grocery count over the derived to-buy view's
      line count; both sourced from persist-allowlisted reads (plan, to-buy).
- [x] 1.2 Document the reserved people badge (band 5) and the deferred checked subtraction
      (band 3 `checked_at`, D28) in the derivation's comment.

## 2. Shell integration

- [x] 2.1 Update `packages/app/src/routes/_app.tsx` to consume `useSidebarCounts()` instead
      of the inline `usePlan()`/`useGrocery()` count object; keep the NAV `count` keying.

## 3. Coverage

- [x] 3.1 Add a `navBadge(label)` helper to `packages/worker/app/visual/pages/shell.page.ts`.
- [x] 3.2 Add `packages/worker/app/visual/specs/sidebar-counts.spec.ts`: route `/api/plan`
      with a project row present and assert the plan badge omits it; route
      `/api/grocery/to-buy` with N lines and assert the grocery badge reads N.
- [x] 3.3 Run `openspec validate "sidebar-live-counts"`, app typecheck, and the new spec.

## 4. Lockstep

- [x] 4.1 Confirm no docs (TOOLS/SCHEMAS/ARCHITECTURE), Worker route, D1 schema,
      `@yamp/contract`, or satellite-version changes are required (none: client-only
      derivation over existing reads).
