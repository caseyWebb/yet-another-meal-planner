# CLAUDE.md — the operator admin panel

The operator admin panel (`operator-admin`) is a **React SPA** (`packages/admin-app`) on the
member app's stack — React 19 + Vite (Rolldown) + TanStack Router/Query — served by the Worker
at `/admin` from the `assets/admin/` subtree of the merged static-assets root. The Worker side
lives here in `src/admin/`: [`app.ts`](app.ts) (the Cloudflare Access gate, the serving
dispatch, the legacy redirects), [`api.ts`](api.ts) (every typed `/admin/api/*` route — the
mutations/previews AND the per-screen aggregate reads), [`config-api.ts`](config-api.ts), and
[`markdown.ts`](markdown.ts) (the Worker-side renderer — recipe/guidance HTML ships in the
read payloads; no markdown parser reaches the browser). Routes assemble the Worker's own
`src/` operation functions directly — one source of truth per operation, whichever screen or
transport calls it.

The SPA consumes the routes via Hono's `hc` client over the worker package's types-only
`./admin-api` export (zero codegen): each screen has ONE primary query
(`packages/admin-app/src/lib/queries.ts`) over its aggregate read; mutations are awaited
`useMutation`s that invalidate the affected query — never a full page reload.

We model **with** the type system, not around it. The reason to be in TypeScript with `strict`
on is refactorability through exhaustiveness; lazy modeling (`boolean` flags, `string | null`
errors) throws that away.

## Prime directive: make impossible states impossible

The compiler can only protect you from the illegal states you *let it know are illegal*. Model
the data so a nonsensical combination **doesn't typecheck** — don't model it loosely and guard
it at runtime. A single discriminated union enumerating exactly the legal states is one source
of truth; parallel fields that can disagree are a bug surface.

Before adding a field, ask: **does every combination of this field with the others make sense?**
If not, collapse them into one union whose variants *are* the legal states.

## Rules

1. **Remote data is the query's status union — never a recombined `{loading, error, data}`
   triple.** `useQuery`'s discriminated `status` IS the `Loadable`: `pending` / `error`
   (carrying `error`) / `success` (carrying `data`), with not-asked as a *disabled query* and
   `fetchStatus` for the in-flight distinction. Branch on `status` and end with `assertNever`
   (`packages/admin-app/src/lib/assert.ts`). The antipattern is destructuring a query into
   loose `isLoading` / `error` / `data` locals that can recombine contradictorily — don't.

2. **Server state is never copied into `useState`.** The query cache is the one source of
   truth; a mutation edits the cache (`invalidateQueries`, or `setQueryData` for the one
   optimistic surface) — never a shadow copy that can drift. This is the SPA-era restatement
   of "derive, don't store". Optimistic updates are used exactly where the shipped panel
   behaved optimistically (the satellite quarantine hold/clear), nowhere else — the operator
   panel prefers honest in-flight states.

3. **A mutation's state is ONE value.** `useMutation`'s union (idle / pending / error /
   success, with `variables` identifying the operation and target) is the old `ActionState`:
   busy, *which* target, and the failure cannot contradict. One-at-a-time stays structural —
   gate the surface on the mutation's `isPending`, never a parallel boolean.

4. **Errors carry their type inside the failing variant — never a loose `string | null`.**
   The structured `ApiError` body rides `mutation.error` / `query.error` (see
   `packages/admin-app/src/lib/api.ts`'s `unwrap` / `apiErrorOf`), so the view renders it
   with context and the compiler forces every failure to be handled.

5. **Finite local UI states are discriminated unions, not `boolean`s/`string`s.** Dialog and
   wizard states, the calibration console's Clean/Dirty/NeedsConfirm machine — a fixed set of
   meanings is a union tagged by a literal discriminant. `string` is for free text the user
   types.

6. **URL search params own any state a deep link should reproduce.** Tabs, filters, pages,
   search queries, selections — validated per-route (`validateSearch`), same names and
   defaults-omitted convention as always, so every state is shareable and the Playwright specs
   can deep-link it. Component state is for the rest (an open dialog, a draft field).

7. **Switches over a union are exhaustive — end with `assertNever`, never a `default` that
   swallows a case.** When you add a variant you *want* the compiler to flag every site.

8. **Narrow at the boundary; keep invariants in `src/`.** The panel passes strings through
   where the Worker already canonicalizes them. Don't re-implement domain validation in the
   screen — the typed route calls the same `src/` function every transport uses, and that
   function owns the invariant.

9. **Reads are aggregate, screen-shaped, and assembled Worker-side.** A new surface gets one
   Access-gated `GET /admin/api/...` in `api.ts` composing existing `src/` readers (never new
   `env.DB` access in a route), returning degraded states as data — a decoded degraded payload
   is a successful read; thrown errors are for transport/decode failures only. Bounded
   whole-dataset reads are filtered/paginated client-side; genuinely parameterized reads
   (recipe search, guidance browse) keep their params server-side.

## Styling — the shared shadcn/ui system

**Designs come from the companion Claude Design project — don't wing them.** The panel's
visual design is authored in a companion **Claude Design** project (claude.ai/design) that is
the source of truth for the look. When a surface needs a new design or an existing one
changes, don't improvise the markup/styling here: write the user a prompt describing the
change for them to run in that Claude Design project, then take the updated bundle it hands
back (the exported zip) as the basis for the local change. Always routing design through the
project produces better designs and keeps the project and the panel from drifting apart —
never fork the design in this repo instead of updating it upstream.

- **Generic primitives come from `packages/ui`** — the vendored shadcn/ui components both
  apps share (Button, Card, Input, Badge, Alert, Table, Dialog, AlertDialog, DropdownMenu,
  Select/NativeSelect, Switch, Slider, Progress, Tooltip, Empty, Pagination) — styled by the
  shared Tailwind v4 theme tokens (`@grocery-agent/ui/theme.css`). Don't re-derive bespoke
  markup for these.
- **The operator theme is a layer, not a fork**: `packages/admin-app/src/admin.css` imports
  the shared tokens, then overrides (`--primary` → the orange accent, the `--c-*` palette
  aliases, light on `:root`, dark remapped on `html.dark`). The member app's look is
  untouched. Dark mode keys on `.dark` on `<html>`, persisted to `localStorage["ga-theme"]`,
  applied pre-paint by the inline script in `index.html`.
- **Panel-specific composites** (stat-tile grid, `Item`/`ItemGroup` rows, pills, sparklines +
  hover tip, `PrettyKV`, `StageTrack`, pager) live in
  `packages/admin-app/src/components/kit.tsx` and keep their class vocabulary in `admin.css`.
  Reach for the kit + Tailwind utilities first; add CSS only for layout the system genuinely
  lacks.
- **Icons:** inline Lucide SVG components (`packages/admin-app/src/components/icons.tsx`) —
  copy the path data from lucide.dev; no icon package.

## Build & serve

- `aubr build:admin` = the admin app's Vite build → `packages/worker/assets/admin/`
  (`base: "/admin/"`; a clean-own-subtree plugin removes only its outputs, so
  `build:admin`/`build:app` run in either order into the one merged, **gitignored** assets
  root). CI and the deploy build it fresh; local `wrangler dev` needs a build first.
- `aubr dev:admin` = `wrangler dev` + the admin app's Vite dev server (HMR at :5174,
  `/admin/api` proxied to :8787). Plain `aubr dev` serves the last-built bundle (the no-HMR
  path the Playwright harness uses).
