## 1. Status page module (`admin/src/Status.elm`)

- [x] 1.1 Create `admin/src/Status.elm` exposing `Model`, `Msg`, `init`, `update`, `view`; model is `{ health : WebData HealthPayload }`.
- [x] 1.2 Define the payload types: `HealthPayload { ok, generatedAt, jobs : List Job, d1Ok : Bool, admin : AdminPosture }`, `Job { name, state : JobState, lastRunAt : Maybe Int, summary : Dict String Json.Decode.Value }`, `type JobState = Healthy | Failing | NeverRun`, and `AdminPosture { accessConfigured, emailAllowlist, devBypassSet, exposed : Bool }`.
- [x] 1.3 Write the decoders: `healthDecoder` (incl. the `admin` section); a job decoder that collapses `{ ok: bool|null, never_run?: true }` into `JobState` (`Just True→Healthy`, `Just False→Failing`, `Nothing→NeverRun`); decode `summary` as `Dict String Json.Decode.Value`.
- [x] 1.4 Add `type GateState = Exposed | Gated | DevBypass | Disabled` and a `gateState : AdminPosture -> GateState` helper deriving it by the badge's precedence (`exposed` > `accessConfigured` > `devBypassSet` > otherwise); `emailAllowlist` stays a sub-detail of `Gated`.
- [x] 1.5 Implement the body-preserving fetch `expectHealth` with `Http.expectStringResponse`: decode the body on `GoodStatus_` **and** `BadStatus_`, returning `Ok payload` when it decodes (degraded 503 included) and `Err (BadStatus statusCode)` when it does not; map `BadUrl_`/`Timeout_`/`NetworkError_` to the matching `Http.Error`; wire via `RemoteData.fromResult >> GotHealth`.
- [x] 1.6 Implement `init` (fire the fetch), `update` (`GotHealth`, `Refresh`), and a relative-age helper (`just now` / `Nm` / `Nh` / `Nd ago`).
- [x] 1.7 Implement `view`: exhaustive `WebData` cases; on `Success`, a healthy/degraded headline derived from `payload.ok`, one row per job (state color + relative age + generic `summary` key/values), the D1 row, and the admin gate posture row (rendering an **exposed** `GateState` as a prominent warning, `emailAllowlist` as a gated sub-detail), plus a Refresh button; on `Failure`, a distinct load-error state.

## 2. Routing & shell

- [x] 2.1 `admin/src/Route.elm`: add a `Health` variant; map `top` and `s "admin"` → `Health`; keep `s "admin" </> s "members"` → `Members`; update `toString`/`href` (`Health → /admin`); refresh the module doc.
- [x] 2.2 `admin/src/Main.elm`: add `HealthPage Status.Model` to `Page` and `HealthMsg` to `Msg`; handle them in `update`, `enter`, and `stepTo`; make `init` land on the `Health` route.
- [x] 2.3 `admin/src/Main.elm`: render a three-link nav (Status / Members / Dev · Tools) with active-state helpers, route `HealthPage` through `viewPage`, and update the module doc to describe the three areas.

## 3. Styling

- [x] 3.1 Add status-view styles to `admin/index.html` (state colors for healthy / failing / never-run, row layout, headline), reusing existing `.card` / `.error` classes where they fit.

## 4. Tests

- [x] 4.1 `admin/tests/RouteTest.elm`: assert `/admin` and `/` parse to `Health`, `/admin/members` parses to `Members`, and `toString`/`fromUrl` round-trips for each route.
- [x] 4.2 Add a decode test (new module or extend an existing one): a healthy `200` body decodes to a `Success` with all-`Healthy` jobs and a `Gated` posture; a job-degraded `503` body decodes to a `Success` whose `ok` is false with the `Failing`/`NeverRun` states preserved; an `admin.exposed` `503` body decodes to a `Success` whose `gateState` is `Exposed`; a non-health body yields a load error.

## 5. Docs

- [x] 5.1 Update `admin/CLAUDE.md` (and grep for any other prose enumerating the panel as just "Admin + Dev areas") to include the Status home area.

## 6. Build & validate

- [x] 6.1 `openspec validate admin-status-homepage --strict` passes.
- [x] 6.2 Rebuild the bundle with `aubr build:admin` and confirm `aubr build:admin --check` is clean; if `package.elm-lang.org` is unreachable, leave the rebuild to CI and do **not** commit a stale `admin/dist/`.
- [x] 6.3 Run the admin Elm tests and `aubr test` / `aubr typecheck` as a regression check; confirm green.
