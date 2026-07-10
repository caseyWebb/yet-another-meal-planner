# Page 12 — Profile: Satellites tab

Screens: `screens/profile-satellites.png`, `screens/tall-profile-satellites.png`.
Stories: 05 (trust pipeline), 04 (cart-fill fulfillment).

## 1. Design summary

Four cards moving the satellite lifecycle into the member's profile: **Satellites**
(machines + ingest keys), **Source health** (acceptance + quarantine), **Recent
rejections** (the audit rear-view), **Cart-fill helper**. Intro fixes the member-facing
invariant: "A satellite is a sensor: it only reports what it observes, and yamp re-checks
everything before it lands." Tab badge = attention count (define what counts — mock
hardcodes it).

Nearly all backend exists (`satellite`, `satellite-source-audit`: key mint/revoke,
liveness, funnel, windowed stats, quarantine recommendation + reversible toggle,
rejections ledger with visibility rules) — surfaced only in the operator admin panel
today. This page is mostly **re-scoping those to member sessions** plus an authorization
stance.

## 2. Functional requirements

**Mint ingest key**: one click → `yk_live_…` shown once ("copy now; shown once. One key
authenticates both push and pull") with Copied → masked row (`yk_live_••••{last4} ·
minted just now`) + Revoke. Backend mint takes a label + optional tenant binding the mock
omits — either add a small mint form or spec label-on-first-push enrollment. Authority
(D14): mint/revoke/quarantine = any member of the owning household; member-minted keys
are household-bound; operator-global keys stay admin-only.

**Machine cards**: name; capability badges (RECIPE-SCRAPE / SALE-SCAN / CART-FILL);
freshness chip (Fresh · pushed 8m ago / Stale · last push 2d ago); meta "satellite vX ·
contract vN · key {fingerprint}" with **contract-skew warning** ("contract v1 · behind
v2"); last-24h funnel **pushed → accepted → deduped → rejected** (rejected highlighted
when nonzero); **Disconnect** → type-the-name-to-confirm modal ("This revokes the
satellite's key and stops it reporting. Recipes and orders it already delivered stay put;
reconnecting means enrolling it again from scratch. This can't be undone.").

**Source health**: per-source rows (kind badge recipe/sale/order; Healthy / Adapter
failing / Quarantined chip; acceptance bar; "94% accepted · 47 ok · 3 rejected · last
6m ago"; reversible Quarantine ↔ "Quarantined — resume" toggle) + **quarantine
recommendation banner** (reason: "failed 12 of last 14 pushes as contract_invalid — the
adapter likely broke…") with Quarantine / Dismiss. Recommendations are never
auto-applied.

**Recent rejections**: kind · source · reason chip (`contract_invalid`, `no_jsonld`,
`unknown_sku`) · ×count · time · origin (local = "dropped before wire" / worker = URL or
line detail). Visibility (D14): household-scoped entries only, for ALL kinds; the
operator admin keeps the superset. Empty state: "Nothing rejected in the last 14 days —
every observation landed clean."

**Cart-fill helper** (D22 — helper secrets never leave the satellite host; there is no
URL+token reveal): per-store rows show only Worker-derivable facts — hosting satellite,
"filled 2 orders this month · last fill 4d ago" (per-store fill count and last-fill time
from order lists), liveness from push recency, session chip (Session fresh / Re-run
login) keyed off the satellite-reported per-store session-freshness boolean observation
(an additive wire field on the existing push path; the same field serves the
Preferences adapter summary and the grocery launcher's disabled state). "It stops at
the review page — you place the order, so a purchase is never made without you." "Open
helper" = static per-deployment instructions ("open the helper on the machine running
your satellite — it prints its address and token at start"), optionally augmented by a
member-typed local address kept in browser-local storage only, never synced. The helper
URL and session token get no wire field, no D1 row, no member/admin API.

## 3. Delta vs today

New: member-facing exposure of everything above (routes + authz), mint-form/labeling
decision, cart-fill helper metadata path, tab attention badge. Exists: all core
machinery, admin-side.

## 4. Open questions

1. ~~Member authority: who may mint/revoke keys, disconnect machines, quarantine
   sources?~~ — decided (D14): any member of the owning household; member-minted keys
   are household-bound; operator-global keys admin-only. Operator admin remains the
   superset view.
2. Tenant-scoped vs global sources under quarantine (NULL-tenant store slugs).
3. Attention-badge definition (stale machine? contract skew? nonzero rejects? unseen
   keys? outstanding recommendation?).
4. ~~Cart-fill card data path (§2) + security stance.~~ — decided (D22): helper
   URL/token never leave the satellite host; the card shows Worker-derivable facts plus
   the satellite-reported session-freshness observation.
5. Key ↔ machine ↔ capability model: capabilities are declared per machine; keys are
   unscoped — good enough, or per-key capability scopes?
