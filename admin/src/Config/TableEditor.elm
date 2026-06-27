module Config.TableEditor exposing
    ( EditorConfig, Field, FieldKind(..)
    , Model, Msg(..), init, update, view
    , Operation(..), ActionState(..), rowKey, isBusy, encodeAdd
    )

{-| A generic add/remove editor for one group-wide shared-corpus table (operator-admin).
The five Config editors (aliases, flyer terms, feeds, discovery senders/members) are five
instances of this module, each configured by an `EditorConfig` (its title, URL slug, the
primary-key column, and the add-form fields). It is the writable companion to the read-only
`Data.Table` browser — and it reuses that module's `{table, columns, rows}` response shape
(`Data.Table.tablePageDecoder` / `renderCell`), since the `/admin/api/corpus/<slug>` GET
returns exactly that.

Modeling discipline (../CLAUDE.md):

  - The loaded rows are `WebData Data.Table.TablePage` — the four-state load, never a
    loading/error/data triple (rule 1).
  - The in-flight mutation AND its failure are one `ActionState` (`Idle | Busy Operation |
    Failed Operation Http.Error`), carrying *which* operation is running/failed (rule 3) —
    so "an add is in flight", "a remove of row X is in flight", and "the last mutation
    failed, with its error" cannot contradict, and one-mutation-at-a-time falls out for
    free. No `busy : Bool` + `Maybe String`.
  - On a successful add/remove we **refetch** the list rather than locally patching it
    (rule 4: the server is the source of truth), so the displayed rows can't drift.

-}

