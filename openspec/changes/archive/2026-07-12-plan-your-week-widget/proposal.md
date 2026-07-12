## Why

The propose surface is duplicated: the member "Plan your week" page and the in-chat meal-plan
widget each carry their own copy of the propose state machine (per-slot reducers, iteration loop,
commit assembly). The prior lift (#258) moved only the PURE helpers (request serialization, slot
view projection) into `@yamp/ui`; the controller stayed forked. Meanwhile the widget is still a
NON-writing card — its "commit" delegates a natural-language message to the model, which then has
to call `update_meal_plan`, so the write is routed through the frontier model (a D18 violation)
and the model never sees the widget's live state (a D4 state-divergence bug).

This is the first **dual-use writing widget** — the highest-risk conversion in the band. It lifts
the full controller into `@yamp/ui`, thins both hosts to adapters, and switches the widget to a
real D18 write with three-channel model-context discipline. It also lands the D8/D20 control cuts
on the shared component and versions the widget payloads (D19).

## What Changes

- **Full controller lift** into `@yamp/ui` (`useProposeController` + a `ProposeHostAdapter`
  interface). The per-slot reducers (swap, facet pins, per-slot vibe, sides editing), the per-meal
  steppers, the iterate/sync/commit channel discipline, and the slot→view derivation live once;
  the member route and the widget are thin adapters. No state machine remains duplicated.
- **D8/D20 control cuts on the shared surface**: adventurousness slider, protein-want chips,
  freeform phrase, global re-roll, and per-slot lock + exclude are removed from BOTH hosts (the
  session still CARRIES those fields for round-trip fidelity of an agent-authored request; the
  `propose_meal_plan`/`display_meal_plan` tool params are unchanged). The retained shared set is
  per-meal steppers, swap menu, facet chips, per-slot vibe override, sides editing, summary, commit.
- **Per-meal steppers** replace the single nights stepper — the request's `meals` map.
- **Sides editing** (D20): a per-slot side override that refines the already-proposed week WITHOUT
  a re-query, surfaced to the host model via context (the inverse of the D4 bug — decision 1).
- **Attendance is plumbing/round-trip only** (D29-final, D20): the session carries `attendance` and
  replays it, but the shared surface has NO attendance control — the web control is deferred behind
  a Claude Design pass (D29-final does not authorize originating it here, and it is absent from
  D20's enumerated shared control set).
- **The widget performs the write (D18)**: `ProposeCard.commit()` drops sendMessage-delegation for
  the client-side commit sequence `read_meal_plan` → pack open dates → `update_meal_plan` (per-slot
  D26 ops with edited sides + `from_vibe`) → re-read → `ui/update-model-context` (committed
  snapshot) → `ui/message` (commit provenance). No new tool. Iteration fires
  `callServerTool` + `ui/update-model-context`; a sides edit fires `ui/update-model-context` only.
- **Capability ladder + contract-version gate**: `serverTools` → the write; message-only → the
  sendMessage delegation as the explicit fallback; neither → read-only. A payload whose
  `contract_version` exceeds the widget's known version renders read-only (degrade, don't crash).
- **`contract_version` on the widget payloads (D19)**: `ProposeCardData` and `RecipeCardData` gain
  `contract_version?: number` (versioned independently, start at 1); the Worker stamps it. Any
  `packages/contract/**` change bumps the satellite version gate (`0.1.15` → `0.1.16`).

## Capabilities

### Modified Capabilities

- `shared-propose-orchestration`: adds the shared controller + `ProposeHostAdapter` + capability
  resolver (the full lift beyond the pure helpers); the degradation ladder becomes shared pure
  logic parameterized by host-supplied capability inputs.
- `member-app-propose`: the live-iteration requirement is rewritten to the query-not-write model
  with the D8/D20-cut control set, per-meal steppers, and sides editing; attendance noted as a
  round-trip-only request field. Playwright coverage reshaped to assert the cuts are absent and the
  retained controls (per-meal / swap / facet / vibe / sides / commit) work.
- `meal-plan-widget`: the widget commits the chosen week itself via the D18 write sequence; the
  three-channel discipline and the `contract_version` read-only gate + degradation ladder are added.

### Verify-only (no delta)

- `member-app-core`: confirmed already reconciled by profile-planning — the `merge_recipes` cut is a
  negative guarantee and the retired vibe-suggest 410 stub is present. Nothing regressed.
