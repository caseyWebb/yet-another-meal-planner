# Design — dedupe-night-vibe-suggestions

## Context

Issue #226. The derivation core (`runDerivation`, `packages/worker/src/night-vibe-suggest.ts`)
is shared by three surfaces: the `suggest_night_vibes` MCP tool, the member app's
`POST /api/vibes/suggest` (job-health-gated, `src/api/vibes.ts`), and the scheduled
`archetype-derive` pass (phase 5 of `scheduled()`, `src/index.ts:282`, self-gated to
`DERIVE_INTERVAL_MS = 20 h`). Whatever lands in `runDerivation` covers all three — there is no
separate Phase-5 path to patch.

Today's dedup surface, end to end:

| guard | where | space | applies to |
| --- | --- | --- | --- |
| `dedupeClusters` @ 0.85 | `night-vibe-derive.ts:186-192` | cluster **centroid** (recipe-description vectors) vs palette **phrase** vectors | clusters branch only |
| exact palette-slug skip | `night-vibe-suggest.ts:91` | string equality | both branches |
| stable `(kind, target)` id → `INSERT OR IGNORE` | `reconcile-db.ts:17-23,115-132` | slug equality | both branches |

Nothing dedups against **pending** or **rejected** proposals, nothing dedups **within a run**
beyond distinct slugs, and the cold-start branch bypasses the one semantic guard entirely.

## Production spike (read-only D1 + one Workers AI embed batch, 2026-07-08)

DB `grocery-mcp` (binding `DB`, `wrangler d1 execute DB --remote`):

