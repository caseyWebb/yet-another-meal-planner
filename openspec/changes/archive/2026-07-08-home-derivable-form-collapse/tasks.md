# Tasks — home-derivable-form-collapse

Small, serial change. **No spike tasks** — the open questions (which production detail nodes are
home-derivable, whether the backlog is stamped, what the defect rows look like, how the stale facet
snapshots converge) are settled in `design.md` against the production spikes. The code surface is
one prompt file + one data-gate migration; everything else is the spec, tests, and the post-deploy
acceptance verification.

## 1. Confirm-prompt hardening (`packages/worker/src/ingredient-classify.ts`)

- [x] 1.1 Replace the `SYSTEM_PROMPT` PREPARATION rule (the "diced, minced, shredded, softened" line) with the **purchasable-distinction test**: a qualifier is load-bearing only when the qualified form is a DIFFERENT product on the shelf; a preparation or cut form the shopper derives at home from the purchased base by ordinary kitchen work ("diced", "minced", "shredded", "softened", "wedges", "slices", "quarters", "zest") is NOT a detail — pick same on the base (lime wedges = lime; diced yellow onion = yellow onion); the SAME word may dispose either way by product (diced tomatoes names a canned shelf product — a specialization; diced yellow onion is knife work — same). Add, adjacent to the distinct-product rules, the extraction carve-out: a home-derived extraction that is ALSO a distinct purchasable product (lime juice — bottled) is NEVER same as its source product in either direction. Keep the conservative-collapse bias sentence intact next to the new rule.
- [x] 1.2 Add two `FEW_SHOT` examples pinning the contrast: `"lime wedges"` over candidates including `{"id":"lime"}` → `{outcome:"same", match:"lime"}` (reason: wedges are knife work on the purchased lime); `"diced tomatoes"` over candidates including `{"id":"tomatoes"}` → `{outcome:"specialization", match:"tomatoes", detail:"form-diced"}` (reason: canned diced tomatoes are a distinct shelf product). Match the existing few-shot comment style (each example states the mistake class it prevents).
- [x] 1.3 `aubr typecheck` + `aubr test` (the existing `ingredient-normalize`/`ingredient-alias-audit` unit suites are prompt-agnostic — mocked confirms — and must stay green unchanged).

## 2. Tests

- [x] 2.1 Extend `packages/worker/test/ingredient-alias-audit.test.ts` with the lime-shaped fixture: a re-opened (un-stamped) auto row `'lime wedges'` → `lime::form-wedges` whose mocked confirm returns SAME `lime` → asserts the alias re-points to `lime` with a fresh auto `decided_at` + stamp, and the stranded `lime::form-wedges` (no remaining aliases) is merged into `lime` via the `merge` dep (`mergedOrphan` counted); plus the no-churn twin: a row whose mocked confirm re-derives the standing detail mapping (SAME on the survivor) is kept + stamped with no merge. (Reuse the existing harness/deps — this pins the exact convergence path design.md D3 relies on; the self-loop sweep after the merge is already covered by `ingredient-edge-audit.test.ts`'s pre-pass specs.)
- [x] 2.2 Add the hard cases to `packages/worker/test/ingredient-normalize.live.test.ts` (creds-gated, run manually): `"lime wedges"` with candidates `[lime, lemon, lime juice]` → `same`/`lime`; `"diced tomatoes"` with candidates `[tomatoes, tomato paste]` → NOT a same-to-`tomatoes` collapse (specialization on `tomatoes` or same on a standing `tomatoes::form-diced` both acceptable); `"lime juice"` with candidates `[lime, lemon juice]` → `novel` (never same/specialization onto `lime`). Run the live suite once with real creds and record the verdicts in the PR.

## 3. D1 migration — re-open the detail-node alias backlog

- [x] 3.1 Add `packages/worker/migrations/d1/0043_reopen_detail_alias_audit.sql` (next available number): `UPDATE ingredient_alias SET audited_at = NULL WHERE source = 'auto' AND id LIKE '%::%';` with a header comment stating why (home-derivable-form-collapse: the purchasable-distinction hardening re-opens the drained detail-node backlog — 113 stamped rows in production — so the rolling alias re-audit re-decides them organically; human rows and base-target rows are out of scope; no schema shape change, so no `docs/SCHEMAS.md` drift).
- [x] 3.2 Verify locally: `npx wrangler d1 migrations apply DB --local`, seed a stamped auto detail-target row + a human row + a base-target auto row, apply, and confirm only the auto detail-target row's `audited_at` is NULL.

## 4. OpenSpec + docs

- [x] 4.1 Apply the `ingredient-normalization` spec deltas (MODIFIED "Conservative collapse and prep-versus-product stripping", MODIFIED "Structural edge guarantee", ADDED "Purchasability re-audit re-opening for standing detail-node aliases") to `openspec/specs/ingredient-normalization/spec.md`; `openspec validate "home-derivable-form-collapse"`.
- [x] 4.2 Confirm the no-drift stance: no `docs/TOOLS.md` change (no tool contract touched), no `docs/SCHEMAS.md` change (data-gate migration only, no shape change), no `docs/ARCHITECTURE.md` change (no architectural shift). `AGENT_INSTRUCTIONS.md` untouched (satisfaction semantics unchanged for the agent — equality, plus the existing substitution suggestion path).

## 5. Post-deploy acceptance verification (read-only, against production)

- [ ] 5.1 After the deploy and enough cron ticks for the re-opened backlog (≤113 rows at the re-audit's per-tick bound) plus the projection round-trip, run the design.md acceptance-fixture queries: `'lime wedges'` alias → `lime`; `lime::form-wedges` representative → `lime`; zero edges from `lime::form-wedges`; both fixture recipes' `perishable_ingredients` carry `lime`; `lime juice` unmerged with its alias intact and no `lime`↔`lime juice` edge; the re-opened backlog fully re-stamped with the purchasable mappings (`pickle chips`, `canned tuna`) still on their detail nodes.
- [ ] 5.2 Close issue #215 with the fixture evidence (before/after rows).
