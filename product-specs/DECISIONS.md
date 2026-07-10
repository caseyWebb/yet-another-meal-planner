# Decision log

Authoritative product decisions for this spec set, in chronological order. A page/story
spec that conflicts with an entry here is stale — this file wins. Entries marked
**(ratify)** are recommendations awaiting the operator's confirmation; everything else is
decided.

## 2026-07-10 — operator steers (session 1)

- **D1. Tenant = household.** Tenants optionally hold multiple member accounts;
  friendships are tenant-to-tenant links. (stories/01)
- **D2. Visibility lenses over one corpus; dedup + memoize everything.** Recipe
  visibility is an overlay, never segmentation. Any processed artifact (fetch, parse,
  facet derivation, embeddings, match caches, feed polls) is identity-keyed and computed
  once. Identity-keyed shared memoization applies to artifacts derived from the SOURCE
  (fetch, parse, facets, embeddings, SKU/flyer/aisle data — public-derived); data derived
  from tenant BEHAVIOR (prices paid, follows, cook activity, waste events) is memoized
  within its owning scope only and crosses tenants exclusively through the defined
  lenses/aggregates. (stories/01)
- **D3. Empty corpus on join.** No inherited corpus for a new household; friend links
  and a small product-maintained public curated set cushion the cold start. (stories/01)
- **D4. Widgets are dual-use MCP Apps.** Four dual-use widgets (Meal Planning, Grocery
  List, Order Review, Recipe Card) render as member-app page components and as MCP Apps;
  RecipeRow is a shared @yamp/ui primitive consumed by both hosts' list surfaces — not
  itself an MCP App. One component, two hosts (member app + Claude conversations); in
  the MCP App host every mutating interaction must send updated context to the agent via
  the MCP Apps protocol — silent backend writes that the agent never sees are
  state-divergence bugs. (stories/06)

## 2026-07-10 — operator steers (session 1, grilling round)

- **D5. Mock data mechanics are painted-door.** The mockup's hardcoded data, selection
  logic, and unwired states demonstrate the experience, not the mechanism. Specs cite
  them as UX contracts only; real sourcing comes from the repo's existing derivation
  doctrine.
- **D6. "Offline" store adapters are a rename, not a new entity.** They are the existing
  generic non-Kroger stores surface (`list_stores` / `add_store` / store notes, incl.
  the `layout` aisle notes). The Preferences card re-surfaces that data with the aisle-map
  editor; no parallel store table.
- **D7. Instacart is genuinely new** — new integration, feasibility spike before its
  proposal. (stories/04)
- **D8. The UX cuts are deliberate and final.** Cut from the member app: slot lock +
  exclude, adventurousness dial, protein wants, freeform propose phrase, global reroll,
  the propose weather strip, lunch strategy pref, ready-to-eat default-action pref, the
  standalone vibe reconciliation queue (inline suggestions replace it), the manual
  "Suggest from your cooking" trigger, and member-app surfacing of `merge_recipes`
  proposals (they remain agent-side). Where a cut contradicts an existing spec, the band
  that lands the surface updates that spec in the same change — deltas, not silent
  drift. The full collision ledger (per D20): `member-app-propose`'s live-iteration
  requirement (slider, protein chips, freeform input, lock, exclude, why chips, weather
  strip, reroll) rewritten wholesale; `member-app-core`'s reconciliation queue → inline
  suggestions and its `merge_recipes` render clause deleted; `member-app-core`'s
  health-gated vibe-suggest trigger deleted (the cron carries generation);
  `meal-plan-widget`'s "Widget-initiated iteration" control list re-enumerated +
  TOOLS.md's `display_meal_plan` dial list in the same pass. The cuts are member-surface
  control removals only — `propose_meal_plan`/`display_meal_plan` tool params (lock,
  exclude, nudges, freeform, seed) are retained unchanged. Where a cut removes a
  preference (`lunch strategy`, RTE action), its proposal defines the migration onto
  meal vibes.

- **D9. Deployment profiles (long-term feature flags): "self-hosted" and "SaaS".**
  The **self-hosted** profile hides the friends functionality and makes everyone in the
  deployment friends by default — an implicit all-to-all graph. Because visibility is a
  lens (D2), implicit universal friendship reduces exactly to today's shared-corpus
  experience: self-hosters see no change beyond gaining household members. The **SaaS**
  profile enables the full friends surface, empty-corpus-on-join, and the curated set.
  Profiles are deployment configuration, not migration scaffolding — they live
  indefinitely. Consequences: no tenant/corpus data surgery for existing deployments;
  the People page renders household-only under self-hosted; "Popular with Friends" reads
  the friend lens in both profiles (under self-hosted it equals deployment-wide trending,
  so no relabel is needed); empty-corpus-on-join and the curated set apply to the SaaS
  profile only.

## 2026-07-10 — grill synthesis (session 1)

