## Context

The deterministic substrate is complete and archived through Change 08; the agent is live on Claude.ai (Change 07). AGENT_INSTRUCTIONS.md already sketches the menu-request flow under "Common flows → Menu request," but that prose was written ahead of the tools and has never been exercised as a single end-to-end orchestration. Change 09 makes it operational.

Two distinct kinds of work live in this change, and they have opposite validation stories:

1. **A small, deterministic code change** — a `query` param on `list_recipes` — that is unit-testable like every prior change.
2. **The orchestration itself** — agent behavior driven by AGENT_INSTRUCTIONS.md prose — which is *not* deterministic and cannot be asserted by a unit test. Its natural done-criterion ("produces a useful menu proposal") is unfalsifiable as written.

The design's job is to nail down the matching semantics for (1) and to replace the unfalsifiable criterion in (2) with a concrete scripted smoke test.

This change depends on `split-agent-instructions` landing first: that change relocates the grocery-agent prose from `CLAUDE.md` to `AGENT_INSTRUCTIONS.md` (verbatim), so 09's orchestration edits target the new file.

All orchestrated tools already exist: `kroger_flyer`, `kroger_prices`, `ready_to_eat_available`, `read_preferences`, `read_taste`, `verify_pantry_for_recipe`/`verify_pantry_for_candidates`, `propose_substitutions`, `add_to_grocery_list`/`commit_changes`. No new tools, services, or dependencies.

## Goals / Non-Goals

**Goals:**
- A named dish reliably surfaces *every* genuine corpus match, deterministically, before the menu flow proceeds.
- AGENT_INSTRUCTIONS.md drives a complete menu-request: context pre-pass → pantry confirmation → proposal assembly → capture to `grocery_list.toml`.
- A repeatable smoke-test script + rubric gives the milestone a checkable done-criterion.
- Capture stays strictly separate from flush: agreeing to a menu writes the repo, never the cart.

**Non-Goals:**
- `suggest_sequencing` / component pairing — deferred to Change 13; the flow tolerates its absence.
- Cart population / `place_order` — that is the 06b flush, triggered only on explicit "order it."
- Fuzzy/semantic recipe search, ranking, or scoring — `query` is a deterministic membership filter, not a relevance ranker.
- Quantity sufficiency or portion netting — out of scope per AGENT_INSTRUCTIONS.md; partials are reconciled at order time (06b).
- Any change to the discovery/import tools (Change 10) or variety/retrospection (Change 11).

## Decisions

### D1: `query` matches title + tags with token-AND case-insensitive substring

`query` is split into whitespace-separated tokens. A recipe matches when **every** token appears (case-insensitive substring) somewhere in the recipe's title **or** its tags. The match is a pure function of the index entry — no I/O, unit-testable in `filterRecipes`.

- **Why token-AND over whole-string substring:** "chicken and rice" as a whole string would fail to match a recipe titled "Chicken & Rice" or "Chicken and Wild Rice," reintroducing the silent-miss the change exists to kill. Token-AND ("chicken" AND "rice" both present) matches "Chicken and Rice," "Arroz Caldo (Chicken Rice Porridge)" if those tokens appear, etc.
- **Why title + tags, not body:** the index carries title and tags cheaply; bodies are not in `_indexes/recipes.json`, and matching prose would produce noisy false positives. Tags are the curated semantic layer — that is exactly what they are for.
- **Why AND across tokens, not OR:** OR would match any recipe containing "rice," flooding results. AND narrows to recipes plausibly *about* the named dish. Consistent with the existing array-filter AND semantics (D5 of Change 04).
- **Why deterministic in the tool, not LLM-only:** the whole point of the 08 smoke-test finding is that LLM judgment over a filtered list silently skipped an exact-title match. A deterministic filter makes the exact-title case impossible to miss; the LLM still reasons over the *returned set*, but no longer has to recall the corpus from memory.
- **Composes with existing filters:** `query` is ANDed with `status`/`protein`/`tags`/etc. — `list_recipes({ query: "chicken rice", status: "active" })` narrows within active recipes. Absent `query` → behavior is byte-identical to today.

