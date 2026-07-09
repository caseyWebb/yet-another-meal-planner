# Proposal — dedupe-night-vibe-suggestions

## Why

Issue #226 ("Redundant meal vibe suggestions"): the member app's Profile → Night vibes →
"Suggest from your cooking" queue fills with near-identical `add_vibe` proposals. A read-only
production spike (2026-07-08, see design.md) found **48 pending `add_vibe` proposals** across
the two members — casey 12, everett 36 — dominated by paraphrase families like everett's six
chicken stir-fries ("A quick chicken stir-fry", "A hearty…", "A quick American…", "A crispy…",
"A mild…", "A light Mediterranean chicken stir-fry") and casey's four seafood dinners, several
of which duplicate a vibe **already in the palette** or one the member **already rejected**.

Grounding against the code + production data corrected the ratified premise in one important
way and confirmed the gaps:

- **Every production `add_vibe` proposal came from the COLD-START path, which has no semantic
  dedup at all.** Both members' taste-spaces are below `MIN_TASTE_ITEMS = 4` (casey: 2 favorites
  + 1 cooked; everett: 2 cooked), so every ~20 h `archetype-derive` run falls back to
  `starterVibesFromTaste` — and that branch never sees `dedupeClusters` (the cosine-0.85 palette
  dedup guards **only** the clusters branch, `night-vibe-derive.ts:233`). Its only guard is the
  exact-slug skip at enqueue (`night-vibe-suggest.ts:91`). Every proposal row's evidence is
  `{ member_slugs: [], size: 0 }`.
- **The namer is nondeterministic over unchanged input.** Each run re-derives the same taste
  text, phrases it slightly differently, the new phrase slugifies to a new id, and the stable
  `(kind, target)` hash (`reconcile-db.ts:17-23`) — which is exactly right for *identical*
  re-drafts — inserts a genuinely new row. ~3–4 new near-duplicates per member per day.
- **No path dedups against pending or rejected proposals, or within a run beyond distinct
  slugs.** Production shows a pending "A fiery seafood skillet" at cosine **0.945** to the
  rejected "A spicy seafood skillet", and the run that fired *during this spike* (21:57 UTC,
  hours after casey confirmed their 7-vibe palette) enqueued "A comforting Southern pot pie" at
  cosine **0.888** to the palette's "A comforting Southern meal".
- **The 0.85 threshold is right — in phrase space.** Pairwise cosines over the real rows
  (`@cf/baai/bge-base-en-v1.5`, the system's own embedding model): genuinely-distinct palette
  vibes top out at **0.7575**; every same-member pair ≥ **0.85** is a true near-duplicate; the
  first clear false-positive sits at **0.829** ("A mild Thai curry bowl" vs "A mild fish taco
  bowl"). 0.85 has margin on both sides.

The fix must also **converge the existing pile organically** (pipeline self-healing, never
manual data surgery): the 48 observed pending rows are this change's acceptance fixture.

## What Changes

- **Phrase-space dedup for every candidate, every source.** After naming (clusters) or
  generation (cold start), each candidate's **vibe phrase embedding** is compared — at the
  shared threshold 0.85 — against the member's palette phrase vectors (`night_vibe_derived`,
  already phrase embeddings; any just-confirmed vibe missing its derived row is embedded in the
  same batch), all **pending** `add_vibe` proposal phrases, all **rejected** `add_vibe` proposal
  phrases, and the candidates already kept in the same run. Matches are dropped before enqueue.
  All embeds ride the existing content-addressed KV cache (`embedTextsCached`) in **one batched
  call**, so repeat runs re-embed nothing. The centroid-vs-palette pre-filter in the clusters
  branch stays (it prunes before spending naming calls).
- **A queue-convergence sweep in `runDerivation`.** Before enqueueing, each derivation run
  (tool, app trigger, and the scheduled pass — one core) collapses the member's existing pending
  `add_vibe` near-duplicates: a pending proposal within 0.85 of a **palette** vibe, of a
  **rejected** proposal, or of an **earlier pending representative** is marked with the new
  status **`superseded`** (`resolved_at` stamped). The representative of a pending group is the
  **earliest-created** proposal (tiebreak: lowest id) — deterministic, so repeat runs converge
  to the same survivor. Member-dismissed proposals stay dismissed: `rejected` rows are never
  touched, and `superseded` is a distinct system-resolved status, never conflated with a member
  action.
- **Cold start is gated on an empty palette.** Its spec'd purpose is seeding a palette before
  history exists; production shows it re-running daily against a confirmed 7-vibe palette. With
  a non-empty palette and too little history to cluster, derivation now proposes nothing
  (`source: "none"`) and spends no model call.
- **`superseded` joins the proposal status vocabulary** (`pending | accepted | rejected |
  superseded`). No migration — the column has no CHECK constraint. Member-facing reads already
  filter to `pending`, so superseded rows leave the app queue and `list_proposals` naturally;
  confirming a superseded id answers the existing structured `conflict`.
- **`DerivationResult` gains `superseded`** (count), surfaced through `suggest_night_vibes` and
  `POST /api/vibes/suggest` (additive; the SPA's typed client absorbs it) and folded into the
  `archetype-derive` job-health summary.
- **Docs in lockstep:** `docs/TOOLS.md` (`suggest_night_vibes` dedup guarantee + return shape),
  `docs/SCHEMAS.md` (`pending_proposals.status`), `docs/ARCHITECTURE.md` (the archetype-derive
  paragraph's dedup description — including retiring its "chronically-rejected archetype is
  re-named each run" residual, which this change closes).

## Capabilities

### Modified Capabilities

- **`night-vibe-archetype-derivation`** — the dedup requirement widens from "against the
  existing palette" (centroid space, clusters only) to phrase-space dedup against palette +
  pending + rejected + within-run for every candidate source; the cold-start requirement gains
  the empty-palette gate; a new requirement makes each derivation run converge existing pending
  near-duplicates to one representative.
- **`profile-reconciliation`** — the pending-proposals queue requirement gains the
  `superseded` status: system-resolved (only ever set by the convergence sweep on pending
  rows), excluded from member-facing pending reads, answered as `conflict` on confirm, and
  explicitly distinct from `rejected` (member dismissals are never re-written or re-surfaced).

## Impact

- `packages/worker/src/night-vibe-dedupe.ts` (new, pure) + `test/night-vibe-dedupe.test.ts`
- `packages/worker/src/night-vibe-suggest.ts` (wire sweep + dedup + cold-start gate into
  `runDerivation`; `DerivationResult.superseded`)
- `packages/worker/src/reconcile-db.ts` (status union + `supersedeProposals`)
- `packages/worker/test/reconcile.test.ts`, `test/api-member.test.ts` (touched shapes)
- `docs/TOOLS.md`, `docs/SCHEMAS.md`, `docs/ARCHITECTURE.md`
- No migration, no UI change, no new route, no wrangler change.
- **Acceptance fixture:** the production rows enumerated in design.md converge on the first
  post-deploy derivation run — verified by re-running the spike's invariant query (no
  same-tenant pending `add_vibe` pair at cosine ≥ 0.85, none ≥ 0.85 to a palette or rejected
  phrase).