| query | finding |
| --- | --- |
| `night_vibes` | 7 rows, all tenant `casey`, all created 2026-07-08T19:31–19:32Z (the member confirmed their queue minutes before the spike). **everett's palette is empty.** During the entire pileup (07-01 → 07-08) both palettes were empty. |
| `night_vibe_derived` | 7 rows (casey's palette phrases), 768-dim, ≈14.3 KB each |
| `pending_proposals` `kind='add_vibe'` | 43 pending / 7 accepted / 2 rejected at spike start; the 21:57Z run added 5 more pending (casey +2, everett +3) → **48 pending** (casey 12, everett 36). All producer `edge`, one batch per ~20 h tick (09:45, 05:46, 01:47, 21:47, …). |
| proposal `evidence` | **Every row is `{ member_slugs: [], size: 0 }` — all cold-start.** |
| `overlay` favorites / `cooking_log` | casey: 2 favorites + 1 cooked; everett: 0 + 2 cooked → both below `MIN_TASTE_ITEMS = 4`, so the clusters branch has never produced a production proposal. |

Pairwise cosines (`@cf/baai/bge-base-en-v1.5` — the system's own `EMBED_MODEL` — over all 43
pending + 2 rejected + 7 accepted phrases + casey's 7 stored palette vectors):

- **Distinct band:** casey's 7 intentionally-different palette vibes pair at **0.54–0.7575**.
- **Duplicate band:** the redundancy the member sees sits at **0.88–0.97**. Highlights:
  pending "A hearty bean and cornbread dinner" vs palette "…meal" **0.968**; pending "A fiery
  seafood skillet" vs *rejected* "A spicy seafood skillet" **0.945**; pending "A quick
  Mediterranean fish dinner" vs pending "A simple Mediterranean fish dinner" **0.964**; pending
  "A mild Thai curry with rice" vs "…with chicken" **0.955**; "A quick vegetable stir fry" vs
  "A quick vegetarian stir fry" **0.940**; pending "A quick seafood dinner" vs palette "A
  flavorful seafood dinner" **0.893**.
- **The boundary:** every same-tenant pair ≥ 0.85 is a human-obvious near-duplicate (49
  pending/pending pairs ≥ 0.85). The first clear false-positive is at **0.829** ("A mild Thai
  curry bowl" vs "A mild fish taco bowl" — same phrasing template, different food). The
  0.80–0.85 band is genuinely ambiguous ("A quick vegetable stir fry" vs palette "A quick
  veggie-forward meal" at 0.8475 arguably dupes; the taco/curry pair does not).
- **Live recurrence during the spike:** the 21:57Z run (palette now confirmed) enqueued
  "A comforting Southern pot pie" — **0.888** to palette "A comforting Southern meal" —
  plus everett's "A mild Asian stir-fry" (**0.888** to the pending stir-fry representative)
  and "A simple chicken curry" (**0.887** to pending "A warm Indian chicken curry"). Three of
  five would have been blocked at 0.85 phrase-space; the palette-covered one demonstrates the
  cold-start path ignoring a *populated* palette.

## Decisions

### D1 — Dedup operates on the NAMED PHRASE embedding, for every candidate source

The semantic identity the member experiences is the phrase, and the phrase is what all four
comparison sets share a space with: palette vibes are embedded from their `vibe` text
(`night-vibe-vector.ts` — `night_vibe_derived` **is** a phrase-vector store), and proposals
carry their phrase in `payload.vibe`. So: embed each surviving candidate's phrase and drop it
when cosine ≥ threshold against (a) palette phrase vectors, (b) pending `add_vibe` phrases,
(c) rejected `add_vibe` phrases, (d) candidates already kept this run (candidates arrive
biggest-cluster-first from `deriveArchetypes`; cold-start order is the generator's). This
covers the cold-start branch — the actual production source — identically to clusters.

The centroid-vs-palette `dedupeClusters` pre-filter **stays as-is** (same 0.85 default): it
runs before naming and saves model calls when it fires; it has simply never been the
correctness gate (different space, and clusters have never fired in production). The
phrase-space check after naming is the gate.

*Alternative rejected:* storing candidate centroids in the proposal payload for future
centroid-space dedup (the residual `docs/ARCHITECTURE.md` deferred). Centroids don't exist for
cold-start candidates — the dominant source — and bloat every row by ~14 KB; phrase space
covers both sources with vectors that are already cached or stored.

### D2 — Threshold 0.85 in phrase space, one shared constant

Grounded above: distinct ≤ 0.7575, duplicates ≥ 0.88 (the observed bands), first false
positive at 0.829. 0.85 splits the gap with margin on both sides; every observed ≥ 0.85 pair
is a true duplicate. Reuse `DEFAULT_DERIVE_PARAMS.dedupThreshold` (same value, and the two
checks express one idea — "these are the same vibe"); the sweep/filter take it as a parameter
for tests. Consequence accepted: borderline kin like "a cozy homemade pizza night" vs palette
"a cheesy pizza night" (< 0.78) remain separate suggestions — defensibly distinct vibes.

### D3 — Vectors: `night_vibe_derived` for the palette, `embedTextsCached` for the rest

One batched `embedTextsCached` call per run embeds: all pending `add_vibe` phrases, all
rejected `add_vibe` phrases, every candidate phrase, and any palette vibe **missing** its
`night_vibe_derived` row (the confirm→derive race observed live: casey confirmed 19:31, the
run fired 21:57 — the embed cron had ticked in between, but the same-tick race is real).
The KV cache (30-day TTL, content-addressed) makes repeat runs ≈ zero new embeds: steady
state re-embeds nothing, matching the "steady state is a no-op" posture the module already
claims. Bound per run: ≤ pending + rejected + candidates + palette ≈ dozens of short phrases,
one AI subrequest. No schema change; no vectors stored on proposals.

### D4 — The sweep: `superseded` status, earliest-pending representative

Each `runDerivation` pass, before enqueueing, converges the member's existing pending
`add_vibe` rows deterministically, iterating in `(created_at ASC, id ASC)` order:

1. pending within threshold of a **palette** phrase vector → `superseded` (already have it);
2. else within threshold of a **rejected** phrase → `superseded` (already dismissed the
   archetype — "dismissed stays dismissed" extends to paraphrases);
3. else within threshold of an earlier surviving pending **representative** → `superseded`;
4. else it survives and becomes a representative.

The representative is therefore the **earliest-created pending proposal of its group**
(tiebreak: lexicographically lowest id). Earliest wins because it is stable: reruns converge
to the same survivor regardless of what enqueued since, and the id ordering breaks exact ties
deterministically. Comparison is to the representative (not transitive closure) — simple,
order-deterministic, and on the production data it collapses casey 10 → 4 and everett
33 → 11 (see fixture). `rejected`/`accepted` rows are **never** modified; `superseded` is set
only on `pending` rows (`UPDATE … WHERE status='pending'`, the `setProposalStatus` guard
pattern) with `resolved_at` stamped.

*Alternatives rejected:* deleting losers (loses the audit trail and the rejected-dedup basis
if the loser was the only record of a phrasing); marking them `rejected` (conflates a system
cleanup with a member dismissal — `rejected` is spec'd as a revealed member signal).

### D5 — `superseded` needs no migration and no consumer change

`pending_proposals.status` is `TEXT NOT NULL` with no CHECK (migration 0027). Member-facing
reads (`list_proposals`, `GET /api/vibes/proposals`) already filter `status='pending'` —
superseded rows vanish from both surfaces with zero code change there. `resolveProposal`
already answers any non-pending status with structured `conflict` ("already superseded" reads
correctly). Work: widen the `PendingProposal["status"]` union, add `supersedeProposals`
beside `setProposalStatus` in `reconcile-db.ts`, update `docs/SCHEMAS.md`. The app's suggest
toast reads `throttled`/`enqueued` only and already invalidates the proposals query — the new
additive `superseded` field and the shrunken queue flow through untouched.

### D6 — Cold start fires only while the palette is empty

`starterVibesFromTaste`'s spec'd purpose is seeding "before they have a cook history"; the
observed behavior is a perpetual generator re-running an unchanged taste text against a
confirmed palette (the pot-pie row). Gate: the cold-start fallback runs only when
`existingVibes.length === 0`. A member with a palette but a thin taste-space gets
`source: "none"` (the app already toasts "No new suggestions right now") and the run spends
**zero** naming calls. Growth for such members arrives when their taste-space crosses
`MIN_TASTE_ITEMS` and the clusters branch takes over — the "superseded by behavior-derived
archetypes" transition the spec already names. *Alternative rejected:* allowing cold start on
the explicit tool/API path but not the cron — adds a caller flag for a path the throttle
mostly blocks anyway (a fresh healthy cron run answers the app trigger `throttled`), and two
behaviors are harder to state than one.

### D7 — Order of operations in `runDerivation`

Load (existing) → derive/name candidates (existing, incl. centroid pre-filter) → cold-start
fallback if empty **and palette empty** (D6) → read pending + rejected `add_vibe` → one
`embedTextsCached` batch (D3) → sweep pending (D4) → filter candidates against palette ∪
rejected ∪ surviving representatives ∪ kept-candidates (D1) → enqueue survivors (existing
exact-id skip + stable-id idempotency unchanged). The sweep runs even when zero candidates
survive or derivation cold-starts to nothing — convergence must not depend on new material.
Return `{ candidates: kept, enqueued, superseded, source }`; the scheduled job folds
`superseded` into its health summary (`{ members, enqueued, superseded }`).

### D8 — Pure logic lives in a new module; wiring stays thin

`packages/worker/src/night-vibe-dedupe.ts` (pure, no I/O — the `diversify.ts` /
`night-vibe-derive.ts` discipline): `planQueueConvergence(pending, basis, vecOf, threshold)`
→ `{ superseded: [{ id, coveredBy }], representatives }`, and
`filterCandidates(candidates, basisVecs, vecOf, threshold)` → kept candidates. Unit-testable
off `workerd` with synthetic unit vectors plus a production-shaped fixture distilled from the
spike. `runDerivation` wires D1's real vectors through them.

## Acceptance fixture (production rows → expected convergence)

Frozen 43-pending snapshot, simulated with D4's exact algorithm at 0.85 over the real
embeddings:

- **casey (10 pending → 4):** superseded — `a-spicy-seafood-dinner`, `a-quick-seafood-dinner`
  (palette: a-flavorful-seafood-dinner), `a-hearty-bean-and-cornbread-dinner` (palette:
  …-meal), `a-comforting-soul-food-meal` (palette: a-comforting-southern-meal),
  `a-fiery-seafood-skillet`, `a-spicy-seafood-stir-fry` (rejected:
  a-spicy-seafood-skillet), `a-quick-vegetarian-stir-fry` (rep: a-quick-vegetable-stir-fry),
  `a-spicy-comfort-food-night` (rep: a-cozy-comfort-food-dinner). Representatives:
  a-cozy-comfort-food-dinner, a-quick-vegetable-stir-fry, a-flavorful-vegetarian-bowl,
  a-cozy-homemade-pizza-night.
- **everett (33 pending → 11):** representatives — a-fresh-thai-fish-salad,
  a-mild-japanese-chicken-bowl, a-quick-mediterranean-fish-dinner,
  a-warm-indian-chicken-curry, a-quick-chicken-stir-fry, a-warm-mediterranean-stew,
  a-mediterranean-grilled-chicken-dish, a-mild-thai-curry-with-rice,
  a-simple-baked-fish-with-veggies, a-simple-fish-taco-tuesday, a-comforting-chicken-soup;
  the other 20 superseded (six stir-fry variants collapse onto a-quick-chicken-stir-fry,
  four fish-taco variants onto a-simple-fish-taco-tuesday, etc.).
- Of the five rows the 21:57Z run added, three collapse (pot-pie → palette 0.888;
  a-mild-asian-stir-fry → stir-fry rep 0.888; a-simple-chicken-curry → curry rep 0.887).

Counts will drift with each pre-deploy run, so the post-deploy check is the **invariant**, not
the counts: after the first post-deploy `archetype-derive` run, re-run the spike queries and
assert (a) no same-tenant pending `add_vibe` pair has phrase cosine ≥ 0.85, (b) no pending is
≥ 0.85 to any palette or rejected phrase, (c) every rejected row is untouched (`status`,
`resolved_at` unchanged), and (d) subsequent runs stop growing the queue (casey's pending
count stays flat across two ticks — the D6 gate).

## Model identity / spend

No new model class: the same `EMBED_MODEL` embed batch (KV-cached, ≈ zero at steady state),
the same small-model namer — now invoked strictly less often (D6 removes the daily cold-start
naming for palette-holders; the pre-filter still prunes clusters before naming). The frontier
is never touched. The app trigger's job-health throttle (D7 of member-app-core) is unchanged.
