# Design requests — Claude Design project queue

Decided features (per `product-specs/DECISIONS.md`, incl. the 2026-07-10 ratifications
block: D26-final, D29-final, D30-final, D13-amendment) that have **no mockup coverage**.
Per CLAUDE.md, UI designs route through the companion Claude Design project
(claude.ai/design) — the operator runs each prompt there, exports the updated bundle,
and that bundle becomes the basis for the local implementation. Each entry: what band
consumes it, the context a designer needs, and a ready-to-paste prompt.

Ordered by consuming band. The "Prompt" block under each entry is what to paste into the
Claude Design project verbatim.

---

## Momentum bank / Band 2 — page redesigns over existing data

### 1. Cookbook favorites-only toggle control

**Consumed by:** `cookbook-unified-browse` (momentum bank — can land before band 1).
**Context:** The mockup's Cookbook page carries the favorites feature's logic, CSS, and
empty states, but the toggle **control itself is missing from the markup** (a source
comment says "Favorites now lives as a Cookbook tab"). pages/01 leaves the control's
form open (filter-bar pill vs tab row); the `/favorites` route retires behind it. The
toggle replaces the organic list with filtered favorites, hides the "Recommended for
you" panel, and swaps the empty copy.

**Prompt:**

```
On the Cookbook page: the favorites-only view already exists (its filtered list,
"None of your favorites match these filters." and "No favorites yet / Tap the heart on
any recipe to save it here." empty states are all designed), but the control that
enters it was never placed in the markup. Design the toggle itself. Evaluate two forms
against the existing page structure — (a) a pill in the existing filter bar alongside
the Cuisine/Protein selects and the Time segmented control, or (b) a small tab row
(All / Favorites) above the filter bar — and commit to one. Requirements: it must read
as a view mode, not another AND-filter (active filters still apply inside it); it must
show an active state consistent with the filter bar's "Clear" affordance; entering it
hides the Recommended for you panel. Update the Cookbook page in place, including the
favorites-active state with a couple of favorited RecipeRows.
```

### 2. Plan-slot "add again" duplication affordance (+ occupied-slot and horizon states)

**Consumed by:** the band-2 Meal plan page redesign (pages/03), on band 1's D26-final
schema. **Context:** D26-final moves `meal_plan` to per-slot row identity (ULID PK): a
recipe MAY occupy multiple slots, but **only by explicit user action** — the planner
never generates duplicates. The mockup's empty-slots grid has no duplication affordance
at all (picking an already-planned recipe *moves* it, sides preserved), so the explicit
"add this recipe again as a second slot" path needs a designed control, and the moment
of choice (move vs duplicate) needs designed feedback. Two adjacent mock bugs need
designed states in the same pass: picking into an occupied slot silently deletes the
occupant (must become move-to-unscheduled or a confirm), and rows scheduled beyond the
7-day grid horizon vanish (must remain visible somewhere).

**Prompt:**

```
On the Meal plan page's empty-slots grid (the "Show empty meal slots" 7-day x
breakfast/lunch/dinner grid): design the explicit duplication path and two conflict
states. (1) "Add again": when a member picks a recipe that is already planned into an
empty slot via the "+ Add Recipe" combobox, the default behavior is MOVE (the existing
row relocates, sides preserved) — design the inline moment that makes this legible and
offers "Add again instead" as the explicit opt-in to a second slot for the same recipe
(e.g. a small choice popover or an inline confirm on the combobox selection, consistent
with the existing slot-card tooltip/combobox patterns). Duplicated slots should carry a
subtle "x2" style indicator so two slots of one recipe are visibly siblings. (2)
Occupied-slot replacement: picking a recipe into a filled slot must not silently delete
the occupant — design the move-to-unscheduled resolution with feedback ("Moved X to
Unscheduled"). (3) Beyond-horizon rows: rows dated past the grid's 7 days currently
disappear — design a compact "Later" strip or row group below the grid that keeps them
visible. Update the Meal plan page in place; show the grid with one duplicated recipe
and one beyond-horizon row.
```

### 3. Weekly-budget control on the Preferences planning card

