# CLAUDE.md — `admin/` (the Elm operator panel)

This is the operator admin SPA (`operator-admin`): a small Elm `Browser.element` app
served at `/admin`, talking to the same-origin `/admin/api/*` JSON surface. We chose
Elm **deliberately, for refactorability through the type system** — and that payoff is
only real if we model *with* the types, not around them. Lazy data modeling (`Bool`
flags, `Maybe String` errors) throws away the entire reason we're here.

## Prime directive: make impossible states impossible

The compiler can only protect you from the illegal states you *let it know are illegal*.
Model the data so a nonsensical combination **doesn't typecheck** — don't model it loosely
and then hope to guard it at runtime. This is the lesson of Richard Feldman's
[*Making Impossible States Impossible*](https://www.youtube.com/watch?v=IcgmSRJHu_8): a
single custom type enumerating exactly the legal states is one source of truth; parallel
fields that can disagree are a bug surface.

Before adding a field, ask: **does every combination of this field with the others make
sense?** If not, collapse them into one custom type whose variants *are* the legal states.

## Rules

1. **Remote requests are `RemoteData`, never a `Bool` + `Maybe` triple.**
   The antipattern ([Kris Jenkins, *How Elm Slays a UI Antipattern*](https://blog.jenkster.com/2016/06/how-elm-slays-a-ui-antipattern/)):
   ```elm
   -- ❌ 2³ = 8 representable combos, ~4 legal. `loading=True, error=Just _, data=Just _` is nonsense.
   { loading : Bool, error : Maybe String, data : Maybe a }
   ```
   Use the four-state type (`WebData a = RemoteData Http.Error a`) — the view case-matches
   all four and the bad combinations are *unrepresentable*:
   ```elm
   -- ✅ NotAsked | Loading | Failure Http.Error | Success a
   members : WebData (List Member)
   ```
   We depend on `krisajenkins/remotedata`. Wire it with
   `Http.expectJson (RemoteData.fromResult >> GotMembers) decoder`; transform the loaded
   value with `RemoteData.map`.

2. **Errors carry their type — never `Maybe String`.** A `Maybe String` error is
   stringly-typed (no structure, no exhaustiveness) *and* detached from what failed. Put
   the error **inside** the state variant that can fail (`Failure Http.Error`,
   `Failed Operation Http.Error`) or model a domain error type. The view then renders the
   real error with context, and the compiler forces every failure to be handled.

3. **Custom types for finite states, not `Bool`/`String`.** A field with a fixed set of
   meanings is a union type. `Bool` answers one yes/no question; several related `Bool`s
   almost always want to be one type. `String` is for free text the user types — not an
   enum. Example (the one in-flight mutation + its failure, as a single value instead of
   `busy : Bool` + `error : Maybe String` + `which : String`):
   ```elm
   type Operation   = Onboard | RotateInvite String | RevokeMember String
   type ActionState = Idle | Busy Operation | Failed Operation Http.Error
   ```
   Now "busy", "which operation", and "the error" cannot contradict, and one-mutation-at-
   a-time falls out for free.

4. **Derive, don't store.** If a value is computable from other state, compute it in a
   helper/the view — don't add a field that can drift out of sync. The model holds the
   *minimal* source of truth.

5. **`update`/`view` are exhaustive — no `_ -> …` that swallows a state.** A catch-all
   defeats the point: when you add a variant you *want* the compiler to flag every site
   that must handle it. Reserve `_` for genuinely-irrelevant variants, never for "states I
   didn't bother to model."

6. **`Maybe` is for genuine optional *presence*, not for "error or loading."**
   `banner : Maybe Credentials` (there is, or isn't, a freshly-minted credential to show)
   is legitimate. `error : Maybe String` is a *state* masquerading as optional data — model
   it as a state.

7. **Opaque types + smart constructors for real invariants.** When a value must satisfy a
   rule *everywhere* (e.g. a canonical-lowercase username), a module can expose the type
   but **not** its constructor, plus `fromString : String -> Maybe Username` that
   validates — so callers can't fabricate an invalid one (see
   [*Use opaque types in Elm*](https://dev.to/hecrj/use-opaque-types-in-elm-3oal),
   [Elm Radio: Intro to Opaque Types](https://elm-radio.com/episode/intro-to-opaque-types/)).
   Don't reach for it prematurely. Today the Worker canonicalizes usernames, so the panel
   passes strings through; add an opaque `Username` only if the panel grows its own
   validation.

8. **Style — the official [Design Guidelines](https://package.elm-lang.org/help/design-guidelines).**
   Name by *what*, not *how*. Order function arguments so the data "subject" is last, for
   `|>` pipelines. Avoid needless type variables. One module per concern, exposing the
   narrowest API. `elm-format`'s output is the canonical formatting — match it.

## Build & serve

- Source of truth: `admin/src/**`, `admin/elm.json`, `admin/index.html`. Built by
  `scripts/build-admin.mjs` (`aubr build:admin`) into the **committed**
  `admin/dist/admin/{elm.js,index.html}`, served by the Worker's `assets` binding.
- **`admin/dist/` is generated — never hand-edit it** (like `plugin/`). After *any* source
  change, rebuild and commit the bundle, or the deployed UI is stale. `aubr build:admin
  --check` recompiles and fails if the committed bundle drifted.
- The Elm compiler needs `package.elm-lang.org` reachable. A sandbox without it can edit
  source but **cannot build** — in that case, say so and leave the rebuild to CI / a
  connected box rather than committing a stale bundle silently.
- Auth lives in the **Worker** (Cloudflare Access on `/admin*`). The SPA just calls
  same-origin `/admin/api/*` and trusts the gate — keep auth logic out of Elm.

## Sources

- Richard Feldman — [*Making Impossible States Impossible*](https://www.youtube.com/watch?v=IcgmSRJHu_8)
- Kris Jenkins — [*How Elm Slays a UI Antipattern*](https://blog.jenkster.com/2016/06/how-elm-slays-a-ui-antipattern/) (RemoteData)
- Elm — [Design Guidelines](https://package.elm-lang.org/help/design-guidelines)
- [*Use opaque types in Elm*](https://dev.to/hecrj/use-opaque-types-in-elm-3oal) · [Elm Radio: Intro to Opaque Types](https://elm-radio.com/episode/intro-to-opaque-types/)
- thoughtbot — [Data Modeling Resources in Elm](https://thoughtbot.com/blog/data-modeling-resources-in-elm)
