module ToolConsoleTest exposing (suite)

{-| Pin the run-gate safety contract: which personas bypass the confirm-before-run. This
is a compiler-invisible convention (magic prefixes), and getting it wrong means firing a
real member's write tools without a confirm — so it's worth locking.
-}

import Dev.ToolConsole as ToolConsole
import Expect
import Test exposing (Test, describe, test)


suite : Test
suite =
    describe "ToolConsole.needsConfirm"
        [ test "a real member requires a confirm" <|
            \_ -> ToolConsole.needsConfirm "casey" |> Expect.equal True
        , test "a test- persona bypasses the confirm" <|
            \_ -> ToolConsole.needsConfirm "test-vegan" |> Expect.equal False
        , test "a sandbox- persona bypasses the confirm" <|
            \_ -> ToolConsole.needsConfirm "sandbox-1" |> Expect.equal False
        , test "a name merely containing 'test' is still a real member (prefix, not substring)" <|
            \_ -> ToolConsole.needsConfirm "greatest" |> Expect.equal True
        ]
