# Tasks — remove-ready-to-eat

## 1. Tool removals (Worker)

- [x] 1.1 Unregister `ready_to_eat_available` in `packages/worker/src/tools.ts` (~L971) and delete its handler + any Kroger-side helpers used only by it; remove the `ready_to_eat_available` mention from the `kroger_login_url` tool description (~L757).
- [x] 1.2 Unregister `add_draft_ready_to_eat` (~L535) and `update_ready_to_eat` (~L569) in `packages/worker/src/write-tools.ts`; delete the RTE item-shape helpers (the mutable-fields comment block ~L70, the items() catalog helper ~L117) and any now-dead imports.
- [x] 1.3 Grep `packages/worker/src/` for remaining `ready_to_eat` references and remove each that is tool-surface or read-path code. Keep: the D1 table itself, the household purge/move/import plumbing that clears or relocates `ready_to_eat` rows (`packages/worker/src/profile-db.ts` ~L491–498), the retired `ready_to_eat_default_action` accept-and-drop shim (owned by `remove-meal-dimension-shims`), and historical migrations.

## 2. read_user_profile / profile_status shape

- [x] 2.1 In `packages/worker/src/profile-db.ts`: drop the `ready_to_eat` SELECT (~L225) and the `ready_to_eat` field from the assembled payload (~L308) and its type (~L73).
- [x] 2.2 Remove the `"ready-to-eat"` key from the `missing` onboarding-area mapping (the `profile_status` / `read_user_profile` assembly) and from the `read_user_profile` tool description in `packages/worker/src/tools.ts` (~L842, and the missing-keys comment ~L945).

## 3. log_cooked contract + conversion shim

- [x] 3.1 In `packages/worker/src/cooking-write.ts`: narrow the schema so the documented contract is `type ∈ { recipe, ad_hoc }`; add the one-window shim — an incoming `type: "ready_to_eat"` is accepted and converted to `type: "ad_hoc"` (name/date/meal/inline dims carried; dedupe identity and plan-clear computed over the converted form) with `warnings: [{ key: "type", reason: "retired", superseded_by: "ad_hoc" }]` on the success return.
- [x] 3.2 Update the `log_cooked` tool description (drop `ready_to_eat` from the type list and the RTE-consumption guidance sentence).
- [x] 3.3 Confirm no new `type='ready_to_eat'` row can be written by any path (member `/api/log` route included — `packages/worker/src/api/log.ts`).

## 4. Retrospective + reads over historical rows

- [x] 4.1 In `packages/worker/src/retrospective.ts`: remove `cook_vs_convenience` and `ready_to_eat_favorites` from the result type and assembly (~L36–37, ~L182, ~L252–253); cadence and mix math unchanged (historical `ready_to_eat` rows: excluded from `cooks_per_week`, inline dims still feed the mixes, never error).
- [x] 4.2 Update the `retrospective` tool description in `packages/worker/src/cooking-tools.ts` (~L251) to drop both removed fields.
- [x] 4.3 Verify the member log page read, group insights (`packages/worker/src/insights.ts`), and spend telemetry need no code change (they already key on stored type and exclude `ready_to_eat`); adjust comments that describe RTE as a live type.

## 5. Docs lockstep

- [x] 5.1 `docs/TOOLS.md`: delete the `ready_to_eat_available`, `add_draft_ready_to_eat`, and `update_ready_to_eat` sections; update `log_cooked` (type list, `name` requirement wording, RTE-consumption note) and add the conversion shim row to the deprecation-convention Active-shims table with its removal condition; update the `read_user_profile` export shape (drop `ready_to_eat` field and the `ready-to-eat` missing key) and the retrospective return shape (drop `cook_vs_convenience` / `ready_to_eat_favorites`); remove the RTE flyer_terms discovery note (~L882) and the `ready_to_eat_available` mention in `kroger_login_url` (~L836). (The flyer_terms discovery note no longer exists in the file `narrow-mcp-surface` rewrote — `docs/TOOLS.md` has no `flyer_terms` mention at all; nothing to remove there.)
- [x] 5.2 `docs/SCHEMAS.md`: update the profile export shape; describe the `ready_to_eat` D1 table in living-docs voice as a retained per-tenant table that no tool reads or writes (historical rows held pending a future rethink; household purge/move still clears/relocates its rows).
- [x] 5.3 `docs/ARCHITECTURE.md`: remove any ready-to-eat mentions (grep; update only if present).

## 6. Tests

- [x] 6.1 `packages/worker/test/retrospective.test.ts`: replace the `cook_vs_convenience` / `ready_to_eat_favorites` assertions with absence assertions; add a historical-row fixture test — a log containing stored `type='ready_to_eat'` rows aggregates without error, excludes them from cadence, and counts their inline dims in the mixes.
- [x] 6.2 `packages/worker/test/cooking-tools.test.ts` (~L165): update the retrospective description assertion.
- [x] 6.3 log_cooked shim tests: `type: "ready_to_eat"` stores an `ad_hoc` row with the name carried and returns the `warnings` conversion entry; replay dedupes on the converted identity; `type: "snack"` still `validation_failed`.
- [x] 6.4 Profile shape tests: `read_user_profile` payload has no `ready_to_eat` key (even with rows present in the table); `missing` never contains `ready-to-eat`.
- [x] 6.5 Tool-surface tests: `ready_to_eat_available` / `add_draft_ready_to_eat` / `update_ready_to_eat` are not registered.
- [x] 6.6 `aubr typecheck` and `aubr test` green.

## 7. Sweep + verification

- [x] 7.1 Repo-wide `rg -i "ready.to.eat|ready_to_eat|heat.and.eat"` over `packages/worker/src/`, `docs/`, and `openspec/specs/` (after archive) — remaining hits limited to the retained table/purge code, historical migrations, the retired-preference shim owned by `remove-meal-dimension-shims`, `openspec/changes/archive/`, and `packages/worker/AGENT_INSTRUCTIONS.md` (owned by `rewrite-agent-persona`).
- [x] 7.2 No D1 migration in this change — confirm nothing under `packages/worker/migrations/d1/` was added; the `ready_to_eat` and `flyer_terms` tables are untouched.
- [x] 7.3 Hand off the persona touchpoint list (proposal Impact section) to `rewrite-agent-persona`; note the plugin publish there starts the `log_cooked` shim's deprecation-window clock. (The list already lives in this change's ratified `proposal.md` Impact section — no additional artifact needed.)
