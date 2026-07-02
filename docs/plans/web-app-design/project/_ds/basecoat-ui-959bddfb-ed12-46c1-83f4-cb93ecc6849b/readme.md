# Basecoat Design System

**Basecoat** is the [shadcn/ui](https://ui.shadcn.com) design system rebuilt as
**pure CSS** — shadcn's components, tokens, and neutral aesthetic with no
React, no Radix, and no framework runtime. Where shadcn ships copy-paste React
components, Basecoat ships semantic HTML + a class API (`class="btn"`,
`data-variant="outline"`) that drops into any stack. This project packages that
system for design work: real tokens, a dependency-free component layer, React
component primitives, foundation specimens, and a worked product UI kit.

> **One-line mental model:** shadcn/ui's look and feel, addressable from plain
> HTML. Neutral by default; re-theme by overriding a handful of CSS variables.

## Sources

This system was built by reading these repositories. The reader is encouraged
to explore them for deeper fidelity (you may not have access; links are stored
for reference):

- **Basecoat** — the design system itself (Tailwind v4 source + generated
  bundles, JS lifecycle, docs site): <https://github.com/hunvreus/basecoat>
  · docs: <https://basecoatui.com> · LLM index: <https://basecoatui.com/llms.txt>
- **grocery-agent** — a real Basecoat consumer; its operator-admin is recreated
  as this project's UI kit: <https://github.com/caseyWebb/groceries-agent>
  (admin source in `src/admin/`, snapshots in `admin/visual/`).

Basecoat's component CSS is authored as Tailwind `@apply` source. This project
**hand-translates the default "Vega" style pack into dependency-free plain CSS**
(`basecoat.css`) so consumers need only link `styles.css` — no build step.

---

## CONTENT FUNDAMENTALS

How Basecoat (and its consumers) write copy. The voice is the developer-tool
voice: **terse, lowercase-leaning, precise, lightly wry.**

- **Tone.** Plain and technical. States facts, not benefits. "Semantic
  HTML-first components." "Small vanilla JavaScript for components that need
  behavior." No exclamation marks, no hype, no growth-marketing adjectives.
- **Casing.** Sentence case everywhere — headings, buttons, labels ("Add to
  menu", "Invite member", "Service health"). Product and identifier names stay
  lowercase: `basecoat`, `grocery-agent`, `recipe-index`. The wordmark is
  lowercase. Code identifiers are rendered in mono verbatim (`ACCESS_AUD`,
  `--primary`, `match_ingredient_to_kroger_sku`).
- **Person.** Second person for instructions to the user ("Set
  `ACCESS_TEAM_DOMAIN`…", "Tune the sweep's knobs, then Save"). First person is
  rare and only in product personas (the grocery-agent talks like "a friend who
  knows your kitchen"). Docs are impersonal/imperative.
- **Length.** Short. Button labels are 1–3 words; badges 1 word; helper text one
  sentence ("We never share it."). Empty states are a single muted line ("No
  recipes in the corpus or the index.").
- **Punctuation & wit.** Em-dashes and parentheticals carry the dry asides
  ("Not a product, not a startup."). The grocery-agent README is the reference
  for product voice; the Basecoat README for system voice.
- **Emoji.** **None** in the design system or UI surfaces. (The grocery-agent's
  developer README uses a few section emoji, but product UI does not — don't
  put emoji in components or screens.)
- **Numbers & units.** Concrete and unrounded — copy exact config values
  (`0.55`, `150`, `60`), durations ("20 min"), and dates as written.

---

## VISUAL FOUNDATIONS

The whole system turns on **restraint**: a neutral palette, one accent you
choose, hairline borders, flat surfaces, and tight type. It should look like
shadcn/ui because it *is* shadcn/ui.

### Color
- **Neutral by default.** The palette is achromatic — `oklch(L 0 0)` grays from
  near-white surfaces to a near-black (`oklch(0.205 0 0)`) primary. The only
  chromatic tokens are `--destructive` (red) and the blue `--chart-1…5` ramp.
- **Re-theming is a token override.** A product picks its accent by overriding
  `--primary` (and friends) *after* importing — e.g. the grocery-agent admin's
  warm orange `#f4a259`. Don't introduce new colors ad hoc; theme through tokens.
- **Semantic, not literal.** Components reference `--primary`, `--muted`,
  `--border`, `--ring`, `--card`… never raw hex. This is what makes dark mode
  and re-theming free.
- **Dark mode** is a full second token map under `html.dark` — every surface,
  text, border, and ring re-maps. Components are written once.

### Type
- **Geist + Geist Mono** (the shadcn defaults), loaded from Google Fonts.
- **`text-sm` (14px) is the UI default** — not 16px. The scale is Tailwind's
  (xs 12 → 4xl 36), each with a paired line-height.
- **Weights live at 400/500.** Body is 400; labels, buttons, titles, and active
  nav are 500 (medium). 600 for occasional emphasis. Bold is rare.
- Headings are **not** globally sized — the system is utility/component-driven,
  so size is set where it's used. Display headings get slightly negative
  tracking.

### Shape, border & elevation
- **One radius knob.** `--radius: 0.625rem` (10px) drives `sm/md/lg/xl`. Buttons
  & inputs use `md` (8px); cards & dialogs `xl` (14px); badges & avatars are
  fully round.
- **Flat + hairline.** Surfaces are flat. Borders are 1px in `--border` (a very
  light gray). Cards and popovers combine a tiny `shadow-xs` with a **1px ring**
  (`0 0 0 1px foreground/10`) rather than a heavy drop shadow. Dialogs/toasts get
  `shadow-lg`. There are no gradients and no glows.
- **Focus = ring.** Interactive controls show a 3px `--ring/50` box-shadow ring
  plus a border-color shift on `:focus-visible`. Invalid controls swap to a
  `--destructive/20` ring.

### Motion & states
- **Subtle and short.** Transitions are ~150ms on `color`, `background`, and
  `box-shadow`. No bounces, no parallax, no decorative loops (only the skeleton
  pulse and spinner rotation animate continuously).
- **Hover:** buttons lighten the fill (`primary/80`) or fill a muted background
  (ghost/outline); links underline; table rows tint `muted/50`.
- **Press:** primary/secondary buttons nudge down 1px (`translateY(1px)`) —
  there's no shrink/scale.
- **Backgrounds** are solid flat color (`--background` ≈ white, page chrome
  often `--muted`/`#fafafa`). No imagery, textures, or full-bleed photography in
  the system itself; products supply their own.

### Layout
- Content is **centered in a narrow measure** (the admin uses `max-width: 44rem`).
  Generous whitespace, left-aligned text, modest line-lengths. Cards stack with
  consistent gaps; the card itself pads 1.5rem (1rem at `data-size="sm"`).

---

## ICONOGRAPHY

- **Lucide is the icon system.** Basecoat ships [Lucide](https://lucide.dev)
  SVGs inline — even its tokens embed Lucide glyphs (the select chevron and
  checkbox check in `tokens/colors.css` are the Lucide `chevron-down` / `check`
  paths, stroked in `--muted-foreground`). Stroke style: **2px, round caps,
  round joins, no fill, 24×24 viewBox.**
- **Use Lucide for all UI icons.** Inline the SVG (as the components and UI kit
  do) or load from CDN (`https://unpkg.com/lucide-static` /
  `lucide@latest`). The kit's `ui_kits/grocery-admin/icons.jsx` is a small
  curated Lucide set (alert-triangle, refresh-cw, plus, ellipsis, utensils,
  users, search) — copy the pattern rather than hand-drawing icons.
- **Sizing.** Icons inside controls are `1rem` (16px), `0.75rem` (12px) in xs
  buttons/badges, `1.5rem` in empty-state figures. They inherit `currentColor`.
- **No emoji as icons.** No icon fonts. No PNG icons. SVG only, monochrome,
  recolored via `currentColor`.
- **Logo.** Basecoat's identity is the lowercase **`basecoat.`** wordmark set in
  Geist Medium with tight tracking (see `guidelines/brand-wordmark.card.html`) —
  there is no pictorial logomark. Products brand themselves with their own
  wordmark + accent.

---

## INDEX

Root manifest and where to look:

| Path | What it is |
| --- | --- |
| `styles.css` | **Entry point** — the only file consumers link. `@import`s tokens → reset → components. |
| `tokens/colors.css` | Color tokens (light + `html.dark`), chart ramp, embedded Lucide icon tokens. |
| `tokens/typography.css` | Geist font load + family/size/weight tokens. |
| `tokens/radius.css` | Radius scale, shadow/elevation, spacing base. |
| `base.css` | Reset + document defaults (box model, page surface, selection). |
| `basecoat.css` | The component layer — plain-CSS translation of Basecoat Vega. |
| `components/` | React primitives (see below), grouped by concern. |
| `guidelines/` | Foundation specimen cards (Colors · Type · Spacing · Brand). |
| `ui_kits/grocery-admin/` | Interactive recreation of the grocery-agent operator admin. |
| `SKILL.md` | Agent-Skill manifest (usable in Claude Code). |

### Components (`window.DesignSystem_959bdd`)

- **actions/** — `Button`, `ButtonGroup`, `Badge`
- **forms/** — `Input`, `InputGroup`/`InputGroupAddon`, `Textarea`, `Label`, `Field`, `Checkbox`, `RadioGroup`/`Radio`, `Switch`, `Select`, `Combobox`, `Slider`
- **display/** — `Card`, `Tabs`, `Accordion`, `Table`, `Chart`, `Avatar`, `Breadcrumb`, `Kbd`, `Separator`, `ScrollArea`, `Item`/`ItemGroup`
- **feedback/** — `Alert`, `Progress`, `Skeleton`, `Spinner`, `Empty`, `Toast`/`Toaster`
- **overlay/** — `Dialog`, `AlertDialog`, `Drawer`, `Popover`, `DropdownMenu`, `Tooltip`
- **navigation/** — `Sidebar`, `Command` (⌘K palette), `Pagination`, `ThemeSwitcher`

Each component directory has `<Name>.jsx` + `<Name>.d.ts` (props contract) +
`<Name>.prompt.md` (when & how) + a `@dsCard` HTML showcase. Components emit
Basecoat classes; styling comes entirely from `styles.css`.

### Using it

```html
<link rel="stylesheet" href="styles.css">
<button class="btn">Save changes</button>
<button class="btn" data-variant="outline" data-size="sm">Cancel</button>
```

Or, in React, via the compiled bundle:

```js
const { Button, Card, Dialog } = window.DesignSystem_959bdd;
```

To re-theme, override tokens after importing `styles.css`:

```css
:root { --primary: #f4a259; --primary-foreground: #1a1a1a; }
```
