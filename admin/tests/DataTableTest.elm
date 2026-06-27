module DataTableTest exposing (suite)

{-| The generic flat-table browser's compiler-opaque logic: decoding the `{columns, rows}`
shape and rendering a heterogeneous cell value compactly (string verbatim, null/absent
empty, everything else compact JSON).
-}

import Data.Table as Table
import Expect
import Json.Decode as Decode
import Json.Encode as Encode
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "Data.Table"
        [ describe "tablePageDecoder"
            [ test "decodes columns (ordered) and rows" <|
                \_ ->
                    let
                        json =
                            "{\"table\":\"aliases\",\"columns\":[\"variant\",\"canonical\"],\"rows\":[{\"variant\":\"EVOO\",\"canonical\":\"olive oil\"}]}"
                    in
                    Decode.decodeString Table.tablePageDecoder json
                        |> Result.map (\p -> ( p.columns, List.length p.rows ))
                        |> Expect.equal (Ok ( [ "variant", "canonical" ], 1 ))
            ]
        , describe "renderCell"
            [ test "a string renders verbatim" <|
                \_ -> Table.renderCell (Just (Encode.string "olive oil")) |> Expect.equal "olive oil"
            , test "an absent value renders empty" <|
                \_ -> Table.renderCell Nothing |> Expect.equal ""
            , test "JSON null renders empty" <|
                \_ -> Table.renderCell (Just Encode.null) |> Expect.equal ""
            , test "a number renders as compact JSON" <|
                \_ -> Table.renderCell (Just (Encode.int 42)) |> Expect.equal "42"
            , test "an array renders as compact JSON" <|
                \_ ->
                    Table.renderCell (Just (Encode.list Encode.string [ "a", "b" ]))
                        |> Expect.equal "[\"a\",\"b\"]"
            ]
        ]
