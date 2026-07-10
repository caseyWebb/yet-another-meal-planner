# Story 01 — Households, friends, and the visibility-lens corpus

The mockup's People page, cookbook "Popular with Friends" rows, cross-member notes,
"followed by N households" feed counts, and multi-person spend attribution are all one
feature: a social graph over the existing multi-tenant Worker. This story fixes the model
those pages share. **The decisions in §1 are made** (operator steer, 2026-07-10); the open
questions in §5 are what's left.

## 1. The model (decided)

- **Tenant = household.** The existing tenant becomes the household unit and can hold
  multiple **member accounts**. Everything that is per-tenant today (pantry, meal plan,
  grocery list, stores, Kroger link, staples) is thereby household-shared — no new sharing
  layer, no data movement. Member-level state splits off where the mockup demands it:
  favorites/rejects overlay, taste profile & dietary principles, cooking log authorship,
  notes authorship, feed follows, passkeys/sessions, nicknames.
- **Friendship = tenant↔tenant link.** A symmetric edge between households (requested,
  accepted, removable), carrying recipe visibility and social signals.
- **Visibility is a lens over one monolithic corpus — never segmentation.** A recipe
  exists once (R2 + D1 index row). Members see the corpus through visibility scopes.
  Implied tiers: **public-curated** (product-maintained set, visible to all) →
  **friends** (visible through friend links) → **household** (the importing tenant) →
  possibly member-private. Notes and cook-log-derived signals flow through the same
  lenses.
- **Dedup + memoize everything processed.** If two households import the same URL, it is
  fetched, parsed, facet-derived, and embedded **once** — identity-keyed (source URL,
  content hash). A second import creates a visibility grant, not a row. This mentality
  applies to every derived artifact (embeddings, Kroger match caches, flyer, feed polls —
  "everyone polls one copy" in Discovery is the same principle).
- **Empty corpus on join.** A new household inherits nothing. The cold start is cushioned
  by (a) friend links — the first adopter in a friend group pays the cold-start cost,
  everyone they invite starts warm — and (b) the public curated set as the floor.
- **Deployment profiles (D9): "self-hosted" and "SaaS".** Self-hosted hides the friends
  surface and grants implicit all-to-all friendship, reducing the lens model to today's
  shared-corpus experience (plus household members). SaaS gets the full graph,
  empty-corpus-on-join, and the curated set. Long-term flags, not migration scaffolding.
  Mechanics: the profile flag is deploy-visible config — its channel is stated per
  proposal (D1-config channel preferred, else a wrangler var verified against the
  deploy-merge allowlist; see 00-overview §Routing and config placements). Implicit
  friend edges are COMPUTED from the flag at read time, never materialized; flipping
  self-hosted→SaaS drops the implicit edges (operator may bulk-create real friendships);
  SaaS→self-hosted is refused unless the deployment has ≤1 non-empty household (consent
  inversion guard).
- **Household composition (D29): hard constraints UNION; soft ranking = attendance-
  weighted household blend.** Hard constraints compose by union on every household-scoped
  output (proposed/committed plan, grocery list, order): any member's dietary Avoid
  applies; Limit takes the most restrictive; a recipe rejected by any member is excluded
  from household plans/proposals. Member-scoped reads (browse/search, trending,
  new-for-me) keep today's own-rejects gating. Soft ranking uses a **household blend** of
  member taste profiles, weighted by **who's eating**: propose gains an attendance input
  ("kids are gone this weekend"), settable conversationally on the agent surface and via
  a to-be-designed web control (route through the Claude Design project before
  building); absent an attendance signal, the blend covers all members equally. Meal
  vibes, per-meal cadence, and resurface-after describe the household's shared week —
  household-scoped, tenant-keyed; vibes gain optional **member assignment** (a vibe
  applies to one or more members; default everyone): an assigned vibe contributes
  slots/cadence-debt only when its members are eating that week, and the blend weights
  member tastes by attendance. The propose contract is written caller-neutral (hard
  floor from the household, blended soft profile from attendance). Per-tool
  member-awareness (§5 q6) inherits this rule instead of re-deciding per tool.
