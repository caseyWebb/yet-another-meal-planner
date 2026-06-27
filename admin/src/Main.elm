module Main exposing (main)

{-| The grocery-agent operator admin panel (operator-admin capability).

A small Browser.element SPA served at `/admin` behind Cloudflare Access. It talks
to the same-origin `/admin/api/*` JSON surface to onboard / list / rotate / revoke
members. A minted invite code is shown ONCE in the banner here — it is never logged
server-side, so this view is the only place it appears.

Refactor-friendly by construction: the whole app is `Model` + `Msg` + pure `update`
+ `view`, with every server effect a typed `Cmd Msg`. Adding a field to a member or
a new operation is a compiler-guided change, which is the point of using Elm here.

-}

import Browser
import Html exposing (Html, button, div, form, h1, h2, input, label, p, span, strong, table, tbody, td, text, th, thead, tr)
import Html.Attributes exposing (attribute, class, disabled, placeholder, type_, value)
import Html.Events exposing (onClick, onInput, onSubmit)
import Http
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode
import Url



-- MODEL


{-| What the server returns from onboard / rotate: the credentials to hand a member. -}
type alias Minted =
    { username : String
    , inviteCode : String
    , connectorUrl : String
    }


type alias Model =
    { tenants : List String
    , loading : Bool
    , error : Maybe String
    , newUsername : String
    , newCode : String
    , busy : Bool

    -- The just-minted credentials, shown once until dismissed.
    , minted : Maybe Minted
    }


init : () -> ( Model, Cmd Msg )
init _ =
    ( { tenants = []
      , loading = True
      , error = Nothing
      , newUsername = ""
      , newCode = ""
      , busy = False
      , minted = Nothing
      }
    , getTenants
    )



-- UPDATE


type Msg
    = GotTenants (Result Http.Error (List String))
    | SetUsername String
    | SetCode String
    | SubmitOnboard
    | Onboarded (Result Http.Error Minted)
    | ClickRotate String
    | Rotated (Result Http.Error Minted)
    | ClickRevoke String
    | Revoked String (Result Http.Error ())
    | Dismiss


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        GotTenants (Ok tenants) ->
            ( { model | tenants = tenants, loading = False, error = Nothing }, Cmd.none )

        GotTenants (Err err) ->
            ( { model | loading = False, error = Just (httpError err) }, Cmd.none )

        SetUsername u ->
            ( { model | newUsername = u }, Cmd.none )

        SetCode c ->
            ( { model | newCode = c }, Cmd.none )

        SubmitOnboard ->
            if String.trim model.newUsername == "" || model.busy then
                ( model, Cmd.none )

            else
                ( { model | busy = True, error = Nothing }
                , onboard (String.trim model.newUsername) (String.trim model.newCode)
                )

        Onboarded (Ok minted) ->
            ( { model
                | busy = False
                , newUsername = ""
                , newCode = ""
                , minted = Just minted
              }
            , getTenants
            )

        Onboarded (Err err) ->
            ( { model | busy = False, error = Just (httpError err) }, Cmd.none )

        ClickRotate username ->
            if model.busy then
                ( model, Cmd.none )

            else
                ( { model | busy = True, error = Nothing }, rotate username )

        Rotated (Ok minted) ->
            ( { model | busy = False, minted = Just minted }, Cmd.none )

        Rotated (Err err) ->
            ( { model | busy = False, error = Just (httpError err) }, Cmd.none )

        ClickRevoke username ->
            if model.busy then
                ( model, Cmd.none )

            else
                ( { model | busy = True, error = Nothing }, revoke username )

        Revoked username (Ok ()) ->
            ( { model
                | busy = False
                , tenants = List.filter (\t -> t /= username) model.tenants
                , minted =
                    case model.minted of
                        Just m ->
                            if m.username == username then
                                Nothing

                            else
                                model.minted

                        Nothing ->
                            Nothing
              }
            , Cmd.none
            )

        Revoked _ (Err err) ->
            ( { model | busy = False, error = Just (httpError err) }, Cmd.none )

        Dismiss ->
            ( { model | minted = Nothing }, Cmd.none )



-- HTTP


getTenants : Cmd Msg
getTenants =
    Http.get
        { url = "/admin/api/tenants"
        , expect = Http.expectJson GotTenants (Decode.field "tenants" (Decode.list Decode.string))
        }


onboard : String -> String -> Cmd Msg
onboard username code =
    let
        fields =
            ( "username", Encode.string username )
                :: (if code == "" then
                        []

                    else
                        [ ( "invite_code", Encode.string code ) ]
                   )
    in
    Http.post
        { url = "/admin/api/tenants"
        , body = Http.jsonBody (Encode.object fields)
        , expect = Http.expectJson Onboarded mintedDecoder
        }


