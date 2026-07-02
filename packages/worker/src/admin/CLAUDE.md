# CLAUDE.md — `src/admin/` (the operator panel)

This is the operator admin panel (`operator-admin`): a **Hono** app mounted under the Worker's
`fetch` at `/admin` (no second Worker). Pages are **server-rendered** (`hono/jsx`) by calling
the Worker's own `src/` operation functions directly; interactive bits hydrate as **islands**
(`hono/jsx/dom`) that call the typed `/admin/api/*` routes via the `hc<AdminApp>()` client (zero
codegen). Both transports call the SAME `src/` functions — one source of truth per operation.

We model **with** the type system, not around it. The reason to be in TypeScript with `strict`
on is refactorability through exhaustiveness; lazy modeling (`boolean` flags, `string | null`
errors) throws that away. The discipline below is the TS port of the Elm panel's
"make-impossible-states-impossible" rules — the principle is identical, the idioms are
discriminated unions instead of Elm custom types.

## Prime directive: make impossible states impossible

The compiler can only protect you from the illegal states you *let it know are illegal*. Model
the data so a nonsensical combination **doesn't typecheck** — don't model it loosely and guard
it at runtime. A single discriminated union enumerating exactly the legal states is one source
of truth; parallel fields that can disagree are a bug surface.

Before adding a field, ask: **does every combination of this field with the others make sense?**
If not, collapse them into one union whose variants *are* the legal states.

## Rules

1. **Remote requests are a `Loadable`, never a `boolean` + `error` + `data` triple.** The
   antipattern (Kris Jenkins, *How Elm Slays a UI Antipattern*) is `{ loading, error, data }`
   where `loading=true, error=…, data=…` is a representable nonsense. Use the four-state union
   in [`lib/remote.ts`](lib/remote.ts) and switch over all four:
   ```ts
   // notAsked | loading | failure<E> | success<T>  — bad combos are unrepresentable
   type Loadable<T, E = ApiError> =
     | { status: "notAsked" }
     | { status: "loading" }
     | { status: "failure"; error: E }
     | { status: "success"; value: T };
   ```

2. **Errors carry their type and live INSIDE the failing variant — never a loose `string | null`.**
   A `string | null` error is stringly-typed *and* detached from what failed. Put the error in
   the state variant that can fail (`{ status: "failure"; error }`, `{ t: "failed"; op; error }`)
   so the view renders it with context and the compiler forces every failure to be handled.

3. **Discriminated unions for finite states, not `boolean`/`string`.** A field with a fixed set
   of meanings is a union, tagged by a literal discriminant. Several related `boolean`s almost
   always want to be one union. `string` is for free text the user types — not an enum. The one
   in-flight mutation + its target + its failure are ONE union, so they cannot contradict and
   one-at-a-time falls out for free:
   ```ts
   type Op = { kind: "onboard" } | { kind: "rotate"; id: string } | { kind: "revoke"; id: string };
   type ActionState =
     | { status: "idle" }
     | { status: "busy"; op: Op }
     | { status: "failed"; op: Op; message: string };
   ```

4. **Derive, don't store.** If a value is computable from other state, compute it in the render —
   don't add a field that can drift. State holds the *minimal* source of truth (e.g. `busy` is
   `action.status === "busy"`, not a separate flag).

5. **Switches over a union are exhaustive — end with `assertNever`, never a `default` that
   swallows a case.** A catch-all defeats the point: when you add a variant you *want* the
   compiler to flag every site. [`lib/remote.ts`](lib/remote.ts) exports `assertNever(x: never)`;
   put it in the `default` so an unhandled variant is a compile error.

