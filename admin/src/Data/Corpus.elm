module Data.Corpus exposing (Model, Msg, init, update, view)

{-| The Shared-corpus data view (operator-data-explorer): the objective shared lookup
tables (via the generic `Data.Table` browser) plus the authored `guidance/**` R2 markdown
tree (a small file browser rendering a guidance object's source). The two R2-and-D1 halves
of the "shared corpus" tier in one view.

Modeling discipline (../CLAUDE.md): the guidance listing and a selected object are each
`WebData`; the current directory is the full object-key prefix (echoed from the server),
and an open object is a `Maybe ( key, WebData String )` — there is no open-but-no-key or
loaded-but-no-content combination.

-}

import Data.Table as Table
import Html exposing (Html, button, div, em, h2, hr, li, p, span, text, ul)
import Html.Attributes exposing (class)
import Html.Events exposing (onClick)
import Http
import Json.Decode as Decode exposing (Decoder)
import Markdown
import RemoteData exposing (RemoteData(..), WebData)
import Url.Builder as Builder



-- MODEL


type alias Model =
    { tables : Table.Model
    , prefix : String
    , listing : WebData Listing
    , object : Maybe ( String, WebData String )
    }


type alias Listing =
    { prefix : String, entries : List Entry }


type alias Entry =
    { name : String, kind : String }


corpusTables : List String
corpusTables =
    [ "aliases", "flyer_terms", "feeds", "stores", "store_notes", "sku_cache" ]


guidanceRoot : String
guidanceRoot =
    "guidance/"


init : ( Model, Cmd Msg )
init =
    let
        ( tables, tablesCmd ) =
            Table.init "corpus" corpusTables
    in
    ( { tables = tables, prefix = guidanceRoot, listing = Loading, object = Nothing }
    , Cmd.batch [ Cmd.map TableMsg tablesCmd, fetchListing guidanceRoot ]
    )



-- UPDATE


type Msg
    = TableMsg Table.Msg
    | GotListing (WebData Listing)
    | OpenDir String
    | OpenObject String
    | GotObject String (WebData String)
    | CloseObject


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        TableMsg sub ->
            let
                ( tables, cmd ) =
                    Table.update sub model.tables
            in
            ( { model | tables = tables }, Cmd.map TableMsg cmd )

        GotListing listing ->
            ( { model | listing = listing }, Cmd.none )

        OpenDir prefix ->
            ( { model | prefix = prefix, listing = Loading, object = Nothing }, fetchListing prefix )

        OpenObject path ->
            ( { model | object = Just ( path, Loading ) }, fetchObject path )

        GotObject path object ->
            case model.object of
                Just ( current, _ ) ->
                    if current == path then
                        ( { model | object = Just ( path, object ) }, Cmd.none )

                    else
                        ( model, Cmd.none )

                Nothing ->
                    ( model, Cmd.none )

        CloseObject ->
            ( { model | object = Nothing }, Cmd.none )



-- HTTP


fetchListing : String -> Cmd Msg
fetchListing prefix =
    Http.get
        { url = Builder.absolute [ "admin", "api", "data", "corpus", "guidance" ] [ Builder.string "prefix" prefix ]
        , expect = Http.expectJson (RemoteData.fromResult >> GotListing) listingDecoder
        }


fetchObject : String -> Cmd Msg
fetchObject path =
    Http.get
        { url = Builder.absolute [ "admin", "api", "data", "corpus", "guidance", "object" ] [ Builder.string "path" path ]
        , expect = Http.expectJson (RemoteData.fromResult >> GotObject path) (Decode.field "markdown" Decode.string)
        }


listingDecoder : Decoder Listing
listingDecoder =
    Decode.map2 Listing
        (Decode.field "prefix" Decode.string)
        (Decode.field "entries" (Decode.list entryDecoder))


entryDecoder : Decoder Entry
entryDecoder =
    Decode.map2 Entry
        (Decode.field "name" Decode.string)
        (Decode.field "type" Decode.string)



-- VIEW


view : Model -> Html Msg
view model =
    div []
        [ h2 [] [ text "Shared corpus" ]
        , p [ class "schema-label" ] [ text "Lookup tables" ]
        , Html.map TableMsg (Table.view model.tables)
        , hr [] []
        , p [ class "schema-label" ] [ text "Guidance (R2 markdown)" ]
        , viewGuidance model
        ]


viewGuidance : Model -> Html Msg
viewGuidance model =
    case model.object of
        Just ( path, object ) ->
            viewObject path object

        Nothing ->
            viewListing model.prefix model.listing


viewListing : String -> WebData Listing -> Html Msg
viewListing prefix listing =
    case listing of
        NotAsked ->
            p [] [ text "…" ]

        Loading ->
            p [] [ text "Loading…" ]

        Failure error ->
            div [ class "error" ] [ text ("Could not load guidance: " ++ httpError error) ]

        Success { entries } ->
            div [ class "card" ]
                [ p [ class "muted small" ] [ text prefix ]
                , ul [ class "tool-list" ]
                    (upEntry prefix ++ List.map (viewEntry prefix) entries)
                ]


upEntry : String -> List (Html Msg)
upEntry prefix =
    case parentPrefix prefix of
        Just parent ->
            [ li [ class "tool-item" ]
                [ button [ class "link", onClick (OpenDir parent) ] [ text "↑ up" ] ]
            ]

        Nothing ->
            []


{-| The parent of a guidance prefix, or Nothing at the `guidance/` root. -}
parentPrefix : String -> Maybe String
parentPrefix prefix =
    let
        segments =
            List.filter (not << String.isEmpty) (String.split "/" prefix)
    in
    case segments of
        "guidance" :: rest ->
            if List.isEmpty rest then
                Nothing

            else
                Just (String.join "/" ("guidance" :: List.take (List.length rest - 1) rest) ++ "/")

        _ ->
            Nothing


viewEntry : String -> Entry -> Html Msg
viewEntry prefix entry =
    let
        full =
            prefix ++ entry.name
    in
    li [ class "tool-item" ]
        (if entry.kind == "dir" then
            [ button [ class "link", onClick (OpenDir (full ++ "/")) ] [ text ("📁 " ++ entry.name) ] ]

         else
            [ button [ class "link", onClick (OpenObject full) ] [ text entry.name ] ]
        )


viewObject : String -> WebData String -> Html Msg
viewObject path object =
    div []
        [ p [] [ button [ class "link", onClick CloseObject ] [ text "← back to guidance" ] ]
        , p [ class "muted small" ] [ text path ]
        , case object of
            NotAsked ->
                p [] [ text "…" ]

            Loading ->
                p [] [ text "Loading…" ]

            Failure error ->
                div [ class "error" ] [ text ("Could not load object: " ++ httpError error) ]

            Success markdown ->
                if String.isEmpty markdown then
                    p [ class "muted" ] [ em [] [ text "empty object" ] ]

                else
                    div [ class "card" ] [ Markdown.render markdown ]
        ]


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
            "not found (404)"

        Http.BadStatus status ->
            "HTTP " ++ String.fromInt status

        Http.BadBody detail ->
            "unexpected response: " ++ detail