- **Lens structure (D12).** One provenance row per (recipe, household):
  `recipe_imports(recipe, tenant, member, via, imported_at)`, `via ∈ {agent, feed:<url>,
  satellite, curated}` — visibility(H, R) computed at read time (own import ∨
  friend-of-H import ∨ curated import); the imports×friendship join IS the grant, no
  materialized per-viewer rows. The curated set is a reserved system tenant visible to
  everyone — except to households that set the **curated-hide** setting (D13 amendment):
  one household-level setting suppresses the entire curated tier from that household's
  lens (one lens rule + one setting), in addition to per-member `toggle_reject`.
  Terminology: "visibility lens"/"lens" exclusively for visibility; "overlay" stays
  reserved for the shipped favorites/rejects table.
- **One lens enforcement point (D11).** Visibility resolves at ONE shared point in the
  corpus read path that every consumer goes through; per-surface reimplementation is a
  defect class. Enumerated consumers: `search_recipes`, `read_recipe`/`display_recipe`,
  `read_recipe_notes`, `list_new_for_me`, propose pools, similar-recipes,
  trending/picked-for-you, the member cookbook queries, AND the anonymous `/cookbook`
  route + `recipe_site_url`. Under SaaS the anonymous lens holds only the curated tier;
  `/cookbook/<slug>` outside the lens 404s indistinguishably from a nonexistent slug (no
  slug-probing oracle; same for `read_recipe`). `recipe_site_url` hands out cookbook
  links only for anonymously-visible recipes; lens-scoped recipes link the member app's
  detail page. Under self-hosted, implicit all-to-all reproduces today's full-corpus
  site exactly — one implementation, both profiles.
- **Sweep imports enter the lens as ordinary imports (D13).** A sweep import's
  visibility grants ARE its attribution rows: visible initially to exactly the
  households of its confirmed-matched members (the `discovery_matches` row is the grant),
  traveling further only through friend lenses — never public by default, never orphaned
  invisible. `discovery_matches` gains a member key; attribution stays per-member
  (`list_new_for_me` filters by matched member) while visibility is per-household — two
  reads of the same rows.
- **Legacy attachment (D12).** The join alone passes NO legacy recipe (zero import rows
  exist), so an idempotent reconcile attaches every existing corpus row to ≥1 household
  via the same primitive — rows with discovery attribution get a grant per attributed
  tenant; all others attach to the operator's household; no NULL-owner sentinel, no
  profile code-path bypass. Import paths record attribution at creation so the class
  never regrows.
- **Visibility is a live lens (D30).** Creating or severing a friendship, or changing a
  note's tier, re-evaluates visibility immediately in both directions; a friends-tier
  note authored while friendless becomes visible to every future friend; a severed edge
  immediately hides.
- **Memoization boundary (D2).** Identity-keyed shared memoization applies to artifacts
  derived from the SOURCE (fetch, parse, facets, embeddings, SKU/flyer/aisle data —
  public-derived); data derived from tenant BEHAVIOR (prices paid, follows, cook
  activity, waste events) is memoized within its owning scope only and crosses tenants
  exclusively through the defined lenses/aggregates.

## 2. What each page consumes

- **People (pages/08)** — the management surface: requests inbox (household-join vs
  friend, with notes), household member list (nicknames, remove), friends list (shared
  counts), find-by-handle, invite links, awaiting-response.
- **Cookbook (pages/01)** — "Popular with Friends" promoted reason = cook-log signals read
  through the friend lens (counts, never identities of non-friends); friends' visible
  recipes appear in browse/search with provenance; empty-cookbook onboarding sells
  "add friends / import / browse curated".
- **Recipe detail (pages/02)** — "From other members" notes: authored once,
  visibility-scoped with tiers `public | friends | private`, default `friends` (D30 —
  no household tier; household members are inside the friends tier by definition).
  `public` is bounded by the recipe's own lens: a note never renders where its recipe
  isn't visible, and appears on the anonymous /cookbook surface only where the recipe
  itself is anonymously visible. `private` = author-only. Migration: private flag →
  private, non-private → friends.
