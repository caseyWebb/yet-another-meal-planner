module Config exposing (Model, Msg, init, goto, update, view)

{-| The operator Config area shell (operator-admin): a sub-navigated area whose default
sub-view is the discovery **calibration** console and whose other five sub-views are the
shared-corpus **editors** (aliases, flyer terms, feeds, discovery senders/members), each a
`Config.TableEditor` instance. It owns a sticky pill sub-nav across the six sub-views and
delegates to each — mirroring the `Data` area shell.

The live sub-view AND its state are one `Section` value (a page owns its model), so being
"on the Feeds editor holding the calibration console's state" is unrepresentable. The
selected sub-route rides the URL (`Route.ConfigRoute`), so each sub-view deep-links.

-}

import Config.Calibration as Calibration
import Config.TableEditor as TableEditor exposing (EditorConfig, FieldKind(..))
import Html exposing (Html, a, div, text)
import Html.Attributes exposing (class, classList)
import Route exposing (ConfigRoute(..))



-- MODEL


{-| The live Config sub-view and its state, as one value. All five editors share the
`EditorS` variant (they differ only by their `EditorConfig`); the selected `ConfigRoute`
in the model distinguishes which editor is live. -}
type Section
    = CalibrationS Calibration.Model
    | EditorS TableEditor.Model


type alias Model =
    { route : ConfigRoute, section : Section }



-- EDITOR CONFIGS (one per shared-corpus table)


aliasesConfig : EditorConfig
aliasesConfig =
    { title = "Ingredient aliases"
    , slug = "aliases"
    , pkColumn = "variant"
    , addFields =
        [ { key = "variant", label = "Variant", kind = Text, required = True }
        , { key = "canonical", label = "Canonical", kind = Text, required = True }
        ]
    , testUrlColumn = Nothing
    }


flyerTermsConfig : EditorConfig
flyerTermsConfig =
    { title = "Flyer terms"
    , slug = "flyer-terms"
    , pkColumn = "term"
    , addFields = [ { key = "term", label = "Term", kind = Text, required = True } ]
    , testUrlColumn = Nothing
    }


feedsConfig : EditorConfig
feedsConfig =
    { title = "Discovery feeds"
    , slug = "feeds"
    , pkColumn = "url"
    , addFields =
        [ { key = "url", label = "URL", kind = Text, required = True }
        , { key = "name", label = "Name", kind = Text, required = False }
        , { key = "weight", label = "Weight", kind = Number, required = False }
        , { key = "tags", label = "Tags", kind = Tags, required = False }
        ]
    , testUrlColumn = Just "url"
    }


sendersConfig : EditorConfig
sendersConfig =
    { title = "Newsletter senders"
    , slug = "senders"
    , pkColumn = "address"
    , addFields =
        [ { key = "address", label = "Address", kind = Text, required = True }
        , { key = "name", label = "Name", kind = Text, required = False }
        ]
    , testUrlColumn = Nothing
    }


membersConfig : EditorConfig
membersConfig =
    { title = "Discovery members"
    , slug = "members"
    , pkColumn = "address"
    , addFields = [ { key = "address", label = "Address", kind = Text, required = True } ]
    , testUrlColumn = Nothing
    }


configFor : ConfigRoute -> Maybe EditorConfig
configFor configRoute =
    case configRoute of
        ConfigCalibration ->
            Nothing

        ConfigAliases ->
            Just aliasesConfig

        ConfigFlyerTerms ->
            Just flyerTermsConfig

        ConfigFeeds ->
            Just feedsConfig

        ConfigSenders ->
            Just sendersConfig

        ConfigMembers ->
            Just membersConfig



-- INIT / NAV


{-| Build the Config area for a sub-route from scratch. -}
init : ConfigRoute -> ( Model, Cmd Msg )
init configRoute =
    case configFor configRoute of
        Nothing ->
            wrap CalibrationS CalibrationMsg configRoute Calibration.init

        Just config ->
            wrap EditorS EditorMsg configRoute (TableEditor.init config)


wrap : (sub -> Section) -> (subMsg -> Msg) -> ConfigRoute -> ( sub, Cmd subMsg ) -> ( Model, Cmd Msg )
wrap toSection toMsg configRoute ( sub, cmd ) =
    ( { route = configRoute, section = toSection sub }, Cmd.map toMsg cmd )


{-| Navigate to a sub-route, preserving the live sub-view's state when it is the SAME
sub-view (so re-selecting the current pill is a no-op that keeps loaded rows); otherwise
build the target fresh. -}
goto : ConfigRoute -> Model -> ( Model, Cmd Msg )
goto configRoute model =
    if configRoute == model.route then
        ( { model | route = configRoute }, Cmd.none )

    else
        init configRoute



-- UPDATE


type Msg
    = CalibrationMsg Calibration.Msg
    | EditorMsg TableEditor.Msg


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case ( msg, model.section ) of
        ( CalibrationMsg sub, CalibrationS m ) ->
            wrap CalibrationS CalibrationMsg model.route (Calibration.update sub m)

        ( EditorMsg sub, EditorS m ) ->
            wrap EditorS EditorMsg model.route (TableEditor.update sub m)

        -- A sub-message for a sub-view we are no longer on (a late response): drop it.
        ( CalibrationMsg _, _ ) ->
            ( model, Cmd.none )

        ( EditorMsg _, _ ) ->
            ( model, Cmd.none )



-- VIEW


view : Model -> Html Msg
view model =
    div []
        [ viewSubnav model.route
        , viewSection model.section
        ]


viewSubnav : ConfigRoute -> Html Msg
viewSubnav active =
    div [ class "data-nav" ] (List.map (viewTab active) tabs)


tabs : List ( String, ConfigRoute )
tabs =
    [ ( "Calibration", ConfigCalibration )
    , ( "Aliases", ConfigAliases )
    , ( "Flyer terms", ConfigFlyerTerms )
    , ( "Feeds", ConfigFeeds )
    , ( "Senders", ConfigSenders )
    , ( "Members", ConfigMembers )
    ]


viewTab : ConfigRoute -> ( String, ConfigRoute ) -> Html Msg
viewTab active ( label, configRoute ) =
    a
        [ classList [ ( "pill", True ), ( "active", active == configRoute ) ]
        , Route.href (Route.Config configRoute)
        ]
        [ text label ]


viewSection : Section -> Html Msg
viewSection section =
    case section of
        CalibrationS m ->
            Html.map CalibrationMsg (Calibration.view m)

        EditorS m ->
            Html.map EditorMsg (TableEditor.view m)
