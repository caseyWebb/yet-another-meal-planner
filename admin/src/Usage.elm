module Usage exposing
    ( JobTrend
    , KvCounts
    , Model
    , Msg
    , ToolUsage
    , ToolsView(..)
    , TrendDay
    , TrendsView(..)
    , UpstreamError
    , UsageData
    , UsageError(..)
    , UsageView(..)
    , errorBodyDecoder
    , errorRate
    , init
    , isOver
    , toolsViewDecoder
    , trendsViewDecoder
    , update
    , usageViewDecoder
    , view
    )

{-| The Usage area's resource-usage observability view (usage-observability capability).

A routed page (`/admin/usage`) backed by `GET /admin/api/usage`. It surfaces the current UTC
day's **KV operations** (reads / writes / deletes / lists, account-wide and per namespace) and
**Workers AI neuron** consumption against the daily free-tier limits, so the operator can see
what is eating which budget. The data is sourced (Worker-side) from the Cloudflare GraphQL
Analytics API at zero KV cost — observing the budget must not consume it.

Modeling discipline (see ../CLAUDE.md — "make impossible states impossible"):

  - the fetch is `WebData UsageView`, never a loading/error/data triple;
  - "not configured" is a **state**, not a `Maybe`: the payload is a discriminated union
    `NotConfigured | Configured UsageData` decoded from the `configured` flag, so a
    "configured-but-empty" nonsense value cannot exist;
  - over-limit is **derived** in the view (`isOver`), never a stored boolean that could drift
    from the counts it summarizes.

KV rows are keyed by **namespace id** (the dimension the Analytics API exposes — a Worker
cannot map ids back to binding names at runtime).

Below the day's snapshot, a **Trends** panel (usage-trends) shows each background job's run
metrics (count + duration) over the recent window, sourced from `GET /admin/api/usage/trends`
(the Analytics Engine SQL API) — the **history** tier complementing the snapshot. It reuses the
same opt-in config and the same `WebData` + not-configured discipline, so an unconfigured
deployment renders an explicit "trends not available" state rather than an error.

The second export group is exposed for `tests/UsageTest.elm` — the `configured` discriminator
decode and the over-limit predicate are the compiler-opaque logic worth pinning; the third is
the trends-payload decode (its own `configured` discriminator).

-}

import Array exposing (Array)
import Html exposing (Html, button, div, h2, p, span, strong, text)
import Html.Attributes exposing (class, title)
import Html.Events exposing (onClick)
import Http
import Json.Decode as Decode exposing (Decoder)
import RemoteData exposing (RemoteData(..))



-- MODEL


type alias Model =
    { usage : Loaded UsageView
    , trends : Loaded TrendsView
    , tools : Loaded ToolsView
    }


{-| A loaded usage request: like `WebData`, but its failure carries a typed `UsageError` instead
of a bare `Http.Error`, so the view can render the upstream `{ error, message }` body the Worker
returns rather than a bare HTTP status.
-}
type alias Loaded a =
    RemoteData UsageError a


{-| Why a request failed. A transport/decoding problem keeps the structured `Http.Error`; an
upstream failure carries the Worker's decoded `{ error, message }` body so the operator sees the
real cause (e.g. an analytics binding or token problem) without opening the browser console. The
page is admin-only behind the Access gate, so showing full upstream detail is safe. Modeled as a
union — never `Maybe String` — so the error and its content cannot contradict (see ../CLAUDE.md).
-}
type UsageError
    = Transport Http.Error
    | Upstream UpstreamError


{-| The Worker's structured error body (`src/errors.ts` `ToolError.toShape()`): an error `code`
and a human-readable `message`.
-}
type alias UpstreamError =
    { code : String
    , message : String
    }


{-| The usage payload: either the deployment has no Cloudflare Analytics config (the opt-in is
unset), or it is configured and carries the day's figures. Decoded from the `configured` flag,
so "configured but no data" is unrepresentable.
-}
type UsageView
    = NotConfigured
    | Configured UsageData


type alias UsageData =
    { day : String
    , kv : KvUsage
    , ai : AiUsage
    }


{-| Per-action KV operation counts (a day's totals, or one namespace's slice).
-}
type alias KvCounts =
    { read : Int
    , write : Int
    , delete : Int
    , list : Int
    }


type alias KvUsage =
    { limits : KvCounts
    , totals : KvCounts
    , namespaces : List NamespaceUsage
    }


