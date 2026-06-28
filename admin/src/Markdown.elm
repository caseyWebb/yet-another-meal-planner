module Markdown exposing (render)

{-| Render untrusted, authored corpus markdown (recipe bodies, guidance objects) to safe
HTML for the operator panel's Data views — the client-side counterpart to the Worker's
hardened `/cookbook` renderer (`src/cookbook.ts`).

Safety mirrors that renderer: raw HTML embedded in the markdown is not emitted, and link /
image URLs are scheme-filtered to `http(s)` / root-relative / fragment (anything else, e.g.
`javascript:`, becomes `#`). Because we build real virtual-DOM nodes (never `innerHTML`), a
`<script>` in a body cannot execute regardless. When the markdown can't be parsed or
rendered (raw HTML, which we refuse to handle, lands here), we fall back to the raw text in
a `<pre>` — never an empty pane.

@docs render

-}

import Html exposing (Html, a, div, img, pre, text)
import Html.Attributes exposing (alt, href, src, title)
import Markdown.Html
import Markdown.Parser
import Markdown.Renderer exposing (Renderer)


{-| Render markdown to safe HTML, falling back to the raw text on any parse/render failure. -}
render : String -> Html msg
render raw =
    case
        Markdown.Parser.parse raw
            |> Result.mapError (always ())
            |> Result.andThen (Markdown.Renderer.render hardened >> Result.mapError (always ()))
    of
        Ok blocks ->
            div [] blocks

        Err () ->
            pre [] [ text raw ]


{-| The default HTML renderer, hardened for untrusted content: raw HTML is refused (so it
drops to the raw-text fallback) and link / image URLs are scheme-filtered. -}
hardened : Renderer (Html msg)
hardened =
    let
        default =
            Markdown.Renderer.defaultHtmlRenderer
    in
    { default
        | html = Markdown.Html.oneOf []
        , link = renderLink
        , image = renderImage
    }


renderLink : { title : Maybe String, destination : String } -> List (Html msg) -> Html msg
renderLink link children =
    case link.title of
        Just t ->
            a [ href (safeUrl link.destination), title t ] children

        Nothing ->
            a [ href (safeUrl link.destination) ] children


renderImage : { alt : String, src : String, title : Maybe String } -> Html msg
renderImage image =
    case image.title of
        Just t ->
            img [ src (safeUrl image.src), alt image.alt, title t ] []

        Nothing ->
            img [ src (safeUrl image.src), alt image.alt ] []


{-| Allow only `http(s)`, root-relative, and fragment URLs; anything else → `#`. Mirrors
`safeUrl` in `src/cookbook.ts`. -}
safeUrl : String -> String
safeUrl url =
    let
        trimmed =
            String.trim url

        lower =
            String.toLower trimmed
    in
    if
        String.startsWith "http://" lower
            || String.startsWith "https://" lower
            || String.startsWith "/" trimmed
            || String.startsWith "#" trimmed
    then
        trimmed

    else
        "#"
