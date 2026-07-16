# Remove the ready-to-eat surface

## Why

The ready-to-eat infrastructure — a personal catalog, three MCP tools, buy-time restock/discovery passes, and a weave through onboarding, pantry, shopping, and retrospective flows — never earned its complexity and needs to be rethought from scratch ("ready to eat infra can probably be ripped entirely, it needs to be rethought"). This change removes the surface and behavior wholesale so a future rethink starts fresh; the D1 `ready_to_eat` table and historical cooking-log rows stay in place untouched.

## What Changes

- **BREAKING** The three RTE tools are removed outright — `ready_to_eat_available`, `add_draft_ready_to_eat`, `update_ready_to_eat`. Hard removal, no aliases, no unknown-tool stubs: the whole concept leaves the surface.
- **BREAKING** `read_user_profile` drops the `ready_to_eat` field from its payload, and `profile_status` / `read_user_profile` drop the `"ready-to-eat"` area from the `missing` onboarding-gap mapping (return-shape change).
- **BREAKING** `log_cooked` retires `type: "ready_to_eat"` from its input contract. Per the repo's deprecation convention (docs/TOOLS.md), for one deprecation window a stale plugin's `type: "ready_to_eat"` write is **accepted and converted** to `type: "ad_hoc"` (the `name` and inline dimensions carry over; the success return carries a `warnings` entry); after the window it is rejected as `validation_failed` like any unknown type.
- `retrospective` drops `cook_vs_convenience` and `ready_to_eat_favorites` from its return. Cadence math is unchanged: `cooks_per_week` keeps counting only stored `recipe` + `ad_hoc` rows, so historical `ready_to_eat` rows stay excluded exactly as before the change.
- Historical `cooking_log` rows with `type = 'ready_to_eat'` keep their stored type. Every read (retrospective, group insights, spend telemetry, member log page) treats them as before-the-change data — they contribute inline protein/cuisine dimensions to mixes, never count as cooks, and never error.
- The buy-time RTE passes are removed from the order-placement and in-store-fulfillment flows (restock-of-favorites and on-sale flyer discovery), and the on-sale RTE discovery ride-along on the `flyer_terms`-driven flyer warm goes with them. `flyer_terms` itself is untouched — it is operator-curated admin config (no migration seeds RTE terms), and its rows remain valid generic scan terms; no data change ships.
- Guided onboarding loses the ready-to-eat (heat-and-eat) acceptance area and the inventory↔catalog cross-recording behavior.
- **Explicitly not changing:** the D1 `ready_to_eat` table and its rows stay in place, orphaned, pending the future rethink — no drop migration, no data surgery. The household purge/move plumbing that clears `ready_to_eat` rows per-tenant keeps doing so.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `data-read-tools` — `read_user_profile` / `profile_status` return shapes lose the `ready_to_eat` field and the `"ready-to-eat"` missing-area key.
- `data-write-tools` — RTE tools removed from the granular-write surface; `log_cooked` type contract narrows with the one-window conversion shim; profile-write routing loses the RTE tools/table.
- `data-validation` — cooking-log `type` vocabulary narrows; the RTE catalog structural-validation requirement is removed.
- `cooking-history` — log type contract, `log_cooked` shim, retrospective return shape, historical-row semantics; the RTE acquisition cross-recording requirement is removed.
- `guided-onboarding` — the ready-to-eat acceptance area and the inventory cross-recording requirement are removed.
- `kroger-integration` — the `ready_to_eat_available` tool requirement is removed.
- `menu-generation` — the context pre-pass, proposal assembly, and conversational-disposition requirements lose their RTE clauses.
- `order-placement` — the ready-to-eat buy-time adds requirement is removed.
- `in-store-fulfillment` — the ready-to-eat pre-grouping adds requirement is removed.
- `group-insights` — the cook-event type-counting requirement is restated over historical rows (behavior unchanged).

## Impact

- **Worker code:** `packages/worker/src/tools.ts` (`ready_to_eat_available` registration, `read_user_profile`/`profile_status` descriptions + `missing` mapping, `kroger_login_url` description), `packages/worker/src/write-tools.ts` (`add_draft_ready_to_eat` ~L535, `update_ready_to_eat` ~L569, RTE helpers), `packages/worker/src/profile-db.ts` (profile assembly drops `ready_to_eat`; the purge/import row-clearing plumbing stays), `packages/worker/src/cooking-write.ts` (`log_cooked` type enum + conversion shim), `packages/worker/src/retrospective.ts` (drop `cook_vs_convenience` / `ready_to_eat_favorites`), `packages/worker/src/cooking-tools.ts` (retrospective description).
- **Docs lockstep:** `docs/TOOLS.md` (three tool sections removed, `log_cooked` contract + shim table row, `read_user_profile` export shape, retrospective shape, the RTE flyer_terms note near the discovery tools, `kroger_login_url` mention); `docs/SCHEMAS.md` (profile export shape; the `ready_to_eat` table documented as retained but no longer read or written by any tool); `docs/ARCHITECTURE.md` only where it mentions RTE.
- **Tests:** `aubr test` — log_cooked conversion-shim tests, `read_user_profile` shape tests, retrospective historical-row tests (`packages/worker/test/retrospective.test.ts`, `cooking-tools.test.ts` currently assert the removed fields).
- **D1:** no migration. The `ready_to_eat` table stays; `flyer_terms` is admin-curated config with no RTE seed rows to converge.
- **Persona dependencies (owned by `rewrite-agent-persona`, listed here as touchpoints that change must honor):** onboarding step 8 (heat-and-eat acceptance), the update-pantry flow ("Heat-and-eat items count twice"), the shop-groceries flow ("One ready-to-eat offer, here for every branch"), the cooked flow's RTE logging, the `add-ready-to-eat-feedback` skill, and retrospective narration (cook-vs-convenience split, "ready-to-eat favorites") in `packages/worker/AGENT_INSTRUCTIONS.md`.
- **Out of scope:** the broader tool cull (`narrow-mcp-surface`), the persona text rewrite (`rewrite-agent-persona`), any future RTE replacement design, and dropping the `ready_to_eat` table.
