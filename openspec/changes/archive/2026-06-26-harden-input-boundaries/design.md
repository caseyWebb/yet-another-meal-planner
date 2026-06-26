## Context

These six fixes are independent and individually trivial; the only shared decisions worth recording are the exact guard semantics (so the implementer doesn't have to re-derive them) and where each guard lives relative to the determinism boundary.

## Decisions

### #59 `parseSize` — guard the computed quantity, not the inputs
Add a single post-computation check before the return:
```ts
const quantity = num * unit.factor * multiplier;
if (!(quantity > 0) || !Number.isFinite(quantity)) return null;
```
`!(quantity > 0)` rejects `0`, negatives, and `NaN`; `!Number.isFinite` rejects `Infinity`. Guarding the product (rather than each of `num`/`multiplier`/`factor`) covers every degenerate path — zero multiplier, `1/0` fraction, zero numeric — in one place. `resolveOverride` (reachable via `quantity_override`) gets the same guard so a `quantity_override: 0` also routes to `incomparable`.

### #60 `parsePrice` — reject ambiguity rather than guess a locale
We do **not** try to parse European grouping; we make ambiguous input fail closed. After trimming a leading currency symbol/whitespace and an optional leading `-`:
- reject if the cleaned string contains more than one `.` (e.g. `"1.2.3"`, `"1.234,56"` after comma-strip),
- reject if a `,` appears after the last `.` (decimal-comma locale),
- otherwise strip grouping commas and `parseFloat`.
The numeric branch is unchanged (Kroger's own prices arrive as numbers). This keeps US-formatted strings working and turns the silent 1000×/sign-drop bugs into a clean `null` → `incomparable`.

### #49 `place_order` — validate at the Zod schema, the outermost point
Tighten the schema rather than `computeToBuy`, so the rejection happens before any resolution work and surfaces as the standard schema `validation_failed`:
- `quantities: z.record(z.string(), z.number().int().positive().max(99)).optional()`
- `menuNeedShape.quantity: z.number().int().positive().max(99).optional()`
`99` is an arbitrary-but-ample per-line package ceiling (a grocery order never legitimately needs 100+ of one SKU); it exists to stop an LLM/typo `100000` from becoming a real order, not to model a real limit. The existing "non-positive treated as not supplied" precedence text stays accurate (positivity is now enforced, not silently coerced).

### #56 `GET /authorize` — mirror the POST path exactly
Wrap the `parseAuthRequest` call in try/catch and render the same `renderForm`/error page the POST path uses, with status 400. No new copy, no behavior change for valid requests.

### #57 `TenantStore.list()` — normalize on the way out
One-line change: `ids.push(normalizeTenantId(k.name.slice(DIRECTORY_PREFIX.length)))`, matching `get()`. The case-insensitivity spec already mandates canonical ids "at every boundary that derives a key from the username"; `list()` is such a boundary (group-aggregation tools build `users/<id>/...` paths and `profile:<id>` keys from it).

### #68 build-plugin — reject `..`, keep the existing prefix/extension checks
Augment the current `startsWith('references/') && endsWith('.md')` validation with a traversal check: reject when `path.normalize(rpath) !== rpath` or any segment equals `..`. Belt-and-suspenders option (compute the resolved destination and assert it stays under `skills/<name>/`) is noted but the segment check is sufficient and cheaper. Stays an accumulated build error, not a throw, consistent with the existing validator.

## Risks / Trade-offs

- **The `max(99)` ceiling is a judgment call.** If a real flow ever needs a bulk per-line count it would have to be raised; chosen because no current flow does, and the downside of omitting a ceiling (an unbounded real order) is worse than a future schema bump.
- **`parsePrice` fails closed on ambiguous input.** A genuinely European-formatted string now returns `null` instead of a (wrong) number — correct per the determinism-boundary intent (unparseable → `incomparable`), and Kroger's numeric prices are unaffected.

## Out of scope
SSRF/fetch hardening (#53/#54/#55/#67) and the stale issues (#63, recipe-#66) — called out in the proposal.
