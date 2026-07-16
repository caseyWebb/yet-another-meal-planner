## 1. Preconditions

- [ ] 1.1 Confirm `narrow-mcp-surface` and `remove-ready-to-eat` are merged and archived; the Worker serves the final tool surface (fused `import_recipe`, `update_pantry` kitchen ops, `set_recipe_disposition`, `flyer`, `attention` block on `read_user_profile`, `update_taste` append/patch, no RTE tools).
- [ ] 1.2 Reconcile this change's MODIFIED spec deltas against the post-archive text of `openspec/specs/` (headers must match exactly; drop anything changes 1+2 already removed); `OPENSPEC_TELEMETRY=0 openspec validate rewrite-agent-persona`.

## 2. `packages/plugin` package (relocation before rewrite, so each is separately verifiable)

- [ ] 2.1 Create `packages/plugin/package.json` (`@yamp/plugin`, private) with `build:plugin` (`node scripts/build-plugin.mjs`) and `test` / `test:tooling` (`node --test tests/build-plugin.test.mjs`) scripts; `pnpm-workspace.yaml` already globs `packages/*` — verify `aube install` picks it up.
- [ ] 2.2 `git mv packages/worker/AGENT_INSTRUCTIONS.md packages/plugin/AGENT_INSTRUCTIONS.md`; `git mv packages/worker/scripts/build-plugin.mjs packages/plugin/scripts/build-plugin.mjs`; `git mv packages/worker/tests/build-plugin.test.mjs packages/plugin/tests/build-plugin.test.mjs`. No generator logic changes (`REPO_ROOT`/`--src` defaults and the test's relative import survive the move); remove the `build:plugin` script and the moved test from `packages/worker/package.json`'s `test:tooling` list.
- [ ] 2.3 Re-point root `package.json`: `build:plugin` filters `@yamp/plugin`; `test:tooling` covers both the worker's remaining tooling tests and the plugin package's tests.
- [ ] 2.4 `.github/workflows/ci.yml`: the "Plugin builds from AGENT_INSTRUCTIONS.md" job's `working-directory` → `packages/plugin`; the deploy-relevance path filter → `packages/plugin/AGENT_INSTRUCTIONS.md packages/plugin/scripts/build-plugin.mjs` (replacing the two `packages/worker/…` paths).
- [ ] 2.5 `.github/workflows/data-deploy.yml`: the publish step's `node _code/packages/worker/scripts/build-plugin.mjs …` → `_code/packages/plugin/scripts/build-plugin.mjs`.
- [ ] 2.6 Comment/template references: `packages/worker/scripts/build-vault.mjs` header comment (persona path); `packages/worker/src/write-tools.ts:589` comment; `.github/pull_request_template.md` generated-plugin checkbox wording if path-specific; `.claude/agents/code-reviewer.md` generated-plugin note.
- [ ] 2.7 Gate: `aubr test:tooling`, `node packages/plugin/scripts/build-plugin.mjs --check`, and `aubr build:plugin` all green at the new paths with the OLD persona content, before any rewrite lands.

## 3. Persona rewrite (`packages/plugin/AGENT_INSTRUCTIONS.md`, from scratch)

- [ ] 3.1 Author the single `<!-- persona: core -->` tier per the design outline: identity + terse voice (no narration, no jargon, style-preference respect), session-start gate + household handles, silent-learning rules with the explicit-statement-only dietary gate and profile-page transparency pointer, unchanged confirmation posture for consequential actions, the one-nudge `attention` rule + next-step offers, widgets-for-showing, the core micro-behaviors (import, disposition, notes, retrospective relay, guidance tips, store capture), degrade-by-tool-presence, and the error-relay / `report-bug` rule. No depth tiers; no RTE, shim lore, classification rubric, or weather narration.
- [ ] 3.2 Author the six `## Common flows` blocks with `<!-- skill: … -->` markers (no `needs:`): `plan` (engine-driven planning + sides ladder + sale-steering + save + to-buy review + shop offer), `shop` (branch detection + the flush branches as rewritten `<!-- resource: references/*.md -->` files + lifecycle assertions + storage tips), `cook` (pre-flight, card/text walk, user-owned timers, technique tips, in-flow logging incl. reported past meals + one reaction offer), `pantry` (merge-not-duplicate updates, kitchen ops, staples prompt, market-haul hand-off to `plan`), `setup` (three areas, idempotent, closes with a first-plan offer), `report-bug`.
- [ ] 3.3 Trigger descriptions: fold each absorbed skill's member phrasings into its absorber's description; respect the build validator's limits (≤1024 chars, no angle brackets); confirm every tool named in a flow body exists on the post-1+2 surface (grep against `docs/TOOLS.md`).
- [ ] 3.4 Self-review pass: total length dramatically under 639 lines (core ≲120); no machinery jargon in member-addressed prose; store-agnostic and subscription-corpus framing throughout; Kroger/Instacart branches phrased to degrade by tool presence.

## 4. Build + tests

- [ ] 4.1 Update the real-doc contract test in `packages/plugin/tests/build-plugin.test.mjs`: flow census `['plan','shop','cook','pantry','setup','report-bug']`, all `needs` empty, only `skills/yamp-core/SKILL.md` emitted among library tiers, `shop`'s reference files present, prerequisite lines core-only. Fixture tests (which exercise depth tiers and resources against inline docs) stay as-is — the generator still supports them.
- [ ] 4.2 `aubr test:tooling` green; `node packages/plugin/scripts/build-plugin.mjs --check` green.
- [ ] 4.3 `aubr build:plugin` (throwaway build) and read the generated bundle end-to-end — library skill, six workflow skills, reference files, manifest, `.mcp.json`.

## 5. Docs lockstep (living voice — current state, no history)

- [ ] 5.1 Path updates wherever `AGENT_INSTRUCTIONS.md` or the builder is referenced: `AGENTS.md` (docs list + rules section), `CLAUDE.md` (if any direct path), `README.md` (repo-map table + docs list links), `CONTRIBUTING.md` (repo map, "Building the plugin" section, auto-deploy path list, `test:tooling` description), `docs/ARCHITECTURE.md` (canonical-source paragraph + link), `docs/SELF_HOSTING.md` (project-paste fallback path).
- [ ] 5.2 Skill-census updates: `docs/TOOLS.md` (any skill/tier references surviving change 1's rewrite), `docs/ARCHITECTURE.md` (persona/plugin section: single core tier, six skills), `docs/SCHEMAS.md` (guidance-domain capture notes now name operator curation via admin, not the removed capture skills).
- [ ] 5.3 Grep gate: `grep -rn "packages/worker/AGENT_INSTRUCTIONS\|worker/scripts/build-plugin" README.md CONTRIBUTING.md AGENTS.md CLAUDE.md docs/ .github/` returns nothing.

## 6. Validation + publish

- [ ] 6.1 `OPENSPEC_TELEMETRY=0 openspec validate rewrite-agent-persona` clean; `aubr typecheck` + `aubr test` green (comment-only worker changes; no runtime deltas expected).
- [ ] 6.2 Merge to `main`; confirm the data-repo deploy fires (persona paths are in the relevance filter), redeploys the Worker first, and publishes the rebuilt bundle with a strictly-greater version.
- [ ] 6.3 Live check on an installed member: plugin auto-updates; the six skills (and only those) appear; a "show my list" ask renders the grocery widget; a stated allergy writes without ceremony; no machinery jargon in a sample plan → shop → cook session.
