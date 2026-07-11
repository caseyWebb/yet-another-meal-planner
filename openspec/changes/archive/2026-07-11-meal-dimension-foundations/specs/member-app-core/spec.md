## MODIFIED Requirements

### Requirement: Meal plan page over row-level ops

The meal plan page SHALL read the tenant's planned rows and mutate them through the existing
row-level ops keyed by the **plan-row id** (client-mintable ULID; the class (b) replay key), with
slug-addressed ops keeping their defined fan-out (remove-by-slug drops all matching rows;
set-by-slug requires a unique match or returns candidates — the `meal-planning` capability): add
(id-keyed, preserving the new-for-me watermark stamp on add exactly as the MCP tool does),
remove, schedule and **unschedule** a slot, and add and **remove** open-world sides (via the
`set` op). Slot provenance (`from_vibe`) and the row's `meal` SHALL be preserved across page
edits unless explicitly changed.

#### Scenario: Page edits preserve provenance and the watermark

- **WHEN** a member reschedules a vibe-proposed row or edits its sides from the plan page
- **THEN** the edit addresses the row by its id, the row's `from_vibe` and `meal` are unchanged,
  and when a member adds a recipe the new-for-me watermark advances exactly as an agent-side
  `update_meal_plan` add would

### Requirement: Profile page over the assembled profile

The profile page SHALL read the assembled profile (including the member's Kroger link state),
SHALL edit structured preferences via the existing merge-patch operation (dietary avoid/limit;
rotation; stores; ranked brands), SHALL edit the `taste` and `diet_principles` markdown fields,
SHALL render the derived taste read from the existing retrospective aggregation, and SHALL
obtain the Kroger consent URL from the existing builder. There is no `lunch_strategy` control —
the preference is retired (D8/D21; meal vibes subsume it); the per-meal cadence and vibes
editing surfaces are band 2's `profile-planning-and-vibes-ui` slice, the D25(2) coupling
obligation that follows this change. All whole-document writes on this page are conditional
(see the write-classes requirement).

#### Scenario: The derived taste read is the retrospective

- **WHEN** the taste tab renders its "what the agent has learned" summary
- **THEN** the cuisine/protein mixes and cadence come from the existing retrospective operation
  over the real cooking log — no new aggregation is introduced

#### Scenario: No retired-preference control renders

- **WHEN** the profile page's preferences tab renders
- **THEN** it offers no `lunch_strategy` or ready-to-eat default-action control — those
  preferences are retired, and their successors (per-meal cadence, meal vibes) land with the
  band-2 profile/vibes UI slice

### Requirement: Write endpoints are classified for the two-writer posture

Every member write endpoint SHALL be classified and implemented as exactly one of: **(a)** a
whole-document write requiring `If-Match` (preferences merge-patch, the profile markdown
fields, vibe edits) — a stale precondition returns 412 with a structured `conflict` body and
the SPA refetches, rebases, and re-presents; or **(b)** an idempotent upsert or delete keyed on
a canonical id (grocery and pantry rows by canonical ingredient id, **plan rows by the
client-minted plan-row id — slug-addressed ops keep their defined fan-out**, favorites by slug
with an explicit boolean, notes by author + slug + client-minted `created_at`, log rows by the
`(date, meal, type, recipe|name)` dedupe identity or id, proposal confirms by proposal id) —
replayable last-write-wins with **no** `If-Match`, so offline mutation replay never fails on a
stale row snapshot. The classification table in this change's design SHALL be normative;
conditional reads (`If-None-Match` → 304) and ETags come from the shared middleware with no
schema change.

#### Scenario: A lost class (a) race is surfaced, not clobbered

- **WHEN** two writers race on a class (a) document and the app's `If-Match` no longer matches
- **THEN** the write is refused with 412 and a structured `conflict` body, nothing is stored,
  and the app rebases the member's edit on the refetched document

#### Scenario: A class (b) replay never preconditions

- **WHEN** a queued class (b) mutation replays after reconnect against rows another writer has
  since touched
- **THEN** it applies as a canonical-id upsert/delete without any `If-Match`, and the final
  state is the mutation's intended state for that key

## REMOVED Requirements

### Requirement: The vibe-suggest trigger is gated by derivation job health

**Reason**: D8/D20 — the cron carries generation; the member-tappable suggest trigger is cut. The derivation producers are the scheduled pass and the agent-mediated `suggest_meal_vibes` tool (the `meal-vibe-archetype-derivation` capability).

**Migration**: Because the route and its button are live shipped code, the route does not vanish: it returns a pinned 410 retirement stub for one deprecation window (the added requirement below). Band 2's `profile-planning-and-vibes-ui` removes the button; the window-close cleanup change removes the stub, after which the path falls to the normal unknown-API 404.

## ADDED Requirements

### Requirement: The retired vibe-suggest route returns a pinned 410 stub for one deprecation window

For one deprecation window, `POST /api/vibes/suggest` SHALL remain registered and SHALL return —
pinned to the member-API route-level error convention (`c.json({ error: <literal>, message },
status)`, the `csrf_rejected`/`rate_limited` family; explicitly NOT a `src/errors.ts` `ToolError`
code) —

```ts
return c.json({ error: "gone" as const,
  message: "Vibe suggestions now arrive automatically; this trigger was retired." }, 410);
```

so the deployed SPA's shipped suggest button fails *explicably* — never the SPA-shell/404 trap —
and it SHALL invoke no derivation and no model. The stub is a docs/TOOLS.md Deprecations row; the
window-close cleanup change (`remove-meal-dimension-shims`) removes it, and the worker route tests
and the app suite's suggest coverage assert the stub while it lives.

#### Scenario: The shipped button fails explicably, without model spend

- **WHEN** a member on the deployed SPA taps the suggest button during the deprecation window
- **THEN** the route answers `410` with the structured `{ error: "gone", message }` body, runs no
  derivation, and touches no `env.AI`

#### Scenario: After the window the route falls to the normal 404

- **WHEN** the window-close cleanup removes the stub and the path is requested
- **THEN** it is answered by the standard unknown-API 404, never the SPA shell
