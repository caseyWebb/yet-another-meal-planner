module Data.Recipe exposing
    ( Model, Msg, init, select, update, view
    , RecipeTier(..), DerivedState(..), RecipeDetail, recipeDetailDecoder, tierLabel
    )

{-| The Recipe data view (operator-data-explorer) — the cross-tier showcase. The list
(`/admin/api/data/recipes`) shows every slug with its projection status; the detail
(`/admin/api/data/recipes/<slug>`) joins the R2 source, the `recipes` projection, the
`recipe_derived` description/embedding, the `reconcile_errors` reason, and the
cross-tenant dispositions/notes into one record.

Modeling discipline (../CLAUDE.md): both fetches are `WebData`. The cross-tier placement
is a single `RecipeTier` custom type computed server-side and decoded here, so "indexed
*and* has a reconcile reason" is unrepresentable — the status, its reason, and the
derived state cannot contradict. The second export group is exercised by `tests/`.

-}

import Html exposing (Html, a, div, em, h2, p, pre, span, table, tbody, td, text, th, thead, tr)
import Html.Attributes exposing (class, href)
import Http
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode
import RemoteData exposing (RemoteData(..), WebData)



-- MODEL


type alias Model =
    { list : WebData (List ListEntry)
    , selected : Maybe Selected
    }


type alias Selected =
    { slug : String, detail : WebData RecipeDetail }


type alias ListEntry =
    { slug : String, title : Maybe String, status : String }


{-| The reconcile-pipeline placement of one slug. `Indexed` carries whether the AI
description has been generated; `Skipped` carries the reconcile reason. -}
type RecipeTier
    = Indexed DerivedState
    | Skipped String
    | Pending
    | Orphaned


type DerivedState
    = Described
    | DescriptionPending


type alias Disposition =
    { tenant : String, favorite : Bool, reject : Bool }


{-| The cross-tier record for one slug. `projection`/`notes` are heterogeneous JSON
rendered as-is (an operator inspector), but the pipeline state is the typed `tier`. -}
type alias RecipeDetail =
    { slug : String
    , tier : RecipeTier
    , source : Maybe String
    , projection : Maybe Decode.Value
    , description : Maybe String
    , hasEmbedding : Bool
    , dispositions : List Disposition
    , notes : List Decode.Value
    }


init : Maybe String -> ( Model, Cmd Msg )
init selectedSlug =
    ( { list = Loading, selected = selectionFor selectedSlug }
    , Cmd.batch (fetchList :: detailCmd selectedSlug)
    )


{-| Change the selected slug WITHOUT refetching the list (it survives navigation between
the list and a detail, or between two recipes). -}
select : Maybe String -> Model -> ( Model, Cmd Msg )
select selectedSlug model =
    ( { model | selected = selectionFor selectedSlug }, Cmd.batch (detailCmd selectedSlug) )


selectionFor : Maybe String -> Maybe Selected
selectionFor selectedSlug =
    Maybe.map (\slug -> { slug = slug, detail = Loading }) selectedSlug


detailCmd : Maybe String -> List (Cmd Msg)
detailCmd selectedSlug =
    case selectedSlug of
        Just slug ->
            [ fetchDetail slug ]

        Nothing ->
            []



-- UPDATE


type Msg
    = GotList (WebData (List ListEntry))
    | GotDetail String (WebData RecipeDetail)


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        GotList list ->
            ( { model | list = list }, Cmd.none )

        GotDetail slug detail ->
            -- Ignore a late response for a slug we are no longer viewing.
            case model.selected of
                Just selected ->
                    if selected.slug == slug then
                        ( { model | selected = Just { selected | detail = detail } }, Cmd.none )

                    else
                        ( model, Cmd.none )

                Nothing ->
                    ( model, Cmd.none )



-- HTTP


fetchList : Cmd Msg
fetchList =
    Http.get
        { url = "/admin/api/data/recipes"
        , expect = Http.expectJson (RemoteData.fromResult >> GotList) (Decode.field "recipes" (Decode.list listEntryDecoder))
        }


fetchDetail : String -> Cmd Msg
fetchDetail slug =
    Http.get
        { url = "/admin/api/data/recipes/" ++ slug
        , expect = Http.expectJson (RemoteData.fromResult >> GotDetail slug) recipeDetailDecoder
        }


