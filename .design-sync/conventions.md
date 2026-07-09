# Building with @yamp/ui

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

These sub-parts are importable from `@yamp/ui` even though the pane shows one card per parent.

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
} from "@yamp/ui";

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
