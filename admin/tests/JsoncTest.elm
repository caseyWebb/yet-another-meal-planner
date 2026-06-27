module JsoncTest exposing (suite)

{-| Pin the JSON-with-comments normalizer (`Dev.Jsonc.strip`). The risky parts are the
string-awareness (a `//` inside a URL is data, not a comment; a `\"` doesn't end a string)
and the trailing-comma rule — these are exactly the cases that decide whether the seeded,
commented example round-trips when the operator uncomments a subset. Outputs are predictable
because `strip` only removes comments + trailing commas and otherwise preserves bytes.
-}

import Dev.Jsonc as Jsonc
import Expect
import Json.Decode as Decode
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "Dev.Jsonc.strip"
        [ test "removes a // line comment, keeping the newline" <|
            \_ -> Jsonc.strip "a // comment\nb" |> Expect.equal "a \nb"
        , test "removes a /* */ block comment" <|
            \_ -> Jsonc.strip "a /* x */ b" |> Expect.equal "a  b"
        , test "removes a block comment spanning lines" <|
            \_ -> Jsonc.strip "{\n/* one\ntwo */\n}" |> Expect.equal "{\n\n}"
        , test "preserves // inside a string value" <|
            \_ -> Jsonc.strip "\"http://example.com\"" |> Expect.equal "\"http://example.com\""
        , test "preserves /* inside a string value" <|
            \_ -> Jsonc.strip "\"a /* b\"" |> Expect.equal "\"a /* b\""
        , test "an escaped quote does not end the string" <|
            \_ -> Jsonc.strip "\"a\\\"b\" // c" |> Expect.equal "\"a\\\"b\" "
        , test "drops a trailing comma before }" <|
            \_ -> Jsonc.strip "{\"a\":1,}" |> Expect.equal "{\"a\":1}"
        , test "drops a trailing comma before ]" <|
            \_ -> Jsonc.strip "[1,]" |> Expect.equal "[1]"
        , test "drops a trailing comma separated by whitespace/newlines" <|
            \_ -> Jsonc.strip "{\n  \"a\": 1,\n}" |> Expect.equal "{\n  \"a\": 1\n}"
        , test "keeps a non-trailing comma" <|
            \_ -> Jsonc.strip "[1,2]" |> Expect.equal "[1,2]"
        , test "does not treat a comma inside a string as trailing" <|
            \_ -> Jsonc.strip "{\"a\":\"x,\"}" |> Expect.equal "{\"a\":\"x,\"}"
        , test "passes clean JSON through unchanged" <|
            \_ -> Jsonc.strip "{\"a\": 1, \"b\": [2, 3]}" |> Expect.equal "{\"a\": 1, \"b\": [2, 3]}"
        , test "a commented example with a trailing comma parses after stripping" <|
            \_ ->
                let
                    jsonc =
                        "{\n  \"name\": \"\",\n  // \"kind\": \"grocery\",  // grocery | household\n}"
                in
                Jsonc.strip jsonc
                    |> Decode.decodeString (Decode.field "name" Decode.string)
                    |> Expect.equal (Ok "")
        ]