import Data.Table as Table exposing (TablePage)
import Dict exposing (Dict)
import Html exposing (Html, button, div, em, form, h2, input, label, p, table, tbody, td, text, th, thead, tr)
import Html.Attributes exposing (class, disabled, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import Http
import Json.Decode as Decode
import Json.Encode as Encode
import RemoteData exposing (RemoteData(..), WebData)
import Url.Builder as Builder



-- CONFIG


{-| The kind of an add-form field, which fixes how its draft string encodes into the POST
body: free `Text`, a `Number` (encoded as a float when parseable), or `Tags` (a
comma-separated list encoded as a JSON string array). -}
type FieldKind
    = Text
    | Number
    | Tags


{-| One add-form input: its body key, its label, its kind, and whether it is required
(an empty required field disables Add — the server stays the sole validator). -}
type alias Field =
    { key : String
    , label : String
    , kind : FieldKind
    , required : Bool
    }


{-| What makes one editor differ from another: the rest is generic. `pkColumn` is the
column whose value is a row's primary key (the DELETE path segment and remove identity);
the displayed columns come from the server response, not from here (derive, don't store). -}
type alias EditorConfig =
    { title : String
    , slug : String
    , pkColumn : String
    , addFields : List Field
    }



-- MODEL


type alias Model =
    { config : EditorConfig
    , rows : WebData TablePage
    , draft : Dict String String
    , action : ActionState
    }


{-| The one in-flight mutation, identified. `Remove` carries the row key being removed. -}
type Operation
    = Add
    | Remove String


type ActionState
    = Idle
    | Busy Operation
    | Failed Operation Http.Error


init : EditorConfig -> ( Model, Cmd Msg )
init config =
    ( { config = config, rows = Loading, draft = Dict.empty, action = Idle }
    , fetchRows config
    )



-- UPDATE


type Msg
    = GotRows (WebData TablePage)
    | DraftChanged String String
    | SubmitAdd
    | GotAdd (Result Http.Error ())
    | RemoveRow String
    | GotRemove String (Result Http.Error ())


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        GotRows rows ->
            ( { model | rows = rows }, Cmd.none )

        DraftChanged key val ->
            ( { model | draft = Dict.insert key val model.draft }, Cmd.none )

        SubmitAdd ->
            -- One mutation at a time: ignore a submit while another is in flight.
            if isBusy model.action || not (canAdd model) then
                ( model, Cmd.none )

            else
                ( { model | action = Busy Add }, postAdd model.config model.draft )

        GotAdd (Ok ()) ->
            ( { model | action = Idle, draft = Dict.empty, rows = Loading }, fetchRows model.config )

        GotAdd (Err err) ->
            ( { model | action = Failed Add err }, Cmd.none )

        RemoveRow key ->
            if isBusy model.action then
                ( model, Cmd.none )

            else
                ( { model | action = Busy (Remove key) }, deleteRow model.config key )

        GotRemove _ (Ok ()) ->
            ( { model | action = Idle, rows = Loading }, fetchRows model.config )

        GotRemove key (Err err) ->
            ( { model | action = Failed (Remove key) err }, Cmd.none )


isBusy : ActionState -> Bool
isBusy action =
    case action of
        Busy _ ->
            True

        _ ->
            False


{-| The primary-key string of a row (its `pkColumn` cell), used as the remove identity and
the DELETE path segment. An absent key column renders empty (the row would not be removable
— it should never happen, since the server always projects the PK column). -}
rowKey : EditorConfig -> Dict String Decode.Value -> String
rowKey config row =
    Table.renderCell (Dict.get config.pkColumn row)


{-| Add is allowed only when every required field has a non-blank draft value — so an empty
required field disables the button instead of making a round-trip the server would reject. -}
canAdd : Model -> Bool
canAdd model =
    List.all
        (\f -> not f.required || not (String.isEmpty (draftValue model.draft f.key)))
        model.config.addFields


draftValue : Dict String String -> String -> String
draftValue draft key =
    Dict.get key draft |> Maybe.withDefault "" |> String.trim



-- HTTP


corpusUrl : String -> List String -> String
corpusUrl slug extra =
    Builder.absolute ("admin" :: "api" :: "corpus" :: slug :: extra) []


fetchRows : EditorConfig -> Cmd Msg
fetchRows config =
    Http.get
        { url = corpusUrl config.slug []
        , expect = Http.expectJson (RemoteData.fromResult >> GotRows) Table.tablePageDecoder
        }


postAdd : EditorConfig -> Dict String String -> Cmd Msg
postAdd config draft =
    Http.post
        { url = corpusUrl config.slug []
        , body = Http.jsonBody (encodeAdd config draft)
        , expect = Http.expectWhatever GotAdd
        }


deleteRow : EditorConfig -> String -> Cmd Msg
deleteRow config key =
    Http.request
        { method = "DELETE"
        , headers = []
        , url = corpusUrl config.slug [ key ]
        , body = Http.emptyBody
        , expect = Http.expectWhatever (GotRemove key)
        , timeout = Nothing
        , tracker = Nothing
        }


{-| Encode the add-form draft into the POST body per field kind. A blank optional field is
omitted; a blank required field is sent as an empty string (Add is disabled before this, so
in practice it never is). Numbers encode as floats when parseable (else as the raw string,
letting the server reject); tags split on commas into a string array. -}
encodeAdd : EditorConfig -> Dict String String -> Encode.Value
encodeAdd config draft =
    Encode.object (List.filterMap (encodeField draft) config.addFields)


encodeField : Dict String String -> Field -> Maybe ( String, Encode.Value )
encodeField draft field =
    let
        raw =
            draftValue draft field.key
    in
    if String.isEmpty raw then
        if field.required then
            Just ( field.key, Encode.string "" )

        else
            Nothing

    else
        Just
            ( field.key
            , case field.kind of
                Text ->
                    Encode.string raw

                Number ->
                    String.toFloat raw
                        |> Maybe.map Encode.float
                        |> Maybe.withDefault (Encode.string raw)

                Tags ->
                    Encode.list Encode.string (splitTags raw)
            )


splitTags : String -> List String
splitTags raw =
    raw
        |> String.split ","
        |> List.map String.trim
        |> List.filter (not << String.isEmpty)



-- VIEW


view : Model -> Html Msg
view model =
    div []
        [ h2 [] [ text model.config.title ]
        , viewAddForm model
        , viewFailure model.action
        , viewRows model
        ]


viewAddForm : Model -> Html Msg
viewAddForm model =
    form [ class "card", onSubmit SubmitAdd ]
        [ div [ class "form-row" ]
            (List.map (viewField model.draft) model.config.addFields)
        , button
            [ type_ "submit"
            , class "btn-primary"
            , disabled (not (canAdd model) || isBusy model.action)
            ]
            [ text (addLabel model.action) ]
        ]


viewField : Dict String String -> Field -> Html Msg
viewField draft field =
    label []
        [ text field.label
        , input
            [ type_
                (case field.kind of
                    Number ->
                        "number"

                    _ ->
                        "text"
                )
            , value (Dict.get field.key draft |> Maybe.withDefault "")
            , placeholder
                (case field.kind of
                    Tags ->
                        "comma,separated"

                    _ ->
                        ""
                )
            , onInput (DraftChanged field.key)
            ]
            []
        ]


addLabel : ActionState -> String
addLabel action =
    case action of
        Busy Add ->
            "Adding…"

        _ ->
            "Add"


viewFailure : ActionState -> Html Msg
viewFailure action =
    case action of
        Failed op err ->
            div [ class "card error" ]
                [ p [] [ text (operationLabel op ++ " failed: " ++ httpError err) ] ]

        _ ->
            text ""


operationLabel : Operation -> String
operationLabel op =
    case op of
        Add ->
            "Add"

        Remove key ->
            "Remove " ++ key


viewRows : Model -> Html Msg
viewRows model =
    case model.rows of
        NotAsked ->
            text ""

        Loading ->
            p [ class "muted" ] [ text "Loading…" ]

        Failure err ->
            div [ class "error" ] [ text ("Could not load: " ++ httpError err) ]

        Success page ->
            if List.isEmpty page.rows then
                p [ class "muted" ] [ em [] [ text "No rows." ] ]

            else
                div [ class "card" ]
                    [ table []
                        [ thead [] [ tr [] (List.map (\c -> th [] [ text c ]) page.columns ++ [ th [] [] ]) ]
                        , tbody [] (List.map (viewRow model page.columns) page.rows)
                        ]
                    ]


viewRow : Model -> List String -> Dict String Decode.Value -> Html Msg
viewRow model columns row =
    let
        key =
            rowKey model.config row
    in
    tr []
        (List.map (\c -> td [] [ text (Table.renderCell (Dict.get c row)) ]) columns
            ++ [ td []
                    [ button
                        [ class "btn-secondary"
                        , onClick (RemoveRow key)
                        , disabled (isBusy model.action)
                        ]
                        [ text (removeLabel model.action key) ]
                    ]
               ]
        )


removeLabel : ActionState -> String -> String
removeLabel action key =
    case action of
        Busy (Remove k) ->
            if k == key then
                "Removing…"

            else
                "Remove"

        _ ->
            "Remove"


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

        Http.BadStatus 400 ->
            "rejected (400) — check the field values"

        Http.BadStatus status ->
            "HTTP " ++ String.fromInt status

        Http.BadBody detail ->
            "unexpected response: " ++ detail
