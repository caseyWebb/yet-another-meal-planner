## Why

A live diagnosis against the operator's real deployment (remote D1 queried, all migrations applied) surfaced four admin-panel defects/gaps: the Members roster mislabels connected-but-idle members as "pending / awaiting connection"; the Usage KV meters render every namespace grey when the analytics token lacks KV-read scope; namespace labeling depends on a runtime Cloudflare REST call the operator would rather not need scoped at all; and the Workers-AI neuron meter was left at "today only" pending confirmation that a 30-day history field exists — which a live API probe has now confirmed.

## What Changes

- **Members roster status** (`src/admin.ts` `listTenants`): derive `TenantRosterRow.status` from whether an OAuth grant exists for the tenant in `OAUTH_KV` (a `grant:<tenantId>:<grantId>` prefix `list()`, mirroring the existing Kroger-linked `list()` pattern), not from a `tenant_activity` row. `tenant_activity` continues to supply `joined`/`lastActive` only — it stops being the status source. This fixes members who completed the Claude.ai OAuth connection but haven't been active recently showing as wrongly "pending."
- **KV meter colors are position-based** (`src/usage.ts`): assign each namespace id a stable categorical color by sorted-id index, independent of whether the id resolves to a known binding name. The friendly-name fallback chain still governs the text label only; a namespace with an unresolved name still gets a distinct, non-grey color.
- **Namespace labels sourced from deploy config, not a runtime Cloudflare lookup** (`src/usage.ts`, `scripts/merge-wrangler-config.mjs`): delete `fetchNamespaceTitles` (the `GET .../storage/kv/namespaces` REST call and its "Workers KV Storage: Read" scope requirement) and its call site. The merge script emits `KV_NAMESPACE_LABELS` (`id:BINDING,...`) into the deployed `vars` from the merged `kv_namespaces` array (which already carries binding + operator-provisioned id) — labels become a deploy-time artifact of our own config, never a live API dependency.
- **Workers-AI 30-day history** (`src/usage.ts`, `src/admin/pages/usage.tsx`): widen the `aiInferenceAdaptiveGroups` query to a 30-day `date_geq`/`date_leq` range with `date` added to `dimensions`, add a `mapAiHistory` mirroring `mapKvHistory`, and render the neuron sparkline in the Usage page (replacing the "today's value only" note).

Not in scope: Data > Stores shows empty because the operator's `stores` table has zero rows (no `add_store` has been run) — not a bug, no code change. A possible future enhancement (surfacing candidate stores from `sku_cache` location ids) is left for a separate, operator-driven change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `operator-admin`: the "Tenant listing is operational-only" requirement's active/pending status semantics change from activity-derived to OAuth-connection-derived.
- `usage-observability`: the KV-namespace label/color requirement changes so color assignment is always position-based (never dependent on label resolution) and friendly-label resolution comes from a deploy-time `KV_NAMESPACE_LABELS` var populated by the wrangler-config merge (no runtime Cloudflare REST namespace lookup); a new requirement covers the Workers-AI 30-day neuron history, mirroring the existing KV history requirement.

## Impact

- `src/admin.ts` (`listTenants` — status derivation), `src/oauth.ts`/`src/authorize.ts` (referenced for how grants are keyed; no functional change there)
- `src/usage.ts` (`resolveNamespaceLabel`, `NAMESPACE_PALETTE`, deletion of `fetchNamespaceTitles`, `mapAccountUsage`/`mapKvHistory` color assignment, new `mapAiHistory`, widened AI query)
- `src/admin/pages/usage.tsx` (render the AI sparkline; drop the "today's value only" note)
- `scripts/merge-wrangler-config.mjs` (emit `KV_NAMESPACE_LABELS` into deployed `vars` from merged `kv_namespaces`)
- `docs/TOOLS.md`/`docs/SCHEMAS.md`/`docs/ARCHITECTURE.md` as needed to keep the contract docs in lockstep with the `TenantRosterRow.status` semantics and the usage payload shape
- No new D1 migration, no new KV/D1/binding type (OAUTH_KV and the `vars` mechanism already exist)