Produced by the adversarial grill (8 lenses, 38 verified findings). D10–D25 are decided
(derivable from repo invariants + D1–D9); D26–D33 are **(ratify)** recommendations
awaiting the operator — accept/veto per entry. `covers:` lines trace findings.

## Decided by doctrine

- **D10. The member identity split ships first; today no credential layer knows a
  member.** Verified: the OAuth grant carries props `{tenantId}` only; web sessions store
  `{tenant, created_at, refreshed_at}`; WebAuthn credentials are tenant-keyed with user
  handle = tenant id; `recipe_notes.author` is tenant-valued. "Per-member grants already
  exist" (story 01 q6, story 06 q3) is false — true only while member = tenant. The split
  is band 5's first change and the dependency of every member-scoped feature: a `members`
  table (id, tenant, handle, created_at); every existing tenant declares a founding
  member whose member id EQUALS the tenant id (WebAuthn user handles are burned into
  authenticators; D9 forbids surgery) — existing grants, sessions, credentials, and
  note-author values stay valid with zero re-keying. Grant props, session records, and
  `webauthn_credentials` gain the member dimension; approval binds (tenant, member); both
  the MCP and /api paths resolve (tenantId, memberId) before any tool/route runs. Tenant
  stays the isolation boundary; member is attribution within it. Same band:
  `operator-admin` lifecycle splits into member-revoke vs household-purge; invite codes
  mint/resolve (tenant, member) pairs.
  covers: member-identity-at-credential-layer (doctrine); MCP-grant/passkey member
  binding (privacy); operator-admin lifecycle conflation (migration)

- **D11. One lens enforcement point; the anonymous reader is the bottom lens position.**
  Visibility resolves at ONE shared point in the corpus read path that every consumer
  goes through; per-surface reimplementation is a defect class. Enumerated consumers:
  `search_recipes`, `read_recipe`/`display_recipe`, `read_recipe_notes`,
  `list_new_for_me`, propose pools, similar-recipes, trending/picked-for-you, the member
  cookbook queries, AND the anonymous `/cookbook` route + `recipe_site_url`. Under SaaS
  the anonymous lens holds only the curated tier — index, search ranking, and Similar
  Recipes compute over that set only; `/cookbook/<slug>` outside the lens 404s
  indistinguishably from a nonexistent slug (no slug-probing oracle; same for
  `read_recipe`). `recipe_site_url` hands out cookbook links only for anonymously-visible
  recipes; lens-scoped recipes link the member app's detail page. Under self-hosted,
  implicit all-to-all reproduces today's full-corpus site exactly — one implementation,
  both profiles. The lens band deltas `cookbook-search`, `cookbook-similar-recipes`,
  `data-read-tools`, `member-app-differentiators`, `semantic-recipe-search` in the same
  change, plus a threat pass over every anonymous read surface.
  covers: public /cookbook lens bypass (privacy); lens enforcement point +
  recipe_site_url (toolcontract)

