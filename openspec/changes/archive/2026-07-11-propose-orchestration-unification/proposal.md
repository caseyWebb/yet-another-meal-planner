## Why

The member app and MCP Meal Planning widget currently carry duplicate propose-session
orchestration for session state, request serialization, and slot view projection. Band 2
needs the Plan-your-week redesign to build on one shared implementation, so this refactor
lands first as the behavior-preserving gate called out by D25.

## What Changes

- Lift the shared propose session model, default/session initialization helpers, canonical
  request builder, and slot-to-view mapper into a shared package consumed by both
  `packages/app` and `packages/widgets`.
- Keep host-specific plumbing in the hosts: TanStack Query, localStorage, class (b)
  commit behavior, and `/api/propose` stay in the member app; ext-apps bridge calls,
  capability checks, and `sendMessage` commit delegation stay in the widget until
  `plan-your-week-widget`.
- Preserve current behavior, including the legacy `nights` request shape, current widget
  control set, read-only degradation rules, and sendMessage-based commit.
- Add focused tests or type coverage around request serialization and view projection so
  the two hosts cannot drift again.
- Do not introduce the later D18/D19 writing-widget changes, contract-version retrofit,
  attendance UI, per-meal steppers, or D8/D20 control cuts.

## Capabilities

### New Capabilities

- `shared-propose-orchestration`: Internal shared orchestration for dual-use propose
  surfaces, covering behavior-preserving request serialization and view mapping.

### Modified Capabilities

- None. This change is an implementation refactor only; OpenSpec behavioral
  requirements remain unchanged.

## Impact

- Affected code: `packages/app/src/lib/propose.ts`,
  `packages/app/src/routes/_app.propose.tsx`, `packages/widgets/src/ProposeCard.tsx`,
  and the shared package surface that exports the common propose orchestration.
- Affected tests: existing app/widget typechecks plus focused unit coverage for the
  shared request/view helpers.
- No Worker route, MCP tool, D1 schema, docs contract, or `@yamp/contract` payload shape
  changes are expected.
