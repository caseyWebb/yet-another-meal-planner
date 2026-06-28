module Status exposing
    ( Model, Msg, init, update, view
    , HealthPayload, Job, JobState(..), AdminPosture, GateState(..)
    , gateState, healthDecoder, decodeBody, formatLocal
    )

{-| The Status area's service-health home view (operator-admin).

The panel's **home** surface (`/admin`): it fetches the Worker's open `/health` endpoint and
renders the aggregate payload — background-job health, the D1 reachability probe, and the
operator admin-gate posture. It is the one place the operator, already authenticated *through*
the Cloudflare Access gate, can see whether that gate is correctly configured or dangerously
`exposed`.

Modeling discipline (see ../CLAUDE.md — "make impossible states impossible"):

  - the fetch is `WebData HealthPayload`, never a `loading`/`error`/`data` triple;
  - each job's `{ ok: bool|null, never_run? }` wire shape collapses to one `JobState`
    (`Healthy | Failing | NeverRun`) at decode time;
  - the admin posture's four booleans are decoded as-is (they are not mutually exclusive),
    and the view derives a single `GateState` from them for display.

`/health` returns `503` when degraded (a job failing, D1 down, or the gate `exposed`), and
that response still carries the full JSON body. So the fetch decodes the body on a `503`
exactly as on a `200` (a body-preserving `expectStringResponse`): a decoded degraded payload
is a *successful read* whose `ok` is false, not a transport failure. Only a network error or a
body that does not decode as health (e.g. a `403` from an expired Access session) is a
`Failure`. Without this, an `exposed` gate — a `503` — would surface as a generic HTTP error
instead of the warning the operator needs.

Epoch-ms timestamps — each job's `last_run_at` and any timestamp-shaped value inside a
`summary` (e.g. flyer-warm's `sweep_completed_at`) — render in the **browser's local time
zone**, fetched once via `Time.here` at init. `relAge` still drives the at-a-glance "Nm ago"
age; the absolute local time sits in the row's hover title.

The second/third export groups (`HealthPayload`…`formatLocal`) are exposed for the unit
tests in `tests/StatusTest.elm` — the JSON-shape mapping, gate precedence, and local-time
formatting are the compiler-opaque logic worth pinning.

-}

import Dict exposing (Dict)
import Html exposing (Html, button, div, h2, p, span, strong, text)
import Html.Attributes exposing (class, title)
import Html.Events exposing (onClick)
import Http
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode
import RemoteData exposing (RemoteData(..), WebData)
import Task
import Time



-- MODEL


type alias Model =
    { health : WebData HealthPayload
    , zone : Time.Zone
    }


{-| The `/health` aggregate. `d1Ok` flattens the payload's `d1: { ok }` (the public endpoint
coarsens the probe to a boolean), and `admin` is the gate posture section. -}
type alias HealthPayload =
    { ok : Bool
    , generatedAt : Int
    , jobs : List Job
    , d1Ok : Bool
    , admin : AdminPosture
    , aiQuotaExhausted : Bool
    }


type alias Job =
    { name : String
    , state : JobState
    , lastRunAt : Maybe Int
    , summary : Dict String Decode.Value
    }


