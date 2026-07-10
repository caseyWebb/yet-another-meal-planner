# Page 06 — Pantry

Screens: `screens/nav-pantry.png`, `screens/tall-pantry.png`.
Stories: 03 (waste capture — the load-bearing change here).

## 1. Design summary

Pantry keeps its verification model and gains: a **location** dimension with group-by,
a **multi-item add form**, and disposition-based removal (**Used / Mark as waste**)
that feeds the waste analyzer.

## 2. Functional requirements

**Header**: "N items on hand · M to verify."

**Needs verification** (exists — same rule: perishable categories {produce, dairy,
seafood, meat} + ≥7 days unverified, most-stale first): "{N}d unchecked" badge, qty
input, ✓ Verify (drops out immediately), trash. Items appear in exactly one section.

**Multi-item add form** (new): grid ITEM / QTY / CATEGORY / LOCATION with datalist
suggestions; category placeholder "auto"; recognition auto-fills category+location
without clobbering user input; a fresh row appends whenever the last row has a name
("Tab through to add several at once"); Clear + "Add N items" (disabled at zero); added
rows are marked verified-now.

**Vocabularies** (new, controlled): categories = food taxonomy (Produce, Dairy, Meat,
Seafood, Grains, Bakery, Canned, Condiments, Oils, Spices, Baking, Frozen, Snacks,
Beverages); locations = Fridge, Freezer, Pantry, Spice rack, Counter, Cabinet. This
splits today's location-flavored `category` (`fridge`/`freezer`…) into two orthogonal
fields — a real schema change (D1 column + migration + `update_pantry`/`read_pantry` +
SCHEMAS.md same pass). The controlled category vocab IS the analytics dimension source
(D17): pantry-add autofill and event stamping share ONE deterministic
ingredient→category derivation (item → canonical ingredient id via the
IngredientContext funnel → category, memoized per identity) — closing the autofill
question. The location vocab (six values) is THE kitchen location vocabulary
product-wide (pages/02's widget consumes it). Staleness thresholds consume the shared
threshold table (pages/05 §1).

**Group-by toggle**: Category (alphabetical) | Location (fixed order Fridge, Freezer,
Pantry, Spice rack, Counter — add Cabinet).

**Item rows**: relative verified stamp ("verified just now / today / N days ago");
re-verify icon (hidden when verified today); editable qty; **Used split button** —
primary Used = consumed, removes the row; menu → **Mark as waste** → waste modal.
**No bare trash on regular rows** — every removal is a disposition event (story 03).

**Waste modal**: "Toss '{item}'" / "Why is it going in the bin? This feeds your Waste
analyzer so it can spot patterns." — single-tap reason list, then remove + persist the
waste event (mock persists nothing — the event contract is story 03 §2; canonical reason
enum decided there). Disposition-on-remove events carry a client-minted event id (D15)
and a capture-stamped department (D17).

## 3. Delta vs today

| Feature | Status |
|---|---|
| Verification section, sub-label, verify/remove | exists |
| Relative verified stamps, just-now flash, conditional re-verify icon | tweak |
| Multi-add form + recognition autofill | **new** |
| Category/location split + group-by | **new (schema)** |
| Used / Mark-as-waste dispositions + modal | **new** |

## 4. Open questions

1. Partial use: "Used" removes the whole row; is a decrement/"some left" flow needed
   (qty is editable right there — maybe sufficient)?
2. Does "Used" emit a consumption signal (future use-it-up/staples tuning) or stay pure
   removal?
3. ~~Recognition source for autofill: client lookup (mock), ingredient-identity funnel,
   or derived guidance data?~~ — decided (D17): the ingredient-identity funnel — the
   same derivation that stamps analytics departments (§2).
4. ~~Category migration mapping for existing rows; does `update_pantry` gain
   location?~~ — decided: copy old category → location (pantry→Pantry, fridge→Fridge,
   freezer→Freezer, spices→Spice rack); set category NULL ("auto"); a cron-shaped
   backfill pass rides the ingredient-identity machinery to classify NULL categories
   over time; readers treat NULL as uncategorized, never an error; `update_pantry`
   gains optional location (validated) + the new category vocab; `read_pantry`'s
   category filter accepts both vocabularies during convergence; TOOLS.md + SCHEMAS.md
   same pass.
5. ~~Prepared leftovers (`prepared_from` rows): same disposition flow covers tossing
   them?~~ — decided (D17): yes — `prepared_from` rows stamp the Leftovers
   pseudo-department (waste only), derived at read time (story 03 §2).
