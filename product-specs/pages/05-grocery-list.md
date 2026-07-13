# Page 05 — Grocery list, store walk, and order review

Screens: `screens/nav-grocery-list.png`, `screens/tall-grocery-list.png`,
`screens/widget-grocery-list-widget.png`, `screens/widget-grocery-storewalk.png`,
`screens/widget-order-review-widget.png`, `screens/widget-order-confirmed.png`.
Stories: 03 (spend capture), 04 (fulfillment), 06 (both widgets dual-use).

The page = header + the Grocery List widget; the order flow = the Order Review widget in
a modal. Header: "Your list, plus what the plan needs, minus what the pantry covers."

## 1. List view

**Line model**: name, freeform qty ("1 lb", "2 cans"), `for_recipes[]` (+N collapse),
origin (plan/list/both — captured, displayed only via the recipe attribution), `kind:
grocery|household` (non-food is first-class, grouped under HOUSEHOLD), freeform note
(italic: "dark roast"), placement `{aisle, department}` or "Not mapped", Staple badge.
Household lines are an EXISTING data-model feature (`grocery_list.kind` + the
orthogonal `domain` column) gaining member-UI surfacing — the band-3 delta cites
kind/domain semantics from SCHEMAS.md rather than defining new fields; the mock's
HOUSEHOLD group = `kind='household'`; non-grocery-domain lines are excluded from a
grocery store's walk (already specced).

**Grouping**: GROUP BY segmented **Department | Recipe**. Department groups sort by
minimum aisle number (store-route order — placement source per store adapter, story 04);
Recipe groups by first recipe with a "No recipe" bucket and per-group counts. Mock code
carries unexposed category/aisle groupings — decide whether today's Category↔Aisle
toggle survives or department replaces it.

