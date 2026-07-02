# Productization Strategy

> Strategy record from a discovery session on 2026-07-02. Unlike the rest of
> `docs/`, this is a point-in-time position paper, not a living contract doc:
> it captures market findings, the chosen direction, and deliberately deferred
> options. Sections marked **Decided** are commitments; sections marked
> **Direction** are the working position; sections marked **Deferred** are
> futures we preserve optionality for but are not building.

## 1. Market position

Survey date: July 2026. The "AI meal planner" *app* space is saturated; the
**agent-first** space — products that live inside the user's own AI
subscription as an MCP connector rather than shipping their own assistant —
is nearly empty. Three products overlap meaningfully:

| | Pantry Persona | Pantry Aide | Dillr |
|---|---|---|---|
| What | Hosted MCP, ChatGPT + Claude | Hosted MCP + web SaaS, closed source | Claude connector, ~23 tools |
| Where reasoning lives | Client LLM over CRUD dumps | **Their** server-side AI (`generate_meal_plan` runs their inference) | Client LLM over kitchen-memory tools |
| Kroger | none (Instacart hand-off) | cart writes, tri-state SKU match | none |
| Price intelligence | none | **none** (cart writes only, no price/flyer/unit-price reads) | none |
| Sharing | household account, 2 people, profiles | partner list-sharing | household members |
| Pricing | free + Pro $7.99/mo / $59.99/yr | free + Pro from $7.99/mo | none visible |
| Traction (observed) | zero community footprint; MCP registry v1.0.0 frozen since 2026-02; awaiting ChatGPT directory approval | zero community footprint; registry v1.0.0, 2026-05-31; SEO-led | indie, no pricing page |

(Sources: pantrypersona.com, pantryaide.com + `hsearcy/pantry-aide-mcp`
README, dillr.ai, registry.modelcontextprotocol.io — surveyed 2026-07-02.)

The three answers to "where does the intelligence live" define the category:
Pantry Persona dumps CRUD state into the client model's context (degrades as
the corpus grows); Pantry Aide takes reasoning away from the agent and runs
it server-side (carries its own inference cost, so its price floor is
structural); this project puts the user's frontier model over
**deterministic retrieval** (capture → retrieve → narrow), which is the only
shape with both zero marginal inference cost and no context-window ceiling.

**Unclaimed white space** (no competitor has any of it): price intelligence
(flyer warm, SKU matching, unit-price comparison, sale-aware planning); a
closed taste loop (cooking log + retrospectives feeding derived taste, vs.
star ratings); curated-source discovery (RSS/email/satellite, vs.
browse-a-public-pool); a shipped persona/skills layer; household + friends
sharing semantics; self-hosting.

**Real risks** are distribution and platform, not features: ChatGPT App
Directory approval would hand a competitor zero-friction reach; the Kroger
public tier caps cart calls at 5,000/day **per app**, which a hosted service
hits around low-thousands of weekly-shopping households — graduating to a
Kroger partnership is a prerequisite for hosted scale and the one cost we
don't control.

## 2. Tenancy — Direction: linked accounts

Today a tenant is one **person** (operator-issued invite → username;
`packages/worker/src/tenant.ts`), and "the group" is an emergent property of
the deploy: the R2 corpus, `recipes` index, feeds, discovery, and ingredient
tables are deploy-global; pantry/meal-plan/profile/taste/log/overlay are
per-person; notes are author-attributed and cross-readable. The current
model is already "linked accounts where everyone is friends by default,"
minus explicit links.

The productized model keeps the person-tenant and adds two scopes instead of
replacing anything:

```
canonical recipe nodes (global, content-addressed: normalized source
        ▲               URL, content-hash fallback)
        │   derived once per node: facets, embedding, description,
        │   ingredient normalization
   saved-edges ── a household's cookbook = its edge set
        │         + copy-on-write overrides + notes
        ▼
household ◄── friend link ──► household     (hosted: explicit, invited)
    │        (cookbook visibility only)     (self-host: every household
    │                                        on the deploy auto-linked)
    └─ members (persons): profile/taste, cooking_log, overlay,
       night_vibes, Kroger tokens — unchanged from today
```

- **Household** (new entity; singleton by default) owns the co-op
  operational state: pantry, meal plan, grocery list, staples, stockup,
  kitchen equipment — tables that are per-person today and move to
  household scope.
- **Friend links** are household↔household edges granting cookbook
  visibility (recipes + notes travel; operational state never does). No
  per-recipe ACLs, no person-to-person social graph.
- The group-account alternative (tenant = group, permissions model beneath
  it) was considered and rejected: it would merge per-person state that the
  system depends on being per-person (taste vectors gate discovery imports;
  notes are attributed; Kroger grants are individual OAuth) and then
  require re-splitting it.

**Self-hosting stays first-class via a deployment profile, not a fork.**
The core stays scope-aware and mode-agnostic; exactly three seams swap by
profile:

