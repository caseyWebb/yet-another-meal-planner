## Context

The persona is split into a `core` library skill plus `cart`/`corpus` depth tiers; the plugin build prefixes every workflow skill with a prerequisite line that loads `grocery-core` **once per session** (`AGENT_INSTRUCTIONS.md` header comment). That makes `grocery-core` the one place a standing pre-check can live and reach every flow without per-flow duplication.

The `improve-onboarding` change (verified in its proposal) establishes that a brand-new member's `users/<username>/` subtree is empty until onboarding's first `commit_changes`, and that the profile read tools (`read_preferences`/`read_pantry`/`read_taste`/`read_diet_principles`) throw `not_found` for such a member — "an empty signal, not an error." Onboarding captures the **store ZIP first and unconditionally** (it gates all Kroger pricing); later areas (taste, diet, equipment, starter corpus, pantry, ready-to-eat, stockup) follow and several are skippable.

The GitHub client already exposes `listDir(path)` (Contents API, throws `GitHubError(404)` when the path is absent), and `prefixedClient` already wraps it to the caller's subtree (`src/github.ts`). So "which of this member's files exist" is answerable in a single API call against the prefixed client — no per-file fan of reads.

## Goals / Non-Goals

**Goals:**
- The agent can deterministically answer "is this member set up?" before doing real work, via a clean affirmative payload (not an error code pressed into control flow).
- A brand-new member is routed into `configure-grocery-profile` automatically on their first request, then has that request resumed.
- The check is cheap (one GitHub call), fires once per session, and is fail-open (a transient error never force-onboards an existing member).
- The same call yields a per-area `missing` snapshot onboarding can reuse for resumability.

**Non-Goals:**
- No change to the recipe-status/overlay model, the Kroger flow, or any existing read tool's contract.
- The gate does **not** treat an empty *active corpus* as "not initialized" (a set-up member may rely on discovery/import; re-onboarding them every session would be wrong). The empty-`list_recipes` case remains a contextual menu-flow nudge.
- No new GitHub App permission — `listDir` (Contents read) is already in use.
- No removal of explicit-invocation onboarding; the gate is additive to it.

## Decisions

### D1 — `profile_status` derives `{ initialized, missing }` from one subtree listing

The tool calls `listDir("")` on the **prefixed (per-tenant)** client — listing `users/<username>/` — and derives status from which files are present:

- `initialized` = `preferences.toml` is present.
- `missing` = the onboarding-area keys whose backing file is absent, mapped:
  `store→preferences.toml`, `taste→taste.md`, `diet→diet_principles.md`, `equipment→kitchen.toml`, `pantry→pantry.toml`, `ready-to-eat→ready_to_eat.toml`, `stockup→stockup.toml`, `corpus→overlay.toml`.
- A `GitHubError(404)` on the listing = the subtree doesn't exist yet (brand-new member) → `{ initialized: false, missing: <all areas> }`.
- Any other GitHub failure propagates as a structured `upstream_unavailable` (the standard `runTool` mapping), so the agent's fail-open branch (D2) handles it.

The derivation is a pure function `deriveProfileStatus(entries: DirEntry[] | null)` (null = 404), unit-testable without the network. The tool takes no parameters, is read-only, and uses the per-tenant client (never another tenant's subtree).

- **Alternative — reuse `read_preferences`'s `not_found`:** rejected. It overloads an *error result* as control flow: the agent must distinguish `not_found` (brand-new) from `upstream_unavailable` (transient), and one misread force-onboards an existing member. It also returns the whole preferences blob to answer a yes/no, and sees only one file. `profile_status` returns a clean success payload, fails open by construction, and yields `missing` for free.
- **Alternative — a fan of per-area `read_*` calls:** rejected. ~8 reads where one `listDir` suffices; the dir listing gives file presence, which is exactly what both consumers need.

### D2 — The gate lives in `grocery-core`, fires once per session, fails open, with two carve-outs

`grocery-core` gains a standing instruction: before the first substantive action in a session, call `profile_status`; if `initialized` is false, don't fulfill the request yet — run `configure-grocery-profile` (it may use `missing` to skip already-done areas), then resume the original request. If the call errors, proceed normally.

Carve-outs (the gate is skipped when):
- the active flow **is** `configure-grocery-profile` — otherwise the gate would re-trigger onboarding from inside onboarding;
- the active flow is `report-grocery-agent-bug` — a brand-new member must be able to report a bug without being forced through setup first.

- **Why `grocery-core` and not the depth tiers:** the two cold-start blockers map to `cart` (store) and `corpus` (active recipes), which suggests scattering the gate across those tiers. Rejected: it would need the *same* carve-out logic in two places and still couldn't gate flows that load neither tier. One gate in the universally-loaded core, with one carve-out clause, is simpler to keep correct.
- **Why fail-open:** the safe default is "proceed." Only an explicit `initialized: false` gates; any uncertainty (tool error) lets the request through. This makes a GitHub blip a no-op, not a wrongful re-onboard.

### D3 — Predicate is `preferences.toml` presence, not active-corpus count

Store capture is the first, unconditional onboarding area, so `preferences.toml` existing reliably means the member got past setup. Keying `initialized` on it avoids a false-negative for a member who finished onboarding but has a deliberately sparse active corpus (discovery/import path) — that member would otherwise be force-onboarded on every session. The empty-active-corpus situation is real but belongs to the menu flow's contextual handling, not the initialization gate.

## Risks / Trade-offs

- **The gate is a soft prompt instruction the agent could skip** → it rides `grocery-core` (loaded by every workflow), is phrased as a standing pre-check, and is fail-open, so a miss degrades to today's status-quo (a confusing empty result), never to a regression.
- **`listDir` reflects file presence, not content** (e.g. a `preferences.toml` that exists but lacks `[stores]`) → acceptable: presence of the unconditional-first file is the intended "got past step one" signal; richer per-area content validation stays onboarding's job.
- **A new permanent tool is contract surface** (the repo forbids tool/doc drift) → kept tight: read-only, `{ initialized, missing }` only, one call, no params; justified by a second consumer (onboarding resumability) beyond the gate.
- **Partial-onboard edge** (member set the ZIP, then bailed before corpus) → `initialized` is true (they can function) and `missing` still reports the gaps; the menu flow's empty-list handling covers the corpus gap. Acceptable, not silently wrong.

## Migration Plan

Additive only — a new read tool plus persona text. Deploy the Worker (`src/`), then `npm run build:plugin` to regenerate the connector bundle. No data migration, no permission grant. Rollback is reverting the tool registration and the `grocery-core` paragraph; nothing persists state.

## Open Questions

- None blocking. (Resolved during exploration: status tool over `read_preferences` reuse — D1; `preferences.toml` over active-corpus predicate — D3; `grocery-core` over depth tiers — D2.)