type alias NamespaceUsage =
    { namespaceId : String
    , counts : KvCounts
    }


type alias AiUsage =
    { neuronsLimit : Int
    , neuronsUsed : Int
    , byModel : List AiModelUsage
    }


type alias AiModelUsage =
    { model : String
    , neurons : Int
    }


{-| The trends payload (usage-trends): either the deployment has no Cloudflare Analytics config
(the same opt-in the snapshot uses), or it carries each job's per-day run series. Decoded from
the `configured` flag, so "configured but no data" is unrepresentable.
-}
type TrendsView
    = TrendsNotConfigured
    | TrendsConfigured (List JobTrend)


{-| One background job's day-by-day run metrics over the window (ascending by day).
-}
type alias JobTrend =
    { job : String
    , days : List TrendDay
    }


{-| One job's metrics for a single UTC day: run count and mean/total run duration (ms).
-}
type alias TrendDay =
    { day : String
    , runs : Int
    , avgMs : Float
    , totalMs : Float
    }


{-| The tool-usage payload (tool-usage-trends): either the deployment has no Cloudflare Analytics
config (the same opt-in the snapshot uses), or it carries each MCP tool's window aggregates. Decoded
from the `configured` flag, so "configured but no data" is unrepresentable.
-}
type ToolsView
    = ToolsNotConfigured
    | ToolsConfigured (List ToolUsage)


{-| One MCP tool's aggregate metrics over the window: call count, error count (the error RATE is
derived in the view, never stored — it can't drift from the counts), and p50/p95 call duration (ms).
-}
type alias ToolUsage =
    { tool : String
    , calls : Int
    , errors : Int
    , p50Ms : Float
    , p95Ms : Float
    }


init : ( Model, Cmd Msg )
init =
    ( { usage = Loading, trends = Loading, tools = Loading }
    , Cmd.batch [ fetchUsage, fetchTrends, fetchTools ]
    )



-- UPDATE


type Msg
    = GotUsage (Loaded UsageView)
    | GotTrends (Loaded TrendsView)
    | GotTools (Loaded ToolsView)
    | Refresh


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        GotUsage usage ->
            ( { model | usage = usage }, Cmd.none )

        GotTrends trends ->
            ( { model | trends = trends }, Cmd.none )

        GotTools tools ->
            ( { model | tools = tools }, Cmd.none )

        Refresh ->
            ( { model | usage = Loading, trends = Loading, tools = Loading }
            , Cmd.batch [ fetchUsage, fetchTrends, fetchTools ]
            )



-- HTTP


fetchUsage : Cmd Msg
fetchUsage =
    Http.get
        { url = "/admin/api/usage"
        , expect = expectUsageJson GotUsage usageViewDecoder
        }


{-| Like `Http.expectJson`, but a non-2xx response is not discarded to a bare `BadStatus`: its
body is decoded as the Worker's `{ error, message }` shape and carried as an `Upstream` error, so
the view shows the real upstream message. `Http.expectJson` throws the non-2xx body away (that is
the whole reason the panel only ever showed "HTTP 500"); `Http.expectStringResponse` keeps it.
-}
expectUsageJson : (Loaded a -> Msg) -> Decoder a -> Http.Expect Msg
expectUsageJson toMsg decoder =
    Http.expectStringResponse (RemoteData.fromResult >> toMsg) (resolveResponse decoder)


{-| Resolve a raw HTTP response into a typed result: a 2xx runs through the success `decoder`; a
non-2xx whose body is the Worker's `{ error, message }` shape becomes an `Upstream` error carrying
the real detail; anything else (a transport failure, an Access-gate HTML 403/404, an undecodable
body) degrades to a `Transport` error so the existing friendly messages still apply.
-}
resolveResponse : Decoder a -> Http.Response String -> Result UsageError a
resolveResponse decoder response =
    case response of
        Http.BadUrl_ url ->
            Err (Transport (Http.BadUrl url))

        Http.Timeout_ ->
            Err (Transport Http.Timeout)

        Http.NetworkError_ ->
            Err (Transport Http.NetworkError)

        Http.BadStatus_ metadata body ->
            case Decode.decodeString errorBodyDecoder body of
                Ok upstream ->
                    Err (Upstream upstream)

                Err _ ->
                    Err (Transport (Http.BadStatus metadata.statusCode))

        Http.GoodStatus_ _ body ->
            case Decode.decodeString decoder body of
                Ok value ->
                    Ok value

                Err err ->
                    Err (Transport (Http.BadBody (Decode.errorToString err)))


