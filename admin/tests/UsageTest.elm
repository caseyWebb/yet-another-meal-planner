module UsageTest exposing (suite)

{-| The compiler-opaque logic in `Usage`: the `configured` discriminator decode (a
not-configured payload must become the `NotConfigured` state, a configured one the figures) and
the `isOver` limit predicate. The types can't prove these — the shapes can.
-}

import Expect
import Json.Decode as Decode
import Test exposing (Test, describe, test)
import Usage exposing (ToolsView(..), TrendsView(..), UsageView(..))


suite : Test
suite =
    describe "Usage"
        [ describe "usageViewDecoder"
            [ test "an unconfigured payload decodes to the NotConfigured state" <|
                \_ ->
                    Decode.decodeString Usage.usageViewDecoder "{\"configured\":false}"
                        |> Expect.equal (Ok NotConfigured)
            , test "a configured payload decodes the day, KV totals, namespaces, and AI neurons" <|
                \_ ->
                    Decode.decodeString Usage.usageViewDecoder configuredPayload
                        |> Result.map summarize
                        |> Expect.equal (Ok { day = "2026-06-28", writes = 1440, namespaces = 2, neurons = 1242 })
            ]
        , describe "isOver"
            [ test "under the limit is not over" <|
                \_ -> Usage.isOver 999 1000 |> Expect.equal False
            , test "exactly at the limit is over (the alarm threshold)" <|
                \_ -> Usage.isOver 1000 1000 |> Expect.equal True
            , test "above the limit is over" <|
                \_ -> Usage.isOver 1440 1000 |> Expect.equal True
            ]
        , describe "trendsViewDecoder"
            [ test "an unconfigured payload decodes to the TrendsNotConfigured state" <|
                \_ ->
                    Decode.decodeString Usage.trendsViewDecoder "{\"configured\":false}"
                        |> Expect.equal (Ok TrendsNotConfigured)
            , test "a configured payload decodes each job's per-day series" <|
                \_ ->
                    Decode.decodeString Usage.trendsViewDecoder configuredTrends
                        |> Result.map summarizeTrends
                        |> Expect.equal (Ok { jobs = 1, firstJob = "flyer-warm", days = 2, latestRuns = 288 })
            ]
        , describe "toolsViewDecoder"
            [ test "an unconfigured payload decodes to the ToolsNotConfigured state" <|
                \_ ->
                    Decode.decodeString Usage.toolsViewDecoder "{\"configured\":false}"
                        |> Expect.equal (Ok ToolsNotConfigured)
            , test "a configured payload decodes each tool's aggregates" <|
                \_ ->
                    Decode.decodeString Usage.toolsViewDecoder configuredTools
                        |> Result.map summarizeTools
                        |> Expect.equal (Ok { tools = 2, firstTool = "kroger_prices", firstCalls = 12 })
            ]
        , describe "errorRate"
            [ test "is errors over calls" <|
                \_ ->
                    Usage.errorRate { tool = "x", calls = 20, errors = 5, p50Ms = 1, p95Ms = 2 }
                        |> Expect.within (Expect.Absolute 0.0001) 0.25
            , test "is zero when the tool had no calls (no division by zero)" <|
                \_ ->
                    Usage.errorRate { tool = "x", calls = 0, errors = 0, p50Ms = 0, p95Ms = 0 }
                        |> Expect.equal 0
            ]
        , describe "errorBodyDecoder"
            [ test "decodes the Worker's { error, message } body into both fields" <|
                \_ ->
                    Decode.decodeString Usage.errorBodyDecoder
                        "{\"error\":\"upstream_unavailable\",\"message\":\"Cloudflare Analytics request failed: Illegal invocation\"}"
                        |> Expect.equal
                            (Ok
                                { code = "upstream_unavailable"
                                , message = "Cloudflare Analytics request failed: Illegal invocation"
                                }
                            )
            , test "fails on a body that is not the { error, message } shape (so resolveResponse falls back to a bare status)" <|
                \_ ->
                    Decode.decodeString Usage.errorBodyDecoder "<html>502 Bad Gateway</html>"
                        |> Result.toMaybe
                        |> Expect.equal Nothing
            , test "fails when the message field is absent (a partial body is not an upstream error)" <|
                \_ ->
                    Decode.decodeString Usage.errorBodyDecoder "{\"error\":\"not_found\"}"
                        |> Result.toMaybe
                        |> Expect.equal Nothing
            ]
        ]


