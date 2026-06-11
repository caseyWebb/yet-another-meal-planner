## 1. Validate the load-bearing mechanism (gating)

- [x] 1.1 Hand-author two minimal skills: a `probe-workflow` whose opening directive references a `probe-persona`, and a `probe-persona` with a near-empty description carrying a distinctive sentinel instruction. → `probe/skills/{probe-workflow,probe-persona}/SKILL.md`
- [x] 1.2 Package them as a minimal plugin and upload to claude.ai; confirm "Upload plugin" accepts the standard `plugin.json` + `skills/` layout. → CONFIRMED: a zip with `.claude-plugin/plugin.json` + `skills/<name>/SKILL.md` **at the archive root** is accepted. NB: skill bodies sync to the chat sandbox (`/mnt/skills/plugins/<plugin>:<skill>/`) on a fresh chat — a just-uploaded plugin may not resolve until a new chat is opened.
- [x] 1.3 Trigger `probe-workflow` in claude.ai chat and confirm the sentinel from `probe-persona` takes effect. → PASS: in a fresh Chat, "run the probe test" fired `probe-workflow`, whose first-line reference loaded `probe-persona` (sentinel appeared).
- [x] 1.4 Decide: reference mechanism holds → proceed with persona-by-reference. → HOLDS; proceeding with D1 as written, no fallback. (Optional follow-up: confirm the control — persona does not self-trigger on an unrelated message.)

## 2. Restructure the canonical source

- [x] 2.1 Reorganize `AGENT_INSTRUCTIONS.md` into builder-consumable sections: persona = all `##` sections except `## Common flows`; flows = the `###` under `## Common flows`. Fixed cross-references that break when flows are standalone ("below" → named-flow refs; ready-to-eat body made self-contained).
- [x] 2.2 Convention (locked w/ Casey): each flow `###` carries an HTML comment `<!-- skill: <name>\ndescription: <text> -->`. Invisible when rendered; doc stays canonical/readable. Persona name + empty description + the per-flow persona-reference line are builder constants, not in the doc.
- [x] 2.3 Authored per-flow trigger descriptions (the load-bearing artifact) for all 11 flows: menu-request, pantry-update, cook-mode, recipe-feedback, recipe-notes, ready-to-eat-feedback, recipe-import, inventory-hypothetical, sale-check, retrospective, order-placement.

## 3. Build tooling

- [x] 3.1 Wrote `scripts/build-plugin.mjs` — parses `AGENT_INSTRUCTIONS.md`, emits `.claude-plugin/plugin.json`, `skills/grocery-persona/SKILL.md`, `skills/<flow>/SKILL.md` (persona reference prepended), `.mcp.json` (`--mcp-url`). Follows `build-indexes`/`build-site` conventions (`--src`/`--out`/`--check`); deterministic (byte-identical rebuild verified). `build:plugin` added to package.json.
- [x] 3.2 `--check` validate-only mode: `validateParsed` fails if persona empty, no flows, a flow lacks its marker/description/body, an invalid or duplicate skill name. Verified against the real doc (persona + 11 flows).
- [x] 3.3 `tests/build-plugin.test.mjs` (14 tests: parse/validate/render/determinism + real-doc contract); wired into `test:tooling` (full suite 51 green).

## 4. Onboarding skill

