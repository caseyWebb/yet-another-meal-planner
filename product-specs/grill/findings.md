# Confirmed findings (38) — grouped by lens

Adversarial grill, 2026-07-10. Descriptions and evidence verbatim from verification (file:line refs preserved). Resolution text trimmed to a gist where a DECISIONS.md entry now carries it — the D-entry is authoritative; `-final` amendments win over the original entry text.

---

## Consistency (6)

### meal_plan row identity is undecided and contradicts the (date, meal) slot model
**blocker · resolved by D26 (as amended: D26-final)**
PAGES: product-specs/stories/02-meal-dimension.md, product-specs/pages/03-meal-plan.md, product-specs/pages/04-plan-your-week.md

The plan table today is PRIMARY KEY (tenant, recipe) — one row per recipe — and three shipped contracts hang off that key: log_cooked clears the planned row by slug in the same transaction, offline class (b) plan mutations are keyed 'plan rows by recipe slug', and propose commit maps slots onto 'the existing plan ops — recipe slug ... as replay-safe upserts'. Story 02 specs only a `meal` column add ('D1: meal_plan.meal ... existing plan rows → dinner'), silently retaining the PK. But pages/03's empty-slots grid addresses slots by (date, meal) across 7×3=21 slots, and per-meal planning (especially breakfast: the mock's own add_vibe suggestion is 'Yogurt + granola — shows up most mornings this week') makes the same recipe in multiple slots per week the normal case — impossible under one-row-per-recipe. Meanwhile pages/03's unscheduled section 're-tags an existing row's meal if the recipe is already planned' and pages/04's commit 'silently skips recipes already planned' both assume one-row-per-recipe. An autonomous band-1 proposal following story 02 literally would add the column, keep the PK, and strand bands 2 and 4.

Resolution gist: the operator overrode the drafted keep-the-PK entry — plan rows move to a client-mintable surrogate row id (ULID) PK with a planner-no-duplicates invariant; slug-addressed ops keep defined fan-out; log_cooked clears exact (recipe, meal, date) first. → D26-final.

### 'Checked' state collides with the existing check-off ≡ in_cart contract shared by walk, manual shop, and online orders
**blocker · resolved by D28**
PAGES: product-specs/pages/05-grocery-list.md, product-specs/stories/03-cost-and-waste-telemetry.md, product-specs/stories/04-store-adapters-and-fulfillment.md

The shipped contract already defines grocery check-off: member-app-offline's scenario says an offline check-off 'replays on reconnect so the server's rows reach in_cart', and SCHEMAS pins one lifecycle 'active → in_cart → ordered + the terminal receive action ... identical across every fulfillment mode', with place_order ALSO writing active → in_cart. The mock makes 'checked' central (footer 'N of M checked', strikethrough, walk check-off, 'Log a manual shop · N checked' → purchased → spend events) but never says whether checked IS the in_cart status or a new parallel per-row flag. If checked ≡ in_cart, a manual-shop log would sweep in rows a member earlier sent to the Kroger cart online (both are in_cart), and checking items in list view before an online order silently excludes them from to-buy (the derived read suppresses in-flight rows). If checked is a new boolean, it duplicates the state machine the offline spec already gates. Three consumers (walk completion, manual shop, spend capture) plus the sidebar count read this state; an autonomous grocery-band proposal could plausibly mint the wrong one.

Resolution gist: checked is a new nullable `checked_at`, orthogonal to `status`; `in_cart` stays exclusively the online-order stage; manual shop/walk completion sweeps checked rows only (checked ≡ in_cart recorded as rejected). → D28.

### None of the ~25 new writes are classified against the mandatory two-writer/offline posture
**major · resolved by D15**
PAGES: product-specs/stories/06-dual-use-widgets.md, product-specs/pages/05-grocery-list.md, product-specs/pages/06-pantry.md, product-specs/pages/07-retrospective.md, product-specs/pages/08-people.md, product-specs/pages/09-profile-taste-and-preferences.md, product-specs/pages/11-profile-discovery.md, product-specs/pages/12-profile-satellites.md, product-specs/pages/13-account-and-security.md

The member app's shipped contract requires every write classified as class (a) If-Match whole-document or class (b) idempotent keyed replayable, with class (b) writes registered for offline queue/replay and everything else online-only-with-hint. The spec set introduces a large new write surface and classifies none of it; only story 06 q4 touches offline at all (MCP host online-only). An autonomous proposal per band would each improvise, and wrong choices are costly (e.g. a walk check-off that isn't replayable is useless in a store with dead reception; a waste event without an idempotency key duplicates on replay).

Resolution gist: a blanket posture entry classifies every new write (class b for idempotent keyed upserts, class a for whole-document editors, online-only for everything effectful; telemetry events carry client-minted idempotency keys; the walk works with zero connectivity). → D15.

### No spec defines how member-scoped signals compose into household-scoped derived surfaces
**major · resolved by D29 (as amended: D29-final)**
PAGES: product-specs/stories/01-households-and-friends.md, product-specs/pages/04-plan-your-week.md, product-specs/pages/10-profile-meal-vibes.md

Story 01 splits taste profile, dietary principles, favorites/rejects, and cook-log authorship to MEMBER level while the meal plan, grocery list, and spend stay HOUSEHOLD level. But propose consumes taste + rejects + dietary, trending is 'filtered by the caller's own rejects', and recommendations read favorites centroids — so every household-scoped derived surface now has an undefined aggregation over member-scoped inputs: whose dietary principles does a household plan respect? whose rejects filter it? whose taste ranks it? Story 01 q6 asks only which tools become member-aware and how the persona addresses members — not the aggregation semantics. Vibes are also unlisted in the member-level split (so implicitly household-shared), which the per-meal propose engine should know before band 1 renames them.

Resolution gist: hard constraints compose by UNION across members; the operator amended soft ranking from acting-member taste to an attendance-weighted household blend; vibes stay household-scoped and gain optional member assignment. → D29-final.

