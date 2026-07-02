## Context

`packages/scraper` is a home-network daemon that logs in to paid recipe sites with the operator's own subscription session, extracts functional recipe facts, and POSTs them to the Worker's `POST /admin/api/ingest`, where the discovery sweep drains them as a third intake arm. It exists because `acquireRecipeContent` runs from the Cloudflare edge and every walled fetch returns `unreachable` — the fetch is the *only* source-specific step of the sweep, so a home box that does the fetch behind the operator's session unlocks the rest of the pipeline unchanged. The wire contract (`packages/contract/src/ingest.ts`) is the drift-proof boundary both runtimes import: `IngestBatch { source, scraper_version, contract_version, recipes: RecipeItem[] }`, `CONTRACT_VERSION = "v1"`.

That same off-cloud, session-holding, outbound-only box is the right place for two future jobs the edge can't do: reading loyalty/in-store sale prices (a store login gates them) and filling a cart on a store the Worker has no session for. This change is the **foundation** of that initiative — it renames the concept, generalizes the contract to admit new observation kinds cleanly, and codifies the trust discipline so the later capabilities inherit it rather than inventing it. It is deliberately narrow: mechanical rename + a contract restructure + a spec-level statement of principle. No new capability, no behavior change to recipe ingestion.

**Production spike (this operator's instance, read-only via `wrangler d1 execute DB --remote`):** `SELECT COUNT(*)` on `ingest_keys`, `ingest_candidates`, and `ingest_pushes` all returned **0** — no satellite has ever been provisioned or pushed here. So on this instance the rename and v2 restructure carry zero in-flight-data risk, and there is no v1 producer to break. Because the product is self-hosted and multi-operator, other operators' instances are not queryable from here; the accept-both-v1-and-v2 posture below is retained for *their* benefit (an operator whose deployed satellite image still emits v1), not this instance's.

## Goals / Non-Goals

**Goals:**
- Rename the concept `scraper → satellite` completely enough that the living contract, the code vocabulary, the operator-facing labels, and the docs all read "satellite" — while touching **no** deployed DB object or wire path.
- Generalize the wire contract to a capability-tagged, observations-only discriminated union so the later `sale-scan`/`order-fill` capabilities add without a v2-breaking change.
- Make the v1→v2 transition non-breaking: the Worker accepts both; a lagging producer degrades to a visible skew flag, not a rejected push.
- Write the **sensor-not-judge** trust discipline into the `satellite` spec as capability-agnostic requirements the later capabilities inherit.

**Non-Goals:**
- No new user-visible capability. Recipe ingestion behaves identically (same functional facts, same sweep, same dedup).
- No `sale-scan` or `order-fill` contract, endpoint, tenancy, or code — those are later changes; this change only keeps the extension point clean.
- No pull channel / inbound path (change 2). The satellite stays push-only here.
- No DB rename, no migration, no schema change.
- No wire-endpoint rename (`/admin/api/ingest` stays; see decision 3).

## Decisions

### 1. The name is **satellite**

Not "scraper" (recipe-specific, and legally loaded), not "worker" (collides with the Cloudflare Worker), not "agent" (collides with the Claude agent). A **satellite** is an operator-run node that orbits the Worker: it holds sessions the Worker can't, does bounded observation on the LAN, and reports home over an outbound link. The metaphor also carries the trust posture — a satellite is an instrument that *senses and relays*, not a control authority.

The rename covers: the package (`packages/satellite`, `@grocery-agent/satellite`, CLI `grocery-satellite`), the OpenSpec capability (`walled-source-scraper` → `satellite`), the Worker's internal identifiers and comments (`readScraperLiveness` → `readSatelliteLiveness`, `ScraperLiveness` → `SatelliteLiveness`, etc.), the admin labels/routes, the Playwright page objects, and the docs.

### 2. The satellite is strictly **outbound-only** (hard constraint)

The LAN box **calls out**; the Worker **never dials in**. No inbound listener, no websockets, no long-lived connection the Worker initiates, no stateful Workers/Durable Objects on the data path. This is a security and topology invariant (a home box behind NAT should never need a port opened), and it is the reason the future pull channel (change 2) will be a satellite-initiated **fetch**, not a Worker push. Stated as a spec requirement so no later capability quietly violates it.

### 3. Keep the wire endpoint, the env var, and the DB names as `ingest_*`

`POST /admin/api/ingest` stays the canonical path; `INGEST_API_KEY` stays the env var; `ingest_keys` / `ingest_candidates` / `ingest_pushes` and their migrations keep their names.

*Rationale:* Renaming a **deployed DB object** is pure risk (a migration to rename tables/columns, all call-sites, for zero behavior gain) — explicitly out of bounds. Renaming the **wire path** would break any already-deployed producer (a self-hosted operator's running scraper container) for no contract benefit; "ingest" is already capability-neutral (a satellite *ingests* observations of any kind). The one column that reads "scraper" is `ingest_keys.last_scraper_version` — it **stays**; the v2 `satellite_version` wire field maps onto it. If a later change wants `/satellite/*` routes (the pull channel likely will), it SHOULD add them as **new** paths and keep `/admin/api/ingest` as an accepted alias — never move the existing one. This change introduces **no** new path and **no** alias; it is a rename of everything *except* the wire/DB surface.

### 4. The v2 contract: capability-tagged envelope + observations-only discriminated union

The wire types in `packages/contract/src/ingest.ts` restructure to (sketch — implementation owns the exact Zod):

```ts
export const CONTRACT_VERSION = "v2";

// A satellite declares the capabilities it runs. recipe-scrape is the ONLY one
// in this change; the union/enum is the clean extension point for scan/order.
export const CAPABILITIES = ["recipe-scrape"] as const;
export type Capability = (typeof CAPABILITIES)[number];

// Observation items are a discriminated union keyed by `kind`. Adding a new kind
// later (e.g. "sale") does NOT break a v2 consumer that only handles "recipe".
export const RecipeObservationSchema = z.object({
  kind: z.literal("recipe"),
  title, ingredients, instructions, source, // functional facts, unchanged from v1 RecipeItem
  summary?, servings?, time_total?, time_active?,
});
export const ObservationItemSchema = z.discriminatedUnion("kind", [
  RecipeObservationSchema,
  // future: SaleObservationSchema, OrderStatusObservationSchema — NOT added here
]);

// v2 batch envelope.
export const SatelliteBatchSchema = z.object({
  capability: z.enum(CAPABILITIES),        // "recipe-scrape"
  source: z.string()…,                     // provenance the admin groups by (unchanged)
  satellite_version: z.string()…,          // renamed from scraper_version
  contract_version: z.string()…,           // "v2"
  observations: z.array(ObservationItemSchema).min(1).max(MAX_BATCH_ITEMS),
});
```

The recipe observation is the v1 `RecipeItem` fields plus a `kind: "recipe"` tag — **functionally identical** payload. `MAX_BATCH_ITEMS` and the per-item lenient validation (envelope-strict, items validated one-by-one so one bad item never sinks the batch) carry over unchanged.

*Why a discriminated union keyed by `kind`, not one schema per capability endpoint:* a single intake path that fans on `kind` keeps the "one machine, one key, one endpoint" model and lets a batch of one capability grow new item shapes without a new route. `capability` on the envelope is the coarse selector (and the future tenancy pivot — see roadmap); `kind` is the per-item discriminant.

### 5. v1→v2 compatibility: accept both, normalize inward, skew-flag the laggard

The Worker's lenient envelope parser accepts **either** shape:
- **v1** — `{ source, scraper_version, contract_version, recipes: [...] }` → normalized to `capability: "recipe-scrape"`, `satellite_version := scraper_version`, `observations := recipes.map(r => ({ kind: "recipe", ...r }))`.
- **v2** — `{ capability: "recipe-scrape", source, satellite_version, contract_version, observations: [{ kind: "recipe", ... }] }` → used directly.

Both collapse to one internal recipe-intake path, so arrival dedup, persistence, and the sweep are untouched. `touchIngestKey` stamps whatever `contract_version` and version string the batch reported into `last_contract_version` / `last_scraper_version` (column name unchanged), so the **existing skew detection keeps working**: a producer reporting `"v1"` against the Worker's current `CONTRACT_VERSION = "v2"` reads as **skewed** in the admin liveness view — exactly the right nudge to pull the new image. A v2 batch that declares a `capability` the Worker doesn't implement is rejected `bad_payload` (only `recipe-scrape` is known here).

*Why accept both rather than a hard cutover:* zero in-flight data on this instance makes a cutover safe *here*, but a self-hosted operator's satellite image may lag the Worker; accept-both makes the Worker deploy independent of the image roll. v1 acceptance is a transition affordance to be **sunset in a later change** once skew telemetry shows no v1 producers — that sunset is out of scope here.

### 6. The trust discipline — "the satellite is a sensor, not a judge"

The one-liner, verbatim into the spec's intent:

> *Trusted and untrusted sources converge at the raw-observation layer. The satellite is a sensor: it may report only independently-checkable facts, bounded to physical plausibility and carrying provenance; the Worker re-derives every conclusion, samples claims against ground truth, quarantines bad sources through the pipeline, and keeps every irreversible action gated on a human verifying the store's own UI.*

Written as capability-agnostic `satellite` requirements so scan/order inherit them:

- **Observations-only.** The contract admits only independently-checkable facts, never a derived conclusion the Worker cares about. There is **no wire field** for a derived value. `recipe-scrape` already embodies this — it carries functional facts (ingredients/steps/times), never headnotes/images, and every facet (`ingredients_key`, `perishable`, `course`, …) is **derived on-cron**, not trusted from the wire. The canonical future example, stated as intent: a `sale-scan` observation will carry `{ regular, promo }` and **never** `savings_pct` — the Worker computes the saving.
- **Raw-observation convergence.** Satellite-fed data enters the **same raw layer** as a first-party source (the Kroger API for flyers), and is subject to the **same** Worker-side derivation and **equal-or-stricter** validation. The satellite gets **no privileged path** — no field it can set that a first-party source couldn't, no derivation it can skip.
- **Trust outputs after validation, never the process.** The Worker trusts a satellite's *outputs once validated* (lenient envelope + per-item validation + plausibility bounds + provenance pointers), never its process. Every conclusion — deal? / match? / savings / confidence — is **re-derived** by the Worker; the satellite's own opinion, if any, is not load-bearing.
- **Irreversible actions stay human-gated against ground truth.** No satellite report may, by itself, cause an irreversible action; such an action stays gated on a human verifying the store's own UI. Forward-looking (realized fully by `order-fill`, which stops at cart-fill and never clicks buy), stated here as the principle the later capability implements.
- **Strictly outbound-only** (decision 2), stated as a requirement.

### 7. Spec scope of the rename

The OpenSpec deltas restate a requirement only where the rename changes a **named artifact the spec pins** or where **substance** changes:

- `satellite` (new spec, `## ADDED`): the generalized component requirements carried over from `walled-source-scraper` (renamed wording) **plus** the new trust/capability/outbound requirements and the v2 contract requirement.
- `walled-source-scraper` (`## REMOVED`): all its requirements, retired with a Reason/Migration pointing at `satellite`.
- `recipe-ingestion` (`## MODIFIED`): the endpoint-batch requirement (now v2 capability-tagged, v1 accepted) and the liveness/skew requirement (v2 + `satellite_version`; title RENAMED "Per-scraper…" → "Per-satellite…"). The key-auth / key-mint / arrival-dedup requirements are **not** restated — their substance is unchanged and their endpoint/table vocabulary (`ingest_*`) is deliberately retained (decision 3), so restating them solely to swap a noun would be churn.
- `repo-structure`, `build-automation`, `operator-admin` (`## MODIFIED`): the requirements that pin the **package name**, the **release tag/image**, and the **operator-facing labels/badges** respectively — those artifacts are renamed, so the living contract must match.
- `discovery-sweep` gets a `## MODIFIED` delta (**ratified**): its substance (the push intake arm, "walled/satellite-owned, not a polled feed") is unchanged, but the residual "scraper" nouns are in the living contract's normative text ("home-network scrapers", "the scraper did the walled fetch", "scraper-owned", and a scenario "served by a scraper (walled)") — and the implementation's comment/doc pass does not touch `openspec/specs/`. So the one requirement that carries them, "Sweep intake polls feeds and reads the email inbox, deduped", is restated in full with only the concept noun aligned scraper→satellite; the endpoint/table vocabulary (`/admin/api/ingest`, `ingest_candidates`, `discovery_rejections`, …) and "walled source" stay (decision 3). This is a pure vocabulary alignment, no substance change.
- `recipe-discovery` gets **no delta**: its residual "scraper" is not the concept noun — it is the npm library name `recipe-scraper`, named in that spec's "SHALL NOT depend on Node-only libraries (e.g. `recipe-scraper`, `cheerio`)" clause. That is a deliberate dependency prohibition, not the renamed component, so it stays verbatim.

### 8. Roadmap context for the extension points (not specified here)

Recorded so the foundation's shape is legible; **do not spec in this change**:
- **`sale-scan`** — operator/**cross-tenant** (sale prices are public-derived, keyed by `locationId` exactly like the flyer cache). Observation `{ regular, promo }`, never `savings_pct`.
- **`order-fill`** — **per-tenant** (a tenant-run satellite holds only that tenant's own store sessions). Stops at **cart-fill, never clicks buy**; a human checks out on the store's own UI.
- **Change 2 — a shared pull channel** — an outbound-only fetch that serves both a cross-tenant scan-plan and a per-tenant order-list. This change keeps the discriminated union open for their observation kinds and holds the outbound-only line so the pull channel is a satellite-initiated GET.

## Model identity

No model id (name or string) appears anywhere in this change — not in the contract, the spec, the docs, or the roadmap notes. Facet derivation and classification are described by role ("the on-cron classifier", "env.AI"), never by model identity, consistent with the repo's convention.

## Risks / Trade-offs

- **Rename blast radius / churn.** A concept rename touches many files. *Mitigation:* the DB/endpoint surface is explicitly excluded (decision 3), bounding the change to code vocabulary + labels + docs + the OpenSpec capability; tasks.md enumerates every file/dir so nothing is missed and nothing over-reaches.
- **A dual-shape (v1+v2) parser is a second code path.** *Mitigation:* normalize v1 inward to the v2 recipe intake immediately, so only the envelope parse forks; everything after is single-path. Lock both shapes in `contract-ingest.test.ts`. Plan the v1 sunset as a later change gated on skew telemetry.
- **Renaming the release tag (`scraper-v*` → `satellite-v*`) could look like a break.** *Mitigation:* tags are additive; old images and tags remain valid and pullable. Document the new tag in SELF_HOSTING; no operator action required until they choose to upgrade.
- **Over-generalizing the contract before the second capability exists (speculative abstraction).** *Mitigation:* add **only** the discriminated-union seam and the `capability` enum — no scan/order schemas, no scan/order code. The union has exactly one arm today; the cost is one `kind` field and an enum with one member.
- **Leaving "scraper" nouns in the un-delta'd `discovery-sweep` spec.** *Mitigation:* the substance is unchanged; the wording is aligned in the doc/comment pass, and the decision is recorded (decision 7) for the architect to override at ratification if they want the delta.
