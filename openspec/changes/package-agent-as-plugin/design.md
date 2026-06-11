> **Revisions (2026-06-10) supersede parts of D1 below — see "## Revisions" at the end.** Net of R1→R4: the shipped model is **pruned persona as reference-loaded library skills** (`grocery-core` + `grocery-cart`/`grocery-corpus`, loaded once per session via a "if not already loaded" prerequisite line — R4 reverses R1's composition for token efficiency on sequential chains); `cook-mode` splits into **`cooked`** (capture) + **`cook`** (guided mise-en-place walkthrough, folding in roadmap **Change 15**); the connector URL is a plugin **`userConfig`** value so one plugin serves all operators. Read R4 first — it's the current architecture.

## Context

The agent runs in Claude.ai. Its behavior ships as `AGENT_INSTRUCTIONS.md` (261 lines: persona/access, core principles, plan-vs-cook modes, ~11 conversational flows, behavior rules, never-do, tone), pasted by hand into a Project, alongside a manually-added `grocery-mcp` connector and an OAuth invite-code handshake. Verified platform facts (2026-06-10): plugins install and run in claude.ai web chat + Desktop Chat; bundled **skills** and **connectors** work on those surfaces; only **hooks/sub-agents** are Cowork-only. Custom-plugin upload and marketplace distribution both exist. Claude Code merged slash commands into skills (2.1.3) — "skills" is canonical. The agent uses no hooks/sub-agents, so nothing about it is Cowork-restricted.

## Goals / Non-Goals

**Goals:**
- One installable, versioned unit replaces "paste a doc + add a connector by hand."
- Flow bodies load only when their flow is active (scoping / token reduction).
- Updates propagate without anyone re-copying anything (marketplace pull).
- A new member can be set up conversationally, not via a wall of typing.
- `AGENT_INSTRUCTIONS.md` stays the single source; skills are generated, never hand-forked.

**Non-Goals:**
- Moving the agent's home to Cowork (hooks/sub-agents stay unused).
- Changing the MCP tool contract, data model, OAuth invite flow, or the Worker at all.
- Public listing in the global directory (distribution is the friend-group marketplace, install-by-file or private marketplace).
- Recipe/menu behavior changes — this is packaging + onboarding only.

## Decisions

### D1 — Persona is a referenced skill, loaded by workflows (no always-on layer)
There is **no always-on core** and **no use of the MCP `instructions` field**. Instead:
- A single **`grocery-persona`** skill holds the core: persona/access, plan/cook modes, behavior rules, never-do, tone.
- Its **trigger description is near-empty** so it never self-triggers and never competes for auto-load — it is a *library* skill, loadable only by explicit reference.
- **Every workflow skill's first line references it** (an imperative directive: "Before anything else, load the `grocery-persona` skill"). So whenever a workflow fires, it pulls the persona in alongside itself.

This sidesteps the entire `instructions`-field question (optional/hint-only/~2KB/unverified-in-claude.ai) and removes any Worker change. The persona loads lazily — only when a workflow loads — which in a grocery conversation is effectively always, but on-demand rather than always-resident.

**This decision rests on one unverified mechanism:** that a workflow skill can reliably cause claude.ai to load a referenced near-empty-description skill. Task 1 validates it directly (two minimal skills: a `probe-workflow` whose first line references a `probe-persona` carrying a sentinel instruction; confirm the sentinel takes effect when the workflow fires). Fallback if it doesn't hold: give `grocery-persona` a broad description so it auto-loads on any grocery/cook/meal/shopping intent (always-resident, the thing we were avoiding, but functional).

### D2 — Skills are generated from `AGENT_INSTRUCTIONS.md`
`AGENT_INSTRUCTIONS.md` is restructured so its sections map to build targets: a persona block, and one block per flow carrying that flow's trigger description + body. A new `scripts/build-plugin.mjs` parses these and emits the plugin tree (`plugin.json` manifest, `skills/grocery-persona/SKILL.md`, `skills/<flow>/SKILL.md` per flow with the persona-reference prepended, `skills/grocery-onboarding/SKILL.md`, `.mcp.json` connector config). Mirrors `build-indexes.mjs`/`build-site.mjs` (Node, `--root`/`--out`, `--check`), with tests under `tests/`. No parallel hand-maintained skill copies — the doc remains canonical, the bundle is an artifact.

### D3 — One skill per flow; rich descriptions are the load-bearing artifact
Each of the ~11 flows (menu request, pantry update, cook mode, recipe feedback/disposition, recipe notes, ready-to-eat feedback, recipe import, inventory hypothetical, sale check, retrospective, order placement) is its own skill — their bodies are the bulk, so this is where the token win lives. Because claude.ai auto-loads skills by relevance, each flow's **trigger description** is what determines whether it fires; descriptions get first-class authoring attention (the monolith never had a trigger-miss failure mode; split skills do). The persona is *not* fragmented — it's one skill, pulled in by reference.

### D4 — Onboarding is a new skill over existing write tools
A `grocery-onboarding` skill detects an empty profile (existing read tools return nothing) and/or is invoked explicitly, then captures profile → preferences → pantry → diet principles in small batches, writing each via the existing `update_preferences` / `update_pantry` / `update_taste` / `update_diet_principles` tools. Its first line references `grocery-persona` like any other workflow. Chunked so a half-finished setup still persists what was gathered. No new MCP tools required.

### D5 — Distribution via marketplace, built from source
The plugin publishes to a marketplace repo (GitHub) so installs pull updates. `build-plugin.mjs` output lands there (or the data repo grows a marketplace manifest). Onboarding becomes: install one plugin → OAuth with invite code. Replaces create-Project + paste-doc + add-connector + OAuth.

## Risks / Trade-offs

- **The reference mechanism may not hold (D1).** It's unverified that claude.ai reliably loads a referenced library skill from a workflow's first line. Task 1 validates it before any bulk work; fallback is a broad-description always-loading persona skill.
- **No persona when nothing triggers.** On a turn where no workflow fires (e.g. a bare "hi" before any grocery intent), neither a workflow nor the persona loads — the agent is briefly "just Claude" until intent appears. Acceptable for a single-purpose connector context, but a real behavioral difference from the always-resident doc; noted, not hidden. The fallback (broad persona description) also resolves this.
- **Trigger reliability (D3).** A split flow-skill can silently fail to fire when it should — a failure mode the monolith never had. Mitigated by treating trigger descriptions as first-class.
- **Mono-purpose mutes the token win.** Over a long plan→cook→order session most flow skills load anyway. The durable wins are distribution + onboarding, not raw tokens — proposal scopes the token claim as "modest."
- **Upload format unknown.** Whether claude.ai "Upload plugin" takes the standard `plugin.json` + `skills/` + `.mcp.json` layout as-is is unconfirmed; folded into the task list as a verify step alongside the task-1 validation.

## Revisions (2026-06-10, after skill-creator best-practices review)

A pass with the `skill-creator` skill plus three design questions from Casey supersede parts of the original plan. Task 1 (the persona-by-reference probe) still **passed** and is kept as evidence, but the shipped design changes:

### R1 — Persona: build-time composition into self-contained skills (supersedes D1/D3)
Anthropic's progressive-disclosure model is **within** a skill (SKILL.md → `references/`); one skill loading **another** skill by reference is not a documented pattern. And not every flow needs the full persona (`sale-check` shouldn't carry cart + corpus + variety rules). So:
- `AGENT_INSTRUCTIONS.md` persona content is reorganized into a tiny **core** (identity, tone, "never auto-decide — surface as questions", cart honesty, tool/access overview) plus tagged **depth** blocks: `cart` (capture↔flush, write-only cart, substitution timing), `corpus` (shared recipes vs personal overlay/notes, group signal, don't-edit-config-unprompted), `planning` (pantry drift, recency, variety, discovery).
- Each flow's marker declares which depth it needs: `<!-- skill: menu-request | needs: cart, corpus, planning | description: … -->`.
- `build-plugin.mjs` **composes** each skill = core + needed depth + flow body → **self-contained** SKILL.md. No runtime cross-skill reference; no standalone `grocery-persona` skill. Source stays single-sourced (DRY); output skills carry only what they need (token-tailored). The tiny core is duplicated across skills on disk (fine) and re-loaded per fired flow in context (small).
- Trade kept honest: a "hi" with no flow still loads nothing (bare Claude until intent) — same as before, acceptable for a single-purpose connector.

### R2 — `cook-mode` splits into `cooked` + `cook`; Change 15 folded in
What was generated as `cook-mode` is post-hoc capture — rename to **`cooked`** (triggers on a *completed* meal: "I made/had X"; inventory walk + `cooking_log` append + `last_cooked` + clears `meal_plan`; callable standalone). Add **`cook`** — the interactive, hands-free **guided cook walkthrough** (roadmap Change 15, now in scope): triggers on *active* cooking ("I'm making/cooking X") and runs as **mise en place** — (1) equipment (asked each time until a future kitchen-inventory state, ROADMAP Change 16; includes prep bowls; suggest parallel ovens/toaster-ovens/pressure-cookers), (2) gather ingredients **+ sufficiency check here** (surface a shortfall early, when you can still sub/scale/swap — never mid-cook, the failure mise en place exists to prevent), (3) prep into bowls, (4) cook step-by-step. Preheat-the-oven is the early exception. Multi-dish meals get step pacing/ordering across dishes. Timers are **user-set** (no real background timer in chat). On completion **invokes `cooked`** to log + decrement. Pure consumer/writer of the existing `cooking_log.toml`/`meal_plan.toml` schema — zero migration. Full UX decisions in tasks 8.2.

### R3 — Connector URL via plugin `userConfig` (supersedes the committed-URL approach)
The plugin manifest declares `userConfig.worker_url` (`type: string`, with a `default`), substituted into `.mcp.json` as `${user_config.worker_url}`. One plugin serves everyone: friends accept the default (the operator's Worker), self-hosters override the URL **at enable time** — no rebuild, no per-operator bundle, no committed placeholder, and the drift-guard no longer needs to special-case `.mcp.json` (it's operator-agnostic now). `--mcp-url` becomes "set the default." **Gated like the other claude.ai unknowns:** `userConfig` is documented for Claude Code; whether claude.ai's installer prompts it needs a quick check. Fallback if not: bake the URL via `--mcp-url` per operator (the prior approach).

### R4 — Reference-loading + persona prune (supersedes R1's composition)
Composition (R1) optimized the wrong axis: it made each skill self-contained, but the dominant usage is **sequential chains in one session** (the whole `meal-plan` flow; `cook → cooked → add-recipe-feedback → add-recipe-note`), where inlining re-loads the shared core on every link — a measurable token regression. Two changes, pulled together:

- **Prune the persona to what changes behavior.** Cut what the model doesn't need or the tools already enforce: the dead **GitHub MCP** connector (friends have no GitHub; the agent works entirely through grocery-mcp), the `docs/TOOLS.md` reference (skills have no repo), the **file-name table** + architecture exposition (the *tools* address files; the agent never does), the multi-tenant exposition (encoded in tool routing/args), and the heavy **tone** block (minimal touch — keep a one-line frame, inherit the rest from each user's own Claude settings). "Batched commits" stays but isn't a universal rule — it's already expressed by which tool each flow calls (`commit_changes` in the multi-write flows, granular tools elsewhere), so it needs no persona section. Result: `grocery-core` ~8 lines (was ~50+). The `planning` tier dissolves into `meal-plan` (its only real consumer); `cooking-retrospective`/`inventory-hypothetical` keep their slivers inline. Surviving shared content = **core + cart + corpus**.
- **Load the shared content by reference, deduped.** Each tier ships as a **library skill** (`grocery-core`, `grocery-cart`, `grocery-corpus`; near-empty descriptions so they don't self-trigger). Every workflow skill is prefixed with a prerequisite line — *"if you haven't already this session, read `grocery-core` (and any needed depth)"* — driven by the same `needs:` metadata. In a chain, the core loads once and is reused; the "if you haven't already" hedge leans on the model to skip the reload (Claude Code dedups; claude.ai is the gating check). `build-plugin.mjs` switches from inlining tier content to emitting tier library skills + loader prefixes. `DEPTH_TIERS` = `['cart','corpus']`.

This **reverses R1**. R1 chose composition partly because skill-to-skill reference "isn't a blessed Anthropic pattern," but we now have empirical proof it works (task-1 probe) and evidence the usage is sequential, where composition is wasteful. **New gating check:** confirm in claude.ai that a *second* workflow in the same session honors "if already loaded, skip" (no duplicate core load). Fallback if it badly duplicates: revert to composition for the affected tiers.
