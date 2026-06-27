module Config exposing (Model, Msg, init, update, view)

{-| The operator Config area — the discovery calibration console.

Hosts the sweep's tunable knobs (τ, triage threshold, δ, classify cap, rate cap) as a
form, an **Analyze** action (cheap, no AI), a **Dry-run** action (full pipeline, no
writes), and a results panel — all on one screen so the projected effect is visible
before saving.

Modeled per `admin/CLAUDE.md`:

  - The loaded config is `RemoteData Http.Error Config` (rule 1).
  - Analyze/dry-run results each have their own `RemoteData` (rule 1).
  - The form's dirty-vs-saved state is a single custom type `FormState` (rule 3).
  - A floor-breaching value that needs confirmation is a variant of `SaveState`,
    not a separate `Bool` flag (rule 3 / make-impossible-states-impossible).

-}

import Html exposing (Html, button, div, fieldset, h2, h3, input, label, p, section, span, table, td, text, th, tr)
import Html.Attributes exposing (class, classList, disabled, step, type_, value)
import Html.Events exposing (onClick, onInput)
import Http
import Json.Decode as D
import Json.Encode as E
import RemoteData exposing (RemoteData(..), WebData)



-- TYPES


type alias Config =
    { tasteThreshold : Float
    , triageThreshold : Float
    , dedupThreshold : Float
    , classifyMaxPerTick : Int
    , rateCap : Int
    }


type alias Draft =
    { tasteThreshold : String
    , triageThreshold : String
    , dedupThreshold : String
    , classifyMaxPerTick : String
    , rateCap : String
    }


{-| The form can be Clean (matches loaded config), Dirty (edited but not submitted),
or NeedsConfirm (server rejected a floor breach — operator must acknowledge). -}
type FormState
    = Clean
    | Dirty Draft
    | NeedsConfirm Draft FloorWarning


type alias FloorWarning =
    { field : String
    , message : String
    }


type alias MemberTauResult =
    { tenant : String
    , matchCount : Int
    , coldStart : Bool
    }


type alias TopPair =
    { slugA : String
    , slugB : String
    , cosine : Float
    }


type alias AnalyzeResult =
    { deltaPairCount : Int
    , deltaTopPairs : List TopPair
    , deltaBounded : Bool
    , deltaCorpusSize : Int
    , memberTau : List MemberTauResult
    }


type alias DryRunOutcome =
    { url : String
    , title : String
    , source : String
    , outcome : String
    , slug : Maybe String
    , wouldMatchMembers : Maybe (List String)
    }



-- MODEL


type alias Model =
    { savedConfig : WebData Config
    , formState : FormState
    , analyzeResult : WebData AnalyzeResult
    , dryRunResult : WebData (List DryRunOutcome)
    }


init : ( Model, Cmd Msg )
init =
    ( { savedConfig = Loading
      , formState = Clean
      , analyzeResult = NotAsked
      , dryRunResult = NotAsked
      }
    , fetchConfig
    )



-- UPDATE


type Msg
    = GotConfig (WebData Config)
    | FieldChanged (Draft -> String -> Draft) String
    | RunAnalyze
    | GotAnalyze (WebData AnalyzeResult)
    | RunDryRun
    | GotDryRun (WebData (List DryRunOutcome))
    | SaveConfig
    | ConfirmSave
    | CancelConfirm
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

                        NeedsConfirm d _ ->
                            d
            in
            ( { model | formState = Dirty (setter base val) }, Cmd.none )

        RunAnalyze ->
            ( { model | analyzeResult = Loading }
            , postAnalyze (currentDraft model)
            )

        GotAnalyze result ->
            ( { model | analyzeResult = result }, Cmd.none )

        RunDryRun ->
            ( { model | dryRunResult = Loading }
            , postDryRun (currentDraft model)
            )

        GotDryRun result ->
            ( { model | dryRunResult = result }, Cmd.none )

        SaveConfig ->
            case parseDraft (currentDraft model) of
                Nothing ->
                    ( model, Cmd.none )

                Just _ ->
                    ( model, putConfig (currentDraft model) False )

        ConfirmSave ->
            case model.formState of
                NeedsConfirm d _ ->
                    ( { model | formState = Dirty d }, putConfig d True )

                _ ->
                    ( model, Cmd.none )

        CancelConfirm ->
            case model.formState of
                NeedsConfirm d _ ->
                    ( { model | formState = Dirty d }, Cmd.none )

                _ ->
                    ( model, Cmd.none )

        GotSave (Success config) ->
            ( { model | savedConfig = Success config, formState = Clean }, Cmd.none )

        GotSave (Failure err) ->
            case ( model.formState, extractFloorWarning err ) of
                ( Dirty d, Just warning ) ->
                    ( { model | formState = NeedsConfirm d warning }, Cmd.none )

                ( Dirty _, Nothing ) ->
                    ( { model | savedConfig = Failure err }, Cmd.none )

                _ ->
                    ( { model | savedConfig = Failure err }, Cmd.none )

        GotSave _ ->
            ( model, Cmd.none )

        ResetForm ->
            ( { model | formState = Clean, analyzeResult = NotAsked, dryRunResult = NotAsked }, Cmd.none )