{-| Decode the Worker's structured error body (`{ error, message }`). Used only on a non-2xx
response; a body that does not match this shape falls back to a bare status (see `resolveResponse`).
-}
errorBodyDecoder : Decoder UpstreamError
errorBodyDecoder =
    Decode.map2 UpstreamError
        (Decode.field "error" Decode.string)
        (Decode.field "message" Decode.string)


{-| Decode the payload, branching on the `configured` discriminator: `false` is the
not-configured state (no figures follow); `true` carries the day's usage.
-}
usageViewDecoder : Decoder UsageView
usageViewDecoder =
    Decode.field "configured" Decode.bool
        |> Decode.andThen
            (\configured ->
                if configured then
                    Decode.map Configured usageDataDecoder

                else
                    Decode.succeed NotConfigured
            )


usageDataDecoder : Decoder UsageData
usageDataDecoder =
    Decode.map3 UsageData
        (Decode.field "day" Decode.string)
        (Decode.field "kv" kvUsageDecoder)
        (Decode.field "ai" aiUsageDecoder)


kvUsageDecoder : Decoder KvUsage
kvUsageDecoder =
    Decode.map3 KvUsage
        (Decode.field "limits" kvCountsDecoder)
        (Decode.field "totals" kvCountsDecoder)
        (Decode.field "namespaces" (Decode.list namespaceDecoder))


kvCountsDecoder : Decoder KvCounts
kvCountsDecoder =
    Decode.map4 KvCounts
        (Decode.field "read" Decode.int)
        (Decode.field "write" Decode.int)
        (Decode.field "delete" Decode.int)
        (Decode.field "list" Decode.int)


namespaceDecoder : Decoder NamespaceUsage
namespaceDecoder =
    Decode.map2 NamespaceUsage
        (Decode.field "namespace_id" Decode.string)
        kvCountsDecoder


aiUsageDecoder : Decoder AiUsage
aiUsageDecoder =
    Decode.map3 AiUsage
        (Decode.field "neurons_limit" Decode.int)
        (Decode.field "neurons_used" Decode.int)
        (Decode.field "by_model" (Decode.list aiModelDecoder))


aiModelDecoder : Decoder AiModelUsage
aiModelDecoder =
    Decode.map2 AiModelUsage
        (Decode.field "model" Decode.string)
        (Decode.field "neurons" Decode.int)


fetchTrends : Cmd Msg
fetchTrends =
    Http.get
        { url = "/admin/api/usage/trends"
        , expect = expectUsageJson GotTrends trendsViewDecoder
        }


{-| Decode the trends payload, branching on the `configured` discriminator: `false` is the
not-available state (no series follow); `true` carries each job's per-day metrics.
-}
trendsViewDecoder : Decoder TrendsView
trendsViewDecoder =
    Decode.field "configured" Decode.bool
        |> Decode.andThen
            (\configured ->
                if configured then
                    Decode.map TrendsConfigured (Decode.field "jobs" (Decode.list jobTrendDecoder))

                else
                    Decode.succeed TrendsNotConfigured
            )


jobTrendDecoder : Decoder JobTrend
jobTrendDecoder =
    Decode.map2 JobTrend
        (Decode.field "job" Decode.string)
        (Decode.field "days" (Decode.list trendDayDecoder))


trendDayDecoder : Decoder TrendDay
trendDayDecoder =
    Decode.map4 TrendDay
        (Decode.field "day" Decode.string)
        (Decode.field "runs" Decode.int)
        (Decode.field "avg_ms" Decode.float)
        (Decode.field "total_ms" Decode.float)


fetchTools : Cmd Msg
fetchTools =
    Http.get
        { url = "/admin/api/usage/tools"
        , expect = expectUsageJson GotTools toolsViewDecoder
        }


{-| Decode the tool-usage payload, branching on the `configured` discriminator: `false` is the
not-available state (no tools follow); `true` carries each tool's window aggregates.
-}
toolsViewDecoder : Decoder ToolsView
toolsViewDecoder =
    Decode.field "configured" Decode.bool
        |> Decode.andThen
            (\configured ->
                if configured then
                    Decode.map ToolsConfigured (Decode.field "tools" (Decode.list toolUsageDecoder))

                else
                    Decode.succeed ToolsNotConfigured
            )


