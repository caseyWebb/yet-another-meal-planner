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
  the backend model already — this is UI) plus the existing Private checkbox. Mock
  auto-assigns tag `private` when Private is checked with no tag — treat as mock artifact
  unless wanted. Own notes ("you", newest first); "From other members" read-only with
  author handle + tag chips — visibility scoped per story 01 tiers. **Mock has no
  edit/delete on notes; today's app does — keep edit/delete (regression otherwise).**
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
timer hints `@{n}s`, `**Title:**` step leads, and an `ingredientKeys` map. Who produces
these — authoring conventions, the facet-derivation cron, or render-time parsing — is a
proposal decision; `docs/SCHEMAS.md` needs the annotation spec in the same pass. Location
grouping likewise: client heuristic (mock) vs derived data.

**MCP App host (story 06)**: log-cooked, favorite, and cook-completion must send context
updates to the agent; the guided-cook spec already owns the conversational flow — the
widget is its visual companion, not a replacement.

## 4. Delta vs today

| Feature | Status |
|---|---|
| Breadcrumb/favorite/deep-link/similar/notes | exists |
| Source link line, "In meal plan" disabled state, two-tier body nudge | tweaks |
| Note tag field UI | **new UI** (model exists) |
| Log-cooked date popover | **new** (adopt from widget) |
| Guided cook mode, voice mode, timers, mise en place | **new** (widget; `guided-cook` spec covers the agent flow) |
| Body annotations + ingredientKeys | **new contract** |
| Copy/Print | new (widget) |

## 5. Open questions

1. Detail plan action: disabled state (mock) vs toggle vs "view in plan" link?
2. Note tags: free text vs vocab; shown on shared notes (mock: yes)?
3. Body annotations: producer + fallback for unannotated recipes (widget must degrade to
   plain steps — mock's parser already does).
4. Voice mode scope: real speech synthesis/recognition in the widget, or hand-off to the
   agent conversation (recommend the latter first)?
5. Where does the widget's "Log cooked" write in each host (log_cooked tool vs /api) —
   story 06 rule applies.