- **Discovery (pages/11)** — "followed by N households", popular-feeds pool, per-member
  follows; feed→member import attribution ("brought you 4 recipes").
- **Retrospective (pages/07)** — spend is household-level (the household shops together);
  cook log rows are member-authored.
- **Account (pages/13)** — @handles, member identity, per-member auth.

## 3. Identity primitives

- **@handle**: member-chosen, unique across the deployment directory, `[a-z0-9_]{3,20}`.
  Mutable display key over a stable member id (and stable tenantId) — rename must not
  break links, requests, or grants. Exact-handle lookup only (no browse/search of the
  directory); decide what a failed lookup reveals (existence oracle) in §5.
- **Nicknames**: per-viewer aliases ("Mom" for `@sam`), editable for others only, seeded
  from the display name a requester supplies. **Agent-facing**: exported through the
  profile read so chat can resolve "Mom and Grandma are coming to town". Not visible to
  the person nicknamed.
- **Requests**: `{from_member, to_member|to_tenant, tier: household|friend, note?,
  created_at, state: pending|accepted|declined|cancelled}`. Household-accept adds the
  requester as a member of the target tenant; friend-accept creates the tenant link.
- **Invite links**: member-generated links that create an account *and* the relationship
  on signup. Mockup shows one static link reused for both tiers while claiming
  tier-specific auto-attach — resolve to per-invite minted links carrying
  `{inviter_member, tier, expiry/one-time}`. Coexists with the operator-minted invite
  codes (bootstrap) and group signup codes; reconcile in the change that builds this.
- **The member identity split is the band's opening change (D10).** Today no credential
  layer knows a member: the OAuth grant carries `{tenantId}` only, web sessions store
  tenant-level records, WebAuthn credentials are tenant-keyed, `recipe_notes.author` is
  tenant-valued. The split: a `members` table (id, tenant, handle, created_at); every
  existing tenant declares a founding member whose member id EQUALS the tenant id
  (WebAuthn user handles are burned into authenticators; D9 forbids surgery) — existing
  grants, sessions, credentials, and note-author values stay valid with zero re-keying.
  Grant props, session records, and `webauthn_credentials` gain the member dimension;
  approval binds (tenant, member); both the MCP and /api paths resolve
  (tenantId, memberId) before any tool/route runs. Tenant stays the isolation boundary;
  member is attribution within it. Invite codes mint/resolve (tenant, member) pairs.
- **Member-move + household-accept for existing accounts (D23).** A member-move
  primitive atomically relocates member-scoped state (favorites/rejects overlay, taste +
  dietary, authored cook-log rows and notes, feed follows, passkeys/sessions, @handle,
  nicknames they set) between tenants — specced once, also implementing leave-household.
  Household-accept for a sole-member requester = member-move + tenant dissolution: after
  an explicit in-flow confirmation enumerating what does NOT carry over, the old
  tenant's household state (pantry, plan, list, staples, stockup, ready-to-eat, stores +
  store notes, Kroger link) is purged via the revoke-shaped path minus member-scoped
  rows; its recipe visibility grants re-key to the absorbing household (lens-only); the
  old tenant id retires from allowlist and directory. Household data is deliberately
  never merged. v1: a member of a multi-member tenant must leave-household first;
  multi-member tenants never merge wholesale. Ships as a flow, never D1 surgery.
- **Block (D24, ships in band 5).** Available on inbox rows, awaiting-response rows, and
  friend rows; directional records scoped to the tier they suppress; a blocked party's
  future requests silently swallow (their view: still "sent"); blocking a friend severs
  the link without notification. Silent-swallow block subsumes mute. Decline is
  invisible: the requester's row stays "Request sent" forever; a declined pair enters a
  ~30-day re-request cooldown during which re-sends appear to succeed but deliver
  nothing; the outgoing cap counts every row the requester sees so the cap cannot become
  a decline oracle. Lookup and request-send ride the existing shared fixed-window
  limiter, per-member AND per-IP.

## 4. Existing-spec collisions to resolve in proposals