toolUsageDecoder : Decoder ToolUsage
toolUsageDecoder =
    Decode.map5 ToolUsage
        (Decode.field "tool" Decode.string)
        (Decode.field "calls" Decode.int)
        (Decode.field "errors" Decode.int)
        (Decode.field "p50_ms" Decode.float)
        (Decode.field "p95_ms" Decode.float)



-- VIEW


view : Model -> Html Msg
view model =
    div []
        [ div [ class "status-head" ]
            [ h2 [] [ text "Usage" ]
            , button [ class "link", onClick Refresh ] [ text "Refresh" ]
            ]
        , viewBody model.usage
        , viewTrends model.trends
        , viewTools model.tools
        ]


viewBody : Loaded UsageView -> Html Msg
viewBody usage =
    case usage of
        NotAsked ->
            p [] [ text "…" ]

        Loading ->
            p [] [ text "Loading…" ]

        Failure error ->
            div [ class "error" ] [ text ("Could not load /admin/api/usage: " ++ usageError error) ]

        Success NotConfigured ->
            viewNotConfigured

        Success (Configured data) ->
            viewUsage data


{-| The opt-in-unset state: name the two variables the operator must set, mirroring the
graceful "not configured" degradation of the Access gate / ntfy.
-}
viewNotConfigured : Html Msg
viewNotConfigured =
    div [ class "card" ]
        [ strong [] [ text "Usage analytics not configured. " ]
        , text "Set "
        , span [ class "summary-k" ] [ text "CF_ACCOUNT_ID" ]
        , text " and a read-only "
        , span [ class "summary-k" ] [ text "CF_ANALYTICS_TOKEN" ]
        , text " (Account Analytics: Read) to read account-wide KV-operation and Workers AI neuron usage from the Cloudflare GraphQL Analytics API. Reading usage costs no KV."
        ]


viewUsage : UsageData -> Html Msg
viewUsage data =
    div []
        [ p [ class "muted small" ] [ text ("Cloudflare usage for " ++ data.day ++ " (UTC), against the daily free-tier limits.") ]
        , div [ class "card" ]
            [ h2 [] [ text "KV operations" ]
            , meterRow "reads" data.kv.totals.read data.kv.limits.read
            , meterRow "writes" data.kv.totals.write data.kv.limits.write
            , meterRow "deletes" data.kv.totals.delete data.kv.limits.delete
            , meterRow "lists" data.kv.totals.list data.kv.limits.list
            ]
        , viewNamespaces data.kv.namespaces
        , div [ class "card" ]
            [ h2 [] [ text "Workers AI" ]
            , meterRow "neurons" data.ai.neuronsUsed data.ai.neuronsLimit
            , viewByModel data.ai.byModel
            ]
        ]


{-| One usage meter: a colored dot + label + `used / limit`, red once at or over the limit.
-}
meterRow : String -> Int -> Int -> Html Msg
meterRow label used limit =
    let
        cls =
            if isOver used limit then
                "fail"

            else
                "ok"
    in
    div [ class "status-row" ]
        [ div [ class "status-line" ]
            [ span [ class ("dot " ++ cls) ] []
            , span [ class "status-label" ] [ text label ]
            , span [ class ("status-word " ++ cls) ]
                [ text (String.fromInt used ++ " / " ++ String.fromInt limit) ]
            ]
        ]


{-| Whether usage has reached or exceeded its limit (the alarm threshold). Derived, never
stored — pinned by `tests/UsageTest.elm`.
-}
isOver : Int -> Int -> Bool
isOver used limit =
    used >= limit


viewNamespaces : List NamespaceUsage -> Html Msg
viewNamespaces namespaces =
    div [ class "card" ]
        (h2 [] [ text "By namespace" ]
            :: p [ class "muted small" ] [ text "Keyed by Cloudflare namespace id (read · write · delete · list)." ]
            :: (if List.isEmpty namespaces then
                    [ p [ class "muted" ] [ text "No KV operations recorded today." ] ]

                else
                    List.map viewNamespaceRow namespaces
               )
        )


viewNamespaceRow : NamespaceUsage -> Html Msg
viewNamespaceRow ns =
    div [ class "status-row" ]
        [ div [ class "status-line" ]
            [ span [ class "status-label", title ns.namespaceId ] [ text ns.namespaceId ]
            , span [ class "status-word muted" ] [ text (kvCountsLabel ns.counts) ]
            ]
        ]


