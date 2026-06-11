## Why

The MCP tool descriptions, `AGENT_INSTRUCTIONS.md`, and (by generation) the plugin skills are read by a consumer whose only affordances are **tools and conversation** — it has no filesystem. Yet those surfaces name ~20 distinct repo-internal files (`taste.md`, `feeds.toml`, `skus/kroger.toml`, `recipes/<slug>.md`, `overlay.toml`, …) across ~80 mentions, telling the agent to act "against" or "into" paths it can never open. The repo's vocabulary is leaking through a membrane that should only speak the consumer's. The instruction `"judge taste fit against taste.md"` is the sharpest case: it names a file when the actionable handle is the `read_taste` tool.

## What Changes

- Establish one authoring rule for every consumer-facing surface: **name a thing only if the agent has a verb for it.** A tool-backed datum is named by its concept (and, where the description sends the agent to fetch it, by the *tool*); a datum with no agent verb is described by its behavior with the filename dropped; a pure side-effect path is dropped entirely.
- **Rewrite MCP tool description strings** in `src/*-tools.ts` / `src/tools.ts` to remove internal paths/extensions (Class A → concept/tool noun; Class B → behavior; Class C → drop). Includes `ToolError` messages that surface internal paths to the agent (e.g. `"recipes/<slug>.md has no ## Ingredients"`).
- **Rewrite `AGENT_INSTRUCTIONS.md`** persona/prose to consumer ontology — bare concept nouns, no paths. Flow bodies (which generate the workflow skills) **may name tools explicitly as a procedure** — a skill reading as a tool-call script is acceptable — but still carry no internal filesystem paths/extensions.
- **Regenerate the plugin bundle** (`npm run build:plugin`) so `plugin/grocery-agent/skills/*` reflect the cleaned source. No hand-edits to the bundle.
- **Sync `docs/TOOLS.md`** (the contract) to the new description language in the same pass — no drift.
- **Preserve the load-bearing intent-model nouns** (`pantry` / `stockup` / `grocery_list` / `meal_plan` / `cooking_log`): strip the `.toml`/path decoration, keep the noun and its observation→conditional→committed→realized semantics. Developer-facing files (`CLAUDE.md`, `README.md`, `ROADMAP.md`, `docs/SCHEMAS.md`, build scripts) keep their filenames — they are not consumer-facing and are out of scope.

## Capabilities

### New Capabilities
- `consumer-facing-descriptions`: A cross-cutting authoring standard for every surface the Claude.ai agent reads (MCP tool descriptions, `AGENT_INSTRUCTIONS.md`, generated skills, agent-facing error messages). Requires that such text be written in the consumer's ontology — tools and concepts — and never reference repo-internal filesystem paths or file extensions; defines the concept/behavior/drop disposition and the explicit exception for the intent-model nouns and for tool names in skill procedures.

### Modified Capabilities
<!-- No spec-level behavior of an existing capability changes. The tool *contracts*
     (params/returns) are untouched; only the human-readable description prose is
     reworded. docs/TOOLS.md is synced as documentation, not as a behavior change. -->

## Impact

- **Source of truth, edited**: `src/*-tools.ts`, `src/tools.ts` (description strings + path-leaking `ToolError` messages); `AGENT_INSTRUCTIONS.md` (persona + flow bodies).
- **Generated, rebuilt not edited**: `plugin/grocery-agent/skills/*` via `npm run build:plugin` (skills are generated from `AGENT_INSTRUCTIONS.md`; the bundle is never hand-edited).
- **Docs synced**: `docs/TOOLS.md` (the tool contract) reworded to match.
- **No behavior change**: tool names, parameters, return shapes, and error `code`s are untouched — only human-readable `description`/`message` text changes. No worker logic, no data-format change, no deploy-time risk beyond the standard typecheck + tests + plugin rebuild.
- **Out of scope**: developer/operator surfaces (`CLAUDE.md`, `README.md`, `ROADMAP.md`, `docs/SCHEMAS.md`/`PROJECT.md`/`SELF_HOSTING.md`, `scripts/`) — those readers have the repo and the filenames are correct there.
