## 1. Reprobe action in the Logs view

- [x] 1.1 Add a `ReprobeState` type (`ReprobeIdle | ReprobeRunning | ReprobeDone ReprobeSummary | ReprobeFailed Http.Error`) and a `ReprobeSummary` record (`scanned`, `reclassified`, `stillUnreachable`, `nowAcquirable`) to `admin/src/Logs.elm`; add a `reprobe : ReprobeState` field to `Model` (init `ReprobeIdle`).
- [x] 1.2 Add `RunReprobe` + `GotReprobe (Result Http.Error ReprobeSummary)` messages and handle them: `RunReprobe` no-ops while running else sets `ReprobeRunning` and fires the POST; `GotReprobe Ok` sets `ReprobeDone` AND reloads the log (`discovery = Loading` + `fetchDiscovery`); `GotReprobe Err` sets `ReprobeFailed`. Clear the summary back to `ReprobeIdle` on `Reload`/source-reselect.
- [x] 1.3 Add `postReprobe : Cmd Msg` (POST `/admin/api/discovery/reprobe-parked`, no body) and `reprobeSummaryDecoder`.
- [x] 1.4 Render a **Re-probe parked** button in the Discovery `log-head` (disabled while `ReprobeRunning`, label "Re-probing…") and a `viewReprobe` line showing the summary via a pure `reprobeSummaryText` helper, or the failure via `httpError`.
- [x] 1.5 Expose `ReprobeSummary`, `reprobeSummaryDecoder`, `reprobeSummaryText` for tests; add `LogsTest.elm` cases for the decoder and the summary text.

## 2. Docs + build + verify

- [x] 2.1 Update `docs/SELF_HOSTING.md`: the `reprobe-parked` backfill is now a button in **Logs › Discovery** (curl still works).
- [x] 2.2 `aubr build:admin` (rebuild the committed bundle), `aubr test:admin` (Elm tests green), `aubr build:admin --check` clean.
- [x] 2.3 `openspec validate "admin-reprobe-parked-button" --strict` passes.
