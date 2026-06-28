module UsageTest exposing (suite)

{-| The compiler-opaque logic in `Usage`: the `configured` discriminator decode (a
not-configured payload must become the `NotConfigured` state, a configured one the figures) and
the `isOver` limit predicate. The types can't prove these — the shapes can.
-}

import Expect
import Json.Decode as Decode
import Test exposing (Test, describe, test)
import Usage exposing (UsageView(..))


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
        ]


{-| Pull the compiler-opaque values out of a decoded `Configured` payload for one assertion; a
`NotConfigured` (shouldn't happen for this fixture) yields sentinel values that fail the test. -}
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
