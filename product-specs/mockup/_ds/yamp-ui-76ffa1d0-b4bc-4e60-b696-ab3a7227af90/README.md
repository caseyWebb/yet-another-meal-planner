# Building with @grocery-agent/ui

A shadcn/ui-style React design system for a grocery / recipe / meal-planning app. Components carry
their own look via **variant props**; you style your own layout with **Tailwind utility classes bound
to the DS's semantic tokens**. Never hardcode hex colors — use the token utilities so light/dark and
brand stay consistent.

## Setup

- **No global provider is needed for styling** — the theme tokens live in the stylesheet. Render
  components directly; they're styled out of the box.
- **Dark mode**: add `class="dark"` to a root element (e.g. `<html class="dark">`). Every token flips;
  light is the default on `:root`.
- **Toasts**: mount `<Toaster />` once near the app root, then call `toast("Added to meal plan")` from
  anywhere. `toast` is a plain function import, not a hook.
- **Tooltips** self-provide context — no separate provider needed (`TooltipProvider` exists if you want
  a shared `delayDuration`).
- Overlays (`Dialog`, `AlertDialog`, `DropdownMenu`, `Select`) are driven by `open`/`defaultOpen` +
  `onOpenChange`.

## Styling idiom — token-backed Tailwind utilities

Each semantic color is available as `bg-*`, `text-*`, `border-*`, and `ring-*`:

| Token | Use |
|---|---|
| `background` / `foreground` | page surface + default text |
| `card` / `card-foreground` | raised surfaces |
| `popover` / `popover-foreground` | menus, tooltips |
| `primary` / `primary-foreground` | primary actions (warm orange) |
| `secondary` / `secondary-foreground` | secondary actions |
| `muted` / `muted-foreground` | subdued surfaces + secondary text |
| `accent` / `accent-foreground` | hover / active surfaces |
| `destructive` | destructive actions, errors |
| `border` / `input` / `ring` | lines, field borders, focus rings |
| `brand` / `link` | brand accent, links |

e.g. `bg-card text-card-foreground border border-border rounded-lg`, `text-muted-foreground`,
`bg-primary text-primary-foreground`. Type: `font-sans` (Geist) is default, `font-mono` (Geist Mono)
for code/labels. Radii: `rounded-sm|md|lg|xl` (off `--radius`). All tokens are also readable as CSS
custom properties (`var(--primary)`, `var(--muted-foreground)`, …) for inline styles.

Don't restyle a component's built-in states with classes — pass the prop:
- `Button` — `variant: default|secondary|outline|ghost|destructive|link`, `size: default|sm|lg|icon`, `asChild`
- `Badge` — `variant: default|secondary|destructive|outline`
- `Alert` — `variant: default|destructive`
- `DropdownMenuItem` — `variant: default|destructive`

## Compound components — compose the parts

- `Card` → `CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`
- `Dialog` → `DialogTrigger`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose`
- `AlertDialog` → `AlertDialogContent`, `AlertDialogHeader`, `AlertDialogTitle`, `AlertDialogDescription`, `AlertDialogFooter`, `AlertDialogAction`, `AlertDialogCancel`
- `DropdownMenu` → `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuCheckboxItem`, `DropdownMenuSeparator`, `DropdownMenuLabel`, `DropdownMenuSub…`
- `Select` → `SelectTrigger`, `SelectValue`, `SelectContent`, `SelectItem`, `SelectGroup`, `SelectLabel`, `SelectSeparator`
- `Table` → `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`, `TableCaption`, `TableFooter`
- `Empty` → `EmptyHeader`, `EmptyMedia`, `EmptyTitle`, `EmptyDescription`, `EmptyContent`
- `Pagination` → `PaginationContent`, `PaginationItem`, `PaginationLink` (`isActive`), `PaginationPrevious`, `PaginationNext`, `PaginationEllipsis`
- `Tooltip` → `TooltipTrigger`, `TooltipContent`

These sub-parts are importable from `@grocery-agent/ui` even though the pane shows one card per parent.

**Icons**: import by name — `IconCart`, `IconHeart`, `IconSearch`, `IconPlus`, `IconTrash`, … (browse the
Icons gallery card). Each takes SVG props and inherits `currentColor`.

**Member-app composites** (the Meal Planning group — `PageHead`, `SlotCard`, `WeatherStrip`,
`NightsStepper`, `NudgeBar`, `VarietyBar`, `RecipeFacets`, `FacetChip`) take structured domain props;
read each component's `.d.ts` + `.prompt.md` for the exact shape.

## Where the truth lives

- The stylesheets reachable from `styles.css` (tokens + component CSS) — read before styling.
- Per component: `components/<group>/<Name>/<Name>.d.ts` (props contract) and `<Name>.prompt.md` (usage + examples).

## Idiomatic snippet

```tsx
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
  Button, Badge, IconHeart,
} from "@grocery-agent/ui";

