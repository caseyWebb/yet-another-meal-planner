module TableEditorTest exposing (suite)

{-| The generic corpus editor's compiler-opaque logic: extracting a row's primary key from
the decoded `{columns, rows}` shape, encoding the add-form draft per field kind, and the
`ActionState` transitions (Idle→Busy→Idle on success, →Failed on error, one-at-a-time).
-}

import Config.TableEditor as TE exposing (ActionState(..), FieldKind(..), Msg(..), Operation(..))
import Dict
import Expect
import Http
import Json.Encode as Encode
import Test exposing (Test, describe, test)


aliasesConfig : TE.EditorConfig
aliasesConfig =
    { title = "Ingredient aliases"
    , slug = "aliases"
    , pkColumn = "variant"
    , addFields =
        [ { key = "variant", label = "Variant", kind = Text, required = True }
        , { key = "canonical", label = "Canonical", kind = Text, required = True }
        ]
    }


feedsConfig : TE.EditorConfig
feedsConfig =
    { title = "Discovery feeds"
    , slug = "feeds"
    , pkColumn = "url"
    , addFields =
        [ { key = "url", label = "URL", kind = Text, required = True }
        , { key = "name", label = "Name", kind = Text, required = False }
        , { key = "weight", label = "Weight", kind = Number, required = False }
        , { key = "tags", label = "Tags", kind = Tags, required = False }
        ]
    }


{-| Drive `update` over a model, ignoring the Cmd, returning the resulting action. -}
actionAfter : List Msg -> ActionState
actionAfter msgs =
    List.foldl (\m model -> Tuple.first (TE.update m model)) (Tuple.first (TE.init aliasesConfig)) msgs
        |> .action


suite : Test
suite =
    describe "Config.TableEditor"
        [ describe "rowKey"
            [ test "extracts the pkColumn cell as a string" <|
                \_ ->
                    Dict.fromList [ ( "variant", Encode.string "EVOO" ), ( "canonical", Encode.string "olive oil" ) ]
                        |> TE.rowKey aliasesConfig
                        |> Expect.equal "EVOO"
            ]
        , describe "encodeAdd"
            [ test "encodes required text fields" <|
                \_ ->
                    let
                        draft =
                            Dict.fromList [ ( "variant", "EVOO" ), ( "canonical", "olive oil" ) ]
                    in
                    TE.encodeAdd aliasesConfig draft
                        |> Encode.encode 0
                        |> Expect.equal "{\"variant\":\"EVOO\",\"canonical\":\"olive oil\"}"
            , test "omits a blank optional field, parses a number, splits tags" <|
                \_ ->
                    let
                        draft =
                            Dict.fromList [ ( "url", "https://a.com" ), ( "weight", "2" ), ( "tags", "x, y" ) ]
                    in
                    TE.encodeAdd feedsConfig draft
                        |> Encode.encode 0
                        -- name omitted (blank); weight a float; tags an array
                        |> Expect.equal "{\"url\":\"https://a.com\",\"weight\":2,\"tags\":[\"x\",\"y\"]}"
            ]
        , describe "isBusy"
            [ test "Idle is not busy" <|
                \_ -> TE.isBusy Idle |> Expect.equal False
            , test "Busy is busy" <|
                \_ -> TE.isBusy (Busy Add) |> Expect.equal True
            , test "Failed is not busy (a retry is allowed)" <|
                \_ -> TE.isBusy (Failed Add Http.Timeout) |> Expect.equal False
            ]
        , describe "ActionState transitions"
            [ test "starts Idle" <|
                \_ -> actionAfter [] |> Expect.equal Idle
            , test "SubmitAdd with required fields filled → Busy Add" <|
                \_ ->
                    actionAfter [ DraftChanged "variant" "x", DraftChanged "canonical" "y", SubmitAdd ]
                        |> Expect.equal (Busy Add)
            , test "SubmitAdd with a required field blank stays Idle (button-disabled guard)" <|
                \_ ->
                    actionAfter [ DraftChanged "variant" "x", SubmitAdd ]
                        |> Expect.equal Idle
            , test "GotAdd Ok → Idle" <|
                \_ ->
                    actionAfter [ DraftChanged "variant" "x", DraftChanged "canonical" "y", SubmitAdd, GotAdd (Ok ()) ]
                        |> Expect.equal Idle
            , test "GotAdd Err → Failed Add" <|
                \_ ->
                    actionAfter
                        [ DraftChanged "variant" "x", DraftChanged "canonical" "y", SubmitAdd, GotAdd (Err Http.Timeout) ]
                        |> Expect.equal (Failed Add Http.Timeout)
            , test "a second mutation while Busy is ignored (one at a time)" <|
                \_ ->
                    actionAfter
                        [ DraftChanged "variant" "x", DraftChanged "canonical" "y", SubmitAdd, RemoveRow "other" ]
                        |> Expect.equal (Busy Add)
            , test "RemoveRow from Idle → Busy (Remove key), then GotRemove Ok → Idle" <|
                \_ ->
                    actionAfter [ RemoveRow "EVOO", GotRemove "EVOO" (Ok ()) ]
                        |> Expect.equal Idle
            , test "RemoveRow from Idle → Busy (Remove key)" <|
                \_ ->
                    actionAfter [ RemoveRow "EVOO" ]
                        |> Expect.equal (Busy (Remove "EVOO"))
            ]
        ]
