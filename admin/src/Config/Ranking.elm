module Config.Ranking exposing (Model, Msg, init, update, view)

{-| Operator Config — ranking weights knob form.

Backed by GET/PUT /admin/api/operator-config. Fields: Favorite weight, Novelty
boost, Pantry weight, Perish weight, Key weight (all float 0–2), Overlap cap
(int 1–10).

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
    { favoriteWeight : Float
    , noveltyBoost : Float
    , pantryWeight : Float
    , perishWeight : Float
    , keyWeight : Float
    , overlapCap : Int
    }


type alias Draft =
    { favoriteWeight : String
    , noveltyBoost : String
    , pantryWeight : String
    , perishWeight : String
    , keyWeight : String
    , overlapCap : String
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


configToDraft : Config -> Draft
configToDraft c =
    { favoriteWeight = String.fromFloat c.favoriteWeight
    , noveltyBoost = String.fromFloat c.noveltyBoost
    , pantryWeight = String.fromFloat c.pantryWeight
    , perishWeight = String.fromFloat c.perishWeight
    , keyWeight = String.fromFloat c.keyWeight
    , overlapCap = String.fromInt c.overlapCap
    }


defaultConfig : Config
defaultConfig =
    { favoriteWeight = 0.15
    , noveltyBoost = 0.1
    , pantryWeight = 0.12
    , perishWeight = 1.0
    , keyWeight = 0.4
    , overlapCap = 2
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


encodeDraft : Draft -> E.Value
encodeDraft d =
    E.object
        (List.filterMap identity
            [ Maybe.map (\v -> ( "favoriteWeight", E.float v )) (String.toFloat d.favoriteWeight)
            , Maybe.map (\v -> ( "noveltyBoost", E.float v )) (String.toFloat d.noveltyBoost)
            , Maybe.map (\v -> ( "pantryWeight", E.float v )) (String.toFloat d.pantryWeight)
            , Maybe.map (\v -> ( "perishWeight", E.float v )) (String.toFloat d.perishWeight)
            , Maybe.map (\v -> ( "keyWeight", E.float v )) (String.toFloat d.keyWeight)
            , Maybe.map (\v -> ( "overlapCap", E.int (round v) )) (String.toFloat d.overlapCap)
            ]
        )



-- DECODERS


configDecoder : D.Decoder Config
configDecoder =
    D.map6 Config
        (D.field "favoriteWeight" D.float)
        (D.field "noveltyBoost" D.float)
        (D.field "pantryWeight" D.float)
        (D.field "perishWeight" D.float)
        (D.field "keyWeight" D.float)
        (D.field "overlapCap" D.int)


configResponseDecoder : D.Decoder Config
configResponseDecoder =
    D.field "config" configDecoder



-- VIEW


view : Model -> Html Msg
view model =
    div []
        [ h2 [] [ text "Config — Ranking Weights" ]
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
        [ h3 [] [ text "Weights" ]
        , fieldset []
            [ knobRow "Favorite weight" "0" "2" "0.01" d.favoriteWeight (\draft v -> { draft | favoriteWeight = v })
            , knobRow "Novelty boost" "0" "2" "0.01" d.noveltyBoost (\draft v -> { draft | noveltyBoost = v })
            , knobRow "Pantry weight" "0" "2" "0.01" d.pantryWeight (\draft v -> { draft | pantryWeight = v })
            , knobRow "Perish weight" "0" "2" "0.01" d.perishWeight (\draft v -> { draft | perishWeight = v })
            , knobRow "Key weight" "0" "2" "0.01" d.keyWeight (\draft v -> { draft | keyWeight = v })
            , knobRow "Overlap cap" "1" "20" "1" d.overlapCap (\draft v -> { draft | overlapCap = v })
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
