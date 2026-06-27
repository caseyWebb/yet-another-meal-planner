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
import Browser.Navigation as Nav
import Dev.ToolConsole as ToolConsole
import Html exposing (Html, a, div, h1, nav, text)
import Html.Attributes exposing (class, classList)
import Route exposing (Route)
import Url exposing (Url)



-- MODEL


type alias Model =
    { key : Nav.Key
    , route : Route
    , page : Page
    }


{-| The live page and its state, as one value — you cannot be on one page holding
another's model. -}
type Page
    = MembersPage Members.Model
    | ToolsPage ToolConsole.Model
    | NotFoundPage


init : () -> Url -> Nav.Key -> ( Model, Cmd Msg )
init _ url key =
    -- `?as=` seeds the Dev workbench's persona on a deep link; it is model state after.
    enter (Route.fromUrl url) (Route.actingAsParam url) { key = key, route = Route.NotFound, page = NotFoundPage }



-- UPDATE


type Msg
    = LinkClicked Browser.UrlRequest
    | UrlChanged Url
    | MembersMsg Members.Msg
    | ToolsMsg ToolConsole.Msg


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case ( msg, model.page ) of
        ( LinkClicked (Browser.Internal url), _ ) ->
            ( model, Nav.pushUrl model.key (Url.toString url) )

        ( LinkClicked (Browser.External href), _ ) ->
            ( model, Nav.load href )

        ( UrlChanged url, _ ) ->
            stepTo (Route.fromUrl url) model

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
            Html.map ToolsMsg (ToolConsole.view subModel)

        NotFoundPage ->
            div [ class "card" ] [ text "Not found." ]



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
