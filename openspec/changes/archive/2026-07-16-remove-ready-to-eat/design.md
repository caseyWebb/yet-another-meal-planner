# Design — remove-ready-to-eat

## Context

Ready-to-eat is woven through the system as: a per-tenant D1 catalog (`ready_to_eat`, created in `migrations/d1/0004_profile.sql`, disposition columns reshaped in `0012_overlay_favorites_rejections.sql`); three MCP tools (`ready_to_eat_available` registered in `packages/worker/src/tools.ts` ~L971, `add_draft_ready_to_eat` / `update_ready_to_eat` in `packages/worker/src/write-tools.ts` ~L535/L569); a `read_user_profile` payload field and `"ready-to-eat"` missing-area key (`packages/worker/src/profile-db.ts` ~L225/L308); a `log_cooked` type value (`packages/worker/src/cooking-write.ts` ~L282); retrospective fields `cook_vs_convenience` and `ready_to_eat_favorites` (`packages/worker/src/retrospective.ts` ~L36–37, L182, L252–253); buy-time restock/discovery passes in the order-placement and in-store flows; an onboarding acceptance area; and an on-sale discovery ride-along on the `flyer_terms`-driven flyer warm. The user direction is wholesale removal — the concept leaves; a future rethink starts fresh, so nothing here designs a replacement.

Two parallel changes constrain scope: `narrow-mcp-surface` owns the broader tool cull and conditional registration; `rewrite-agent-persona` owns `AGENT_INSTRUCTIONS.md`. This change defines the contract; the persona change honors the touchpoints listed in the proposal.

## Goals / Non-Goals

**Goals:**
- Remove the three RTE tools, the profile field/missing-area, the buy-time passes, the onboarding area, and the retrospective RTE fields — contract, code, docs, and tests in lockstep.
- Keep every read deterministic and non-erroring over historical `type = 'ready_to_eat'` cooking-log rows.
- Give stale plugin bundles the repo-standard one-window landing for `log_cooked` writes.

**Non-Goals:**
- No replacement RTE design, no "convenience meal" successor concept.
- No D1 `ready_to_eat` table drop, row deletion, or backfill of historical `cooking_log.type` values.
- No `flyer_terms` data surgery.
- No persona text edits (owned by `rewrite-agent-persona`); no other tool removals (owned by `narrow-mcp-surface`).

## Decisions

### Decision: hard tool removal, no aliases or stubs

`ready_to_eat_available`, `add_draft_ready_to_eat`, and `update_ready_to_eat` are unregistered outright. The repo's shim convention exists for renamed/reshaped forms that still have a current home; a removed *concept* has none, so an alias would be a lie and an unknown-tool hint stub would keep the concept alive in the surface. A stale skill calling them mid-conversation gets the generic unknown-tool failure and the agent routes around it. **Alternative rejected:** temporary unknown-tool→hint stubs — these RTE tools are low-traffic (buy-time only), and the plugin publish rides the staged pipeline (`rewrite-agent-persona` republishes skills), so the breakage window is small and coordinated.

### Decision: `log_cooked` accepts-and-converts `type: "ready_to_eat"` for one window

Writes are different from reads: per the deprecation convention in docs/TOOLS.md, a stale agent's write must succeed and steer. For one deprecation window, `log_cooked({ type: "ready_to_eat", name, ... })` is accepted and **stored as `type: "ad_hoc"`** — `name`, `date`, `meal`, and inline `protein`/`cuisine` carry over unchanged — and the success return carries `warnings: [{ key: "type", reason: "retired", superseded_by: "ad_hoc" }]`. The route-level dedupe identity and plan-clear logic operate on the converted form (`ad_hoc` never clears plan rows, same as `ready_to_eat` never did). After the window (matching plugin published for one window), `type: "ready_to_eat"` falls through to the generic enum rejection — `validation_failed`, nothing written. Consequence worth naming: during the window a converted meal counts as a cook in cadence (`ad_hoc` counts; `ready_to_eat` did not). That is acceptable — the convenience/cooking distinction is exactly the concept being removed, and `ad_hoc` is the contract's remaining home for named non-recipe events. **Alternative rejected:** rejecting immediately (violates the write-must-succeed posture) or storing `ready_to_eat` for the window (keeps minting rows in a retired vocabulary the readers would then have to special-case forever).

### Decision: historical `ready_to_eat` rows keep their stored type; reads treat them exactly as before the change

No backfill, no re-typing. Deterministic read semantics, specified per capability:

- **Cadence / cook counts** (`retrospective.cooks_per_week`, group-insights heatmap and Cook events, spend-telemetry `meal_count`): unchanged — they count stored `type IN ('recipe','ad_hoc')`, so historical `ready_to_eat` rows remain excluded, exactly as before.
- **Mixes** (`protein_mix` / `cuisine_mix`): unchanged — non-recipe rows contribute inline dimensions; historical `ready_to_eat` rows keep contributing.
- **Removed fields**: `cook_vs_convenience` and `ready_to_eat_favorites` leave the retrospective return entirely rather than returning empty shells — a removed concept should not keep a keyed slot in the contract.
- **Never error**: no read may throw or degrade on encountering a stored `ready_to_eat` row (the member log page, insights, and retrospective all read raw types).