{-| The three legal job states, collapsed from the `/health` wire shape
`{ ok: bool|null, never_run? }` so an impossible combination can't exist downstream. -}
type JobState
    = Healthy
    | Failing
    | NeverRun


{-| The admin gate posture, as the four tenant-clean booleans `/health` reports. They are NOT
mutually exclusive (e.g. `accessConfigured` and `emailAllowlist`), so this is the honest wire
model; the single display state is derived in `gateState`. -}
type alias AdminPosture =
    { accessConfigured : Bool
    , emailAllowlist : Bool
    , devBypassSet : Bool
    , exposed : Bool
    }


{-| The gate's single display state, derived from `AdminPosture` by the same precedence the
Worker's `/health.svg` badge uses. `emailAllowlist` is an orthogonal sub-detail of `Gated`,
not a state of its own. -}
type GateState
    = Exposed
    | Gated
    | DevBypass
    | Disabled


gateState : AdminPosture -> GateState
gateState a =
    if a.exposed then
        Exposed

    else if a.accessConfigured then
        Gated

    else if a.devBypassSet then
        DevBypass

    else
        Disabled


init : ( Model, Cmd Msg )
init =
    -- Fetch `/health` and the browser's time zone in parallel; the zone formats the
    -- absolute local times (defaulting to UTC for the brief moment before `Time.here`).
    ( { health = Loading, zone = Time.utc }
    , Cmd.batch [ fetchHealth, Task.perform GotZone Time.here ]
    )



-- UPDATE


type Msg
    = GotHealth (WebData HealthPayload)
    | GotZone Time.Zone
    | Refresh


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        GotHealth health ->
            ( { model | health = health }, Cmd.none )

        GotZone zone ->
            ( { model | zone = zone }, Cmd.none )

        Refresh ->
            ( { model | health = Loading }, fetchHealth )



-- HTTP


fetchHealth : Cmd Msg
fetchHealth =
    Http.get
        { url = "/health"
        , expect = expectHealth (RemoteData.fromResult >> GotHealth)
        }


{-| Body-preserving `/health` expect. Unlike `Http.expectJson` (which drops the body on any
non-2xx), this decodes the JSON body on BOTH a `200` and a `503` — `/health` returns `503`
when degraded but still sends the full payload. Decoding is keyed on decode SUCCESS, not the
status code: a `503` health payload decodes (→ a `Success` whose `ok` is false), while a
non-health body (e.g. a `403` HTML page) does not (→ `BadStatus`, a real load error). -}
expectHealth : (Result Http.Error HealthPayload -> msg) -> Http.Expect msg
expectHealth toMsg =
    Http.expectStringResponse toMsg <|
        \response ->
            case response of
                Http.BadUrl_ url ->
                    Err (Http.BadUrl url)

                Http.Timeout_ ->
                    Err Http.Timeout

                Http.NetworkError_ ->
                    Err Http.NetworkError

                Http.BadStatus_ metadata body ->
                    decodeBody metadata body

                Http.GoodStatus_ metadata body ->
                    decodeBody metadata body


{-| Decode a response body as a health payload regardless of its status code; a body that does
not decode becomes a `BadStatus` load error (carrying the real status, e.g. a `403`). -}
decodeBody : Http.Metadata -> String -> Result Http.Error HealthPayload
decodeBody metadata body =
    case Decode.decodeString healthDecoder body of
        Ok payload ->
            Ok payload

        Err _ ->
            Err (Http.BadStatus metadata.statusCode)


healthDecoder : Decoder HealthPayload
healthDecoder =
    Decode.map6 HealthPayload
        (Decode.field "ok" Decode.bool)
        (Decode.field "generated_at" Decode.int)
        (Decode.field "jobs" (Decode.list jobDecoder))
        (Decode.at [ "d1", "ok" ] Decode.bool)
        (Decode.field "admin" adminDecoder)
        -- Tolerate an older Worker that predates the field (defaults to not-exhausted).
        (Decode.oneOf [ Decode.field "ai_quota_exhausted" Decode.bool, Decode.succeed False ])


jobDecoder : Decoder Job
jobDecoder =
    Decode.map4 Job
        (Decode.field "name" Decode.string)
        jobStateDecoder
        (Decode.maybe (Decode.field "last_run_at" Decode.int))
        (Decode.oneOf
            [ Decode.field "summary" (Decode.dict Decode.value)
            , Decode.succeed Dict.empty
            ]
        )


{-| Collapse `{ ok: bool|null }` (with a corroborating `never_run`) into one `JobState`: a
`null`/absent `ok` is never-run, `true` is healthy, `false` is failing. -}
jobStateDecoder : Decoder JobState
jobStateDecoder =
    Decode.field "ok" (Decode.nullable Decode.bool)
        |> Decode.map
            (\ok ->
                case ok of
                    Just True ->
                        Healthy

                    Just False ->
                        Failing

                    Nothing ->
                        NeverRun
            )


adminDecoder : Decoder AdminPosture
adminDecoder =
    Decode.map4 AdminPosture
        (Decode.field "access_configured" Decode.bool)
        (Decode.field "email_allowlist" Decode.bool)
        (Decode.field "dev_bypass_set" Decode.bool)
        (Decode.field "exposed" Decode.bool)



-- VIEW


view : Model -> Html Msg
view model =
    div []
        [ div [ class "status-head" ]
            [ h2 [] [ text "Service health" ]
            , button [ class "link", onClick Refresh ] [ text "Refresh" ]
            ]
        , viewBody model.zone model.health
        ]


viewBody : Time.Zone -> WebData HealthPayload -> Html Msg
viewBody zone health =
    case health of
        NotAsked ->
            p [] [ text "…" ]

        Loading ->
            p [] [ text "Loading…" ]

        Failure error ->
            div [ class "error" ] [ text ("Could not load /health: " ++ httpError error) ]

        Success payload ->
            viewPayload zone payload


viewPayload : Time.Zone -> HealthPayload -> Html Msg
viewPayload zone payload =
    div []
        [ viewExposedWarning payload.admin
        , viewAiQuotaWarning payload.aiQuotaExhausted
        , viewHeadline payload.ok
        , div [ class "card" ]
            (List.map (viewJobRow zone payload.generatedAt) payload.jobs
                ++ [ viewD1Row payload.d1Ok, viewAdminRow payload.admin ]
            )
        ]


{-| The loud signal: an `exposed` gate means a deployed Worker would serve `/admin` without
authentication. Rendered above everything as a red banner (mirrors the badge's red `admin` row). -}
viewExposedWarning : AdminPosture -> Html Msg
viewExposedWarning posture =
    if posture.exposed then
        div [ class "error" ]
            [ strong [] [ text "Admin gate exposed. " ]
            , text "Access is unconfigured and the dev bypass is set — a deployed Worker would serve /admin unauthenticated. Set ACCESS_TEAM_DOMAIN and ACCESS_AUD (and clear ADMIN_DEV_BYPASS)."
            ]

    else
        text ""


{-| The explicit Workers AI quota-exhausted alert: when an AI cron job reports error 4006 (the
daily free allocation of neurons is used up), name the cause rather than leaving a generic job
failure. Rendered as a red banner like the exposed-gate warning. -}
viewAiQuotaWarning : Bool -> Html Msg
viewAiQuotaWarning exhausted =
    if exhausted then
        div [ class "error" ]
            [ strong [] [ text "Workers AI quota exhausted. " ]
            , text "The daily free allocation of 10,000 neurons is used up (error 4006), so the recipe-classify, recipe-embed, and discovery cron jobs cannot run their AI steps. They resume at the next daily reset — or upgrade to the Cloudflare Workers Paid plan to remove the cap."
            ]

    else
        text ""


viewHeadline : Bool -> Html Msg
viewHeadline ok =
    let
        ( cls, word ) =
            if ok then
                ( "ok", "Healthy" )

            else
                ( "fail", "Degraded" )
    in
    div [ class "card headline" ]
        [ span [ class ("dot " ++ cls) ] []
        , strong [ class ("status-word " ++ cls) ] [ text word ]
        ]


viewJobRow : Time.Zone -> Int -> Job -> Html Msg
viewJobRow zone now job =
    let
        ( cls, word ) =
            jobStateClassWord job.state

        ( age, ageTitle ) =
            case job.lastRunAt of
                Just t ->
                    ( relAge (now - t), formatLocal zone t )

                Nothing ->
                    ( "", "" )
    in
    statusRow job.name cls word age ageTitle (viewSummary zone job.summary)


viewD1Row : Bool -> Html Msg
viewD1Row ok =
    let
        ( cls, word ) =
            if ok then
                ( "ok", "reachable" )

            else
                ( "fail", "unreachable" )
    in
    statusRow "d1" cls word "" "" []


viewAdminRow : AdminPosture -> Html Msg
viewAdminRow posture =
    let
        gs =
            gateState posture

        ( cls, word ) =
            gateStateClassWord gs

        detail =
            if gs == Gated && posture.emailAllowlist then
                [ summaryBlock [ ( "email allowlist", "on" ) ] ]

            else
                []
    in
    statusRow "admin gate" cls word "" "" detail


{-| One health row: a colored dot, the component label, its state word (colored), an optional
relative age (with the absolute local time on hover), and optional detail lines below (a job's
summary, the gate's sub-detail). -}
statusRow : String -> String -> String -> String -> String -> List (Html Msg) -> Html Msg
statusRow label cls word age ageTitle detail =
    div [ class "status-row" ]
        (div [ class "status-line" ]
            [ span [ class ("dot " ++ cls) ] []
            , span [ class "status-label" ] [ text label ]
            , span [ class ("status-word " ++ cls) ] [ text word ]
            , span [ class "status-age muted small", title ageTitle ] [ text age ]
            ]
            :: detail
        )


viewSummary : Time.Zone -> Dict String Decode.Value -> List (Html Msg)
viewSummary zone summary =
    if Dict.isEmpty summary then
        []

    else
        [ summaryBlock (List.map (\( k, v ) -> ( k, summaryValue zone v )) (Dict.toList summary)) ]


summaryBlock : List ( String, String ) -> Html Msg
summaryBlock pairs =
    div [ class "summary" ] (List.map summaryItem pairs)


summaryItem : ( String, String ) -> Html Msg
summaryItem ( k, v ) =
    span [ class "summary-item" ]
        [ span [ class "summary-k muted small" ] [ text k ]
        , span [ class "summary-v small" ] [ text v ]
        ]


jobStateClassWord : JobState -> ( String, String )
jobStateClassWord state =
    case state of
        Healthy ->
            ( "ok", "ok" )

        Failing ->
            ( "fail", "failing" )

        NeverRun ->
            ( "never", "never run" )


gateStateClassWord : GateState -> ( String, String )
gateStateClassWord state =
    case state of
        Exposed ->
            ( "fail", "exposed" )

        Gated ->
            ( "ok", "gated" )

        DevBypass ->
            ( "muted", "dev bypass" )

        Disabled ->
            ( "muted", "disabled" )


{-| Coarse relative age from a millisecond delta (the payload's own `generated_at` is "now",
mirroring the badge — no wall-clock subscription needed). -}
relAge : Int -> String
relAge ms =
    let
        s =
            max 0 (ms // 1000)
    in
    if s < 60 then
        "just now"

    else if s < 3600 then
        String.fromInt (s // 60) ++ "m ago"

    else if s < 86400 then
        String.fromInt (s // 3600) ++ "h ago"

    else
        String.fromInt (s // 86400) ++ "d ago"


{-| Render a summary value, formatting a timestamp-shaped integer (epoch ms, ≥ ~2001) as a
local time and leaving everything else (counts, strings, null) as compact JSON. The threshold
keeps real counts — never anywhere near 1e12 — from being mistaken for timestamps, so the
generic render stays per-key-agnostic. -}
summaryValue : Time.Zone -> Decode.Value -> String
summaryValue zone v =
    case Decode.decodeValue Decode.int v of
        Ok n ->
            if n >= 1000000000000 then
                formatLocal zone n

            else
                Encode.encode 0 v

        Err _ ->
            Encode.encode 0 v


{-| Format an epoch-ms instant in the given zone as "Mon D, h:mm AM/PM" (e.g. "Jun 27, 2:34 PM"). -}
formatLocal : Time.Zone -> Int -> String
formatLocal zone ms =
    let
        posix =
            Time.millisToPosix ms

        hour24 =
            Time.toHour zone posix

        hour12 =
            if modBy 12 hour24 == 0 then
                12

            else
                modBy 12 hour24

        minute =
            String.padLeft 2 '0' (String.fromInt (Time.toMinute zone posix))

        meridiem =
            if hour24 < 12 then
                "AM"

            else
                "PM"
    in
    monthAbbr (Time.toMonth zone posix)
        ++ " "
        ++ String.fromInt (Time.toDay zone posix)
        ++ ", "
        ++ String.fromInt hour12
        ++ ":"
        ++ minute
        ++ " "
        ++ meridiem


monthAbbr : Time.Month -> String
monthAbbr month =
    case month of
        Time.Jan ->
            "Jan"

        Time.Feb ->
            "Feb"

        Time.Mar ->
            "Mar"

        Time.Apr ->
            "Apr"

        Time.May ->
            "May"

        Time.Jun ->
            "Jun"

        Time.Jul ->
            "Jul"

        Time.Aug ->
            "Aug"

        Time.Sep ->
            "Sep"

        Time.Oct ->
            "Oct"

        Time.Nov ->
            "Nov"

        Time.Dec ->
            "Dec"


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

        Http.BadStatus status ->
            "HTTP " ++ String.fromInt status

        Http.BadBody detail ->
            "unexpected response: " ++ detail
