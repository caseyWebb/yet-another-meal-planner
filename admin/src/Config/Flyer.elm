module Config.Flyer exposing (Model, Msg, init, update, view)

{-| Operator Config — flyer knob form.

Backed by GET/PUT /admin/api/operator-config. Fields: Min discount % (displayed
as a percentage 0–100, stored as a fraction 0–1), Refresh interval hours
(int 1–168), Batch units (int 1–50).

Modeled per admin/CLAUDE.md:

  - savedConfig : WebData Config (rule 1)
  - formState : FormState — Clean | Dirty (rule 3)
  - Save button disabled when Clean (derived, not stored — rule 4)

-}

import Html exposing (Html, button, div, fieldset, h2, h3, input, label, p, section, text)
import Html.Attributes exposing (class, disabled, step, type_, value)
import Html.Events exposing (onClick, onInput)
import Http
import Json.Decode as D
import Json.Encode as E
import RemoteData exposing (RemoteData(..), WebData)



-- TYPES


type alias Config =
    { minFlyerDiscount : Float
    , flyerRefreshHours : Int
    , flyerBatchUnits : Int
    }


{-| Draft stores minFlyerDiscount as a percentage string (e.g. "5" for 0.05),
converted on encode and decode. -}
type alias Draft =
    { minFlyerDiscountPct : String
    , flyerRefreshHours : String
    , flyerBatchUnits : String
    }


type FormState
    = Clean
    | Dirty Draft



-- MODEL


type alias Model =
    { savedConfig : WebData Config
    , formState : FormState
    }


init : ( Model, Cmd Msg )
init =
    ( { savedConfig = Loading, formState = Clean }, fetchConfig )



-- UPDATE


type Msg
    = GotConfig (WebData Config)
    | FieldChanged (Draft -> String -> Draft) String
    | SaveConfig
    | GotSave (WebData Config)
    | ResetForm


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        GotConfig result ->
            ( { model | savedConfig = result, formState = Clean }, Cmd.none )

        FieldChanged setter val ->
            let
                base =
                    case model.formState of
                        Clean ->
                            configToDraft (RemoteData.withDefault defaultConfig model.savedConfig)

                        Dirty d ->
                            d
            in
            ( { model | formState = Dirty (setter base val) }, Cmd.none )

        SaveConfig ->
            case model.formState of
                Clean ->
                    ( model, Cmd.none )

                Dirty d ->
                    ( model, putConfig d )

        GotSave (Success config) ->
            ( { model | savedConfig = Success config, formState = Clean }, Cmd.none )

        GotSave (Failure err) ->
            ( { model | savedConfig = Failure err }, Cmd.none )

        GotSave _ ->
            ( model, Cmd.none )

        ResetForm ->
            ( { model | formState = Clean }, Cmd.none )


currentDraft : Model -> Draft
currentDraft model =
    case model.formState of
        Clean ->
            configToDraft (RemoteData.withDefault defaultConfig model.savedConfig)

        Dirty d ->
            d


{-| Convert stored fraction → display percentage (0.05 → "5"). -}
configToDraft : Config -> Draft
configToDraft c =
    { minFlyerDiscountPct = String.fromFloat (c.minFlyerDiscount * 100)
    , flyerRefreshHours = String.fromInt c.flyerRefreshHours
    , flyerBatchUnits = String.fromInt c.flyerBatchUnits
    }


defaultConfig : Config
defaultConfig =
    { minFlyerDiscount = 0.05
    , flyerRefreshHours = 24
    , flyerBatchUnits = 12
    }



-- HTTP


fetchConfig : Cmd Msg
fetchConfig =
    Http.get
        { url = "/admin/api/operator-config"
        , expect = Http.expectJson (RemoteData.fromResult >> GotConfig) configResponseDecoder
        }


putConfig : Draft -> Cmd Msg
putConfig d =
    Http.request
        { method = "PUT"
        , headers = []
        , url = "/admin/api/operator-config"
        , body = Http.jsonBody (encodeDraft d)
        , expect = Http.expectJson (RemoteData.fromResult >> GotSave) configResponseDecoder
        , timeout = Nothing
        , tracker = Nothing
        }


{-| Encode the draft, converting display percentage back to a fraction. -}
encodeDraft : Draft -> E.Value
encodeDraft d =
    E.object
        (List.filterMap identity
            [ Maybe.map (\v -> ( "minFlyerDiscount", E.float (v / 100) )) (String.toFloat d.minFlyerDiscountPct)
            , Maybe.map (\v -> ( "flyerRefreshHours", E.int (round v) )) (String.toFloat d.flyerRefreshHours)
            , Maybe.map (\v -> ( "flyerBatchUnits", E.int (round v) )) (String.toFloat d.flyerBatchUnits)
            ]
        )



-- DECODERS


configDecoder : D.Decoder Config
configDecoder =
    D.map3 Config
        (D.field "minFlyerDiscount" D.float)
        (D.field "flyerRefreshHours" D.int)
        (D.field "flyerBatchUnits" D.int)


configResponseDecoder : D.Decoder Config
configResponseDecoder =
    D.field "config" configDecoder



-- VIEW


view : Model -> Html Msg
view model =
    div []
        [ h2 [] [ text "Config — Flyer" ]
        , viewContent model
        ]


viewContent : Model -> Html Msg
viewContent model =
    case model.savedConfig of
        NotAsked ->
            text ""

        Loading ->
            p [ class "muted" ] [ text "Loading config…" ]

        Failure _ ->
            p [ class "error" ] [ text "Failed to load config." ]

        Success _ ->
            div []
                [ viewKnobForm model
                , viewActionButtons model
                ]


viewKnobForm : Model -> Html Msg
viewKnobForm model =
    let
        d =
            currentDraft model

        isDirty =
            case model.formState of
                Clean ->
                    False

                Dirty _ ->
                    True
    in
    section [ class "card" ]
        [ h3 [] [ text "Flyer settings" ]
        , fieldset []
            [ knobRow "Min discount %" "0" "100" "1" d.minFlyerDiscountPct (\draft v -> { draft | minFlyerDiscountPct = v })
            , knobRow "Refresh interval (hours)" "1" "168" "1" d.flyerRefreshHours (\draft v -> { draft | flyerRefreshHours = v })
            , knobRow "Batch units" "1" "50" "1" d.flyerBatchUnits (\draft v -> { draft | flyerBatchUnits = v })
            ]
        , if isDirty then
            button [ class "btn-secondary", onClick ResetForm ] [ text "Reset" ]

          else
            text ""
        ]


knobRow : String -> String -> String -> String -> String -> (Draft -> String -> Draft) -> Html Msg
knobRow lbl mn mx stp val setter =
    div [ class "form-row" ]
        [ label [] [ text lbl ]
        , input
            [ type_ "number"
            , Html.Attributes.min mn
            , Html.Attributes.max mx
            , step stp
            , value val
            , onInput (FieldChanged setter)
            ]
            []
        ]


viewActionButtons : Model -> Html Msg
viewActionButtons model =
    div [ class "action-row" ]
        [ button
            [ class "btn-primary"
            , onClick SaveConfig
            , disabled (model.formState == Clean)
            ]
            [ text "Save" ]
        ]
