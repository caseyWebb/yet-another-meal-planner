module Main exposing (main)

{-| The grocery-agent operator admin shell (operator-admin capability).

A client-routed `Browser.application` served under `/admin` behind Cloudflare Access. The
panel is split into two top-level areas so it grows by adding routed pages, not by stacking
cards on one view:

  - **Admin** — member management (onboard / list / rotate / revoke), in `Admin.Members`.
  - **Dev** — the MCP tool console (inspect + run tools as a chosen member), in
    `Dev.ToolConsole`.

The current page **and its sub-model** are one `Page` union (a page owns its state), so
being "on the Tools page holding Members' state" is unrepresentable. Navigation is by real
URLs (deep-linkable, refresh-stable); the Worker serves this shell for any unmatched
`/admin/*` route.

-}

import Admin.Members as Members
import Browser
import Browser.Dom as Dom
import Browser.Navigation as Nav
import Dev.ToolConsole as ToolConsole
import Html exposing (Html, a, button, div, h1, nav, section, text)
import Html.Attributes exposing (class, classList, id)
import Html.Events exposing (onClick)
import Route exposing (Route)
import Task
import Url exposing (Url)



-- MODEL


type alias Model =
    { key : Nav.Key
    , route : Route
    , page : Page
    , activeDevSection : String
    }


{-| The Dev area's sections, one pill each in the sticky sub-nav. A new Dev surface is a
new entry here (+ its section in `viewPage`) — the pills accumulate, nothing crams in. -}
devSections : List { id : String, label : String }
devSections =
    [ { id = "mcp-inspector", label = "MCP Inspector" } ]


defaultDevSection : String
defaultDevSection =
    "mcp-inspector"


{-| The live page and its state, as one value — you cannot be on one page holding
another's model. -}
type Page
    = MembersPage Members.Model
    | ToolsPage ToolConsole.Model
    | NotFoundPage


init : () -> Url -> Nav.Key -> ( Model, Cmd Msg )
init _ url key =
    -- `?as=` seeds the Dev workbench's persona on a deep link; it is model state after.
    enter (Route.fromUrl url) (Route.actingAsParam url) { key = key, route = Route.NotFound, page = NotFoundPage, activeDevSection = defaultDevSection }



-- UPDATE


type Msg
    = LinkClicked Browser.UrlRequest
    | UrlChanged Url
    | MembersMsg Members.Msg
    | ToolsMsg ToolConsole.Msg
    | ScrollToSection String
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

        ( ScrollToSection sectionId, _ ) ->
            ( { model | activeDevSection = sectionId }, scrollToSection sectionId )

        ( NoOp, _ ) ->
            ( model, Cmd.none )

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

        -- A sub-message for a page we are no longer on (a late response): drop it.
        ( MembersMsg _, _ ) ->
            ( model, Cmd.none )

        ( ToolsMsg _, _ ) ->
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

        ( Route.Members, MembersPage _ ) ->
            ( { model | route = route }, Cmd.none )

        _ ->
            enter route Nothing model


{-| Build a route's page from scratch. For Tools, `actingAs` seeds the persona (only ever
`Just` on the initial deep link). -}
enter : Route -> Maybe String -> Model -> ( Model, Cmd Msg )
enter route actingAs model =
    case route of
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

        Route.NotFound ->
            ( { model | route = route, page = NotFoundPage }, Cmd.none )


{-| Scroll a Dev section to just under the sticky sub-nav (≈ filling the viewport, since a
section is sized to `100vh − sub-nav`). `Dom.getElement` gives the section's document Y; we
offset by the sub-nav height. A missing element (race) is a harmless no-op. -}
scrollToSection : String -> Cmd Msg
scrollToSection sectionId =
    Dom.getElement sectionId
        |> Task.andThen (\el -> Dom.setViewport 0 (el.element.y - subnavHeight))
        |> Task.attempt (\_ -> NoOp)


{-| Sub-nav height in px — matches `--subnav-h: 3rem` in index.html (1rem = 16px). -}
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


{-| The tool console is two-column and wants a wider page than the member-management forms. -}
wrapClass : Route -> String
wrapClass route =
    case route of
        Route.Tools _ ->
            "wrap wrap-wide"

        _ ->
            "wrap"


viewNav : Route -> Html Msg
viewNav route =
    nav [ class "nav" ]
        [ navLink "Admin" Route.Members (isAdmin route)
        , navLink "Dev · Tools" (Route.Tools Nothing) (isDev route)
        ]


navLink : String -> Route -> Bool -> Html Msg
navLink label route active =
    a [ Route.href route, classList [ ( "nav-link", True ), ( "active", active ) ] ] [ text label ]


isAdmin : Route -> Bool
isAdmin route =
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


viewPage : Model -> Html Msg
viewPage model =
    case model.page of
        MembersPage subModel ->
            Html.map MembersMsg (Members.view subModel)

        ToolsPage subModel ->
            -- Dev area: a sticky pill sub-nav over full-viewport sections (one today). Each
            -- section's id is its pill's scroll target.
            div []
                [ viewDevSubnav model.activeDevSection
                , section [ id "mcp-inspector", class "dev-section" ]
                    [ Html.map ToolsMsg (ToolConsole.view subModel) ]
                ]

        NotFoundPage ->
            div [ class "card" ] [ text "Not found." ]


viewDevSubnav : String -> Html Msg
viewDevSubnav activeId =
    nav [ class "subnav" ] (List.map (viewPill activeId) devSections)


viewPill : String -> { id : String, label : String } -> Html Msg
viewPill activeId sectionDef =
    button
        [ classList [ ( "pill", True ), ( "active", sectionDef.id == activeId ) ]
        , onClick (ScrollToSection sectionDef.id)
        ]
        [ text sectionDef.label ]



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
