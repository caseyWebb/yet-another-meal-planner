## Context

The operator panel's Data area (`operator-data-explorer`) renders two pieces of authored corpus markdown as raw `<pre>` text:

- `admin/src/Data/Recipe.elm` → `viewSource` dumps the whole R2 `recipes/<slug>.md` (YAML frontmatter + body).
- `admin/src/Data/Corpus.elm` → `viewObject` dumps a `guidance/**` object.

The `/cookbook` surface already renders recipe bodies to HTML server-side: `src/cookbook.ts` holds a `marked` instance hardened for untrusted bodies (drops raw HTML, scheme-filters `href`/`src` to `http(s)`/root-relative/fragment), under a strict no-script CSP. That hardening exists because recipe and guidance bodies are member-/agent-authored — untrusted content.

The admin SPA is an Elm `Browser.application` gated by Cloudflare Access. `admin/elm.json` declares no markdown dependency. The recipe-detail endpoint already returns the raw `source`; the Elm side decodes it as `RecipeDetail.source : Maybe String`.

Constraint (`admin/CLAUDE.md`): model with the type system (impossible states impossible; derive, don't store); `admin/dist/` is generated and committed; the Elm compiler needs `package.elm-lang.org` reachable to build.

## Goals / Non-Goals

**Goals:**
- The operator sees recipe bodies and guidance objects rendered as formatted HTML in the Data views, matching what members see on `/cookbook`.
- Rendering is safe for untrusted authored content (no script execution, no unsafe URL schemes).
- One shared renderer, used by both the Recipe and Shared-corpus views.
- A parse failure degrades to raw text, never a blank pane.
- The Recipe view keeps its raw cross-tier inspector (raw source + projection JSON).

**Non-Goals:**
- Projecting recipe bodies (markdown or HTML) into D1, or any D1/schema change.
- Worker-side HTML rendering aimed at the admin, or any change to `/cookbook`.
- Rendering markdown anywhere outside the two Data views (e.g. recipe notes, the derived description — these are plain text).
- A raw/rendered toggle for the guidance view (its object content is the markdown; rendering it is the improvement).

## Decisions

### 1. Render client-side in Elm, not on the Worker

Elm has no clean way to inject an HTML string into the DOM — only the discouraged `innerHTML` property escape hatch or an HTML-string parser dependency. So a server-produced HTML string (whether rendered on-read or projected into D1) is dead weight for this consumer: the admin must render markdown to virtual DOM itself.

*Alternatives considered:* (a) a Worker endpoint that returns rendered HTML for the admin — rejected, Elm can't consume it cleanly; (b) projecting body HTML into D1 (`recipe_derived`) — rejected for the admin's sake for the same reason, and its only surviving rationale (letting `/cookbook` stop re-parsing R2 per request) is a separate, unrequested perf motivation. Both are no-ops for this goal.

### 2. `dillonkearns/elm-markdown` (pure Elm), not `elm-explorations/markdown`

`dillonkearns/elm-markdown` parses to real `Html msg` virtual-DOM nodes, so a `<script>` in an authored body simply cannot execute — XSS-safe by construction. `elm-explorations/markdown` is a kernel package that runs marked.js and sets `innerHTML` internally; it would happily inject raw HTML — the exact footgun Elm's design avoids.

This matters even though the admin is Access-gated: recipe and guidance bodies are member-/agent-authored, so a malicious body is **stored XSS aimed at the operator's browser** when they open the inspector. The pure-Elm renderer closes that by construction.

### 3. A custom `Renderer` that mirrors the cookbook's hardening

Start from `Markdown.Renderer.defaultHtmlRenderer` and override:
- `html` — drop raw HTML blocks/inline HTML (recipes are markdown; no raw HTML needed), matching cookbook's `html() { return "" }`.
- `link` / `image` — scheme-filter the URL to `http(s)` / root-relative (`/…`) / fragment (`#…`); anything else (e.g. `javascript:`) becomes `#`, matching cookbook's `safeUrl`.

The virtual DOM already prevents script injection; this override closes the remaining `javascript:`-href hole and keeps the operator's preview consistent with the public cookbook.

### 4. A shared `Markdown` Elm module; rendering is a pure derivation

Add `admin/src/Markdown.elm` exposing roughly `render : String -> Html msg` (or `List (Html msg)` wrapped in a container). It runs the parse + custom renderer and, on `Err`, returns the raw text in a `<pre>` (the graceful fallback). Both `Data/Recipe.elm` and `Data/Corpus.elm` call it.

Because rendering is a pure `String -> Html msg` function with the fallback handled internally, it adds **no model state** — no `WebData`, no booleans, nothing that can drift (`admin/CLAUDE.md` rule 4, "derive, don't store"). The existing `source`/object `WebData` already models the fetch; rendering is applied in the view.

### 5. The recipe body comes from a new API `body` field, not Elm-side frontmatter stripping

The recipe `source` includes the YAML frontmatter fence; rendering it whole would emit the `---` as a thematic break and the YAML as a paragraph. The body must be isolated. `src/admin-data.ts` `recipeDetail` already holds the fetched source — it will split it with the existing `parseMarkdown` and return `body` alongside the unchanged `source` (no new fetch, no new read). A source with no parseable frontmatter yields the whole text as `body`.

*Alternative considered:* strip the fence in Elm. Rejected — it duplicates the frontmatter-splitting logic in a second language, where it can drift from the Worker's `parseMarkdown` (the same DRY argument as reusing one renderer policy). Guidance objects have no frontmatter, so the Shared-corpus view renders the object markdown directly.

### 6. Add a rendered preview; keep the raw inspector

The Recipe view's identity is the cross-tier inspector — its raw `source` `<pre>` and projection JSON `<pre>` are the debugging payload. The rendered body is an **added** section, not a replacement. The guidance view's object content *is* the markdown, so it renders in place.

## Risks / Trade-offs

- **A second renderer (Elm) can drift from the cookbook's (Worker/marked).** → Mitigate by mirroring the policy explicitly (decision 3) and treating both as untrusted; the surface is small. Minor CommonMark-vs-GFM differences (e.g. tables) may render slightly differently than `/cookbook`; acceptable for an operator inspector.
- **New Elm dependency + the build needs network.** → `dillonkearns/elm-markdown` is a direct dep; the Elm compiler must reach `package.elm-lang.org`. Per `admin/CLAUDE.md`, if the sandbox can't reach it, land the source change and leave the `admin/dist/` rebuild to CI / a connected box — do not commit a stale bundle.
- **Custom `Renderer` must cover every node type.** → Derive from `defaultHtmlRenderer` and override only `html`/`link`/`image`, so unhandled node types keep their default rendering.
- **Untrusted-content rendering.** → Covered by decisions 2 + 3: virtual DOM blocks script execution; the URL filter blocks unsafe schemes; raw HTML is dropped.

## Migration Plan

Additive and reversible. No data migration, no D1/R2 change, no new binding. Steps: add the dep to `admin/elm.json`, add `Markdown.elm`, wire the two views, add the Worker `body` field, update `docs/SCHEMAS.md`, rebuild and commit `admin/dist/`. Rollback is a straight revert (and a `dist/` rebuild).

## Open Questions

- None blocking. A future raw/rendered toggle for the guidance view, or rendering authored recipe-note bodies, could follow if operators ask — both are out of scope here.