currentDraft : Model -> Draft
currentDraft model =
    case model.formState of
        Clean ->
            configToDraft (RemoteData.withDefault defaultConfig model.savedConfig)

        Dirty d ->
            d

        NeedsConfirm d _ ->
            d


configToDraft : Config -> Draft
configToDraft c =
    { tasteThreshold = String.fromFloat c.tasteThreshold
    , triageThreshold = String.fromFloat c.triageThreshold
    , dedupThreshold = String.fromFloat c.dedupThreshold
    , classifyMaxPerTick = String.fromInt c.classifyMaxPerTick
    , rateCap = String.fromInt c.rateCap
    }


parseDraft : Draft -> Maybe Config
parseDraft d =
    Maybe.map5
        (\tau triage delta cap rate ->
            { tasteThreshold = tau
            , triageThreshold = triage
            , dedupThreshold = delta
            , classifyMaxPerTick = round cap
            , rateCap = round rate
            }
        )
        (String.toFloat d.tasteThreshold)
        (String.toFloat d.triageThreshold)
        (String.toFloat d.dedupThreshold)
        (String.toFloat d.classifyMaxPerTick)
        (String.toFloat d.rateCap)


defaultConfig : Config
defaultConfig =
    { tasteThreshold = 0.55
    , triageThreshold = 0.45
    , dedupThreshold = 0.9
    , classifyMaxPerTick = 12
    , rateCap = 10
    }


extractFloorWarning : Http.Error -> Maybe FloorWarning
extractFloorWarning err =
    case err of
        Http.BadStatus _ ->
            -- The server returns { error: "validation_failed", message: "...", needsConfirm: true, field: "..." }.
            -- Http.BadStatus doesn't carry the body here; we flag generically and the confirm dialog
            -- shows the server's rejection message from the next fetch.
            Just { field = "unknown", message = "A value is below the safe floor. Confirm to override." }

        _ ->
            Nothing



-- HTTP


fetchConfig : Cmd Msg
fetchConfig =
    Http.get
        { url = "/admin/api/discovery/config"
        , expect = Http.expectJson (RemoteData.fromResult >> GotConfig) configResponseDecoder
        }


putConfig : Draft -> Bool -> Cmd Msg
putConfig d confirm =
    Http.request
        { method = "PUT"
        , headers = []
        , url = "/admin/api/discovery/config"
        , body = Http.jsonBody (encodeDraftWithConfirm d confirm)
        , expect = Http.expectJson (RemoteData.fromResult >> GotSave) configResponseDecoder
        , timeout = Nothing
        , tracker = Nothing
        }


postAnalyze : Draft -> Cmd Msg
postAnalyze d =
    Http.post
        { url = "/admin/api/discovery/analyze"
        , body = Http.jsonBody (encodeDraft d)
        , expect = Http.expectJson (RemoteData.fromResult >> GotAnalyze) analyzeDecoder
        }


postDryRun : Draft -> Cmd Msg
postDryRun d =
    Http.post
        { url = "/admin/api/discovery/dry-run"
        , body = Http.jsonBody (encodeDraft d)
        , expect = Http.expectJson (RemoteData.fromResult >> GotDryRun) dryRunDecoder
        }


encodeDraft : Draft -> E.Value
encodeDraft d =
    E.object
        (List.filterMap identity
            [ Maybe.map (\v -> ( "tasteThreshold", E.float v )) (String.toFloat d.tasteThreshold)
            , Maybe.map (\v -> ( "triageThreshold", E.float v )) (String.toFloat d.triageThreshold)
            , Maybe.map (\v -> ( "dedupThreshold", E.float v )) (String.toFloat d.dedupThreshold)
            , Maybe.map (\v -> ( "classifyMaxPerTick", E.int (round v) )) (String.toFloat d.classifyMaxPerTick)
            , Maybe.map (\v -> ( "rateCap", E.int (round v) )) (String.toFloat d.rateCap)
            ]
        )