listEntryDecoder : Decoder ListEntry
listEntryDecoder =
    Decode.map3 ListEntry
        (Decode.field "slug" Decode.string)
        (Decode.field "title" (Decode.nullable Decode.string))
        (Decode.field "status" Decode.string)


recipeDetailDecoder : Decoder RecipeDetail
recipeDetailDecoder =
    Decode.map8 RecipeDetail
        (Decode.field "slug" Decode.string)
        tierDecoder
        (Decode.field "source" (Decode.nullable Decode.string))
        (Decode.field "projection" (Decode.nullable Decode.value))
        descriptionDecoder
        hasEmbeddingDecoder
        (Decode.field "dispositions" (Decode.list dispositionDecoder))
        (Decode.field "notes" (Decode.list Decode.value))


{-| Build the `RecipeTier` from the server's `status` discriminant plus the fields each
status needs (the reconcile reason for `skipped`, the derived state for `indexed`). -}
tierDecoder : Decoder RecipeTier
tierDecoder =
    Decode.field "status" Decode.string
        |> Decode.andThen
            (\status ->
                case status of
                    "indexed" ->
                        Decode.map Indexed derivedStateDecoder

                    "skipped" ->
                        Decode.map Skipped
                            (Decode.field "reconcile_message" (Decode.nullable Decode.string)
                                |> Decode.map (Maybe.withDefault "")
                            )

                    "pending" ->
                        Decode.succeed Pending

                    "orphaned" ->
                        Decode.succeed Orphaned

                    other ->
                        Decode.fail ("unknown projection status: " ++ other)
            )


derivedStateDecoder : Decoder DerivedState
derivedStateDecoder =
    -- A null `derived` (no row yet) reads as DescriptionPending; otherwise its `state`.
    Decode.field "derived" (Decode.nullable (Decode.field "state" Decode.string))
        |> Decode.map
            (\maybeState ->
                if maybeState == Just "described" then
                    Described

                else
                    DescriptionPending
            )


descriptionDecoder : Decoder (Maybe String)
descriptionDecoder =
    Decode.field "derived" (Decode.nullable (Decode.field "description" (Decode.nullable Decode.string)))
        |> Decode.map (Maybe.andThen identity)


hasEmbeddingDecoder : Decoder Bool
hasEmbeddingDecoder =
    Decode.field "derived" (Decode.nullable (Decode.field "has_embedding" Decode.bool))
        |> Decode.map (Maybe.withDefault False)


dispositionDecoder : Decoder Disposition
dispositionDecoder =
    Decode.map3 Disposition
        (Decode.field "tenant" Decode.string)
        (Decode.field "favorite" Decode.bool)
        (Decode.field "reject" Decode.bool)



-- VIEW


view : Model -> Html Msg
view model =
    case model.selected of
        Just selected ->
            viewDetail selected

        Nothing ->
            viewList model.list


viewList : WebData (List ListEntry) -> Html Msg
viewList list =
    div []
        [ h2 [] [ text "Recipes" ]
        , case list of
            NotAsked ->
                p [] [ text "…" ]

            Loading ->
                p [] [ text "Loading…" ]

            Failure error ->
                div [ class "error" ] [ text ("Could not load recipes: " ++ httpError error) ]

            Success [] ->
                p [ class "muted" ] [ text "No recipes in the corpus or the index." ]

            Success entries ->
                div [ class "card" ]
                    [ table []
                        [ thead [] [ tr [] [ th [] [ text "Slug" ], th [] [ text "Status" ], th [] [ text "Title" ] ] ]
                        , tbody [] (List.map viewListRow entries)
                        ]
                    ]
        ]


viewListRow : ListEntry -> Html Msg
viewListRow entry =
    tr []
        [ td [] [ a [ href ("/admin/data/recipes/" ++ entry.slug) ] [ text entry.slug ] ]
        , td [] [ statusBadge entry.status ]
        , td [] [ text (Maybe.withDefault "—" entry.title) ]
        ]


statusBadge : String -> Html msg
statusBadge status =
    span [ class ("tier " ++ status) ] [ text status ]


