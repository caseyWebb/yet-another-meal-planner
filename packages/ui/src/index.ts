// @grocery-agent/ui — the shared member-app UI surface (member-app-shell +
// member-app-core). Raw-TS workspace exports (the app's bundler compiles this); the
// theme tokens ship as the sibling `./theme.css` export and the member pages' ported
// design-bundle styles as `./cookbook.css`. Primitives are shadcn/ui source vendored
// via the shadcn CLI (components.json) — extend by vendoring, not by hand-writing
// variants; the member-page furniture (page head, empty state, combobox, tokens,
// toast, icons) is transcribed from the committed design bundle.

export { cn } from "./lib/utils";
export { Button, buttonVariants } from "./components/button";
export { Input } from "./components/input";
export { Label } from "./components/label";
export { Textarea } from "./components/textarea";
export { NativeSelect } from "./components/select";
export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
} from "./components/card";
export {
  PageHead,
  GroupHeading,
  EmptyState,
  Crumbs,
  FacetChip,
  RecipeFacets,
  type CrumbItem,
} from "./components/page";
export { SegmentedControl, ToggleChip, TokenField } from "./components/controls";
export {
  NightsStepper,
  NudgeBar,
  RerollButton,
  SlotCard,
  TIME_TIERS,
  VarietyBar,
  WeatherNoLocation,
  WeatherStrip,
  type ProposeAlt,
  type ProposeSlotView,
  type SlotPanel,
  type WeatherStripDay,
} from "./components/propose";
export { Combobox, type ComboOption } from "./components/combobox";
export { Toaster, toast } from "./components/toast";
export * from "./components/icons";
