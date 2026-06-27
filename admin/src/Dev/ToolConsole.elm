module Dev.ToolConsole exposing (Model, Msg, init, needsConfirm, selectTool, update, view)

{-| The Dev area's MCP tool console: inspect the live tool surface and invoke any tool AS
a chosen member, the credential-free in-panel analog of the stock MCP Inspector (the
operator is already Access-authenticated; "acting as" replaces the OAuth token).

Modeling discipline (see ../CLAUDE.md):

  - the workbench is `NoPersona | Acting Session`, so "invoke a tool with no persona
    selected" is unrepresentable — the run controls only exist inside `Acting`;
  - the invocation channel's failure carries its type (`InvokeError`), distinguishing a
    LOCAL bad-JSON-in-the-args-box from a transport failure;
  - catalog + result are `WebData`/`RemoteData`, never loading/error/data triples.

Safety rides the persona axis: a `test-`/`sandbox-` persona is a throwaway and runs
immediately; a real member requires an explicit confirm before the side effects fire.

-}

import Dev.Jsonc as Jsonc
import Dev.SchemaExample as SchemaExample
import Html exposing (Html, a, button, div, h2, label, li, option, p, pre, select, span, strong, text, textarea, ul)
import Html.Attributes exposing (attribute, class, classList, disabled, selected, value)
import Html.Events exposing (onClick, onInput)
import Http
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode
import RemoteData exposing (RemoteData(..), WebData)
import Route
import Url



-- MODEL


type alias Tool =
    { name : String
    , description : String
    , schema : Encode.Value
    }


type alias Invocation =
    { isError : Bool
    , result : Encode.Value
    }


{-| The invocation channel's failure: a LOCAL bad-JSON args box (nothing was sent), or the
request itself failing. Kept distinct so each renders with its own context.
-}
type InvokeError
    = BadArgsJson String
    | Transport Http.Error


{-| Run lifecycle for the open tool. `Ready` is composing args (showing the prior result,
if any); `Confirming` stages a real-member run awaiting explicit Confirm/Cancel.
-}
type Run
    = Ready (RemoteData InvokeError Invocation)
    | Confirming


{-| The arguments buffer. `Pristine` means untouched — the box shows a schema-derived example
*derived in the view* from the selected tool, so it costs no `Msg` and fills in the instant
the catalog resolves (no clobbering a slow load). The operator's first keystroke captures the
text as `Edited`; selecting another tool returns to `Pristine` and reseeds.
-}
type Args
    = Pristine
    | Edited String


type alias Session =
    { members : List String
    , persona : String
    , catalog : WebData (List Tool)
    , selected : Maybe String
    , args : Args
    , run : Run
    }


type Model
    = NoPersona (WebData (List String))
    | Acting Session


init : { persona : Maybe String, tool : Maybe String } -> ( Model, Cmd Msg )
init { persona, tool } =
    case persona of
        Nothing ->
            ( NoPersona Loading, fetchMembers )

        Just p ->
            ( Acting (freshSession [] p tool), Cmd.batch [ fetchMembers, fetchCatalog p ] )


freshSession : List String -> String -> Maybe String -> Session
freshSession members persona tool =
    { members = members
    , persona = persona
    , catalog = Loading
    , selected = tool
    , args = Pristine
    , run = Ready NotAsked
    }


{-| Reopen a (possibly different) tool while staying on the console — the shell calls this
on an in-app navigation, preserving the persona + loaded catalog and just resetting the
args box and result for the newly-selected tool.
-}
selectTool : Maybe String -> Model -> ( Model, Cmd Msg )
selectTool tool model =
    case model of
        Acting session ->
            ( Acting { session | selected = tool, args = Pristine, run = Ready NotAsked }, Cmd.none )

        NoPersona _ ->
            ( model, Cmd.none )



-- UPDATE


