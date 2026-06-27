module Admin.Members exposing (Model, Msg, init, update, view)

{-| The Admin area's member management (operator-admin): onboard / list / rotate / revoke.
Lifted out of the old single-page `Main` essentially unchanged — the shell now owns the
page chrome (title + nav), so `view` returns just this surface's content.

Modeling discipline (see ../CLAUDE.md — "make impossible states impossible"):

  - the member list is `WebData`, never a `loading`/`error`/`data` triple;
  - the in-flight mutation is one `ActionState` tying any error to the operation that
    produced it, so "busy", "which operation", and "what failed" can never disagree.

-}

import Html exposing (Html, button, code, div, form, h2, input, label, p, span, strong, table, tbody, td, text, th, thead, tr)
import Html.Attributes exposing (attribute, class, disabled, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import Http
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode
import RemoteData exposing (RemoteData(..), WebData)
import Url



-- MODEL


{-| Credentials the server mints on onboard/rotate — handed to a member, shown once. -}
type alias Credentials =
    { username : String
    , inviteCode : String
    , connectorUrl : String
    }


{-| The single mutation that can be in flight. Onboard/rotate/revoke are mutually
exclusive (one operator, one click), so this is one value — not three Bools — and the
operation's identity (incl. the target username) travels with it.
-}
type Operation
    = Onboard
    | RotateInvite String
    | RevokeMember String


{-| Idle, working on an operation, or showing a failed one + its error. A failure is
inseparable from the operation that caused it; there is no free-floating `Maybe String`.
-}
type ActionState
    = Idle
    | Busy Operation
    | Failed Operation Http.Error


type alias Model =
    { members : WebData (List String)
    , usernameInput : String
    , inviteInput : String
    , action : ActionState
    , banner : Maybe Credentials
    }


init : ( Model, Cmd Msg )
init =
    ( { members = Loading
      , usernameInput = ""
      , inviteInput = ""
      , action = Idle
      , banner = Nothing
      }
    , fetchMembers
    )



-- UPDATE


type Msg
    = GotMembers (WebData (List String))
    | UsernameChanged String
    | InviteChanged String
    | SubmitOnboard
    | OnboardResult (Result Http.Error Credentials)
    | ClickRotate String
    | RotateResult String (Result Http.Error Credentials)
    | ClickRevoke String
    | RevokeResult String (Result Http.Error ())
    | DismissBanner


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        GotMembers members ->
            ( { model | members = members }, Cmd.none )

        UsernameChanged value ->
            ( { model | usernameInput = value }, Cmd.none )

        InviteChanged value ->
            ( { model | inviteInput = value }, Cmd.none )

        SubmitOnboard ->
            case ( isBusy model.action, String.trim model.usernameInput ) of
                ( True, _ ) ->
                    ( model, Cmd.none )

                ( False, "" ) ->
                    ( model, Cmd.none )

                ( False, username ) ->
                    ( { model | action = Busy Onboard }
                    , onboard username (String.trim model.inviteInput)
                    )

        OnboardResult (Ok credentials) ->
            ( { model
                | action = Idle
                , usernameInput = ""
                , inviteInput = ""
                , banner = Just credentials
              }
            , fetchMembers
            )

        OnboardResult (Err error) ->
            ( { model | action = Failed Onboard error }, Cmd.none )

        ClickRotate username ->
            start model (RotateInvite username) (rotate username)

        RotateResult _ (Ok credentials) ->
            ( { model | action = Idle, banner = Just credentials }, Cmd.none )

        RotateResult username (Err error) ->
            ( { model | action = Failed (RotateInvite username) error }, Cmd.none )

        ClickRevoke username ->
            start model (RevokeMember username) (revoke username)

        RevokeResult username (Ok ()) ->
            ( { model
                | action = Idle
                , members = RemoteData.map (List.filter ((/=) username)) model.members
                , banner = clearBannerFor username model.banner
              }
            , Cmd.none
            )

        RevokeResult username (Err error) ->
            ( { model | action = Failed (RevokeMember username) error }, Cmd.none )

        DismissBanner ->
            ( { model | banner = Nothing }, Cmd.none )


{-| Begin an operation only when nothing else is in flight (no concurrent mutations). -}
start : Model -> Operation -> Cmd Msg -> ( Model, Cmd Msg )
start model operation cmd =
    if isBusy model.action then
        ( model, Cmd.none )

    else
        ( { model | action = Busy operation }, cmd )


isBusy : ActionState -> Bool
isBusy action =
    case action of
        Busy _ ->
            True

        _ ->
            False


{-| Drop the "shown once" banner if it belongs to a member we just revoked. -}
clearBannerFor : String -> Maybe Credentials -> Maybe Credentials
clearBannerFor username banner =
    case banner of
        Just credentials ->
            if credentials.username == username then
                Nothing

            else
                banner

        Nothing ->
            Nothing



-- HTTP


fetchMembers : Cmd Msg
fetchMembers =
    Http.get
        { url = "/admin/api/tenants"
        , expect = Http.expectJson (RemoteData.fromResult >> GotMembers) membersDecoder
        }


onboard : String -> String -> Cmd Msg
onboard username inviteCode =
    Http.post
        { url = "/admin/api/tenants"
        , body = Http.jsonBody (onboardBody username inviteCode)
        , expect = Http.expectJson OnboardResult credentialsDecoder
        }


onboardBody : String -> String -> Encode.Value
onboardBody username inviteCode =
    Encode.object
        (( "username", Encode.string username )
            :: (if inviteCode == "" then
                    []

                else
                    [ ( "invite_code", Encode.string inviteCode ) ]
               )
        )


rotate : String -> Cmd Msg
rotate username =
    Http.post
        { url = "/admin/api/tenants/" ++ Url.percentEncode username ++ "/rotate"
        , body = Http.emptyBody
        , expect = Http.expectJson (RotateResult username) credentialsDecoder
        }


revoke : String -> Cmd Msg
revoke username =
    Http.request
        { method = "DELETE"
        , headers = []
        , url = "/admin/api/tenants/" ++ Url.percentEncode username
        , body = Http.emptyBody
        , expect = Http.expectWhatever (RevokeResult username)
        , timeout = Nothing
        , tracker = Nothing
        }


membersDecoder : Decoder (List String)
membersDecoder =
    Decode.field "tenants" (Decode.list Decode.string)


credentialsDecoder : Decoder Credentials
credentialsDecoder =
    Decode.map3 Credentials
        (Decode.field "username" Decode.string)
        (Decode.field "invite_code" Decode.string)
        (Decode.field "connector_url" Decode.string)


httpError : Http.Error -> String
httpError error =
    case error of
        Http.BadUrl url ->
            "bad URL " ++ url

        Http.Timeout ->
            "the request timed out"

        Http.NetworkError ->
            "network error — is the Worker reachable?"

        Http.BadStatus 403 ->
            "forbidden (403) — your Cloudflare Access session is missing or expired"

        Http.BadStatus 404 ->
            "not found (404) — the admin surface may be disabled (ACCESS_* unset)"

        Http.BadStatus status ->
            "HTTP " ++ String.fromInt status

        Http.BadBody detail ->
            "unexpected response: " ++ detail



-- VIEW


view : Model -> Html Msg
view model =
    div []
        [ viewActionError model.action
        , viewBanner model.banner
        , viewOnboard model
        , viewMembers model
        ]


viewActionError : ActionState -> Html Msg
viewActionError action =
    case action of
        Failed operation error ->
            div [ class "error" ] [ text (operationLabel operation ++ " failed: " ++ httpError error) ]

        _ ->
            text ""


operationLabel : Operation -> String
operationLabel operation =
    case operation of
        Onboard ->
            "Onboard"

        RotateInvite username ->
            "Rotating " ++ username

        RevokeMember username ->
            "Revoking " ++ username


viewBanner : Maybe Credentials -> Html Msg
viewBanner banner =
    case banner of
        Just credentials ->
            div [ class "minted" ]
                [ div [ class "minted-head" ]
                    [ strong [] [ text ("Invite for " ++ credentials.username) ]
                    , button [ class "link", onClick DismissBanner ] [ text "Dismiss" ]
                    ]
                , p [ class "once" ] [ text "Shown once — copy it now. It is never logged." ]
                , credentialRow "Invite code" credentials.inviteCode
                , credentialRow "Connector URL" credentials.connectorUrl
                ]

        Nothing ->
            text ""


credentialRow : String -> String -> Html Msg
credentialRow key val =
    div [ class "row" ] [ span [ class "k" ] [ text key ], code [ class "v" ] [ text val ] ]


viewOnboard : Model -> Html Msg
viewOnboard model =
    let
        submitting =
            model.action == Busy Onboard
    in
    form [ class "card", onSubmit SubmitOnboard ]
        [ h2 [] [ text "Onboard a member" ]
        , label []
            [ text "Username"
            , input [ placeholder "e.g. casey", value model.usernameInput, onInput UsernameChanged, attribute "autocomplete" "off" ] []
            ]
        , label []
            [ text "Invite code (optional — blank generates one)"
            , input [ placeholder "leave blank to auto-generate", value model.inviteInput, onInput InviteChanged, attribute "autocomplete" "off" ] []
            ]
        , button
            [ type_ "submit", disabled (submitting || String.trim model.usernameInput == "") ]
            [ text
                (if submitting then
                    "Onboarding…"

                 else
                    "Onboard"
                )
            ]
        ]


viewMembers : Model -> Html Msg
viewMembers model =
    div [ class "card" ]
        [ h2 [] [ text "Members" ]
        , case model.members of
            NotAsked ->
                p [] [ text "…" ]

            Loading ->
                p [] [ text "Loading…" ]

            Failure error ->
                div [ class "error" ] [ text ("Could not load members: " ++ httpError error) ]

            Success [] ->
                p [] [ text "No members yet." ]

            Success members ->
                table []
                    [ thead [] [ tr [] [ th [] [ text "Username" ], th [] [ text "Actions" ] ] ]
                    , tbody [] (List.map (viewMember model.action) members)
                    ]
        ]


viewMember : ActionState -> String -> Html Msg
viewMember action username =
    let
        rotating =
            action == Busy (RotateInvite username)

        revoking =
            action == Busy (RevokeMember username)
    in
    tr []
        [ td [] [ text username ]
        , td []
            [ button [ class "link", disabled (isBusy action), onClick (ClickRotate username) ]
                [ text
                    (if rotating then
                        "Rotating…"

                     else
                        "Rotate invite"
                    )
                ]
            , button [ class "danger", disabled (isBusy action), onClick (ClickRevoke username) ]
                [ text
                    (if revoking then
                        "Revoking…"

                     else
                        "Revoke"
                    )
                ]
            ]
        ]