| Seam | Hosted | Self-hosted |
|---|---|---|
| Identity | email/passkey signup, payments | operator invite codes (today's flow) |
| Sharing topology | explicit friend links, household UI | one implicit circle; friends UI never rendered |
| Quotas | anti-abuse ceilings | unlimited |

Divergent frontends (signup/billing vs. the operator admin panel) stay
separate route modules over the same domain layer. Any new binding a hosted
profile introduces (Vectorize, DOs, Queues) must be added to the
`scripts/merge-wrangler-config.mjs` allowlist explicitly or the self-host
deploy silently drops it.

## 3. Canonical corpus: dedup, amortization, copyright

Content-addressing the recipe layer solves three problems with one design
(the schema is already most of the way there: `recipes.source_url` is the
corpus idempotency key, `discovery_log.url` the discovery dedup key, and
`recipe_derived`/`recipe_facets` are already global tables distinct from
per-person `overlay`/attributed `recipe_notes`):

- **Workers-AI amortization** — two households importing the same URL share
  one classify/describe/embed pass; both hold edges to the same node.
- **Discovery dedup** — `feeds` becomes a global feed registry with
  per-household subscription edges; each feed is fetched once per sweep and
  candidates are evaluated against each subscribing household's member
  taste vectors.
- **Copyright** — derived *facts* (facets, embeddings, ingredient graph;
  procedures and ingredient lists are largely uncopyrightable) live on the
  shared node; captured body *prose* is a visibility-scoped blob.
  Satellite/gated captures are body-private to the capturing household,
  always; content-hash dedup of the derived layer works without ever
  exposing one household's captured prose to another. Friend-sharing shares
  bodies with chosen people (lending a cookbook), not publishing.
- **Data ownership** = your edge set + notes + overrides, materialized to
  markdown on export, derived data included. Nobody needs "their own D1
  row"; they need exit rights.

Cold start without shipping anyone's content: onboarding imports from the
user's own URLs; derived-layer cache hits make popular imports instant.

## 4. The moat — Direction: verified structure, framed as a commons

Embeddings and first-pass classifications are commodity — reproducible from
source text by anyone running the (AGPL) pipeline. What accumulates and
cannot be regenerated:

1. **The ingredient identity graph** — aliases, edges, and especially the
   *rejections* and corrections: accreted judgment (the MusicBrainz
   pattern).
2. **Validated SKU matches** — ingredient→UPC across locations, self-healed
   against catalog churn, confirmed by real carts. The substrate under the
   price-intelligence differentiator.
3. **Outcome pairs** — cooking logs + retrospectives joined against facets:
   (recipe features → household outcome) data no competitor collects.
4. **Curated guidance** — defensible by curation velocity, not secrecy (it
   ships to clients as markdown).

Every needs-review resolution, rejected match, and retrospective is moat
deposition; the pipeline treats them as first-class capture events.

The defensibility model is OpenStreetMap, not a walled garden: the data can
be openly licensed (ODbL-style share-alike is the data analog of AGPL) and
the *steward institution* — the pipeline operation, contributor
relationships, quality arbitration — remains the asset. Self-hosted deploys
are potential tributaries, not leaks: an opt-in federation service could let
them read the shared canonical/derived commons (cold-start relief) and
contribute corrections back. Not built now; see §8.

## 5. Privacy boundary

The invariant, one sentence, verifiable against the schema: **the shared
layer learns from recipes, never from people.**

| Layer | About | Crosses tenant boundary? | Encryption posture |
|---|---|---|---|
| Canonical/derived (facts, facets, embeddings, ingredient graph, SKU cache) | recipes | yes — it *is* the commons | plaintext, content-keyed |
| Household/person (pantry, plans, logs, taste, notes, Kroger tokens) | people | never | isolated; envelope-encrypt free-text payloads (note bodies, retro comments) and secrets |
| Aggregate priors | people → cohorts | opt-in only | k-anonymity thresholds, derived-only, deletable |

Honest constraints: the determinism boundary requires server-side SQL and
vector search, so structured retrieval fields cannot be tenant-encrypted —
Cloudflare at-rest encryption is the floor, app-layer envelope encryption
applies only to payloads the server stores but never queries by content. Do
not overclaim E2E. Hosted identity means real OAuth account management
(the `workers-oauth-provider` userId/props split already accommodates it).

**Satellites running local models** are the strong version of
privacy-by-architecture: a satellite that embeds/classifies locally can push
only derived facets + vector, keeping a gated capture's body on the user's
machine while the recipe stays findable by vibes. Engineering constraint to
honor from day one: satellite and server must embed in the **same pinned
model space**; an embedding-model migration must re-embed or version the
index.

The flywheel is legible, not silent: documented as the invariant above,
opt-in where it touches people, visible in product surfaces.

## 6. Cost model and scaling walls

Cloudflare pricing surveyed 2026-07 (Workers paid, D1, R2, KV, Workers AI;
~200 recipes and ~30 conversations/household/month assumed):

| Scale | Cloudflare $/mo | Per household |
|---|---|---|
| 100 households | ~$5 (plan minimum) | $0.05 |
| 1,000 | ~$5–6 | ~$0.005 |
| 10,000 | ~$34–40 | ~$0.0035 |

Because inference rides the user's own Claude subscription, infrastructure
is a rounding error at any plausible price. The engineering requirements
that keep it that way:

1. **Hash-gated incremental recipe projection.** D1 rows *written* cost
   1,000× rows read; a delete-all + rebuild projection at hosted scale is
   ~$29k/mo at 10k households vs. ~$0 incremental. The `recipe_derived`
   reconcile is already hash-gated; the projection must match before any
   hosted launch.
2. **Evict embedding vectors from D1** (JSON TEXT today) to Vectorize
   (~$1/mo at 10k households). D1's hard 10 GB/database cap lands around
   3–5k households; past that, SQLite-backed Durable Object per household
   is the idiomatic shard (no binding-count limit, $0.20/GB vs. $0.75) —
   and the linked-accounts graph shards cleanly under it because the
   friend-shared layer is the global canonical DB, not cross-household row
   access.
3. **No per-request KV writes** (KV writes are $5/M; tokens written at
   issuance only, counters elsewhere).
4. **The Kroger 5,000 cart-calls/day per-app cap** binds before any
   Cloudflare meter does. Partnership conversation precedes hosted scale.

## 7. Business model — Decided

- **Entity:** sole proprietorship → single-member **LLC** (the product
  plans meals around allergies and dietary restrictions; the liability
  boundary should be an entity). Merchant-of-record (Paddle/Lemon
  Squeezy-class) for payments so global sales tax is the MoR's problem.
- **Pricing: pay-what-you-want sliding scale** over a stated floor, annual-
  first billing (processor fixed fees take ~18% of $2 monthly vs. ~5%
  annual). Suggested anchor points TBD; competitors at $7.99/mo normalize
  the generous end. Households bill once per household. The floor prices in
  operator labor, not just infrastructure — a floor that doesn't fund
  maintenance is a deferred shutdown.
- **Radical cost transparency:** a public costs page projecting the
  (already-built) usage/cost panel — the published bill is the proof behind
  the sliding scale and a differentiator competitors can't copy without
  revealing margins.
- **PWYW deletes the entitlement matrix.** No plan-gated features; quotas
  exist only as anti-abuse ceilings. This substantially shrinks the hosted
  deployment-profile work (§2 seam three).
- Why this coheres: the stack already refuses margin on principle (AGPL,
  BYO-AI, markdown export, self-hosting). Exit rights make floor pricing
  credible — a $2 service normally signals "dead in a year," but when the
  code is AGPL and the corpus exports cleanly, abandonment risk costs the
  user nothing. The pricing and the data-freedom story reinforce each
  other, and the model itself sells as a non-feature feature to exactly the
  crowd that chooses a self-hostable agent.
- Support surface for the low/free end stays community-shaped (issues,
  FAQ voice), not a help desk.

## 8. Deferred futures and the constraints that keep them possible

**Deferred — co-op:** the long-run institutional form of floor pricing
(social.coop pattern; Open Collective as fiscal host as an intermediate
step). Working notes if/when revisited: separate decision classes (members
vote money envelopes and cost/service tradeoffs — which map to
`operator_config`/`discovery_config` knobs and the public cost dashboard;
maintainers own architecture, with OpenSpec proposals as the transparency
artifact and a required cost-impact note); pay contributors by retroactive
funding with an off-ballot maintenance floor, multi-stakeholder member
classes if workers are paid; do **not** transfer code copyright — AGPL's
fork right protects members from the maintainer, the CLA's relicensing
right protects the maintainer from capture; the co-op owns service, brand,
money, and (ODbL) commons data.

**Deferred — federation:** instances (self-hosted + hosted) exchanging
friend-links and reading/contributing to the derived-data commons.
Household-atomic; operational state never federates. A federated commons
requires a governing steward — which is the co-op's job; the two deferred
futures arrive together or not at all.

**Preserved constraints (cheap now, load-bearing later):**

1. Household-atomic sharing (friend links are household↔household).
2. Content-addressed canonical recipe ids (globally meaningful, not
   deploy-local slugs).
3. Visibility-scoped recipe bodies (derived facts shared; prose scoped).
4. Clean commons/personal data separation (§5 invariant).
5. A cost-impact section on OpenSpec proposals (architecture is budget on
   metered infrastructure).

## 9. Near-term repo implications (rough order)

1. **Pipeline hardening shippable now, hosted or not:** hash-gated
   incremental recipe projection; canonical recipe keying (normalized
   source URL + content-hash fallback). Both are ordinary OpenSpec changes
   and prerequisites for everything hosted.
2. Cost-impact section in the proposal template (§8 constraint 5).
3. Household entity + scope moves (pantry/meal-plan/list/staples/equipment
   person→household), with self-host as the singleton/auto-linked profile.
4. Hosted identity (email/passkey via the existing OAuth provider's
   userId/props split), MoR integration, quotas-as-abuse-guards.
5. Public costs page (projection of the usage panel).
6. Vectorize eviction for embeddings before ~3k households; DO-per-household
   sharding design before ~5k.
7. Kroger partnership conversation before hosted marketing.