viewDetail : Selected -> Html Msg
viewDetail selected =
    div []
        [ p [] [ a [ href "/admin/data/recipes" ] [ text "← all recipes" ] ]
        , h2 [] [ text selected.slug ]
        , case selected.detail of
            NotAsked ->
                p [] [ text "…" ]

            Loading ->
                p [] [ text "Loading…" ]

            Failure error ->
                div [ class "error" ] [ text ("Could not load recipe: " ++ httpError error) ]

            Success detail ->
                viewRecipe detail
        ]


viewRecipe : RecipeDetail -> Html Msg
viewRecipe detail =
    div []
        [ div [ class "card" ] (viewTier detail.tier)
        , viewDescription detail
        , viewDispositions detail.dispositions
        , section "Cross-tenant notes" (viewJsonList detail.notes)
        , section "R2 source (recipes/<slug>.md)" [ viewSource detail.source ]
        , section "D1 projection (recipes row)" [ viewMaybeJson detail.projection ]
        ]


viewTier : RecipeTier -> List (Html msg)
viewTier tier =
    let
        ( status, detailText ) =
            case tier of
                Indexed Described ->
                    ( "indexed", "in R2 and the index; description generated" )

                Indexed DescriptionPending ->
                    ( "indexed", "in R2 and the index; description not yet generated" )

                Skipped reason ->
                    ( "skipped", "in R2 but NOT indexed — " ++ reason )

                Pending ->
                    ( "pending", "in R2, not yet indexed (reconcile hasn't run)" )

                Orphaned ->
                    ( "orphaned", "indexed but the R2 source is gone (stale projection)" )
    in
    [ span [ class ("tier " ++ status) ] [ text status ]
    , span [ class "muted small" ] [ text (" — " ++ detailText) ]
    ]


viewDescription : RecipeDetail -> Html msg
viewDescription detail =
    case detail.description of
        Just description ->
            section "Derived description"
                [ p [] [ text description ]
                , p [ class "muted small" ]
                    [ text
                        (if detail.hasEmbedding then
                            "embedding: present"

                         else
                            "embedding: not yet generated"
                        )
                    ]
                ]

        Nothing ->
            text ""


viewDispositions : List Disposition -> Html msg
viewDispositions dispositions =
    if List.isEmpty dispositions then
        text ""

    else
        section "Cross-tenant dispositions"
            [ div [ class "card" ]
                [ table []
                    [ thead [] [ tr [] [ th [] [ text "Tenant" ], th [] [ text "Disposition" ] ] ]
                    , tbody [] (List.map viewDisposition dispositions)
                    ]
                ]
            ]


viewDisposition : Disposition -> Html msg
viewDisposition d =
    tr []
        [ td [] [ text d.tenant ]
        , td []
            [ text
                (if d.favorite then
                    "favorite"

                 else if d.reject then
                    "reject"

                 else
                    "neutral"
                )
            ]
        ]


viewSource : Maybe String -> Html msg
viewSource source =
    case source of
        Just text_ ->
            pre [] [ text text_ ]

        Nothing ->
            p [ class "muted" ] [ em [] [ text "no R2 source object" ] ]


viewMaybeJson : Maybe Decode.Value -> Html msg
viewMaybeJson maybeValue =
    case maybeValue of
        Just value ->
            pre [] [ text (Encode.encode 2 value) ]

        Nothing ->
            p [ class "muted" ] [ em [] [ text "not in the index" ] ]


viewJsonList : List Decode.Value -> List (Html msg)
viewJsonList values =
    if List.isEmpty values then
        [ p [ class "muted" ] [ em [] [ text "none" ] ] ]

    else
        [ pre [] [ text (Encode.encode 2 (Encode.list identity values)) ] ]


section : String -> List (Html msg) -> Html msg
section title body =
    div [] (p [ class "schema-label" ] [ text title ] :: body)


tierLabel : RecipeTier -> String
tierLabel tier =
    case tier of
        Indexed Described ->
            "indexed/described"

        Indexed DescriptionPending ->
            "indexed/pending"

        Skipped _ ->
            "skipped"

        Pending ->
            "pending"

        Orphaned ->
            "orphaned"


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
            "not found (404)"

        Http.BadStatus status ->
            "HTTP " ++ String.fromInt status

        Http.BadBody detail ->
            "unexpected response: " ++ detail