**Consumed by:** the band-2 `profile-planning-and-vibes-ui` slice (page 09), backing
band 1's spend-capture change (story 03 / D25). **Context:** The Retrospective's Spend
analyzer renders a budget line from a household-level `$N/week` preference, but the
mockup **forgot the control that sets it** — pages/09 and stories/03 both flag "add the
weekly budget control here". It lives on the Profile → Preferences tab's Planning card
next to the per-meal cadence steppers and the resurface-after / novelty sliders. $0 or
unset hides the budget line in analytics (the control must express "no budget" as a
first-class state, not just an empty number field).

**Prompt:**

```
On Profile & preferences → Preferences, in the Planning card (the card with the
Breakfast/Lunch/Dinner weekly cadence steppers and the resurface-after and
novelty-boost sliders): add a "Weekly grocery budget" control. It sets one
household-level dollar amount per week (e.g. $95) that the Retrospective's Spend tab
draws as its budget line. Requirements: a currency input styled like the card's
existing inputs, with helper copy explaining where it shows up ("Drawn on your Spend
retrospective — weeks over budget get flagged."); an explicit unset/off state ("No
budget" — clearing the field, not typing 0) whose copy says the budget line simply
won't render; sensible formatting on blur. Place it as the Planning card's last row.
Update the Preferences tab in place.
```

### 4. Pinned-vibe row indicator on the Meal vibes tab

**Consumed by:** the band-2 `profile-planning-and-vibes-ui` slice (page 10).
**Context:** The vibe add/edit form has a "Pinned (weekly intent)" checkbox and the flag
changes planner behavior (force-placed by weather-bucket allocation), but the mockup's
vibe list rows show **no pinned indicator** — pages/10 calls this out explicitly
("invisible flags are a trap"). Rows already carry a status badge (NEW / ON TRACK / DUE
SOON / DUE NOW / OVERDUE), facet + season chips, a cadence-debt progress bar, and
weather chips, so the indicator must slot into an already-dense row.

**Prompt:**

```
On Profile & preferences → Meal vibes: vibe rows can be "Pinned (weekly intent)" via
the add/edit form's checkbox, meaning the planner force-places them every week
regardless of cadence debt — but the list row currently gives no visual sign of it.
Add a pinned indicator to the vibe row. It must coexist with the existing status badge
(NEW/ON TRACK/DUE SOON/DUE NOW/OVERDUE), the facet and season chips, the "every N
days" cadence text, and the debt progress bar without adding row height — consider a
small pin glyph beside the vibe name or a distinct "PINNED" chip that reads as a mode,
not a status. Pinned rows should arguably de-emphasize the debt meter (it doesn't
drive their placement) — decide and show it. Update the Meal vibes tab in place with
at least one pinned and one unpinned row per meal group.
```

### 5. Propose attendance control — "who's eating this week"

**Consumed by:** the band-2 Plan-your-week / Meal Planning widget redesign (pages/04);
full member semantics arrive with band 5's member identity split (D10). D29-final
explicitly says: route this through the Claude Design project before building.
**Context:** D29-final makes propose's soft ranking an attendance-weighted **household
blend** of member taste profiles: propose gains an attendance input ("kids are gone
this weekend"), settable conversationally on the agent surface and via a web control
that does not exist in the mockup. It lives with the propose flow's per-meal steppers
(the shared dual-use Meal Planning widget — same control set in both hosts per D20).
Absent a signal, all members weigh equally, so the control's resting state is "Everyone"
and it must never demand interaction. Assigned vibes contribute slots only when their
members are eating (D29-final), so attendance also quietly reshapes the vibe pool.

**Prompt:**

```
On the Plan your week page (the propose flow with the BREAKFASTS/LUNCHES/DINNERS
steppers, inside the Meal Planning widget — this control ships identically in the
member app and the conversation widget): add a "Who's eating this week" attendance
control. Model: the household has N members (avatar initial + name, same treatment as
the People page rows); default state is everyone eating; a member can be marked away
for the whole week or for part of it (keep v1 granularity coarse — whole-week toggles
per member, with an optional per-member "back Friday"-style day scope only if it fits
cleanly). It sits between the pre-propose intro card and the steppers, reading as
context for the proposal, not a required step: collapsed one-line summary ("Everyone's
home this week" / "Alex is away") that expands to per-member toggle rows. Changing it
re-shapes the live proposal, so give it the same edited-state treatment as a slot's
vibe override. Also design its single-member household state: the control hides
entirely. Update the Plan your week page in place; show the expanded state with one of
three members marked away and the collapsed summary state.
```

### 6. Vibe member-assignment control on the Meal vibes tab

**Consumed by:** the band-2 `profile-planning-and-vibes-ui` slice (page 10) reserves
the layout; member semantics land with band 5 (D10). Per D29-final, design-first.
**Context:** D29-final: meal vibes stay household-scoped but gain optional **member
assignment** — a vibe applies to one or more members, default everyone; an assigned
vibe contributes slots/cadence-debt only when its members are eating that week. The
mockup's vibe add/edit form (name, meal select, cuisine/protein/max-time selects,
cadence, weather-fit + season chips, pinned checkbox) has no member field, and the vibe
list rows have nowhere showing assignment. Default-everyone must stay the visually
quiet path — assignment is the exception, not a required field.

