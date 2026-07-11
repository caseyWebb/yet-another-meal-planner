// @yamp/ui — the shared member-app UI surface (member-app-shell +
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
  type ProposeAlt,
  type ProposeSlotView,
  type SlotPanel,
} from "./components/propose";
export {
  buildProposeRequest,
  dateSeed,
  defaultProposeSession,
  proposePanelOf,
  proposeSessionFromRequest,
  proposeSlotToView,
  type ProposeRequest,
  type ProposeRequestSlot,
  type ProposeSession,
  type ProposeSessionRequest,
} from "./propose-orchestration";
export { Combobox, type ComboOption } from "./components/combobox";
export { Toaster, toast } from "./components/toast";
export * from "./components/icons";

// Radix-based primitives the admin app composes (vendored shadcn source, admin-spa).
export { Alert, AlertDescription, AlertTitle } from "./components/alert";
export {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./components/alert-dialog";
export { Badge, badgeVariants } from "./components/badge";
export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
} from "./components/dialog";
export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./components/dropdown-menu";
export { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./components/empty";
export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "./components/pagination";
export { Progress } from "./components/progress";
export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "./components/select-menu";
export { Slider } from "./components/slider";
export { Switch } from "./components/switch";
export { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "./components/table";
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./components/tooltip";
