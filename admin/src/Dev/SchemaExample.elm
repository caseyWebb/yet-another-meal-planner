module Dev.SchemaExample exposing (generate)

{-| Turn a tool's input JSON Schema into a pretty, editable example for the console's
argument box — generated **structurally**, never a hand-maintained per-tool string, so a
newly registered tool gets a useful example with zero console code.

Required fields are emitted live with a type-appropriate placeholder; optional fields are
emitted **commented out** so they are discoverable but omitted unless the operator uncomments
them. The result is JSON-with-comments (an `Encode.Value` can't carry comments, so this is a
string builder, not an encoder) that `Dev.Jsonc.strip` normalizes back to strict JSON on
submit. The companion invariant — `Jsonc.strip (generate s)` parses to the schema's
required-only object — is pinned in `tests/SchemaExampleTest.elm`.

Input dialect is JSON Schema draft-07 as the MCP SDK emits it (zod-mini `toJSONSchema`):
`type` (string or `[T,"null"]`), `properties`/`required`, `enum`, `items`, `default`,
`description`, and `anyOf:[T,{"type":"null"}]` for nullable. Anything unrecognized degrades
to `null` rather than failing the box.

-}

import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode



-- SCHEMA MODEL


type Schema
    = SObject (List Field)
    | SString (Maybe (List String)) -- the enum options, when present
    | SNumber
    | SInteger
    | SBoolean
    | SArray Schema
    | SUnknown


type alias Field =
    { name : String
    , required : Bool
    , schema : Schema
    , description : Maybe String
    , default : Maybe Encode.Value
    }



-- PUBLIC


{-| The example string for a tool's input schema. A non-object schema, a null/absent schema,
or an object with no fields all yield `{}`.
-}
generate : Encode.Value -> String
generate value =
    case decodeSchema value of
        SObject fields ->
            renderObject 0 False fields

        _ ->
            "{}"



-- DECODE  (recursion runs through the `decodeSchema` FUNCTION, never the decoder value,
--          so there is no illegal self-referential value definition)


decodeSchema : Encode.Value -> Schema
decodeSchema value =
    Decode.decodeValue schemaDecoder value
        |> Result.withDefault SUnknown


schemaDecoder : Decoder Schema
schemaDecoder =
    Decode.oneOf
        [ anyOfDecoder
        , typedDecoder
        , Decode.succeed SUnknown
        ]


anyOfDecoder : Decoder Schema
anyOfDecoder =
    Decode.field "anyOf" (Decode.list Decode.value)
        |> Decode.map fromAnyOf


{-| `anyOf` with exactly one non-null branch is a nullable — unwrap to that branch's example.
Zero or several non-null branches is a union we don't render → `Unknown`.
-}
fromAnyOf : List Encode.Value -> Schema
fromAnyOf branches =
    case List.filter (not << isNullBranch) branches of
        [ only ] ->
            decodeSchema only

        _ ->
            SUnknown


isNullBranch : Encode.Value -> Bool
isNullBranch value =
    Decode.decodeValue (Decode.field "type" Decode.string) value == Ok "null"


typedDecoder : Decoder Schema
typedDecoder =
    typeNames
        |> Decode.andThen
            (\names ->
                case List.filter ((/=) "null") names of
                    first :: _ ->
                        byType first

                    [] ->
                        Decode.succeed SUnknown
            )


typeNames : Decoder (List String)
typeNames =
    Decode.field "type"
        (Decode.oneOf
            [ Decode.map List.singleton Decode.string
            , Decode.list Decode.string
            ]
        )


byType : String -> Decoder Schema
byType name =
    case name of
        "string" ->
            Decode.map SString (Decode.maybe (Decode.field "enum" (Decode.list Decode.string)))

        "number" ->
            Decode.succeed SNumber

        "integer" ->
            Decode.succeed SInteger

        "boolean" ->
            Decode.succeed SBoolean

        "array" ->
            Decode.map SArray itemsDecoder

        "object" ->
            objectDecoder

        _ ->
            Decode.succeed SUnknown


itemsDecoder : Decoder Schema
itemsDecoder =
    Decode.oneOf
        [ Decode.field "items" Decode.value |> Decode.map decodeSchema
        , Decode.succeed SUnknown
        ]


objectDecoder : Decoder Schema
objectDecoder =
    Decode.map2 buildObject
        (Decode.oneOf
            [ Decode.field "properties" (Decode.keyValuePairs Decode.value)
            , Decode.succeed []
            ]
        )
        (Decode.oneOf
            [ Decode.field "required" (Decode.list Decode.string)
            , Decode.succeed []
            ]
        )


