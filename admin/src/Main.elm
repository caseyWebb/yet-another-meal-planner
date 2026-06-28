module Main exposing (main)

{-| The grocery-agent operator admin shell (operator-admin capability).

A client-routed `Browser.application` served under `/admin` behind Cloudflare Access. The
panel is split into top-level areas so it grows by adding routed pages, not by stacking
cards on one view:

  - **Status** — the service-health home view (`/health`: jobs, D1, admin-gate posture), in
    `Status`. This is the home route (`/admin`).
  - **Members** — member management (onboard / list / rotate / revoke), in `Admin.Members`.
  - **Dev** — the MCP tool console (inspect + run tools as a chosen member), in
    `Dev.ToolConsole`.
  - **Logs** — operator-auditable activity logs (a left submenu of sources, master/detail), in
    `Logs`. The selected source rides the route (`/admin/logs/discovery`).
  - **Config** — operator configuration, in `Config`.
  - **Data** — the read-only data explorer over D1 and the R2 corpus (five entity views), in
    `Data`. The selected recipe/member rides the route (`/admin/data/recipes/<slug>`).

The current page **and its sub-model** are one `Page` union (a page owns its state), so
being "on the Tools page holding Members' state" is unrepresentable. Navigation is by real
URLs (deep-linkable, refresh-stable); the Worker serves this shell for any unmatched
`/admin/*` route.

-}

import Admin.Members as Members
import Browser
import Browser.Dom as Dom
import Browser.Navigation as Nav
import Config
import Data
import Dev.ToolConsole as ToolConsole
import Html exposing (Html, a, button, div, h1, nav, section, text)
import Html.Attributes exposing (class, classList, id)
import Html.Events exposing (onClick)
import Logs
import Route exposing (LogSource(..), Route)
import Status
import Task
import Url exposing (Url)



-- MODEL


type alias Model =
    { key : Nav.Key
    , route : Route
    , page : Page
    , activeDevSection : DevSection
    }


{-| The Dev area's sections — one pill each in the sticky sub-nav. A finite enum, not a
`String` (admin/CLAUDE.md rule 3): a new Dev surface is a new variant here, and the
compiler then flags every site that must handle it (the id, the label, its section block
in `viewPage`). The pills accumulate; nothing crams in. -}
type DevSection
    = McpInspector


devSections : List DevSection
devSections =
    [ McpInspector ]


defaultDevSection : DevSection
defaultDevSection =
    McpInspector


{-| The section's DOM id — also its pill's scroll target. -}
sectionId : DevSection -> String
sectionId section =
    case section of
        McpInspector ->
            "mcp-inspector"


sectionLabel : DevSection -> String
sectionLabel section =
    case section of
        McpInspector ->
            "MCP Inspector"


