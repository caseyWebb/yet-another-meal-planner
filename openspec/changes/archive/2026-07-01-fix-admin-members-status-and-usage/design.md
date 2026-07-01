## Context

Four fixes diagnosed against the operator's real deployment (remote D1 queried directly; all migrations applied). Three touch `src/usage.ts` (KV colors, namespace labels, AI history); one touches `src/admin.ts` (Members roster status). None require a new D1 migration or a new binding type. Grant lookup (Fix 1) needs the `@cloudflare/workers-oauth-provider` package's internal KV key format, which is not documented in `docs/` — this design pins it down from the installed package's source so the apply step doesn't have to re-derive it.

## Goals / Non-Goals

**Goals:**
- Members roster status reflects whether the member has completed the Claude.ai OAuth connection at least once, not recent MCP tool-call activity.
- Every KV namespace in the Usage view gets a visually distinct, non-grey color regardless of whether its friendly name resolves.
- Namespace friendly labels come from our own deploy-time config (the merged `kv_namespaces`), not a runtime Cloudflare REST call requiring an extra token scope.
- The Workers-AI neuron meter shows a 30-day sparkline, mirroring the existing KV history sparkline.

**Non-Goals:**
- Not building a Data > Stores enhancement (surfacing candidate stores from `sku_cache`) — that is a separate, operator-driven decision.
- Not changing the Kroger-linked status derivation (`KROGER_KV` prefix `list()`) — it is already correct and is the pattern Fix 1 mirrors.
- Not adding a new `KVNamespace`/analytics binding, D1 table, or migration.
- Not changing the free-tier limits table or the day-snapshot semantics for KV/AI (only the AI *history* is new).

## Decisions

### Decision 1 — Fix 1: derive Members status from an `OAUTH_KV` grant, keyed by `grant:<tenantId>:<grantId>`

Reading the installed `@cloudflare/workers-oauth-provider@0.8.1` package (`node_modules/@cloudflare/workers-oauth-provider/dist/oauth-provider.js`), the provider persists every completed authorization grant under the KV key:

```
grant:<userId>:<grantId>
```

(see `saveGrantWithTTL`, `revokeGrant`, and `listUserGrants`, all of which build `grant:${userId}:${grantId}` / list with `prefix: \`grant:${userId}:\``). `userId` is whatever value the caller passes to `completeAuthorization({ userId, ... })`. Our own `src/authorize.ts` `handleAuthorize` POST handler calls:

```ts
await env.OAUTH_PROVIDER.completeAuthorization({
  request: oauthReqInfo,
  userId: tenantId,
  scope: oauthReqInfo.scope,
  metadata: { label: tenantId },
  props: { tenantId },
});
```

So `userId` is the canonical (lowercase) `tenantId` — the same id used everywhere else in the roster (`tenant:*` allowlist ids, `kroger:refresh:<id>`, `tenant_activity.tenant`). This means "does tenant X have at least one connection" is answerable with a single prefix `list()` over `OAUTH_KV` with `prefix: \`grant:${tenantId}:\`` — but since `listTenants` must answer this for *every* tenant in one pass (no N+1), the correct query is a **single unprefixed-by-tenant `list()` over `prefix: "grant:"`**, extracting the `userId` segment from each returned key name (`grant:<userId>:<grantId>` — split on `:`, first segment after `grant:` is the tenant id) and building a `Set` of tenant ids that have at least one grant key. This exactly mirrors the existing `krogerLinked` pattern (`listAllKeys(deps.krogerKv, KROGER_REFRESH_PREFIX)` then `.slice(prefix.length)` — except here the id is not a fixed-length suffix but the first `:`-delimited segment, since the grant id follows it).

`OAUTH_KV` also holds `client:*`, `token:<userId>:<grantId>:<tokenId>`, and code-exchange entries — but grants are the durable "this user has authorized" record (access/refresh tokens expire and get rotated; the grant is revoked explicitly, e.g. on `revokeAuthorizationsForClient`, not on token expiry), so the grant's presence — not a live/unexpired token — is the correct "connected" signal. A revoked grant (member manually disconnected in Claude.ai) correctly reports back to "pending."

**Key implementation detail flagged for the apply step:** confirm at implementation time (via a `wrangler dev`-backed test seeding `OAUTH_KV` through the real `completeAuthorization` flow, or a unit test constructing the key directly) that the `grant:` prefix and `:`-delimited `userId` segment match the installed provider version pinned in `package-lock.json` — this design reads the currently-installed `0.8.1`, but the key format is an internal implementation detail of a third-party package, not a documented public contract, so a future bump could change it silently.

