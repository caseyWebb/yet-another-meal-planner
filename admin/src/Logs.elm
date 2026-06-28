module Logs exposing
    ( Model, Msg, init, selectSource, update, view
    , Outcome(..), Entry, entryDecoder, outcomeFromString, outcomeLabel, hasDetail
    , ReprobeSummary, reprobeSummaryDecoder, reprobeSummaryText
    )

{-| The Logs area's operator-auditable activity logs (operator-admin).

The master/detail layout of the MCP-inspector tool console: a LEFT submenu of log **sources**
and, on the right, the entries for the selected source. The first (and initially only) source
is **Discovery** — the background discovery sweep's per-candidate outcome log
(`GET /admin/api/logs/discovery`, group-wide and bounded by the Worker). The area is
**extensible by adding a source**: a new `Route.LogSource` variant gains a submenu entry, a
`WebData` field here, and a fetch — no restructuring.

Modeling discipline (see ../CLAUDE.md — "make impossible states impossible"):

  - the selected submenu item is a `Route.LogSource` (a finite union), never a stringly-typed
    slug;
  - each source's entries are `WebData` (the four-state load), never a loading/error/data
    triple;
  - the open-dialog state lives **inside** the `Success` variant (`Loaded entries dialog`), so
    "a dialog is open for entry X" cannot exist without the loaded list it sits in front of —
    `Loading`-with-an-open-dialog is unrepresentable.

The second export group is exposed for the unit tests in `tests/LogsTest.elm` — the outcome
mapping and the "has expandable detail" predicate are the compiler-opaque logic worth pinning.

-}

import Html exposing (Html, button, div, h2, li, p, pre, span, strong, text, ul)
import Html.Attributes exposing (class, classList, disabled)
import Html.Events exposing (onClick)
import Http
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode
import RemoteData exposing (RemoteData(..), WebData)
import Route exposing (LogSource(..))



-- MODEL


