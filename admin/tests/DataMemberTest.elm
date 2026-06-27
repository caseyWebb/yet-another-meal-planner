module DataMemberTest exposing (suite)

{-| The Member view's compiler-opaque logic: decoding the 360 bundle (id + the eight
per-tenant sections, the last filled via `andThen` past `map8`'s arity). Pins that every
section lands and the counts are right.
-}

import Data.Member as Member
import Expect
import Json.Decode as Decode
import Test exposing (Test, describe, test)


bundle : String
bundle =
    "{\"id\":\"alice\",\"profile\":{\"taste\":\"spicy\"},"
        ++ "\"pantry\":[{\"name\":\"oil\"}],\"meal_plan\":[],\"grocery_list\":[],"
        ++ "\"overlay\":[{\"recipe\":\"foo\",\"favorite\":1}],\"cooking_log\":[{\"id\":1}],"
        ++ "\"recipe_notes\":[{\"private\":1,\"body\":\"secret\"}],"
        ++ "\"store_notes\":[{\"id\":\"s1\"},{\"id\":\"s2\"}]}"


suite : Test
suite =
    describe "Data.Member"
        [ test "decodes the id and every section's count" <|
            \_ ->
                Decode.decodeString Member.memberDetailDecoder bundle
                    |> Result.map
                        (\m ->
                            { id = m.id
                            , pantry = List.length m.pantry
                            , overlay = List.length m.overlay
                            , cooking = List.length m.cookingLog
                            , recipeNotes = List.length m.recipeNotes
                            , storeNotes = List.length m.storeNotes
                            }
                        )
                    |> Expect.equal
                        (Ok { id = "alice", pantry = 1, overlay = 1, cooking = 1, recipeNotes = 1, storeNotes = 2 })
        , test "tolerates a missing section as empty" <|
            \_ ->
                Decode.decodeString Member.memberDetailDecoder "{\"id\":\"bob\",\"profile\":null}"
                    |> Result.map (\m -> List.length m.pantry)
                    |> Expect.equal (Ok 0)
        ]
