## Why

`retrospective`'s `underused` field is defined as "every non-rejected recipe not cooked within the period window." Because the recipe corpus is **communal and discovery-oriented** (most recipes have never been cooked by any one member), and the period window is short (the default is 30 days), this set is effectively *the entire corpus minus the handful you cooked recently* — and it is **uncapped**. Every `retrospective` call silently dumps a list that grows linearly with the shared library into the agent's context. The list is also unactionable: an agent cannot meaningfully "revive" hundreds of slugs, and the persona only ever makes one or two revival offers.

The fix is to stop treating *absence of cooking* as the membership rule and instead scope `underused` to recipes the member has shown they **love** — declared favorites plus behaviorally-revealed ones — that have gone quiet.

## What Changes

- **Redefine `underused`** from "non-rejected recipes not cooked in the period window" to: recipes the caller **loves** AND have **gone stale** AND are **in season**, where:
  - *loves* = `favorite === true` (declared) **∪** cooked **≥ 3 times in the trailing 12 months** (revealed preference, even if never starred);
  - *stale* = `last_cooked` is null (never made) or older than a **fixed 30-day** window;
  - *in season* = the recipe's `season` includes the current season (empty `season` = year-round = always eligible).
- **Decouple the staleness window from `period`.** `underused` always uses a fixed 30 days; the `period` argument now governs only the mixes, cadence, cook-vs-convenience, and ready-to-eat favorites. This removes the current behavior where `week`/`month`/`all` each produce a wildly different `underused` set.
- **Favorited-but-never-cooked is included** as a golden revival signal ("you starred it and never made it").
- **`reject` still excludes**, which now matters again: a revealed favorite the caller later rejected (burned out on) must not resurface.
- **Season-awareness.** Out-of-season loved recipes are dropped so a winter braise stops nagging in June. Current season is derived from `now` (Northern-hemisphere meteorological months — a documented assumption).
- **Richer, bounded output** *(tool-contract change)*: each `underused` item gains `why: "favorite" | "revealed"` and `cook_count` (all-time) so the agent can phrase "starred but unmade" vs "used to be a regular" differently; the result gains `underused_count` (the pre-cap total); the list is capped to the **top-15 stalest** (never-cooked first, then oldest `last_cooked`).
- **Pin a canonical season vocabulary** — `spring | summer | fall | winter` — as a **controlled vocabulary** enforced at **write and build time** through the shared required-field contract (`src/recipe-contract.js`), exactly like `protein`/`cuisine`/`requires_equipment`: an off-vocab token is a hard failure. Read paths still normalize (`autumn → fall`, case-folded) so pre-migration data matches, the classifier emits canonical tokens, and a one-time, re-runnable migration (`scripts/migrate-season-vocab.mjs --root <data-repo>`) canonicalizes legacy `season` frontmatter.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `cooking-history`: the *Retrospective over real cooking history* requirement changes — `underused` is redefined (loved ∩ stale ∩ in-season, declared ∪ revealed), the staleness window is fixed at 30 days independent of `period`, the result is capped with a total count, and each item carries `why`/`cook_count`.
- `recipe-metadata-contract`: `season` becomes a **controlled vocabulary** (`spring | summer | fall | winter`) enforced at write and build time (off-vocab hard-fails, like `requires_equipment`), with read-side normalization for legacy data and a migration to canonicalize source; presence/empty-array rules are unchanged.

## Impact

- **Code:** `src/retrospective.ts` (the new membership rule + season derivation + cap), `test/retrospective.test.ts` (one case per truth-table row). No new D1 query — `loadRetrospective` already loads every cooking-log row, so all-time and trailing-12-month counts are computed in the pure function.
- **Contract docs (lockstep):** `docs/TOOLS.md` (the `underused` return shape + notes, currently "active recipes not cooked within the window"); `docs/SCHEMAS.md` if the season vocabulary is recorded there.
- **Tool consumers:** the `cooking-retrospective` skill — the `underused` semantics and shape change, so the skill's framing is revisited in lockstep (it already treats `underused` as "a few to revive," so the change is small).
- **Season vocab enforcement + migration:** the `season` check in `src/recipe-contract.js` (both gates), classifier guidance in `AGENT_INSTRUCTIONS.md`, and a new `scripts/migrate-season-vocab.mjs` (operates on a data checkout via `--root`; `--check` dry-runs) that operators run once before deploying the gate.