- `multi-tenancy` "Tenant data isolation" currently means *one member*; it becomes
  *one household* — the isolation boundary is unchanged, but member-scoped tables gain a
  `member` key within the tenant.
- `shared-corpus` is rewritten wholesale by this band. The lens model replaces "everyone
  sees everything" with scoped visibility — and the self-hosted profile (D9) reproduces
  the deployment-wide behavior exactly via implicit all-to-all friendship, so existing
  deployments migrate with zero member-visible change; attachment is backfilled by an
  idempotent reconcile (D12). There are ZERO existing private recipes to migrate — the
  "private-recipe escape hatch" text is vestigial GitHub-era; file multi-tenancy's
  GitHub-App-token requirement for cleanup in the same band.
- `operator-admin` member lifecycle: the operator lifecycle splits into member-revoke vs
  household-purge; invite codes become member-addressed; the roster groups members by
  household (D10). Drop any operator-provisioning attribution — that spec is deploy
  mechanics only.
- The hosted anonymous cookbook: `cookbook-search`, `cookbook-similar-recipes`,
  `data-read-tools` are deltaed by the lens band (D11), plus
  `member-app-differentiators` and `semantic-recipe-search` (lens + the trending
  min-signal guard per D11/D31).
- `group-insights` (operator dashboard) and trending reads stay counts-only/anonymous
  outside the friend lens.
- Self-service signup (`self-service-signup`) currently creates a new tenant per signup;
  it forks: signup-via-household-invite joins an existing tenant, signup-via-friend-invite
  or group code creates a new tenant plus the edge.

## 5. Open questions

1. ~~**Friend-share scope**: what exactly is visible through a friend link — the whole
   household cookbook, favorites only, or per-recipe opt-in?~~ — decided (D27): the
   whole household-visible cookbook; no favorites-only mode, no per-recipe share control
   in v1; "sharing N recipes" = the friend household's cookbook size. Forced by D9's
   reduction mechanism; the narrower options are recorded as foreclosed.
2. ~~**Note visibility tiers**: private / household / friends / public — which exist, and
   what is the default for a new note?~~ — decided (D30): tiers `public | friends |
   private`, default `friends` (no household tier); public bounded by the recipe's lens;
   private = author-only; composer gets a three-state tier control.
3. **Household governance**: can any member remove any other (mock behavior), or
   owner-role only (an unused "Household owner" label exists)? Leave-household semantics
   (the member-move primitive, D23, is the mechanism; the governance call is what's
   open); what member-scoped data a leaver takes along; single-member floor. The
   member-remove governance call now also governs whether one member's block binds the
   household (D24) and last-member revoke (D10).
4. ~~**Directory privacy**: failed-handle response, request rate limits, block/mute.~~ —
   decided (D24): exact-handle existence disclosure accepted; enumeration bounded by the
   shared limiter; invisible declines with cooldown; block ships in band 5 and subsumes
   mute.
5. **Curated set mechanics**: distribution is decided (D13) — a product-maintained
   public source consumed per-deployment by the existing sweep/import pipeline, landing
   provenance-tagged as the curated tier (SaaS-only floor per D9); household-level
   curated hide ships (D13 amendment: one lens rule + one household setting, in addition
   to per-member `toggle_reject`). Still open: the governance halves — who maintains the
   source, update cadence.
6. **Agent surface**: which tools become member-aware (log_cooked author, favorites,
   notes already are) and how the persona addresses multiple members of one tenant on one
   MCP connection. Ground truth (D10): NO per-member grants exist today — the grant
   carries `{tenantId}` only; member binding arrives with the identity split.
   Composition inherits D29 (hard floor from the household, attendance-weighted blend
   for ranking) rather than re-deciding per tool.
7. ~~**Recommendation privacy**: "Popular with Friends" shows a friend cooked something —
   is per-friend attribution ever shown, or only aggregates?~~ — decided (D31):
   household-counted aggregates only, behind a profile-conditioned min-signal guard
   (≥2 distinct non-caller households under SaaS); recipe provenance stays attributable,
   passive cook activity never is.
