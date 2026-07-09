# design-sync notes — @yamp/ui

Repo-specific gotchas for future syncs. Read this first.

## Build setup (package shape, no dist)

- `@yamp/ui` ships **raw TypeScript** — no `dist/`, no build script, `exports["."] = "./src/index.ts"`.
  The converter esbuilds the source entry directly: pass `--entry ./packages/ui/src/index.ts`.
- `--node-modules packages/ui/node_modules` (the package's own — it has react 19.2.7, @radix-ui/*, cva, clsx, tailwind-merge).
- Prop extraction works well from source via ts-morph (CVA `variant`/`size` etc. resolve correctly) — `[DTS] parsed 0 .d.ts files` is expected (synth-from-source), NOT a problem.

## Styling — Tailwind must be compiled ourselves

- The DS has **no shipped stylesheet**. Its look is Tailwind v4 utility classes that the *apps* compile by
  scanning `packages/ui/src`. So we compile the stylesheet: `bash .ds-sync/recompile-css.sh`
  (input `.ds-sync/tw-input.css` → `packages/ui/.ds-compiled.css`, wired as `cfg.cssEntry`, gitignored).
- The compile scans `packages/ui/src` + `packages/app/src` + `packages/admin-app/src` + `.design-sync/previews`.
  **Re-run `recompile-css.sh` after adding/changing previews** if a preview introduces a utility class not
  already used anywhere in those sources (rare — previews port real app compositions). The orchestrator's full
  rebuild covers this; subagents reuse the shared compiled CSS.
- Tailwind CLI is not a repo dep — it's installed in the isolated `.ds-sync` scratch (`@tailwindcss/cli@^4.3.2`).

## Fonts

- Geist / Geist Mono load via a **remote Google Fonts `@import`** (kept at the top of `tw-input.css` → compiled CSS).
  validate reports `[FONT_REMOTE]` — expected, no action. Renders in Geist at runtime (claude.ai/design); the
  local headless render check falls back to system fonts offline (the DS's `--font-*` stacks degrade gracefully).

## Component surface / config

- ~80 exports; only ~37 are top-level components. Compound sub-parts (`CardHeader`, `SelectItem`, `DialogContent`, …)
  are **flat exports**, not namespace/attached-property compounds, so the converter's auto-nesting can't detect them.
  They're nulled in `cfg.componentSrcMap` (still importable in the bundle; just no standalone card) and composed
  inside their parent's authored preview.
- Groups come from `cfg.docsDir = ../../.design-sync/docs` — one `<Name>.md` stub per keeper carrying
  `category:` frontmatter (8 groups: Actions/Forms/Feedback/Overlays/Data/Navigation/Meal Planning/Icons) plus a
  one-line description that seeds the prompt.md. Regenerate via `node .ds-sync/gen-config.mjs` (but see below).
- **Icon gallery**: the 29 `Icon*` exports are nulled; a synthetic `Icons` gallery component lives at
  `.design-sync/icons/icon-gallery.tsx`, added to the bundle via `cfg.extraEntries` (so `window.GroceryAgentUI.Icons`
  exists and passes `[BUNDLE_EXPORT]`). It renders every icon in a labeled grid. The individual icons stay fully
  importable. `cfg.dtsPropsFor.Icons` gives it a clean contract note.
- `.ds-sync/gen-config.mjs` is a one-shot helper (gitignored). It computes the sub-part null list from the LAST
  build's emitted dirs, so it only works right after a build that emitted the full set — the durable truth is the
  committed `.design-sync/config.json`. Edit config.json directly for small changes.

## Playwright / render check

- Chromium installed to `~/.cache/ms-playwright`; symlinked `~/Library/Caches/ms-playwright` → it so the macOS
  default path resolves without any env var (subagents' captures then work with no PLAYWRIGHT_BROWSERS_PATH).
- playwright + typescript are installed in the `.ds-sync` scratch (not repo deps).

## Preview authoring notes (folded from wave learnings)

- **Overlays render open** via `defaultOpen` + a config `overrides.<Name> = {cardMode:"single", viewport:"WxH"}`
  (Dialog/AlertDialog/DropdownMenu/Tooltip/Select). Combobox has no `defaultOpen` — its `Open` cell uses `autoFocus`.
- **Toaster**: `toast(msg)` is a module-level emitter; `<Toaster/>` only registers its listener in a post-mount
  `useEffect`. Calling `toast()` at module scope fires before any listener → empty host. Fix: call `toast(...)` inside
  a `React.useEffect(()=>{…},[])` in the preview body so it lands after the sibling Toaster mounts. Toast auto-dismisses
  at 2.2s — the headless capture is well inside that window.
- **SlotCard**: fill EVERY `ProposeSlotView` field (source `packages/ui/src/components/propose.tsx` is authority).
  `flags[].type` ∈ `waste|meal-prep|side`; three worthwhile states: filled `main`, `locked+vibeEdited+pins`, `main:null+emptyReason`.
- **WeatherStrip** `category` ∈ `grill|cold-comfort|wet|mild` (accent map). **VarietyBar** `proteinHist` entries with n>1
  get a `×N` accent. **FacetChip** `kind="protein"` is the only accented variant.
- All previews use inline `style={{}}` for layout glue (no Tailwind utility classes) so the shared compiled CSS suffices.

## Known render warns
- **Toaster** timing: if a future capture pipeline adds a settle delay > ~2.2s, the toast pill goes blank (auto-dismiss). Bump timers or capture sooner.
- `[FONT_REMOTE]` (Geist/Geist Mono) — expected, recorded above.

## Re-sync risks
- **Remote font dependency**: Geist loads from Google Fonts at runtime. If that host changes, typography degrades to
  fallback silently. Consider self-hosting via `cfg.extraFonts` if fidelity matters more than matching how the apps ship.
- **Compiled CSS staleness**: `packages/ui/.ds-compiled.css` is gitignored and must be recompiled (`recompile-css.sh`)
  before any rebuild — the DS source or theme changing without a recompile ships stale utilities.
- **Sub-part null list**: if new compound sub-parts are added to a component, add them to `componentSrcMap` nulls or
  they'll appear as standalone cards.
- **`[CONFIG_STALE]` on re-sync**: changing `cfg.overrides` for a component after the last full build makes
  `preview-rebuild.mjs` (the subagent-scoped rebuild) refuse it — the stamped per-component config slice no longer
  matches. Fix: run a full `package-build.mjs` once to re-stamp, THEN the scoped rebuild/capture works. So: make ALL
  config/override changes, do one full build, and only then fan out subagents. Changing config also clears affected
  grades (source key changes), so grade in the final config state — grade LAST, after the final build.
- **Grouping quirk**: the group derivation filters any path segment equal to the component name. The `Icons` gallery
  therefore pins `componentSrcMap.Icons = "src/components/icons.tsx"` (a generic `components/` dir → filtered → falls to
  the `category: Icons` doc stub) for the group, while its runtime export comes from `.design-sync/icons/icon-gallery.tsx`
  via `extraEntries`. Don't "simplify" the pin to the gallery path — it regresses the group to "design-sync".