**Stopwords:** none in v1. "and"/"with" as tokens are harmless substrings (they appear in many titles, so they don't narrow incorrectly when the user includes them, and token-AND still requires the content words). Adding a stopword list is a trivial later refinement if noise appears; not worth the determinism complexity now.

### D2: Orchestration lives in AGENT_INSTRUCTIONS.md prose, specced as agent-behavior requirements

The menu-generation capability is behavioral, not a tool. Its spec requirements are written as SHALL statements about what the agent does (gather context in parallel, enumerate named-dish matches exhaustively, surface sale substitutions only after flyer data, capture not flush). They are validated by the D3 smoke test, not by unit tests. This mirrors how `claude-ai-connector` specs connection behaviors that are exercised manually.

### D3: A scripted smoke test replaces the unfalsifiable done-criterion

Three seeded requests, each with a MUST-surface rubric, run from a fresh conversation against live data:

| Seed | Request | Rubric — the response MUST… |
|---|---|---|
| Open-ended | "make me a menu" | size to `default_cooking_nights`; run the pantry confirmation pass; surface ≥1 sale-based opportunity from flyer data; offer ready-to-eat option(s); list staples to restock; capture agreed items to `grocery_list.toml`; NOT write the cart |
| Recipe-seeded | "let's make chicken and rice this week" | use `list_recipes({ query: "chicken rice" })`; enumerate **all** genuine matches incl. the recipe titled "Chicken and Rice"; disambiguate/confirm before walking the pantry; then run verify + proposal |
| Freeform-constraint | "something comforting, I'm feeling lazy" | honor the constraint in selection; bias toward low-effort / meal-preppable; still run the pantry pass and capture step |

"Done" = each script produces a response satisfying its rubric, the user can iterate with a revision, and on agreement items land in `grocery_list.toml` with the cart untouched. The transcript is captured (per the Change 07 precedent) as the artifact.

### D4: Capture-not-flush is enforced by tool choice, not just prose

Menu agreement uses `commit_changes`/`add_to_grocery_list` only. `place_order` is never called by the menu flow. AGENT_INSTRUCTIONS.md states this explicitly; the smoke-test rubric asserts the cart is untouched. This is the existing capture/flush reframe (Change 06/06b) applied to the menu path.

## Risks / Trade-offs

- **Orchestration quality is non-deterministic** → the smoke-test rubric pins the *observable* must-haves (which tools run, what gets surfaced, capture-not-flush) rather than subjective proposal quality. Run-to-run wording varies; the checklist does not.
- **`query` token-AND could still miss a genuinely differently-named dish** (e.g. user says "jambalaya," recipe tagged only "cajun") → acceptable: that is a tags-completeness data issue, and the LLM still reasons over the broader filtered list as a backstop. The change closes the *exact-title silent-skip*, which was the observed failure; it does not promise semantic recall.
- **`query` false positives from short tokens** (e.g. "rice" substring-matching "rice vinegar" tag) → acceptable and arguably correct (surfaces a candidate the LLM can dismiss); far better failure mode than a silent miss. Revisit with stopwords/word-boundary matching only if noise is observed.
- **AGENT_INSTRUCTIONS.md is getting large** → the menu-request section already exists; 09 operationalizes it rather than adding a parallel section. Keep edits within the existing "Common flows → Menu request" structure to avoid duplication.

## Migration Plan

1. Land the `list_recipes` `query` param + unit tests; CD deploys on push to `worker/**`. Backward-compatible (param is optional; absent → identical behavior).
2. Sync `docs/TOOLS.md` `list_recipes` params/notes in the same pass.
3. Update AGENT_INSTRUCTIONS.md menu-request orchestration.
4. Run the D3 smoke-test script from a fresh Claude.ai conversation; capture the transcript; fix AGENT_INSTRUCTIONS.md/tool-description issues found.
5. Rollback is trivial: the param is additive and the orchestration change is prose — revert AGENT_INSTRUCTIONS.md if the flow regresses.

## Open Questions

- Should a recurring named-dish miss eventually push a lightweight relevance rank into `list_recipes`, or stay LLM-judged over the `query` result set? Deferred — revisit only if the smoke test or real use surfaces a miss that token-AND + tags can't catch.