function RecipeTile() {
  return (
    <Card className="rounded-lg">
      <CardHeader>
        <CardTitle>Pan-seared salmon</CardTitle>
        <CardDescription className="text-muted-foreground">Quick weeknight main · 25 min</CardDescription>
      </CardHeader>
      <CardContent className="flex gap-2">
        <Badge>Mediterranean</Badge>
        <Badge variant="secondary">Salmon</Badge>
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button>Cook tonight</Button>
        <Button variant="outline"><IconHeart /> Save</Button>
      </CardFooter>
    </Card>
  );
}
```

# GroceryAgentUI (@grocery-agent/ui@0.1.0)

This design system is the published @grocery-agent/ui React library, bundled as a single
browser global. All 38 components are the real upstream code.

## Where things are

- `_ds_bundle.js` — the whole-DS bundle at the project root; loads every component to `window.GroceryAgentUI`. First line is a `/* @ds-bundle: … */` metadata header.
- `styles.css` — the single stylesheet entry: it `@import`s the tokens, fonts, and component styles (`_ds_bundle.css`). Link this one file.
- `components/<group>/<Name>/<Name>.prompt.md` (example JSX + variants), `<Name>.d.ts` (types), `<Name>.html` (variant grid).
- `tokens/*.css` — CSS custom properties, names verbatim from upstream.
- `fonts/` — `@font-face` files + `fonts.css` (when the package ships fonts).

For a specific component, `read_file("components/<group>/<Name>/<Name>.prompt.md")`.

## Loading

Add these two lines to your page once (React must be on the page first):

```html
<link rel="stylesheet" href="styles.css">
<script src="_ds_bundle.js"></script>
```

Components are then available at `window.GroceryAgentUI.*`. Mount into a dedicated child node (e.g. `<div id="ds-root">`), not the host page's own React root, so the two trees don't collide:

```jsx
const { Alert } = window.GroceryAgentUI;
ReactDOM.createRoot(document.getElementById('ds-root')).render(<Alert />);
```

## Tokens

104 CSS custom properties from @grocery-agent/ui. Names are
preserved verbatim from upstream. They are declared inside `_ds_bundle.css` (this DS ships one compiled stylesheet rather than separate token files).

- **color** (18): `--color-black`, `--color-white`, `--text-xs`, …
- **spacing** (4): `--tw-inset-shadow`, `--tw-inset-shadow-alpha`, `--tw-inset-ring-shadow`, …
- **typography** (10): `--font-sans`, `--font-mono`, `--font-weight-normal`, …
- **radius** (6): `--radius-xs`, `--radius-sm`, `--radius-md`, …
- **shadow** (11): `--shadow-xs`, `--shadow-sm`, `--shadow-md`, …
- **other** (55): `--spacing`, `--container-sm`, `--container-lg`, …

## Components

### feedback
- `Alert`
- `Badge`
- `Empty`
- `EmptyState` — Design-system empty state: centered dashed card, accent figure, muted copy.
- `Progress`
- `Toaster`

### overlays
- `AlertDialog`
- `Dialog`
- `DropdownMenu`
- `Tooltip`

### actions
- `Button`
- `RerollButton` — The re-roll control (seed + 1  the page owns the seed).

### data
- `Card`
- `Pagination`
- `Table`

### forms
- `Combobox`
- `Input`
- `Label`
- `NativeSelect`
- `SegmentedControl` — The mock's segmented control (single select).
- `Select`
- `Slider`
- `Switch`
- `Textarea`
- `ToggleChip` — A single toggle chip (the mock's .chip-tog / .wxchip).
- `TokenField` — Selected values as removable tokens the caller renders the adder beside them.

### navigation
- `Crumbs` — Breadcrumb trail. renderLink injects the SPA's Link (packages/ui stays
- `GroupHeading` — The uppercase group heading used by list groupings.
- `PageHead` — The page header: title, optional subtitle, optional right-aligned actions.

### meal-planning
- `FacetChip` — One facet chip kindprotein gets the accent treatment.
- `NightsStepper`
- `NudgeBar` — The nudge bar: adventurousness  the variety nudge, week-level protein wants, and
- `RecipeFacets` — The recipe facet pair (protein accent + cuisine) the list rows and details share.
- `SlotCard`
- `VarietyBar`
- `WeatherNoLocation` — The quiet no-location state (never an error page): a set-your-ZIP affordance.
- `WeatherStrip`

### icons
- `Icons`
