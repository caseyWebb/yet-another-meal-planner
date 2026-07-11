# CHANGES.md — member-app redesign change backlog

## How to use this file

1. Pick the **next unstarted change in band order** (bands mirror 00-overview §Suggested sequencing); **momentum-bank changes may interleave at any time** without touching band-1 shared surfaces.
2. **DECISIONS.md wins on conflict** — over pages, stories, and this file. Check its ratifications block (D26-final, D29-final, D30-final, D13-amendment) before trusting any D26/D29/D30/D13 citation.
3. Read README.md, DECISIONS.md, and 00-overview.md once; after that, each entry's **Reads** line is the grounding set for that change — startable-from without re-reading everything.
4. **Deltas** = existing `openspec/specs/*` the change updates in the SAME pass. Every change additionally keeps docs/TOOLS.md, SCHEMAS.md, ARCHITECTURE.md in lockstep (00-overview Appendix B) and carries its AGENT_INSTRUCTIONS.md edit + `aubr build:plugin --check` where Appendix C lists one — not repeated per entry.
5. **Spikes** run during planning, before the plan is applied (CLAUDE.md: plans carry no spike tasks).
6. **Design dependency** = a design-requests.md entry the operator runs in the Claude Design project first; never improvise that UI.
7. **Serial-surface collisions**: never implement in parallel with the named siblings (`scheduled()` wiring, same spec files, shared TOOLS/SCHEMAS sections). Planning parallelizes freely.
8. Bands are dependencies, not a mandate — a proposal may split/merge entries (the overview delegates slicing).
9. New Worker-owned HTTP routes ship their `run_worker_first` entry + passthrough spec in the same change; 00-overview §Routing pins per-band placements (most surfaces are `/api/*` — covered).
10. The mockup is a painted door (D5): sourcing follows the repo's derivation doctrine, and its listed mock bugs are never implemented literally (00-overview §Mockup fidelity warnings).

---

**Momentum bank** — zero/near-zero-backend; may land while band 1 is planned.