- **D12. Lens structure: provenance import rows; curated = reserved system tenant;
  legacy rows backfilled through the same primitive.** Canonical structure (final DDL in
  the band's proposal): one provenance row per (recipe, household) —
  `recipe_imports(recipe, tenant, member, via, imported_at)`, `via ∈ {agent, feed:<url>,
  satellite, curated}` — visibility(H, R) computed at read time (own import ∨
  friend-of-H import ∨ curated import); the imports×friendship join IS the grant, no
  materialized per-viewer rows. The curated set is a reserved system tenant visible to
  everyone. Terminology: "visibility lens"/"lens" exclusively; "overlay" stays reserved
  for the shipped favorites/rejects table. Legacy attachment: the join alone passes NO
  legacy recipe (zero import rows exist), so an idempotent reconcile attaches every
  existing corpus row to ≥1 household via this same primitive — rows with discovery
  attribution get a grant per attributed tenant; all others attach to the operator's
  household; no NULL-owner sentinel, no profile code-path bypass; production
  attached/unattached counts are the acceptance fixture, and import paths record
  attribution at creation so the class never regrows. One predicate serves both profiles.
  covers: lens table unnamed (datamodel); legacy corpus ownership backfill (migration)

- **D13. Sweep imports and the curated set enter the lens as ordinary imports.** A sweep
  import's visibility grants ARE its attribution rows: visible initially to exactly the
  households of its confirmed-matched members (the `discovery_matches` row is the grant;
  a candidate confirmed across N households gets N grants), traveling further only
  through friend lenses — never public by default, never orphaned invisible. Under D1,
  `discovery_matches` gains a member key; attribution stays per-member
  (`list_new_for_me` filters by matched member) while visibility is per-household — two
  reads of the same rows. Feed→member "brought you N recipes" rollups read the same rows
  joined to `discovery_log` origin, so attribution and visibility cannot drift.
  Curated-set distribution: never a committed seed in the code repo ("no data in this
  repo") — a product-maintained public source (pinned public feed/data-repo URL,
  defaulted in deployment config) consumed per-deployment by the existing sweep/import
  pipeline, landing provenance-tagged as the curated tier (SaaS-only floor per D9).
  Per-member hiding is the existing `toggle_reject`; household-level hide defaults to no.
  covers: sweep-import visibility + curated distribution (doctrine)

- **D14. Satellite trust under SaaS: provenance-classed identity keys; sale scans
  tenant-scoped; rejections household-read.** Satellite data rides the same D2 lens and
  D9 profiles — no new sharing machinery. Corpus rows carry a provenance class:
  worker-fetched copies key by URL and are always canonical for that URL;
  satellite-observed copies key by (URL, content-hash) and are visibility-scoped to the
  pushing household's lens. An outside household never dedups onto a satellite copy: a
  worker-fetchable URL gets the Worker's own canonical fetch (matching hashes merge onto
  it); a walled URL needs the household's own observation — identical hashes converge,
  divergent content forks rather than poisons; derived artifacts memoize per
  content-hash, preserving D2's compute-once. Satellite sale observations are
  tenant-attributed at intake and read through the lens; only worker-fetched first-party
  sources stay in the cross-tenant flyer plane (its public-derived argument survives
  verbatim; self-hosted all-to-all equals today's shared cache). Member-facing rejection
  reads return only the caller's household's entries, all kinds; admin keeps the
  superset. Member-minted keys are household-bound; mint/revoke/quarantine authority =
  any member of the owning household; operator-global keys stay admin-only. Same pass:
  `satellite-source-audit`'s trust premise is rewritten — intake tenancy + lens scoping
  IS the cross-tenant boundary.
  covers: satellite trust breaks under SaaS (privacy)

- **D15. Every new write is classified against the shipped two-writer/offline posture.**
  Idempotent, canonical-id-keyed upserts/deletes are class (b) — each band's proposal
  carries the member-app-offline delta registering them. Whole-document editors
  (preferences, taste/diet markdown, brand-tier documents, aisle-map layout, vibe edit)
  are class (a) If-Match. Everything non-idempotent or externally-effectful (order
  review end-to-end incl. save-preferred-brand, propose, feed add-with-probe, social
  requests/accepts/invite mints, security ops, connect/disconnect, export) is
  online-only-with-hint; pure view state stays client-local; anything unlisted defaults
  online-only. Telemetry events carry client-minted idempotency keys: waste events an
  event id; manual-shop/walk completion a session id (spend materialization and row
  advancement dedupe on it). The store walk MUST function with zero connectivity:
  check-offs and completion are class (b) queued writes keyed by the client-minted
  session id, replayed on reconnect; starting a walk needs no server round-trip. Vibe
  create/delete are already class (b); vibe edit class (a). Story 06 q4 stands: the MCP
  App host is online-only.
  covers: ~25 unclassified writes (consistency)

- **D16. Spend telemetry: snapshot at send, materialize at the purchase assertion,
  inside the shared ops — every fulfillment path.** SNAPSHOT: `place_order` (and the
  satellite cart-fill receipt's in_cart advance) persists per-line resolved prices
  {pick/sku, qty, unit + promo price, flyer savings, store, fulfillment path,
  provenance} on a send record — the Order Review tiles render this snapshot, which is
  what makes tiles and analyzer agree on one source. MATERIALIZE: spend events are
  written by ONE shared src/ writer at the purchase assertion — the in_cart→ordered
  advance on every path (`update_grocery_list`, member "Mark order placed", satellite
  mark-placed), or receive of an in_cart row (agents that collapse ordered+received) —
  copying snapshot prices verbatim, idempotent on (send id, line). Walk/manual-shop
  events materialize at completion via one shared shop-commit/receive operation (member
  walk UI and the agent voice walk converge on it; `in-store-fulfillment` gets its
  delta), best-effort priced (sku_cache → warmed flyer → per-household last-paid memo,
  flagged estimated). Emission lives inside shared operations, never a surface. Negative
  rules: rows leaving in_cart without a purchase assertion write no spend; receive prices
  nothing itself; re-listing an ordered row voids its events; never-marked orders surface
  as "awaiting mark-placed", not auto-counted.
  covers: spend timing send-vs-placed (consistency); emission in shared flush/receive
  ops (doctrine); write point across all paths (toolcontract)

- **D17. One canonical analytics `department` dimension, stamped at capture.** The
  dimension = page 06's controlled food-category vocab + `Household` + `Leftovers`,
  stamped immutably on every spend and waste event at capture — never derived at read
  time, never taken from store placement. Derivation is deterministic and identity-keyed:
  item → canonical ingredient id (IngredientContext funnel) → category, memoized per
  identity — the SAME source pantry-add autofill uses (closing page 06's category
  question in the same decision). Overrides bypass derivation: grocery `kind: household`
  → Household; pantry `prepared_from` rows → Leftovers (waste only); non-grocery
  `domain`/`kind: other` lines map to Household or are excluded from spend — SCHEMAS.md's
  "2x4 lumber" row is the fixture. Consequences: the cost-per-meal exclusion = {Household,
  Beverages} of this dimension; events keep their capture-time stamp (vocab evolution
  never rewrites history); "Not mapped" can never reach analytics. Store placement
  {aisle, department} stays presentation-only for list grouping and the walk — rename or
  annotate it (e.g. `placement.section`) so the two "department"s cannot be conflated.
  covers: three department notions (consistency)

- **D18. MCP App interactions: the widget performs the write; three fixed protocol
  channels; the model is never the write path.** Every mutating interaction in the MCP
  host does exactly: (1) a deterministic backend write via `App.callServerTool` to an
  app-callable Worker tool — D1 is always the source of truth; (2) an immediate
  `ui/update-model-context` carrying a FULL current-state snapshot mirroring D1 — never
  an event delta (updates overwrite each other; hosts may defer delivery), never
  client-side debouncing; a `callServerTool` write without a context update is invisible
  to the agent and is the D4 bug by definition; (3) `ui/message` only at
  commit/send/close boundaries where a model turn is wanted. Grounding: MCP Apps spec
  2026-01-26, ext-apps SDK ^1.7.4 (already pinned), Claude web+desktop support — no spike
  needed; the residual probe is host `updateModelContext` support. Macro boundaries write
  AND announce: plan commit = the slug-keyed idempotent plan-ops upsert; order send =
  `place_order` (the only Kroger cart writer). Degradation ladder: serverTools → write
  (+outcome message); sendMessage-only → today's delegation message as explicit fallback;
  neither → control disabled, text fallback. The first writing-widget change deltas
  meal-plan-widget's "NO writes" stance; `ProposeCard.commit()` switches off
  sendMessage-delegation.
  covers: protocol spike answerable now (widgets); commit/send write architecture
  (widgets)

- **D19. Widget freshness: the spawning payload is render-only; re-hydrate at boot;
  server-side version guard.** Hosts cache widget HTML and re-render re-opened
  conversations from the ORIGINAL structuredContent — so the spawning tool result is a
  render-only snapshot: sufficient for first paint and the text fallback, never trusted
  as current state for writes. Every widget mutating persistent state (Grocery List,
  Order Review, Recipe Card's log-cooked/favorite) re-hydrates on boot via a bridge read
  tool and gates mutations on a successful re-hydrate; bridge unavailable → read-only
  render (the existing degrade path). The lost-update guard is server-side: shared-state
  payloads carry a version/updated_at, mutating calls echo it, and the Worker
  rejects-or-merges stale writes — a fourth required item in the per-interaction design
  rule. The propose widget is exempt by construction (stateless replay; commit packs
  against current plan state server-side); its localStorage session-persistence line is
  member-app-host-only. Additionally every widget payload gains a `contract_version` (in
  @yamp/contract); widgets degrade to read-only on unknown-newer payloads; additive-only
  evolution within a major — applied retroactively to ProposeCardData/RecipeCardData in
  the first dual-use change.
  covers: no widget-state persistence / stale re-render (widgets)

- **D20. D8 corollary: the cuts bind the SHARED component in both hosts, and D8's
  collision ledger is completed.** The cuts apply to the shared Meal Planning component,
  so the conversation widget's visible control set is identical to the member page's
  (per-meal steppers, swap menu, facet chips, per-slot vibe override, sides editing,
  summary, commit) — no per-host divergence, no fork. Nothing is lost agent-side: lock,
  exclude, nudges (variety/proteins/freeform), and seed remain
  `propose_meal_plan`/`display_meal_plan` tool INPUT; the cuts are member-surface control
  removals only — tool params are retained unchanged (swap and session replay are
  implemented atop lock/pin/exclude in the replayed request). Complete ledger (recorded
  in D8 itself): member-app-propose's live-iteration requirement (slider, protein chips,
  freeform, lock, exclude, why chips, weather strip, reroll) rewritten wholesale;
  member-app-core's reconciliation queue → inline suggestions, its `merge_recipes` render
  clause deleted; member-app-core's health-gated vibe-suggest trigger deleted (the cron
  carries generation); meal-plan-widget's "Widget-initiated iteration" control list
  re-enumerated, TOOLS.md `display_meal_plan` dial list in the same pass. Until those
  deltas land, page 04 carries the meal-plan-widget delta as a tracked obligation.
  covers: D8 vs meal-plan-widget control set (widgets); D8 collision list incomplete
  (toolcontract)

- **D21. Tool renames and retired preference keys ship with a one-deprecation-window
  shim.** The plugin lags the Worker by design (Worker-first deploy, async marketplace
  re-pull, mid-conversation cached skills), so any tool rename or accepted-key removal
  ships a compatibility shim for one deprecation window, documented under a new TOOLS.md
  deprecation convention. Band 1 concretely: the `night_vibe` tool family renames to
  `meal_vibe` with the old names kept as dispatch aliases onto the same ops (removal
  after the matching plugin version has been published one window);
  `update_preferences` accepts retired `lunch_strategy`/`ready_to_eat_default_action` as
  accepted-and-dropped with a `warnings` field ({key, reason: "retired", superseded_by:
  "meal vibes"}) — never `validation_failed`, never the nest-under-`custom` hint (stale
  agents must not shadow the migration) — and accepts `default_cooking_nights: N` as an
  alias writing `cadence.dinner` for the same window. The D8 value migration (old prefs →
  seeded lunch/breakfast vibes) runs as pipeline convergence with pre-migration
  production rows as acceptance fixtures.
  covers: rename/retired-key skew cliffs (toolcontract)

- **D22. Cart-fill helper secrets never leave the satellite host.** The helper URL and
  session token get no wire field, no D1 row, no member/admin API — piping them home
  would exfiltrate a credential the satellite spec deliberately keeps local, and a
  loopback URL is useless off the satellite host anyway (the Worker is a sensor consumer,
  not a credential store). The Satellites cart-fill card shows only Worker-derivable
  facts: per-store fill count and last-fill time from order lists, liveness from push
  recency. Per-store session freshness becomes a satellite-reported boolean observation —
  an additive wire field on the existing push path, the same class as local reject
  counts — and that one field serves the card's "Re-run login" chip, the Preferences
  adapter summary, and the grocery launcher's disabled state. "Open helper" degrades to
  static per-deployment instructions ("open the helper on the machine running your
  satellite — it prints its address and token at start"), optionally augmented by a
  member-typed local address kept in browser-local storage only, never synced.
  covers: cart-fill LAN URL + token reveal (doctrine)

- **D23. Existing-account household-accept = member-move + tenant dissolution; household
  data never merges.** A member-move primitive atomically relocates member-scoped state
  (favorites/rejects overlay, taste + dietary, authored cook-log rows and notes, feed
  follows, passkeys/sessions, @handle, nicknames they set) between tenants — specced
  once, also implementing leave-household. Household-accept for a sole-member requester =
  member-move + dissolution: after an explicit in-flow confirmation enumerating what does
  NOT carry over, the old tenant's household state (pantry, plan, list, staples, stockup,
  ready-to-eat, stores + store notes, Kroger link) is purged via the revoke-shaped path
  minus member-scoped rows; its recipe visibility grants re-key to the absorbing
  household (lens-only — corpus and derived rows are already shared per D2); the old
  tenant id retires from allowlist and directory. Household data is deliberately never
  merged: pantry re-add is cheap; two Kroger links cannot merge. v1: a member of a
  multi-member tenant must leave-household first; multi-member tenants never merge
  wholesale. Ships as a flow, never D1 surgery; the deployment's first real household
  formation is the acceptance fixture.
  covers: tenant-merge has no story (migration)

- **D24. Directory abuse: enumeration-bounded lookup, invisible declines, block ships in
  band 5.** Exact-handle existence disclosure is accepted (self-service-signup already
  discloses "username taken"); ENUMERATION is bounded instead: lookup and request-send
  ride the existing shared fixed-window limiter, per-member AND per-IP (placeholder
  budgets 30 lookups/hour, 10 sends/day; tune at implementation). Decline is invisible:
  the requester's row stays "Request sent" forever; a declined pair enters a ~30-day
  re-request cooldown during which re-sends appear to succeed but deliver nothing; the
  outgoing cap counts every row the requester sees (pending + silently declined +
  swallowed) so the cap cannot become a decline oracle; cancel frees a slot, unnotified.
  Block ships in band 5, not a fast-follow: available on inbox rows, awaiting-response
  rows, and friend rows; directional records scoped to the tier they suppress; a blocked
  party's future requests silently swallow (their view: still "sent"); blocking a friend
  severs the link without notification; whether one member's block binds the household
  resolves with the member-remove governance call. Request notes: length-capped inert
  plain text, never delivered on swallowed requests. Silent-swallow block subsumes mute.
  covers: request spam / decline visibility / block-mute absent (privacy)

- **D25. Sequencing corrections.** (1) Spend capture pulls forward to band 1 as its own
  UI-free change on the existing order-commit path (spend_events + weekly-budget pref +
  order-placement delta); band 4's dependency becomes "1's disposition + spend capture";
  band 3 EXTENDS capture (impulse lines, savings tiles, manual-shop/walk path) — and its
  note reads "spend capture rides the shared commit ops", not "the order flow". (2)
  Pages 09/10 get a home: band 1 carries a coupling rule — a migration retiring a
  preference shape the shipped profile/vibes pages edit ships with, or is immediately
  followed by, its member-UI update; a named band-2 slice `profile-planning-and-vibes-ui`
  (page 09 planning card + budget control + page 10 vibes tab) lands right after band 1's
  schema change; the brand-tier management card rides the brand-tier model change. (3)
  Band 7 splits: 7a `account-security-basics` + `connect-modal` (any time, on
  tenant-as-member identity); 7b post-band-5 (handle rename, export scope); 7c
  `recovery-email` (blocked on an outbound sender that doesn't exist — planning-time
  spike). (4) The propose-orchestration lift (hand-duplicated ProposeSession copies unify
  onto one shared component + host adapters) is its own early band-2 change before the
  page-04 redesign; the grocery-list and order-review widgets (net-new tools + resources)
  then follow the pattern — story 06 is a refactor of two live surfaces, not a wrapper.
  covers: pages 09/10 unbanded, spend pull-forward, band-7 dependency split
  (sequencing); one-component refactor budget + band placement (widgets)

## (ratify) Recommended

- **D26. (ratify) `meal_plan` row identity is UNCHANGED — PRIMARY KEY (tenant, recipe)
  stays; `meal` is a plain non-key column.** Band 1 adds `meal:
  breakfast|lunch|dinner|project` (additive migration, default `dinner`) with row
  identity untouched. Consequences: one plan row per recipe at a time — an already-
  planned recipe MOVES between slots (sides preserved) and unscheduled adds re-tag,
  exactly pages/03's blessed semantics; week-level repetition is carried by vibes +
  cadence, not duplicate rows; repeat breakfasts are re-adds after cooking. Class (b)
  offline replay ("plan rows by recipe slug") and `log_cooked`'s atomic slug-keyed clear
  stay byte-for-byte. Projects are `meal='project'` rows (planned_for NULL, no sides),
  so `read_meal_plan` and the to-buy derivation get them free; the sidebar count filters
  `meal != 'project'`. Commit duplicate handling: update the existing row's
  meal/date/sides/from_vibe with visible feedback, never silent skip. The
  per-(date, meal, type, recipe) rule is cooking_log DEDUPE identity only, not plan-row
  identity. Rejected (recorded): a client-mintable surrogate row id enabling the same
  recipe in multiple concurrent slots — revisit only if real usage demands it; it reopens
  the offline-replay key, the log_cooked clear, and the commit contract. Rationale: the
  grill's lenses split; the page's own move/re-tag UX and three shipped contracts favor
  the minimal identity.
  covers: plan-row identity contradiction (consistency); band-1 identity key
  (sequencing)

- **D27. (ratify) Friend-share scope = the whole household cookbook.** A friend link
  makes the friend household's entire household-visible cookbook visible through the
  lens — no favorites-only mode, no per-recipe share control in v1; "sharing N recipes"
  is simply the friend household's cookbook size. Forced by D9's own mechanism: implicit
  all-to-all friendship reduces to today's everyone-sees-everything corpus ONLY under
  whole-cookbook scope; any narrower scope would make self-hosted migration silently
  lose visibility, contradicting D9's zero-change promise — if a narrower SaaS scope is
  ever wanted, D9's reduction mechanism must be amended in the same breath. Friend-tier
  visibility is derived (friendship edge + owning household), needing no per-recipe
  share-grant rows. Member-private recipes, if that tier ships, are excluded by
  definition (the friend lens sees household-visible and up). Note tiers (D30) are NOT
  decided by this entry. Closes story 01 §5 q1; the favorites-only and opt-in options
  are recorded as foreclosed by D9. Rationale: it is the only scope under which D9's
  equivalence claim is true.
  covers: friend-share scope forced by D9 (migration, needs-user); lens scope half of
  the unnamed-lens finding (datamodel)

- **D28. (ratify) Grocery "checked" is a new per-row `checked_at`, orthogonal to
  `status`; the walk has no server session entity.** Add nullable `checked_at` to
  grocery_list; the checkbox is a registered class (b) idempotent boolean upsert
  (offline-queued, replayed). `status` is untouched: `in_cart` remains exclusively the
  online-order stage — the stale-cart gate and the list's in-cart group keep reading it,
  distinct from checked rows as the page lays out. Checked = handled: checked rows drop
  out of the derived to-buy/order-review set until unchecked or swept; only "Log a manual
  shop"/walk completion sweeps them — applying receive semantics + D16 spend events to
  checked rows ONLY, never rows `place_order` or a satellite advanced. Walk mode is pure
  client state (mode in URL search params, transient progress local — the
  propose-session precedent); cross-device/member resume comes from the D1 `checked_at`
  rows; concurrent split-shop walks converge as row upserts — no walk_sessions table, no
  Durable Object. Completion = one shared idempotent shop-commit op (receive + pantry
  restock with verification + spend), exposed at /api and to the agent voice walk
  (`in-store-fulfillment` delta). member-app-offline's "check-off reaches in_cart"
  scenario is re-worded in the same band. Rejected: checked ≡ in_cart (a manual shop
  would sweep online-order rows; the stale-cart gate and in-cart group break).
  covers: checked vs in_cart collision (consistency); walk-session doctrine (doctrine)

- **D29. (ratify) Household composition: hard constraints UNION across members; soft
  signals from the ACTING member.** Hard constraints compose by union on every
  household-scoped output (proposed/committed plan, grocery list, order): any member's
  dietary Avoid applies; Limit takes the most restrictive; a recipe rejected by any
  member is excluded from household plans/proposals. Member-scoped reads (browse/search,
  trending, new-for-me) keep today's own-rejects gating. Soft signals (taste prose,
  favorites centroid, novelty, picked-for-you) come from the acting member: whoever runs
  propose ranks with their own taste; Recommended is per-member. Stated consequence: a
  household plan's ranking legitimately varies by who runs propose; its constraint floor
  does not. A household-blended taste centroid is a named, explicitly deferred follow-on
  — never silently improvised in a band. Vibes, per-meal cadence, and resurface-after
  describe the household's shared week: household-scoped, tenant-keyed with no member
  column — band 1's rename keeps them so, and the propose contract is written
  caller-neutral (hard floor from the household, soft profile from the caller). Per-tool
  member-awareness (story 01 q6) inherits this rule instead of re-deciding per tool.
  Rationale: union is the only composition that never feeds a member something they
  excluded; acting-member taste avoids inventing an unspecced blend.
  covers: member→household aggregation undefined (consistency)