{-| The live page and its state, as one value — you cannot be on one page holding
another's model. -}
type Page
    = HealthPage Status.Model
    | MembersPage Members.Model
    | ToolsPage ToolConsole.Model
    | LogsPage Logs.Model
    | ConfigPage Config.Model
    | DataPage Data.Model
    | NotFoundPage


init : () -> Url -> Nav.Key -> ( Model, Cmd Msg )
init _ url key =
    -- `?as=` seeds the Dev workbench's persona on a deep link; it is model state after.
    enter (Route.fromUrl url) (Route.actingAsParam url) { key = key, route = Route.NotFound, page = NotFoundPage, activeDevSection = defaultDevSection }



-- UPDATE


type Msg
    = LinkClicked Browser.UrlRequest
    | UrlChanged Url
    | HealthMsg Status.Msg
    | MembersMsg Members.Msg
    | ToolsMsg ToolConsole.Msg
    | LogsMsg Logs.Msg
    | ConfigMsg Config.Msg
    | DataMsg Data.Msg
    | ScrollToSection DevSection
    | NoOp


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case ( msg, model.page ) of
        ( LinkClicked (Browser.Internal url), _ ) ->
            ( model, Nav.pushUrl model.key (Url.toString url) )

        ( LinkClicked (Browser.External href), _ ) ->
            ( model, Nav.load href )

        ( UrlChanged url, _ ) ->
            stepTo (Route.fromUrl url) model

        ( ScrollToSection section, _ ) ->
            ( { model | activeDevSection = section }, scrollToSection section )

        ( NoOp, _ ) ->
            ( model, Cmd.none )

        ( HealthMsg subMsg, HealthPage subModel ) ->
            let
                ( subModel2, cmd ) =
                    Status.update subMsg subModel
            in
            ( { model | page = HealthPage subModel2 }, Cmd.map HealthMsg cmd )

        ( MembersMsg subMsg, MembersPage subModel ) ->
            let
                ( subModel2, cmd ) =
                    Members.update subMsg subModel
            in
            ( { model | page = MembersPage subModel2 }, Cmd.map MembersMsg cmd )

        ( ToolsMsg subMsg, ToolsPage subModel ) ->
            let
                ( subModel2, cmd ) =
                    ToolConsole.update subMsg subModel
            in
            ( { model | page = ToolsPage subModel2 }, Cmd.map ToolsMsg cmd )

        ( LogsMsg subMsg, LogsPage subModel ) ->
            let
                ( subModel2, cmd ) =
                    Logs.update subMsg subModel
            in
            ( { model | page = LogsPage subModel2 }, Cmd.map LogsMsg cmd )

        ( ConfigMsg subMsg, ConfigPage subModel ) ->
            let
                ( subModel2, cmd ) =
                    Config.update subMsg subModel
            in
            ( { model | page = ConfigPage subModel2 }, Cmd.map ConfigMsg cmd )

        ( DataMsg subMsg, DataPage subModel ) ->
            let
                ( subModel2, cmd ) =
                    Data.update subMsg subModel
            in
            ( { model | page = DataPage subModel2 }, Cmd.map DataMsg cmd )

        -- A sub-message for a page we are no longer on (a late response): drop it.
        ( HealthMsg _, _ ) ->
            ( model, Cmd.none )

        ( MembersMsg _, _ ) ->
            ( model, Cmd.none )

        ( ToolsMsg _, _ ) ->
            ( model, Cmd.none )

        ( LogsMsg _, _ ) ->
            ( model, Cmd.none )

        ( ConfigMsg _, _ ) ->
            ( model, Cmd.none )

        ( DataMsg _, _ ) ->
            ( model, Cmd.none )


{-| Navigate in-app: stay on the live page when it is the same area (preserving its state —
e.g. reopen a tool without losing the persona/catalog), else build the area fresh. The
acting-as persona is model state, so it is not re-seeded on in-app navigation.
-}
stepTo : Route -> Model -> ( Model, Cmd Msg )
stepTo route model =
    case ( route, model.page ) of
        ( Route.Tools selected, ToolsPage subModel ) ->
            let
                ( subModel2, cmd ) =
                    ToolConsole.selectTool selected subModel
            in
            ( { model | route = route, page = ToolsPage subModel2 }, Cmd.map ToolsMsg cmd )

        ( Route.Logs selected, LogsPage subModel ) ->
            let
                ( subModel2, cmd ) =
                    Logs.selectSource (logSourceOr selected) subModel
            in
            ( { model | route = route, page = LogsPage subModel2 }, Cmd.map LogsMsg cmd )

        ( Route.Members, MembersPage _ ) ->
            ( { model | route = route }, Cmd.none )

        ( Route.Health, HealthPage _ ) ->
            ( { model | route = route }, Cmd.none )

        ( Route.Config configRoute, ConfigPage subModel ) ->
            let
                ( subModel2, cmd ) =
                    Config.goto configRoute subModel
            in
            ( { model | route = route, page = ConfigPage subModel2 }, Cmd.map ConfigMsg cmd )

        ( Route.Data dataRoute, DataPage subModel ) ->
            let
                ( subModel2, cmd ) =
                    Data.goto dataRoute subModel
            in
            ( { model | route = route, page = DataPage subModel2 }, Cmd.map DataMsg cmd )

        _ ->
            enter route Nothing model


{-| The selected log source for a `Logs` route, defaulting the bare `/admin/logs` (no source
chosen) to the first source so the area always shows a log. -}
logSourceOr : Maybe LogSource -> LogSource
logSourceOr selected =
    Maybe.withDefault Discovery selected


{-| Build a route's page from scratch. For Tools, `actingAs` seeds the persona (only ever
`Just` on the initial deep link). -}
enter : Route -> Maybe String -> Model -> ( Model, Cmd Msg )
enter route actingAs model =
    case route of
        Route.Health ->
            let
                ( subModel, cmd ) =
                    Status.init
            in
            ( { model | route = route, page = HealthPage subModel }, Cmd.map HealthMsg cmd )

        Route.Members ->
            let
                ( subModel, cmd ) =
                    Members.init
            in
            ( { model | route = route, page = MembersPage subModel }, Cmd.map MembersMsg cmd )

        Route.Tools selected ->
            let
                ( subModel, cmd ) =
                    ToolConsole.init { persona = actingAs, tool = selected }
            in
            ( { model | route = route, page = ToolsPage subModel }, Cmd.map ToolsMsg cmd )

        Route.Logs selected ->
            let
                ( subModel, cmd ) =
                    Logs.init (logSourceOr selected)
            in
            ( { model | route = route, page = LogsPage subModel }, Cmd.map LogsMsg cmd )

        Route.Config configRoute ->
            let
                ( subModel, cmd ) =
                    Config.init configRoute
            in
            ( { model | route = route, page = ConfigPage subModel }, Cmd.map ConfigMsg cmd )

        Route.Data dataRoute ->
            let
                ( subModel, cmd ) =
                    Data.init dataRoute
            in
            ( { model | route = route, page = DataPage subModel }, Cmd.map DataMsg cmd )

        Route.NotFound ->
            ( { model | route = route, page = NotFoundPage }, Cmd.none )


