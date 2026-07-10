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

## 2. What each page consumes

- **People (pages/08)** — the management surface: requests inbox (household-join vs
  friend, with notes), household member list (nicknames, remove), friends list (shared
  counts), find-by-handle, invite links, awaiting-response.
- **Cookbook (pages/01)** — "Popular with Friends" promoted reason = cook-log signals read
  through the friend lens (counts, never identities of non-friends); friends' visible
  recipes appear in browse/search with provenance; empty-cookbook onboarding sells
  "add friends / import / browse curated".
- **Recipe detail (pages/02)** — "From other members" notes: authored once,
  visibility-scoped (private / household / friends — exact tiers open, §5).
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

## 4. Existing-spec collisions to resolve in proposals

- `multi-tenancy` "Tenant data isolation" currently means *one member*; it becomes
  *one household* — the isolation boundary is unchanged, but member-scoped tables gain a
  `member` key within the tenant.
- `shared-corpus` currently shares the whole corpus deployment-wide (one implicit group).
  The lens model replaces "everyone sees everything" with scoped visibility — and the
  self-hosted profile (D9) reproduces the deployment-wide behavior exactly via implicit
  all-to-all friendship, so existing deployments migrate with zero data surgery.
- `group-insights` (operator dashboard) and trending reads stay counts-only/anonymous
  outside the friend lens.
- Self-service signup (`self-service-signup`) currently creates a new tenant per signup;
  it forks: signup-via-household-invite joins an existing tenant, signup-via-friend-invite
  or group code creates a new tenant plus the edge.

## 5. Open questions

1. **Friend-share scope**: what exactly is visible through a friend link — the whole
   household cookbook, favorites only, or per-recipe opt-in? (Mockup has no per-recipe
   share control; counts like "sharing 12 recipes" suggest a defined subset.)
2. **Note visibility tiers**: private / household / friends / public — which exist, and
   what is the default for a new note? (Mock composer has only a "Private" checkbox.)
3. **Household governance**: can any member remove any other (mock behavior), or
   owner-role only (an unused "Household owner" label exists)? Leave-household semantics;
   what member-scoped data a leaver takes along; single-member floor.
4. **Directory privacy**: failed-handle response, request rate limits, block/mute.
5. **Curated set mechanics**: who maintains it (product repo? a yamp-operated feed?),
   how it updates, whether households can hide it.
6. **Agent surface**: which tools become member-aware (log_cooked author, favorites,
   notes already are) and how the persona addresses multiple members of one tenant on one
   MCP connection (per-member OAuth grants already exist — verify the tenant/member split
   at token level).
7. **Recommendation privacy**: "Popular with Friends" shows a friend cooked something —
   is per-friend attribution ever shown, or only aggregates?