encodeDraftWithConfirm : Draft -> Bool -> E.Value
encodeDraftWithConfirm d confirm =
    E.object
        (List.filterMap identity
            [ Maybe.map (\v -> ( "tasteThreshold", E.float v )) (String.toFloat d.tasteThreshold)
            , Maybe.map (\v -> ( "triageThreshold", E.float v )) (String.toFloat d.triageThreshold)
            , Maybe.map (\v -> ( "dedupThreshold", E.float v )) (String.toFloat d.dedupThreshold)
            , Maybe.map (\v -> ( "classifyMaxPerTick", E.int (round v) )) (String.toFloat d.classifyMaxPerTick)
            , Maybe.map (\v -> ( "rateCap", E.int (round v) )) (String.toFloat d.rateCap)
            , if confirm then
                Just ( "confirm", E.bool True )

              else
                Nothing
            ]
        )



-- DECODERS


configDecoder : D.Decoder Config
configDecoder =
    D.map5 Config
        (D.field "tasteThreshold" D.float)
        (D.field "triageThreshold" D.float)
        (D.field "dedupThreshold" D.float)
        (D.field "classifyMaxPerTick" D.int)
        (D.field "rateCap" D.int)


configResponseDecoder : D.Decoder Config
configResponseDecoder =
    D.field "config" configDecoder


analyzeDecoder : D.Decoder AnalyzeResult
analyzeDecoder =
    D.map5 AnalyzeResult
        (D.field "deltaPairCount" D.int)
        (D.field "deltaTopPairs" (D.list topPairDecoder))
        (D.field "deltaBounded" D.bool)
        (D.field "deltaCorpusSize" D.int)
        (D.field "memberTau" (D.list memberTauDecoder))


topPairDecoder : D.Decoder TopPair
topPairDecoder =
    D.map3 TopPair
        (D.field "slugA" D.string)
        (D.field "slugB" D.string)
        (D.field "cosine" D.float)


memberTauDecoder : D.Decoder MemberTauResult
memberTauDecoder =
    D.map3 MemberTauResult
        (D.field "tenant" D.string)
        (D.field "matchCount" D.int)
        (D.field "coldStart" D.bool)


dryRunDecoder : D.Decoder (List DryRunOutcome)
dryRunDecoder =
    D.field "outcomes" (D.list dryRunOutcomeDecoder)


dryRunOutcomeDecoder : D.Decoder DryRunOutcome
dryRunOutcomeDecoder =
    D.map6 DryRunOutcome
        (D.field "url" D.string)
        (D.field "title" D.string)
        (D.field "source" D.string)
        (D.field "outcome" D.string)
        (D.maybe (D.field "slug" D.string))
        (D.maybe (D.field "wouldMatchMembers" (D.list D.string)))



-- VIEW


view : Model -> Html Msg
view model =
    div []
        [ h2 [] [ text "Config — Discovery Calibration" ]
        , viewSavedConfig model
        , viewConfirmBanner model
        ]