{-| Order required fields first, by the `required` array's order (deterministic and
source-controlled — independent of `keyValuePairs` ordering); optional fields follow. Putting
the must-fill fields at the top is the friendly default for a fill-in template.
-}
buildObject : List ( String, Encode.Value ) -> List String -> Schema
buildObject props required =
    let
        fields =
            List.map (toField required) props

        requiredFields =
            List.filterMap (\name -> firstWhere (\f -> f.name == name) fields) required

        optionalFields =
            List.filter (not << .required) fields
    in
    SObject (requiredFields ++ optionalFields)


toField : List String -> ( String, Encode.Value ) -> Field
toField required ( name, value ) =
    { name = name
    , required = List.member name required
    , schema = decodeSchema value
    , description = maybeStringField "description" value
    , default = maybeField "default" value
    }


maybeStringField : String -> Encode.Value -> Maybe String
maybeStringField key value =
    Decode.decodeValue (Decode.field key Decode.string) value |> Result.toMaybe


maybeField : String -> Encode.Value -> Maybe Encode.Value
maybeField key value =
    Decode.decodeValue (Decode.field key Decode.value) value |> Result.toMaybe



-- RENDER


indent : Int -> String
indent level =
    String.repeat (level * 2) " "


renderObject : Int -> Bool -> List Field -> String
renderObject level inherit fields =
    if List.isEmpty fields then
        "{}"

    else
        "{\n"
            ++ (fields |> List.map (renderField (level + 1) inherit) |> String.join "\n")
            ++ "\n"
            ++ indent level
            ++ "}"


{-| One field's line(s). `inherit` means an optional ancestor is already commenting this
subtree, so we render plain and let that ancestor's single `//` cover us; only the *first*
optional in a chain applies `commentBlock`, so lines never get a double `//`.
-}
renderField : Int -> Bool -> Field -> String
renderField level inherit field =
    let
        commented =
            inherit || not field.required

        line =
            indent level
                ++ "\""
                ++ field.name
                ++ "\": "
                ++ fieldValue level commented field
                ++ ","
                ++ hintComment field
    in
    if commented && not inherit then
        commentBlock level line

    else
        line


fieldValue : Int -> Bool -> Field -> String
fieldValue level inherit field =
    case field.default of
        Just d ->
            Encode.encode 0 d

        Nothing ->
            schemaValue level inherit field.schema


schemaValue : Int -> Bool -> Schema -> String
schemaValue level inherit schema =
    case schema of
        SString (Just (first :: _)) ->
            "\"" ++ first ++ "\""

        SString _ ->
            "\"\""

        SNumber ->
            "0"

        SInteger ->
            "0"

        SBoolean ->
            "false"

        SArray inner ->
            renderArray level inherit inner

        SObject fields ->
            renderObject level inherit fields

        SUnknown ->
            "null"


renderArray : Int -> Bool -> Schema -> String
renderArray level inherit inner =
    case inner of
        SObject (first :: rest) ->
            "[\n"
                ++ indent (level + 1)
                ++ renderObject (level + 1) inherit (first :: rest)
                ++ ",\n"
                ++ indent level
                ++ "]"

        _ ->
            "[" ++ schemaValue level inherit inner ++ "]"


{-| Prefix every line of an already-rendered field block with `// ` at this field's indent,
preserving deeper indentation after the marker. Works for one-liners and multi-line blocks
(commented optional objects/arrays) alike.
-}
commentBlock : Int -> String -> String
commentBlock level block =
    let
        pad =
            indent level
    in
    block
        |> String.split "\n"
        |> List.map (\ln -> pad ++ "// " ++ String.dropLeft (String.length pad) ln)
        |> String.join "\n"


hintComment : Field -> String
hintComment field =
    case enumOptions field.schema of
        Just options ->
            "  // " ++ String.join " | " options

        Nothing ->
            if isUnknown field.schema then
                "  // (unsupported schema)"

            else
                case field.description of
                    Just description ->
                        "  // " ++ description

                    Nothing ->
                        ""


enumOptions : Schema -> Maybe (List String)
enumOptions schema =
    case schema of
        SString (Just options) ->
            Just options

        _ ->
            Nothing


isUnknown : Schema -> Bool
isUnknown schema =
    case schema of
        SUnknown ->
            True

        _ ->
            False


firstWhere : (a -> Bool) -> List a -> Maybe a
firstWhere pred list =
    List.head (List.filter pred list)
