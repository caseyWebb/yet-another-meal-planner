## Why

In the operator panel's Data area, authored corpus markdown is shown as a raw `<pre>` text dump — both a recipe's R2 `recipes/<slug>.md` source (`Data/Recipe.elm`) and a `guidance/**` object (`Data/Corpus.elm`). The operator reviewing authored content reads unformatted markdown with YAML frontmatter inline, not the rendered document members and the agent actually consume. The `/cookbook` surface already renders recipe bodies to HTML; the admin should let the operator see the same rendered form.

## What Changes

- Render authored corpus markdown to formatted HTML **client-side in Elm**, in both Data views: a recipe's body (Recipe view) and a guidance object (Shared-corpus view). A new shared `Markdown` Elm module owns the rendering; the two views are its callers.
- Use a **pure-Elm** markdown renderer (`dillonkearns/elm-markdown`) that builds real virtual-DOM nodes, with a custom renderer that **mirrors the cookbook's hardening**: raw HTML is dropped and link/image URLs are scheme-filtered (only `http(s)`, root-relative, and fragment URLs survive). A parse failure degrades gracefully to the raw text, never a blank pane.
- Add a `body` field (frontmatter-stripped, via the Worker's existing `parseMarkdown`) to the recipe-detail endpoint `GET /admin/api/data/recipes/<slug>`, so the rendered preview gets the recipe body without a divergent frontmatter splitter in Elm. The raw `source` field is unchanged.
- Keep the Recipe view's existing **raw inspector** sections (the raw `source` dump and the D1 projection JSON) — the rendered body is an *added* preview, not a replacement, preserving the cross-tier inspector's debugging value.
- **No D1 change, no Worker-side HTML rendering for the admin, no cookbook change.** Rendering server-produced HTML was considered and rejected: Elm cannot display an HTML string without an escape hatch, so it must render markdown itself; projecting HTML to D1 or rendering on-read would be dead weight for this consumer.
- Add `dillonkearns/elm-markdown` as a direct dependency in `admin/elm.json` and rebuild the committed `admin/dist/` bundle.

## Capabilities

### New Capabilities
<!-- None — this modifies existing data-explorer behavior. -->

### Modified Capabilities
- `operator-data-explorer`: the Recipe and Shared-corpus views render authored markdown (recipe body, guidance object) as formatted HTML client-side with the cookbook's hardening policy and a raw-text fallback; the recipe-detail endpoint additionally returns the frontmatter-stripped `body`.

## Impact

- **Admin SPA** (`admin/src/`): new shared `Markdown.elm` module (the `dillonkearns/elm-markdown` parse + hardened custom renderer + fallback); `Data/Recipe.elm` decodes a new `body` field and adds a rendered preview section while keeping the raw dumps; `Data/Corpus.elm` renders the guidance object instead of dumping it. Per `admin/CLAUDE.md`: rendering is a pure `String -> Html msg` derivation (no new model state, no booleans). Rebuild the committed `admin/dist/` bundle.
- **Worker** (`src/admin-data.ts`): `recipeDetail` adds a `body` field by splitting the already-fetched R2 source with the existing `parseMarkdown` (no new fetch, no new R2/D1 read); a source with no parseable frontmatter yields the whole text as body. Reflected in the `RecipeDetail` interface.
- **Dependencies**: `admin/elm.json` gains `dillonkearns/elm-markdown` (direct). The Elm build needs `package.elm-lang.org` reachable to fetch it; per `admin/CLAUDE.md`, if the sandbox cannot reach it the source change lands but the `admin/dist/` rebuild is left to CI / a connected box rather than committing a stale bundle.
- **Docs**: update `docs/SCHEMAS.md` where it documents the `/admin/api/data/recipes/<slug>` response shape to include the `body` field.
- **Out of scope**: any D1 projection of recipe bodies; Worker-side HTML rendering for the admin; changes to `/cookbook`; rendering markdown anywhere outside the two Data views.