- [x] 4.1 Authored the onboarding skill as a `### First-run setup (onboarding)` flow in `AGENT_INSTRUCTIONS.md`: conversational capture of taste → cooking preferences → diet principles → starting pantry in small batches, persisting each via existing write tools (`update_taste`/`update_preferences`/`update_diet_principles`/`update_pantry`); opens with the persona reference (prepended at build); hands off to menu-request when done.
- [x] 4.2 Trigger description loads it on explicit request ("get started", "set me up", "onboard me") and when read tools show an empty profile; instructs capture-a-little-at-a-time, no all-at-once demand.
- [x] 4.3 Picked up generically by `build-plugin.mjs` (no special-casing — it's a flow section); real-doc test updated to expect 12 flows incl `onboarding`; suite green.

## 5. Distribution

- [~] 5.1 Marketplace stood up in the **public code repo** (decided w/ Casey: data repo is private + friends have no GitHub, so a private marketplace is unreachable — public code repo is OAuth-gated-safe). Added `.claude-plugin/marketplace.json` → `./plugin/grocery-agent`; committed the built bundle at `plugin/grocery-agent/`; CI drift-guard added (committed skills must match `AGENT_INSTRUCTIONS.md`, `.mcp.json` excluded). **REMAINING: Casey sets the real grocery-mcp URL** — `npm run build:plugin -- --mcp-url <real> --out plugin/grocery-agent` (currently a glaring `REPLACE-WITH-...` placeholder), then push.
- [ ] 5.2 Verify the end-to-end member path in claude.ai: install `grocery-agent@grocery-agent` from the marketplace → OAuth invite code → persona + flows + connector all live, nothing pasted. **(manual, Casey)**
- [ ] 5.3 Verify an update propagates: change `AGENT_INSTRUCTIONS.md`, rebuild, bump version, push, and confirm `/plugin marketplace update` pulls it. **(manual, Casey)**

## 6. Docs

- [x] 6.1 Updated `docs/SELF_HOSTING.md`: §8 operator + "Onboard a friend" now install the marketplace plugin (bundles connector + skills, nothing pasted) + OAuth invite; added the one-time "rebuild with your Worker URL" step.
- [x] 6.2 Updated `docs/PROJECT.md` (two-surfaces section, tree label, topology diagram) and `CLAUDE.md`'s pointer to describe the plugin-build surface + persona-by-reference; "paste source" → "plugin build source".
- [x] 6.3 Added a build-source note at the top of `AGENT_INSTRUCTIONS.md` (HTML comment): canonical source, skills generated via `build-plugin.mjs`, never hand-edit the bundle.

## 7. Persona refactor — build-time composition (R1, supersedes the persona-by-reference build)

- [x] 7.1 Reorganize the persona content in `AGENT_INSTRUCTIONS.md` into a tiny **core** (identity, tone, never-auto-decide, cart honesty, tool/access overview) + tagged **depth** blocks `cart` / `corpus` / `planning`, using a marker convention (e.g. `<!-- persona-core -->`, `<!-- persona-depth: cart -->`).
- [x] 7.2 Extend each flow marker with `needs: <depth list>` and audit which depth each of the 13 flows requires.
- [x] 7.3 Rework `build-plugin.mjs`: compose each skill = core + needed depth + flow body into a **self-contained** SKILL.md; drop the standalone persona skill and the runtime persona-reference line. Update `validateParsed` (every `needs` names a real depth block; core present).
- [x] 7.4 Update `tests/build-plugin.test.mjs` for composition (core inlined, depth gated by `needs`, no cross-skill reference) and the real-doc contract.

## 8. cook / cooked split + guided cook (R2 — folds in roadmap Change 15)

- [x] 8.1 Rename the current `cook-mode` flow to **`cooked`**: trigger on a *completed* meal ("I made/had X"); keep the inventory walk + `cooking_log` + `meal_plan` clear; callable standalone.
- [x] 8.2 Author the **`cook`** flow (Change 15): trigger on *active* cooking ("I'm making/cooking X"); identify the recipe(s) (`list_recipes`/`read_recipe`); on completion invoke `cooked`. **Structure = mise en place, in order (locked w/ Casey 2026-06-10):**
  1. **Equipment** — ask/confirm what's needed (pans, pots, sheet trays, **prep bowls**, oven). No kitchen-inventory state yet, so *ask* the user each time (future state captured in ROADMAP). If the meal could parallelize, suggest multiple ovens / toaster ovens / pressure cookers and confirm what they have.
  2. **Gather ingredients** — have them pull everything out **and confirm there's enough of each**. This is the moment to surface a shortfall — *early*, when they can still substitute, scale down, or swap the dish — **never** mid-cook. (Discovering you're short as the step calls for it, hands messy and pan hot, is exactly the failure mise en place prevents.) Flag any missing/short item here.
  3. **Prep** — chop/measure/portion into the prep bowls (mise en place proper).
  4. **Cook** — walk the actual steps.
  - **Exception — preheat early:** if a later step needs a hot oven, prompt to start preheating during prep (at the right lead time), not when the instruction is reached.
  - **Main + sides:** help **pace and order** steps across dishes so they finish together; lean on parallel equipment.
  - **Pacing/advance:** one logical step at a time (not the whole list); advance on natural voice cues ("next" / "done" / "what's next"). Ingredient sufficiency is resolved at gather (step 2), not mid-cook.
  - **Timers:** the agent has no real background timer in claude.ai chat, so on a timed step it states the duration and asks the user to set their own phone timer (or "tell me when it's done") — it MUST NOT claim to be timing it.
