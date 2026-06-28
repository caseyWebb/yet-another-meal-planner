module DataRecipeTest exposing (suite)

{-| The Recipe view's compiler-opaque logic: decoding the server's `status` discriminant
(plus the reconcile reason / derived state) into the one `RecipeTier` custom type. A wrong
mapping here is exactly the "indexed but also skipped" contradiction the type forbids — so
it is worth pinning that each status lands on the right variant.
-}

import Data.Recipe as Recipe exposing (DerivedState(..), RecipeTier(..))
import Expect
import Json.Decode as Decode
import Test exposing (Test, describe, test)


tierOf : String -> Result Decode.Error RecipeTier
tierOf json =
    Decode.decodeString Recipe.recipeDetailDecoder json |> Result.map .tier


detail : String -> String -> String
detail status extra =
    "{\"slug\":\"foo\",\"status\":\""
        ++ status
        ++ "\","
        ++ extra
        ++ ",\"source\":null,\"body\":null,\"projection\":null,\"dispositions\":[],\"notes\":[]}"


suite : Test
suite =
    describe "Data.Recipe"
        [ describe "recipeDetailDecoder → RecipeTier"
            [ test "indexed + described" <|
                \_ ->
                    tierOf (detail "indexed" "\"reconcile_message\":null,\"derived\":{\"description\":\"A dish.\",\"has_embedding\":true,\"state\":\"described\"}")
                        |> Expect.equal (Ok (Indexed Described))
            , test "indexed + description pending (state pending)" <|
                \_ ->
                    tierOf (detail "indexed" "\"reconcile_message\":null,\"derived\":{\"description\":null,\"has_embedding\":false,\"state\":\"pending\"}")
                        |> Expect.equal (Ok (Indexed DescriptionPending))
            , test "indexed + no derived row reads as description pending" <|
                \_ ->
                    tierOf (detail "indexed" "\"reconcile_message\":null,\"derived\":null")
                        |> Expect.equal (Ok (Indexed DescriptionPending))
            , test "skipped carries the reconcile reason" <|
                \_ ->
                    tierOf (detail "skipped" "\"reconcile_message\":\"cuisine not in vocab\",\"derived\":null")
                        |> Expect.equal (Ok (Skipped "cuisine not in vocab"))
            , test "pending" <|
                \_ ->
                    tierOf (detail "pending" "\"reconcile_message\":null,\"derived\":null")
                        |> Expect.equal (Ok Pending)
            , test "orphaned" <|
                \_ ->
                    tierOf (detail "orphaned" "\"reconcile_message\":null,\"derived\":null")
                        |> Expect.equal (Ok Orphaned)
            , test "an unknown status fails the decode (surfaced, not silently mapped)" <|
                \_ ->
                    tierOf (detail "bogus" "\"reconcile_message\":null,\"derived\":null")
                        |> Expect.err
            ]
        , test "decodes the cross-tenant dispositions, named" <|
            \_ ->
                let
                    json =
                        "{\"slug\":\"foo\",\"status\":\"indexed\",\"reconcile_message\":null,\"source\":\"x\",\"body\":null,\"projection\":null,\"derived\":null,\"dispositions\":[{\"tenant\":\"alice\",\"favorite\":true,\"reject\":false}],\"notes\":[]}"
                in
                Decode.decodeString Recipe.recipeDetailDecoder json
                    |> Result.map (.dispositions >> List.map .tenant)
                    |> Expect.equal (Ok [ "alice" ])
        ]