`AdminDeps` (`src/admin.ts`) gains an `oauthKv: KvStore` dependency (or reuses the existing `KvStore` typing already used for `krogerKv`/`tenantKv`) bound to `env.OAUTH_KV`.

### Decision 2 — Fix 2: position-based color assignment, decoupled from label resolution

Today, `resolveNamespaceLabel` in `src/usage.ts` returns `{ label, color, unlabeled }` as one unit — `color` is only set when a binding name resolves (else `UNLABELED_COLOR`, effectively grey). This conflates two independent concerns: "what do we call this namespace" (label — genuinely dependent on resolution) and "how do we visually distinguish namespaces" (color — should not depend on resolution at all, since two unlabeled namespaces still need to look different from each other in a stacked meter).

Fix: compute color from the **sorted list of all namespace ids observed in the current payload** (snapshot + history), cycling a fixed categorical palette by index — `color = PALETTE[sortedIds.indexOf(namespaceId) % PALETTE.length]`. This is computed once per `mapAccountUsage`/`mapKvHistory` call (both already receive the full namespace-id set) and passed down instead of being decided inside `resolveNamespaceLabel`. `resolveNamespaceLabel` (or its replacement) becomes label-only: REST title (being removed, see Decision 3) → `KV_NAMESPACE_LABELS` → raw id.

Sorting the ids gives a **stable** assignment across requests within a deployment (the same three namespace ids always sort the same way), though not necessarily stable across an operator's namespace-id churn (a new namespace id shifts everyone after it in sort order) — acceptable since the payload always includes the resolved label alongside the color, so a shifted color is still legible via its label, and this only happens if the *set* of KV namespaces changes (a `wrangler.jsonc` edit), not on ordinary operation.

