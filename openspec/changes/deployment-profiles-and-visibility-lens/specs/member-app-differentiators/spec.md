## MODIFIED Requirements

### Requirement: Group-wide trending row with a minimum-signal guard

The system SHALL provide `GET /api/cookbook/trending` (session-gated, ETagged): a `cooking_log` aggregation over a trailing window (default 60 days), read through the caller's visibility lens with a **profile-parameterized minimum-signal guard** — ONE trending implementation for both deployment profiles, exposing per-recipe counts only (`cooks`, distinct-cook count, last cooked date) and never which member or household cooked what.

- **Aggregation set**: under the self-hosted profile, all households (the friend lens over the implicit all-to-all graph — deployment-wide, today's read); under SaaS, the caller's household plus its friend households (the lens's friend-relation seam — empty until the friendships table ships), with results restricted to recipes inside the caller's lens.
- **Guard**: under self-hosted, a recipe qualifies with at least 2 cooks OR at least 2 distinct cooking tenants in the window — the existing guard **verbatim**, preserving the solo-operator degenerate case; under SaaS, a recipe qualifies only when its contributing set spans at least 2 distinct households besides the caller's own — never "cooked by 1 friend". The stricter SaaS guard SHALL NOT be applied deployment-wide under self-hosted. Below the guard the trending set SHALL be empty rather than ranking single cooks.

Results SHALL be joined to the projected recipe index (unprojected slugs dropped), filtered by the caller's overlay rejects, restricted to **meal candidates** — recipes whose effective `course` includes `main` or is empty (fail-open for a not-yet-classified recipe) — and deterministically ordered (cooks, then distinct cooks, then recency, then slug). The browse page SHALL consume this read through the promoted "Recommended for you" panel with profile-conditioned presentation: under self-hosted the existing "Trending" reason and counts chip stand unchanged (deployment-wide trending IS the friend lens there — no relabel); under SaaS the reason renders as "Popular with Friends" and the counts chip carries household-counted copy ("cooked by N friend households"). No trending badge or chip is fabricated when the trending set is empty.

#### Scenario: Sparse production history yields an empty trending set

- **WHEN** the log holds only single-cook entries on a self-hosted deployment (e.g. two recipes, one cook each)
- **THEN** the trending set is empty and the browse page renders no "Trending" promotion and no counts chip

#### Scenario: Self-hosted trending is unchanged

- **WHEN** a recipe logs 3 cooks across 2 tenants within the window on a self-hosted deployment
- **THEN** it appears in the trending set with `cooks: 3` and a distinct-cook count of 2 under the existing "Trending" presentation, with no member identities exposed — byte-for-byte today's behavior

#### Scenario: The SaaS guard never identifies a single friend household

- **WHEN** a SaaS caller has one friend household and that household cooked a shared recipe three times in the window
- **THEN** the trending set is empty for the caller — provenance may still say the household shares recipes, but no cook signal renders, and "cooked by 1 friend" never appears

#### Scenario: A qualifying SaaS signal renders household-counted copy

- **WHEN** a SaaS caller's friend seam yields two friend households that both cooked a lens-visible recipe in the window
- **THEN** the recipe appears with the "Popular with Friends" reason and a chip counting friend households, never naming them or their members

#### Scenario: A rejected recipe never trends for that member

- **WHEN** a recipe qualifies under the guard but the caller has marked it rejected
- **THEN** it is absent from that caller's trending response

#### Scenario: A repeat-cooked non-main never trends

- **WHEN** a recipe whose effective `course` does not contain `main` and is non-empty logs 2+ cooks within the window
- **THEN** it is absent from the trending set, while a recipe with an empty (not-yet-classified) `course` that clears the guard still qualifies

### Requirement: Picked-for-you is a deterministic favorites-centroid ranking with zero AI calls

The system SHALL provide `GET /api/cookbook/picked-for-you` (session-gated, ETagged): a thin wrap of the existing `rankCandidates` ranking using the normalized centroid of the caller's stored favorite embeddings as the query vector — stored cron-captured vectors only, no Workers AI or frontier-model call at request time. Candidates SHALL be drawn from the caller's lens-visible corpus (the shared enforcement point) and SHALL exclude the caller's favorites, rejects, recipes conflicting with the profile's dietary avoids (the same gate the propose pool applies), and recipes that are not **meal candidates** — those whose effective `course` is non-empty and does not include `main` (fail-open for an empty, not-yet-classified `course`). With no favorites the result SHALL be empty — no backfill from the general index — and the promoted panel SHALL simply omit the "Picked for You" reason rather than inventing generic picks. The optional nudge parameters `rankCandidates` carries for the propose flow SHALL be absent on this call path.

#### Scenario: No favorites means no picked promotion

- **WHEN** the caller has no favorite recipes
- **THEN** the endpoint returns an empty list and the promoted panel renders without a "Picked for You" row — never generic picks

#### Scenario: An out-of-lens recipe is never picked

- **WHEN** the embedded index contains a recipe near the SaaS caller's favorites centroid that is held only by a non-friend household
- **THEN** it is absent from the picked-for-you response

#### Scenario: Ranking touches no model at request time

- **WHEN** picked-for-you is computed
- **THEN** no `env.AI` call occurs — the query vector is a centroid of stored favorite embeddings and ranking runs over stored recipe vectors

#### Scenario: Favorites and rejects never appear as picks

- **WHEN** the caller favorites one recipe and rejects another
- **THEN** neither appears in the picked-for-you response

### Requirement: The promoted panel repackages the differentiator signals as reason badges

The browse page SHALL render one visually distinct promoted panel captioned "Recommended for you", each row an ordinary recipe row plus an uppercase **reason badge** naming why it is promoted. The badge vocabulary SHALL be exactly: **"Just Added"** (the new-for-me watermark read — discovery-attribution-based, per-member, unchanged by visibility events), the cook-signal reason — **"Trending"** under the self-hosted profile, **"Popular with Friends"** under SaaS (both the profile-parameterized guarded trending read; one signal, profile-conditioned label) — and **"Picked for You"** (the favorites-centroid read). Recipes newly visible through a friend link surface via the cook-signal reason or browse provenance, never as "Just Added"; the curated set's landing carries no member matches, so it can never flood "Just Added".

Panel composition SHALL be a pure per-render derivation over those three session reads — no new endpoint, no persistence, no pinning, and no dismissal state: at most **one row per signal** — each signal's **top-ranked** row — in the fixed precedence Just Added → cook signal → Picked for You. A top row already promoted by a higher-precedence signal contributes nothing (deduplicated, not re-badged), and a top row failing the active global filters is dropped, never replaced by a deeper-ranked candidate — the panel never misrepresents a signal's actual top recommendation. An empty signal likewise contributes nothing — partial panels are fine and no reason is ever backfilled from another signal or the general index. Displayed promoted slugs SHALL be deduplicated out of the organic list below. The panel SHALL hide entirely in search mode, in the favorites view mode, in the cookbook cold-start states, and when zero promoted rows survive the filters.

Honest trend chips SHALL be preserved: a listed row (promoted or organic) that appears in the guarded trending read carries the counts chip with profile-conditioned copy (existing copy under self-hosted; household-counted under SaaS); no trending badge or chip is fabricated when the trending set is empty.

#### Scenario: Reason badges ride real signals only

- **WHEN** the trending read returns a qualifying recipe and the caller has favorites (a non-empty picked-for-you) but nothing is new-for-me
- **THEN** the panel renders a cook-signal row (labeled per the deployment profile) and a "Picked for You" row, and no "Just Added" row

#### Scenario: Promoted rows dedupe out of the organic list

- **WHEN** a recipe is displayed in the promoted panel
- **THEN** it does not appear again in the organic list below, and a slug qualifying for two signals appears once, badged with the higher-precedence reason

#### Scenario: The panel respects filters and hides when empty

- **WHEN** the active filters exclude every promoted candidate, or the page is in search mode, the favorites view, or a cold-start state
- **THEN** the promoted panel is absent entirely — no empty panel shell

#### Scenario: A friend-visible recipe is never "Just Added"

- **WHEN** a recipe becomes newly visible to a SaaS caller through a friend link without a discovery match for that caller
- **THEN** it never carries the "Just Added" badge — it may surface via the cook-signal reason or ordinary browse provenance