kvCountsLabel : KvCounts -> String
kvCountsLabel c =
    String.join " · "
        [ String.fromInt c.read
        , String.fromInt c.write
        , String.fromInt c.delete
        , String.fromInt c.list
        ]


viewByModel : List AiModelUsage -> Html Msg
viewByModel models =
    if List.isEmpty models then
        p [ class "muted" ] [ text "No Workers AI inference recorded today." ]

    else
        div [ class "summary" ] (List.map viewModelItem models)


viewModelItem : AiModelUsage -> Html Msg
viewModelItem m =
    span [ class "summary-item" ]
        [ span [ class "summary-k muted small" ] [ text m.model ]
        , span [ class "summary-v small" ] [ text (String.fromInt m.neurons ++ " neurons") ]
        ]


{-| The Trends panel (usage-trends): each background job's per-day run metrics over the recent
window, sourced from `GET /admin/api/usage/trends`. Mirrors the snapshot's `WebData` discipline,
degrading to an explicit "not available" state when the analytics config is unset.
-}
viewTrends : Loaded TrendsView -> Html Msg
viewTrends trends =
    case trends of
        NotAsked ->
            text ""

        Loading ->
            div [ class "card" ] [ p [ class "muted" ] [ text "Loading trends…" ] ]

        Failure error ->
            div [ class "error" ] [ text ("Could not load /admin/api/usage/trends: " ++ usageError error) ]

        Success TrendsNotConfigured ->
            viewTrendsNotConfigured

        Success (TrendsConfigured jobs) ->
            viewJobTrends jobs


{-| The opt-in-unset state for trends: it reuses the snapshot's analytics config, so name the same
two variables, mirroring the "not configured" degradation elsewhere.
-}
viewTrendsNotConfigured : Html Msg
viewTrendsNotConfigured =
    div [ class "card" ]
        [ strong [] [ text "Usage trends not available. " ]
        , text "Per-job run history comes from the Workers Analytics Engine SQL API, which reuses "
        , span [ class "summary-k" ] [ text "CF_ACCOUNT_ID" ]
        , text " and "
        , span [ class "summary-k" ] [ text "CF_ANALYTICS_TOKEN" ]
        , text ". Set them to see per-job trends over the last 30 days."
        ]


viewJobTrends : List JobTrend -> Html Msg
viewJobTrends jobs =
    div [ class "card" ]
        (h2 [] [ text "Trends" ]
            :: p [ class "muted small" ] [ text "Per-job runs over the last 30 days (UTC), sparkline oldest → newest, from Analytics Engine." ]
            :: (if List.isEmpty jobs then
                    [ p [ class "muted" ] [ text "No usage data points recorded yet." ] ]

                else
                    List.map viewJobTrend jobs
               )
        )


{-| One job's window summary: name, a runs-per-day sparkline, and the window's total runs + the
runs-weighted mean duration.
-}
viewJobTrend : JobTrend -> Html Msg
viewJobTrend jt =
    let
        totalRuns =
            List.sum (List.map .runs jt.days)
    in
    div [ class "status-row" ]
        [ div [ class "status-line" ]
            [ span [ class "status-label" ] [ text jt.job ]
            , span [ class "status-word muted", title "runs per day (oldest → newest)" ] [ text (sparkline jt.days) ]
            , span [ class "status-word muted small" ]
                [ text (String.fromInt totalRuns ++ " runs · " ++ formatMs (weightedAvgMs jt.days) ++ " avg") ]
            ]
        ]


{-| A text sparkline of each day's run count, scaled to the job's own busiest day. Empty when the
job had no runs in the window.
-}
sparkline : List TrendDay -> String
sparkline days =
    let
        runs =
            List.map .runs days

        maxRuns =
            Maybe.withDefault 0 (List.maximum runs)
    in
    if maxRuns <= 0 then
        ""

    else
        String.fromList (List.map (spark maxRuns) runs)


sparkTicks : Array Char
sparkTicks =
    Array.fromList [ '▁', '▂', '▃', '▄', '▅', '▆', '▇', '█' ]


spark : Int -> Int -> Char
spark maxRuns r =
    let
        idx =
            if maxRuns <= 0 then
                0

            else
                round (toFloat r / toFloat maxRuns * 7)
    in
    Maybe.withDefault '▁' (Array.get (clamp 0 7 idx) sparkTicks)