- [x] 8.3 Update the persona's plan-vs-cook mode text and any cross-references (menu-request, retrospective) for the cook/cooked split; sync `docs/TOOLS.md` if any read affordance changes (Change 15 adds no new write tool — capture stays in `commit_changes`).
- [x] 8.4 Update tests for 13 flows incl. `cook` + `cooked`; update the openspec `cooking-history`/roadmap notes to reflect Change 15 landing here.

## 9. Connector URL (R3 → reverted to baked URL after live test)

- [x] 9.1 ~~`userConfig.worker_url` + `${user_config.worker_url}`~~ — built, then **reverted** (see 9.2). `build-plugin.mjs` now bakes `--mcp-url` straight into `.mcp.json`; no `userConfig` in the manifest. Tests updated (baked-url assertion); suite green.
- [x] 9.2 **GATING CHECK FAILED (live test 2026-06-11):** claude.ai does **not** honor a plugin `userConfig` variable — `${user_config.worker_url}` reached the connector literally, with no prompt and no way to edit it. Applied the planned fallback: bake the Worker URL per operator via `--mcp-url` (fork + rebuild).
- [x] 9.3 Docs updated (`SELF_HOSTING.md` §8, `PROJECT.md`): bake-your-URL-then-push, no prompt. **Also recorded** the second live finding: adding a marketplace in claude.ai clones the repo locally and needs GitHub access to sync, so plugin **auto-update effectively requires a GitHub account** — accountless members re-install on changes (no worse than the old paste-the-doc flow). Motivation #3 (auto-updates) holds only for GitHub-account members.

## 10. Persona prune + reference-loading (R4 — reverses R1 composition)

- [x] 10.1 Prune the persona to behavioral essentials: cut GitHub MCP (dead — friends have no GitHub), the `docs/TOOLS.md` ref (no repo in skills), the file-name/architecture table, the multi-tenant exposition (tool-encoded), and the heavy tone block (minimal-touch per Casey). `grocery-core` ~8 lines, down from ~50+.
- [x] 10.2 Dissolve the `planning` tier into `meal-plan` (its only real consumer); `cooking-retrospective`/`inventory-hypothetical` keep their slivers inline and drop to core-only. `DEPTH_TIERS` = cart, corpus.
- [x] 10.3 Rework `build-plugin.mjs`: emit `grocery-core`/`grocery-cart`/`grocery-corpus` **library skills** (near-empty descriptions) + prefix each workflow with a prerequisite loader line driven by `needs:` ("if you haven't already this session, read grocery-core …"). Replaces inlining.
- [x] 10.4 Update `tests/build-plugin.test.mjs` (loaderLine, renderLibrarySkill, renderWorkflowSkill, no-inline assertion, 13-flow + library-tier real-doc contract) and `docs/PROJECT.md`. Suite 57 green; bundle rebuilt; drift-guard in sync.
- [ ] 10.5 **Gating (manual, Casey):** in claude.ai, fire a *second* workflow in the same session and confirm it does NOT re-load `grocery-core` (the "if already loaded, skip" hedge holds). Fallback if it duplicates badly: revert those tiers to composition.

## 11. Cull skill bodies (same heuristics as the persona)

- [x] 11.1 Fanned out 5 read-only agents over the 13 workflow bodies; each returned a cleaned body applying the persona heuristics + two new levers: drop anything already in the loaded `grocery-core`/`cart`/`corpus` tiers, and drop tool-mechanics the schemas already convey. Cut: ghost/negative-space lines (the `tags` filter that never existed, `fetch_flyer_featured`), redundant `Triggered on:` lines (the marker description carries triggers), persona-tier repetition (cart-write-only, overlay/my-view, shared-recipe rules), and field-by-field tool recitations. Kept all tool-call sequences and behavioral judgments. Rebuilt + drift-guard in sync; 57 tests green.
