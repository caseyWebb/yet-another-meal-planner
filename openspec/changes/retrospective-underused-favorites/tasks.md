## 1. Shared season vocabulary & helpers

- [x] 1.1 Add `SEASON_VOCAB = Object.freeze(["spring","summer","fall","winter"])` to `src/vocab.js` and declare it in `src/vocab.d.ts` (sibling to `PROTEIN_VOCAB`/`CUISINE_VOCAB`/`EQUIPMENT_VOCAB`).
- [x] 1.2 Add a pure `seasonOf(date): Season` helper (Northern-hemisphere meteorological months: Dec–Feb winter, Mar–May spring, Jun–Aug summer, Sep–Nov fall) and a `normalizeSeason(value): string` (case-fold + `autumn → fall`). Keep them pure/unit-testable (in `src/retrospective.ts` or a small sibling module).

## 2. Retrospective rewrite (core)

- [x] 2.1 Update `RetrospectiveResult` in `src/retrospective.ts`: `underused` item becomes `{ slug, title, last_cooked, why: "favorite" | "revealed", cook_count: number }`, and add `underused_count: number`.
- [x] 2.2 In the pure `retrospective()`, compute per-slug cook counts from the (already-loaded, all-time) `entries`: an **all-time** `type=recipe` count (for `cook_count`) and a **trailing-12-month** count (for revealed qualification). No new query.
- [x] 2.3 Replace the `underused` loop with the new rule: emit a recipe WHEN `¬reject` AND (`favorite` OR trailing-12mo count ≥ 3) AND (`last_cooked` is null OR `last_cooked < now − 30d`) AND in-season (`season` empty OR includes `seasonOf(now)`, compared via `normalizeSeason`). Tag `why` (`favorite` if favorited else `revealed`) and `cook_count` (all-time).
- [x] 2.4 Use a **fixed** `now − 30d` staleness cutoff for `underused`, independent of the period `from` (which continues to scope only the mixes/cadence/favorites).
- [x] 2.5 Sort `underused` stalest-first (never-cooked before any cooked, then ascending `last_cooked`, then `slug`); set `underused_count` to the pre-cap total and cap the returned list to the 15 stalest.
- [x] 2.6 Verify `loadRetrospective` (`src/cooking-tools.ts`) still supplies what the rule needs — the effective index carries `favorite`/`reject`/`season`/`last_cooked` (it does, via `mergeOverlay` + frontmatter passthrough); no D1 change.

## 3. Tool surface & contract docs (lockstep)

- [x] 3.1 Update the `retrospective` tool description string in `src/cooking-tools.ts` to describe the new `underused` (loved & quiet & in-season; `why`/`cook_count`), `underused_count`, the fixed 30-day window, and season-awareness.
- [x] 3.2 Update `docs/TOOLS.md` `retrospective` return shape + notes — replace "active recipes not cooked within the window" with the new `underused` item shape, `underused_count`, the fixed-30d/season semantics, and the period-scoping note.
- [x] 3.3 Record the canonical `SEASON_VOCAB` + read-side normalization in `docs/SCHEMAS.md` if season vocab is documented there.

## 4. Persona/skill & plugin

- [x] 4.1 Update the `### Retrospective` section (`<!-- skill: cooking-retrospective -->`) in `AGENT_INSTRUCTIONS.md`: `underused` now means loved recipes gone quiet (in season); phrase revival offers off `why`/`cook_count` ("starred but unmade" vs "you used to make this a lot"), and mention `underused_count` when there are more than shown.
- [x] 4.2 Steer recipe-classification guidance in `AGENT_INSTRUCTIONS.md` to record `season` using `SEASON_VOCAB` tokens (satisfies the canonical-tokens contract on the write path).
- [x] 4.3 Rebuild the plugin bundle with `aubr build:plugin` (needs `$GROCERY_MCP_URL`) so `plugin/grocery-agent/skills/cooking-retrospective/SKILL.md` regenerates — never hand-edit `plugin/`.

## 5. Tests & verification

- [x] 5.1 Rewrite/extend `test/retrospective.test.ts` with one case per `cooking-history` scenario: stale favorite; favorited-but-never-cooked (golden + sorts first); revealed ≥3/12mo (`why: "revealed"`, all-time `cook_count`); one-off excluded; rejected excluded; out-of-season excluded vs `season: []` included; fixed-30d-vs-`period`; cap to 15 + `underused_count`.
- [x] 5.2 Add unit tests for `seasonOf` (month/season boundaries) and `normalizeSeason` (`"Autumn" → fall`, case-fold).
- [x] 5.3 Run `aubr typecheck` and `aubr test` (full suite) — all green.
- [x] 5.4 Run `openspec validate "retrospective-underused-favorites" --strict` — passes.

## 6. Follow-on (separate change — out of scope for this change's acceptance)

- [ ] 6.1 **(DEFERRED — separate follow-on change)** Add hard write-time `SEASON_VOCAB` validation to the shared recipe-field contract (parallel to `EQUIPMENT_VOCAB`), with a migration pass for any legacy off-vocabulary `season` values. Intentionally left for a follow-on so this change ships with no data migration.