type Msg
    = GotMembers (WebData (List String))
    | PersonaChosen String
    | GotCatalog (WebData (List Tool))
    | ArgsChanged String
    | ClickRun
    | ConfirmRun
    | CancelRun
    | GotResult (RemoteData InvokeError Invocation)


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        GotMembers members ->
            case model of
                NoPersona _ ->
                    ( NoPersona members, Cmd.none )

                Acting session ->
                    ( Acting { session | members = RemoteData.withDefault session.members members }, Cmd.none )

        PersonaChosen persona ->
            if persona == "" then
                ( model, Cmd.none )

            else
                ( Acting (freshSession (currentMembers model) persona Nothing), fetchCatalog persona )

        GotCatalog catalog ->
            withSession model (\session -> ( { session | catalog = catalog }, Cmd.none ))

        ArgsChanged args ->
            withSession model (\session -> ( { session | args = Edited args }, Cmd.none ))

        ClickRun ->
            case model of
                Acting session ->
                    if needsConfirm session.persona then
                        ( Acting { session | run = Confirming }, Cmd.none )

                    else
                        attemptRun session

                NoPersona _ ->
                    ( model, Cmd.none )

        ConfirmRun ->
            case model of
                Acting session ->
                    attemptRun session

                NoPersona _ ->
                    ( model, Cmd.none )

        CancelRun ->
            withSession model (\session -> ( { session | run = Ready NotAsked }, Cmd.none ))

        GotResult result ->
            withSession model (\session -> ( { session | run = Ready result }, Cmd.none ))


{-| Apply a session update only when actually acting (a no-op without a persona). -}
withSession : Model -> (Session -> ( Session, Cmd Msg )) -> ( Model, Cmd Msg )
withSession model f =
    case model of
        Acting session ->
            let
                ( session2, cmd ) =
                    f session
            in
            ( Acting session2, cmd )

        NoPersona _ ->
            ( model, Cmd.none )


currentMembers : Model -> List String
currentMembers model =
    case model of
        NoPersona members ->
            RemoteData.withDefault [] members

        Acting session ->
            session.members


attemptRun : Session -> ( Model, Cmd Msg )
attemptRun session =
    case session.selected of
        Nothing ->
            ( Acting session, Cmd.none )

        Just tool ->
            case Decode.decodeString Decode.value (Jsonc.strip (argsText session tool)) of
                Err err ->
                    ( Acting { session | run = Ready (Failure (BadArgsJson (Decode.errorToString err))) }, Cmd.none )

                Ok argsValue ->
                    ( Acting { session | run = Ready Loading }, invoke session.persona tool argsValue )


{-| The text the args box shows for `tool`: the operator's buffer once edited, else the
example derived from that tool's input schema (the empty object until the catalog resolves).
-}
argsText : Session -> String -> String
argsText session tool =
    case session.args of
        Edited text ->
            text

        Pristine ->
            SchemaExample.generate (schemaFor session tool)


schemaFor : Session -> String -> Encode.Value
schemaFor session tool =
    RemoteData.toMaybe session.catalog
        |> Maybe.andThen (find (\t -> t.name == tool))
        |> Maybe.map .schema
        |> Maybe.withDefault Encode.null


{-| The safety contract: running a tool as a REAL member needs an explicit confirm; a
throwaway `test-`/`sandbox-` persona does not. Exposed because it is the rule the run gate
turns on — pinned by `tests/ToolConsoleTest.elm` so the bypass convention can't drift
silently.
-}
needsConfirm : String -> Bool
needsConfirm persona =
    not (isTestPersona persona)


isTestPersona : String -> Bool
isTestPersona persona =
    String.startsWith "test-" persona || String.startsWith "sandbox-" persona



-- HTTP


fetchMembers : Cmd Msg
fetchMembers =
    Http.get
        { url = "/admin/api/tenants"
        , expect = Http.expectJson (RemoteData.fromResult >> GotMembers) tenantsDecoder
        }