{-| Scroll a Dev section up to just under the sticky sub-nav, which fills the viewport with
it (a section is sized to `100vh − sub-nav`) and scrolls the page header — the `h1` + main
nav — out of view. `Dom.getElement` gives the section's document Y; we offset by the sub-nav
height. A missing element (race) is a harmless no-op. -}
scrollToSection : DevSection -> Cmd Msg
scrollToSection section =
    Dom.getElement (sectionId section)
        |> Task.andThen (\el -> Dom.setViewport 0 (el.element.y - subnavHeight))
        |> Task.attempt (\_ -> NoOp)


{-| Sub-nav height in px, tracking `--subnav-h: 3rem` in index.html. Assumes the UA default
16px root; if that's overridden the post-click scroll drifts a few px — cosmetic only. -}
subnavHeight : Float
subnavHeight =
    48



-- VIEW


view : Model -> Browser.Document Msg
view model =
    { title = "grocery-agent admin"
    , body =
        [ div [ class (wrapClass model.route) ]
            [ h1 [] [ text "grocery-agent admin" ]
            , viewNav model.route
            , viewPage model
            ]
        ]
    }


{-| The two-column areas (the tool console and the logs master/detail) want a wider page than
the member-management forms. -}
wrapClass : Route -> String
wrapClass route =
    case route of
        Route.Tools _ ->
            "wrap wrap-wide"

        Route.Logs _ ->
            "wrap wrap-wide"

        Route.Config _ ->
            "wrap wrap-wide"

        Route.Data _ ->
            "wrap wrap-wide"

        _ ->
            "wrap"


viewNav : Route -> Html Msg
viewNav route =
    nav [ class "nav" ]
        [ navLink "Status" Route.Health (isStatus route)
        , navLink "Members" Route.Members (isMembers route)
        , navLink "Dev · Tools" (Route.Tools Nothing) (isDev route)
        , navLink "Logs" (Route.Logs Nothing) (isLogs route)
        , navLink "Config" (Route.Config Route.ConfigCalibration) (isConfig route)
        , navLink "Data" (Route.Data (Route.DataRecipes Nothing)) (isData route)
        ]


navLink : String -> Route -> Bool -> Html Msg
navLink label route active =
    a [ Route.href route, classList [ ( "nav-link", True ), ( "active", active ) ] ] [ text label ]


isStatus : Route -> Bool
isStatus route =
    case route of
        Route.Health ->
            True

        _ ->
            False


isMembers : Route -> Bool
isMembers route =
    case route of
        Route.Members ->
            True

        _ ->
            False


isDev : Route -> Bool
isDev route =
    case route of
        Route.Tools _ ->
            True

        _ ->
            False


isLogs : Route -> Bool
isLogs route =
    case route of
        Route.Logs _ ->
            True

        _ ->
            False


isConfig : Route -> Bool
isConfig route =
    case route of
        Route.Config _ ->
            True

        _ ->
            False


isData : Route -> Bool
isData route =
    case route of
        Route.Data _ ->
            True

        _ ->
            False


viewPage : Model -> Html Msg
viewPage model =
    case model.page of
        HealthPage subModel ->
            Html.map HealthMsg (Status.view subModel)

        MembersPage subModel ->
            Html.map MembersMsg (Members.view subModel)

        ToolsPage subModel ->
            -- Dev area: a sticky pill sub-nav over full-viewport sections (one today). Each
            -- section's id is its pill's scroll target.
            div []
                [ viewDevSubnav model.activeDevSection
                , section [ id (sectionId McpInspector), class "dev-section" ]
                    [ Html.map ToolsMsg (ToolConsole.view subModel) ]
                ]

        LogsPage subModel ->
            Html.map LogsMsg (Logs.view subModel)

        ConfigPage subModel ->
            Html.map ConfigMsg (Config.view subModel)

        DataPage subModel ->
            Html.map DataMsg (Data.view subModel)

        NotFoundPage ->
            div [ class "card" ] [ text "Not found." ]


{-| The sticky pill row. With one section the pill still earns its place: clicking it
scrolls the page header away and snaps the section to fill the viewport (see
`scrollToSection`); with more sections it's how you jump between them. -}
viewDevSubnav : DevSection -> Html Msg
viewDevSubnav active =
    nav [ class "subnav" ] (List.map (viewPill active) devSections)


viewPill : DevSection -> DevSection -> Html Msg
viewPill active section =
    button
        [ classList [ ( "pill", True ), ( "active", section == active ) ]
        , onClick (ScrollToSection section)
        ]
        [ text (sectionLabel section) ]



-- MAIN


main : Program () Model Msg
main =
    Browser.application
        { init = init
        , update = update
        , view = view
        , subscriptions = always Sub.none
        , onUrlRequest = LinkClicked
        , onUrlChange = UrlChanged
        }
