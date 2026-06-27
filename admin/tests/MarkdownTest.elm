module MarkdownTest exposing (suite)

{-| The shared Markdown renderer's safety + fallback contract (`Markdown.render`): valid
markdown becomes semantic HTML, unsafe URLs are neutralized, and raw HTML never becomes a
live element — it falls back to inert raw text — mirroring the Worker's hardened
`/cookbook` renderer (`src/cookbook.ts`).
-}

import Expect
import Html.Attributes
import Markdown
import Test exposing (Test, describe, test)
import Test.Html.Query as Query
import Test.Html.Selector as Selector


suite : Test
suite =
    describe "Markdown.render"
        [ test "renders a heading to semantic HTML" <|
            \_ ->
                Markdown.render "# Hello"
                    |> Query.fromHtml
                    |> Query.has [ Selector.tag "h1", Selector.text "Hello" ]
        , test "renders a list to <li> items" <|
            \_ ->
                Markdown.render "- a\n- b\n- c"
                    |> Query.fromHtml
                    |> Query.findAll [ Selector.tag "li" ]
                    |> Query.count (Expect.equal 3)
        , test "keeps a safe http(s) link" <|
            \_ ->
                Markdown.render "[ok](https://example.com/x)"
                    |> Query.fromHtml
                    |> Query.has
                        [ Selector.tag "a"
                        , Selector.attribute (Html.Attributes.href "https://example.com/x")
                        ]
        , test "neutralizes a javascript: link URL to #" <|
            \_ ->
                Markdown.render "[click](javascript:x)"
                    |> Query.fromHtml
                    |> Query.has
                        [ Selector.tag "a"
                        , Selector.attribute (Html.Attributes.href "#")
                        ]
        , test "raw HTML never becomes a live element — falls back to inert raw text" <|
            \_ ->
                Markdown.render "<script>alert('x')</script>"
                    |> Query.fromHtml
                    |> Expect.all
                        [ Query.findAll [ Selector.tag "script" ] >> Query.count (Expect.equal 0)
                        , Query.has [ Selector.tag "pre", Selector.text "<script>alert('x')</script>" ]
                        ]
        , test "inline raw HTML never becomes a live element (onerror can't fire)" <|
            \_ ->
                -- dillonkearns escapes invalid-tag text as inert text rather than emitting
                -- an element; either way no live <img> reaches the DOM.
                Markdown.render "Hello <img src=x onerror=alert(1)> world"
                    |> Query.fromHtml
                    |> Query.findAll [ Selector.tag "img" ]
                    |> Query.count (Expect.equal 0)
        ]