**Prompt:**

```
On Profile & preferences → Meal vibes: vibes gain optional member assignment — a vibe
can apply to specific household members ("savory eggs" is just Sam's breakfast),
default everyone. Extend two places. (1) The add/edit form (currently: name, Meal
select, cuisine/protein/max-time selects, cadence select, weather chips, season chips,
Pinned checkbox): add a "Who's it for" field as toggleable member chips (avatar
initial + name, the People page treatment) with an "Everyone" resting state — when
Everyone is on, individual chips are unselected and the field reads as one quiet line;
picking any member switches to explicit selection. Keep it compact; it must not make
the form feel longer for the default case. (2) The vibe list row: assigned vibes show
a small member chip (or stacked avatar initials for 2+) next to the meal-group
placement; everyone-vibes show nothing. Note the interaction with attendance in helper
copy ("Only planned when they're eating that week."). Also design the single-member
household state: field hidden entirely. Update the Meal vibes tab in place with one
assigned and several everyone vibes.
```

---

## Band 3 — order flow + fulfillment

### 7. Store walk — in-progress session UI

**Consumed by:** band 3's offline-stores / member store-walk change (pages/05 §2,
stories/04; D28 for state semantics). **Context:** The mockup defines the Grocery list's
Order | Store walk mode toggle and a footer "Start walk →" CTA, and **nothing past
that** (the button just relabels "Walk started") — pages/05 says outright "the
walk-session spec is the design work". Per D28 the walk is pure client state (mode in
URL params, no server session entity); check-offs are the list's existing `checked_at`
checkboxes replayed offline (D15 — the walk must function with zero connectivity);
completion is one shop-commit op applying receive semantics + spend events to checked
rows, i.e. the "Log a manual shop" semantics. Rows order by store route (aisle
placement from the Kroger adapter or offline-store aisle maps).

**Prompt:**

```
On the Grocery list page: design everything past the "Start walk →" button — the
in-progress store walk. Walk mode already reframes the list in store-route order
(aisle-grouped, ascending); now design the active session. Requirements: (1) a walk
header replacing the page header — store name, progress ("14 of 23"), and an overall
progress bar fed by the existing row checkboxes; (2) aisle-section progression — the
current aisle group visually active, completed aisles collapsing to a checked summary
row, with check-offs using the list's existing checkbox rows (strikethrough) untouched;
(3) items with no aisle mapping gathered in a trailing "Anywhere / Not mapped" group;
(4) an offline-tolerant feel — check-offs are queued locally, so no per-tap spinners;
a quiet "offline — will sync" note if disconnected; (5) exit paths in the footer:
primary "Finish walk" leading to a completion sheet (summary: N checked of M, unchecked
items stay on the list; confirm applies purchase + pantry restock — same semantics as
"Log a manual shop"), and a secondary "Pause" that just leaves walk mode with progress
kept (check state persists on the rows). Hide the pantry-coverage and substitution
panels during a walk. Add these as new states of the Grocery list page: mid-walk (2
aisles done, one active) and the completion sheet.
```

### 8. In-cart section home on the grocery list

