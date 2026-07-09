## Context

`yamp` has two meal-planning engines that share only their middle. **Subsystem A** is the agent's `meal-plan` skill (`menu-generation`): Claude distills the request into `search_recipes` specs, retrieves, and **hand-composes** the week (`Full proposal assembly`, `Distill … then compose`). **Subsystem B** is `propose_meal_plan` / the web app's `/propose` (`meal-plan-proposal`, `weather-bucket-planning`, `planning-cadence`): a deterministic palette planner — cadence-debt × weather-bucket quotas shape the week (`sampleWeek`), the shared `rankCandidates` ranks each slot, and an MMR + facet-spread pass composes it. They share the per-slot ranker; they diverge at **week-shaping** and **composition**. Only subsystem B touches the night-vibe palette.

The divergence lands exactly where the LLM is weak: composition is *selection over a long candidate set*, and frontier models exhibit positional bias ("lost in the middle") — they pick from the beginnings and ends of long lists. MMR does not. So subsystem B's deterministic composition is *better* at the spread-selection job, while subsystem A's LLM is better at *interpreting intent into vibe specs*. Neither engine is the answer; the hybrid is — and the operator built a good deterministic engine that the agent never uses.

Three constraints frame the design:

- **Positional bias → allocation.** Deterministic tools own selection/traversal over long sets (ranking, MMR, graph walks, cadence arithmetic — unbiased, complete, reproducible). The LLM owns judgment at the edges (intent → constraints, cold-start world knowledge, narrowing a short candidate set, authoring qualifiers).
- **Amortization flywheel.** The frontier model's expensive judgment is captured once into deterministic artifacts (named vibes, classified facets, observed substitution edges) that the model-free web app and token-constrained Free members consume for nothing. "Amortize the LLM's work over time" is the project's throughline; this change extends it to composition, cadence, and substitution.
- **Free/Pro is the member's own Claude tier, not a yamp entitlement.** There is no tiering in the codebase and this change adds none. The design is **progressive enhancement around a deterministic floor**: the core loop completes with no frontier turn (Free / web app / offline); the model enriches (intent, cold-start, qualifiers) when available.

## Goals / Non-Goals

**Goals**

- Make `propose_meal_plan` the single planning engine both surfaces drive; retire the agent's hand-compose path while preserving Claude's freedom to author vibes.
- Give new-for-me discoveries a first-class slot claim on *both* surfaces from the shared engine.
- Make cadence a revealed-preference signal computed at cook time, independent of plan provenance.
- Fold the palette + cadence into the profile as the revealed-preference pillar.
- Un-defer the substitution graph as capture-first taste-substitution edges that keep the *decision* at read-time LLM.
- Ship a propose widget so the agent surface gets the web app's dials, with model-free iteration.

**Non-Goals**

- No new frontier-model dependency on the hot path; no yamp-side Free/Pro entitlement or paywall.
- No depth-2+ graph traversal, no `satisfies()` closure engine, no automated small-model *invention* of substitution edges (edges are *observed*, then optionally qualified).
- No change to the Kroger matcher's resolve-only contract, the `search_recipes` two-mode contract, or the reject/makeability/diet hard gates.

## Decisions

### D1 — One engine: Claude authors vibes, MMR composes

The convergence moves exactly one step across the determinism boundary — **composition** — and leaves vibe-authoring where it is. Today Claude authors `search_recipes` specs `{ vibe, facets }` (intent → cosine lens). A vibe and a spec are the *same primitive*, so Claude keeps authoring; instead of `search_recipes(specs)` → Claude hand-picks → `update_meal_plan`, the flow becomes: Claude authors an ephemeral vibe set → `propose_meal_plan` composes via its existing MMR / facet-spread pass (`Diversified selection, not top-K`) → the proposal is presented (widget) → `update_meal_plan` persists. The only thing that changes hands is the long-list selection an LLM does poorly.

**Why:** MMR is a complete, unbiased, seed-deterministic spread over the whole candidate set; the LLM is none of those and is subject to positional bias. Determinism is also what makes the widget's client-side replay (and the stateless iteration loop) work.

