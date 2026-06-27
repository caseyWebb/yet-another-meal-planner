## Context

`retrospective` is a pure aggregation (`src/retrospective.ts`) fed by the tool wrapper (`src/cooking-tools.ts → loadRetrospective`), which loads **every** `cooking_log` row for the tenant (the query has no date bound — windowing happens in the pure function) and merges the recipe index with the caller's overlay (`favorite`/`reject`) and derived `last_cooked` into an effective index.

Today `underused` is built by walking that whole index and emitting every non-rejected recipe whose `last_cooked` is null or older than the period window's start (`src/retrospective.ts:128-141`), uncapped. Because the corpus is **communal and discovery-oriented** — most recipes have never been cooked by any one member — and the window is short, this set is approximately the entire shared library minus the handful cooked recently, and it grows as the library grows. Every call silently injects it into the agent's context. (Confirmed: the only consumer that needs the field is the `cooking-retrospective` skill, whose job is to offer one or two recipes to revive.)

The supporting signals already exist: `favorite`/`reject` are per-tenant overlay booleans merged by `mergeOverlay`; `season` is a required may-be-empty string array on every recipe; cook history is the same `cooking_log` rows already loaded. So the fix is a rewrite of one function plus a season-vocabulary pin — no new query, no new storage.

## Goals / Non-Goals

**Goals:**
- Make `underused` bounded by the caller's *own taste*, not the library size, and make it honestly mean "loved things that have gone quiet."
- Capture love declared (favorite) **and** revealed (cooked repeatedly), so the lazy-curator case still surfaces.
- Stop nagging with out-of-season recipes.
- Keep the contract (impl ↔ `docs/TOOLS.md` ↔ `cooking-history` spec) in lockstep; ship with no data migration.

**Non-Goals:**
- Auto-coercing a mistyped `season` on write. The write gate **rejects** an off-vocab token (consistent with `protein`/`cuisine`/`requires_equipment`) rather than silently rewriting it; canonicalizing any pre-existing data is a one-time data-repo fix, not the write path's job.
- Location/hemisphere-aware season derivation. A single self-hosted Worker serves one friend group; Northern-hemisphere months are a documented assumption.
- Surfacing the communal "never cooked by me" discovery set — that is `search_recipes` / discovery territory, deliberately *not* `underused`.
- Auto-starring a revealed favorite (the "graduate to a real favorite" idea is left as a future thread).

## Decisions

### D1 — Membership: loved ∩ stale ∩ in-season, never rejected
`underused = (declared favorite ∪ revealed favorite) ∩ stale ∩ in-season ∩ ¬rejected`. This replaces "not cooked in the window" with a curated-signal gate, which is what bounds the set. *Alternatives:* favorites-only (simplest, but misses the lazy-curator's revealed loves); keep the definition but just cap to top-N (still semantically "everything," just truncated — the count would be meaningless and the tail arbitrary); drop `underused` entirely and lean on `search_recipes(not_cooked_since)` (clean separation, but loses the one-call "summary + a couple to revive" beat the skill wants).

### D2 — Revealed favorite = cooked ≥ 3 times in the trailing 12 months
A behavioral love signal with a recency horizon. The trailing window ages out old phases automatically (a 2024 obsession stops counting in 2026) without the user having to reject anything. *Alternatives:* all-time count ≥ 3 (sticky — resurfaces retired phases forever); threshold of 2 (too weak — two cooks is a coincidence, not a pattern). Both the threshold (3) and horizon (12 months) are single constants, easy to tune. Computed in the pure function from the already-loaded rows — zero extra I/O.

### D3 — Staleness is a fixed 30 days, decoupled from `period`
`period` drives the summary aggregates; `underused` always uses `now − 30d`. This kills the current cross-period incoherence (where `week` / `month` / `all` each produced a wildly different `underused`) and gives the field one stable meaning. A recipe cooked once a year is still underused if that once wasn't in the last 30 days — recency is the rule, not frequency. *Alternative:* scale staleness with the window (re-introduces the incoherence and the over-inclusion for short windows).

### D4 — Season: derive current season from `now`, hard-exclude out-of-season
`seasonOf(now)` via Northern-hemisphere meteorological months (Dec–Feb winter, Mar–May spring, Jun–Aug summer, Sep–Nov fall). A recipe with `season: []` is year-round and always passes; a non-empty `season` must include the current season or it is dropped. *Alternatives:* down-rank rather than exclude (the ask was "don't show out-of-season things" — a hard filter); surface "coming into season soon" (nice, but speculative and out of scope).

### D5 — `SEASON_VOCAB` is a controlled vocabulary enforced at write + build, with read normalization
Add `SEASON_VOCAB = [spring, summer, fall, winter]` and a shared `normalizeSeason` to `src/vocab.js` (+ `src/vocab.d.ts`). The shared required-field contract (`src/recipe-contract.js`, run by **both** the Worker write gate and the build) rejects an off-vocab `season` token exactly as it rejects an off-vocab `requires_equipment` slug — so the two gates can't drift (the contract's load-bearing invariant). The retrospective season match still normalizes (case-fold, `autumn → fall`) so a pre-enforcement value matches on read. *Why strict over normalize-on-write:* it keeps `season` consistent with the existing `protein`/`cuisine`/`requires_equipment` pattern (authored canonical, exact-match) rather than inventing a write-time coercion the other vocabs don't have; any pre-existing non-canonical values are corrected directly in the data repo before deploying (no deterministic migration tool — the corpus is small and agent-operated).