**Consumed by:** band 3's grocery-list / order-review rework (pages/05; D16/D28).
**Context:** Today's app has an in-cart group ("Mark order placed" / "Clear purchased")
and the mockup's list **gives it no home** — pages/05 flags the gap ("keep the in-cart
section"), and the Order-confirmed screen even references "mark the order placed once
you check out". D16 makes this section load-bearing: the in_cart→ordered advance is the
purchase assertion that materializes spend events, and never-marked orders must surface
as "awaiting mark-placed", not silently auto-counted. D28 keeps `in_cart` strictly the
online-order stage, distinct from walk check-offs.

**Prompt:**

```
On the Grocery list page: re-home the in-cart section. After an order is sent to the
Kroger cart, its lines move to status "in cart" and need a distinct group on the list —
separate from checked rows (check-offs are for in-store shopping; in-cart is the
online-order stage). Design a collapsible "In your Kroger cart" section between the
active list and the pantry-coverage panel: per-line name + qty (read-only), a section
header with the order's send date and store, and two actions — primary "Mark order
placed" (this is the moment the purchase actually counts; make it feel like a
completion) and secondary "Back to list" per line (re-listing a line voids it from the
order). Include an aging state: if an order sits unmarked for days, the section shows
an "awaiting confirmation" nudge ("Placed this order? Mark it so your spend tracking
stays honest.") rather than escalating. Group by order when two sends coexist. Update
the Grocery list page in place with one in-cart order of 5 lines, one line aged.
```

---

## Band 5 — social layer

### 9. Three-state note-tier composer (replaces the Private checkbox)

**Consumed by:** band 5's recipe-notes lens change (pages/02, stories/01 §2; D30-final).
**Context:** The mockup's Recipe detail note composer has a single "Private" checkbox.
D30-final replaces it with tiers `public | friends | private`, default `friends`
(household members are inside the friends tier by definition — no household tier).
`public` is bounded by the recipe's own lens (a note never renders where its recipe
isn't visible; it reaches the anonymous /cookbook site only where the recipe itself is
anonymously visible), and visibility is a live lens — a friends note authored while
friendless becomes visible to future friends. The composer must show the effective
default at authoring time (D30).

**Prompt:**

```
On the Recipe detail page's note composer ("From other members" notes): replace the
Private checkbox with a three-state visibility tier control — Public / Friends /
Private, default Friends. Use a compact segmented control (the Time-filter segmented
treatment) or three radio-chips beneath the note field, each with a one-line
description on selection: Friends — "Your household and friends can see this" (the
default; show it pre-selected, not neutral); Private — "Only you"; Public — "Anyone
who can see this recipe — including the public cookbook site if this recipe is
public". Two conditional states to design: (a) when the recipe itself is not
anonymously visible, the Public option stays selectable but its description changes to
"Visible to everyone who can see this recipe — it isn't on the public site, so this
note won't be either"; (b) existing notes get the same control in their edit state,
plus a small tier indicator chip on rendered notes that aren't Friends-default (a lock
glyph for Private, a globe for Public — Friends renders unmarked). Update the Recipe
detail page in place showing the composer with Friends selected and one Private note
in the list.
```

### 10. Household curated-hide setting

**Consumed by:** band 5's lens/curated-set change (D13-amendment, stories/01 §1).
**Context:** The SaaS profile floors every household's cookbook with a product-curated
recipe tier (a reserved system tenant, D12). D13-amendment adds a **household-level
setting** that suppresses the entire curated tier from that household's lens — one lens
rule + one setting — on top of per-member per-recipe rejects (`toggle_reject`). No
mockup surface exists for it; the natural home is the Profile → Preferences tab (it is
household-scoped, like the rest of that tab). Under the self-hosted profile the curated
set doesn't apply, so the control is SaaS-only.

**Prompt:**

```
On Profile & preferences → Preferences: add a household-level "Curated recipes"
setting. Context: every household's cookbook includes a product-maintained curated
recipe set by default (rows badged with curated provenance in the Cookbook); this
switch hides that entire set for the whole household. Design a small card (or a row in
an existing household-scoped card if one fits better) with: a title "Curated
collection", one sentence of explanation ("A starter set of recipes we maintain.
They're marked in your cookbook; turn this off to hide them for your whole
household."), a single toggle (default on), and a household-scope hint ("Applies to
everyone in your household") consistent with how other household-wide settings on this
tab are labeled. The off state needs no confirm but should note reversibility
("They'll reappear if you turn this back on — nothing is deleted."). This card exists
only under the SaaS deployment profile. Update the Preferences tab in place.
```

