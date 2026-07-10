# Page 11 — Profile: Discovery tab (feeds)

Screens: `screens/profile-discovery.png`, `screens/tall-profile-discovery.png`.
Stories: 05 (trust pipeline), 01 (household counts).

## 1. Design summary

One card, "Feeds you follow": followed feeds → add-a-feed input with typeahead + edge
test → popular-feeds directory. Header states the model: "Feeds are shared across your
household group and de-duplicated — everyone polls one copy, so the same source is never
fetched twice. Following one tells yamp it's a source worth watching *for you*." Follow
is a personal relevance signal; polling is pooled (the dedup/memoize principle).

## 2. Functional requirements

**Followed rows**: name + "you added" provenance badge; health chip (Reachable / Walled
— derived from the persisted `last_status` columns + staleness on the shared feeds
table, story 05 §1; "Checking…" is client-only during an in-flight probe, never
persisted); URL; descriptive tags; "followed by N households · brought you N recipes"
(attribution rollups — the rollup reads `discovery_matches` joined to `discovery_log`
origin, D13, so attribution and visibility cannot drift); Unfollow (never removes from
the pool). Agent-added feeds (`update_feeds`) auto-follow the adding member (mirroring
the member add-with-test path). Sweep-import visibility = the matched members'
households (D13 — the `discovery_matches` row is the grant). The curated set arrives
through this same sweep pipeline as a product-maintained pinned public source, landing
provenance-tagged as the curated tier; a household-level setting can hide the entire
curated tier from the household's lens (D13 amendment).

**Add a feed**: input with typeahead over the pool (not-followed, not-walled; one-click
follow) + "Test it and add as a new feed" row for unknown domains. Submit: known
non-walled domain → follow directly; unknown or walled (off the stored `last_status`) →
**feed-test modal**.

**Feed-test modal** (member exposure of the existing admin probe): testing spinner
("Fetching from yamp's edge and sampling recent posts…") → results: reachable chip +
HTTP status + item count, 5 sampled posts badged with the sweep's park taxonomy (recipe /
no recipe markup / incomplete / not a recipe / unreachable), verdict line ("3 of 5 recent
posts parsed as complete recipes — good to add."). Add feed enabled iff reachable &&
parsed → joins the pool followed+owned. **Walled result** (403): "This site blocks
automated fetches… Set it up through a satellite instead — it pulls the same posts from
your home network." → CTA to the Satellites tab. Unreachable / not-a-feed verdicts.
Footer: "Testing runs from yamp's edge — it can differ from your browser. Nothing is
saved until you add it." (Probe is side-effect-free; rate-limit the member endpoint.)

**Popular feeds**: not-followed, not-walled pool feeds ranked by follower households
(cap ~6); "brought N recipes" or "new to the pool"; Follow button. Deployment-internal.

**Deliberately cut (vestigial in mock — confirm)**: the "New for you" save/reject panel
(lives in Cookbook) and newsletter-forwarding senders card.

## 3. Delta vs today

Discovery is agent/MCP + operator-only today. New: the entire member surface, the
**follow relation** (per-member), feed **health persistence**, **attribution rollups**,
the **popular pool ranking**, and member add-with-test (reusing `update_feeds`
validation: public-http-only, canonical dedup). Existing: shared feeds table, one-poll
sweep, the probe endpoint (admin-gated), park taxonomy, walled-source doctrine.

## 4. Open questions

1. Follow's mechanism in the sweep (weighting vs gating vs priority) — story 05 q1.
2. Walled feed later served via satellite: how does it appear here ("via satellite"
   state)?
3. Member path to remove a mistakenly added feed (vs operator prune only).
4. Zero-follower feeds: keep polling or age out?
5. Households denominator pre-story-01: deployment-wide until households ship?
