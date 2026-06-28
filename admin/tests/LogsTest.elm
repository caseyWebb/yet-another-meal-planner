module LogsTest exposing (suite)

{-| The compiler-opaque logic in `Logs`: mapping the discovery-log wire string onto the
`Outcome` union, decoding an entry row, and the `hasDetail` predicate that decides whether an
entry is rich enough to open in a dialog (the spec's "more than a row's worth of detail"). The
types can't prove these — the shapes can.
-}

import Expect
import Json.Decode as Decode
import Logs exposing (Outcome(..))
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "Logs"
        [ describe "outcomeFromString"
            [ test "imported" <|
                \_ -> Logs.outcomeFromString "imported" |> Expect.equal Imported
            , test "duplicate" <|
                \_ -> Logs.outcomeFromString "duplicate" |> Expect.equal Duplicate
            , test "no_match" <|
                \_ -> Logs.outcomeFromString "no_match" |> Expect.equal NoMatch
            , test "rejected_source" <|
                \_ -> Logs.outcomeFromString "rejected_source" |> Expect.equal RejectedSource
            , test "dietary_gated" <|
                \_ -> Logs.outcomeFromString "dietary_gated" |> Expect.equal DietaryGated
            , test "error" <|
                \_ -> Logs.outcomeFromString "error" |> Expect.equal Errored
            , test "failed" <|
                \_ -> Logs.outcomeFromString "failed" |> Expect.equal Failed
            , test "an unrecognized outcome is kept as Other (forward-compatible, no decode failure)" <|
                \_ -> Logs.outcomeFromString "something_new" |> Expect.equal (Other "something_new")
            ]
        , describe "entryDecoder"
            [ test "decodes an import row with attribution detail" <|
                \_ ->
                    Decode.decodeString Logs.entryDecoder importRow
                        |> Result.map (\e -> ( e.outcome, e.slug ))
                        |> Expect.equal (Ok ( Imported, Just "miso-salmon" ))
            , test "tolerates null url/title/slug" <|
                \_ ->
                    Decode.decodeString Logs.entryDecoder sparseErrorRow
                        |> Result.map (\e -> ( e.outcome, e.title, e.slug ))
                        |> Expect.equal (Ok ( Errored, Nothing, Nothing ))
            , test "decodes a failed (infra) row" <|
                \_ ->
                    Decode.decodeString Logs.entryDecoder failedRow
                        |> Result.map (\e -> e.outcome)
                        |> Expect.equal (Ok Failed)
            ]
        , describe "hasDetail (is the entry dialog-worthy)"
            [ test "an import with attribution detail has detail" <|
                \_ -> decodedHasDetail importRow |> Expect.equal (Just True)
            , test "a duplicate carrying a matched slug has detail" <|
                \_ -> decodedHasDetail duplicateRow |> Expect.equal (Just True)
            , test "a parked error with a reason has detail" <|
                \_ -> decodedHasDetail errorWithReasonRow |> Expect.equal (Just True)
            , test "a bare no_match row (empty detail, no slug) has no expandable detail" <|
                \_ -> decodedHasDetail bareNoMatchRow |> Expect.equal (Just False)
            , test "an empty-object detail with no slug has nothing to expand" <|
                \_ -> decodedHasDetail emptyObjectDetailRow |> Expect.equal (Just False)
            ]
        ]


decodedHasDetail : String -> Maybe Bool
decodedHasDetail row =
    Decode.decodeString Logs.entryDecoder row
        |> Result.map Logs.hasDetail
        |> Result.toMaybe


importRow : String
importRow =
    """{"id":"1","url":"https://example.com/r","title":"Miso Salmon","source":"feed:nyt","outcome":"imported","slug":"miso-salmon","detail":{"attribution":[{"tenant":"casey","score":0.82}]},"created_at":"2026-06-27T10:00:00.000Z"}"""


duplicateRow : String
duplicateRow =
    """{"id":"2","url":"https://example.com/d","title":"Dup","source":"feed:nyt","outcome":"duplicate","slug":"existing-stew","detail":{"duplicate_of":"existing-stew"},"created_at":"2026-06-27T10:01:00.000Z"}"""


errorWithReasonRow : String
errorWithReasonRow =
    """{"id":"3","url":"https://example.com/e","title":"Broke","source":"feed:nyt","outcome":"error","slug":null,"detail":{"reason":"no JSON-LD recipe found"},"created_at":"2026-06-27T10:02:00.000Z"}"""


bareNoMatchRow : String
bareNoMatchRow =
    """{"id":"4","url":"https://example.com/n","title":"Nope","source":"feed:nyt","outcome":"no_match","slug":null,"detail":null,"created_at":"2026-06-27T10:03:00.000Z"}"""


emptyObjectDetailRow : String
emptyObjectDetailRow =
    """{"id":"5","url":"https://example.com/o","title":"Empty","source":"feed:nyt","outcome":"no_match","slug":null,"detail":{},"created_at":"2026-06-27T10:04:00.000Z"}"""


sparseErrorRow : String
sparseErrorRow =
    """{"id":"6","url":null,"title":null,"source":null,"outcome":"error","slug":null,"detail":{"reason":"x"},"created_at":null}"""


failedRow : String
failedRow =
    """{"id":"7","url":"https://example.com/f","title":"Infra fail","source":"feed:test","outcome":"failed","slug":null,"detail":{"reason":"unexpected: AI timeout"},"created_at":"2026-06-27T10:05:00.000Z"}"""
