module Route exposing (Route(..), DataRoute(..), actingAsParam, fromUrl, href, toString)

{-| The admin SPA's client routes, all under the worker-served `/admin` base. The panel is
split into top-level areas — **Status** (the service-health home view), **Members** (member
management), and **Dev** (the tool console) — each a routed page, so a new surface is a new
route + module rather than another card on one page. The home route (`/admin`, and `/`) is
`Health`; member management lives at its own `/admin/members`.

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
import Url.Parser.Query as Query


type Route
    = Health
    | Members
    | Tools (Maybe String)
    | Data DataRoute
    | NotFound


{-| The Data area's sub-routes. The two 360 views carry an optionally-selected entity
(`recipes/<slug>`, `members/<id>`) so a recipe/member deep-links; the three flat views
are bare. `/admin/data` (no sub-segment) resolves to the recipe list. -}
type DataRoute
    = DataRecipes (Maybe String)
    | DataMembers (Maybe String)
    | DataCorpus
    | DataDiscovery
    | DataSystem


parser : Parser (Route -> a) a
parser =
    oneOf
        [ Parser.map Health top
        , Parser.map Health (s "admin")
        , Parser.map Members (s "admin" </> s "members")
        , Parser.map (Tools Nothing) (s "admin" </> s "dev" </> s "tools")
        , Parser.map (Just >> Tools) (s "admin" </> s "dev" </> s "tools" </> string)
        , Parser.map (Data (DataRecipes Nothing)) (s "admin" </> s "data" </> s "recipes")
        , Parser.map (Data << DataRecipes << Just) (s "admin" </> s "data" </> s "recipes" </> string)
        , Parser.map (Data (DataMembers Nothing)) (s "admin" </> s "data" </> s "members")
        , Parser.map (Data << DataMembers << Just) (s "admin" </> s "data" </> s "members" </> string)
        , Parser.map (Data DataCorpus) (s "admin" </> s "data" </> s "corpus")
        , Parser.map (Data DataDiscovery) (s "admin" </> s "data" </> s "discovery")
        , Parser.map (Data DataSystem) (s "admin" </> s "data" </> s "system")
        , Parser.map (Data (DataRecipes Nothing)) (s "admin" </> s "data")
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
        Health ->
            Builder.absolute [ "admin" ] []

        Members ->
            Builder.absolute [ "admin", "members" ] []

        Tools Nothing ->
            Builder.absolute [ "admin", "dev", "tools" ] []

        Tools (Just name) ->
            Builder.absolute [ "admin", "dev", "tools", name ] []

        Data dataRoute ->
            Builder.absolute ("admin" :: "data" :: dataSegments dataRoute) []

        NotFound ->
            Builder.absolute [ "admin" ] []


dataSegments : DataRoute -> List String
dataSegments dataRoute =
    case dataRoute of
        DataRecipes Nothing ->
            [ "recipes" ]

        DataRecipes (Just slug) ->
            [ "recipes", slug ]

        DataMembers Nothing ->
            [ "members" ]

        DataMembers (Just id) ->
            [ "members", id ]

        DataCorpus ->
            [ "corpus" ]

        DataDiscovery ->
            [ "discovery" ]

        DataSystem ->
            [ "system" ]


href : Route -> Html.Attribute msg
href route =
    Html.Attributes.href (toString route)


{-| Read an initial acting-as persona from a `?as=<id>` query param. Best-effort: used
only to seed the workbench on a deep link; the persona is model state thereafter. Parsed
with `Url.Parser.Query` (its tested `&`/`=` splitting + percent-decoding) over a
path-stripped URL so it matches regardless of which route the query rode in on; an empty
`?as=` is treated as absent.
-}
actingAsParam : Url -> Maybe String
actingAsParam url =
    { url | path = "/" }
        |> Parser.parse (Parser.query (Query.string "as"))
        |> Maybe.andThen identity
        |> Maybe.andThen nonEmpty


nonEmpty : String -> Maybe String
nonEmpty value =
    if String.isEmpty value then
        Nothing

    else
        Just value