**Alternative considered — keep both engines (add widget, keep hand-compose as a premium path):** rejected. It leaves the palette web-app-only, keeps the agent worse at composition, and doubles the surface to maintain. The operator's explicit call is the strong version.

### D2 — The vibe is one primitive; palette = persisted, Claude's = ephemeral; a spectrum, not two modes

`propose_meal_plan` gains a Claude-authored **ephemeral vibe set** input (an ordered set of `{ vibe, facets }`, no cadence history). When present, it shapes the week for that request; when absent, `sampleWeek` schedules from the saved palette by cadence-debt as today. This is a spectrum: *low intent* ("plan my week" — Free / web app / zero-conversation) → palette-scheduled; *rich intent* ("lazy comfort week, something Mediterranean midweek") → Claude-authored. Same op, same MMR, same widget. The `slots[].vibe` override already replaces a single slot's query vector; the ephemeral set generalizes that to the whole week without bypassing the facet gate or the diversify pass.

> Implementation note (D2): the ephemeral set enters the same embedding batch the tool already builds for `nudges.freeform` + `slots[].vibe` (`Off-hot-path composition and legibility` allows at most one embedding call; a set of authored phrases is that one batched call). A request that supplies neither palette-override text nor an ephemeral set still makes no AI call.

### D3 — New-for-me is a force-placement tier, wired through both surfaces