### Spend-event timing is ambiguous across the order lifecycle (send vs placed)
**major · resolved by D16**
PAGES: product-specs/stories/03-cost-and-waste-telemetry.md, product-specs/pages/05-grocery-list.md

Story 03 says the primary spend source is 'order commit ... persist the committed order's lines as spend events', but the shipped lifecycle has two commits: place_order's send (active → in_cart; 'sent to cart, you check out' — the app never completes purchase) and the later user-asserted 'Mark order placed' (in_cart → ordered). Recording spend at send counts items the member deletes at Kroger checkout; recording at placed requires the send-time price snapshot to persist somewhere (page 05 q10 gestures at this but neither spec fixes the event time). The Order Review tiles and the spend analyzer 'must agree on source' per story 03 — which is impossible until the timing is pinned.

Resolution gist: snapshot at send (per-line resolved prices on a send record — what the Order Review tiles render), materialize spend events at the purchase assertion (in_cart→ordered on every path), idempotent on (send id, line); receive never prices. → D16.

### Three incompatible 'department' notions feed the analyzers with no canonical taxonomy
**major · resolved by D17**
PAGES: product-specs/stories/03-cost-and-waste-telemetry.md, product-specs/pages/05-grocery-list.md, product-specs/pages/06-pantry.md, product-specs/pages/07-retrospective.md

Spend line items carry `{department}` and the KPI excludes 'household+beverage depts'; waste events carry department incl. a 'Leftovers' pseudo-department; the grocery list groups by store-derived placement `{aisle, department}` (Kroger data or aisle maps — store-specific and 'Not mapped' is honest); pantry gains a controlled category vocab (Produce, Dairy, ... Beverages); and 'household' is a grocery-row `kind`, not a department. No spec says which of these stamps the analytics dimension, yet cross-range aggregation requires a stable taxonomy independent of which store fulfilled the line.

Resolution gist: one canonical analytics `department` dimension (page 06's food-category vocab + Household + Leftovers), stamped immutably at capture via the identity-keyed ingredient→category derivation; store placement stays presentation-only. → D17.

---

## Doctrine (6)

### Member identity does not exist at either credential layer — two specs assert the opposite
**blocker · resolved by D10**
PAGES: stories/01-households-and-friends.md, stories/06-dual-use-widgets.md, pages/08-people.md, pages/13-account-and-security.md

Story 01 q6 says 'per-member OAuth grants already exist — verify the tenant/member split at token level' and story 06 q3 says '(Grant is per-member already — likely the answer.)'. Verified against code: both are false under S1. The MCP OAuth grant carries props: { tenantId } only (packages/worker/src/authorize.ts:130-133; index.ts reads only props.tenantId). The web session record is { tenant, created_at, refreshed_at } — no member, no device metadata (packages/worker/src/session.ts). WebAuthn credentials use user handle = tenant id and live in a per-tenant table (docs/ARCHITECTURE.md multi-tenant identity). resolveTenant yields a Tenant only. Today 'per-member' is trivially true because a tenant IS a person; the moment tenant = household, there is no member dimension anywhere in the credential chain. Every member-scoped feature in the spec set (favorites overlay, taste/diet, notes/log authorship, follows, nicknames, passkey management, per-client grant list, sessions list, widget write attribution) depends on this, and an autonomous proposal session reading the specs' 'already exists' framing would build on a nonexistent foundation.

Resolution gist: the false 'already exists' framing is corrected in both stories; the member identity split (members table, founding member id = tenant id, (tenant, member) resolution before any tool/route) is band 5's first change. → D10.

### Async data export collides with the 'per-tenant data never lands in R2' tier invariant and has no doctrinal job runner
**blocker · resolved by D33**
PAGES: pages/13-account-and-security.md

Pages/13 specs an async export job ('available to download here', email when ready, a stored yamp-export.zip). The storage doctrine is explicit: R2 = authored markdown only, 'per-tenant data never lands in R2'; KV = ephemeral infra only, no domain data; no Durable Objects, no Workflows, no queues — background work is bounded phases of the one scheduled() handler. A stored per-tenant zip artifact has no home in any tier, and an autonomous proposal following the mock would either violate the R2 invariant, stuff megabytes into KV, or invent a Workflow. Retention and 'download here' lifetime questions all follow from the stored-artifact assumption.

Resolution gist: export becomes a synchronous streamed session-gated GET under /api — no job, no stored artifact, no retention question, no email dependency; measured fallback (dedicated R2 bucket + lifecycle) only with an explicit tier-doctrine amendment. → D33.

### Walk sessions: doctrine forces client-held view state + class (b) row writes, never a server-side session entity
**major · resolved by D28**
PAGES: stories/04-store-adapters-and-fulfillment.md, pages/05-grocery-list.md

Story 04 q3 and pages/05 leave walk-session persistence, resume, and multi-member concurrency open — the exact shape a proposal session could wrongly solve with a walk_sessions table or (worse) a Durable Object. The repo already has the precedent that resolves it: the propose session lives client-side only ('the Worker holds no propose-session state, ever') and grocery check-offs are the member-app-offline layer's flagship class (b) replayable mutation. The grocery_list schema today has no checked state (status enum is only active|in_cart|ordered), so 'checked' — which the mock makes central (feeds manual-shop logging AND the walk) — needs a home, and D1-per-row is the only shape that gives cross-device resume and concurrent household walks for free.

Resolution gist: no walk-session entity ever — walk mode is pure client state (URL params + localStorage, the propose-session precedent); resume and concurrency come from D1 `checked_at` rows; completion is one shared idempotent shop-commit op. → D28.

### Spend-event emission must live inside the shared flush/receive ops — the specs only wire the new member-UI paths, leaving the agent walk and satellite fill silently uncounted
**major · resolved by D16**
PAGES: stories/03-cost-and-waste-telemetry.md, pages/05-grocery-list.md, pages/07-retrospective.md

Story 03 names order commit and the member manual shop as capture points, but the system has four flush paths that all end in the same list transitions: Kroger place_order (shared op — fine), the EXISTING agent-guided voice walk (in-store-fulfillment: completion advances items and restocks pantry with no in_cart stage), the Kroger in-store walk, and the satellite cart-fill receipt. If spend events are wired at the UI layer, every agent-side shop and satellite fill vanishes from the Spend analyzer AND corrupts the Waste analyzer's rate denominator (tossed ÷ (spend+tossed)). The repo doctrine — every surface calls one named src/ operation — dictates where the write goes; the specs should say so explicitly or a proposal will hang capture off the app routes.

Resolution gist: emission lives inside the shared src/ operations, never a surface — every purchase path enumerated as an emitter; member walk and agent voice walk converge on one shop-commit op (in-store-fulfillment delta). → D16.

### Discovery-sweep imports and the curated set have no defined place in the visibility-lens model, and the curated set's distribution collides with 'no data in this repo'
**major · resolved by D13 (+ D13-amendment)**
PAGES: stories/01-households-and-friends.md, stories/05-ingested-data-trust.md, pages/01-cookbook.md, pages/11-profile-discovery.md

Story 01 keys visibility on 'the importing tenant', but the sweep imports with no tenant attached — its attribution rows (discovery_matches) are per-member and can span households. Nothing says which households see a feed-sourced import under the lens model, and that ambiguity sits exactly where band 5 and band 6 intersect. Separately, S3's product-maintained public curated set must reach every self-hosted deployment, but the code repo holds no data — so an autonomous proposal has no legal way to ship it without a distribution decision.

Resolution gist: a sweep import's attribution rows ARE its visibility grants (visible to confirmed-matched members' households); curated set distributes as a pinned public source consumed by the existing sweep pipeline, never a committed seed. Household-level curated hide ships per the amendment. → D13, D13-amendment.

