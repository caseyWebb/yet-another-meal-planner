# Story 05 — How ingested data earns trust

Discovery feeds (pages/11) and Satellites (pages/12) are two doors into the same
principle the mockup states outright: *"A satellite is a sensor: it only reports what it
observes, and yamp re-checks everything before it lands."* Third-party data — feed posts,
satellite pushes, sale scans — never enters the corpus on the source's authority. Most of
the machinery exists (Worker-side validation, rejection ledger, source stats, quarantine,
feed probe); the mockup's contribution is making the trust pipeline **member-visible** and
extending it with per-member relevance signals.

## 1. The pipeline (shared vocabulary for both pages)

1. **Probe before admission** — a feed is tested from the edge before it's added
   (reachable? parses as RSS/Atom? sample entries recipe-parseable?). Testing is
   side-effect-free; nothing is saved until explicit Add. Walled sources (403) are
   admissible only via a satellite — the UI routes there instead of failing.
2. **Push/poll → re-validate → dedup → land**: every observation flows the funnel
   `pushed → accepted → deduped → rejected`. Dedup is the story-01 memoization principle:
   same URL/content = one corpus row, later arrivals become visibility/attribution, not
   copies.
3. **Ledger, not logs**: rejections persist with reason taxonomy (`contract_invalid`,
   `no_jsonld`, `unknown_sku`, …) and origin split (satellite-local vs worker-intake).
   Order rejections are private to the household; recipe/sale rejections shared.
4. **Health → recommendation → human confirms**: windowed per-source acceptance rates
   produce quarantine *recommendations*; a human applies or dismisses; quarantine is
   per-source, reversible, and never automatic. Key revocation (machine disconnect) is
   the harder cousin: type-name-to-confirm, irreversible re-enrollment.
5. **Contract versioning**: satellites declare a contract version; skew renders as a
   visible warning, not silent drift.

## 2. What's new vs existing specs

Existing (`satellite`, `satellite-source-audit`, `discovery-sweep`, admin probe endpoint):
everything in §1 exists backend-side, surfaced only in the operator admin panel. The
member Satellites tab is 90% re-scoping those reads/mutations to member sessions with an
authorization stance.

New:
- **Feed follow relation** (member-level): follow = personal relevance signal to the
  sweep ("worth watching for you"), NOT what causes polling (one poll per source
  regardless). Unfollow never unpolls while others follow; feed removal stays curated
  (operator or owner path TBD).
- **Popular-feeds pool**: deployment-internal directory ranked by follower households;
  "new to the pool" for unproven feeds; walled feeds excluded from casual follow.
- **Attribution rollups**: per-feed × per-member "brought you N recipes" (derivable from
  the discovery log; new query).
- **Member-facing mint/revoke/quarantine authority** — who may act on which keys and
  sources (see pages/12 open questions).

## 3. Open questions

1. Follow's concrete effect on the sweep: taste-match weighting? gating new-for-you to
   followed feeds? polling priority? Define one mechanism.
2. Feed health persistence: "Reachable/Walled/Checking" chips need a stored health state
   maintained by sweeps/probes — where does it live and how stale can it be?
3. Member authority boundaries on keys/sources/quarantine (any member? key owner?
   household-scope only?).
4. Zero-follower feeds: keep polling or age out?
5. Newsletter forwarding and the "New for you" save/reject panel were cut from the final
   Discovery tab (vestigial in mock) — confirm out of scope (new-for-you lives in
   Cookbook).