rotate : String -> Cmd Msg
rotate username =
    Http.post
        { url = "/admin/api/tenants/" ++ Url.percentEncode username ++ "/rotate"
        , body = Http.emptyBody
        , expect = Http.expectJson Rotated mintedDecoder
        }


revoke : String -> Cmd Msg
revoke username =
    Http.request
        { method = "DELETE"
        , headers = []
        , url = "/admin/api/tenants/" ++ Url.percentEncode username
        , body = Http.emptyBody
        , expect = Http.expectWhatever (Revoked username)
        , timeout = Nothing
        , tracker = Nothing
        }


mintedDecoder : Decoder Minted
mintedDecoder =
    Decode.map3 Minted
        (Decode.field "username" Decode.string)
        (Decode.field "invite_code" Decode.string)
        (Decode.field "connector_url" Decode.string)


httpError : Http.Error -> String
httpError err =
    case err of
        Http.BadUrl u ->
            "Bad URL: " ++ u

        Http.Timeout ->
            "The request timed out."

        Http.NetworkError ->
            "Network error — is the Worker reachable?"

        Http.BadStatus code ->
            if code == 403 then
                "Forbidden (403) — your Cloudflare Access session is missing or expired."

            else if code == 404 then
                "Not found (404) — the admin surface may be disabled (ACCESS_* unset)."

            else
                "Request failed with HTTP " ++ String.fromInt code ++ "."

        Http.BadBody detail ->
            "Unexpected response: " ++ detail



-- VIEW


view : Model -> Html Msg
view model =
    div [ class "wrap" ]
        [ h1 [] [ text "grocery-agent admin" ]
        , viewError model.error
        , viewMinted model.minted
        , viewOnboard model
        , viewMembers model
        ]


viewError : Maybe String -> Html Msg
viewError error =
    case error of
        Just message ->
            div [ class "error" ] [ text message ]

        Nothing ->
            text ""


viewMinted : Maybe Minted -> Html Msg
viewMinted minted =
    case minted of
        Just m ->
            div [ class "minted" ]
                [ div [ class "minted-head" ]
                    [ strong [] [ text ("Invite for " ++ m.username) ]
                    , button [ class "link", onClick Dismiss ] [ text "Dismiss" ]
                    ]
                , p [ class "once" ] [ text "Shown once — copy it now. It is never logged." ]
                , dlRow "Invite code" m.inviteCode
                , dlRow "Connector URL" m.connectorUrl
                ]

        Nothing ->
            text ""


dlRow : String -> String -> Html Msg
dlRow k v =
    div [ class "row" ]
        [ span [ class "k" ] [ text k ]
        , Html.code [ class "v" ] [ text v ]
        ]


viewOnboard : Model -> Html Msg
viewOnboard model =
    form [ class "card", onSubmit SubmitOnboard ]
        [ h2 [] [ text "Onboard a member" ]
        , label []
            [ text "Username"
            , input
                [ placeholder "e.g. casey"
                , value model.newUsername
                , onInput SetUsername
                , attribute "autocomplete" "off"
                ]
                []
            ]
        , label []
            [ text "Invite code (optional — blank generates one)"
            , input
                [ placeholder "leave blank to auto-generate"
                , value model.newCode
                , onInput SetCode
                , attribute "autocomplete" "off"
                ]
                []
            ]
        , button [ type_ "submit", disabled (model.busy || String.trim model.newUsername == "") ]
            [ text "Onboard" ]
        ]


viewMembers : Model -> Html Msg
viewMembers model =
    div [ class "card" ]
        [ h2 [] [ text "Members" ]
        , if model.loading then
            p [] [ text "Loading…" ]

          else if List.isEmpty model.tenants then
            p [] [ text "No members yet." ]

          else
            table []
                [ thead [] [ tr [] [ th [] [ text "Username" ], th [] [ text "Actions" ] ] ]
                , tbody [] (List.map (viewMember model.busy) model.tenants)
                ]
        ]


viewMember : Bool -> String -> Html Msg
viewMember busy username =
    tr []
        [ td [] [ text username ]
        , td []
            [ button [ class "link", disabled busy, onClick (ClickRotate username) ] [ text "Rotate invite" ]
            , button [ class "danger", disabled busy, onClick (ClickRevoke username) ] [ text "Revoke" ]
            ]
        ]


-- MAIN


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , view = view
        , subscriptions = \_ -> Sub.none
        }