### Cart-fill helper card: reporting the LAN URL + session token home contradicts the shipped local-security contract
**major · resolved by D22**
PAGES: pages/12-profile-satellites.md, stories/04-store-adapters-and-fulfillment.md

Pages/12 shows the cloud app revealing 'http://127.0.0.1:7749 · token …' and frames the data path as an open question. The shipped satellite-order-cart-fill spec deliberately keeps that token local: the helper binds loopback by default, prints its session token at start, and its secrets are never served. Piping URL+token through D1 to any household browser (a) exfiltrates a credential the spec keeps off the wire, (b) is useless anyway — a loopback URL only resolves on the satellite host itself, and (c) turns the Worker into a credential store, against the sensor-not-judge posture (a token is not an observation).

Resolution gist: helper URL and token never leave the satellite host; the card shows only Worker-derivable facts plus a satellite-reported session-freshness boolean; 'Open helper' degrades to static instructions. → D22.

---

## Datamodel (1)

### The visibility lens's core table is unnamed, and friend-share scope is actually FORCED by D9 — not open
**major · resolved by D12 (structure) + D27 (scope)**
PAGES: stories/01-households-and-friends.md, pages/01-cookbook.md, pages/08-people.md, pages/11-profile-discovery.md

Story 01 says 'a second import creates a visibility grant, not a row' but never names the structure, and leaves friend-share scope (whole cookbook vs favorites-only vs per-recipe opt-in) as open q1. But D9 already decides it: the local profile's implicit all-to-all friendship must reduce EXACTLY to today's shared corpus where every member sees every recipe — that reduction only holds if the friend lens exposes the whole household cookbook. Favorites-only or opt-in would make the local profile show a subset, contradicting D9. Curated-set provenance (q5's data-model half) is likewise derivable from the same structure.

Resolution gist: canonical structure is `recipe_imports(recipe, tenant, member, via, imported_at)` with read-time visibility computation (the imports×friendship join IS the grant); curated = reserved system tenant; friend-share scope = whole household cookbook. → D12, D27.

---

## Migration (4)

### D9's 'self-hosted reduces exactly to today' claim silently requires friend-share scope = whole household cookbook — decide q1 now, whole-cookbook-by-default
**major / NEEDS-USER · resolved by D27 (ratified as drafted)**
PAGES: stories/01-households-and-friends.md, pages/08-people.md, pages/01-cookbook.md

D9 asserts 'implicit universal friendship reduces exactly to today's shared-corpus experience.' That equivalence holds ONLY if what a friend link shares is the whole household cookbook. Story 01 §5 q1 leaves friend-share scope open (whole cookbook / favorites only / per-recipe opt-in). If the SaaS answer were favorites-only or opt-in and the self-hosted profile reuses the same lens predicate, existing deployments would silently LOSE visibility of most of the shared corpus on migration — the exact regression D9 promises can't happen. So q1 is not a band-5 detail; it constrains D9's correctness and must be decided before any lens schema is proposed. Downstream checks under whole-cookbook scope: search/list gain a visibility predicate that is trivially all-true under self-hosted; embeddings/`recipe_derived` are identity-keyed and unaffected (S2); notes migrate `private=0` → friends-tier ≡ deployment-visible under all-to-all; trending = deployment-wide (D9 already covers); new-for-me unchanged because the visible set is constant. Nothing else breaks — but only under whole-cookbook scope.

Resolution gist: friend-share scope = whole household cookbook, no favorites-only or per-recipe control in v1; the favorites-only/opt-in options are recorded as foreclosed by D9's own reduction mechanism. → D27.

### Ownership of the EXISTING corpus rows after the lens change is unspecified — define the owner backfill rule
**major · resolved by D12**
PAGES: stories/01-households-and-friends.md, pages/01-cookbook.md

The lens model needs every recipe to carry an owning/importing household (for 'N shared' counts, provenance badges, curated-tier distinction, discovery attribution, and any future profile flip), but the specs never say what owner existing rows get. Under the self-hosted profile the answer is invisible to members (all-to-all), which is exactly why an autonomous session could defer it or pick something arbitrary (e.g. NULL = magic 'legacy' scope) that later collides with the SaaS semantics. The repo gives a derivable answer: the authored corpus is operator-authored by definition (CLAUDE.md: 'each operator's authored corpus'), and discovery imports already carry per-member attribution (`discovery_matches` rows, `discovery_log.detail.attribution`).

Resolution gist: an idempotent reconcile attaches every legacy row through the same import-row primitive (attributed rows per attributed tenant; all others to the operator's household); no NULL-owner sentinel; production attach counts are the acceptance fixture. → D12.

### Existing-account-joins-a-household (tenant merge) has no story — the no-surgery doctrine forces a shipped flow, and it is the self-hosted profile's primary use case
**major · resolved by D23**
PAGES: stories/01-households-and-friends.md, pages/08-people.md

Story 01's household-join request covers a MEMBER joining a tenant, but every existing person IS a single-member tenant after migration — so the first real-world action under the self-hosted profile (e.g. Casey + partner, separate tenants today, forming one household) is an existing tenant merging into another. The specs never define what happens to the joiner's old tenant's data. CLAUDE.md's 'production data converges through the pipeline, never through manual surgery' rules out the obvious workaround (hand-moving rows in D1), so if no flow ships, the headline self-hosted benefit ('self-hosters see no change beyond gaining household members', D9) is unrealizable. Page 08 q4's 'a member belongs to only one household (assume yes)' makes the disposition question unavoidable at accept time.

Resolution gist: household-accept for a sole-member requester = member-move primitive + tenant dissolution (household data deliberately never merges); multi-member tenants never merge wholesale; ships as a flow, first real household formation is the acceptance fixture. → D23.

### Story 01 §4 omits the operator-admin/operator-provisioning collisions: member lifecycle primitives conflate member and household
**major · resolved by D10**
PAGES: stories/01-households-and-friends.md, pages/08-people.md, pages/13-account-and-security.md

Story 01 §4 lists collisions with multi-tenancy, shared-corpus, group-insights, and self-service-signup — but not operator-admin/operator-provisioning, whose member-lifecycle requirements are written for tenant=person: 'Member revocation fully purges tenant state' (revoking `casey` deletes the tenant's D1 rows, notes, passkeys, sessions, Kroger token), onboarding mints one tenant per username, invite bootstrap codes resolve tenants, and the admin Members roster is a tenant roster. Under households these split into two distinct operations (remove-member vs purge-household), and bootstrap invite codes must mint/resolve MEMBERS (page 14's footer 'codes are minted per member' already assumes this). A band-5 proposal that doesn't carry an operator-admin delta would leave the operator with a revoke button that nukes a whole family to remove one person.

Resolution gist: operator-admin lifecycle splits into member-revoke vs household-purge in the same band-5 change; invite codes mint/resolve (tenant, member) pairs; the roster becomes household-grouped. → D10.

---

## Privacy (7)

### Public /cookbook route (and recipe_site_url) bypasses the visibility lens under SaaS
**blocker · resolved by D11**
PAGES: stories/01-households-and-friends.md, pages/01-cookbook.md

The Worker serves an OPEN, ANONYMOUS `/cookbook` route publishing the entire shared objective corpus (cookbook-search spec: 'open, cross-tenant surface with no caller identity'; ARCHITECTURE.md calls it 'the one genuinely-public read surface'), and `recipe_site_url` resolves to it. The product-spec set never mentions this surface. Under the SaaS profile (D9) with visibility lenses (D2/S2), every household's imported recipes would remain world-readable at `/cookbook` regardless of lens scope — a complete bypass of the social layer's core privacy boundary. An autonomous band-5 proposal that implements lenses without touching `/cookbook` ships a lens with a public back door.

Resolution gist: the anonymous visitor is the bottom lens position — under SaaS `/cookbook` computes over the curated tier only, invisible slugs 404 indistinguishably, recipe_site_url follows the lens; same-pass deltas to cookbook-search / cookbook-similar-recipes / data-read-tools plus an anonymous-surface threat pass. → D11.

### Satellite trust model breaks under SaaS: member-run satellites become cross-tenant corpus/flyer write power
**blocker · resolved by D14**
PAGES: pages/12-profile-satellites.md, stories/05-ingested-data-trust.md, stories/01-households-and-friends.md

The satellite specs explicitly scope trust to 'the operator's own network' and call the audit 'an operator health tool with per-household blast radius, NOT a cross-tenant security boundary' (satellite-source-audit). Pages/12 re-scopes mint/revoke/quarantine to member sessions and story 05 adds member-facing keys — under SaaS, satellites run on strangers' networks, yet: (a) recipe observations land in the ONE monolithic corpus, and S2's identity-keyed dedup (same URL = one row) means a malicious satellite that pushes fabricated content for a walled/popular URL FIRST can become the canonical copy served to later importers (the Worker cannot re-fetch walled sources by design); (b) sale-scan observations converge into the deliberately cross-tenant flyer cache keyed by store+location — a hostile member can poison sale prices steering other households' purchases at the same store slug; (c) pages/12 keeps 'recipe/sale rejections shared' per the existing contract, leaking which walled sites (subscriptions) and stores another household scrapes, plus provenance URLs, deployment-wide.

Resolution gist: provenance-classed identity keys (worker-fetched canonical by URL; satellite-observed keyed by (URL, content-hash), lens-scoped to the pushing household — divergent content forks rather than poisons); sale scans tenant-attributed and lens-read; rejection reads household-scoped; satellite-source-audit's trust premise rewritten same pass. → D14.

### MCP grant and passkey binding must gain a member identity before any member-scoped feature ships
**major · resolved by D10**
PAGES: stories/01-households-and-friends.md, pages/08-people.md, pages/13-account-and-security.md

Story 01 q6 asks to 'verify the tenant/member split at token level' — the answer is derivable and should be fixed now: today's contracts bind everything to ONE tenant. The OAuth grant carries only `tenantId` (multi-tenancy: token 'resolves to exactly one tenant'); the cross-device approval 'binds the approving member's TENANT to the reference'; `webauthn_credentials` rows are keyed by tenant with user handle = tenant id; `recipe_notes.author` is 'the writing tenant'; session records hold 'the tenant id'. Every member-scoped feature in the set (nicknames exported to the agent, notes authorship, log_cooked authorship, favorites overlay, feed follows, per-member sessions/grants in pages/13) silently depends on (tenantId, memberId) resolution on BOTH the MCP and /api paths. Without deciding this first, band-5 sub-proposals will each invent their own member resolution.

Resolution gist: founding member id EQUALS tenant id (zero re-keying of grants/sessions/credentials/note authors); grant props, sessions, and webauthn_credentials gain the member dimension; one shared (tenantId, memberId) resolution rule on both paths. → D10.

### Directory abuse controls absent: request spam bounds, decline visibility, and block/mute must be defined for band 5
**major · resolved by D24**
PAGES: pages/08-people.md, stories/01-households-and-friends.md

Story 01 q4 and pages/08 q2 leave 'failed-handle response, request rate limits, block/mute' and 'decline visibility / re-request after decline' open. The existence-oracle part is actually already answered by repo doctrine: self-service-signup deliberately discloses 'username taken' (and the pages/13 handle-change taken-check repeats it), so exact-handle existence cannot be hidden — accept it and bound ENUMERATION instead. But there is no block/mute anywhere in the spec set, and without it a SaaS deployment lets any account spam any handle with requests carrying freeform notes (attacker-controlled text delivered to the victim's inbox), and re-request infinitely after decline.

Resolution gist: enumeration-bounded lookup (shared fixed-window limiter, per-member and per-IP), invisible declines with re-request cooldown and an oracle-proof outgoing cap, block ships in band 5 (silent-swallow, subsumes mute), request notes inert capped plain text. → D24.

### 'Popular with Friends' and 'cooked by N friends' need the counts-only + min-signal posture to survive small friend sets
**major · resolved by D31**
PAGES: pages/01-cookbook.md, stories/01-households-and-friends.md

Story 01 q7 (per-friend attribution vs aggregates) and pages/01 q3 (trend chips) are open. With one friend household, 'cooked by 1 friend' — or any friend-lens count — is exact identification of that household's cooking activity; friendship consents to 'recipe visibility and social signals' (story 01 §1) but the specs never say whether that includes identifiable cook activity. The repo already has the blessed posture: group trending is 'counts only… never which member cooked what' with a min-signal guard (≥2 cooks or ≥2 distinct tenants returns empty). D9 also demands one implementation across both profiles, which forces the guard question to be answered once.

Resolution gist: cook-activity signals are household-counted aggregates behind a profile-conditioned min-signal guard (≥2 distinct households besides the caller's under SaaS; the existing guard verbatim under self-hosted); provenance stays attributable, passive cook activity never is. → D31.

### Note visibility tiers: the set, the default, and retroactive exposure on new friendships need fixing now
**major / NEEDS-USER · resolved by D30 (as amended: D30-final)**
PAGES: pages/02-recipe-detail.md, stories/01-households-and-friends.md

Story 01 q2 leaves tiers and defaults open; the mock has only a Private checkbox. Two constraints pin the answer: recipe-notes currently defaults to shared ('collaborative within a trusted group'), and D9 requires self-hosters to see no change — under implicit all-to-all friendship, today's 'shared' behavior equals a FRIENDS-tier default, so household-default would silently change self-hosted behavior. The unstated consequence that must be made explicit: a friends-tier note authored while friendless becomes visible to every FUTURE friend the moment an edge is created (same lens semantics as D3's 'friend links make existing recipes visible immediately') — retroactive exposure that will surprise users if the composer hides the tier.

Resolution gist: the operator amended the tier set to `public | friends | private` (household tier dropped; public bounded by the recipe's own lens); default `friends` both profiles; migration is pure mapping; retroactivity stated as a live lens. → D30-final.

### Data export: lens-aware scope, at-rest storage collides with the storage-tier doctrine, and email delivery must not carry tokenized links
**major · resolved by D33**
PAGES: pages/13-account-and-security.md, stories/01-households-and-friends.md

Pages/13 q3 leaves export scope and retention open, and the async-job design has a hidden dependency: there is nowhere doctrinal to PUT a generated zip. ARCHITECTURE mandates 'per-tenant data never lands in R2', KV is 'ephemeral infrastructure only, no domain data', and D1 blob rows are wrong — an export zip is the most concentrated per-tenant artifact in the system. Scope is also lens-sensitive: 'recipes' in a member export must not include friends' recipes (visibility ≠ ownership; an export would survive unfriending) or other members' notes; and 'if your email address is set, we'll send you a message' invites the classic mistake of a tokenized download link in email (weaker than the passkey model).

Resolution gist: scope is ownership-based, never visibility-based (own member-scoped data + household operational state + own imports' bodies; never friend-lens recipes or others' notes); synchronous streamed delivery; any future email is notification-only, no tokens or signed URLs. → D33.

---

## Widgets (6)

### Story 06's protocol 'spike' is answerable now — and the answer corrects the story's own recommended design (updateModelContext has overwrite + deferred semantics; bare tool-call writes are invisible to the model)
**blocker · resolved by D18**
PAGES: product-specs/stories/06-dual-use-widgets.md, product-specs/DECISIONS.md

Story 06 open q1 defers the protocol surface to 'a spike against the current MCP Apps SDK before the first widget change', and q2 recommends 'micro-writes silently, one consolidated context update at interaction boundaries'. The MCP Apps spec (2026-01-26, ext-apps SDK 1.7.4 — the exact version packages/widgets already pins; Claude web+desktop support shipped 2026-01-26) settles this, and partly contradicts q2's recommendation. There are exactly three agent-facing channels: (1) ui/update-model-context — silent, never triggers a model turn, host MAY defer delivery until the next user message, and EACH UPDATE OVERWRITES THE PREVIOUS ONE; (2) ui/message (App.sendMessage) — a conversation message that can trigger a model turn; (3) app-initiated tools/call (App.callServerTool) — whose calls/results are NOT automatically visible to the model. Consequences: (a) per-interaction context updates are free and correct via updateModelContext, so q2's debounce/consolidation is unnecessary and its 'micro-writes silently' phrasing is exactly the D4 state-divergence bug — a callServerTool write with no accompanying updateModelContext is invisible to the agent; (b) because updates OVERWRITE, they must be full-state snapshots ('current list: 12 lines, 5 checked, spaghetti swapped for linguine'), never event deltas ('user checked eggs' would be erased by the next update); (c) only turn-triggering sendMessage needs consolidating at commit/send boundaries. Repo grounding: the shipped ProposeCard uses only callServerTool + sendMessage; updateModelContext is unused today, and the existing capability-probing stance (meal-plan-widget spec: '_meta.ui.resourceUri unconditionally... capability signal unreliable') must extend to the new primitives (degrade gracefully when a host — e.g. possibly Claude mobile — lacks them).

Resolution gist: the fixed three-channel template replaces the spike — callServerTool write + immediate full-snapshot updateModelContext (never deltas, never debounced) + sendMessage only at commit/send/close; capability-probed degradation ladder. → D18.

### D8's UX cuts collide with the meal-plan-widget spec's required control set — under 'one component, two hosts' the conversation widget's controls must be decided before the plan-your-week band
**blocker · resolved by D20**
PAGES: product-specs/pages/04-plan-your-week.md, product-specs/stories/06-dual-use-widgets.md, openspec/specs/meal-plan-widget/spec.md

The living meal-plan-widget spec REQUIRES the widget's controls to include 'nights, variety, lock / swap / exclude, per-slot vibe override, re-roll', and the shipped ProposeCard renders lock/exclude/adventurousness/protein-wants/freeform/reroll via NudgeBar/SlotCard/RerollButton. D8 cuts exactly those from the member surface, and S4/story 06 mandate ONE implementation across both hosts. Page 04 flags only the member-app-propose weather-strip collision; the meal-plan-widget collision — the load-bearing one for story 06 — is nowhere acknowledged. An autonomous proposal session will either fork the component per host (violating S4's one-component steer) or silently strip the conversation widget's contractual controls without the spec delta (silent drift, which D8 itself forbids).

Resolution gist: the cuts bind the SHARED component in both hosts — identical visible control set, no fork; tool params retained unchanged; meal-plan-widget's control list re-enumerated in the landing change, tracked as an obligation until then. → D20.

### Commit/send must be pinned as widget-performed writes; today's shipped precedent (widget never writes, commit delegates to the agent via sendMessage) contradicts story 06's design rule and would misdirect a proposal
**blocker · resolved by D18**
PAGES: product-specs/stories/06-dual-use-widgets.md, product-specs/pages/04-plan-your-week.md, product-specs/pages/05-grocery-list.md, openspec/specs/meal-plan-widget/spec.md, openspec/specs/mcp-server/spec.md

The shipped display_meal_plan tool is contractually 'NO writes — persist a chosen week with update_meal_plan', and ProposeCard.commit() only sends the user message 'Add this proposed week to my meal plan.', trusting the model to execute the write. Story 06 §2 instead presumes every interaction 'performs a backend write' plus a context update, and asks per interaction 'which of the two is the source of truth on conflict'. These are two different architectures and the spec set never picks one: (a) widget-writes-then-announces, or (b) agent-writes-on-request (the shipped precedent). An autonomous session will copy whichever it reads first. Repo doctrine decides it: 'everything deterministic is plain code inside the Worker's tools' — delegating a commit to the model risks a mis-executed or silently-dropped write and costs a turn anyway. Choosing (a) also dissolves the conflict question (the D1 write is authoritative; the context update mirrors it), but requires deltas to meal-plan-widget's no-writes stance and the display-tool descriptions.

Resolution gist: all MCP-host mutations are widget-performed deterministic writes via the bridge — the model is never the write path; D1 write is always the source of truth; macro boundaries write AND announce; explicit degradation ladder; ProposeCard.commit() switches off sendMessage-delegation. → D18.

### No widget-state persistence exists in MCP Apps and hosts re-render from stale history — mutating widgets over household-shared state need a mandatory boot-time re-hydration rule
**major · resolved by D19**
PAGES: product-specs/stories/06-dual-use-widgets.md, product-specs/pages/05-grocery-list.md, product-specs/pages/04-plan-your-week.md

The MCP Apps spec defines NO state persistence or restoration; hosts prefetch/cache widget HTML and re-render widgets from conversation history with the ORIGINAL structuredContent. Story 06 §1 says only 'initial data arrives from the tool result that spawned the widget'. For the Grocery List and Order Review widgets over household-shared state (S1: multiple members mutate the same list), a conversation re-opened hours later renders stale lines, and its writes clobber newer state — a lost-update class the spec set never addresses. Page 04's session persistence ('localStorage today; keep') is also unreliable inside the sandboxed iframe. The conformant fix exists in-protocol: the view may call tools/call at boot, so a widget can re-read current state before accepting writes.

Resolution gist: the spawning payload is render-only; mutating widgets re-hydrate at boot via a bridge read and gate writes on it; lost-update guard is server-side (version echo, reject-or-merge); propose widget exempt by construction. → D19.

### Recipe Card cook mode collides with the guided-cook spec's recipe_display_v0 dependency and the recipe-card-widget spec's explicit read-only requirement — pick the conversation cooking card now
**major / NEEDS-USER · resolved by D32 (ratified as drafted)**
PAGES: product-specs/pages/02-recipe-detail.md, product-specs/stories/06-dual-use-widgets.md, openspec/specs/guided-cook/spec.md, openspec/specs/recipe-card-widget/spec.md

Three artifacts now conflict: (1) the living recipe-card-widget spec REQUIRES the yamp card to be read-only — 'SHALL NOT provide servings-scaling controls or step timers (that behavior belongs to the built-in recipe_display_v0 and requires structured ingredient/step data the reader does not provide)'; (2) the living guided-cook spec builds the entire cook walkthrough on the claude.ai BUILT-IN recipe_display_v0 card (with a widget-absent text fallback); (3) page 02 §3 now specs the dual-use Recipe Card widget WITH cook mode, per-step countdown timers, mise en place, and log-cooked/favorite writes — and its new body-annotation contract supplies exactly the structured ingredient/step data whose absence justified (1). The spec set says the widget is guided-cook's 'visual companion, not a replacement' but never says which card the cook skill emits in a conversation once both exist, nor that (1) needs a delta. An autonomous session could ship two competing cooking cards or refuse to add cook mode because the living spec forbids it.

Resolution gist: once body annotations land, the dual-use Recipe Card is the ONE conversation cooking card, superseding guided-cook's recipe_display_v0 dependency; same-pass deltas to recipe-card-widget and guided-cook; no interim dual-card state. → D32.

### 'One component, two hosts' from the current baseline is a refactor of two live surfaces plus net-new tool surface — the proposal must budget it or 'one implementation' silently becomes a third copy
**major · resolved by D25 (item 4)**
PAGES: product-specs/stories/06-dual-use-widgets.md, product-specs/pages/04-plan-your-week.md, product-specs/pages/05-grocery-list.md

Today the presentational primitives ARE shared (@yamp/ui propose.tsx: SlotCard, NudgeBar, VarietyBar, NightsStepper — 687 lines consumed by both hosts), but the stateful orchestration is DUPLICATED by hand: packages/app/src/lib/propose.ts (177) + routes/_app.propose.tsx (368) vs packages/widgets/src/ProposeCard.tsx (436), whose comments say 'the member app's ProposeSession, faithfully' — i.e. a hand-synced copy of session/buildRequest/toView. Story 06 §1's 'one implementation per widget, with the data plumbing abstracted per host' therefore means LIFTING the orchestration out of both existing surfaces into the shared package and rebuilding the member propose page over it — a refactor with regression surface on a shipped page, not additive work. Additionally: no grocery display tool exists (story 06's 'grocery display tooling' is aspirational), the Order Review widget and its tool are net-new, and the member grocery page's guts need the same lift. A proposal that reads story 06 as 'wrap the new widgets' will underscope by roughly half.

Resolution gist: the propose-orchestration unification is its own early band-2 change (shared component + host adapters) before the page-04 redesign; grocery/order widgets follow the established pattern; net-new vs existing Worker surface enumerated. → D25.

---

## Sequencing (4)

### Band 1's meal-dimension change is under-specified on the plan-row identity key — the single decision every downstream slice inherits
**blocker · resolved by D26 (as amended: D26-final)**
PAGES: stories/02-meal-dimension.md, pages/03-meal-plan.md, pages/04-plan-your-week.md

Story 02 lists `meal_plan.meal` as a new column but never states whether the row identity changes. Today `meal_plan` is PRIMARY KEY (tenant, recipe) (packages/worker/migrations/d1/0005_session_state.sql:31), the offline write-replay contract keys plan rows 'by recipe slug' (docs/ARCHITECTURE.md, two-writer posture), and `log_cooked` clears the plan row by slug in the same transaction (cooking-history spec). Three downstream surfaces silently depend on the answer: (a) the 7-day x 3-meal empty-slots grid implies a recipe could occupy two slots (oatmeal Mon+Wed breakfast) — impossible under the current PK; (b) the projects section must live somewhere the to-buy derivation already reads (member-app-grocery's shared read walks `meal_plan`), or the derived-read op gains a second source; (c) class-(b) idempotent replay and the log_cooked plan-clear both break or change semantics if the key gains `meal`. An autonomous proposal session would have to decide this unilaterally, and the grid/commit/duplicate-handling questions in pages/03-04 all hinge on it.

Resolution gist: decided at ratification against the drafted keep-the-PK option — per-slot ULID identity with the planner-no-duplicates invariant; projects stay meal='project' rows; migration mints server-side ids once; same-pass lockstep enumerated. → D26-final.

### Pages 09 and 10 (Preferences planning card, brand-tier card, Meal vibes tab) are assigned to no band
**major · resolved by D25 (item 2)**
PAGES: 00-overview.md, pages/09-profile-taste-and-preferences.md, pages/10-profile-meal-vibes.md

00-overview's bands cover Cookbook/Plan/Propose/Pantry/Retrospective (band 2), the store card (band 3), Discovery/Satellites (band 6) and Account (band 7) — but the Preferences tab's per-meal cadence steppers, the weekly-budget control, the brand-tiers management card, and the entire Meal vibes tab (meal grouping, inline suggestions) appear in no band. Three of these are hard prerequisites of other bands: band 3's order review writes brand tiers ('Save {brand} as my preferred brand') into a model with no management surface; band 4's spend analyzer reads a budget preference no UI can set (story 03 notes the mock forgot the control); band 1's cadence migration changes propose defaults members can't see or adjust.

Resolution gist: band 1 gains a coupling rule (a migration retiring an edited preference shape ships with its member-UI update); a named band-2 slice `profile-planning-and-vibes-ui` lands right after band 1's schema change; the brand-tier card rides the brand-tier model change. → D25.

### Spend capture welded to band 3 starves band 4's analyzers of history — pull order-commit capture forward
**major · resolved by D25 (item 1)**
PAGES: 00-overview.md, stories/03-cost-and-waste-telemetry.md, pages/07-retrospective.md

The analyzers read trailing 4/8/12-week windows; events only exist from the moment capture ships. The overview couples spend capture to band 3's large order-review rework, so by the time band 4 lands the analyzer renders 'not enough history' for months. But the primary capture source needs none of band 3's UI: `place_order` already resolves per-line prices at preview and persists learned mappings — persisting committed lines as spend events (+ the household weekly-budget preference) is a small, UI-free change on today's commit path. Waste capture is already correctly placed in band 1 (disposition), which validates the same accrue-early logic.

Resolution gist: spend capture pulls forward to band 1 as its own UI-free change on the existing order-commit path; band 4's dependency becomes "1's disposition + spend capture"; band 3 EXTENDS capture. → D25.

### Band 7 'independent; can land any time' is wrong for half the Account tab — the member-identity slices depend on band 5
**major · resolved by D25 (item 3)**
PAGES: pages/13-account-and-security.md, 00-overview.md, stories/01-households-and-friends.md

Username/@handle change is defined by story 01 as 'a mutable display key over stable member ids' — pre-band-5 there is no member id distinct from the tenant, so building rename now means building it twice (tenant-username rename, then member-handle rename with a different ripple surface). Session enumerate-by-member, grant metadata, and export scope ('household-shared data in a member export?') are likewise member-split-shaped. Recovery email additionally needs an email SENDER that does not exist (the Worker's email() is the receive path for newsletter discovery; nothing sends). Meanwhile the genuinely independent pieces (passkey management ceremony, System theme, Kroger card, Disconnect-all confirm, connect modal) are being held hostage by the coupling.

Resolution gist: band 7 splits into 7a account-security-basics + connect-modal (any time), 7b post-band-5 (handle rename, export scope), 7c recovery-email (blocked on an outbound sender; planning-time spike). → D25.

---

## Toolcontract (4)

### The visibility lens has no named enforcement point in the shared read ops, and /cookbook + recipe_site_url leak the whole corpus under SaaS profile
**blocker · resolved by D11**
PAGES: stories/01-households-and-friends.md, pages/01-cookbook.md, pages/02-recipe-detail.md

S2 says visibility is an overlay over one corpus, but the spec set never enumerates WHERE the lens is enforced. Every corpus read today is 'whole shared corpus minus the caller's rejects': search_recipes, read_recipe (slug-addressable — slug probing would read another household's private recipe), display_recipe, read_recipe_notes, list_new_for_me, propose_meal_plan's pools, similar-recipes, trending/picked-for-you, and — critically — the Worker's /cookbook route (recipe_site_url points members at 'the static browse view of the shared corpus'). Under the SaaS profile, an unlensed /cookbook or read_recipe is a cross-household data leak; enforcing the lens only in the member-app queries while MCP tools stay corpus-wide would violate the invariant. No page/story mentions /cookbook at all.

Resolution gist: ONE shared enforcement point in the corpus read path with the consumers enumerated (per-surface reimplementation is a defect class); invisible = unknown slug on every read; no slug-probing oracle. → D11.

### D8's existing-spec collision list is incomplete: the cuts delta at least four spec requirements beyond the weather strip DECISIONS names
**major · resolved by D20 (ledger recorded in D8 itself)**
PAGES: pages/04-plan-your-week.md, pages/10-profile-meal-vibes.md

DECISIONS D8 names one collision (member-app-propose's weather strip). But the cuts also contradict: (1) member-app-propose 'The propose flow UI iterates live...' which REQUIRES the adventurousness slider, protein-want chips, freeform input, per-slot lock, and exclude — all cut; (2) member-app-core 'Reconciliation queue with member confirmation' — the standalone queue dissolves into inline suggestions; (3) member-app-core 'The vibe-suggest trigger is gated by derivation job health' — the manual trigger is cut; (4) meal-plan-widget 'Widget-initiated iteration re-invokes the stateless op' which enumerates the card's dials as 'nights, variety, lock / swap / exclude, per-slot vibe override, re-roll' — since the widget is dual-use (S4), the D8 member-surface cuts reshape the MCP-host card's dial set too, and TOOLS.md display_meal_plan's dial list follows. Note the cuts are member-surface only: propose_meal_plan the DATA tool keeps lock/exclude/nudges for the agent — a proposer must not remove tool params.

Resolution gist: D8's parenthetical expanded into the complete collision ledger (member-app-propose rewritten wholesale; member-app-core queue→inline + merge_recipes clause deleted; vibe-suggest trigger deleted; meal-plan-widget control list re-enumerated) with the tool-param retention guard stated. → D20 (and D8's updated text).

### Tool renames and retired preference keys need an explicit skew/deprecation posture — update_preferences hard-rejects unknown keys and stale plugin skills will call old names
**major · resolved by D21**
PAGES: stories/02-meal-dimension.md, pages/09-profile-taste-and-preferences.md, pages/10-profile-meal-vibes.md

Two deprecation cliffs the spec set doesn't address: (1) update_preferences rejects unknown top-level keys with validation_failed; when lunch_strategy/ready_to_eat_default_action are removed and cadence changes shape, any member running a not-yet-synced plugin bundle (or a mid-conversation cached skill) writing the old keys hard-errors. (2) Renaming the add_night_vibe family to meal-vibe names breaks stale skills the same way (the Worker deploys before the plugin republishes, and members' auto-sync is not instantaneous). TOOLS.md documents no alias/deprecation convention.

Resolution gist: every rename/key-removal ships a one-deprecation-window shim under a new TOOLS.md deprecation convention — night_vibe dispatch aliases, retired keys accepted-and-dropped with warnings (never validation_failed), default_cooking_nights alias; value migration runs as pipeline convergence. → D21.

### Spend-event capture has no defined write point that covers all fulfillment paths — agent-driven receive flows and satellite receipts would silently under-count the analyzer
**major · resolved by D16**
PAGES: stories/03-cost-and-waste-telemetry.md, pages/05-grocery-list.md, pages/07-retrospective.md

Story 03 says 'persist the committed order's lines as spend events' (cart-write time) and 'Log a manual shop' marks checked lines purchased — both app-flow framings. But: (a) cart-commit time is dishonest — in_cart items may never be purchased (the cleared-cart gate exists precisely because carts are unreadable); the honest boundary is the user-asserted `ordered` transition. (b) The agent-driven paths — 'I placed the order' via update_grocery_list, the receive flow (remove_from_grocery_list + update_pantry), and the satellite order-receipt flush (which advances lines to in_cart exactly as place_order does) — are not mentioned; if spend events are written only by app endpoints, agent-first members' spend analyzer is structurally empty. This is a capture→retrieve contract that must live in the shared ops (one operation, two transports — member-api spec), decided before bands 3–4.

Resolution gist: one shared src/ event-writer below every path that crosses the purchase boundary (all three in_cart→ordered code paths, receive-of-in_cart, the shared manual-shop/walk op); re-listing an ordered row voids its events; no MCP spend-write tool. → D16.
