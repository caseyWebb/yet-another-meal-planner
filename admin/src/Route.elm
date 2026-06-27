module Route exposing (Route(..), actingAsParam, fromUrl, href, toString)

{-| The admin SPA's client routes, all under the worker-served `/admin` base. The panel
is split into an **Admin** area (member management) and a **Dev** area (the tool console),
each a routed page, so a new surface is a new route + module rather than another card on
one page.

`Tools` carries the optionally-selected tool name, so a specific tool deep-links
(`/admin/dev/tools/place_order`). The acting-as persona is NOT part of the route — it is
workbench model state — though an initial `?as=<id>` seeds it on a deep link
(`actingAsParam`).

-}

import Html
import Html.Attributes
import Url exposing (Url)
import Url.Builder as Builder
import Url.Parser as Parser exposing ((</>), Parser, oneOf, s, string, top)


type Route
    = Members
    | Tools (Maybe String)
    | NotFound


parser : Parser (Route -> a) a
parser =
    oneOf
        [ Parser.map Members top
        , Parser.map Members (s "admin")
        , Parser.map Members (s "admin" </> s "members")
        , Parser.map (Tools Nothing) (s "admin" </> s "dev" </> s "tools")
        , Parser.map (Just >> Tools) (s "admin" </> s "dev" </> s "tools" </> string)
        ]


fromUrl : Url -> Route
fromUrl url =
    -- Normalize a trailing slash (the canonical entry is `/admin/`) so it parses like
    -- `/admin` rather than falling through to NotFound on the empty final segment.
    Maybe.withDefault NotFound
        (Parser.parse parser { url | path = stripTrailingSlash url.path })


stripTrailingSlash : String -> String
stripTrailingSlash path =
    if path /= "/" && String.endsWith "/" path then
        String.dropRight 1 path

    else
        path


toString : Route -> String
toString route =
    case route of
        Members ->
            Builder.absolute [ "admin", "members" ] []

        Tools Nothing ->
            Builder.absolute [ "admin", "dev", "tools" ] []

        Tools (Just name) ->
            Builder.absolute [ "admin", "dev", "tools", name ] []

        NotFound ->
            Builder.absolute [ "admin" ] []


href : Route -> Html.Attribute msg
href route =
    Html.Attributes.href (toString route)


{-| Read an initial acting-as persona from a `?as=<id>` query param. Best-effort: used
only to seed the workbench on a deep link; the persona is model state thereafter.
-}
actingAsParam : Url -> Maybe String
actingAsParam url =
    url.query
        |> Maybe.withDefault ""
        |> String.split "&"
        |> List.filterMap
            (\pair ->
                case String.split "=" pair of
                    key :: rest ->
                        if key == "as" then
                            let
                                raw =
                                    String.join "=" rest
                            in
                            if String.isEmpty raw then
                                Nothing

                            else
                                Just (Maybe.withDefault raw (Url.percentDecode raw))

                        else
                            Nothing

                    [] ->
                        Nothing
            )
        |> List.head