`propose_meal_plan` already accepts `list_new_for_me` discovery seeds as soft-priority inputs (`Stateless iteration and re-roll`). Two gaps close: (a) both surfaces actually pass them (the agent via the skill, the web app via `/propose` — today only the agent's retired hand-compose folded them in, `New-for-me discoveries seed the plan from a read`); (b) `sampleWeek` gains an explicit **new-for-me force-placement tier** in the precedence order — after pinned, before/among overdue — so an accepted discovery claims a slot within its weather-bucket quota rather than competing purely on cadence weight. Fixing it in the shared engine fixes it for both surfaces at once — the general pattern of this convergence.

> Implementation note (D3): the precedence in `planning-cadence` (`Repeatability sampling stays deterministic and precedence-preserving`) becomes pinned → new-for-me → overdue → weighted pool, still seed-deterministic; `weather-bucket-planning`'s force-placement (`Force-placement respects bucket quotas`) admits the new-for-me tier under the same "respect bucket quotas, never produce a mismatch or an empty slot" rule.

### D4 — Cadence is revealed at cook time, superseding plan-time provenance

`log_cooked` computes `satisfied_vibe` by cosine-matching the **actual cooked recipe** against the palette (the inverse of `rankCandidates` — recipes and vibes are both embedded, in `recipe_derived` / `night_vibe_derived`), unioned with the planned row's `from_vibe` as a **guaranteed-reset prior** (an explicitly-aimed vibe always resets, even at borderline cosine). A cook MAY satisfy more than one vibe; each match at or above a calibrated threshold gets a satisfaction record, and `last_satisfied` derivation reads those records. This **decouples cadence from how the plan was made**: a Claude-authored ephemeral week (D2), an off-plan Tuesday cook, or a palette-scheduled slot all reset the rhythm correctly.

This directly overturns `night-vibe-palette` → `Satisfaction is slot provenance`, which forbids "fuzzy embedding attribution **at plan time**" and pushes the off-plan blind spot to `profile-reconciliation`. The reversal is defensible on the distinction that requirement did not draw: this is attribution **at cook time on a concrete recipe** (revealed behavior), not at plan time on a guess (speculation). It is the thing that makes D1/D2's authoring freedom compatible with a coherent cadence — without it, free authoring silently breaks the rhythm.

**Why it resolves the earlier tension:** with provenance-only attribution, a Claude-authored ephemeral vibe has no palette id, so cooking it satisfies nothing and the clock keeps ticking wrong. Cook-time cosine needs no id — it reads the cooked recipe against the palette.

Three tuning decisions, all following the repo's "calibrate the cosine band on the first production hours" precedent (`NORMALIZE_CONFIRM_MIN = 0.72`):

- **Threshold** — ship a default, calibrate against real cook logs (a planning spike where `CLOUDFLARE_API_TOKEN` is present).
- **`from_vibe`'s fate** — kept as the guaranteed-reset prior; the cosine pass generalizes to everything else the cook genuinely matched. `meal-planning` → `Slot provenance on planned rows` keeps the field; only downstream cook-time behavior changes.
- **Over-reset guard** — a high threshold; full reset for the top match, gated resets for others, so one lucky dish cannot suppress the whole palette next week.

> Implementation note (D4): `last_satisfied` stays a **derived query**, never stored on the vibe — the cook→vibe satisfaction record (a small table keyed by cooking-log row × vibe × score) preserves that and supports multi-vibe `MAX(date)` cheaply. This narrows `profile-reconciliation`'s off-plan mandate (D10) rather than deleting it.

### D5 — The palette is the profile's revealed-preference pillar

`read_user_profile` includes the night-vibe palette and each vibe's cadence status (due / overdue / soon / ok — the `statusOf` the web app already computes), and the empty-palette case joins the `profile_status` `missing[]` mapping (`data-read-tools`). The palette is legitimately profile data (`night-vibe-palette`: "per-tenant private profile data, a D1 table sibling to `staples`/`stockup`").

**Why:** the profile is otherwise almost entirely *stated* (`taste` and `diet_principles` narratives, `preferences` scalars — what the member wrote down). The palette + cadence is a *stated scaffold continuously corrected by revealed behavior*: `suggest_night_vibes` derives vibe shapes from favorites + cook history; D4's cook-time cosine tracks how often each is actually satisfied. It captures revealed preference in a way the stated fields structurally cannot. Folding it into the read Claude already makes at session start gives it the rhythm as the *basis* for shaping vibes on a bare "plan me a meal" — a prior, not a cage ("doesn't have to confine to them"). This is also the Free-tier win: a bare request yields a genuinely personalized week from palette + cadence with zero frontier reasoning, because the expensive part was amortized.

### D6 — Capture-first taste-substitution edges: born from observation, qualified later

A new `substitution` edge kind on the identity graph. The **capture rule is deterministic set logic against the existing graph**: when a purchasable swap replaces a recipe's ingredient X with a product resolving (via the normalization pipeline that already runs) to a canonical id Y, and Y is **not already an identity neighbor** of X (not a synonym / containment / membership sibling), record a candidate `substitution` edge X → Y. Edges accrue weight on repeated observation (candidate → promoted, mirroring the `NORMALIZE_CONFIRM` band machinery); a qualifier (a ratio like `1:2`, a leavening/cook-time caveat) is authored **later** — by a model when it is good enough, or left blank and still useful as a bare weighted edge.

**Why this honors the operator's skepticism about the small models:** detection needs *no* model — the graph knows every canonical id, so "different SKU, same ingredient" (a price swap, not an edge) is distinguished from "different ingredient entirely" (a sub candidate) by set logic alone. The model never *invents* substitution knowledge; it records what a member actually did and annotates it later. The frontier model's world-knowledge suggestion happens at read time in a Pro session; when acted on, the backend captures the edge; every later retrieval — including Free members and the web app — gets it for nothing. This is the flywheel applied to substitution.

> Implementation note (D6): the leading capture signal is the `place_order` override path (`member-app-differentiators` → `Acting on a suggestion reuses existing writes only`) extended to fire when the override's replacement crosses a canonical-id boundary. The cook log is a complementary future source (a "what did you actually use" field) — out of scope here.

### D7 — Substitution edges are a separate kind, not `satisfies()`-reachable

A `substitution` edge is semantically *not* a satisfies edge. `satisfies(have, want)` (`ingredient-normalization` → `Directed satisfaction edges and concept nodes`) means "having A satisfies a request for B" — identity, containment, membership. A substitution is a *taste judgment* ("A can stand in for B, with caveats"). Mixing them would let the resolve-only matcher silently treat a substitute as the thing itself. So `substitution` edges are **excluded from `satisfies()` reachability**: they never gate a match, never cause a purchase, and surface only as **labeled read-time suggestions** via the depth-1 walk (`member-app-differentiators`). This keeps identity ≠ substitution and keeps the *decision* at read-time LLM — the ADR-0001 principle survives; the graph is capture substrate + deterministic retrieval, not a decision engine.

### D8 — The propose widget: reuse the ext-apps pattern, iterate model-free

A new `meal-plan-widget` capability mirroring `recipe-card-widget`'s five requirements for a proposal: a tool result carrying `_meta.ui.resourceUri` → `ui://plan/propose`, a `structuredContent` payload (a shared `@yamp/contract` type = the `propose_meal_plan` result), and a text `content` fallback; the resource served over `resources/read` with the `text/html;profile=mcp-app` MIME and no new HTTP route; the bundle self-contained via `packages/widgets` reusing `packages/ui`; `_meta.ui.resourceUri` returned **unconditionally** (the capability probe is unreliable). The widget's dials (nights / variety / lock / swap / exclude / per-slot vibe) re-invoke the *stateless* propose op on interaction, so refinement costs **no** frontier turn — the single biggest Free-tier UX lever, and it falls out of the determinism already present.

**Open question (D8):** the exact callback mechanism for widget-initiated iteration (an MCP tool re-invocation via the ext-apps `App` client vs a direct `/api/propose` call) must be validated against the pinned ext-apps SDK. The text `content` fallback (a fully-rendered proposal) is the floor if interactive callbacks are unavailable on a host.

### D9 — Progressive enhancement around a deterministic floor (Free/Pro)

No yamp entitlement is introduced. The Free/Pro axis is the member's own Claude tier. The design holds one invariant: **the core loop never requires a frontier turn.** Cold-start (a novel substitution with no edge; a novel intent with no palette match) degrades to the deterministic walk / palette default for Free and to world knowledge for Pro — but completes either way. Free members ride the amortized knowledgebase (named vibes, facets, edges) built by Pro sessions and the operator, and iterate on the widget without spending model turns. Pro throws the frontier model's weight at intent interpretation, cold-start, and qualifier authoring.

### D10 — What survives `menu-generation`, what is retired

Surviving (Claude's intent work): `Menu-request context pre-pass` (the parallel context batch), `Distill context into searches` (now: distill into the ephemeral vibe set, D2), `Discoveries are dispositioned conversationally`, the narration of waste / meal-prep / variety tradeoffs / sale-steering. Retired/redirected (composition): `Full proposal assembly` and the "then compose" half of `Distill … then compose` and `Recall is engineered into the search set` — the engine now composes. The `meal-plan` skill in `AGENT_INSTRUCTIONS.md` is rewritten to drive `propose_meal_plan` + the palette; the plugin bundle regenerates.

## Risks / Trade-offs

- **[Cook-time cosine mis-attributes]** → a high, production-calibrated threshold plus the `from_vibe` guaranteed-reset prior; wrong resets are self-correcting (the next cook re-derives `MAX(date)`), and `profile-reconciliation` remains the backstop for systematic drift.
- **[Retiring hand-compose regresses "holistic plate composition"]** → MMR + facet-spread + `pairs_with` sides + holistic use-it-up already implement plate composition deterministically (`Deterministic plate composition`); the operator's read is that this is functionally today's semantic search. Acceptance verifies parity on a fixture week.
- **[Ephemeral vibe set balloons the propose input]** → it reuses the existing single batched embedding call and the `slots[]` override semantics; no new AI call class.
- **[Substitution edges pollute identity]** → D7's hard exclusion from `satisfies()`; edges are open-world hints that degrade to world knowledge, never a gate (consistent with `Directed satisfaction edges` and ADR-0001 decision #1).
- **[Widget callback unsupported on some hosts]** → D8's unconditional text fallback renders a complete proposal; interactivity degrades, the plan does not.

## Migration Plan

Staggered, serial on shared surfaces (`propose` / `scheduled()` / the graph), per the repo's working mode:

1. `data-read-tools` — palette + cadence in `read_user_profile` (smallest; unblocks Claude's basis).
2. `cooking-history` / `night-vibe-palette` — cook-time cosine attribution (decouples authoring from rhythm).
3. `meal-plan-proposal` / `weather-bucket-planning` / `planning-cadence` / `menu-generation` — engine convergence + new-for-me + the skill rewrite (the big one; depends on 1–2).
4. `meal-plan-widget` — the propose widget (renders step 3 in-conversation).
5. `ingredient-normalization` / `member-app-differentiators` + the ADR-0001 amendment — substitution capture (independent; plan/implement in parallel).

## Out of scope (explicit)

Depth-2+ graph walks, edge-weight *learning* beyond observation counting, a `satisfies()` closure engine, small-model *invention* of substitution edges, a cook-log "what did you actually use" capture field, and any yamp-side Free/Pro entitlement. The keyword-only cookbook search box (`cookbook-search`) staying divergent from the agent's boosted `search_recipes` is left as a separate, smaller concern.

## ADR-0001 amendment (to append to `docs/adr/0001-determinism-boundary-capture-retrieve-narrow.md` on apply)

The following amendment is captured here and appended verbatim to the living ADR when this change is implemented (task 6.x). It mirrors the format of the existing `2026-07-01` amendment — append-only H2, front-matter and `**Status:**` untouched.

---

```markdown
## Amendment — 2026-07-09: the substitution graph un-defers, capture-first (converge-meal-planning-surfaces)

The deferred "ingredient knowledge graph" — specifically the **substitution** half the `2026-07-01` amendment held back ("Taste-substitution stays read-time LLM") — is now **partially un-deferred**, on the concrete trigger this ADR named: demonstrated substitution knowledge that read-time reasoning re-derives from scratch every session and cannot share across members or reach the model-free web app. Scope stays narrow and consistent with the decisions above:

- **Capture-first, not model-authored.** An edge is born from a *deterministic backend observation* — a purchasable swap whose replacement resolves to a different canonical id that is not already an identity neighbor of the wanted ingredient (pure set logic against the graph, no classifier). It accrues weight on repeated observation; a qualifier is authored *later*, by a model when good enough, or left blank. The layer grows organically, like the identity layer the prior amendment kept — no curated table, no maintenance burden.
- **The decision still routes through read-time LLM.** Substitution edges are a distinct kind, **excluded from `satisfies()` reachability**: they never gate a match or cause a purchase, and surface only as labeled read-time suggestions the LLM (or the member) narrows. The graph is capture substrate + deterministic retrieval, not a decision engine — so the substitution *judgment* still rides model improvements at read time, answering the "freezes at the capturing model's competence" cost the same way the `2026-07-01` amendment did for its volatile part.
- **Open-world (decision #1) holds:** a missing edge degrades to world knowledge; the walk proposes and names the relation, fitness judgment stays with the narrower.
- **`capture → retrieve → narrow`, exactly.** The frontier model's world-knowledge substitution (a Pro session) is captured once on acceptance, retrieved by a deterministic depth-1 walk that serves the web app and Free members with no model call, and narrowed at read time — amortizing the model's judgment across every later reader.

The pre-decided design points from "Considered and deferred" are honored: granular nodes joined by edges (not collapsed), the **strong-sub / weak-sub edge-strength spectrum** realized as accrued observation weight, and **edges carry qualifiers** (a sub ratio like `1:2`, a leavening/cook-time caveat) authored on promotion. Depth-2+ traversal, a `satisfies()` closure, and edge-weight *learning* beyond observation counting remain out of scope. The realized shape is in `openspec/changes/archive/…/converge-meal-planning-surfaces/` and the *ingredient-normalization capture* section of `docs/ARCHITECTURE.md`.
```
