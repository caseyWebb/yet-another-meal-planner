## 1. Worker — tool catalog + invocation API

- [x] 1.1 Add an in-memory MCP invocation helper (in `src/admin.ts` or a new `src/admin-tools.ts`): given `env` + a resolved `Tenant`, build `buildServer(env, tenant)`, link `InMemoryTransport.createLinkedPair()`, connect a `Client`, and expose `listTools()` and `callTool({ name, arguments })`. Connect + close per call (stateless, matching `/mcp`); map a transport/connect failure to a structured `upstream_unavailable`. — `src/admin-tools.ts` (`withServer`/`invokeTool`/`listToolsFor`/`callToolFor`).
- [x] 1.2 Route `GET /admin/api/tools`: resolve the `acting-as` tenant via `resolveTenant(env, id, directoryFromEnv(env))` (reuse the `unauthorized`/`not_found` mapping), list tools, and return `{ tools: [{ name, description, inputSchema }] }` from the live `tools/list`.
- [x] 1.3 Route `POST /admin/api/tools/<name>`: read `{ tenant, arguments }`, resolve the tenant, `callTool`, and return the tool's structured result **or structured error verbatim** (a tool-level structured error is `200` data, not a `500`); reserve non-200 for resolution/validation/transport failures via `statusFor`. — Note: the SDK wraps unknown-tool/bad-args into `isError` results (not throws); `invokeTool` normalizes those plain-text protocol errors to `{ error, message }` and passes the tool's own structured errors through.
- [x] 1.4 Wire both routes into `routeAdminApi`/`handleAdmin` alongside the `tenants` routes, under the same Access gate and the same `ToolError → statusFor` serialization. — Broadened the API branch to `path.startsWith("/admin/api/")` and threaded `env` into `routeAdminApi`.

## 2. Worker — SPA shell fallback for client routes

- [x] 2.1 In `handleAdmin`, for a GET that is neither an `/admin/api/*` route nor a real built asset, serve the SPA shell by **fetching** `index.html` from `ASSETS` and returning it `200` (do not rewrite to `/admin/index.html` — it re-enters `run_worker_first` and loops). Preserve today's `/admin` trailing-slash + real-asset behavior. — Tries the real path first; on a `404` falls back to the canonical `/admin/` (served as index.html, no redirect).
- [x] 2.2 Confirm `/admin/api/*` never falls through to the shell (an unknown API route stays a structured `not_found`, not HTML). — `routeAdminApi`'s final `throw not_found` is serialized as JSON before the static branch.

## 3. Admin SPA — shell + routing (`Browser.application`)

- [x] 3.1 Convert `admin/src/Main.elm` to `Browser.application` (`onUrlRequest`/`onUrlChange`, hold `Nav.Key`); add a `Route` type (`Members | Tools (Maybe String) | NotFound`, in `admin/src/Route.elm`) parsed by `Url.Parser`, and render the top-level Admin/Dev nav.
- [x] 3.2 Model the current page as a `Page` union whose variant **owns its sub-model**; a route change swaps `Page`. Keep `update`/`view` exhaustive (no `_ ->` swallowing a page), per `admin/CLAUDE.md`.
- [x] 3.3 Extract the onboard+members UI into `admin/src/Admin/Members.elm` essentially unchanged (its `Model`/`Msg`/`update`/`view` + the `/admin/api/tenants` HTTP), mounted under the Admin area. No behavior change to onboard/rotate/revoke/list. — `view` now returns the surface's content; the shell owns the title + nav.
- [x] 3.4 Factor shared bits as needed (`Route` module; the member-id decoder reused by the persona selector). — `Route` is shared; the tiny `tenants` decoder is inlined in each consumer (one-liner, not worth a module).

## 4. Admin SPA — the tool console (Dev area)

- [x] 4.1 `admin/src/Dev/ToolConsole.elm`: model the workbench as `NoPersona (WebData ...) | Acting Session` so "invoke with no persona" is unrepresentable; a persona selector fed by the member list (`/admin/api/tenants`).
- [x] 4.2 Fetch the catalog from `GET /admin/api/tools?tenant=<persona>` as `WebData`; render the tool list with each tool's description and its input schema shown **read-only** (pretty-printed).
- [x] 4.3 Raw-JSON arguments textarea + Run; `POST /admin/api/tools/<name>` with `{ tenant, arguments }`; render the structured result/error as `RemoteData InvokeError Invocation` (the failure carries its type — `BadArgsJson` for a local parse error vs `Transport` for the request).
- [x] 4.4 Persistent "acting as `<member>`" banner whenever a tool is runnable; require a confirm-before-run for a real member; a `test-`/`sandbox-` persona bypasses the confirm.
- [x] 4.5 Deep-link: `/admin/dev/tools/<tool>` selects that tool (tool list items are real route links, so the shell re-opens via `selectTool` on nav); honor an optional `?as=<id>` to initialize the persona (best-effort, read once at `init`).

## 5. Build + docs

- [x] 5.1 `aubr build:admin` to regenerate the committed `admin/dist/` (needs `package.elm-lang.org`; if unreachable, land source and leave the rebuild to CI). `aubr build:admin --check` to confirm no drift. — Registry was reachable; bundle rebuilt and `--check` reports up to date (4 modules compiled).
- [x] 5.2 `docs/SELF_HOSTING.md`: document the operator dev console (the Admin/Dev split, "acting as" a member, the tool console) **and** the trust note — the console lets the operator read any member's domain data and fire write tools as that member.
- [x] 5.3 `docs/ARCHITECTURE.md`: note the admin surface now also invokes the tool surface in-process (in-memory transport, same `buildServer` path) as a dev/ops console; confirmed `docs/TOOLS.md` needs **no** change (the console reads the live `tools/list`; no tool contract changes).

## 6. Tests + verify

- [x] 6.1 Worker (`test/admin*.test.ts`): `GET /admin/api/tools` returns the catalog for a fake tenant; `POST` invoke returns a tool's structured result; a tool's structured error is returned as data (not 500); unknown tool → `not_found`-class; absent/non-allowlisted `acting-as` tenant → `validation_failed`/`not_found`; with no Access config the tools routes respond `404`. — `test/admin-tools.test.ts` (invocation plumbing + error mapping over a hand-built server) + new `handleAdmin (tool console)` block in `test/admin.test.ts` (real `buildServer` catalog, 400/404, disabled-surface 404).
- [x] 6.2 Worker: the SPA-shell fallback serves `index.html` for an unmatched `/admin/*` GET and never for `/admin/api/*`. — `test/admin.test.ts`: deep-link route falls back to `/admin/` at 200, URL kept; the existing `/admin` passthrough test still green.
- [x] 6.3 Elm: the `NoPersona | Acting` and `Page` unions make the key invariants ("no persona ⇒ no invoke"; no page-holds-another's-state) **compile-enforced** — verified by `aubr build:admin` (the intended verification mechanism per `admin/CLAUDE.md`). The `Route` parser + deep-link behavior are exercised by the Worker-side SPA-fallback test. A standalone `elm-test` harness was intentionally NOT added (the repo has none; it would be its own toolchain change).
- [x] 6.4 `aubr typecheck` + `aubr test` (676 passed) + `aubr test:tooling` (123 passed) green; `aubr build:admin --check` clean. Manual smoke under `wrangler dev` with `ADMIN_DEV_BYPASS=1` (list tools, run a read tool as a persona, observe a Kroger tool's structured auth error on an unlinked persona) NEEDS local `wrangler dev` + local D1 / dev secrets — not available in this environment.
