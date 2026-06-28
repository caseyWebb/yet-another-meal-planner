module StatusTest exposing (suite)

{-| The compiler-opaque logic in `Status`: mapping the `/health` JSON onto the model, and
the body-preserving decode that keeps a degraded `503` (the body is the payload) distinct
from a genuine load error (a non-health body). The types can't prove these — the shapes can.
-}

import Dict
import Expect
import Http
import Json.Decode as Decode
import Status exposing (GateState(..), JobState(..))
import Test exposing (Test, describe, test)
import Time


healthyBody : String
healthyBody =
    """{"ok":true,"generated_at":1000000,"jobs":[{"name":"flyer-warm","ok":true,"last_run_at":999000,"summary":{"errors":0}}],"d1":{"ok":true},"admin":{"access_configured":true,"email_allowlist":true,"dev_bypass_set":false,"exposed":false}}"""


degradedBody : String
degradedBody =
    """{"ok":false,"generated_at":1000000,"jobs":[{"name":"flyer-warm","ok":false,"last_run_at":999000,"summary":{"errors":3}},{"name":"email","ok":null,"last_run_at":null,"never_run":true}],"d1":{"ok":true},"admin":{"access_configured":true,"email_allowlist":false,"dev_bypass_set":false,"exposed":false}}"""


exposedBody : String
exposedBody =
    """{"ok":false,"generated_at":1000000,"jobs":[{"name":"flyer-warm","ok":true,"last_run_at":999000,"summary":{}}],"d1":{"ok":true},"admin":{"access_configured":false,"email_allowlist":false,"dev_bypass_set":true,"exposed":true}}"""


quotaBody : String
quotaBody =
    """{"ok":false,"generated_at":1000000,"jobs":[{"name":"recipe-classify","ok":false,"last_run_at":999000,"summary":{"quota_exhausted":true}}],"d1":{"ok":true},"admin":{"access_configured":true,"email_allowlist":false,"dev_bypass_set":false,"exposed":false},"ai_quota_exhausted":true}"""


meta : Int -> Http.Metadata
meta status =
    { url = "https://host/health", statusCode = status, statusText = "", headers = Dict.empty }


suite : Test
suite =
    describe "Status /health"
        [ describe "healthDecoder"
            [ test "healthy body → ok, all jobs Healthy, gate Gated" <|
                \_ ->
                    case Decode.decodeString Status.healthDecoder healthyBody of
                        Ok payload ->
                            Expect.equal ( payload.ok, List.map .state payload.jobs, Status.gateState payload.admin )
                                ( True, [ Healthy ], Gated )

                        Err _ ->
                            Expect.fail "healthy body should decode"
            , test "degraded body → ok False, Failing + NeverRun preserved" <|
                \_ ->
                    case Decode.decodeString Status.healthDecoder degradedBody of
                        Ok payload ->
                            Expect.equal ( payload.ok, List.map .state payload.jobs )
                                ( False, [ Failing, NeverRun ] )

                        Err _ ->
                            Expect.fail "degraded body should decode"
            , test "exposed gate → ok False, gateState Exposed" <|
                \_ ->
                    case Decode.decodeString Status.healthDecoder exposedBody of
                        Ok payload ->
                            Expect.equal ( payload.ok, Status.gateState payload.admin ) ( False, Exposed )

                        Err _ ->
                            Expect.fail "exposed body should decode"
            , test "ai_quota_exhausted:true → aiQuotaExhausted True" <|
                \_ ->
                    case Decode.decodeString Status.healthDecoder quotaBody of
                        Ok payload ->
                            Expect.equal payload.aiQuotaExhausted True

                        Err _ ->
                            Expect.fail "quota body should decode"
            , test "a body without ai_quota_exhausted defaults to False (back-compat)" <|
                \_ ->
                    case Decode.decodeString Status.healthDecoder healthyBody of
                        Ok payload ->
                            Expect.equal payload.aiQuotaExhausted False

                        Err _ ->
                            Expect.fail "healthy body should decode"
            ]
        , describe "decodeBody (body-preserving: keyed on the body, not the status)"
            [ test "503 + valid health body → Ok degraded payload (not dropped)" <|
                \_ ->
                    case Status.decodeBody (meta 503) degradedBody of
                        Ok payload ->
                            Expect.equal payload.ok False

                        Err _ ->
                            Expect.fail "a 503 carrying a valid health body should decode to a Success"
            , test "non-health body → BadStatus load error (e.g. a 403 page)" <|
                \_ ->
                    Status.decodeBody (meta 403) "<html>Forbidden</html>"
                        |> Expect.equal (Err (Http.BadStatus 403))
            ]
        , describe "formatLocal (epoch ms → local time)"
            [ test "midnight → 12:00 AM" <|
                \_ -> Status.formatLocal Time.utc 0 |> Expect.equal "Jan 1, 12:00 AM"
            , test "noon → 12:00 PM" <|
                \_ -> Status.formatLocal Time.utc 43200000 |> Expect.equal "Jan 1, 12:00 PM"
            , test "13:05 → 1:05 PM with zero-padded minute" <|
                \_ -> Status.formatLocal Time.utc 47100000 |> Expect.equal "Jan 1, 1:05 PM"
            ]
        ]
