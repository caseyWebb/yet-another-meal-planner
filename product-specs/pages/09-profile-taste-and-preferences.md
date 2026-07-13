# Page 09 — Profile: Taste profile + Preferences tabs

Screens: `screens/profile-taste.png`, `screens/tall-profile-taste.png`,
`screens/profile-prefs.png`, `screens/tall-profile-prefs.png`.
Stories: 02 (cadence), 03 (budget lives here), 04 (store card).

Profile shell: six tabs — Taste profile / Preferences / Meal vibes (pending badge) /
Discovery / Satellites (alert badge) / Account & security. "How yamp plans for you.
Editable here, used everywhere."

## 1. Taste profile tab — effectively unchanged

Two-column card: derived retrospective prose + cuisine/protein/go-to chips (clickable) on
the left; "In your words — guidance yamp reads" and "Dietary principles — rules every
plan respects" markdown editors (If-Match, as today) plus read-only "Kitchen equipment —
set with yamp" chips on the right. Only change: layout, and the prose should become
meal-aware once cadence is per-meal ("3.8 nights a week" → per-meal counts). The taste
profile stays member-scoped; in household planning it feeds the attendance-weighted
household blend (D29) — dietary Avoids compose by union across members, taste ranking
blends member profiles weighted by who's eating.

## 2. Preferences tab

**Planning card**: **per-meal weekly cadence steppers** Breakfast/Lunch/Dinner, 0–7
each (story 02 — replaces the single nights control); resurface-after slider (14–60d);
novelty-boost slider (0.1–0.5). Cadence and resurface-after are household-scoped (D29).
**Lunch strategy and ready-to-eat default action are cut (decided, D8)** — the proposal
removing them defines the migration onto seeded meal vibes (story 02 §3). Add the
**weekly budget** control here (story 03 — mock forgot it); it is mandatory (read by
band 4). Banding (D25): the planning card + budget control ride the band-2
`profile-planning-and-vibes-ui` slice, sequenced immediately after band 1's schema
change; the Preferred-brands card ships with the brand-tier model change (never after
the order-review rework).

**Dietary card**: Avoid entirely / Limit token fields (exists; add-pill interaction
tweak).

**Store card** (story 04): adapter tabs **Kroger / Instacart / Satellites / Offline**.
Kroger: Connected chip, preferred store (name + address) with gear → **store-modal**
(ZIP search, distance-sorted results, select), Disconnect / Connect. Instacart reports
only operator-configured availability and points to the Grocery Marketplace handoff;
there is no member account, retailer preference/override, price, availability, or ETA.
Satellites: read-only per-store adapter summary (state chips: Session fresh / Scanning /
Re-run login — session freshness comes from the satellite-reported observation, D22)
linking to the Satellites tab + "Authoring store adapters →" doc link.
Offline (**decided, D6: a rename of the existing generic non-Kroger stores surface** —
`list_stores`/`add_store`/store notes, incl. `layout` aisle notes; no new entity): store
rows (name, optional nickname, mapped/stale/No map chip), gear → **map-modal** aisle
editor (ordered aisles with move/remove, per-aisle item chips, preset aisle names,
free-text add), "Add an offline store" form. Standalone ZIP pref retires into the
picker.

**Preferred brands card** (new model): per product-family cards with **tiers of
equivalents** — "yamp tries your top tier first, then falls back. Brands in the same tier
are equally fine, so the cheapest wins." Tier chips with ▲/▼ (past-edge creates a tier),
per-tier add-brand input, "+ Add a fallback tier", per-family **"Any brand — cheapest
wins"** toggle, remove-family, add-family form. Replaces today's flat ranked list
(`Record<term, string[]>` → tiers + any-flag; migration: each existing rank → its own
tier). Order review's "Save as preferred brand" and "don't care" write here (pages/05).

## 3. Delta vs today

| Feature | Status |
|---|---|
| Taste tab (all) | exists (layout) |
| Per-meal cadence | **new** (story 02) |
| Lunch strategy / RTE action | **cut (decided, D8)** (map to vibes) |
| Sliders, dietary tokens | exists |
| Adapter-tabbed store card, store picker modal | **new** |
| Instacart adapter | **operator-configured Marketplace handoff** (D7) |
| Offline stores + aisle-map editor | **new UI** over the existing stores surface (D6) |
| Brand tiers + Any brand | **new data model** (tri-state semantics exist) |
| Weekly budget | **new** (story 03; add to this tab) |

## 4. Open questions

1. Brand-tier schema + migration; how an order-review "save preferred brand" places the
   brand (new tier 1? join tier 1?).
2. Kroger "Connected" toggle in prefs vs the existing OAuth flow — reuse
   `kroger_login_url`; Disconnect semantics (drop refresh token).
3. Store-modal search behavior (debounce, radius, result count) for Kroger.
4. ~~Offline-store data owner~~ — decided (D6): the existing stores surface. Remaining:
   aisle-map sharing scope (story 04 q2).
5. ~~Where old `lunch_strategy`/`rte_action` values migrate; what stale agents see.~~ —
   decided (D21): retired keys are accepted-and-dropped with a `warnings` field for one
   deprecation window (`default_cooking_nights` aliases to `cadence.dinner`); the value
   migration onto seeded lunch/breakfast vibes runs as pipeline convergence with
   pre-migration production rows as acceptance fixtures.