- **D30. (ratify) Note visibility: tiers `private | household | friends`; default
  `friends`; retroactivity stated.** No public tier — member notes never render on the
  anonymous /cookbook surface. Forced by D9: under self-hosted, a note authored without
  an explicit tier must behave exactly like today's default-shared note — friends-tier
  under the implicit all-to-all graph. Migration is pure mapping, no surgery: `private`
  flag → tier=private; non-private → tier=friends. The one operator input is the SaaS
  default: recommended `friends` (one profile-independent default; matches the recipe
  lens and recipe-notes' collaborative spirit) vs `household` (least surprise — avoids
  retroactive exposure of notes authored before friendships form; profile-dependent
  defaults are precedented by D9). Retroactive rule, stated explicitly: visibility is a
  live lens — creating or severing a friendship, or changing a tier, re-evaluates
  visibility immediately in both directions; a friends-tier note authored while
  friendless becomes visible to every future friend; a severed edge immediately hides.
  The composer replaces the mock's Private checkbox with a three-state tier control
  showing the effective default at authoring time.
  covers: note visibility tiers + retroactivity (privacy, needs-user)

- **D31. (ratify) Friend cook-activity signals are household-counted aggregates behind a
  profile-conditioned min-signal guard.** No per-friend cook attribution anywhere —
  member app, dual-use widgets, or agent-facing reads. Recipe PROVENANCE through a
  friend link stays attributable ("sharing M recipes", browse provenance rows):
  provenance is the consented share; passive cook activity is not. Guard: under SaaS, a
  cook-activity signal (the "Popular with Friends" badge, the trend chip) renders only
  when its contributing set spans ≥2 distinct households besides the caller's own — a
  1-friend graph gets provenance but no cook signal, never "cooked by 1 friend". Under
  self-hosted, the existing member-app-differentiators guard (≥2 cooks OR ≥2 distinct
  cooking tenants) stands verbatim — one trending implementation with the guard
  parameterized by the D9 profile flag, preserving the solo-operator degenerate case; do
  NOT apply the stricter guard deployment-wide. The trend chip ships from this guarded
  read with household-counted copy. The landing change deltas member-app-differentiators
  explicitly. Rationale: with small friend sets, any count below the guard is exact
  identification of one household's kitchen.
  covers: popular-with-friends identification (privacy)

