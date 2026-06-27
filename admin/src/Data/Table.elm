module Data.Table exposing
    ( Model, Msg, init, update, view
    , TablePage, tablePageDecoder, renderCell
    )

{-| A generic read-only browser for a group of flat D1 tables (operator-data-explorer).
Shared by the three flat Data views — Shared corpus (lookup tables), Discovery, and
System — since they differ only in *which* tables they expose: pick a table from the
group, fetch `/admin/api/data/<group>/<table>`, render its `{columns, rows}` as a table.

Modeling discipline (../CLAUDE.md): the fetch is `WebData TablePage`, never a
loading/error/data triple. The active table is a plain `String` (it is one of the
server-fixed group members, echoed in the URL), and the row cells are decoded as
`Json.Decode.Value` because a flat table's columns are heterogeneous (text, ints,
nulls, JSON blobs) — the view renders each compactly. The column ORDER is the server's.

The second export group is for `tests/` — the JSON-shape decoding and cell rendering
are the compiler-opaque logic worth pinning.

-}

import Dict exposing (Dict)
import Html exposing (Html, button, div, em, p, table, tbody, td, text, th, thead, tr)
import Html.Attributes exposing (class, classList)
import Html.Events exposing (onClick)
import Http
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode
import RemoteData exposing (RemoteData(..), WebData)



-- MODEL


type alias Model =
    { group : String
    , tables : List String
    , active : String
    , page : WebData TablePage
    }


{-| One flat-table read: the column order plus the rows (each a column→value map). -}
type alias TablePage =
    { table : String
    , columns : List String
    , rows : List (Dict String Decode.Value)
    }


{-| Initialize a browser for `group` over its fixed `tables`, fetching the first. -}
init : String -> List String -> ( Model, Cmd Msg )
init group tables =
    case List.head tables of
        Just first ->
            ( { group = group, tables = tables, active = first, page = Loading }, fetch group first )

        Nothing ->
            ( { group = group, tables = tables, active = "", page = NotAsked }, Cmd.none )



-- UPDATE


type Msg
    = SelectTable String
    | GotPage (WebData TablePage)


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        SelectTable name ->
            ( { model | active = name, page = Loading }, fetch model.group name )

        GotPage page ->
            ( { model | page = page }, Cmd.none )



-- HTTP


fetch : String -> String -> Cmd Msg
fetch group name =
    Http.get
        { url = "/admin/api/data/" ++ group ++ "/" ++ name
        , expect = Http.expectJson (RemoteData.fromResult >> GotPage) tablePageDecoder
        }


tablePageDecoder : Decoder TablePage
tablePageDecoder =
    Decode.map3 TablePage
        (Decode.field "table" Decode.string)
        (Decode.field "columns" (Decode.list Decode.string))
        (Decode.field "rows" (Decode.list (Decode.dict Decode.value)))



-- VIEW


view : Model -> Html Msg
view model =
    div []
        [ div [ class "data-nav" ] (List.map (viewTab model.active) model.tables)
        , viewPage model.page
        ]


viewTab : String -> String -> Html Msg
viewTab active name =
    button
        [ classList [ ( "pill", True ), ( "active", name == active ) ], onClick (SelectTable name) ]
        [ text name ]


viewPage : WebData TablePage -> Html Msg
viewPage page =
    case page of
        NotAsked ->
            p [ class "muted" ] [ text "No tables in this view." ]

        Loading ->
            p [] [ text "Loading…" ]

        Failure error ->
            div [ class "error" ] [ text ("Could not load table: " ++ httpError error) ]

        Success { columns, rows } ->
            if List.isEmpty rows then
                p [ class "muted" ] [ em [] [ text "No rows." ] ]

            else
                div [ class "card" ]
                    [ table []
                        [ thead [] [ tr [] (List.map (\c -> th [] [ text c ]) columns) ]
                        , tbody [] (List.map (viewRow columns) rows)
                        ]
                    ]


viewRow : List String -> Dict String Decode.Value -> Html Msg
viewRow columns row =
    tr [] (List.map (\c -> td [] [ text (renderCell (Dict.get c row)) ]) columns)


{-| Render a heterogeneous cell value compactly: a string verbatim, an absent value or
JSON `null` as empty, and anything else (number, bool, array, object) as compact JSON. -}
renderCell : Maybe Decode.Value -> String
renderCell maybeValue =
    case maybeValue of
        Nothing ->
            ""

        Just value ->
            case Decode.decodeValue Decode.string value of
                Ok s ->
                    s

                Err _ ->
                    if Decode.decodeValue (Decode.null ()) value == Ok () then
                        ""

                    else
                        Encode.encode 0 value


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
