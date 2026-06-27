module Data.Member exposing
    ( Model, Msg, init, select, update, view
    , MemberDetail, memberDetailDecoder
    )

{-| The Member data view (operator-data-explorer) — the per-tenant 360. The picker
reuses the existing `/admin/api/tenants` listing; the detail
(`/admin/api/data/members/<id>`) returns one member's full per-tenant state (profile,
session state, overlay, cooking log, authored notes), with no redaction — `private`
notes are shown.

Modeling discipline (../CLAUDE.md): both fetches are `WebData`. Each section of the
bundle is heterogeneous, open-shaped per-tenant data (the profile alone carries an open
`custom` bag), so the sections are decoded as `Json.Decode.Value` and rendered as
labeled JSON blocks — an honest operator inspector over data whose shape is the Worker's
to define, not the panel's to re-model. The decoder + counts are pinned in `tests/`.

-}

import Html exposing (Html, a, div, em, h2, p, pre, span, text)
import Html.Attributes exposing (class, href)
import Http
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode
import RemoteData exposing (RemoteData(..), WebData)



-- MODEL


type alias Model =
    { members : WebData (List String)
    , selected : Maybe Selected
    }


type alias Selected =
    { id : String, detail : WebData MemberDetail }


{-| One member's complete per-tenant state. Sections are raw JSON (the data's shape is
the Worker's); the view renders each as a labeled block with a row count. -}
type alias MemberDetail =
    { id : String
    , profile : Decode.Value
    , pantry : List Decode.Value
    , mealPlan : List Decode.Value
    , groceryList : List Decode.Value
    , overlay : List Decode.Value
    , cookingLog : List Decode.Value
    , recipeNotes : List Decode.Value
    , storeNotes : List Decode.Value
    }


init : Maybe String -> ( Model, Cmd Msg )
init selectedId =
    ( { members = Loading, selected = selectionFor selectedId }
    , Cmd.batch (fetchMembers :: detailCmd selectedId)
    )


{-| Change the selected member WITHOUT refetching the member list. -}
select : Maybe String -> Model -> ( Model, Cmd Msg )
select selectedId model =
    ( { model | selected = selectionFor selectedId }, Cmd.batch (detailCmd selectedId) )


selectionFor : Maybe String -> Maybe Selected
selectionFor =
    Maybe.map (\id -> { id = id, detail = Loading })


detailCmd : Maybe String -> List (Cmd Msg)
detailCmd selectedId =
    case selectedId of
        Just id ->
            [ fetchDetail id ]

        Nothing ->
            []



-- UPDATE


type Msg
    = GotMembers (WebData (List String))
    | GotDetail String (WebData MemberDetail)


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        GotMembers members ->
            ( { model | members = members }, Cmd.none )

        GotDetail id detail ->
            case model.selected of
                Just selected ->
                    if selected.id == id then
                        ( { model | selected = Just { selected | detail = detail } }, Cmd.none )

                    else
                        ( model, Cmd.none )

                Nothing ->
                    ( model, Cmd.none )



-- HTTP


fetchMembers : Cmd Msg
fetchMembers =
    Http.get
        { url = "/admin/api/tenants"
        , expect = Http.expectJson (RemoteData.fromResult >> GotMembers) (Decode.field "tenants" (Decode.list Decode.string))
        }


fetchDetail : String -> Cmd Msg
fetchDetail id =
    Http.get
        { url = "/admin/api/data/members/" ++ id
        , expect = Http.expectJson (RemoteData.fromResult >> GotDetail id) memberDetailDecoder
        }


memberDetailDecoder : Decoder MemberDetail
memberDetailDecoder =
    Decode.map8
        (\id profile pantry mealPlan groceryList overlay cookingLog recipeNotes ->
            { id = id
            , profile = profile
            , pantry = pantry
            , mealPlan = mealPlan
            , groceryList = groceryList
            , overlay = overlay
            , cookingLog = cookingLog
            , recipeNotes = recipeNotes
            , storeNotes = []
            }
        )
        (Decode.field "id" Decode.string)
        (Decode.field "profile" Decode.value)
        (listField "pantry")
        (listField "meal_plan")
        (listField "grocery_list")
        (listField "overlay")
        (listField "cooking_log")
        (listField "recipe_notes")
        |> Decode.andThen
            (\partial -> Decode.map (\store -> { partial | storeNotes = store }) (listField "store_notes"))


listField : String -> Decoder (List Decode.Value)
listField name =
    Decode.oneOf [ Decode.field name (Decode.list Decode.value), Decode.succeed [] ]



-- VIEW


view : Model -> Html Msg
view model =
    case model.selected of
        Just selected ->
            viewDetail selected

        Nothing ->
            viewMembers model.members


viewMembers : WebData (List String) -> Html Msg
viewMembers members =
    div []
        [ h2 [] [ text "Members" ]
        , case members of
            NotAsked ->
                p [] [ text "…" ]

            Loading ->
                p [] [ text "Loading…" ]

            Failure error ->
                div [ class "error" ] [ text ("Could not load members: " ++ httpError error) ]

            Success [] ->
                p [ class "muted" ] [ text "No members yet." ]

            Success ids ->
                div [ class "card" ] [ div [ class "data-nav" ] (List.map viewMemberLink ids) ]
        ]


viewMemberLink : String -> Html Msg
viewMemberLink id =
    a [ class "pill", href ("/admin/data/members/" ++ id) ] [ text id ]


viewDetail : Selected -> Html Msg
viewDetail selected =
    div []
        [ p [] [ a [ href "/admin/data/members" ] [ text "← all members" ] ]
        , h2 [] [ text selected.id ]
        , case selected.detail of
            NotAsked ->
                p [] [ text "…" ]

            Loading ->
                p [] [ text "Loading…" ]

            Failure error ->
                div [ class "error" ] [ text ("Could not load member: " ++ httpError error) ]

            Success detail ->
                viewMember detail
        ]


viewMember : MemberDetail -> Html Msg
viewMember detail =
    div []
        [ valueSection "Profile" detail.profile
        , listSection "Pantry" detail.pantry
        , listSection "Meal plan" detail.mealPlan
        , listSection "Grocery list" detail.groceryList
        , listSection "Overlay (favorites / rejects)" detail.overlay
        , listSection "Cooking log" detail.cookingLog
        , listSection "Recipe notes (authored)" detail.recipeNotes
        , listSection "Store notes (authored)" detail.storeNotes
        ]


valueSection : String -> Decode.Value -> Html msg
valueSection title value =
    div []
        [ p [ class "schema-label" ] [ text title ]
        , pre [] [ text (Encode.encode 2 value) ]
        ]


listSection : String -> List Decode.Value -> Html msg
listSection title values =
    div []
        [ p [ class "schema-label" ]
            [ text title
            , span [ class "muted small" ] [ text (" (" ++ String.fromInt (List.length values) ++ ")") ]
            ]
        , if List.isEmpty values then
            p [ class "muted" ] [ em [] [ text "none" ] ]

          else
            pre [] [ text (Encode.encode 2 (Encode.list identity values)) ]
        ]


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
            "not found (404) — not a member, or the admin surface is disabled"

        Http.BadStatus status ->
            "HTTP " ++ String.fromInt status

        Http.BadBody detail ->
            "unexpected response: " ++ detail
