## Context

`packages/app/src/lib/propose.ts` owns the member-app propose session shape,
localStorage helpers, request serialization, `usePropose`, and date packing. The MCP
widget in `packages/widgets/src/ProposeCard.tsx` repeats the same session shape,
request serialization, initial request hydration, and slot-to-`ProposeSlotView` mapper.
Story 06 identifies this as the first dual-use widget seam to unify before the page-04
redesign.

The two hosts are not identical. The member app uses TanStack Query, `/api/propose`, and
class (b) plan-op commits. The MCP widget uses ext-apps `App.callServerTool`, host
capability degradation, and currently delegates commit through `sendMessage`. This
change unifies only the pure orchestration that is genuinely shared.

## Goals / Non-Goals

**Goals:**

- Provide one exported implementation for the propose session data model, canonical
  request serialization, initial widget request hydration, and slot-view projection.
- Keep both current hosts behavior-compatible while replacing local duplicate copies.
- Add tests around the pure shared helpers so app/widget drift is caught before the
  later `plan-your-week-widget` redesign.
- Leave the current `nights`-based surface intact; the later widget redesign will move
  visible controls to the D8/D20 per-meal set.

**Non-Goals:**

- No D18 writing-widget work: commit continues using the current widget delegation path.
- No D19 payload versioning or `@yamp/contract` shape change.
- No per-meal steppers, attendance UI, side editing redesign, or control removals.
- No Worker API, MCP tool, D1 schema, current-state docs, or generated plugin changes.

## Decisions

1. Put the pure shared orchestration in `@yamp/ui`.

   Both the member app and widgets already depend on `@yamp/ui` and the helper maps to
   `ProposeSlotView`, which is a UI package type. Keeping it in `@yamp/ui` avoids a new
   package or dependency edge and avoids touching `@yamp/contract`, so the satellite
   version gate is not involved.

2. Keep host adapters thin and explicit instead of introducing a generic runtime adapter
   abstraction in this change.

   The duplicated code is pure transformation logic. The host behaviors that differ
   today are meaningful product boundaries: app persistence/querying versus MCP bridge
   capability/degradation. A generic adapter layer would mainly pre-build the later D18
   work and make this refactor harder to review.

3. Preserve the existing legacy request surface exactly.

   The shared `buildProposeRequest` keeps `nights`, `nudges`, `exclude`, and sorted
   `slots[]` serialization as-is. The later `plan-your-week-widget` change owns the
   per-meal request/control transition and associated spec deltas.

4. Cover the shared helpers with pure unit tests.

   The most important regression surface is silent divergence between app and widget
   request bodies or view labels/flags. Tests should exercise sorted slots, lock versus
   override precedence, trimmed freeform/protein sorting, widget request hydration, and
   slot-view flag/label mapping.

## Risks / Trade-offs

- Shared code in `@yamp/ui` could accidentally pull React-only or browser-only APIs into
  pure helper tests → keep the new module free of React, localStorage, TanStack Query,
  and ext-apps imports.
- Type differences between app API responses and widget `ProposeCardData` slots could
  be papered over too broadly → define the mapper against the minimal structural slot
  shape it needs, while preserving existing host-specific response types at call sites.
- Behavior-preserving refactors can hide small output drift → add focused tests and run
  typecheck plus app/widget tests that cover the propose surfaces.

## Migration Plan

1. Add the shared helper module and exports from `@yamp/ui`.
2. Replace the member-app helper definitions with imports while leaving query,
   localStorage, and date packing local.
3. Replace the widget helper definitions with imports while leaving bridge calls,
   capability checks, race handling, and commit delegation local.
4. Run focused tests and typecheck. Rollback is a straight import reversal because no
   data or contract shape changes ship.

## Open Questions

None.
