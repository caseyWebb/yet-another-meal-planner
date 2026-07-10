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
   copies. A sweep import's visibility grants ARE its attribution rows — the
   zeroth-import rule (D13, story 01 §1).
3. **Ledger, not logs**: rejections persist with reason taxonomy (`contract_invalid`,
   `no_jsonld`, `unknown_sku`, …) and origin split (satellite-local vs worker-intake).
   Member-facing rejection reads return only the caller's household's entries, for ALL
   kinds (D14); the operator admin keeps the superset.
4. **Health → recommendation → human confirms**: windowed per-source acceptance rates
   produce quarantine *recommendations*; a human applies or dismisses; quarantine is
   per-source, reversible, and never automatic. Key revocation (machine disconnect) is
   the harder cousin: type-name-to-confirm, irreversible re-enrollment.
5. **Contract versioning**: satellites declare a contract version; skew renders as a
   visible warning, not silent drift.
6. **Satellite trust under SaaS (D14)**: satellite data rides the same D2 lens and D9
   profiles — no new sharing machinery. Corpus rows carry a provenance class:
   worker-fetched copies key by URL and are always canonical for that URL;
   satellite-observed copies key by (URL, content-hash) and are visibility-scoped to the
   pushing household's lens. An outside household never dedups onto a satellite copy: a
   worker-fetchable URL gets the Worker's own canonical fetch (matching hashes merge
   onto it); a walled URL needs the household's own observation — identical hashes
   converge, divergent content forks rather than poisons; derived artifacts memoize per
   content-hash, preserving D2's compute-once. Satellite sale observations are
   tenant-attributed at intake and read through the lens; only worker-fetched
   first-party sources stay in the cross-tenant flyer plane (its public-derived argument
   survives verbatim; self-hosted all-to-all equals today's shared cache). Member-minted
   keys are household-bound; mint/revoke/quarantine authority = any member of the owning
   household; operator-global keys stay admin-only. The band deltas
   `satellite-source-audit`'s trust premise in the same pass — intake tenancy + lens
   scoping IS the cross-tenant boundary.
7. **Feed health**: `last_polled_at` / `last_ok_at` / `last_status`
   (ok | walled | unreachable | not_a_feed) columns on the shared feeds table, written
   by the sweep's rotating poll and any probe run; chips derive from last_status +
   staleness; "Checking…" is client-only during an in-flight probe, never persisted;
   walled routes to the satellite CTA.

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
2. ~~Feed health persistence: where does the chips' stored health state live?~~ —
   decided: the last_polled_at / last_ok_at / last_status columns on the shared feeds
   table (§1); "Checking…" is client-only.
3. ~~Member authority boundaries on keys/sources/quarantine.~~ — decided (D14):
   member-minted keys are household-bound; mint/revoke/quarantine authority = any member
   of the owning household; operator-global keys stay admin-only.
4. Zero-follower feeds: keep polling or age out? Note `update_feeds` records the adding
   member as a follower (mirroring the member add-with-test path; documented in TOOLS.md
   in the same pass), so zero-follower aging can never orphan explicit adds.
5. Newsletter forwarding and the "New for you" save/reject panel were cut from the final
   Discovery tab (vestigial in mock) — confirm out of scope (new-for-you lives in
   Cookbook).