{-| The window's runs-weighted mean duration (ms): total duration over total runs, so busier days
count proportionally. Zero when the job had no runs.
-}
weightedAvgMs : List TrendDay -> Float
weightedAvgMs days =
    let
        runs =
            List.sum (List.map .runs days)
    in
    if runs <= 0 then
        0

    else
        List.sum (List.map .totalMs days) / toFloat runs


formatMs : Float -> String
formatMs ms =
    String.fromInt (round ms) ++ " ms"


{-| The Tool usage panel (tool-usage-trends): each MCP tool's call count, error rate, and latency
percentiles over the recent window, sourced from `GET /admin/api/usage/tools`. Mirrors the trends
panel's `WebData` discipline, degrading to an explicit "not available" state when analytics is unset.
-}
viewTools : Loaded ToolsView -> Html Msg
viewTools tools =
    case tools of
        NotAsked ->
            text ""

        Loading ->
            div [ class "card" ] [ p [ class "muted" ] [ text "Loading tool usage…" ] ]

        Failure error ->
            div [ class "error" ] [ text ("Could not load /admin/api/usage/tools: " ++ usageError error) ]

        Success ToolsNotConfigured ->
            viewToolsNotConfigured

        Success (ToolsConfigured toolList) ->
            viewToolUsageList toolList


{-| The opt-in-unset state for tool usage: it reuses the snapshot's analytics config, so name the
same two variables, mirroring the "not configured" degradation elsewhere.
-}
viewToolsNotConfigured : Html Msg
viewToolsNotConfigured =
    div [ class "card" ]
        [ strong [] [ text "Tool usage not available. " ]
        , text "Per-tool call history comes from the Workers Analytics Engine SQL API, which reuses "
        , span [ class "summary-k" ] [ text "CF_ACCOUNT_ID" ]
        , text " and "
        , span [ class "summary-k" ] [ text "CF_ANALYTICS_TOKEN" ]
        , text ". Set them to see per-tool calls, error rate, and latency over the last 30 days."
        ]


viewToolUsageList : List ToolUsage -> Html Msg
viewToolUsageList tools =
    div [ class "card" ]
        (h2 [] [ text "Tool usage" ]
            :: p [ class "muted small" ] [ text "MCP tool calls over the last 30 days, busiest first: count · error rate · p50 / p95 latency, from Analytics Engine." ]
            :: (if List.isEmpty tools then
                    [ p [ class "muted" ] [ text "No tool calls recorded yet." ] ]

                else
                    List.map viewToolRow tools
               )
        )


{-| One tool's window summary: name, then call count, derived error rate, and p50/p95 latency. The
row turns red when any call errored in the window (error rate > 0) — the loud signal.
-}
viewToolRow : ToolUsage -> Html Msg
viewToolRow t =
    let
        cls =
            if t.errors > 0 then
                "fail"

            else
                "ok"
    in
    div [ class "status-row" ]
        [ div [ class "status-line" ]
            [ span [ class ("dot " ++ cls) ] []
            , span [ class "status-label" ] [ text t.tool ]
            , span [ class "status-word muted small" ] [ text (toolMetrics t) ]
            ]
        ]


toolMetrics : ToolUsage -> String
toolMetrics t =
    String.join " · "
        [ String.fromInt t.calls ++ " calls"
        , formatPct (errorRate t) ++ " err"
        , "p50 " ++ formatMs t.p50Ms
        , "p95 " ++ formatMs t.p95Ms
        ]


{-| A tool's error rate as a fraction of its calls (0 when it had no calls). Derived, never stored —
pinned by `tests/UsageTest.elm`.
-}
errorRate : ToolUsage -> Float
errorRate t =
    if t.calls <= 0 then
        0

    else
        toFloat t.errors / toFloat t.calls


formatPct : Float -> String
formatPct frac =
    String.fromInt (round (frac * 100)) ++ "%"


{-| Render a typed `UsageError` for the operator. An upstream failure shows the Worker's real
`message` and `error` code (full detail — this surface is admin-only behind the Access gate); a
transport failure falls back to the friendly `httpError` strings.
-}
usageError : UsageError -> String
usageError error =
    case error of
        Transport httpErr ->
            httpError httpErr

        Upstream upstream ->
            upstream.message ++ " [" ++ upstream.code ++ "]"


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