- **D32. (ratify) The dual-use Recipe Card (cook mode included) becomes the ONE
  conversation cooking card once body annotations land.** It supersedes guided-cook's
  `recipe_display_v0` dependency — D4 requires cook-mode completion, log-cooked, and
  favorite to reach the agent via the MCP Apps bridge, a channel the built-in card does
  not have. The landing change, same pass: (1) deltas recipe-card-widget's read-only
  requirement (its justification — no structured step data — is obsoleted by the
  annotation contract); (2) deltas guided-cook to emit `display_recipe`'s widget, keyed
  on the host rendering MCP Apps, keeping the conversational pre-flight, the plain-text
  fallback, user-owned timers, and the cooked-flow handoff; (3) reconciles the two
  structured-step paths into one step list (the tool/skill supplies cook-mode
  structuredContent; annotation parsing is the member-app/no-skill path). Until that
  change ships, guided-cook stays on `recipe_display_v0` — no interim dual-card state.
  Operator alternative: keep `recipe_display_v0` for conversations and scope cook mode
  member-app-only — explicitly, in all three files. Rationale: two competing cooking
  cards in one conversation is the worst outcome; the bridge requirement decides the
  winner.
  covers: cook-mode vs guided-cook/recipe-card-widget collision (widgets, needs-user)

