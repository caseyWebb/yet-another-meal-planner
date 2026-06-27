module SchemaExampleTest exposing (suite)

{-| Pin the schema → example generator. The load-bearing test is the **round-trip invariant**
(`Jsonc.strip (generate s)` parses to exactly the schema's required fields) — it ties the
generator's comma/comment choices to the normalizer so the seeded example can't silently
become unparseable. The rest pin the per-shape rendering rules and the required-first order.
-}

import Dev.Jsonc as Jsonc
import Dev.SchemaExample exposing (generate)
import Expect
import Json.Decode as Decode
import Json.Encode as Encode
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "Dev.SchemaExample.generate"
        [ test "required field is live, optional field is commented out" <|
            \_ ->
                generate (objSchema [ ( "name", str ), ( "quantity", str ) ] [ "name" ])
                    |> Expect.all
                        [ \o -> String.contains "\"name\": \"\"" o |> Expect.equal True
                        , \o -> String.contains "// \"quantity\"" o |> Expect.equal True
                        ]
        , test "renders a pretty, indented, commented example (exact layout)" <|
            \_ ->
                generate (objSchema [ ( "name", str ), ( "note", str ) ] [ "name" ])
                    |> Expect.equal "{\n  \"name\": \"\",\n  // \"note\": \"\",\n}"
        , test "required fields are ordered before optional fields" <|
            \_ ->
                generate (objSchema [ ( "zzz_opt", str ), ( "aaa_req", str ) ] [ "aaa_req" ])
                    |> before "aaa_req" "zzz_opt"
                    |> Expect.equal True
        , test "multiple required fields follow the required-array order" <|
            \_ ->
                generate (objSchema [ ( "a", str ), ( "b", str ) ] [ "b", "a" ])
                    |> before "\"b\"" "\"a\""
                    |> Expect.equal True
        , test "enum uses the first value and lists alternatives in a comment" <|
            \_ ->
                generate (objSchema [ ( "kind", enum [ "grocery", "household", "other" ] ) ] [ "kind" ])
                    |> Expect.all
                        [ \o -> String.contains "\"kind\": \"grocery\"" o |> Expect.equal True
                        , \o -> String.contains "grocery | household | other" o |> Expect.equal True
                        ]
        , test "a field default is used as the value" <|
            \_ ->
                generate (objSchema [ ( "enabled", boolWithDefault True ) ] [ "enabled" ])
                    |> String.contains "\"enabled\": true"
                    |> Expect.equal True
        , test "a nullable field is shown as its underlying example, not null" <|
            \_ ->
                generate (objSchema [ ( "note", nullable str ) ] [ "note" ])
                    |> String.contains "\"note\": \"\""
                    |> Expect.equal True
        , test "an array is shown with one sample element" <|
            \_ ->
                generate (objSchema [ ( "tags", array str ) ] [ "tags" ])
                    |> String.contains "\"tags\": [\"\"]"
                    |> Expect.equal True
        , test "a nested object recurses" <|
            \_ ->
                generate (objSchema [ ( "context", objSchema [ ( "servings", num ) ] [ "servings" ] ) ] [ "context" ])
                    |> Expect.all
                        [ \o -> String.contains "\"context\": {" o |> Expect.equal True
                        , \o -> String.contains "\"servings\": 0" o |> Expect.equal True
                        ]
        , test "an object with no fields yields {}" <|
            \_ -> generate (objSchema [] []) |> Expect.equal "{}"
        , test "a null schema yields {}" <|
            \_ -> generate Encode.null |> Expect.equal "{}"
        , test "an unrecognized node degrades to null with a hint" <|
            \_ ->
                generate (objSchema [ ( "x", Encode.object [ ( "oneOf", Encode.list identity [ str ] ) ] ) ] [ "x" ])
                    |> Expect.all
                        [ \o -> String.contains "\"x\": null" o |> Expect.equal True
                        , \o -> String.contains "(unsupported schema)" o |> Expect.equal True
                        ]
        , describe "round-trip invariant: strip(generate s) parses to the required-only object"
            [ test "single required field among optionals" <|
                \_ -> invariant (objSchema [ ( "name", str ), ( "quantity", str ) ] [ "name" ]) [ "name" ]
            , test "all optional → empty object" <|
                \_ -> invariant (objSchema [ ( "a", str ), ( "b", str ) ] []) []
            , test "mixed required including an enum, with an optional present" <|
                \_ -> invariant (objSchema [ ( "name", str ), ( "kind", enum [ "a", "b" ] ), ( "opt", str ) ] [ "name", "kind" ]) [ "name", "kind" ]
            , test "no-field tool" <|
                \_ -> invariant (objSchema [] []) []
            ]
        ]



-- INVARIANT


invariant : Encode.Value -> List String -> Expect.Expectation
invariant schema required =
    let
        stripped =
            Jsonc.strip (generate schema)
    in
    case Decode.decodeString (Decode.keyValuePairs Decode.value) stripped of
        Ok pairs ->
            List.sort (List.map Tuple.first pairs) |> Expect.equal (List.sort required)

        Err err ->
            Expect.fail ("expected the stripped example to parse; got " ++ Decode.errorToString err ++ "\n---\n" ++ stripped)



-- SCHEMA BUILDERS (draft-07 fragments, as the MCP SDK emits them)


objSchema : List ( String, Encode.Value ) -> List String -> Encode.Value
objSchema props required =
    Encode.object
        [ ( "type", Encode.string "object" )
        , ( "properties", Encode.object props )
        , ( "required", Encode.list Encode.string required )
        ]


str : Encode.Value
str =
    Encode.object [ ( "type", Encode.string "string" ) ]


num : Encode.Value
num =
    Encode.object [ ( "type", Encode.string "number" ) ]


enum : List String -> Encode.Value
enum options =
    Encode.object
        [ ( "type", Encode.string "string" )
        , ( "enum", Encode.list Encode.string options )
        ]


boolWithDefault : Bool -> Encode.Value
boolWithDefault value =
    Encode.object
        [ ( "type", Encode.string "boolean" )
        , ( "default", Encode.bool value )
        ]


nullable : Encode.Value -> Encode.Value
nullable inner =
    Encode.object
        [ ( "anyOf", Encode.list identity [ inner, Encode.object [ ( "type", Encode.string "null" ) ] ] ) ]


array : Encode.Value -> Encode.Value
array items =
    Encode.object
        [ ( "type", Encode.string "array" )
        , ( "items", items )
        ]



-- HELPERS


before : String -> String -> String -> Bool
before a b s =
    case ( List.head (String.indexes a s), List.head (String.indexes b s) ) of
        ( Just i, Just j ) ->
            i < j

        _ ->
            False
