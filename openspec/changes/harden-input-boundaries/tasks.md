## 1. `parseSize` / `parsePrice` finite guards (#59, #60)

- [ ] 1.1 In `src/unit-price.ts` `parseSize`, compute `quantity` then `return null` when `!(quantity > 0) || !Number.isFinite(quantity)` (covers `0`/negative/`NaN`/`Infinity`); apply the same guard to `resolveOverride`
- [ ] 1.2 In `src/unit-price.ts` `parsePrice`, for the string branch: trim leading currency/whitespace and an optional leading `-`; return `null` when the cleaned value has >1 `.` or a `,` after the last `.`; otherwise strip grouping commas and `parseFloat`; numeric branch unchanged
- [ ] 1.3 Unit-test `parseSize`: `"0 x 1 oz"`, `"1/0 gal"`, `"0 oz"` → `null`; valid sizes still parse
- [ ] 1.4 Unit-test `parsePrice`: `"1.234,56"`, `"1.2.3"` → `null`; `"-5.00"` → `-5` (or `null` if we choose to reject negatives — pick one and assert it); `"$1,234.56"` → `1234.56`; numeric `12.5` unchanged
- [ ] 1.5 Unit-test `compare_unit_price` end-to-end: an item with a degenerate size lands in `incomparable`, never as `cheapest`

## 2. `place_order` quantity bounds (#49)

- [ ] 2.1 In `src/order-tools.ts`, change `quantities` to `z.record(z.string(), z.number().int().positive().max(99)).optional()` and `menuNeedShape.quantity` to `z.number().int().positive().max(99).optional()`
- [ ] 2.2 Confirm the existing "non-positive treated as not supplied" precedence text/logic still holds (positivity now enforced at the schema)
- [ ] 2.3 Test: `place_order` with a fractional (`1.5`), zero, negative, or oversized (`100000`) quantity returns a structured `validation_failed` and writes no cart; a valid integer count still resolves
- [ ] 2.4 Update `docs/TOOLS.md` `place_order` if the quantity param contract is user-visible

## 3. `GET /authorize` malformed → 400 (#56)

- [ ] 3.1 In `src/authorize.ts`, wrap the GET `parseAuthRequest`/`lookupClient` block in try/catch; on throw, render the same malformed-request error page the POST path uses with HTTP 400
- [ ] 3.2 Test: a malformed `/authorize` GET query yields a 400 error page, not a 500; a well-formed GET still renders the invite form

## 4. Tenant directory enumeration normalizes ids (#57)

- [ ] 4.1 In `src/tenant.ts` `list()`, wrap the id in `normalizeTenantId(...)` before pushing, matching `get()`
- [ ] 4.2 Test: a directory key written with mixed casing (`tenant:Casey`) is enumerated as the canonical `casey`

## 5. build-plugin rejects path traversal (#68)

- [ ] 5.1 In `scripts/build-plugin.mjs`, augment the resource-path validation: in addition to the `references/` prefix + `.md` suffix checks, reject when `path.normalize(rpath) !== rpath` or any `/`-split segment is `..` (accumulate the error, don't throw)
- [ ] 5.2 Test (build-tooling, `tests/*.mjs`): a resource path `references/../../../tmp/pwned.md` is rejected with a clear error; a normal `references/foo.md` still passes

## 6. Verify

- [ ] 6.1 `aubr typecheck`
- [ ] 6.2 `aubr test` (Worker units) and `aubr test:tooling` (build tooling) green
- [ ] 6.3 `openspec validate harden-input-boundaries --strict`