## connect-modal
- **Delivers**: Guided Connect-to-Claude modal over the existing connector flow; `/api` config/whoami gains `{ profile, operator }`. (Also band 7a's sibling per D25(3) — land it once, here.)
- **Reads**: pages/14 §1–2; D9 (profile-gated copy), D25(3); Appendix A (whoami).
- **Deltas**: member-app-core (modal entry) at most — pages/14 §3 classes it tweak-level.
- **Serial-surface collisions**: none (explicitly safe during band-1 planning).

## cookbook-unified-browse
- **Delivers**: Cookbook filter bar over indexed facets, favorites-only toggle (retires `/favorites`), promoted Recommended panel repackaging existing new-for-me/trending/picked-for-you reasons. URL-param plumbing only; "Popular with Friends" reason waits for band 5's lens.
- **Reads**: pages/01 §2–3; D8 (favorites folds in); 00-overview §What already exists (`member-app-differentiators` reason mapping).
- **Deltas**: member-app-core, member-app-differentiators, cookbook-search (Appendix B band 2).
- **Serial-surface collisions**: member-app-core band-2 siblings; cookbook-search/differentiators again in band 5's lens change.
- **Design dependency**: design-requests #1 (the missing favorites-toggle control).

## recipe-detail-tweaks
- **Delivers**: Detail-page-only tweaks + note-tags UI. The cook-mode widget waits for `recipe-card-cook-mode` (D32).
- **Reads**: pages/02 §2, §4; D8.
- **Deltas**: recipe-notes (tag UI — Appendix B band 2).
- **Serial-surface collisions**: recipe-notes again in band 5's `note-visibility-tiers`.

---

**Band 1 — foundations with no UI dependencies.** Coupling rule (D25(2)): a migration retiring a preference shape the shipped profile/vibes pages edit ships with, or is immediately followed by, its member-UI update.

## meal-dimension-foundations
- **Delivers**: `meal: breakfast|lunch|dinner|project` across plan/log/vibes/cadence; D26-final per-slot plan-row identity (client-mintable ULID PK, planner-no-duplicates, slug-op fan-out, meal-aware `log_cooked` clear); `night_vibe`→`meal_vibe` rename + retired-key shims (D21 one-window aliases); caller-neutral attendance-aware propose contract (D29-final: union hard floor, blended soft profile); suggest-vibes cron producer; the D8 lunch-strategy/RTE → seeded-vibes value migration as pipeline convergence (pre-migration production rows = fixtures, D21). Schema + tool contracts + propose engine — no UI.
- **Reads**: stories/02 in full (incl. open qs 2–4 — resolve in proposal); D8, D20, D21, D26-final, D29-final; pages/03 §2 (blessed move/re-tag semantics); Appendix A "Renamed"/"Changed" tool lines.
- **Deltas**: night-vibe-palette, planning-cadence, weather-bucket-planning, meal-plan-proposal, meal-planning, menu-generation, cooking-history, meal-plan-widget, member-app-propose, member-app-core, profile-reconciliation, night-vibe-archetype-derivation (Appendix B band 1).
- **Spikes**: production D1 shapes — existing plan/vibe/preference rows are the D21/D26 migration acceptance fixtures.
- **Serial-surface collisions**: `scheduled()` (suggest-vibes cron); meal-plan-widget/member-app-propose shared with `plan-your-week-widget`; meal-planning shared with `meal-plan-page`.

## pantry-disposition-foundations
- **Delivers**: Pantry `location` dimension (orthogonal to category) + removal-as-disposition (Used / Mark-as-waste, ONE canonical reason enum, value never asked). Feeds story 03's waste capture.
- **Reads**: pages/06 §2–3; stories/03 §2; D15 (client-minted event ids, class (b) registration), D17 (department stamped at capture).
- **Deltas**: member-app-offline (write classes); TOOLS read/update_pantry + SCHEMAS pantry (Appendix B band 1).
- **Serial-surface collisions**: member-app-offline shared with grocery/walk changes; `pantry-page` builds on it.

## brand-tier-model
- **Delivers**: brands→tiers data model over the shipped tri-state brand semantics; the Preferred-brands management card ships here or at latest as a band-3 sibling ordered before `order-review-rework` (D25(2)).
- **Reads**: pages/09 §2–3 (brand tiers + Any brand); pages/05 §3 (brand decisions it feeds); D25(2).
- **Deltas**: TOOLS update_preferences/read_user_profile + SCHEMAS brand prefs (Appendix B band 1); ingredient-matching rule internals land with band 3, not here.
- **Serial-surface collisions**: update_preferences/read_user_profile TOOLS+SCHEMAS sections shared with the two sibling band-1 changes.

## spend-capture-on-order-commit
- **Delivers**: UI-free spend telemetry on the existing order-commit path: per-line snapshot on a send record at `place_order`; spend events materialized at the purchase assertion by ONE shared src/ writer (idempotent, negative rules per D16); D17 department stamped at capture; weekly-budget preference (control ships with `profile-planning-and-vibes-ui`).
- **Reads**: stories/03 §1 (incl. open qs); D16, D17, D25(1).
- **Deltas**: order-placement (spend snapshot); SCHEMAS spend_events + preferences block; TOOLS place_order/update_preferences/retrospective (Appendix B band 1).
- **Spikes**: Kroger order-commit response shape — what prices the send path can actually snapshot (story 03 q1: preview estimates vs fulfillment; cart can't be read back).
- **Serial-surface collisions**: order-placement shared with `order-review-rework` (band 3); shared commit ops later extended by `offline-stores-and-store-walk`.

---

**Band 2 — page redesigns over existing data** (after band 1 where noted).

## propose-orchestration-unification
- **Delivers**: Lifts the hand-duplicated ProposeSession/buildRequest/toView orchestration (packages/app/src/lib/propose.ts + packages/widgets/src/ProposeCard.tsx) into the shared package with host adapters. Behavior-preserving refactor; lands BEFORE the page-04 redesign.
- **Reads**: 00-overview §Suggested sequencing (named slice); stories/06 §1; D25(4).
- **Deltas**: none intended (meal-plan-widget behavior stays intact; the D18 write-switch belongs to `plan-your-week-widget`).
- **Serial-surface collisions**: anything editing the propose packages; `plan-your-week-widget` depends on it.

## sidebar-live-counts
- **Delivers**: The three sidebar badges, defined once: grocery = derived to-buy lines minus checked + in-flight (D28; on the offline persist allowlist), plan = meal rows only (`meal != 'project'`, D26), people = pending inbound requests (the mock's friend-count badge is a listed bug). Checked subtraction activates with band 3's `checked_at`; the people badge with band 5.
- **Reads**: 00-overview §Sidebar counts; D26-final, D28.
- **Deltas**: member-app-core (nav), member-app-offline (badge read).
- **Serial-surface collisions**: member-app-core band-2 siblings.

## meal-plan-page
- **Delivers**: Meal plan page redesign — day-grouped meal-labeled rows, empty-slots `(date, meal)` grid, unscheduled grouped by meal, projects section, `from_vibe` rendering, D26-final move / explicit add-again semantics (never the mock's silent occupant delete or `window.prompt` side-adder).
- **Reads**: pages/03 §2–4; D26-final; stories/02 §1.
- **Deltas**: meal-planning, member-app-core; TOOLS read/update_meal_plan surfaces (Appendix B bands 1–2 split).
- **Serial-surface collisions**: meal-planning shared with `meal-dimension-foundations` (lands after it); member-app-core siblings.
- **Design dependency**: design-requests #2 (add-again + occupied-slot + beyond-horizon states).

## plan-your-week-widget
- **Delivers**: Page-04 propose redesign on the unified component — per-meal steppers + independent per-meal sessions, sides editing, the D8/D20 control cuts, commit meal+date packing (fixes the mock bug), D29-final attendance control; the first WRITING dual-use widget: D18 three-channel protocol, commit switched off sendMessage-delegation, D19 `contract_version` retrofit to ProposeCardData/RecipeCardData.
- **Reads**: pages/04 §2–4; stories/06 in full; D8+D20 (complete collision ledger), D18, D19, D29-final.
- **Deltas**: member-app-propose (live-iteration requirement rewritten wholesale), member-app-core (reconciliation queue → inline suggestions; `merge_recipes` render clause deleted), meal-plan-widget ("NO writes" stance + widget-initiated-iteration control list re-enumerated), TOOLS `display_meal_plan` dial list — the D8/D20 ledger, same pass.
- **Spikes**: MCP Apps host-capability check — host `updateModelContext` support + boot-time tools/call, one probe (story 06 q1 residual; D18 says no protocol spike beyond this).
- **Serial-surface collisions**: after `propose-orchestration-unification` + band 1; member-app-propose/meal-plan-widget/member-app-core shared with `meal-dimension-foundations` and band-2 siblings.
- **Design dependency**: design-requests #5 (attendance control — design-first per D29-final).

## profile-planning-and-vibes-ui
- **Delivers**: Page 09 Planning card (per-meal cadence steppers, resurface/novelty sliders, weekly-budget control) + page 10 Meal vibes tab (meal grouping, inline suggestions replacing the queue, pinned indicator) — the member-UI half of D25(2)'s coupling for the preference shapes `meal-dimension-foundations` retired (its D8 value migration lands there). Sequenced immediately after `meal-dimension-foundations` (D25(2)).
- **Reads**: pages/09 §1–3, pages/10 §2–3; D8, D21, D25(2).
- **Deltas**: member-app-core (profile surfaces + queue removal if not yet landed); TOOLS update_preferences + vibe family surfaces.
- **Serial-surface collisions**: member-app-core siblings; update_preferences shared with band-1 changes.
- **Design dependency**: design-requests #3 (weekly-budget control), #4 (pinned-vibe indicator), #6 (member-assignment layout reserve — semantics land band 5).

## pantry-page
- **Delivers**: Pantry page redesign — location group-by, multi-add with recognition autofill (the D17 IngredientContext funnel), disposition UI over band 1's capture.
- **Reads**: pages/06 §2–4; D15, D17.
- **Deltas**: member-app-core, member-app-offline. Serial: after `pantry-disposition-foundations`; member-app-offline shared with grocery/walk changes.

## retrospective-shell
- **Delivers**: Retrospective shell (rename + tabs) with the meal-aware Cooking log tab (meal on rows + composer defaults, day grouping, backdating, non-recipe entry). Spend/Waste tabs are band 4.
- **Reads**: pages/07 §2, §5–6; stories/02 §1 (log).
- **Deltas**: member-app-core; TOOLS retrospective (Appendix B band 2). Serial: member-app-core siblings; TOOLS retrospective shared with band 4.

## recipe-card-cook-mode
- **Delivers**: Recipe body-annotation contract (body_hash-gated classify pass; deterministic client parser fallback; authored overrides) + the dual-use Recipe Card with guided cook mode as THE one conversation cooking card (D32 — supersedes `recipe_display_v0`), log-cooked/favorite/completion over the D18 bridge with D19 boot re-hydration. No interim dual-card state — one change.
- **Reads**: pages/02 §3, §5 (q4–5); stories/06 §2; D32, D18, D19.
- **Deltas**: recipe-card-widget (read-only requirement), guided-cook (emit target re-pointed, host-keyed), SCHEMAS annotation grammar (explicitly required by pages/02) — Appendix B band 2.
- **Serial-surface collisions**: `scheduled()` (the classify pass); recipe-notes-adjacent surfaces with `recipe-detail-tweaks`.

---

**Band 3 — order flow + fulfillment.** Band-3 siblings share member-app-grocery + the grocery TOOLS/SCHEMAS sections — implement serially within the band. Persona: Appendix C band 3.

## grocery-list-page-and-widget
- **Delivers**: Grocery list redesign — dept/recipe grouping + route ordering, `checked_at` check-off (D28, class (b) offline-queued), in-cart section re-homed with "Mark order placed" (the D16 purchase assertion; aging = "awaiting mark-placed"), household lines, header stats + flyer savings from the send-record source; dual-use Grocery List widget + `display_grocery_list` (D18/D19).
- **Reads**: pages/05 §1, §4–5; stories/06 §2–3; D15, D16, D28.
- **Deltas**: member-app-grocery, grocery-list, member-app-offline (checked_at re-wording per D28 + online-only surfaces), TOOLS update_grocery_list/read_to_buy + new display tool, SCHEMAS grocery checked_at + widget payload contracts (Appendix B band 3).
- **Serial-surface collisions**: band-3 siblings; member-app-offline with `pantry-page`/walk.
- **Design dependency**: design-requests #8 (in-cart section home).

## order-review-rework
- **Delivers**: Order review rework — brand decisions + save-preferred-brand write-back, broader/manual search, savings tiles reading the send-record snapshot, honest confirm, learned-matches surfacing; EXTENDS band-1 spend capture (impulse lines) via the shared commit ops, never UI wiring (D16); dual-use Order Review widget + `display_order_review`.
- **Reads**: pages/05 §3–5; stories/03 §1; stories/06 §2–3; D16, D18, D19; `brand-tier-model`'s output.
- **Deltas**: member-app-grocery, ingredient-matching (matcher confidence + brand-tier internals), order-placement, TOOLS place_order + display tool, SCHEMAS send records + sku_cache (Appendix B band 3).
- **Serial-surface collisions**: order-placement shared with `spend-capture-on-order-commit` (lands after); band-3 siblings.

## offline-stores-and-store-walk
- **Delivers**: "Offline" adapter presentation of the existing stores surface (D6 rename) + member aisle-map editor (maps pool per shared store slug — story 04 q2 decided) + the member store walk: pure client state (D28, no server session), zero-connectivity check-offs, completion via ONE shared shop-commit op (receive + verified restock + D16 spend on checked rows) shared with the agent voice walk.
- **Reads**: pages/05 §2, §5; stories/04 §1–2, §4; D6, D15, D16, D28.
- **Deltas**: in-store-fulfillment (shop-commit convergence), member-app-offline, store tools copy (D6) (Appendix B band 3).
- **Serial-surface collisions**: the shared shop-commit/spend ops with band-3 siblings; member-app-offline with `pantry-page`.
- **Design dependency**: design-requests #7 (walk session UI — pages/05 names it "the design work").

## store-adapters-card
- **Delivers**: Preferences adapter-tabbed Store card (Kroger connect/disconnect + ZIP picker modal, Satellites read-only summary, Offline tab) + the grocery launcher as a projection of it (one place decides launcher entries); kroger login-url + disconnect /api endpoints.
- **Reads**: pages/09 §2–3; stories/04 §1, §3; D22 (the satellite freshness boolean the launcher/summary key off — wire field arrives with `member-satellites-tab`; degrade until then); Appendix A endpoints.
- **Deltas**: member-app-core; TOOLS store tools copy (if not landed with the walk change).
- **Serial-surface collisions**: launcher shared with `grocery-list-page-and-widget`; pages/09 surface with `profile-planning-and-vibes-ui`.

## instacart-adapter
- **Delivers**: The Instacart integration — account link (OAuth callback nested under existing `/oauth/*`, no new run_worker_first entry), preferred retailer by ZIP, launcher entry + per-trip retailer override (never rewrites the preference), post-spike flush sibling of `place_order`.
- **Reads**: stories/04 §1–3 (q1); pages/09 §2; D7; 00-overview §Routing (4), Appendix A.
- **Deltas**: ARCHITECTURE adapter model incl. Instacart; TOOLS new flush tool; order-placement if the send path forks.
- **Spikes**: Instacart API feasibility — availability, auth model, cart handoff (D7: REQUIRED before its proposal).
- **Serial-surface collisions**: order-placement/launcher with `order-review-rework`.

---

**Band 4 — analyzers** (needs band 1's disposition + spend capture, D25(1)).

## spend-analyzer
- **Delivers**: Retrospective Spend tab — trailing 4/8/12-week bars, KPI tiles (cost-per-meal excludes {Household, Beverages} per D17), dept/store/planned-vs-impulse breakdowns, top drivers, budget line; deterministic template insight banner; household-scoped /api aggregates + `retrospective` tool gains spend aggregates (read-only).
- **Reads**: pages/07 §3, §6; stories/03 §1, §3–5 (open qs 1–5 — resolve in proposal); D16, D17.
- **Deltas**: SCHEMAS event tables; ARCHITECTURE cron list; TOOLS retrospective (Appendix B band 4).
- **Serial-surface collisions**: `waste-analyzer` (same spec files + TOOLS section); `retrospective-shell`.

## waste-analyzer
- **Delivers**: Waste tab — tossed $/items/waste-rate/trend, dept/reason/avoidable-vs-hard breakdowns (versioned read-time reason→avoidability table in src/), value derived from spend history (never asked); Leftovers pseudo-department over `prepared_from`.
- **Reads**: pages/07 §4, §6; stories/03 §2–3; D17.
- **Deltas**: SCHEMAS avoidability derivation + event tables; TOOLS retrospective. Serial: after `spend-analyzer` (value derivation sequences waste after spend); same files.

---

**Band 5 — social layer.** Opens with the identity split; everything member-scoped depends on it. Persona: Appendix C band 5.

## member-identity-split
- **Delivers**: `members` table; founding member id EQUALS tenant id (zero re-keying of grants/sessions/passkeys/note-authors); grant props, session records, `webauthn_credentials` gain the member dimension; both MCP and /api resolve (tenantId, memberId) before anything runs; operator lifecycle splits member-revoke vs household-purge; invite codes mint (tenant, member).
- **Reads**: stories/01 §3 (D10 block); D10; pages/13 §1 (metadata this enables).
- **Deltas**: multi-tenancy, member-session-auth, passkey-auth, operator-admin, claude-ai-connector (Appendix B band 5 subset).
- **Spikes**: production D1 shapes — existing grants/sessions/credentials rows are the zero-re-keying acceptance fixture.
- **Serial-surface collisions**: every band-5 sibling; member-session-auth/passkey-auth shared with band 7a.

## deployment-profiles-and-visibility-lens
- **Delivers**: The D9 profile flag (channel stated per 00-overview §Routing (8), incl. the flip guards); `recipe_imports` provenance rows (D12) + ONE lens enforcement point over every enumerated consumer incl. anonymous /cookbook + `recipe_site_url` (D11, no slug-probing oracle); idempotent legacy-attachment reconcile (production attached/unattached counts = acceptance fixture); curated set as reserved system tenant + D13-amendment household hide; sweep imports as ordinary imports (D13); D31 min-signal trend guard; D27 whole-cookbook friend scope; cookbook cold-start onboarding.
- **Reads**: stories/01 §1, §4, §5 q5; pages/01 §2–3; D2, D9, D11, D12, D13(+amendment), D27, D31.
- **Deltas**: shared-corpus (wholesale rewrite), multi-tenancy (isolation wording + vestigial GitHub-era cleanup — story 01 §4), cookbook-search, cookbook-similar-recipes, data-read-tools, semantic-recipe-search, member-app-differentiators, group-insights stance (Appendix B band 5; ARCHITECTURE multi-tenant identity rewrite).
- **Serial-surface collisions**: `scheduled()` (attachment reconcile); cookbook specs shared with `cookbook-unified-browse`; after `member-identity-split`.
- **Design dependency**: design-requests #10 (curated-hide setting), #11 (cold-start states).

## households-friends-and-people-page
- **Delivers**: Multi-member households + tenant↔tenant friend links + the People page (requests inbox, nicknames, @handles, per-invite minted links, awaiting-response) with the self-hosted household-only variant; D24 enumeration bounds, invisible declines, block; D23 member-move / household-accept / leave-household flows; self-service-signup fork + `/join/:token` SPA route (no run_worker_first entry).
- **Reads**: pages/08 §2, §4 (q1/q3 governance — resolve in proposal, it also binds D24 block scope + D10 last-member revoke); stories/01 §2–3, §5 q3; D1, D23, D24; 00-overview §Routing (1).
- **Deltas**: self-service-signup, multi-tenancy, operator-admin, member-session-auth (Appendix B band 5 subset); SCHEMAS members/friendships/requests/invites/handles.
- **Serial-surface collisions**: after `member-identity-split`; multi-tenancy/operator-admin shared with it and the lens change.
- **Design dependency**: design-requests #12 (self-hosted People variant).

## note-visibility-tiers
- **Delivers**: Note tiers `public | friends | private` (default friends, D30-final; no household tier), three-state composer, live-lens retroactivity, public bounded by the recipe's own lens; `read_recipe_notes` returns tiers + author handles; private-flag migration (pure mapping).
- **Reads**: pages/02 §2; stories/01 §2; D30-final, D10.
- **Deltas**: recipe-notes; TOOLS read_recipe_notes (Appendix B band 5). Serial: recipe-notes shared with `recipe-detail-tweaks`; needs the lens change.
- **Design dependency**: design-requests #9 (tier composer).

---

**Band 6 — ingest surfaces** (household-scoped bits depend on band 5).

## member-discovery-tab
- **Delivers**: Member Discovery tab — per-member feed follow relation (`update_feeds` auto-follows the adder), popular-feeds pool ranked by follower households, side-effect-free test modal (probe re-scoped from admin), health chips from the shared feeds-table columns, per-feed × per-member "brought you N recipes" rollups off `discovery_matches`+`discovery_log`.
- **Reads**: pages/11 §2–4; stories/05 §1–3 (q1 follow mechanism, q3/q4 — resolve in proposal); D13.
- **Deltas**: recipe-discovery, discovery-sweep, discovery-calibration; TOOLS update_feeds; SCHEMAS feeds health/follows/attribution; ARCHITECTURE discovery sweep (Appendix B band 6).
- **Serial-surface collisions**: `scheduled()` (sweep changes); after band 5 for household semantics.

## member-satellites-tab
- **Delivers**: Member Satellites tab — admin reads/mutations re-scoped to member sessions with D14 authority (household-bound member keys; mint/revoke/quarantine = any member of the owning household), household-scoped rejection reads, D14 provenance-classed identity keys + tenant-scoped sale scans, contract-version skew warning, D22 cart-fill card (session-freshness boolean as an additive wire field; secrets never leave the satellite host).
- **Reads**: pages/12 §2–4; stories/05 §1–2; D14, D22.
- **Deltas**: satellite, satellite-source-audit (trust premise rewritten per D14), satellite-pull-channel (Appendix B band 6).
- **Serial-surface collisions**: after band 5 (lens + household keys); feeds `scheduled()` surfaces with `member-discovery-tab`.

---

**Band 7 — account & security** (three slices per D25(3); `connect-modal` already listed in the momentum bank).

## account-security-basics
- **Delivers**: (7a — any time, on tenant-as-member identity.) Passkey management (list/metadata/removal ceremony), session/grant metadata + revocation UI (coarse geo, never raw IP), sign-out-others, Disconnect-all-Claude with the missing confirm, System theme. Session/grant records gain their member key as a band-5 follow-through — re-key, not rebuild.
- **Reads**: pages/13 §1–3 (q4/q6 decided in §1); D25(3).
- **Deltas**: member-session-auth, passkey-auth, multi-tenancy (grant metadata) (Appendix B band 7); SCHEMAS session/grant metadata.
- **Serial-surface collisions**: member-session-auth/passkey-auth shared with band 5 — serialize if band 5 is in flight; pages/13 surface with 7b/7c.

## handle-rename-and-export
- **Delivers**: (7b — after band 5.) @handle change with rename-ripple handling + old-handle reservation (pages/13 q2 — resolve in proposal); the D33 export: synchronous streamed session-gated GET, ownership-scoped and lens-aware, no stored artifact, no tokenized links.
- **Reads**: pages/13 §1, §3 q2; stories/01 §3 (handle mutability); D33.
- **Deltas**: member-session-auth, multi-tenancy; SCHEMAS export (Appendix B band 7). Serial: after band 5; pages/13 surface with 7a/7c.

## recovery-email
- **Delivers**: (7c.) Recovery email + magic-link → passkey-enroll flow over an opt-in outbound sender; sender unset ⇒ the card renders "not available on this deployment"; verification link is an SPA route + `/api` (no run_worker_first entry).
- **Reads**: pages/13 §1, §3 q1; D25(3); 00-overview §Routing (3); grill/rejected-and-minors "outbound-email" entry (refined resolution to carry into the proposal).
- **Deltas**: member-session-auth, operator-provisioning (Appendix B band 7).
- **Spikes**: outbound email sender choice + magic-link security model (REQUIRED — no sender exists today; D25). New deploy config must pass the merge-allowlist trap check (00-overview §Routing (8) class).
- **Serial-surface collisions**: pages/13 surface with 7a/7b.

---

## Explicitly deferred / not scheduled

- **Household-blended-taste follow-ons beyond D29-final's attendance-weighted propose blend** (e.g. a persisted blended-centroid artifact) — D29 names this an explicitly deferred follow-on; never silently improvised in a band.
- **Delete account** — pages/13 q5: in-or-out undecided; a productization-era question (export ships instead).
- **In-widget voice mode** (real speech synthesis/recognition in the Recipe Card) — pages/02 q4 recommends hand-off to the agent conversation first; only the hand-off ships with `recipe-card-cook-mode`.
- **Federation across deployments** — the friend graph, @handle directory, and popular-feeds pool are all deployment-internal by construction (stories/01 §3, pages/11); no cross-deployment story exists in this spec set.
- **Waste signals feeding proposal scoring** — stories/03 §4: flagged follow-on, not the first change.
- **"Used" consumption signal from pantry dispositions** — stories/03 §2: pure removal today, maybe a signal later.
- **Newsletter forwarding + the Discovery "New for you" save/reject panel** — vestigial in the mock, cut per stories/05 q5 (new-for-you lives in Cookbook).
- **Favorites-only / per-recipe friend-share modes** — foreclosed (not merely deferred) by D27/D9; amend D9's reduction mechanism first if ever revisited.