{-| Pull the compiler-opaque values out of a decoded `Configured` payload for one assertion; a
`NotConfigured` (shouldn't happen for this fixture) yields sentinel values that fail the test.
-}
summarize : UsageView -> { day : String, writes : Int, namespaces : Int, neurons : Int }
summarize view =
    case view of
        NotConfigured ->
            { day = "", writes = -1, namespaces = -1, neurons = -1 }

        Configured data ->
            { day = data.day
            , writes = data.kv.totals.write
            , namespaces = List.length data.kv.namespaces
            , neurons = data.ai.neuronsUsed
            }


{-| Pull the compiler-opaque values out of a decoded `TrendsConfigured` payload for one assertion;
a `TrendsNotConfigured` (shouldn't happen for this fixture) yields sentinel values that fail.
-}
summarizeTrends : TrendsView -> { jobs : Int, firstJob : String, days : Int, latestRuns : Int }
summarizeTrends view =
    case view of
        TrendsNotConfigured ->
            { jobs = -1, firstJob = "", days = -1, latestRuns = -1 }

        TrendsConfigured jobs ->
            case jobs of
                first :: _ ->
                    { jobs = List.length jobs
                    , firstJob = first.job
                    , days = List.length first.days
                    , latestRuns =
                        List.reverse first.days
                            |> List.head
                            |> Maybe.map .runs
                            |> Maybe.withDefault -1
                    }

                [] ->
                    { jobs = 0, firstJob = "", days = 0, latestRuns = -1 }


{-| Pull the compiler-opaque values out of a decoded `ToolsConfigured` payload for one assertion;
a `ToolsNotConfigured` (shouldn't happen for this fixture) yields sentinel values that fail.
-}
summarizeTools : ToolsView -> { tools : Int, firstTool : String, firstCalls : Int }
summarizeTools view =
    case view of
        ToolsNotConfigured ->
            { tools = -1, firstTool = "", firstCalls = -1 }

        ToolsConfigured tools ->
            case tools of
                first :: _ ->
                    { tools = List.length tools, firstTool = first.tool, firstCalls = first.calls }

                [] ->
                    { tools = 0, firstTool = "", firstCalls = -1 }


configuredTools : String
configuredTools =
    """
    { "configured": true
    , "generated_at": 1700000000000
    , "window_days": 30
    , "tools":
        [ { "tool": "kroger_prices", "calls": 12, "errors": 2, "p50_ms": 250.0, "p95_ms": 800.0 }
        , { "tool": "read_recipe", "calls": 5, "errors": 0, "p50_ms": 12.0, "p95_ms": 40.0 }
        ]
    }
    """


configuredTrends : String
configuredTrends =
    """
    { "configured": true
    , "generated_at": 1700000000000
    , "window_days": 30
    , "jobs":
        [ { "job": "flyer-warm"
          , "days":
              [ { "day": "2026-06-27", "runs": 287, "avg_ms": 41.0, "total_ms": 11767.0 }
              , { "day": "2026-06-28", "runs": 288, "avg_ms": 40.0, "total_ms": 11520.0 }
              ]
          }
        ]
    }
    """


configuredPayload : String
configuredPayload =
    """
    { "configured": true
    , "generated_at": 1700000000000
    , "day": "2026-06-28"
    , "kv":
        { "limits": { "read": 100000, "write": 1000, "delete": 1000, "list": 1000 }
        , "totals": { "read": 5000, "write": 1440, "delete": 3, "list": 12 }
        , "namespaces":
            [ { "namespace_id": "ns_a", "read": 5000, "write": 1140, "delete": 3, "list": 0 }
            , { "namespace_id": "ns_b", "read": 0, "write": 300, "delete": 0, "list": 12 }
            ]
        }
    , "ai":
        { "neurons_limit": 10000
        , "neurons_used": 1242
        , "by_model": [ { "model": "@cf/baai/bge-base-en-v1.5", "neurons": 1242 } ]
        }
    }
    """