- **D33. (ratify) Data export: synchronous streamed download; ownership-scoped; no
  tokenized links.** Storage and delivery are doctrine-forced: no async job, no stored
  artifact, no retention question — a session-gated GET under the existing /api mount
  (covered by the /api/* run_worker_first entry) assembles the export in-request and
  streams a zip; friend-group data is single-digit MB; the mock's "we'll email you" copy
  drops (no sender exists); "preparing" is just the in-flight request. SCOPE (the ratify
  part) — ownership-based and lens-aware, never visibility-based: (a) the member's own
  member-scoped data (notes incl. private — own only; cook log, favorites,
  taste/preferences, own friend/follow edges, nicknames they SET, never nicknames set
  for them); (b) household-shared operational state (pantry, plan, list, cook log,
  stores + store notes, spend/waste events); (c) recipe bodies only for the household's
  own imports/authored recipes. Never: friend-lens recipes (an export is a durable copy
  — including them would nullify unfriending), other members' notes, shared derived
  caches, or the curated set. Fallback only if measurement shows sync infeasible:
  D1-queued task drained by a scheduled() phase into a NEW dedicated R2 bucket (never
  CORPUS) with lifecycle expiry — amending the storage-tier doctrine explicitly in the
  same pass. Any future notification email is notification-only: no token, signed URL,
  or direct link.
  covers: export vs storage-tier doctrine (doctrine); export scope + delivery (privacy)

## 2026-07-10 — operator ratifications (session 1)

The eight (ratify) entries above are resolved. D27 (whole-cookbook friend scope), D28
(checked_at), D31 (min-signal guard), D32 (dual-use Recipe Card is THE conversation
cooking card), and D33 (streamed export) are **accepted as drafted**. Three entries are
**overridden/amended** as follows — where the text below conflicts with the entry above,
this block wins:

- **D26-final. Plan rows move to per-slot identity — with a planner-no-duplicates
  invariant.** `meal_plan` gains a client-mintable surrogate row id (ULID) PRIMARY KEY;
  a recipe MAY occupy multiple slots, but ONLY by explicit user action (grid "add
  again", a user request in chat). The planner never generates duplicates: propose
  fills a plan's slots with distinct recipes; commit updates an existing row rather
  than duplicating unless the member explicitly chose duplication. Consequences carried
  over from the rejected-alternative analysis: class (b) offline replay keys on the
  client-minted row id; slug-addressed tool ops keep defined fan-out (remove-by-slug
  drops all matching rows, set-by-slug requires unique match or returns candidates);
  log_cooked clears exact (recipe, meal, date) first, else the earliest-due row for the
  slug, and accepts an optional row-id param; projects remain rows with meal='project';
  migration mints server-side ids once. Same-pass lockstep: SCHEMAS.md, TOOLS.md,
  meal-planning spec delta, ARCHITECTURE.md's class (b) keying sentence.

- **D29-final. Household-blended taste, attendance-aware; vibes are household-shared
  and member-assignable.** Hard constraints stay UNION (as drafted). Soft ranking uses a
  **household blend** of member taste profiles — weighted by **who's eating**: propose
  gains an attendance input ("kids are gone this weekend"), settable conversationally on
  the agent surface and via a to-be-designed web control (route through the Claude
  Design project before building). Meal vibes stay household-scoped (tenant-keyed) and
  gain optional **member assignment** (a vibe applies to one or more members; default
  everyone): an assigned vibe contributes slots/cadence-debt only when its members are
  eating that week, and the blend weights member tastes by attendance. Absent an
  attendance signal, the blend covers all members equally.

- **D30-final. Note tiers are `public | friends | private`** (household tier dropped;
  household members are inside the friends tier by definition — a household-only note is
  deliberately not expressible). `public` is bounded by the recipe's own lens: a note
  never renders where its recipe isn't visible, and appears on the anonymous /cookbook
  surface only where the recipe itself is anonymously visible. `private` = author-only.
  Default stays `friends` (both profiles); migration: private flag → private,
  non-private → friends. Composer shows the effective tier; retroactivity as drafted.

- **D13-amendment. Household-level curated hide ships.** A household setting suppresses
  the entire curated tier from that household's lens (one lens rule + one setting), in
  addition to per-member `toggle_reject`. Curated source stays product-maintained.