**Rows**: check-off checkbox (strikethrough when checked; footer "N of M checked" —
checked state is central: it feeds manual-shop logging and the walk). Checked state
(decided, D28): a new per-row `checked_at`, orthogonal to `status` — a class (b)
idempotent boolean upsert (offline-queued, replayed); `in_cart` remains exclusively the
online-order stage, and the stale-cart gate keeps reading it. Checked = handled:
checked rows drop out of the derived to-buy/order-review set until unchecked or swept —
only "Log a manual shop"/walk completion sweeps them, applying receive semantics + D16
spend events to checked rows ONLY, never rows `place_order` or a satellite advanced.
Footer counts read `checked_at`. Substitution icon → anchored "Pantry look-alike"
popover (Keep original / Swap in); qty chip (read-only in list — editing moved to order
review; confirm), remove ×. Add row: name-only input. Stale-cart banner (dismissible;
hard gate lives in order review). Underived notice ("1 planned recipe isn't fully
derived yet — X's ingredients aren't included below."). Empty state. The in-cart group
stays a distinct list section with "Mark order placed" / "Clear purchased" (q12
closed) — the online-order stage, distinct from checked rows.

**Pantry coverage — "Pantry covers these — still good?"**: collapsible; "N covered · M
worth a look"; fresh rows "✓ covered"; stale rows get **Still good** (should call
mark_pantry_verified, not the mock's local dismiss — decide) and **Buy anyway**
(promotes a line noted "was pantry-covered"). Staleness thresholds come from the ONE
shared threshold table (per category class, verify-queue and worth-a-look tiers)
consumed by this page, page 06, and `read_to_buy` — the proposal states whether
`read_pantry`'s stale_only stance is kept or re-pointed; TOOLS.md notes the single
source.

**"Use what you already have"**: pantry look-alike swaps for lines about to be bought;
relation labels: direct substitute / same-family swap · via {family} / broader swap · via
{family}; **Swap in** drops the buy line (confirmed row: "✓ Using X — Y dropped from the
list." + Undo); Keep original dismisses. Same state as the row popovers.

## 2. Store walk (new member surface; agent walk exists in `in-store-fulfillment`)

Top-level **Order | Store walk** mode toggle. Walk mode reframes the list in store-route
order and swaps the footer CTA to **"Start walk →"**. The mock defines nothing past that
(button relabels "Walk started") — the contract is decided (D28 + D15): walk mode is
pure client state (mode in URL search params, transient progress local — the
propose-session precedent), no server session entity; check-offs are queued class (b)
`checked_at` writes; the walk works with ZERO connectivity (writes keyed by the
client-minted session id, replayed on reconnect; starting a walk needs no server round
trip); cross-device/member resume comes from the D1 `checked_at` rows; completion = the
one shared idempotent shop-commit op (receive + pantry restock with verification + D16
spend events), exposed at /api and to the agent voice walk. Remaining design work:
which panels hide in walk mode. Aisle data: Kroger placement or offline-store aisle
maps (story 04).

## 3. Order review (Kroger)

**Header stats**: Going to cart (N items) / Estimated total / **Flyer savings** (−$N,
only when >0). The "Going to cart" set = the derived to-buy minus checked rows (D28);
the header tiles render the D16 send-record snapshot — the same source the spend
analyzer reads, so tiles and analyzer cannot disagree. **Cleared-cart gate**: banner ("The Kroger cart can't be read back, so
clear it in the Kroger app first — otherwise this order double-adds those items.") +
required checkbox "I've cleared the old Kroger cart"; send disabled until acked; footer
sub cascades through nothing-selected / confirm-cart / N-flagged / "Prices are today's —
Kroger confirms final pricing at fulfillment."

**Matched lines**: product pick (brand · size), price × qty with "($X ea)", flyer-deal
badge + strikethrough regular price, **qty stepper only when qty was assumed** (fixed
mono chip when user-specified), Skip/Add back, "See N other options" (same-identity
candidates, current pick badged "Store pick"), at most one **featured swap** card with
reason pills ("Cheaper · $0.28/fl oz vs $0.41/fl oz", "On sale") → staged "✓ Swapped in"
+ Undo.

**Needs a decision**: (a) **Choose one** — ambiguous brand: "No brand preference saved
for this — pick one below, or set 'don't care' in your profile and we'll grab the
cheapest next time."; radio candidates; picking reveals **"Save {brand} as my preferred
brand"** switch (writes brand tiers — pages/09). (b) **Unavailable** — names the
modality ("not fulfillable for curbside or delivery at your store right now");
**Try a broader search** (loosened-constraint candidates with divergence notes: "ground,
not whole bean") and **Manual search** (free text over the catalog, modality notes);
resolution flips to "✓ Found it — ordering …" + Undo. Undecided checkpoints are left off
and reported. Existing checkpoint machinery (`ingredient-matching`, `member-app-grocery`)
covers the picker; the in-order don't-care hint, broader/manual search, and preference
write-back are new.

**Confirmed screen** (honest step report): "N items sent to your Kroger cart" (app can't
complete purchase) / "Moved to 'In cart' on your list" / "**Learned N store matches**"
(match-cache surfacing + "Saved your preferred brand for X") / "N items were left off —
stayed on your to-buy list". Order summary box; "Back to review" (mock allows freely —
define post-send semantics vs double-add).

**Non-Kroger launchers** (story 04): a branded **Shop on Instacart** action calls
`POST /api/grocery/instacart` and hands the current to-buy set to an Instacart
Marketplace page, where the member chooses a retailer and reviews/adds items; there is
no preferred retailer, per-trip override, cart/order claim, or lifecycle transition. The
launcher also includes satellite stores
("Satellite" badge; disabled "re-run login", keyed off the satellite-reported session
freshness — D22), **Log a manual shop · N checked** (reads `checked_at` and applies
receive + spend to member-checked rows only, never rows `place_order` or a satellite
advanced — D28/D16). Re-link-on-reauth and error states carry over from today (absent
in mock).

## 4. Delta vs today (highlights)

New: department/recipe grouping + route ordering, store-walk member UI, household lines,
check-off centrality, header stats + flyer savings, assumed-vs-specified qty rule,
brand-decision UX + preference write-back, broader/manual search, honest confirm screen +
learned-matches surfacing, non-Kroger launchers, spend capture hooks (story 03).
Exists: derived to-buy, pantry coverage, substitution hints, stale-cart two-tier gate,
checkpoint dispositions, SKU match cache.

## 5. Open questions

Carry the full set from the analysis: ~~walk-session semantics~~ (1 — decided, D28:
client-held walk state, `checked_at` rows, shared shop-commit completion; §2);
grouping-toggle final set + per-mode defaults (2); placement/department source + "Not
mapped" behavior (3 — note: placement/department is presentation-only, never the
analytics dimension, D17); ~~checked-state persistence/reset~~ (4 — decided, D28:
per-row `checked_at`, class (b), swept only by manual-shop/walk completion); Still-good
→ verify write (5); swap-in learning (alias/preference capture — ties to
substitution-capture work) (6); brand-preference storage = tier model (pages/09) (7);
broader-search constraint definition + whether manual picks feed the match cache (8);
ambiguity threshold for checkpoints (9); ~~price snapshot persistence for spend~~ (10 —
decided, D16: snapshot at send on the send record, materialize at the purchase
assertion; per-line Kroger checkout deletions stay unknowable — accepted imprecision);
post-send review reopen (11); ~~in-cart section home~~ (12 — decided, D28: stays a
distinct list section with "Mark order placed"/"Clear purchased"); launcher scope per
adapter (13); list qty editing removal — intentional? (14).