{-| One discovery-sweep outcome row (the `discovery_log` shape the API returns). `detail` is
the outcome-specific JSON blob (an import's attribution, a duplicate's matched slug, a parked
error's reason) kept as an opaque `Value` and rendered in the detail dialog. -}
type alias Entry =
    { id : String
    , url : Maybe String
    , title : Maybe String
    , source : Maybe String
    , outcome : Outcome
    , slug : Maybe String
    , detail : Encode.Value
    , createdAt : Maybe String
    }


{-| The per-candidate outcome, collapsed from the wire string into a finite union so the row
styling/label is exhaustive. `Other` keeps an unrecognized future outcome renderable (its raw
string) without a decode failure — the one open arm, deliberate. -}
type Outcome
    = Imported
    | Duplicate
    | NoMatch
    | RejectedSource
    | DietaryGated
    | Errored
    | Other String


{-| The open-dialog state for a loaded source. It lives inside `Loaded` (below), so a dialog
can only be open when there IS a list behind it. -}
type Dialog
    = Closed
    | Open Entry


{-| A successfully-loaded source: its entries and the dialog state, as one value. The dialog
cannot exist apart from the list it overlays — that is the whole point of nesting it in the
`Success` payload rather than beside the `WebData`. -}
type Loaded
    = Loaded (List Entry) Dialog


{-| The operator `reprobe-parked` backfill action: its in-flight state, result summary, and
failure as ONE value (never a busy `Bool` beside a `Maybe` error), distinct from the log's
`WebData` load — the backfill runs independently of (re)loading the entry list. -}
type ReprobeState
    = ReprobeIdle
    | ReprobeRunning
    | ReprobeDone ReprobeSummary
    | ReprobeFailed Http.Error


{-| What `POST /admin/api/discovery/reprobe-parked` returns: how many legacy `unreachable` rows
it examined and how they re-classified. -}
type alias ReprobeSummary =
    { scanned : Int
    , reclassified : Int
    , stillUnreachable : Int
    , nowAcquirable : Int
    }


type alias Model =
    { selected : LogSource
    , discovery : WebData Loaded
    , reprobe : ReprobeState
    }


init : LogSource -> ( Model, Cmd Msg )
init source =
    ( { selected = source, discovery = NotAsked, reprobe = ReprobeIdle }, Cmd.none )
        |> load source


{-| Switch the selected source while staying in the area (the shell calls this on an in-app
navigation), preserving any already-loaded source and fetching one not yet loaded. -}
selectSource : LogSource -> Model -> ( Model, Cmd Msg )
selectSource source model =
    -- Clear any stale re-probe summary on navigation, so a summary shown under one source can't
    -- leak across to another (a latent bug today — Discovery is the only source — but correct the
    -- moment a second LogSource is added).
    load source ( { model | selected = source, reprobe = ReprobeIdle }, Cmd.none )


{-| Select `source` and, if its entries are not already loaded/loading, kick its fetch. Folds
into the running `( Model, Cmd )` so `init`/`selectSource` share one place that knows each
source's fetch. -}
load : LogSource -> ( Model, Cmd Msg ) -> ( Model, Cmd Msg )
load source ( model, cmd ) =
    case source of
        Discovery ->
            if RemoteData.isLoading model.discovery || RemoteData.isSuccess model.discovery then
                ( model, cmd )

            else
                ( { model | discovery = Loading }, Cmd.batch [ cmd, fetchDiscovery ] )



-- UPDATE


type Msg
    = GotDiscovery (WebData (List Entry))
    | OpenEntry Entry
    | CloseDialog
    | Reload
    | RunReprobe
    | GotReprobe (Result Http.Error ReprobeSummary)


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        GotDiscovery entries ->
            -- A fresh load always opens with the dialog Closed (no entry can be "open" before
            -- the list it belongs to exists).
            ( { model | discovery = RemoteData.map (\list -> Loaded list Closed) entries }, Cmd.none )

        OpenEntry entry ->
            ( { model | discovery = mapLoaded (\list _ -> Loaded list (Open entry)) model.discovery }, Cmd.none )

        CloseDialog ->
            ( { model | discovery = mapLoaded (\list _ -> Loaded list Closed) model.discovery }, Cmd.none )

        Reload ->
            -- A manual refresh clears a stale re-probe summary so what's shown always matches the
            -- last re-probe (not a load that happened after it).
            ( { model | discovery = Loading, reprobe = ReprobeIdle }, fetchDiscovery )

        RunReprobe ->
            -- One at a time: ignore a click while a re-probe is already running.
            if model.reprobe == ReprobeRunning then
                ( model, Cmd.none )

            else
                ( { model | reprobe = ReprobeRunning }, postReprobe )

        GotReprobe (Ok summary) ->
            -- Reload the log so the re-classified detail.reasons are reflected immediately.
            ( { model | reprobe = ReprobeDone summary, discovery = Loading }, fetchDiscovery )

        GotReprobe (Err err) ->
            ( { model | reprobe = ReprobeFailed err }, Cmd.none )


{-| Transform a loaded source's `(entries, dialog)` in place; a no-op while not yet `Success`
(you cannot open a dialog over a list that has not loaded). -}
mapLoaded : (List Entry -> Dialog -> Loaded) -> WebData Loaded -> WebData Loaded
mapLoaded f =
    RemoteData.map (\(Loaded list dialog) -> f list dialog)



-- HTTP


fetchDiscovery : Cmd Msg
fetchDiscovery =
    Http.get
        { url = "/admin/api/logs/discovery"
        , expect = Http.expectJson (RemoteData.fromResult >> GotDiscovery) discoveryDecoder
        }


discoveryDecoder : Decoder (List Entry)
discoveryDecoder =
    Decode.field "entries" (Decode.list entryDecoder)


postReprobe : Cmd Msg
postReprobe =
    Http.post
        { url = "/admin/api/discovery/reprobe-parked"
        , body = Http.emptyBody
        , expect = Http.expectJson GotReprobe reprobeSummaryDecoder
        }


reprobeSummaryDecoder : Decoder ReprobeSummary
reprobeSummaryDecoder =
    Decode.map4 ReprobeSummary
        (Decode.field "scanned" Decode.int)
        (Decode.field "reclassified" Decode.int)
        (Decode.field "stillUnreachable" Decode.int)
        (Decode.field "nowAcquirable" Decode.int)


entryDecoder : Decoder Entry
entryDecoder =
    Decode.map8 Entry
        (Decode.field "id" Decode.string)
        (nullableField "url")
        (nullableField "title")
        (nullableField "source")
        (Decode.field "outcome" (Decode.map outcomeFromString Decode.string))
        (nullableField "slug")
        (Decode.oneOf [ Decode.field "detail" Decode.value, Decode.succeed Encode.null ])
        (nullableField "created_at")


nullableField : String -> Decoder (Maybe String)
nullableField key =
    Decode.oneOf [ Decode.field key (Decode.nullable Decode.string), Decode.succeed Nothing ]


{-| Map the wire outcome string onto the union; an unrecognized value is kept as `Other` so a
future outcome still renders (never a decode failure). -}
outcomeFromString : String -> Outcome
outcomeFromString raw =
    case raw of
        "imported" ->
            Imported

        "duplicate" ->
            Duplicate

        "no_match" ->
            NoMatch

        "rejected_source" ->
            RejectedSource

        "dietary_gated" ->
            DietaryGated

        "error" ->
            Errored

        _ ->
            Other raw



-- VIEW


view : Model -> Html Msg
view model =
    div [ class "logs" ]
        [ viewSubmenu model.selected
        , viewSource model.selected model.discovery model.reprobe
        ]


{-| The LEFT submenu of log sources — one entry per `LogSource`. A future source becomes
another entry here (mapping over `Route`-derived sources would also work); today there is one. -}
viewSubmenu : LogSource -> Html Msg
viewSubmenu selected =
    ul [ class "log-sources" ] (List.map (viewSourceItem selected) sources)


{-| The log sources, in submenu order. (Listed here so adding a source is one line.) -}
sources : List LogSource
sources =
    [ Discovery ]


sourceLabel : LogSource -> String
sourceLabel source =
    case source of
        Discovery ->
            "Discovery"


viewSourceItem : LogSource -> LogSource -> Html Msg
viewSourceItem selected source =
    li [ classList [ ( "log-source", True ), ( "active", source == selected ) ] ]
        [ Html.a [ Route.href (Route.Logs (Just source)), class "log-source-link" ]
            [ text (sourceLabel source) ]
        ]


{-| The RIGHT panel: the entries for the selected source. A new source adds an arm here. -}
viewSource : LogSource -> WebData Loaded -> ReprobeState -> Html Msg
viewSource selected discovery reprobe =
    case selected of
        Discovery ->
            div [ class "log-entries" ]
                [ div [ class "log-head" ]
                    [ h2 [] [ text "Discovery" ]
                    , div [ class "log-actions" ]
                        [ button [ class "link", onClick RunReprobe, disabled (reprobe == ReprobeRunning) ]
                            [ text (reprobeButtonLabel reprobe) ]
                        , button [ class "link", onClick Reload ] [ text "Refresh" ]
                        ]
                    ]
                , viewReprobe reprobe
                , viewLoaded discovery
                ]


viewLoaded : WebData Loaded -> Html Msg
viewLoaded discovery =
    case discovery of
        NotAsked ->
            p [ class "muted" ] [ text "…" ]

        Loading ->
            p [ class "muted" ] [ text "Loading…" ]

        Failure error ->
            div [ class "error" ] [ text ("Could not load the discovery log: " ++ httpError error) ]

        Success (Loaded [] _) ->
            p [ class "muted" ] [ text "No discovery activity yet." ]

        Success (Loaded entries dialog) ->
            div []
                [ ul [ class "entry-list" ] (List.map viewEntryRow entries)
                , viewDialog dialog
                ]


reprobeButtonLabel : ReprobeState -> String
reprobeButtonLabel reprobe =
    case reprobe of
        ReprobeRunning ->
            "Re-probing…"

        _ ->
            "Re-probe parked"


{-| The re-probe result line under the log head: the summary on success, the error on failure,
nothing before the operator has run it (or right after, while the reload is in flight). -}
viewReprobe : ReprobeState -> Html Msg
viewReprobe reprobe =
    case reprobe of
        ReprobeIdle ->
            text ""

        ReprobeRunning ->
            p [ class "muted small" ] [ text "Re-probing parked rows from the edge…" ]

        ReprobeDone summary ->
            p [ class "muted small" ] [ text (reprobeSummaryText summary) ]

        ReprobeFailed err ->
            div [ class "error" ] [ text ("Re-probe failed: " ++ httpError err) ]


{-| Human-readable one-liner for a re-probe summary. Pinned by `tests/LogsTest.elm`. -}
reprobeSummaryText : ReprobeSummary -> String
reprobeSummaryText summary =
    if summary.scanned == 0 then
        "No legacy “unreachable” rows left to re-probe."

    else
        "Re-probed "
            ++ String.fromInt summary.scanned
            ++ ": "
            ++ String.fromInt summary.reclassified
            ++ " reclassified, "
            ++ String.fromInt summary.stillUnreachable
            ++ " still unreachable, "
            ++ String.fromInt summary.nowAcquirable
            ++ " now acquirable."


viewEntryRow : Entry -> Html Msg
viewEntryRow entry =
    let
        ( cls, word ) =
            outcomeClassWord entry.outcome

        attrs =
            classList [ ( "entry-row", True ), ( "has-detail", hasDetail entry ) ]
                :: (if hasDetail entry then
                        [ onClick (OpenEntry entry) ]

                    else
                        []
                   )
    in
    li attrs
        [ span [ class ("entry-outcome " ++ cls) ] [ text word ]
        , span [ class "entry-title" ] [ text (entryTitle entry) ]
        , span [ class "entry-source muted small" ] [ text (Maybe.withDefault "" entry.source) ]
        , span [ class "entry-time muted small" ] [ text (Maybe.withDefault "" entry.createdAt) ]
        , if hasDetail entry then
            span [ class "entry-more small" ] [ text "details →" ]

          else
            text ""
        ]


{-| The detail dialog: the open entry's full detail rendered over the (intact) list. With
nothing open it renders nothing, so the list shows through. -}
viewDialog : Dialog -> Html Msg
viewDialog dialog =
    case dialog of
        Closed ->
            text ""

        Open entry ->
            div [ class "dialog-backdrop", onClick CloseDialog ]
                -- stopPropagation isn't wired; the panel re-issues CloseDialog harmlessly, but
                -- give it its own no-args close so a click inside still reads as the same intent.
                [ div [ class "dialog" ]
                    [ div [ class "dialog-head" ]
                        [ strong [] [ text (entryTitle entry) ]
                        , button [ class "link", onClick CloseDialog ] [ text "Close" ]
                        ]
                    , viewDialogBody entry
                    ]
                ]


viewDialogBody : Entry -> Html Msg
viewDialogBody entry =
    div [ class "dialog-body" ]
        ([ detailRow "outcome" (outcomeLabel entry.outcome)
         ]
            ++ maybeRow "url" entry.url
            ++ maybeRow "source" entry.source
            ++ maybeRow "imported as" entry.slug
            ++ maybeRow "at" entry.createdAt
            ++ [ div [ class "detail-blob" ]
                    [ span [ class "k muted small" ] [ text "detail" ]
                    , pre [] [ text (Encode.encode 2 entry.detail) ]
                    ]
               ]
        )


detailRow : String -> String -> Html Msg
detailRow key val =
    div [ class "row" ] [ span [ class "k" ] [ text key ], span [ class "v" ] [ text val ] ]


maybeRow : String -> Maybe String -> List (Html Msg)
maybeRow key val =
    case val of
        Just v ->
            [ detailRow key v ]

        Nothing ->
            []


{-| Whether the entry carries more than a row's worth of detail — an import's attribution, a
duplicate's matched slug, or a parked error's reason — and so is worth a dialog. True when the
`detail` blob is a non-empty object/array (or the entry carries a matched slug). Pinned by
`tests/LogsTest.elm`. -}
hasDetail : Entry -> Bool
hasDetail entry =
    entry.slug /= Nothing || not (isEmptyDetail entry.detail)


isEmptyDetail : Encode.Value -> Bool
isEmptyDetail value =
    -- `null`, `{}`, and `[]` carry nothing to expand; an object/array with members does.
    case Decode.decodeValue (Decode.nullable (Decode.keyValuePairs Decode.value)) value of
        Ok (Just pairs) ->
            List.isEmpty pairs

        Ok Nothing ->
            True

        Err _ ->
            case Decode.decodeValue (Decode.list Decode.value) value of
                Ok items ->
                    List.isEmpty items

                Err _ ->
                    -- A bare scalar (string/number/bool) is technically detail, but not the
                    -- structured kind a dialog is for; treat it as "nothing to expand".
                    True


entryTitle : Entry -> String
entryTitle entry =
    case ( entry.title, entry.url ) of
        ( Just t, _ ) ->
            t

        ( Nothing, Just u ) ->
            u

        ( Nothing, Nothing ) ->
            "(untitled)"


outcomeClassWord : Outcome -> ( String, String )
outcomeClassWord outcome =
    case outcome of
        Imported ->
            ( "ok", "imported" )

        Duplicate ->
            ( "muted", "duplicate" )

        NoMatch ->
            ( "muted", "no match" )

        RejectedSource ->
            ( "muted", "rejected source" )

        DietaryGated ->
            ( "muted", "dietary gated" )

        Errored ->
            ( "fail", "error" )

        Other raw ->
            ( "muted", raw )


{-| A human label for the dialog header row (the same word as the badge, spelled for prose). -}
outcomeLabel : Outcome -> String
outcomeLabel outcome =
    Tuple.second (outcomeClassWord outcome)


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