6. **Optional (`?` / `| null`) is for genuine optional *presence*, not "error or loading."**
   `banner: Banner | null` (there is, or isn't, a freshly-minted thing to show) is legitimate.
   An error-or-loading `?` is a *state* masquerading as optional data — model it as a state.

7. **Narrow at the boundary; keep invariants in `src/`.** The panel passes strings through where
   the Worker already canonicalizes them (e.g. usernames). Don't re-implement domain validation
   in the island — the typed route calls the same `src/` function the SSR path does, and that
   function owns the invariant. Add panel-side narrowing only when the panel grows its own rule.

8. **SSR vs island boundary.** A page that only *reads* is pure SSR — call the `src/` reader
   directly and render; no island, no client fetch (first paint carries the data). Add an island
   only for genuine interactivity (mutations, dialogs, in-place refetch). An island seeds from a
   `<script type="application/json">` props block the SSR page emits — never a fetch-on-mount for
   data the server already had.

## DOM vs Worker types

Islands (`client/*.tsx`) run in the browser and are typechecked under
[`client/tsconfig.json`](client/tsconfig.json) with the DOM lib + `jsxImportSource:
"hono/jsx/dom"`; the SSR pages compile under the root config (workerd types, `jsxImportSource:
"hono/jsx"`). Keep browser-only code in `client/`. `aubr typecheck` runs both passes.

## Styling — the Basecoat design system

**Designs come from the companion Claude Design project — don't wing them.** The panel's visual
design is authored in a companion **Claude Design** project (claude.ai/design) that holds the
BasecoatUI design-system awareness and is the source of truth for the look. When a surface needs a
new design or an existing one changes, don't improvise the markup/styling here: write the user a
prompt describing the change for them to run in that Claude Design project, then take the updated
bundle it hands back (the exported zip) as the basis for the local change and translate it into the
Basecoat markup below. Always routing design through the project produces better designs and keeps
the project and the panel from drifting apart — never fork the design in this repo instead of
updating it upstream.

The panel is styled with **Basecoat** (the Vega style pack), a Tailwind CSS component system
(shadcn/ui-compatible tokens, no React). `src/admin/styles.css` is the **Tailwind entry**:
`@import "tailwindcss"; @import "basecoat-css/vega";` + the operator theme (`--primary` → the
orange accent). The build (`build-admin.mjs`) Tailwind-compiles it; `@source "./"` scans this
tree for the utility classes you use.

- **Compose from Basecoat's class API:** a root component class plus `data-variant`/`data-size`
  attributes — `<button class="btn" data-variant="destructive" data-size="sm">`, `<div class="card"><section>…</section></div>`, `<div class="alert" data-variant="destructive"><svg…/><h2>…</h2><section>…</section></div>`, `<span class="badge">`, `<input class="input">`, `<table class="table">`. Layout is **Tailwind utilities** (`flex`, `grid`, `gap-*`, `items-center`, …).
- **No Basecoat component JavaScript.** Modals use the native `<dialog>` element (`showModal()`)
  — Basecoat styles it CSS-only; interactivity lives in `hono/jsx/dom` island state, so read-only
  pages still ship zero client JS. Do not load Basecoat's JS into an island (it would fight the
  island's DOM reconciliation).
- **Icons:** inline Lucide SVG (Basecoat ships none) — copy the path from lucide.dev.
- **Panel-specific CSS:** beyond the imports + theme, `styles.css` holds only the layout Basecoat
  doesn't define — the area nav + sub-nav pills, the Status/Logs master-detail grids, status dots,
  the recipe-tier badges, and the once-shown credentials callout. Everything else is Basecoat
  components + Tailwind utilities; reach for those first and add to `styles.css` only for layout
  Basecoat genuinely lacks.

## Build & serve

- Source of truth: `src/admin/**`. `scripts/build-admin.mjs` (`aubr build:admin`) esbuild-bundles
  each `client/*.tsx` island → `admin/dist/admin/islands/*.js` and **Tailwind-compiles** `styles.css`
  (Basecoat + the panel's utilities) → `admin/dist/admin/styles.css`. SSR pages are NOT pre-built —
  the Worker renders them per request.
- **`admin/dist/` is a gitignored build artifact — not committed.** CI and the deploy build it
  fresh (esbuild + Tailwind, both from installed node_modules — no network registry), and local
  `wrangler dev` needs a build first. (The bundles embed environment-specific module paths, so a
  committed copy wouldn't be reproducible.)
- Auth lives in the Worker (Cloudflare Access on `/admin*`, reused as the app's `accessGate`
  middleware). Islands just call same-origin `/admin/api/*` and trust the gate — keep auth logic
  out of the client.

## Testing — the Playwright harness (`admin/visual/`)

The panel's browser-level gate is the Playwright suite under [`admin/visual/`](../../admin/visual/)
(`aubr test:admin`, CI's blocking `admin-ui` job). It drives the real panel in Chromium against a
seeded local `wrangler dev` and is organized on the Page Object Model: **specs never hard-code a
route or selector** — those live in the page/component objects.

- **Layout.** `pages/` — one page object per top-nav area (extends `base.page.ts`'s `AdminPage`:
  shell assertion, nav + health-dock components, `captureForReview`); sub-surfaces (member
  detail, Satellites, the Reconcile tab) are sub-page objects/methods on their parent. `components/`
  — the shared shell pieces (nav, health dock, stat tiles, dialogs, tables). `fixtures.ts` — the
  extended `test` specs import (one fixture per page object). `registry.ts` — the ordered
  all-areas list the smoke spec iterates. `seed.mjs` — the deterministic fixture set (+ its
  hand-maintained types in `seed.d.mts`). `specs/` — the suite. Typechecked by its own
  `admin/visual/tsconfig.json` pass inside `aubr typecheck`.
- **Adding an admin area is one seam:** write its page object (route, landmark, expected
  fixtures), register it in `registry.ts` and `fixtures.ts`, and extend `seed.mjs` when the area
  needs data — the all-areas smoke (landmark + screenshot + health dock) picks it up with no
  other spec edits. Interaction flows (dialogs, forms) get their own spec next to
  `members.spec.ts` / `normalize.spec.ts`.
- **Landmark discipline.** A landmark is SSR-rendered (never behind island hydration),
  unique to its area, and **time-free**. Never assert relative-age text ("5m ago") — the seed
  keeps those labels stable by computing timestamps relative to the run's clock at mid-bucket
  offsets, but they are fixture plumbing, not assertion surface. Island interactions (a dialog
  open) go through `DialogComponent.openVia`, which retries the trigger click until the native
  `<dialog>` reports `open` (a click can land before hydration attaches the listener).
- **Screenshots are review output, not assertions.** Every area captures a full-page PNG into
  `admin/visual/.screenshots/` under a stable ASCII name; CI publishes them as the PR's single
  sticky screenshot comment (mobile-renderable) on admin-UI PRs. There are **no pixel
  baselines** — visual regression review is human, over those screenshots.
- **Running locally.** `aubr test:admin` from `packages/worker` boots everything itself (build →
  migrate → seed → `wrangler dev`). Web-session sandboxes: set
  `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (the pre-installed Chromium matching the pinned
  `@playwright/test`); when a Playwright bump outpaces the sandbox image, fall back to
  `npx playwright install chromium`. `PW_PORT=<port>` when 8787 is taken; `PW_CHROMIUM_PATH`
  points at a bare Chromium binary as the last resort. The `/admin-ui` skill packages this loop.

## Sources

- Richard Feldman — [*Making Impossible States Impossible*](https://www.youtube.com/watch?v=IcgmSRJHu_8)
- Kris Jenkins — [*How Elm Slays a UI Antipattern*](https://blog.jenkster.com/2016/06/how-elm-slays-a-ui-antipattern/) (the `Loadable` shape)
- TypeScript Handbook — [Discriminated Unions](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#discriminated-unions) · [exhaustiveness with `never`](https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking)
