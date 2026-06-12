## Why

A freshly-invited member whose `users/<username>/` subtree is still empty has a **non-functional agent** (the two cold-start blockers the `improve-onboarding` change documents: an empty overlay makes `list_recipes()` return `[]`, and a missing store ZIP makes `kroger_prices`/`place_order` throw). Onboarding *can* fix all of this — but only if it actually runs. Today the routing is soft: the `configure-grocery-profile` skill triggers "when the read tools show an empty profile," which depends on the agent *noticing* emptiness mid-flow. When it doesn't, the member gets a confusing empty menu or a hard Kroger error instead of being walked through setup.

There is no deterministic, server-backed way for the agent to ask "is this member set up?" before doing real work. The closest signal — `read_preferences` throwing `not_found` — is an **error result pressed into service as control flow**: the agent has to distinguish `not_found` (brand-new member) from `upstream_unavailable` (a transient GitHub blip), and a single misread force-onboards an *existing* member. We want a clean, affirmative status the agent can gate on, cheaply, once per session.

## What Changes

- **A new `profile_status` read tool** (per-tenant) returns `{ initialized: boolean, missing: string[] }` in **one** GitHub call by listing the caller's subtree. `initialized` is true once `preferences.toml` exists — the unconditional first onboarding area, so its presence reliably means "got past setup," with no false-negative for a member who legitimately has a sparse active corpus. `missing` enumerates the onboarding areas whose backing file is absent, so it doubles as the resumability snapshot onboarding already wants.
- **A standing initialization gate in `grocery-core`** (the persona tier every workflow loads once per session). Before the first substantive action, the agent calls `profile_status`; if `initialized` is false it runs `configure-grocery-profile` and then resumes the original request. The gate is **fail-open** — if the call errors, the agent proceeds normally (a transient failure must never masquerade as "brand new"). It carves out the two flows that must not be gated: `configure-grocery-profile` itself (no self-loop) and `report-grocery-agent-bug` (a new member must be able to report a bug).
- **Docs**: a `profile_status` entry in `docs/TOOLS.md`; the plugin bundle is regenerated from the edited `AGENT_INSTRUCTIONS.md`.

Explicitly **out of scope**: the gate does not treat an empty *active corpus* as "not initialized" — a member can be set up yet rely on discovery/import for recipes, and re-onboarding them every session would be wrong. The empty-`list_recipes` case stays a contextual nudge inside the menu flow.

## Capabilities

### New Capabilities
<!-- none — this change extends existing capabilities -->

### Modified Capabilities
- `data-read-tools`: adds the per-tenant `profile_status` read tool, which derives `{ initialized, missing }` from a single listing of the caller's `users/<username>/` subtree.
- `guided-onboarding`: hardens the "onboarding triggers on an empty profile" requirement from soft observation into a deterministic, fail-open `profile_status` gate in `grocery-core`, with carve-outs for the onboarding and bug-report flows.

## Impact

- **Worker (`src/`)** — one new read tool: a pure `deriveProfileStatus(entries)` helper plus a thin `profile_status` registration in `src/tools.ts` using the **prefixed (per-tenant)** GitHub client; reuses the existing `listDir` method (a 404 on the subtree = brand-new member). No new GitHub App permission (`listDir`/Contents read is already used).
- **`AGENT_INSTRUCTIONS.md`** — the `grocery-core` persona tier gains the gate paragraph; `npm run build:plugin` regenerates `plugin/grocery-agent/`.
- **`docs/TOOLS.md`** — a `profile_status` entry (params/returns), kept in sync with the implementation.
- **No data-model, migration, or Kroger/cart impact** — additive read tool plus prompt text; the cold-start mechanisms it routes around already exist.
