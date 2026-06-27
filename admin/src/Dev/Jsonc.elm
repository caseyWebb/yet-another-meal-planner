module Dev.Jsonc exposing (strip)

{-| Normalize "JSON with comments" into strict JSON the stock `Json.Decode` accepts.

The tool console seeds its argument box with a pretty example whose optional fields are
**commented out** (see `Dev.SchemaExample`); for that to be usable, the input the operator
submits must tolerate what the example contains — `//` line comments, `/* … */` block
comments, and trailing commas (so uncommenting any subset still parses). This module is the
single client-side normalizer: `Dev.ToolConsole` runs `strip` before `Json.Decode`. It is a
**convenience only** — the server's Zod schema remains the sole validator; stripping can add
nothing a strict parse would have rejected for a reason that matters.

Both passes are **string-aware**: a `//` or `/*` inside a string value (e.g. a URL) is data,
not a comment, and a `\"` does not end a string. Everything is a tail-recursive fold over
the characters, so it never throws and never overflows on realistic input.

-}


{-| Strip `//`…EOL and `/* … */` comments, then drop trailing commas before `}`/`]`.
Comments first, so a comment sitting between a comma and its closer can't hide the closer.
-}
strip : String -> String
strip input =
    input
        |> removeComments
        |> removeTrailingCommas



-- COMMENT REMOVAL


type CommentState
    = Code
    | InStr
    | InStrEsc
    | InLine
    | InBlock


removeComments : String -> String
removeComments input =
    stripComments Code (String.toList input) []
        |> List.reverse
        |> String.fromList


{-| Fold over the characters, copying code/string content into `acc` (reversed) and dropping
comment bytes. `//` and `/*` only open a comment in `Code` state, so they survive inside
strings; `\` in a string protects the next char (so `\"` doesn't close it).
-}
stripComments : CommentState -> List Char -> List Char -> List Char
stripComments state chars acc =
    case ( state, chars ) of
        ( _, [] ) ->
            acc

        ( Code, '"' :: rest ) ->
            stripComments InStr rest ('"' :: acc)

        ( Code, '/' :: '/' :: rest ) ->
            stripComments InLine rest acc

        ( Code, '/' :: '*' :: rest ) ->
            stripComments InBlock rest acc

        ( Code, c :: rest ) ->
            stripComments Code rest (c :: acc)

        ( InStr, '\\' :: rest ) ->
            stripComments InStrEsc rest ('\\' :: acc)

        ( InStr, '"' :: rest ) ->
            stripComments Code rest ('"' :: acc)

        ( InStr, c :: rest ) ->
            stripComments InStr rest (c :: acc)

        ( InStrEsc, c :: rest ) ->
            stripComments InStr rest (c :: acc)

        ( InLine, '\n' :: rest ) ->
            stripComments Code rest ('\n' :: acc)

        ( InLine, _ :: rest ) ->
            stripComments InLine rest acc

        ( InBlock, '*' :: '/' :: rest ) ->
            stripComments Code rest acc

        ( InBlock, _ :: rest ) ->
            stripComments InBlock rest acc



-- TRAILING COMMAS


removeTrailingCommas : String -> String
removeTrailingCommas input =
    stripCommas False (String.toList input) []
        |> List.reverse
        |> String.fromList


{-| Drop a comma whose next significant character (skipping whitespace) is `}` or `]`. The
`Bool` tracks "inside a string", so a comma inside a string value is never touched. A leading
`\` while in a string protects the following quote.
-}
stripCommas : Bool -> List Char -> List Char -> List Char
stripCommas inString chars acc =
    case chars of
        [] ->
            acc

        '\\' :: rest ->
            if inString then
                case rest of
                    next :: more ->
                        stripCommas True more (next :: '\\' :: acc)

                    [] ->
                        '\\' :: acc

            else
                stripCommas False rest ('\\' :: acc)

        '"' :: rest ->
            stripCommas (not inString) rest ('"' :: acc)

        ',' :: rest ->
            if inString then
                stripCommas True rest (',' :: acc)

            else
                case nextSignificant rest of
                    Just '}' ->
                        stripCommas False rest acc

                    Just ']' ->
                        stripCommas False rest acc

                    _ ->
                        stripCommas False rest (',' :: acc)

        c :: rest ->
            stripCommas inString rest (c :: acc)


nextSignificant : List Char -> Maybe Char
nextSignificant chars =
    case chars of
        [] ->
            Nothing

        c :: rest ->
            if c == ' ' || c == '\n' || c == '\t' || c == '\u{000D}' then
                nextSignificant rest

            else
                Just c
