## Context

This is the pantry side of the menu-request foundation (Change 08 in `ROADMAP.md`). The Worker already has a deterministic Kroger SKU matcher (`ingredient-matching`, Change 05) whose `normalizeIngredient()` lowercases, strips a single leading quantity/unit, and applies `aliases.toml` — but it was built for clean LLM-supplied terms and SKU-free grocery-list names, never raw recipe lines, and it is deliberately conservative (no prep/parenthetical/price stripping). `read_pantry` exists (`data-read-tools`, Change 04) and already returns `unsupported` for `stale_only` because shelf-life data (`ingredients.toml`) is deferred to Change 12. `mark_pantry_verified` exists (`data-write-tools`, Change 06). The recipe-site change enforces a `## Ingredients` H2 contract on every recipe body, so the parser has a guaranteed section to read.

An exploration session on 2026-06-09 surfaced that three of the original Change 08 tools have little or no data to act on today: components are declared-but-empty (≈1/63 recipes), and `substitutions.toml` / `aliases.toml` are empty user-curated config. The scope below is cut to what the data can actually support.

## Goals / Non-Goals

**Goals:**
- Deterministically walk a recipe's ingredients against the pantry and return an honest presence picture the agent can reason over.
- Reuse the existing `normalizeIngredient` + `aliases.toml` machinery; add only the recipe-line stripping that's genuinely new.
- Keep the tools honest: surface facts and ambiguity, never guess matches, never assert freshness the data can't support.
- Build `propose_substitutions` as the sole, confirmation-gated substitution owner.

**Non-Goals:**
- `suggest_sequencing` — moved to Change 13 (seeds the component vocabulary it walks).
- Deterministic staleness classification — Change 12 adds a `past_typical_fresh_life` hint later, without changing the return shape.
- Quantity sufficiency / partial netting — owned by the order-placement capability.
- Editing `aliases.toml` / `substitutions.toml` — agent suggests seeding; the user directs the write.

## Decisions

**1. `parseRecipeIngredient()` is a new layer on top of `normalizeIngredient`, not a rewrite.** The parser strips trailing/leading prep descriptors, `(...)` parentheticals, and the `($x.xx)` price annotation to get a clean name, then calls the existing `normalizeIngredient()` for the quantity/unit strip + alias application. *Alternative considered:* extend `normalizeIngredient` itself. Rejected — it's shared by the SKU matcher and grocery-list resolution, which pass already-clean terms; making it aggressively strip prep could change those callers' behavior. A separate recipe-line parser keeps the blast radius contained and is independently testable against the real corpus.

**2. No `have_stale` bucket; freshness is agent-judged (facts-not-verdicts).** The tool returns `in_pantry` items with age metadata (`added_at`, `last_verified_at`, `days_since_verified`, `category`, `prepared_from`) and the agent decides which warrant a "still good?" prompt, resolved via `mark_pantry_verified`. *Alternatives considered:* (a) coarse category-default thresholds baked into the tool — rejected, categories are absent on 42/45 items and age is a poor freshness proxy; (b) pull Change 12 forward — rejected, freshness depends on storage context that isn't in the repo regardless of shelf-life data. This is consistent with `read_pantry(stale_only)` already returning `unsupported`. Accepted trade-off: prompting is non-deterministic run-to-run, which is the right failure mode for a soft waste-prevention nudge (worst case: one unnecessary "yep").

**3. Matching never guesses — exact → `in_pantry`, inexact → `possible_matches` (Option C).** With `aliases.toml` empty, exact-only matching would silently false-miss (`chicken thighs` vs `chicken`) and a token-overlap heuristic would silently false-positive (`onion powder` vs `onion`). So the tool emits a third set, `possible_matches`, of candidate pairs for the agent to confirm or reject. *Alternatives:* exact-only (silent misses) or auto-fuzzy (silent wrong matches) — both rejected for hiding errors. A confirmed `possible_match` is where the agent *suggests* seeding an `aliases.toml` entry so it resolves automatically next time (suggest only — that file is edit-when-directed).

**4. Optional ingredients are non-blocking and asked-about, not assumed.** Parentheticals aren't uniform (`(4-5 thighs)` is a quantity hint; `(optional garnish)` is a directive), so the parser detects an `optional` marker and routes those to an `optional` set that never auto-populates `not_in_pantry`. A missing optional is surfaced for the agent to *ask* whether to add — never dropped silently, never added unilaterally.

**5. Candidate aggregation carries `for_recipes` attribution.** `verify_pantry_for_candidates` dedups by parsed name and tags `not_in_pantry` / `possible_matches` / `inventory_substitutes_available` with the recipe slugs that need each — mirroring `grocery_list.toml` and what `place_order` consumes. A flat union would lose the attribution menu reasoning and order-time dedup need.

**6. `propose_substitutions` is the sole substitution owner; `sale` mode self-fetches Kroger.** Deterministic rule application over `substitutions.toml`, returning `{ substitutes, unacceptable }`, never auto-applying. `sale` mode calls kroger-integration internally rather than taking caller-supplied flyer data — self-contained at the cost of an occasional redundant fetch when the menu pre-pass already pulled the flyer. The same rule engine backs verify's `inventory_substitutes_available` bucket.

## Risks / Trade-offs

- **Empty `aliases.toml` → many `possible_matches`** → The agent confirms them conversationally and is prompted to seed aliases, so the friction decays as the file fills. Acceptable for v1; better than silent errors.
- **Staple flooding** (`1/4 tsp salt` → `not_in_pantry` when salt isn't tracked) → Mitigation is data-hygiene: keep `pantry.toml` complete on staples (a decided choice, not a tool feature). The drift-catcher is *supposed* to surface staples; routine check-up prompts keep the list honest.
- **Non-deterministic freshness prompting** → Accepted; correct failure mode for a soft nudge (see Decision 2).
- **Recipe-line parser misses an unusual format** → The parser is a heuristic; unit tests cover real corpus lines, and a mis-parse degrades to a `possible_match` or a spurious `not_in_pantry` (the agent catches it), not a silent wrong match.
- **Redundant Kroger fetch in `sale` mode** → Trivial cost; preferred over coupling the tool's contract to a caller pre-pass.

## Migration Plan

Additive only — three new tools and one new parser module in the Worker; no data migration, no changes to existing tool behavior. Deploy rides the existing `worker/**` CD. `docs/TOOLS.md` and `docs/PROJECT.md` are already reconciled to the contract; `CLAUDE.md` menu-request orchestration is updated in this change. Rollback is removing the tool registrations (no persisted state is written by these tools beyond the existing `mark_pantry_verified` path).

## Open Questions

- None blocking. The `possible_matches` fuzzy heuristic (token-overlap vs. edit-distance threshold) is an implementation detail to settle during the build against the real corpus; the contract (surface candidates, never auto-match) is fixed.