Palette size: reuse the existing 3-color warm palette (`--kv-kroger`/`--kv-oauth`/`--kv-tenant`) plus `--kv-unlabeled` is no longer a "grey fallback" but simply drops out — cycling means a 4th+ namespace id (not expected at this Worker's fixed 3-binding KV set, but the `NAMESPACE_PALETTE` today is already indexed by binding name, not count) reuses palette colors round-robin rather than falling back to grey. Document in the CSS/palette comment that grey is no longer a valid steady-state color for any *known-count* namespace.

### Decision 3 — Fix 3: `KV_NAMESPACE_LABELS` populated by the wrangler-config merge, `fetchNamespaceTitles` deleted

`scripts/merge-wrangler-config.mjs` already builds `out.kv_namespaces` from the code repo's binding set + the operator's provisioned ids (`mergeKvNamespaces`). Add a step that, after computing `out.kv_namespaces`, derives `id:BINDING` pairs for every namespace that has an id (i.e. every namespace after at least one deploy has provisioned + pinned it back — see the cold-start caveat below) and folds them into `out.vars.KV_NAMESPACE_LABELS` as a comma-joined string (`<id1>:<BINDING1>,<id2>:<BINDING2>`), consistent with the format `parseNamespaceLabels` in `src/usage.ts` already parses. This is additive to whatever `vars` the operator config already supplies (merge, not overwrite) — `KV_NAMESPACE_LABELS` specifically is now deploy-derived rather than operator-authored, so if the operator's own config also sets it, the deploy-derived value wins (it is definitionally more accurate than a hand-maintained one).

Then delete `fetchNamespaceTitles`, its call site in `fetchUsage`, the `restTitles`/`restTitlesPromise` plumbing through `mapAccountUsage`/`mapKvHistory`, and the "Workers KV Storage: Read" scope requirement from the module-header comment and `docs/SELF_HOSTING.md` (if it documents that scope). The fallback chain collapses from three steps (REST title → `KV_NAMESPACE_LABELS` → raw id) to two (`KV_NAMESPACE_LABELS` → raw id).

**Cold-start caveat** (explicitly surfaced per the task): the committed `wrangler.jsonc` is id-less by design (ids are the operator's provisioned resources, stripped from the maintainer's committed config for cross-tenant safety — see `mergeWranglerConfig`'s doc comment). `KV_NAMESPACE_LABELS` can therefore only be populated from the **merged/deployed** config, which only has real ids *after* wrangler's first deploy auto-provisions them and `pinKvIds` pins them back into the operator's data-repo config. A brand-new operator's very first deploy therefore ships with `KV_NAMESPACE_LABELS` absent (no ids yet to derive it from) — the Usage page falls straight to the raw-id fallback for that one deploy. The *next* deploy (after `pinKvIds` has run) picks up the now-known ids and populates `KV_NAMESPACE_LABELS` correctly. This is acceptable and should not require a special-cased "first deploy" affordance — it self-heals on the next normal deploy.

### Decision 4 — Fix 4: widen the AI query to 30 days, add `mapAiHistory`

Mirror the KV history precedent exactly (Decision 1/4 in the existing `usage-trends`-adjacent design, referenced in `src/usage.ts`'s module comments): widen `aiInferenceAdaptiveGroups`'s filter from `datetimeHour_geq/_leq` (today only) to a `date_geq`/`date_leq` range covering `TRENDS_WINDOW_DAYS` (the same constant the KV history and both AE-based trends already share), and add `date` to its `dimensions`. Add a pure `mapAiHistory(rows, windowStartDay, windowEndDay)` function mirroring `mapKvHistory`'s zero-fill-every-day behavior (a day with zero neurons for the window still reports `0`, never an absent entry), returning `{ window_days, days: { day, neurons }[] }` (no per-model breakdown needed for the sparkline — `by_model` already exists for the day-snapshot chip row). `UsageResult.ai` gains a `history` field of this shape, alongside the existing `neurons_limit`/`neurons_used`/`by_model`.

`src/admin/pages/usage.tsx`'s `NeuronMeter` renders this history with the same `SparklineTrack`-style column rendering the KV meter already uses (or the simpler per-job `sparkline()` ASCII-tick helper already present in this file, extended to accept a labeled tooltip) — replacing the "Today's value only — Cloudflare's Workers AI analytics do not expose a confirmed daily-history series" note, which becomes false once this ships.

Required token scope: "Account Analytics: Read" — the same scope `fetchUsage`'s existing GraphQL calls already require, so no new operator-facing scope requirement.

## Risks / Trade-offs

- **[Risk] The `grant:<userId>:<grantId>` key format is an internal, unversioned-as-a-contract detail of `@cloudflare/workers-oauth-provider`.** → Mitigation: pin the exact key-parsing logic behind one small helper (e.g. `oauthGrantTenantIds(kv)`) so a future package bump only requires updating that one function; add a unit test asserting the parse against a synthetic `grant:*` key so a format change fails loudly in CI rather than silently misreporting every member as pending.
- **[Risk] A single unprefixed `list()` over `prefix: "grant:"` in `OAUTH_KV` could, in principle, return a large number of keys (multiple grants per tenant, e.g. re-authorizations) if grants are never cleaned up.** → Mitigation: this mirrors the existing `KROGER_KV` `listAllKeys` pattern already used for the same roster call (unbounded pagination, single call), so the cost profile is unchanged from what `listTenants` already does; a `Set` de-dupes to one entry per tenant regardless of grant count.
- **[Risk] Position-based color assignment can reassign colors when the namespace-id set changes (e.g. a KV namespace is added/removed/re-provisioned).** → Mitigation: acceptable — this only happens on a `wrangler.jsonc`/binding change, not steady-state operation, and the label is always shown alongside the color so a shifted color is not confusing.
- **[Risk] `KV_NAMESPACE_LABELS` is now deploy-owned; an operator who previously hand-set it will have their value silently overridden by the merge.** → Mitigation: document in `docs/SELF_HOSTING.md` that `KV_NAMESPACE_LABELS` is no longer an operator-authored var (it is deploy-derived); this is a net simplification (one fewer thing to hand-maintain), not a functional regression, since the deploy-derived value is definitionally accurate for that operator's own bindings.
- **[Risk] Cold-start (first-ever deploy) ships without `KV_NAMESPACE_LABELS`.** → Mitigation: explicitly accepted (see Decision 3) — self-heals on the operator's next normal deploy, no special-casing needed.

## Open Questions

- Exact palette size/colors for Decision 2 beyond the existing 3 CSS custom properties (`--kv-kroger`/`--kv-oauth`/`--kv-tenant`) — the apply step should confirm whether `--kv-unlabeled` is repurposed as a 4th cycling color or the palette stays fixed at 3 (matching the Worker's fixed 3-binding KV set) with round-robin reuse never actually triggering in practice.
- Whether `docs/SELF_HOSTING.md` currently documents the "Workers KV Storage: Read" scope as a requirement (Fix 3 removes that requirement) — confirm and update in the same pass per the "keep contract docs in lockstep" rule.