### D6 — One tagged list + a total count + a top-15 cap
Return a single `underused` list, each item tagged `why: "favorite" | "revealed"` and `cook_count` (all-time) so the skill can phrase "you starred this but never made it" vs "you used to make this all the time" differently. `underused_count` carries the pre-cap total; the list is capped to the 15 stalest. The cap is defense-in-depth against a power user who has favorited or revealed hundreds — the original bug's ghost. *Alternative:* two separate lists (`favorites` / `revealed`) — more surface for no real gain, since the skill treats them the same way.

### D7 — `cook_count` is all-time; qualification count is trailing-12-month
The number surfaced for the nudge is the caller's all-time cook count ("you've made this 9 times"), which reads better than the trailing slice. Revealed *qualification* still uses the trailing-12-month count. The two counts can differ (a recipe cooked 9 times total but only twice in the last year is *not* a revealed favorite) — that asymmetry is intentional and is the D2 aging behavior.

## Risks / Trade-offs

- **Revealed love is ambiguous: drifted-away vs burned-out.** The log can't distinguish "I loved this and forgot it" from "I got sick of it." → Explicit `reject` covers the strong case; for the rest the persona *offers* ("you used to make X a lot — still into it?") rather than asserting, consistent with its suggest-don't-nag stance.
- **Hemisphere assumption.** Northern-only `seasonOf`. → Documented as an assumption; acceptable for a single-region friend group; a future change can read profile location if a Southern-hemisphere operator appears.
- **Off-vocabulary season tokens beyond the known synonym.** A recipe tagged `season: ["monsoon"]` will never equal the derived season and is silently excluded from `underused`. → The canonical vocab + read-side `autumn→fall` cover the realistic cases; rare exotic tokens degrade to "treated as out of season," which is conservative (drops, never spuriously nags). The staged write-side canonicalization closes this fully.
- **The cap can hide genuinely-underused recipes.** → `underused_count` tells the agent how many were elided, and the full browse is `search_recipes(not_cooked_since=…)` with real filters. 15 stalest is plenty for one-or-two revival offers.

## Migration Plan

No D1 schema migration. The build now hard-fails on an off-vocab `season`, so any pre-existing non-canonical `season` values in the data repo must be corrected to the vocabulary before deploying (read-side normalization keeps the retrospective correct in the interim and protects any tenant whose D1 was projected before the fix). Code ships via the normal path: merge to `main` → `ci.yml` dispatches the data repo's deploy. Rollback is a straight revert of the `src/recipe-contract.js` season check and `src/retrospective.ts`. The `cooking-retrospective` skill, contract docs, and the plugin rebuild ride the same pass.

## Open Questions

- **Tuning the revealed dials.** 3 cooks / 12 months is the starting point; real history may argue for 2 or for a 9-month horizon. Left as constants to revisit after dogfooding.
- **Graduating a revealed favorite into a declared one.** Should the skill offer to *star* a recipe the member clearly cooks a lot (turning revealed → declared)? Deferred — it adds a write beat to the skill and belongs in its own change.
