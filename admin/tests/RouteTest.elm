module RouteTest exposing (suite)

{-| The one piece of compiler-opaque logic in the shell: URL parsing. Round-trips and the
fiddly cases (trailing slash, deep paths, the `?as=` query) are where a silent bug hides —
the type system can't catch a wrong parse, only a wrong type.
-}

import Expect
import Route exposing (ConfigRoute(..), LogSource(..), Route(..))
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
            , test "/admin/logs → Logs Nothing (the area)" <|
                \_ -> parse "/admin/logs" |> Expect.equal (Logs Nothing)
            , test "/admin/logs/ (trailing slash) → Logs Nothing" <|
                \_ -> parse "/admin/logs/" |> Expect.equal (Logs Nothing)
            , test "/admin/logs/discovery → Logs (Just Discovery)" <|
                \_ -> parse "/admin/logs/discovery" |> Expect.equal (Logs (Just Discovery))
            , test "/admin/logs/<unknown> → NotFound (no bogus source)" <|
                \_ -> parse "/admin/logs/nope" |> Expect.equal NotFound
            , test "/admin/config → Config Calibration (default sub-view)" <|
                \_ -> parse "/admin/config" |> Expect.equal (Config ConfigCalibration)
            , test "/admin/config/ (trailing slash) → Config Calibration" <|
                \_ -> parse "/admin/config/" |> Expect.equal (Config ConfigCalibration)
            , test "/admin/config/aliases → Config Aliases" <|
                \_ -> parse "/admin/config/aliases" |> Expect.equal (Config ConfigAliases)
            , test "/admin/config/flyer-terms → Config FlyerTerms" <|
                \_ -> parse "/admin/config/flyer-terms" |> Expect.equal (Config ConfigFlyerTerms)
            , test "/admin/config/feeds → Config Feeds" <|
                \_ -> parse "/admin/config/feeds" |> Expect.equal (Config ConfigFeeds)
            , test "/admin/config/senders → Config Senders" <|
                \_ -> parse "/admin/config/senders" |> Expect.equal (Config ConfigSenders)
            , test "/admin/config/members → Config Members" <|
                \_ -> parse "/admin/config/members" |> Expect.equal (Config ConfigMembers)
            , test "/admin/config/<unknown> → NotFound (no bogus sub-view)" <|
                \_ -> parse "/admin/config/bogus" |> Expect.equal NotFound
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
            , test "Logs Nothing" <|
                \_ -> roundTrip (Logs Nothing) |> Expect.equal (Logs Nothing)
            , test "Logs (Just Discovery)" <|
                \_ -> roundTrip (Logs (Just Discovery)) |> Expect.equal (Logs (Just Discovery))
            , test "Config Calibration" <|
                \_ -> roundTrip (Config ConfigCalibration) |> Expect.equal (Config ConfigCalibration)
            , test "Config Aliases" <|
                \_ -> roundTrip (Config ConfigAliases) |> Expect.equal (Config ConfigAliases)
            , test "Config FlyerTerms" <|
                \_ -> roundTrip (Config ConfigFlyerTerms) |> Expect.equal (Config ConfigFlyerTerms)
            , test "Config Feeds" <|
                \_ -> roundTrip (Config ConfigFeeds) |> Expect.equal (Config ConfigFeeds)
            , test "Config Senders" <|
                \_ -> roundTrip (Config ConfigSenders) |> Expect.equal (Config ConfigSenders)
            , test "Config Members" <|
                \_ -> roundTrip (Config ConfigMembers) |> Expect.equal (Config ConfigMembers)
            , test "Usage" <|
                \_ -> roundTrip Usage |> Expect.equal Usage
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