### 11. Cookbook cold-start / onboarding empty state (SaaS)

**Consumed by:** band 5 (empty-corpus-on-join + curated set are SaaS-profile features,
D3/D9; pages/01 flags it "not in mock"). **Context:** Under SaaS a new household joins
with an **empty corpus** (D3) — no inherited recipes. pages/01 requires the empty
cookbook to sell the three ways in: add friends, import with the agent, browse the
public curated set; curated rows need visible provenance. The mockup's Cookbook only
designs the populated page and the search/filter empty states, never the
brand-new-household state. The curated set means the page is technically never
zero-rows (unless curated-hide is on), so the design is really "curated floor + guided
next steps", plus the true-zero variant.

**Prompt:**

```
On the Cookbook page: design the new-household cold-start state. A brand-new account
has zero own recipes; the page shows only the public curated set (rows need a visible
"Curated" provenance badge on the RecipeRow — design that badge alongside the existing
facet chips). Above the curated list, design an onboarding panel that sells the three
ways to fill a cookbook, as three compact action cards: (1) "Add friends" — friends'
recipes flow into your cookbook (→ People page); (2) "Import with the agent" — paste
any recipe URL in a Claude chat and it lands here (→ Connect to Claude modal if not
yet connected); (3) "Start from the curated set" — anchor-scrolls to the list below
with copy that hearts/plans work on curated rows immediately. The panel dismisses
permanently once the household has own recipes (or on explicit dismiss). Also design
the true-zero variant: curated set hidden (household setting) and no recipes at all —
the same three cards carry the whole page with a fuller empty illustration treatment
consistent with the existing "No favorites yet" empty-state style. Hide the
Recommended for you panel and the filter bar in both variants. Add these as new
Cookbook page states.
```

### 12. People page — self-hosted household-only variant

**Consumed by:** band 5's People page change (pages/08; profile gating per D9).
**Context:** The mockup designs the full SaaS People page: Requests inbox → nickname
hint → HOUSEHOLD → FRIENDS, each with find/invite adders. Under the **self-hosted
profile** the FRIENDS section and friend-tier requests are hidden entirely — the page
is household-only, though nicknames still apply to everyone in the deployment (D9). No
mock frame shows this variant, and simply deleting the bottom half leaves the page
header copy ("…friends trade recipes into your cookbook") and the sidebar badge
semantics wrong for it.

**Prompt:**

```
Design the self-hosted variant of the People page (a deployment-wide mode, not a user
setting): the FRIENDS section, friend-tier request rows, and all friend copy are gone;
the page is household-only. Keep: the Requests inbox (household-join requests only —
the HOUSEHOLD/FRIEND badge column disappears since only one tier exists), the nickname
hint with its live example, the HOUSEHOLD section with member rows
(avatar/nickname/@handle/remove) and the Find household members split button
(find-by-handle + invite link), and Awaiting response. Rewrite the page header for
this mode ("Everyone you cook alongside. Your household shares your pantry and meal
plan." — drop the friends clause) and rebalance the layout so the page doesn't read
as half-missing — the HOUSEHOLD section carries the page; consider promoting the
nickname hint into a side-by-side arrangement on wide viewports. The sidebar People
badge still counts pending inbound requests. Add this as an alternate state of the
existing People page rather than a new page.
```

---

## Notes for whoever runs the queue

- Requests 1–4 are safe to run immediately; they only touch surfaces the mockup already
  designs. Requests 5–6 (D29-final) are explicitly design-first per the decision text —
  run them before their bands plan, even though member semantics land in band 5.
- Requests 7–8 unblock band 3 planning (pages/05 names the walk session as "the design
  work").
- Requests 9–12 can run any time but are consumed by band 5; batching them in one
  Claude Design session keeps the social-layer vocabulary (member chips, provenance
  badges, tier language) consistent across all four.
- Not queued (deliberate): the propose empty-meal fallback and single-use badge
  cardinality (pages/04 q2/q3) are product decisions, not missing designs — the mockup
  already carries the visual language; decide in the proposal and reuse it. Mock *bugs*
  with an obvious fix (People badge counting friends, window.prompt side-adder, static
  invite link) need no design pass — the specs already prescribe the correction.