fetchCatalog : String -> Cmd Msg
fetchCatalog persona =
    Http.get
        { url = "/admin/api/tools?tenant=" ++ Url.percentEncode persona
        , expect = Http.expectJson (RemoteData.fromResult >> GotCatalog) catalogDecoder
        }


invoke : String -> String -> Encode.Value -> Cmd Msg
invoke persona tool argsValue =
    Http.post
        { url = "/admin/api/tools/" ++ Url.percentEncode tool
        , body = Http.jsonBody (Encode.object [ ( "tenant", Encode.string persona ), ( "arguments", argsValue ) ])
        , expect = Http.expectJson gotInvocation invocationDecoder
        }


gotInvocation : Result Http.Error Invocation -> Msg
gotInvocation result =
    GotResult (RemoteData.fromResult (Result.mapError Transport result))


tenantsDecoder : Decoder (List String)
tenantsDecoder =
    Decode.field "tenants" (Decode.list Decode.string)


catalogDecoder : Decoder (List Tool)
catalogDecoder =
    Decode.field "tools" (Decode.list toolDecoder)


toolDecoder : Decoder Tool
toolDecoder =
    Decode.map3 Tool
        (Decode.field "name" Decode.string)
        (Decode.oneOf [ Decode.field "description" Decode.string, Decode.succeed "" ])
        (Decode.oneOf [ Decode.field "inputSchema" Decode.value, Decode.succeed Encode.null ])


invocationDecoder : Decoder Invocation
invocationDecoder =
    Decode.map2 Invocation
        (Decode.field "isError" Decode.bool)
        (Decode.field "result" Decode.value)


httpError : Http.Error -> String
httpError error =
    case error of
        Http.BadUrl url ->
            "bad URL " ++ url

        Http.Timeout ->
            "the request timed out"

        Http.NetworkError ->
            "network error — is the Worker reachable?"

        Http.BadStatus 403 ->
            "forbidden (403) — your Cloudflare Access session is missing or expired"

        Http.BadStatus 404 ->
            "not found (404) — the admin surface may be disabled (ACCESS_* unset)"

        Http.BadStatus status ->
            "HTTP " ++ String.fromInt status

        Http.BadBody detail ->
            "unexpected response: " ++ detail



-- VIEW


view : Model -> Html Msg
view model =
    div [ class "card console" ]
        [ viewPersonaBar model
        , viewBody model
        ]


viewPersonaBar : Model -> Html Msg
viewPersonaBar model =
    let
        current =
            case model of
                Acting session ->
                    Just session.persona

                NoPersona _ ->
                    Nothing
    in
    div [ class "persona-bar" ]
        [ span [ class "persona-label" ]
            [ text "acting as "
            , case current of
                Just persona ->
                    strong [ classList [ ( "persona", True ), ( "real", needsConfirm persona ) ] ]
                        [ text persona ]

                Nothing ->
                    span [ class "muted" ] [ text "— none —" ]
            ]
        , personaSelect (currentMembers model) current
        ]


personaSelect : List String -> Maybe String -> Html Msg
personaSelect members current =
    select [ onInput PersonaChosen ]
        (option [ value "", selected (current == Nothing) ] [ text "— choose a persona —" ]
            :: List.map (personaOption current) members
        )


personaOption : Maybe String -> String -> Html Msg
personaOption current name =
    option [ value name, selected (current == Just name) ] [ text name ]


viewBody : Model -> Html Msg
viewBody model =
    case model of
        NoPersona members ->
            case members of
                Loading ->
                    p [ class "muted" ] [ text "Loading members…" ]

                Failure err ->
                    div [ class "error" ] [ text ("Could not load members: " ++ httpError err) ]

                Success [] ->
                    p [ class "muted" ] [ text "No members yet — onboard one on the Members tab first." ]

                _ ->
                    p [ class "muted" ] [ text "Pick a persona above to inspect and run tools as that member." ]

        Acting session ->
            div [ class "workbench" ]
                [ viewCatalog session
                , viewTool session
                ]


