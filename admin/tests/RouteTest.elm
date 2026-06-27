module RouteTest exposing (suite)

{-| The one piece of compiler-opaque logic in the shell: URL parsing. Round-trips and the
fiddly cases (trailing slash, deep paths, the `?as=` query) are where a silent bug hides —
the type system can't catch a wrong parse, only a wrong type.
-}

import Expect
import Route exposing (Route(..))
import Test exposing (Test, describe, test)
import Url


parse : String -> Route
parse pathAndQuery =
    case Url.fromString ("https://host" ++ pathAndQuery) of
        Just url ->
            Route.fromUrl url

        Nothing ->
            NotFound


actingAs : String -> Maybe String
actingAs pathAndQuery =
    Url.fromString ("https://host" ++ pathAndQuery)
        |> Maybe.andThen Route.actingAsParam


roundTrip : Route -> Route
roundTrip route =
    parse (Route.toString route)


suite : Test
suite =
    describe "Route"
        [ describe "fromUrl"
            [ test "/admin → Health (home)" <|
                \_ -> parse "/admin" |> Expect.equal Health
            , test "/admin/ (trailing slash) → Health" <|
                \_ -> parse "/admin/" |> Expect.equal Health
            , test "/ (root) → Health" <|
                \_ -> parse "/" |> Expect.equal Health
            , test "/admin/members → Members" <|
                \_ -> parse "/admin/members" |> Expect.equal Members
            , test "/admin/dev/tools → Tools Nothing" <|
                \_ -> parse "/admin/dev/tools" |> Expect.equal (Tools Nothing)
            , test "/admin/dev/tools/ (trailing slash) → Tools Nothing" <|
                \_ -> parse "/admin/dev/tools/" |> Expect.equal (Tools Nothing)
            , test "/admin/dev/tools/<name> → Tools (Just name)" <|
                \_ -> parse "/admin/dev/tools/place_order" |> Expect.equal (Tools (Just "place_order"))
            , test "unknown path → NotFound" <|
                \_ -> parse "/admin/nope" |> Expect.equal NotFound
            ]
        , describe "round-trip (toString >> fromUrl == identity)"
            [ test "Health" <|
                \_ -> roundTrip Health |> Expect.equal Health
            , test "Members" <|
                \_ -> roundTrip Members |> Expect.equal Members
            , test "Tools Nothing" <|
                \_ -> roundTrip (Tools Nothing) |> Expect.equal (Tools Nothing)
            , test "Tools (Just name)" <|
                \_ -> roundTrip (Tools (Just "read_recipe")) |> Expect.equal (Tools (Just "read_recipe"))
            ]
        , describe "actingAsParam"
            [ test "?as=casey → Just casey" <|
                \_ -> actingAs "/admin/dev/tools?as=casey" |> Expect.equal (Just "casey")
            , test "reads on a deep path too" <|
                \_ -> actingAs "/admin/dev/tools/place_order?as=test-vegan" |> Expect.equal (Just "test-vegan")
            , test "no query → Nothing" <|
                \_ -> actingAs "/admin/dev/tools" |> Expect.equal Nothing
            , test "empty ?as= → Nothing" <|
                \_ -> actingAs "/admin/dev/tools?as=" |> Expect.equal Nothing
            , test "ignores other params, no substring false-match" <|
                \_ -> actingAs "/admin/dev/tools?has=x&as=casey" |> Expect.equal (Just "casey")
            , test "percent-decoded" <|
                \_ -> actingAs "/admin/dev/tools?as=a%20b" |> Expect.equal (Just "a b")
            ]
        ]