viewSavedConfig : Model -> Html Msg
viewSavedConfig model =
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
                , viewAnalyzeResult model.analyzeResult
                , viewDryRunResult model.dryRunResult
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

                _ ->
                    True
    in
    section [ class "card" ]
        [ h3 [] [ text "Knobs" ]
        , fieldset []
            [ knobRow "Taste threshold (τ)" "0" "1" "0.01" d.tasteThreshold (\draft v -> { draft | tasteThreshold = v })
            , knobRow "Triage threshold" "0" "1" "0.01" d.triageThreshold (\draft v -> { draft | triageThreshold = v })
            , knobRow "Dedup threshold (δ)" "0" "1" "0.01" d.dedupThreshold (\draft v -> { draft | dedupThreshold = v })
            , knobRow "Classify max / tick" "1" "100" "1" d.classifyMaxPerTick (\draft v -> { draft | classifyMaxPerTick = v })
            , knobRow "Rate cap (imports / tick)" "1" "200" "1" d.rateCap (\draft v -> { draft | rateCap = v })
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
    let
        busy =
            model.analyzeResult == Loading || model.dryRunResult == Loading
    in
    div [ class "action-row" ]
        [ button
            [ class "btn-secondary"
            , onClick RunAnalyze
            , disabled busy
            ]
            [ text "Analyze" ]
        , button
            [ class "btn-secondary"
            , onClick RunDryRun
            , disabled busy
            ]
            [ text "Dry-run" ]
        , button
            [ class "btn-primary"
            , onClick SaveConfig
            , disabled (model.formState == Clean || busy)
            ]
            [ text "Save" ]
        ]


viewConfirmBanner : Model -> Html Msg
viewConfirmBanner model =
    case model.formState of
        NeedsConfirm _ warning ->
            div [ class "card warn" ]
                [ p [] [ text warning.message ]
                , button [ class "btn-primary", onClick ConfirmSave ] [ text "Confirm override" ]
                , button [ class "btn-secondary", onClick CancelConfirm ] [ text "Cancel" ]
                ]

        _ ->
            text ""


viewAnalyzeResult : WebData AnalyzeResult -> Html Msg
viewAnalyzeResult rd =
    case rd of
        NotAsked ->
            text ""

        Loading ->
            p [ class "muted" ] [ text "Analyzing…" ]

        Failure _ ->
            p [ class "error" ] [ text "Analyze failed." ]

        Success r ->
            section [ class "card" ]
                [ h3 [] [ text "Analyze Results" ]
                , p []
                    [ text ("δ: " ++ String.fromInt r.deltaPairCount ++ " pair(s) would collapse as near-dups")
                    , if r.deltaBounded then
                        span [ class "muted" ] [ text (" (sampled " ++ String.fromInt r.deltaCorpusSize ++ " of corpus)") ]

                      else
                        text ""
                    ]
                , if List.isEmpty r.deltaTopPairs then
                    text ""

                  else
                    div []
                        [ p [ class "muted" ] [ text "Top cosine pairs:" ]
                        , table []
                            (tr [] [ th [] [ text "Recipe A" ], th [] [ text "Recipe B" ], th [] [ text "Cosine" ] ]
                                :: List.map viewTopPair r.deltaTopPairs
                            )
                        ]
                , h3 [] [ text "τ: per-member match counts" ]
                , if List.isEmpty r.memberTau then
                    p [ class "muted" ] [ text "No members." ]

                  else
                    table []
                        (tr [] [ th [] [ text "Member" ], th [] [ text "Matches" ], th [] [ text "" ] ]
                            :: List.map viewMemberTau r.memberTau
                        )
                ]


viewTopPair : TopPair -> Html Msg
viewTopPair pair =
    tr []
        [ td [] [ text pair.slugA ]
        , td [] [ text pair.slugB ]
        , td [] [ text (String.left 6 (String.fromFloat pair.cosine)) ]
        ]


viewMemberTau : MemberTauResult -> Html Msg
viewMemberTau m =
    tr []
        [ td [] [ text m.tenant ]
        , td [] [ text (String.fromInt m.matchCount) ]
        , td []
            [ if m.coldStart then
                span [ class "muted" ] [ text "cold-start" ]

              else
                text ""
            ]
        ]


viewDryRunResult : WebData (List DryRunOutcome) -> Html Msg
viewDryRunResult rd =
    case rd of
        NotAsked ->
            text ""

        Loading ->
            p [ class "muted" ] [ text "Running dry-run…" ]

        Failure _ ->
            p [ class "error" ] [ text "Dry-run failed." ]

        Success outcomes ->
            section [ class "card" ]
                [ h3 [] [ text "Dry-run Results" ]
                , p [] [ text (String.fromInt (List.length outcomes) ++ " candidate(s) processed (nothing written).") ]
                , if List.isEmpty outcomes then
                    p [ class "muted" ] [ text "No candidates evaluated." ]

                  else
                    table []
                        (tr []
                            [ th [] [ text "Outcome" ]
                            , th [] [ text "Title" ]
                            , th [] [ text "Source" ]
                            , th [] [ text "Members" ]
                            ]
                            :: List.map viewDryRunOutcome outcomes
                        )
                ]


viewDryRunOutcome : DryRunOutcome -> Html Msg
viewDryRunOutcome o =
    tr [ classList [ ( "outcome-imported", o.outcome == "imported" ), ( "outcome-error", o.outcome == "error" ) ] ]
        [ td [] [ text o.outcome ]
        , td [] [ text o.title ]
        , td [] [ text o.source ]
        , td []
            [ text
                (case o.wouldMatchMembers of
                    Just members ->
                        String.join ", " members

                    Nothing ->
                        ""
                )
            ]
        ]