viewCatalog : Session -> Html Msg
viewCatalog session =
    div [ class "catalog" ]
        [ case session.catalog of
            Loading ->
                p [ class "muted" ] [ text "Loading tools…" ]

            Failure err ->
                div [ class "error" ] [ text ("Could not load tools: " ++ httpError err) ]

            Success tools ->
                ul [ class "tool-list" ] (List.map (viewToolItem session.selected) tools)

            NotAsked ->
                text ""
        ]


viewToolItem : Maybe String -> Tool -> Html Msg
viewToolItem selected tool =
    li [ classList [ ( "tool-item", True ), ( "active", selected == Just tool.name ) ] ]
        [ a [ Route.href (Route.Tools (Just tool.name)), class "tool-name" ] [ text tool.name ]
        , p [ class "tool-desc" ] [ text tool.description ]
        ]


viewTool : Session -> Html Msg
viewTool session =
    case session.selected of
        Nothing ->
            div [ class "tool-detail muted" ] [ text "Select a tool from the list to inspect and run it." ]

        Just name ->
            div [ class "tool-detail" ]
                [ h2 [] [ text name ]
                , viewSchema (RemoteData.toMaybe session.catalog |> Maybe.andThen (find (\t -> t.name == name)))
                , label []
                    [ text "Arguments (JSON — // comments and trailing commas OK)"
                    , textarea
                        [ class "args"
                        , value (argsText session name)
                        , onInput ArgsChanged
                        , attribute "spellcheck" "false"
                        ]
                        []
                    ]
                , viewRunControls session
                , viewResult session.run
                ]


viewSchema : Maybe Tool -> Html Msg
viewSchema tool =
    case tool of
        Just t ->
            div [ class "schema" ]
                [ span [ class "schema-label" ] [ text "input schema" ]
                , pre [] [ text (Encode.encode 2 t.schema) ]
                ]

        Nothing ->
            text ""


viewRunControls : Session -> Html Msg
viewRunControls session =
    case session.run of
        Confirming ->
            div [ class "confirm" ]
                [ p []
                    [ text "Run "
                    , strong [] [ text (Maybe.withDefault "" session.selected) ]
                    , text " as real member "
                    , strong [] [ text session.persona ]
                    , text "? This performs the tool's real side effects."
                    ]
                , button [ class "danger-solid", onClick ConfirmRun ] [ text "Yes, run it" ]
                , button [ class "link", onClick CancelRun ] [ text "Cancel" ]
                ]

        Ready remote ->
            div [ class "run" ]
                [ button [ onClick ClickRun, disabled (isLoading remote) ]
                    [ text
                        (if isLoading remote then
                            "Running…"

                         else
                            "Run"
                        )
                    ]
                , if needsConfirm session.persona then
                    span [ class "muted small" ] [ text " real member — confirms first" ]

                  else
                    span [ class "muted small" ] [ text " test persona — runs immediately" ]
                ]


isLoading : RemoteData e a -> Bool
isLoading remote =
    case remote of
        Loading ->
            True

        _ ->
            False


viewResult : Run -> Html Msg
viewResult run =
    case run of
        Confirming ->
            text ""

        Ready remote ->
            case remote of
                NotAsked ->
                    text ""

                Loading ->
                    text ""

                Failure (BadArgsJson detail) ->
                    div [ class "error" ]
                        [ strong [] [ text "Invalid JSON arguments — nothing was sent. " ]
                        , text detail
                        ]

                Failure (Transport err) ->
                    div [ class "error" ] [ text ("Request failed: " ++ httpError err) ]

                Success invocation ->
                    div [ classList [ ( "result", True ), ( "error", invocation.isError ) ] ]
                        [ pre [] [ text (Encode.encode 2 invocation.result) ] ]


find : (a -> Bool) -> List a -> Maybe a
find pred list =
    case list of
        [] ->
            Nothing

        x :: xs ->
            if pred x then
                Just x

            else
                find pred xs