- **Serving dispatch** (`app.ts` — `/admin*` is `run_worker_first`, so the Worker answers
  everything): gate → API routes → legacy 302s → `/admin/assets/*` via `ASSETS.fetch` with
  the HTML→404 guard (a missing admin asset must 404, never any SPA shell) → catch-all GET
  serves the admin shell — **except `/admin/api/*`**, where an unmatched path stays a plain
  404 so an HTML response on the API surface remains an unambiguous Access signal.
- **Access expiry** is detected in the SPA's one shared fetch wrapper
  (`packages/admin-app/src/lib/api.ts`): a network failure, redirect, or HTML response on
  `/admin/api` flips the blocking "session expired — reload to sign back in" overlay. Auth
  itself lives in the Worker (Cloudflare Access on `/admin*` as the `accessGate` middleware);
  keep auth logic out of the client.

## Testing — the Playwright harness (`admin/visual/`)

The panel's browser-level gate is the Playwright suite under [`admin/visual/`](../../admin/visual/)
(`aubr test:admin`, CI's blocking `admin-ui` job). It drives the built admin SPA served by a
seeded local `wrangler dev` and is organized on the Page Object Model: **specs never hard-code
a route or selector** — those live in the page/component objects.

- **Layout.** `pages/` — one page object per top-nav area (extends `base.page.ts`'s
  `AdminPage`); sub-surfaces are sub-page objects/methods on their parent. `components/` —
  the shared shell pieces (nav, health indicator, stat tiles, dialogs, tables). `fixtures.ts`
  — the extended `test` specs import. `registry.ts` — the ordered all-areas list the smoke
  spec iterates. `seed.mjs` — the deterministic fixture set shared with the app suite.
  Typechecked by its own tsconfig pass inside `aubr typecheck`.
- **Adding an admin area is one seam:** write its page object (route, landmark, expected
  fixtures), register it in `registry.ts` and `fixtures.ts`, and extend `seed.mjs` when the
  area needs data — the all-areas smoke picks it up with no other spec edits.
- **Landmark discipline.** A landmark renders from the area's PRIMARY QUERY (Playwright
  locator auto-wait covers the fetch+render cycle), is unique to its area, and is
  **time-free** — never assert relative-age text. Dialogs are the shared Radix primitives:
  locate them by `getByRole("dialog", { name: … })` through `DialogComponent`.
- **Navigations are client-side** (TanStack Router); the history API updates the URL, so
  `waitForURL` assertions hold. Serving-dispatch guarantees (missing-asset 404, API
  JSON-or-404, deep-link shell) live in `specs/navigation.spec.ts`.
- **Screenshots are review output, not assertions.** Every area captures a full-page PNG into
  `admin/visual/.screenshots/` under a stable ASCII name; CI publishes them as the PR's single
  sticky screenshot comment. There are **no pixel baselines** — visual regression review is
  human, over those screenshots.
- **Running locally.** `aubr test:admin` from `packages/worker` boots everything itself
  (Vite build → migrate → seed → `wrangler dev`). Web-session sandboxes: set
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; `PW_PORT=<port>` when 8787 is taken;
  `PW_CHROMIUM_PATH` points at a bare Chromium binary as the last resort. The `/admin-ui`
  skill packages this loop.

## Sources

- Richard Feldman — [*Making Impossible States Impossible*](https://www.youtube.com/watch?v=IcgmSRJHu_8)
- Kris Jenkins — [*How Elm Slays a UI Antipattern*](https://blog.jenkster.com/2016/06/how-elm-slays-a-ui-antipattern/) (the `Loadable` shape `useQuery` natively carries)
- TanStack Query — [Queries](https://tanstack.com/query/latest/docs/framework/react/guides/queries) · [Mutations](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)
- TypeScript Handbook — [Discriminated Unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions) · [exhaustiveness with `never`](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking)
