## 1. Alias target convergence (sku-cache-rekey pass)

- [x] 1.1 Add the pure planner to `src/sku-cache-rekey.ts`: `planAliasRetarget(aliases, chase)` returns `{ variant, id }` updates for rows where `chase(row.id) !== row.id` (identity-chain chase only; ids without identity rows resolve to themselves and plan nothing)
- [x] 1.2 Wire the step into `rekeySkuCache`: read `readAliasTargets(env)` alongside the existing resolver/identity reads, batch `UPDATE ingredient_alias SET id = ?2 WHERE variant = ?1` statements (id column only), bounded by `SKU_REKEY_MAX_PER_TICK` with the remainder setting `truncated`; add `alias_retargeted` to `SkuRekeyResult` and the job summary
- [x] 1.3 Update `src/audit-admin.ts`: include `alias_retargeted` in `SKU_FIELDS` and in the sku branch of `tickOf` so a retarget tick counts as work (and is not "settled")
- [x] 1.4 Vitest (`test/sku-cache-rekey.test.ts`): re-point through the chain incl. a 3-segment loser fixture; self-alias-of-loser becomes a real mapping; `source`/`confidence`/`decided_at`/`audited_at` preserved; idempotent no-op when converged; id absent from identity registry untouched; resolver-read failure converges nothing; summary shape
- [x] 1.5 Vitest (`test/audit-admin.test.ts`): the sku pass derivation counts `alias_retargeted` as worked/changed

## 2. Mappings-only alias listing (admin)

- [x] 2.1 `src/normalize-admin.ts`: filter `NormalizationPage.aliases` to stored `variant !== id` rows and add `aliasSelfCount`; keep the Aliases stat tile on the full front-door count
- [x] 2.2 `src/admin/pages/normalize.tsx` (`AliasesTab`, shared by SSR + island): render the mappings-only set (search/source pills/pagination/footer counts now over mappings) and add the canonical-entries count chip (Basecoat outline badge) beside the source pills; tab pill count = mappings
- [x] 2.3 Vitest (`test/normalize-admin.test.ts`): seed a canonical self-entry; assert it is excluded from `aliases`, counted in `aliasSelfCount`, and the stat tile still counts all rows

## 3. Playwright (admin-ui gate)

- [x] 3.1 `admin/visual/seed.mjs` (+ `seed.d.mts`): add a canonical self-entry alias row to the normalize fixture
- [x] 3.2 `admin/visual/pages/normalize.page.ts`: locators/assertions for alias rows and the canonical-entries chip
- [x] 3.3 `admin/visual/specs/normalize.spec.ts`: assert the self-entry renders no row, the mappings render, the chip shows the count; capture an ASCII-named screenshot of the aliases tab
- [x] 3.4 Run the full Playwright suite green (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) and regenerate affected screenshots

## 4. Docs + verification

- [x] 4.1 `docs/SCHEMAS.md`: note on `ingredient_alias` that stored `id` targets converge to surviving ids each tick (reconciled by the sku-cache-rekey pass); `docs/ARCHITECTURE.md`: add the alias retarget to the reconcile enumeration if listed
- [x] 4.2 Full battery: typecheck (worker + contract + scraper), `vitest run`, Playwright suite, `openspec validate "alias-target-convergence"`
