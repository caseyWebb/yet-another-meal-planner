# Page 02 — Recipe detail (+ Recipe Card widget)

Screens: `screens/recipe-detail.png`, `screens/widget-recipe-card.png`.
Stories: 01 (note visibility), 02 (plan default), 06 (Recipe Card as MCP App).

## 1. Design summary

Detail page keeps today's shape (breadcrumb, title + favorite, facets, actions, body,
notes, similar) with refinements. The Recipe Card **widget** is the richer surface —
guided cooking, timers, mise en place — and per story 06 it's dual-use (member app +
MCP App via `display_recipe` / guided-cook).

## 2. Functional requirements — detail page

- **Meta**: facet chips (protein, cuisine); clock + "{n} min" only when detail-level time
  exists; **source line** "Source: {url}" as a visible external link.
- **Actions**: "Cook with Claude" primary (deep link `/cook {slug}` via claude.ai/new —
  unchanged); **"Add to meal plan" → disabled "In meal plan"** state once planned
  (add-only from detail; removal happens on plan page — confirm vs toggle, open q);
  "Log as cooked" (mock is a stub — adopt the Recipe Card widget's model: popover with
  date picker capped at today + confirmation line).
- **Two-tier body**: full Ingredients/Method when the corpus body exists; otherwise
  description + nudge "Cook with Claude to walk through the full ingredient list and
  method step by step."
- **Notes**: composer gains a **free-text tag field** (chips render on notes; tags are in
  the backend model already — this is UI). The mock's Private checkbox is replaced by a
  **three-state tier control** `public | friends | private` showing the effective
  default (`friends`) at authoring time (D30 — no household tier; household members are
  inside the friends tier by definition). `public` is bounded by the recipe's own lens:
  a note never renders where its recipe isn't visible, and appears on the anonymous
  /cookbook surface only where the recipe itself is anonymously visible; `private` =
  author-only. Migration: private flag → private, non-private → friends. The mock's
  auto-assigned `private` tag is a mock artifact — drop it. Own notes ("you", newest
  first); "From other members" read-only with author handle + tag chips — visibility
  scoped per the D30 tiers. **Mock has no edit/delete on notes; today's app does — keep
  edit/delete (regression otherwise).**
- **Similar recipes**: unchanged (cosine path); mock's protein-OR-cuisine fallback is mock
  logic, not the spec.

## 3. Functional requirements — Recipe Card widget

Browse mode: title/description/facets (protein, cuisine, course[], dietary[], tags[],
time); actions: **Start Cooking split button** (Guided Cooking / Hands-Free Voice Mode),
Copy (serialized recipe), Print, **Log cooked** (date popover, max today, confirmation
"Logged as cooked {date}"); **ingredients grouped by kitchen location** (Produce / Fridge
/ Freezer / Pantry / Spice drawer); instructions with **ingredient reference tooltips**
and parsed step titles; read-only notes.

Cook mode: optional **mise en place** phase (check-off by location, "k/n ready") → steps
(prev/next, per-step **countdown timers** from body hints or detected durations) → done
("Plated up", cook-again / back). Config props: accent, startInCookMode, miseEnPlace,
showTimers.

**Body-annotation contract (new)**: ingredient tokens `{key}` / `{key|surface text}`,
timer hints `@{n}s`, `**Title:**` step leads, and an `ingredientKeys` map. Producer
(decided — see §5): the body_hash-gated recipe-facet classify pass emits the annotations
artifact (ingredientKeys keyed to canonical ids, step titles, timer hints) into a
derived table; the card hydrates from the payload/API and degrades to its deterministic
client parser; authored in-body annotations stay as overrides; the grammar is documented
in `docs/SCHEMAS.md` in the same pass. Never render-time LLM.

**Location grouping**: the vocabulary is page 06's six kitchen locations (drop the
mock's "Produce"/"Spice drawer" copy); group by the household's actual pantry-row
location when one resolves (canonical-id join), else a deterministic
category→default-location map defined once beside the page 06 vocab.

**MCP App host (story 06, D32)**: log-cooked, favorite, and cook-completion must send
context updates to the agent via the MCP Apps bridge. The dual-use Recipe Card (cook
mode included) becomes the ONE conversation cooking card once body annotations land —
it supersedes guided-cook's `recipe_display_v0` dependency. The landing change, same
pass: (1) deltas recipe-card-widget's read-only requirement (its justification — no
structured step data — is obsoleted by the annotation contract); (2) deltas guided-cook
to emit `display_recipe`'s widget, keyed on the host rendering MCP Apps, keeping the
conversational pre-flight, the plain-text fallback, user-owned timers, and the
cooked-flow handoff; (3) reconciles the two structured-step paths into one step list
(the tool/skill supplies cook-mode structuredContent; annotation parsing is the
member-app/no-skill path). Until that change ships, guided-cook stays on
`recipe_display_v0` — no interim dual-card state.

## 4. Delta vs today

| Feature | Status |
|---|---|
| Breadcrumb/favorite/deep-link/similar/notes | exists |
| Source link line, "In meal plan" disabled state, two-tier body nudge | tweaks |
| Note tag field UI | **new UI** (model exists) |
| Log-cooked date popover | **new** (adopt from widget) |
| Guided cook mode, voice mode, timers, mise en place | **new** (widget; `guided-cook` needs a delta re-pointing its emit target — D32) |
| Body annotations + ingredientKeys | **new contract** |
| Copy/Print | new (widget) |

## 5. Open questions

1. Detail plan action: disabled state (mock) vs toggle vs "view in plan" link?
2. Note tags: free text vs vocab; shown on shared notes (mock: yes)?
3. ~~Body annotations: producer + fallback for unannotated recipes.~~ — decided (§3):
   the body_hash-gated classify pass produces the annotations artifact; the widget
   degrades to its deterministic client parser; authored annotations are overrides.
4. Voice mode scope: real speech synthesis/recognition in the widget, or hand-off to the
   agent conversation (recommend the latter first)?
5. Where does the widget's "Log cooked" write in each host (log_cooked tool vs /api) —
   story 06 rule applies.
