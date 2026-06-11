## Why

The agent's operating instructions ship today as a 261-line `AGENT_INSTRUCTIONS.md` that each member **manually pastes** into a Claude.ai Project, then separately adds the connector and OAuths. Two problems: the whole doc loads every turn regardless of what the user is doing, and updates require everyone to re-copy the doc by hand — a process with an effective compliance rate of zero. Plugins install and run in claude.ai web chat + Desktop Chat (verified: bundled skills + connectors work across surfaces; only hooks/sub-agents are Cowork-only, which this agent uses neither of), so we can package the agent as one installable, versioned, auto-updating unit instead.

## What Changes

- **Decompose `AGENT_INSTRUCTIONS.md` into skills.** Each conversational flow (menu request, pantry update, cook mode, recipe feedback/disposition, recipe notes, ready-to-eat feedback, recipe import, inventory hypothetical, sale check, retrospective, order placement) becomes its own narrowly-triggered skill whose body only loads when relevant. `AGENT_INSTRUCTIONS.md` **remains the canonical source** — skills are generated from it, not hand-maintained in parallel.
- **Carry the persona as a referenced skill, not an always-on layer.** A single `grocery-persona` skill holds the core (persona/access, plan/cook modes, behavior rules, never-do, tone). Its own trigger description is near-empty so it never self-triggers; instead, **every workflow skill's first line references it**, so the persona loads on-demand alongside whichever workflow fired. No MCP `instructions`, no always-on cost, nothing pasted.
- **Add a NEW guided-onboarding skill.** Walks a new member through initial profile / preferences / pantry / diet-principles setup conversationally — asking a few things at a time and writing incrementally via existing write tools — instead of forcing a wall of typing up front.
- **Build the plugin from source.** A new `scripts/build-plugin.mjs` assembles the `.plugin` bundle (skills + connector config) from `AGENT_INSTRUCTIONS.md`, mirroring the existing `build-indexes`/`build-site` pattern.
- **Distribute via a marketplace** (GitHub repo) so installed plugins pull updates — replacing manual re-copying.
- **GATING VALIDATION (task 1):** the whole design rests on one unverified mechanism — that a workflow skill can reliably pull in a referenced near-empty-description `grocery-persona` skill in claude.ai. Validate that first (upload two minimal skills, confirm the reference loads the persona) before generating the full set.

## Capabilities

### New Capabilities
- `agent-plugin-distribution`: packaging the agent's skills + bundled connector as an installable plugin, built from `AGENT_INSTRUCTIONS.md` as the single source, and distributed via a marketplace for pull-based updates.
- `guided-onboarding`: a conversational first-run setup skill that incrementally captures a new member's profile, preferences, pantry, and diet principles via existing write tools.

### Modified Capabilities
- None. The MCP server, tool contract, data model, and OAuth flow are untouched.

## Impact

- **New**: `scripts/build-plugin.mjs` (+ tooling tests under `tests/`); a marketplace repo (or marketplace manifest) for distribution; generated skill files (`grocery-persona` + one per flow + onboarding).
- **Modified**: `AGENT_INSTRUCTIONS.md` reorganized into a persona block + per-flow sections that the builder consumes; `docs/SELF_HOSTING.md` onboarding flow (install-one-plugin + OAuth replaces create-Project + paste-doc + add-connector); `docs/PROJECT.md` as the surface shifts.
- **Unchanged**: the Worker / MCP tool contract, the data model, OAuth invite-code flow. Hooks/sub-agents are deliberately not used (they would not run in the Chat tab).
- **Risk**: the persona-by-reference mechanism is unverified in claude.ai — task 1 validates it before committing to the full build; if references don't reliably load the persona, the fallback is a broad-description always-loading persona skill.
