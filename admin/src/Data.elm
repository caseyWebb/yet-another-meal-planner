module Data exposing (Model, Msg, init, goto, update, view)

{-| The Data area shell (operator-data-explorer): the fourth top-level admin area, a
read-only explorer over D1 and the R2 corpus. It owns a sticky sub-nav across five
entity views and delegates to each view's module. The live view AND its state are one
`Section` value (a page owns its model), so being "on Recipes holding Members' state" is
unrepresentable — mirroring the shell's own `Page` union.

The two 360 views (Recipes, Members) carry an optionally-selected entity in the route, so
navigating between the list and a detail (or between two entities) preserves the loaded
list via each module's `select`; switching to a different view builds it fresh.

-}

import Data.Corpus as Corpus
import Data.Member as Member
import Data.Recipe as Recipe
import Data.Table as Table
import Html exposing (Html, a, div, text)
import Html.Attributes exposing (class, classList)
import Route exposing (DataRoute(..))



-- MODEL


{-| The live Data view and its state, as one value. -}
type Section
    = RecipesS Recipe.Model
    | MemberS Member.Model
    | CorpusS Corpus.Model
    | DiscoveryS Table.Model
    | SystemS Table.Model


type alias Model =
    { route : DataRoute, section : Section }


discoveryTables : List String
discoveryTables =
    [ "discovery_candidates", "discovery_senders", "discovery_members", "discovery_rejections" ]


systemTables : List String
systemTables =
    [ "reconcile_errors", "bug_reports", "schema_meta" ]


{-| Build the Data area for a sub-route from scratch. -}
init : DataRoute -> ( Model, Cmd Msg )
init dataRoute =
    case dataRoute of
        DataRecipes slug ->
            wrap RecipesS RecipeMsg dataRoute (Recipe.init slug)

        DataMembers id ->
            wrap MemberS MemberMsg dataRoute (Member.init id)

        DataCorpus ->
            wrap CorpusS CorpusMsg dataRoute Corpus.init

        DataDiscovery ->
            wrap DiscoveryS DiscoveryMsg dataRoute (Table.init "discovery" discoveryTables)

        DataSystem ->
            wrap SystemS SystemMsg dataRoute (Table.init "system" systemTables)


wrap : (sub -> Section) -> (subMsg -> Msg) -> DataRoute -> ( sub, Cmd subMsg ) -> ( Model, Cmd Msg )
wrap toSection toMsg dataRoute ( sub, cmd ) =
    ( { route = dataRoute, section = toSection sub }, Cmd.map toMsg cmd )


{-| Navigate to a sub-route, preserving the live view's state when it is the SAME view
(so a recipe/member detail reuses the loaded list); otherwise build the target fresh. -}
goto : DataRoute -> Model -> ( Model, Cmd Msg )
goto dataRoute model =
    case ( dataRoute, model.section ) of
        ( DataRecipes slug, RecipesS sub ) ->
            wrap RecipesS RecipeMsg dataRoute (Recipe.select slug sub)

        ( DataMembers id, MemberS sub ) ->
            wrap MemberS MemberMsg dataRoute (Member.select id sub)

        ( DataCorpus, CorpusS _ ) ->
            ( { model | route = dataRoute }, Cmd.none )

        ( DataDiscovery, DiscoveryS _ ) ->
            ( { model | route = dataRoute }, Cmd.none )

        ( DataSystem, SystemS _ ) ->
            ( { model | route = dataRoute }, Cmd.none )

        _ ->
            init dataRoute



-- UPDATE


type Msg
    = RecipeMsg Recipe.Msg
    | MemberMsg Member.Msg
    | CorpusMsg Corpus.Msg
    | DiscoveryMsg Table.Msg
    | SystemMsg Table.Msg


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case ( msg, model.section ) of
        ( RecipeMsg sub, RecipesS m ) ->
            wrap RecipesS RecipeMsg model.route (Recipe.update sub m)

        ( MemberMsg sub, MemberS m ) ->
            wrap MemberS MemberMsg model.route (Member.update sub m)

        ( CorpusMsg sub, CorpusS m ) ->
            wrap CorpusS CorpusMsg model.route (Corpus.update sub m)

        ( DiscoveryMsg sub, DiscoveryS m ) ->
            wrap DiscoveryS DiscoveryMsg model.route (Table.update sub m)

        ( SystemMsg sub, SystemS m ) ->
            wrap SystemS SystemMsg model.route (Table.update sub m)

        -- A sub-message for a view we are no longer on (a late response): drop it.
        _ ->
            ( model, Cmd.none )



-- VIEW


view : Model -> Html Msg
view model =
    div []
        [ viewSubnav model.route
        , viewSection model.section
        ]


viewSubnav : DataRoute -> Html Msg
viewSubnav active =
    div [ class "data-nav" ] (List.map (viewTab active) tabs)


tabs : List ( String, DataRoute )
tabs =
    [ ( "Recipes", DataRecipes Nothing )
    , ( "Members", DataMembers Nothing )
    , ( "Corpus", DataCorpus )
    , ( "Discovery", DataDiscovery )
    , ( "System", DataSystem )
    ]


viewTab : DataRoute -> ( String, DataRoute ) -> Html Msg
viewTab active ( label, dataRoute ) =
    a
        [ classList [ ( "pill", True ), ( "active", sameTab active dataRoute ) ]
        , Route.href (Route.Data dataRoute)
        ]
        [ text label ]


{-| Whether two sub-routes are the same VIEW (ignoring any selected entity), for the
active-tab highlight. -}
sameTab : DataRoute -> DataRoute -> Bool
sameTab a b =
    case ( a, b ) of
        ( DataRecipes _, DataRecipes _ ) ->
            True

        ( DataMembers _, DataMembers _ ) ->
            True

        ( DataCorpus, DataCorpus ) ->
            True

        ( DataDiscovery, DataDiscovery ) ->
            True

        ( DataSystem, DataSystem ) ->
            True

        _ ->
            False


viewSection : Section -> Html Msg
viewSection section =
    case section of
        RecipesS m ->
            Html.map RecipeMsg (Recipe.view m)

        MemberS m ->
            Html.map MemberMsg (Member.view m)

        CorpusS m ->
            Html.map CorpusMsg (Corpus.view m)

        DiscoveryS m ->
            Html.map DiscoveryMsg (Table.view m)

        SystemS m ->
            Html.map SystemMsg (Table.view m)