**Alternative rejected:** folding historical rows into `ad_hoc` for all aggregates — that would silently inflate historical cadence and heatmap figures, changing before-the-change data. "Counted as they always were" is the deterministic, history-preserving reading; spend-telemetry and group-insights math is byte-identical, which is why spend-telemetry needs no spec delta and group-insights only restates its requirement over historical rows.

### Decision: `flyer_terms` needs no migration; the RTE behavior removal is spec/docs-level

`flyer_terms(term)` is a flat operator-curated table (created empty in `migrations/d1/0006_shared_corpus.sql`, edited at `/admin/config/flyer-terms` via `packages/worker/src/admin/config-api.ts` → `corpus-db.ts`). No migration seeds RTE terms, and a term string is not machine-classifiable as "RTE" — there is nothing a shipped reconcile could deterministically converge. Any RTE-flavored terms an operator added remain valid generic scan terms feeding the flyer warm (harmless: they surface sale items the agent no longer has an RTE pass to act on). What is removed is the *behavior* — the buy-time on-sale RTE discovery pass (order-placement / in-store-fulfillment requirements) and the docs/TOOLS.md note that frames `flyer_terms` as the RTE-discovery vehicle. Operators may prune terms at their discretion through the existing admin editor; production-data-convergence rules are not triggered because no data is defective.

### Decision: profile shape drops the field; purge plumbing keeps the table clean

`read_user_profile` stops assembling `ready_to_eat` (drop the SELECT at `profile-db.ts` ~L225 and the payload field ~L308) and `missing` drops the `"ready-to-eat"` key from its fixed mapping. This is a MODIFIED return-shape requirement, not a shim: the export is a read, and the deprecation convention protects stale *writes*; a stale reader simply finds the key absent (equivalent to the documented empty-catalog case). The household purge / member-move / profile-import plumbing that clears or copies `ready_to_eat` rows per tenant (`profile-db.ts` ~L491–498) **stays** — the table remains a per-tenant table and hygiene on it remains correct — which is also why the multi-tenancy spec's non-carried-state enumeration needs no delta.

### Decision: guided onboarding loses the area as a MODIFIED main requirement plus one REMOVED requirement

The acceptance area is a clause of the "Guided first-run setup skill" requirement (plus two scenarios), so that requirement is MODIFIED; the standalone "Inventory and heat-and-eat acceptance cross-record ready-to-eat items" requirement is REMOVED with reason/migration. The onboarding `missing` mapping change rides the data-read-tools delta.

## Risks / Trade-offs

- **[Risk] Stale plugin skills reference removed tools mid-conversation** → Mitigation: `log_cooked` (the one RTE write a member actually hits in normal use) has the one-window conversion shim; the three removed tools fail as unknown tools, which the agent handles conversationally; `rewrite-agent-persona` republishes the plugin without the `add-ready-to-eat-feedback` skill and RTE flow weaves, closing the window.
- **[Risk] Window-period conversions count as cooks in cadence** → Mitigation: accepted and documented (see the shim decision); volume is tiny (RTE logging was rare) and the semantic distinction is the thing being removed.
- **[Risk] Orphaned `ready_to_eat` table drifts out of institutional memory** → Mitigation: SCHEMAS.md keeps documenting it in living-docs voice as a retained per-tenant table that no tool reads or writes (historical data held for a future rethink), and the purge path keeps it hygienic.
- **[Risk] A missed RTE reference in specs/docs/tests leaves a dangling contract** → Mitigation: tasks include a repo-wide `ready_to_eat|ready-to-eat|heat-and-eat` sweep gate over `openspec/specs/`, `docs/`, and `packages/worker/` (excluding migrations, historical archive changes, and the deliberately retained table/purge code).

## Migration Plan

1. Land the Worker changes in one PR: unregister the three tools, narrow the `log_cooked` enum with the conversion shim, drop the retrospective fields, drop the profile field/missing key. Docs and tests move in the same PR (lockstep rule).
2. No D1 migration ships. No data changes.
3. `rewrite-agent-persona` (separate change, depends on this landing) removes the persona/skill touchpoints and republishes the plugin; that publish starts the deprecation window clock for the `log_cooked` shim.
4. After one deprecation window (plugin published + window elapsed, the repo's standard condition), a small cleanup removes the `log_cooked` conversion shim, letting `type: "ready_to_eat"` fall through to the generic enum rejection. This is a follow-up tasklet, not a new change — mirror how `remove-meal-dimension-shims` was gated.
5. The future RTE rethink, if any, starts from a fresh proposal; the retained table gives it historical data to consider or drop.

## Open Questions

None.
