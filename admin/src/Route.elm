module Route exposing (LogSource(..), Route(..), actingAsParam, fromUrl, href, logSourceFromSlug, logSourceSlug, toString)

{-| The admin SPA's client routes, all under the worker-served `/admin` base. The panel is
split into top-level areas — **Status** (the service-health home view), **Members** (member
management), **Dev** (the tool console), and **Logs** (operator-auditable activity logs) —
each a routed page, so a new surface is a new route + module rather than another card on one
page. The home route (`/admin`, and `/`) is `Health`; member management lives at its own
`/admin/members`.

`Tools` carries the optionally-selected tool name, so a specific tool deep-links
(`/admin/dev/tools/place_order`). `Logs` carries the optionally-selected `LogSource` (a finite
union, never a stringly-typed slug), so the selected log deep-links
(`/admin/logs/discovery`). The acting-as persona is NOT part of the route — it is workbench
model state — though an initial `?as=<id>` seeds it on a deep link (`actingAsParam`).

-}

import Html
import Html.Attributes
import Url exposing (Url)
import Url.Builder as Builder
import Url.Parser as Parser exposing ((</>), Parser, custom, oneOf, s, string, top)
import Url.Parser.Query as Query


type Route
    = Health
    | Members
    | Tools (Maybe String)
    | Logs (Maybe LogSource)
    | NotFound


{-| The Logs area's log sources — a finite enum, not a stringly-typed slug (admin/CLAUDE.md
rule 3). The first (and initially only) source is `Discovery` (the background discovery
sweep's outcome log); a future source is a new variant here, and the compiler then flags
every site that must handle it (its slug, its label, its left-submenu entry, its fetch). Each
source's URL slug is its single canonical encoding (`logSourceSlug`), parsed back by
`logSourceFromSlug`.
-}
type LogSource
    = Discovery


logSourceSlug : LogSource -> String
logSourceSlug source =
    case source of
        Discovery ->
            "discovery"


logSourceFromSlug : String -> Maybe LogSource
logSourceFromSlug slug =
    case slug of
        "discovery" ->
            Just Discovery

        _ ->
            Nothing


parser : Parser (Route -> a) a
parser =
    oneOf
        [ Parser.map Health top
        , Parser.map Health (s "admin")
        , Parser.map Members (s "admin" </> s "members")
        , Parser.map (Tools Nothing) (s "admin" </> s "dev" </> s "tools")
        , Parser.map (Just >> Tools) (s "admin" </> s "dev" </> s "tools" </> string)
        , Parser.map (Logs Nothing) (s "admin" </> s "logs")
        , Parser.map (Just >> Logs) (s "admin" </> s "logs" </> logSource)
        ]


{-| Parse a log-source slug segment into a `LogSource`, failing the route (→ NotFound) on an
unknown slug rather than admitting a bogus source. -}
logSource : Parser (LogSource -> a) a
logSource =
    custom "LOG_SOURCE" logSourceFromSlug


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

        Logs Nothing ->
            Builder.absolute [ "admin", "logs" ] []

        Logs (Just source) ->
            Builder.absolute [ "admin", "logs", logSourceSlug source ] []

        NotFound ->
            Builder.absolute [ "admin" ] []


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
