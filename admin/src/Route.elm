module Route exposing (ConfigRoute(..), DataRoute(..), LogSource(..), Route(..), actingAsParam, fromUrl, href, logSourceFromSlug, logSourceSlug, toString)

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
    | Config ConfigRoute
    | Data DataRoute
    | Usage
    | NotFound


{-| The Config area's sub-routes, one per pill in the area's sub-nav. The default (the bare
`/admin/config`) is the discovery calibration console (`Calibration`); the other five are the
shared-corpus editors. A finite union, never a stringly-typed slug (admin/CLAUDE.md rule 3):
a new config surface is a new variant here, and the compiler then flags every site that must
handle it (its slug, its label, its section). Each variant's URL slug is its single canonical
encoding (`configSegment`), parsed back by `configRouteFromSlug`. -}
type ConfigRoute
    = ConfigCalibration
    | ConfigRanking
    | ConfigFlyer
    | ConfigAliases
    | ConfigFlyerTerms
    | ConfigFeeds
    | ConfigSenders
    | ConfigMembers


{-| The Data area's sub-routes. The two 360 views carry an optionally-selected entity
(`recipes/<slug>`, `members/<id>`) so a recipe/member deep-links; the three flat views
are bare. `/admin/data` (no sub-segment) resolves to the recipe list. -}
type DataRoute
    = DataRecipes (Maybe String)
    | DataMembers (Maybe String)
    | DataCorpus
    | DataDiscovery
    | DataSystem


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


{-| A Config sub-route's URL slug (the `/admin/config/<slug>` segment). `Calibration` has no
segment — it is the bare `/admin/config` — so it maps to the empty string and is not printed
as a child segment (`configSegments`). -}
configSlug : ConfigRoute -> String
configSlug configRoute_ =
    case configRoute_ of
        ConfigCalibration ->
            ""

        ConfigRanking ->
            "ranking"

        ConfigFlyer ->
            "flyer"

        ConfigAliases ->
            "aliases"

        ConfigFlyerTerms ->
            "flyer-terms"

        ConfigFeeds ->
            "feeds"

        ConfigSenders ->
            "senders"

        ConfigMembers ->
            "members"


configRouteFromSlug : String -> Maybe ConfigRoute
configRouteFromSlug slug =
    case slug of
        "ranking" ->
            Just ConfigRanking

        "flyer" ->
            Just ConfigFlyer

        "aliases" ->
            Just ConfigAliases

        "flyer-terms" ->
            Just ConfigFlyerTerms

        "feeds" ->
            Just ConfigFeeds

        "senders" ->
            Just ConfigSenders

        "members" ->
            Just ConfigMembers

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
        , Parser.map (Config ConfigCalibration) (s "admin" </> s "config")
        , Parser.map Config (s "admin" </> s "config" </> configRoute)
        , Parser.map (Data (DataRecipes Nothing)) (s "admin" </> s "data" </> s "recipes")
        , Parser.map (Data << DataRecipes << Just) (s "admin" </> s "data" </> s "recipes" </> string)
        , Parser.map (Data (DataMembers Nothing)) (s "admin" </> s "data" </> s "members")
        , Parser.map (Data << DataMembers << Just) (s "admin" </> s "data" </> s "members" </> string)
        , Parser.map (Data DataCorpus) (s "admin" </> s "data" </> s "corpus")
        , Parser.map (Data DataDiscovery) (s "admin" </> s "data" </> s "discovery")
        , Parser.map (Data DataSystem) (s "admin" </> s "data" </> s "system")
        , Parser.map (Data (DataRecipes Nothing)) (s "admin" </> s "data")
        , Parser.map Usage (s "admin" </> s "usage")
        ]


{-| Parse a log-source slug segment into a `LogSource`, failing the route (→ NotFound) on an
unknown slug rather than admitting a bogus source. -}
logSource : Parser (LogSource -> a) a
logSource =
    custom "LOG_SOURCE" logSourceFromSlug


{-| Parse a config sub-route slug segment into a `ConfigRoute`, failing the route (→ NotFound)
on an unknown slug rather than admitting a bogus sub-view. The bare `/admin/config`
(`Calibration`) is matched by its own parser entry, not here. -}
configRoute : Parser (ConfigRoute -> a) a
configRoute =
    custom "CONFIG_ROUTE" configRouteFromSlug


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

        Config configRoute_ ->
            Builder.absolute ("admin" :: "config" :: configSegments configRoute_) []

        Data dataRoute ->
            Builder.absolute ("admin" :: "data" :: dataSegments dataRoute) []

        Usage ->
            Builder.absolute [ "admin", "usage" ] []

        NotFound ->
            Builder.absolute [ "admin" ] []


{-| The path segments under `/admin/config` for a sub-route. `Calibration` is the bare area
root, so it contributes no child segment; the editors each contribute their slug. -}
configSegments : ConfigRoute -> List String
configSegments configRoute_ =
    case configRoute_ of
        ConfigCalibration ->
            []

        _ ->
            [ configSlug configRoute_ ]


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
